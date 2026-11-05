'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { beforeEach, test } = require('node:test');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const {
  buildCnblogsPost,
  buildUpdatedPostContent,
  contentHash,
  extractCnblogsModifiedDate,
  extractShanghaiDate,
  findPostByCnblogsUrl,
  formatShanghaiDate,
  hasFullContent,
  hasRemoteCnblogsImages,
  imageFilename,
  isAtomFeed,
  localizePostImages,
  normalizeLazyImages,
  parseFeed,
  syncCnblogs,
  validateImageBuffer,
} = require('../sync-posts.js');

const NODE_BIN = process.execPath;

// Node 20 can corrupt its test-report stream when CLI progress messages contain
// Unicode. Keep these state-based tests silent; test-context mocks auto-restore.
beforeEach(context => {
  for (const method of ['log', 'warn', 'error']) {
    context.mock.method(console, method, () => {});
  }
});

function makeTempDir() {
  const root = path.join(__dirname, '.tmp');
  fs.mkdirSync(root, { recursive: true });
  return fs.mkdtempSync(path.join(root, 'sync-posts-test-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

function writePost(dir, filename, content) {
  fs.mkdirSync(dir, { recursive: true });
  const filepath = path.join(dir, filename);
  fs.writeFileSync(filepath, content, 'utf8');
  return filepath;
}

test('cnblogs_url deduplication is exact and ignores body references', () => {
  const dir = makeTempDir();
  try {
    writePost(dir, 'exact.md', [
      '---',
      'cnblogs_url: https://www.cnblogs.com/greenpia/p/123',
      '---',
      '',
      '正文引用了另一篇：https://www.cnblogs.com/greenpia/p/1234',
      '',
    ].join('\n'));
    writePost(dir, 'prefix.md', [
      '---',
      'cnblogs_url: https://www.cnblogs.com/greenpia/p/1234',
      '---',
      '',
      '另一个 postId。',
      '',
    ].join('\n'));
    writePost(dir, 'body-only.md', [
      '---',
      'title: body only',
      '---',
      '',
      'https://www.cnblogs.com/greenpia/p/123',
      '',
    ].join('\n'));

    const found = findPostByCnblogsUrl(
      '123',
      dir,
      'https://www.cnblogs.com/greenpia/p/123'
    );
    assert.equal(found && found.filename, 'exact.md');
    assert.equal(
      findPostByCnblogsUrl('123', dir, 'http://www.cnblogs.com/greenpia/p/123.html?from=rss').filename,
      'exact.md'
    );

    const article = writePost(dir, 'article.md', [
      '---',
      'cnblogs_url: https://www.cnblogs.com/greenpia/articles/123',
      '---',
      '',
      '文章区文章。',
      '',
    ].join('\n'));
    assert.equal(
      findPostByCnblogsUrl('123', dir, 'https://www.cnblogs.com/greenpia/articles/123').filepath,
      article
    );
    assert.equal(
      findPostByCnblogsUrl('123', dir, 'https://www.cnblogs.com/greenpia/p/123').filepath,
      path.join(dir, 'exact.md')
    );
  } finally {
    cleanup(dir);
  }
});

test('a more marker alone is not treated as full content', () => {
  assert.equal(hasFullContent('---\n---\n\n<!-- more -->\n'), false);

  const rssPlaceholder = [
    '---',
    'cnblogs_url: https://www.cnblogs.com/greenpia/p/1',
    'cnblogs_full: false',
    '---',
    '',
    'RSS 摘要',
    '<!-- more -->',
    '',
    '> 原文地址: [题目](https://www.cnblogs.com/greenpia/p/1)',
    '',
  ].join('\n');
  assert.equal(hasFullContent(rssPlaceholder), false);

  const full = [
    '---',
    'cnblogs_url: https://www.cnblogs.com/greenpia/p/1',
    '---',
    '',
    '摘要',
    '<!-- more -->',
    '',
    '<p>正文内容</p>',
    '',
  ].join('\n');
  assert.equal(hasFullContent(full), true);
  assert.equal(hasFullContent('---\ncnblogs_full: true\n---\n\n正文'), true);
});

test('YAML fields are safely quoted', () => {
  const post = buildCnblogsPost({
    title: 'C++: 入门',
    link: 'https://www.cnblogs.com/greenpia/p/1',
    pubDate: '2026-07-16T16:44:00.000Z',
    categories: ['C++: tag', '带"引号"的标签'],
  }, '<p>正文</p>');

  assert.match(post, /^title: "C\+\+: 入门"$/m);
  assert.match(post, /^date: "2026-07-17 00:44:00"$/m);
  assert.match(post, /^  - "C\+\+: tag"$/m);
  assert.match(post, /^  - "带\\"引号\\"的标签"$/m);
  assert.match(post, /^cnblogs_url: "https:\/\/www\.cnblogs\.com\/greenpia\/p\/1"$/m);
  assert.match(post, /^cnblogs_full: true$/m);
});

test('new dates are fixed to Asia/Shanghai and naive dates stay local', () => {
  assert.equal(formatShanghaiDate('2026-07-16T16:44:00.000Z'), '2026-07-17 00:44:00');
  assert.equal(formatShanghaiDate('2026-07-16 12:44:00'), '2026-07-16 12:44:00');
  assert.equal(extractShanghaiDate('2026-07-16T16:00:00.000Z'), '2026-07-17');
  assert.equal(formatShanghaiDate('not-a-date'), null);
});

test('updating an RSS placeholder preserves frontmatter and local body edits', () => {
  const link = 'https://www.cnblogs.com/greenpia/p/123';
  const existing = [
    '---',
    'title: 本地标题',
    'date: 2020-01-02 03:04:05',
    'slug: old-slug',
    'permalink: old/permalink/',
    'tags:',
    '  - 本地标签',
    'categories:',
    '  - 本地分类',
    'cnblogs_url: https://www.cnblogs.com/greenpia/p/123',
    'cnblogs_full: false',
    '---',
    '',
    '本地补充说明',
    'RSS 摘要',
    '<!-- more -->',
    '',
    '> 原文地址: [旧标题](https://www.cnblogs.com/greenpia/p/123)',
    '',
  ].join('\n');

  const updated = buildUpdatedPostContent(existing, {
    title: '远端标题',
    link,
    pubDate: '2026-07-16T16:44:00.000Z',
    categories: ['远端标签'],
  }, '<p>抓取到的全文</p>');

  assert.match(updated, /^title: 本地标题$/m);
  assert.match(updated, /^date: 2020-01-02 03:04:05$/m);
  assert.match(updated, /^slug: old-slug$/m);
  assert.match(updated, /^permalink: old\/permalink\/$/m);
  assert.match(updated, /^  - 本地标签$/m);
  assert.match(updated, /^  - 本地分类$/m);
  assert.match(updated, /^cnblogs_full: true$/m);
  assert.match(updated, /本地补充说明/);
  assert.match(updated, /<p>抓取到的全文<\/p>/);
  assert.doesNotMatch(updated, /原文地址: \[旧标题\]/);
});

test('updating a middle frontmatter field keeps the next line and ignores an unused remote date', () => {
  const link = 'https://www.cnblogs.com/greenpia/p/123';
  const existing = [
    '---',
    'cnblogs_url: ' + link,
    'cnblogs_full: false',
    'date: 2020-01-02 03:04:05',
    'permalink: old/path/',
    '---',
    '',
    '本地摘要',
    '<!-- more -->',
    '> 原文地址: [旧标题](' + link + ')',
  ].join('\r\n');
  const updated = buildUpdatedPostContent(existing, { link, pubDate: 'bad-date' }, '<p>正文</p>');
  assert.match(updated, /^cnblogs_full: true\r?\n/m);
  assert.match(updated, /^date: 2020-01-02 03:04:05$/m);
  assert.match(updated, /^permalink: old\/path\/$/m);
  assert.match(updated, /本地摘要/);
});

test('lazy images are normalized to one src attribute', () => {
  const normalized = normalizeLazyImages(
    '<img src="/placeholder.gif" data-src="https://img2024.cnblogs.com/a/b/photo.png">'
  );
  assert.equal((normalized.match(/\bsrc=/g) || []).length, 1);
  assert.match(normalized, /src="https:\/\/img2024\.cnblogs\.com\/a\/b\/photo\.png"/);
  assert.doesNotMatch(normalized, /data-src=/);
});

test('image names include URL identity and downloads are atomic', async () => {
  const dir = makeTempDir();
  try {
    const first = imageFilename('https://img.cnblogs.com/a/photo.png', '100');
    const second = imageFilename('https://img.cnblogs.com/b/photo.png', '100');
    assert.notEqual(first, second);
    assert.match(first, /^100-photo-[0-9a-f]{10}\.png$/);

    const html = [
      '<p>正文</p>',
      '<img src="https://img.cnblogs.com/a/photo.png">',
      '<img src="https://img.cnblogs.com/b/photo.png">',
      '<img src="https://img.cnblogs.com/c/photo">',
      '<img src="/images/cnblogs/local.png">',
    ].join('\n');

    const result = await localizePostImages(html, '100', {
      imagesDir: dir,
      async downloadImage() {
        return { ok: true, buffer: PNG, ext: '.png' };
      },
    });

    const files = fs.readdirSync(dir);
    assert.equal(files.filter(name => name.endsWith('.png')).length, 3);
    assert.equal(files.some(name => name.includes('.part-')), false);
    assert.equal((result.match(/https:\/\/img\.cnblogs\.com\//g) || []).length, 0);
    assert.equal((result.match(/\/images\/cnblogs\//g) || []).length, 4);
    assert.match(result, /<img src="\/images\/cnblogs\/local.png">/);
    for (const name of files) {
      assert.equal(validateImageBuffer(fs.readFileSync(path.join(dir, name)), ''), '.png');
    }
  } finally {
    cleanup(dir);
  }
});

test('HTML responses are rejected and failed images remain retryable', async () => {
  assert.equal(validateImageBuffer(Buffer.from('<html>not image</html>'), 'image/png'), null);
  assert.equal(validateImageBuffer(PNG, 'text/html'), null);

  const dir = makeTempDir();
  try {
    let calls = 0;
    const html = '<img src="https://img.cnblogs.com/a/photo.png">';
    const failed = await localizePostImages(html, '100', {
      imagesDir: dir,
      async downloadImage() {
        calls++;
        return { ok: false };
      },
    });
    assert.equal(failed, html);
    assert.equal(calls, 1);
    assert.deepEqual(fs.readdirSync(dir), []);

    const recovered = await localizePostImages(failed, '100', {
      imagesDir: dir,
      async downloadImage() {
        calls++;
        return { ok: true, buffer: PNG, ext: '.png' };
      },
    });
    assert.notEqual(recovered, failed);
    assert.equal(calls, 2);
    assert.equal(fs.readdirSync(dir).length, 1);
  } finally {
    cleanup(dir);
  }
});

test('duplicate image URLs retain distinct attributes and share one cached download', async () => {
  const dir = makeTempDir();
  try {
    let calls = 0;
    const html = '<img src="https://img.cnblogs.com/a/photo.png" alt="first">'
      + '<img class="second" src="https://img.cnblogs.com/a/photo.png">';
    const result = await localizePostImages(html, '100', {
      imagesDir: dir,
      async downloadImage() {
        calls++;
        return { ok: true, buffer: PNG, ext: '.png' };
      },
    });
    assert.equal(calls, 1);
    assert.equal((result.match(/\/images\/cnblogs\//g) || []).length, 2);
    assert.match(result, /alt="first"/);
    assert.match(result, /class="second"/);
    assert.doesNotMatch(result, /https:\/\/img\.cnblogs\.com/);
  } finally {
    cleanup(dir);
  }
});

test('cached SVGs and images with a corrected extension are reused offline', async () => {
  const dir = makeTempDir();
  try {
    const svgUrl = 'https://img.cnblogs.com/a/drawing.original.svg';
    const pngUrl = 'https://img.cnblogs.com/a/photo.jpg';
    fs.writeFileSync(path.join(dir, imageFilename(svgUrl, '100', '.svg')), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    fs.writeFileSync(path.join(dir, imageFilename(pngUrl, '100', '.png')), PNG);
    const result = await localizePostImages(`<img src="${svgUrl}"><img src="${pngUrl}">`, '100', {
      imagesDir: dir,
      async downloadImage() { assert.fail('A valid cached image must not be downloaded'); },
    });
    assert.equal((result.match(/\/images\/cnblogs\//g) || []).length, 2);
    assert.equal(fs.readdirSync(dir).length, 2);
  } finally {
    cleanup(dir);
  }
});

test('an already full post only changes remote image references', async () => {
  const dir = makeTempDir();
  try {
    const existing = [
      '---',
      'title: 本地标题',
      'date: 2020-01-02 03:04:05',
      'slug: old-slug',
      'permalink: old/permalink/',
      'cnblogs_url: https://www.cnblogs.com/greenpia/p/123',
      'cnblogs_full: true',
      '---',
      '',
      '本地人工编辑正文。',
      '<img src="/images/cnblogs/local.png">',
      '<img src="https://img.cnblogs.com/a/photo.png">',
      '',
    ].join('\n');

    const result = await localizePostImages(existing, '123', {
      imagesDir: dir,
      async downloadImage() {
        return { ok: true, buffer: PNG, ext: '.png' };
      },
    });

    assert.match(result, /^title: 本地标题$/m);
    assert.match(result, /^date: 2020-01-02 03:04:05$/m);
    assert.match(result, /^slug: old-slug$/m);
    assert.match(result, /本地人工编辑正文。/);
    assert.match(result, /<img src="\/images\/cnblogs\/local.png">/);
    assert.doesNotMatch(result, /https:\/\/img\.cnblogs\.com\/a\/photo\.png/);
    assert.equal(hasRemoteCnblogsImages(result), false);
    assert.equal(fs.readdirSync(dir).length, 1);
  } finally {
    cleanup(dir);
  }
});

test('unprefixed RSS and Atom feeds are both parsed', () => {
  const rss = [
    '<rss version="2.0"><channel>',
    '<item><title>RSS</title><link>https://www.cnblogs.com/greenpia/p/1</link>',
    '<pubDate>Thu, 16 Jul 2026 12:44:00 GMT</pubDate><description>summary</description></item>',
    '</channel></rss>',
  ].join('');
  const atom = [
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    '<entry><title>Atom</title>',
    '<link href="https://www.cnblogs.com/greenpia/p/2" />',
    '<published>2026-07-16T12:44:00Z</published>',
    '<summary>summary</summary></entry>',
    '</feed>',
  ].join('');

  assert.equal(isAtomFeed(atom), true);
  assert.equal(isAtomFeed(rss), false);
  assert.equal(parseFeed(rss)[0].title, 'RSS');
  assert.equal(parseFeed(atom)[0].title, 'Atom');
});

test('namespace-prefixed feeds decode XML and choose the Atom article link', () => {
  const rss = '<r:rss xmlns:r="urn:rss" xmlns:content="urn:content"><r:channel>'
    + '<r:item><r:title>RSS &amp; XML</r:title><r:link>https://www.cnblogs.com/greenpia/p/1</r:link>'
    + '<r:pubDate>Thu, 16 Jul 2026 12:44:00 GMT</r:pubDate>'
    + '<content:encoded><![CDATA[<p>full &amp; body</p>]]></content:encoded>'
    + '<r:category>C &amp; C++</r:category></r:item></r:channel></r:rss>';
  const atom = '<a:feed xmlns:a="http://www.w3.org/2005/Atom"><a:entry>'
    + '<a:title>Atom &amp; XML</a:title><a:link rel="self" href="https://feed.example/entry"/>'
    + "<a:link rel='alternate' href='https://www.cnblogs.com/greenpia/p/2'/>"
    + '<a:updated>2026-07-16T12:44:00Z</a:updated><a:content>&lt;p&gt;full&lt;/p&gt;</a:content>'
    + '<a:category term="C &amp; C++"/></a:entry></a:feed>';
  assert.equal(isAtomFeed(atom), true);
  assert.equal(isAtomFeed(rss), false);
  assert.deepEqual(parseFeed(rss)[0], {
    title: 'RSS & XML', link: 'https://www.cnblogs.com/greenpia/p/1',
    pubDate: 'Thu, 16 Jul 2026 12:44:00 GMT', content: '<p>full &amp; body</p>', categories: ['C & C++'],
  });
  assert.deepEqual(parseFeed(atom)[0], {
    title: 'Atom & XML', link: 'https://www.cnblogs.com/greenpia/p/2',
    pubDate: '2026-07-16T12:44:00Z', content: '<p>full</p>', categories: ['C & C++'],
  });
});

test('sync continues after one bad item and reports failures without network', async () => {
  const postsDir = makeTempDir();
  const imagesDir = makeTempDir();
  try {
    const rss = [
      '<rss version="2.0"><channel>',
      '<item><title>bad date</title><link>https://www.cnblogs.com/greenpia/p/1</link>',
      '<pubDate>bad-date</pubDate><description>one</description></item>',
      '<item><title>good</title><link>https://www.cnblogs.com/greenpia/p/2</link>',
      '<pubDate>Fri, 17 Jul 2026 00:44:00 GMT</pubDate><description>two</description></item>',
      '</channel></rss>',
    ].join('');

    const result = await syncCnblogs({
      postsDir,
      imagesDir,
      delayMs: 0,
      async fetchRss() { return rss; },
      async fetchPage(url) {
        if (url !== 'https://www.cnblogs.com/greenpia/p/2') {
          return '<html><body><div id="cnblogs_post_body"><p>bad body</p></div></body></html>';
        }
        return '<html><body><div id="cnblogs_post_body"><p>good body</p></div></body></html>';
      },
    });

    assert.equal(result.created, 1);
    assert.equal(result.failed, 1);
    const files = fs.readdirSync(postsDir);
    assert.equal(files.length, 1);
    assert.match(files[0], /^2026-07-17-2-good\.md$/);
    const content = fs.readFileSync(path.join(postsDir, files[0]), 'utf8');
    assert.match(content, /^cnblogs_full: true$/m);
    assert.match(content, /<p>good body<\/p>/);
  } finally {
    cleanup(postsDir);
    cleanup(imagesDir);
  }
});

function singlePostFeed(link, title = 'good') {
  return '<rss><channel><item>'
    + `<title>${title}</title><link>${link}</link>`
    + '<pubDate>Fri, 17 Jul 2026 00:44:00 GMT</pubDate>'
    + '<description>RSS summary</description></item></channel></rss>';
}

test('new imports preserve occupied primary and multiple fallback filenames', async () => {
  const postsDir = makeTempDir();
  const imagesDir = makeTempDir();
  try {
    const link = 'https://www.cnblogs.com/greenpia/p/2';
    const hash = crypto.createHash('sha1').update(link).digest('hex').slice(0, 8);
    const occupied = [
      '2026-07-17-2-good.md',
      `2026-07-17-2-${hash}-good.md`,
      `2026-07-17-2-${hash}-2-good.md`,
    ];
    occupied.forEach((name, index) => writePost(postsDir, name, `Existing article ${index}`));
    const result = await syncCnblogs({
      postsDir, imagesDir, delayMs: 0,
      async fetchRss() { return singlePostFeed(link); },
      async fetchPage() { return '<div id="cnblogs_post_body"><p>Full body</p></div>'; },
    });
    assert.equal(result.created, 1);
    assert.equal(result.failed, 0);
    assert.equal(fs.readdirSync(postsDir).length, 4);
    occupied.forEach((name, index) => {
      assert.equal(fs.readFileSync(path.join(postsDir, name), 'utf8'), `Existing article ${index}`);
    });
    assert.match(fs.readFileSync(path.join(postsDir, `2026-07-17-2-${hash}-3-good.md`), 'utf8'), /Full body/);
  } finally {
    cleanup(postsDir);
    cleanup(imagesDir);
  }
});

test('a new RSS fallback reports a failed article and is completed on the next run', async () => {
  const postsDir = makeTempDir();
  const imagesDir = makeTempDir();
  try {
    const link = 'https://www.cnblogs.com/greenpia/p/2';
    const options = {
      postsDir, imagesDir, delayMs: 0,
      async fetchRss() { return singlePostFeed(link); },
      async fetchPage() { return null; },
    };
    const first = await syncCnblogs(options);
    assert.equal(first.created, 1);
    assert.equal(first.failed, 1);
    const filename = fs.readdirSync(postsDir)[0];
    const filepath = path.join(postsDir, filename);
    assert.match(fs.readFileSync(filepath, 'utf8'), /^cnblogs_full: false$/m);

    const second = await syncCnblogs({
      ...options,
      async fetchPage() { return '<div id="cnblogs_post_body"><p>Recovered full body</p></div>'; },
    });
    assert.equal(second.created, 0);
    assert.equal(second.updated, 1);
    assert.equal(second.failed, 0);
    assert.deepEqual(fs.readdirSync(postsDir), [filename]);
    const recovered = fs.readFileSync(filepath, 'utf8');
    assert.match(recovered, /^date: "2026-07-17 08:44:00"$/m);
    assert.match(recovered, /^cnblogs_full: true$/m);
    assert.match(recovered, /Recovered full body/);
  } finally {
    cleanup(postsDir);
    cleanup(imagesDir);
  }
});

test('failed image localization reports one failed article and preserves local edits', async () => {
  const postsDir = makeTempDir();
  const imagesDir = makeTempDir();
  try {
    const link = 'https://www.cnblogs.com/greenpia/p/2';
    const body = '<p>Imported body.</p>\n<img src="https://img.cnblogs.com/photo.png">';
    const existing = buildCnblogsPost(syncItem(link, 'Local title'), body) + '<p>Manually edited body.</p>\n';
    const filepath = writePost(postsDir, 'old.md', existing);
    const options = {
      postsDir, imagesDir, delayMs: 0,
      async fetchRss() { return singlePostFeed(link); },
      async fetchPage() { return postPage(body); },
      async downloadImage() { return { ok: false }; },
    };
    const first = await syncCnblogs(options);
    assert.deepEqual(first, { created: 0, updated: 0, skipped: 0, failed: 1 });
    assert.equal(fs.readFileSync(filepath, 'utf8'), existing);
    const second = await syncCnblogs({
      ...options,
      async downloadImage() { return { ok: true, buffer: PNG, ext: '.png' }; },
    });
    assert.deepEqual(second, { created: 0, updated: 1, skipped: 0, failed: 0 });
    const saved = fs.readFileSync(filepath, 'utf8');
    assert.match(saved, /^title: "Local title"$/m);
    assert.match(saved, /Manually edited body\./);
    assert.match(saved, /\/images\/cnblogs\//);
    assert.equal(postField(saved, 'cnblogs_content_hash'), postField(existing, 'cnblogs_content_hash'));
    const third = await syncCnblogs({ ...options, async fetchPage() { return postPage('<p>Remote edit.</p>'); } });
    assert.deepEqual(third, { created: 0, updated: 0, skipped: 0, failed: 1 });
    assert.equal(fs.readFileSync(filepath, 'utf8'), saved);
  } finally {
    cleanup(postsDir);
    cleanup(imagesDir);
  }
});

function syncItem(link, title = 'Remote title') {
  return { title, link, pubDate: '2026-07-17T00:44:00Z', categories: ['Remote tag'] };
}

function postPage(body) {
  return `<div id="cnblogs_post_body">${body}</div><div id="blog_post_info_block"></div>`;
}

function postBody(content) {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').replace(/^\r?\n/, '');
}

function postField(content, name) {
  const match = content.match(new RegExp(`^${name}: (.+)$`, 'm'));
  return match ? JSON.parse(match[1]) : null;
}

async function withSyncDirs(run) {
  const postsDir = makeTempDir();
  const imagesDir = makeTempDir();
  try {
    await run({ postsDir, imagesDir });
  } finally {
    cleanup(postsDir);
    cleanup(imagesDir);
  }
}

test('unchanged RSS still refreshes full posts and preserves URLs, metadata and no-op mtimes', async () => {
  await withSyncDirs(async ({ postsDir, imagesDir }) => {
    const link = 'https://www.cnblogs.com/greenpia/p/2';
    let body = '<p>Before remote edit.</p>';
    let fetches = 0;
    const options = {
      postsDir, imagesDir, delayMs: 0,
      async fetchRss() { return singlePostFeed(link); },
      async fetchPage() { fetches++; return postPage(body); },
    };
    assert.deepEqual(await syncCnblogs(options), { created: 1, updated: 0, skipped: 0, failed: 0 });
    const filename = fs.readdirSync(postsDir)[0];
    const filepath = path.join(postsDir, filename);
    const original = fs.readFileSync(filepath, 'utf8');
    const local = original.replace('title: "good"', 'title: "Local title"')
      .replace('tags: []', 'tags: [Local]')
      .replace('date: "2026-07-17 08:44:00"', 'date: "2020-01-02 03:04:05"')
      .replace('cnblogs_url:', 'slug: stable-slug\npermalink: stable/path/\ncustom: keep\ncnblogs_url:');
    fs.writeFileSync(filepath, local);
    body = '<p>After remote edit.</p>';
    assert.deepEqual(await syncCnblogs(options), { created: 0, updated: 1, skipped: 0, failed: 0 });
    const saved = fs.readFileSync(filepath, 'utf8');
    assert.deepEqual(fs.readdirSync(postsDir), [filename]);
    assert.match(saved, /title: "Local title"/);
    assert.match(saved, /tags: \[Local\]/);
    assert.match(saved, /date: "2020-01-02 03:04:05"/);
    assert.match(saved, /slug: stable-slug\npermalink: stable\/path\/\ncustom: keep/);
    assert.match(saved, /After remote edit\.\n<!-- more -->\n\n<p>After remote edit\.<\/p>/);
    assert.doesNotMatch(saved, /Before remote edit/);
    assert.equal(postField(saved, 'cnblogs_content_hash'), contentHash(postBody(saved)));
    fs.utimesSync(filepath, new Date('2020-01-01'), new Date('2020-01-01'));
    const mtime = fs.statSync(filepath).mtimeMs;
    assert.deepEqual(await syncCnblogs(options), { created: 0, updated: 0, skipped: 1, failed: 0 });
    assert.equal(fs.readFileSync(filepath, 'utf8'), saved);
    assert.equal(fs.statSync(filepath).mtimeMs, mtime);
    assert.equal(fetches, 3);
  });
});

test('local edits survive an unchanged remote and block later conflicting remote edits', async () => {
  await withSyncDirs(async ({ postsDir, imagesDir }) => {
    const link = 'https://www.cnblogs.com/greenpia/p/2';
    let body = '<p>Original.</p>';
    const local = buildCnblogsPost(syncItem(link), body) + '<p>Local addition.</p>\n';
    const filepath = writePost(postsDir, 'stable.md', local);
    const options = {
      postsDir, imagesDir, delayMs: 0,
      async fetchRss() { return singlePostFeed(link); },
      async fetchPage() { return postPage(body); },
      async downloadImage() { assert.fail('Conflicting content must be rejected before downloads'); },
    };
    assert.deepEqual(await syncCnblogs(options), { created: 0, updated: 0, skipped: 1, failed: 0 });
    assert.equal(fs.readFileSync(filepath, 'utf8'), local);
    body = '<p>Remote edit.</p><img src="https://img.cnblogs.com/new.png">';
    assert.deepEqual(await syncCnblogs(options), { created: 0, updated: 0, skipped: 0, failed: 1 });
    assert.equal(fs.readFileSync(filepath, 'utf8'), local);
  });
});

test('matching legacy posts establish a baseline and retain custom summaries on future updates', async () => {
  await withSyncDirs(async ({ postsDir, imagesDir }) => {
    const link = 'https://www.cnblogs.com/greenpia/p/2';
    let body = '<p>Original.</p>';
    const legacy = `---\ntitle: Legacy\ndate: 2020-01-02\ncnblogs_url: ${link}\n---\n\nCustom summary.\n<!-- more -->\n\n${body}\n`;
    const filepath = writePost(postsDir, 'legacy.md', legacy);
    const options = {
      postsDir, imagesDir, delayMs: 0,
      async fetchRss() { return singlePostFeed(link); },
      async fetchPage() { return postPage(body); },
    };
    assert.deepEqual(await syncCnblogs(options), { created: 0, updated: 1, skipped: 0, failed: 0 });
    const baselined = fs.readFileSync(filepath, 'utf8');
    assert.equal(postBody(baselined), postBody(legacy));
    assert.equal(postField(baselined, 'cnblogs_source_hash'), contentHash(body));
    assert.deepEqual(await syncCnblogs(options), { created: 0, updated: 0, skipped: 1, failed: 0 });
    body = '<p>New remote body.</p>';
    assert.equal((await syncCnblogs(options)).updated, 1);
    const saved = fs.readFileSync(filepath, 'utf8');
    assert.match(saved, /Custom summary\.\n<!-- more -->\n\n<p>New remote body\.<\/p>/);
    assert.match(saved, /title: Legacy\ndate: 2020-01-02/);
  });
});

test('unverified legacy differences are reported without overwriting the file', async () => {
  await withSyncDirs(async ({ postsDir, imagesDir }) => {
    const link = 'https://www.cnblogs.com/greenpia/p/2';
    const local = `---\ncnblogs_url: ${link}\ncnblogs_full: true\n---\n\n<p>Unknown local version.</p>\n`;
    const filepath = writePost(postsDir, 'unverified.md', local);
    const result = await syncCnblogs({
      postsDir, imagesDir, delayMs: 0,
      async fetchRss() { return singlePostFeed(link); },
      async fetchPage() { return postPage('<p>Different remote version.</p>'); },
    });
    assert.deepEqual(result, { created: 0, updated: 0, skipped: 0, failed: 1 });
    assert.equal(fs.readFileSync(filepath, 'utf8'), local);
  });
});

test('legacy baseline creation applies downloaded images in the same run', async () => {
  await withSyncDirs(async ({ postsDir, imagesDir }) => {
    const link = 'https://www.cnblogs.com/greenpia/p/2';
    const body = '<p>Original.</p><img src="https://img.cnblogs.com/photo.png">';
    const legacy = `---\ncnblogs_url: ${link}\ncnblogs_full: true\n---\n\n${body}\n`;
    const filepath = writePost(postsDir, 'legacy.md', legacy);
    const options = {
      postsDir, imagesDir, delayMs: 0,
      async fetchRss() { return singlePostFeed(link); },
      async fetchPage() { return postPage(body); },
      async downloadImage() { return { ok: true, buffer: PNG, ext: '.png' }; },
    };
    assert.equal((await syncCnblogs(options)).updated, 1);
    const saved = fs.readFileSync(filepath, 'utf8');
    assert.match(saved, /src="\/images\/cnblogs\//);
    assert.doesNotMatch(postBody(saved), /https:\/\/img.cnblogs.com/);
    assert.equal(postField(saved, 'cnblogs_source_hash'), contentHash(body));
    assert.deepEqual(await syncCnblogs(options), { created: 0, updated: 0, skipped: 1, failed: 0 });
    assert.equal(fs.readFileSync(filepath, 'utf8'), saved);
  });
});

test('failed images retry without source-hash churn and later remote updates stay safe', async () => {
  await withSyncDirs(async ({ postsDir, imagesDir }) => {
    const link = 'https://www.cnblogs.com/greenpia/p/2';
    let body = '<p>Original.</p><img src="https://img.cnblogs.com/photo.png">';
    let imageOk = false;
    let downloads = 0;
    const options = {
      postsDir, imagesDir, delayMs: 0,
      async fetchRss() { return singlePostFeed(link); },
      async fetchPage() { return postPage(body); },
      async downloadImage() { downloads++; return imageOk ? { ok: true, buffer: PNG, ext: '.png' } : { ok: false }; },
    };
    assert.deepEqual(await syncCnblogs(options), { created: 1, updated: 0, skipped: 0, failed: 1 });
    const filepath = path.join(postsDir, fs.readdirSync(postsDir)[0]);
    const first = fs.readFileSync(filepath, 'utf8');
    imageOk = true;
    assert.deepEqual(await syncCnblogs(options), { created: 0, updated: 1, skipped: 0, failed: 0 });
    const saved = fs.readFileSync(filepath, 'utf8');
    assert.equal(postField(saved, 'cnblogs_source_hash'), postField(first, 'cnblogs_source_hash'));
    assert.equal(postField(saved, 'updated'), postField(first, 'updated'));
    assert.equal(postField(saved, 'cnblogs_content_hash'), contentHash(postBody(saved)));
    assert.match(saved, /src="\/images\/cnblogs\//);
    assert.deepEqual(await syncCnblogs(options), { created: 0, updated: 0, skipped: 1, failed: 0 });
    body = body.replace('Original.', 'Remote update.');
    assert.deepEqual(await syncCnblogs(options), { created: 0, updated: 1, skipped: 0, failed: 0 });
    assert.match(fs.readFileSync(filepath, 'utf8'), /Remote update/);
    assert.equal(downloads, 2);
  });
});

test('failed article pages preserve text while existing image downloads can still recover', async () => {
  await withSyncDirs(async ({ postsDir, imagesDir }) => {
    const link = 'https://www.cnblogs.com/greenpia/p/2';
    const body = '<p>Existing text.</p><img src="https://img.cnblogs.com/photo.png">';
    const original = buildCnblogsPost(syncItem(link), body);
    const filepath = writePost(postsDir, 'existing.md', original);
    const result = await syncCnblogs({
      postsDir, imagesDir, delayMs: 0,
      async fetchRss() { return singlePostFeed(link); },
      async fetchPage() { return null; },
      async downloadImage() { return { ok: true, buffer: PNG, ext: '.png' }; },
    });
    assert.deepEqual(result, { created: 0, updated: 1, skipped: 0, failed: 1 });
    const saved = fs.readFileSync(filepath, 'utf8');
    assert.match(saved, /<p>Existing text\.<\/p>/);
    assert.match(saved, /src="\/images\/cnblogs\//);
    assert.equal(postField(saved, 'cnblogs_source_hash'), postField(original, 'cnblogs_source_hash'));
    assert.equal(postField(saved, 'cnblogs_content_hash'), contentHash(postBody(saved)));
  });
});

test('fetch and extraction failures never replace existing full content with an RSS placeholder', async () => {
  await withSyncDirs(async ({ postsDir, imagesDir }) => {
    const link = 'https://www.cnblogs.com/greenpia/p/2';
    const original = buildCnblogsPost(syncItem(link), '<p>Existing content.</p>');
    const filepath = writePost(postsDir, 'existing.md', original);
    for (const page of [null, '<html>Temporary error page</html>']) {
      const result = await syncCnblogs({
        postsDir, imagesDir, delayMs: 0,
        async fetchRss() { return singlePostFeed(link); },
        async fetchPage() { return page; },
      });
      assert.deepEqual(result, { created: 0, updated: 0, skipped: 0, failed: 1 });
      assert.equal(fs.readFileSync(filepath, 'utf8'), original);
    }
  });
});

test('line endings are normalized while meaningful whitespace inside code remains detectable', () => {
  const link = 'https://www.cnblogs.com/greenpia/p/2';
  const body = '<pre><code>  value = 1;\n</code></pre>';
  assert.equal(contentHash(body), contentHash(body.replace(/\n/g, '\r\n')));
  const original = buildCnblogsPost(syncItem(link), body).replace(/\n/g, '\r\n');
  assert.equal(buildUpdatedPostContent(original, syncItem(link), body), original);
  const changed = body.replace('  value', '    value');
  assert.notEqual(contentHash(body), contentHash(changed));
  const updated = buildUpdatedPostContent(original, syncItem(link), changed);
  assert.match(updated, /<code>    value = 1;\r\n<\/code>/);
  assert.equal(postField(updated, 'cnblogs_content_hash'), contentHash(postBody(updated)));
});

test('updates replace old appended imported HTML without duplicating local introductory content', () => {
  const link = 'https://www.cnblogs.com/greenpia/p/2';
  const partial = `---\ntitle: Local\ncnblogs_url: ${link}\n---\n\nLocal introduction.\n`;
  const completed = buildUpdatedPostContent(partial, syncItem(link), '<p>First remote body.</p>');
  const updated = buildUpdatedPostContent(completed, syncItem(link), '<p>Second remote body.</p>');
  assert.equal((updated.match(/Local introduction\./g) || []).length, 1);
  assert.equal((updated.match(/<!-- cnblogs-full-body -->/g) || []).length, 1);
  assert.equal((updated.match(/<!-- more -->/g) || []).length, 1);
  assert.match(updated, /Second remote body\.\n<!-- more -->\n\n<p>Second remote body\.<\/p>/);
  assert.doesNotMatch(updated, /First remote body/);
});

function datedPostPage(body, link, modifiedDate) {
  return `<script type="application/ld&#x2B;json">${JSON.stringify({
    '@type': 'BlogPosting', '@id': link, dateModified: modifiedDate,
  })}</script>${postPage(body)}`;
}

test('source modification dates support encoded offsets and only use the matching article metadata', () => {
  const link = 'https://www.cnblogs.com/greenpia/p/2';
  const page = '<script type="application/ld+json">broken JSON</script>'
    + '<script type="application/ld+json">' + JSON.stringify({ '@graph': [
      { '@type': 'WebSite', dateModified: '2030-01-01' },
      { '@type': 'BlogPosting', '@id': 'https://www.cnblogs.com/greenpia/p/3', dateModified: '2030-02-01' },
      { '@type': ['Article', 'BlogPosting'], '@id': link, dateModified: '2026-11-04T00:25:00.0000000&#x2B;08:00' },
    ] }) + '</script>';
  assert.equal(extractCnblogsModifiedDate(page, link), '2026-11-04 00:25:00');
  assert.equal(extractCnblogsModifiedDate(datedPostPage('', link, '2026-11-03T16:25:00Z'), link), '2026-11-04 00:25:00');
  assert.equal(extractCnblogsModifiedDate(datedPostPage('', link, 'not-a-date'), link), null);
  assert.equal(extractCnblogsModifiedDate(datedPostPage('', link, ''), link), null);
  assert.equal(extractCnblogsModifiedDate('<p>dateModified: 2030-01-01</p>', link), null);
});

test('new articles use the source modification date and missing metadata falls back to publication', () => {
  const item = syncItem('https://www.cnblogs.com/greenpia/p/2');
  const body = '<p>Body.</p>';
  const post = buildCnblogsPost({ ...item, modifiedDate: '2026-11-03T16:25:00Z' }, body);
  assert.equal(postField(post, 'updated'), '2026-11-04 00:25:00');
  assert.equal(postField(post, 'date'), '2026-07-17 08:44:00');
  assert.equal(postField(buildCnblogsPost(item, body), 'updated'), '2026-07-17 08:44:00');
  assert.equal(postField(buildCnblogsPost({ ...item, modifiedDate: 'invalid' }, body), 'updated'), '2026-07-17 08:44:00');
});

test('unchanged content recovers its source date once without rewriting body or accepting local edits', async () => {
  await withSyncDirs(async ({ postsDir, imagesDir }) => {
    const link = 'https://www.cnblogs.com/greenpia/p/2';
    const body = '<p>Original.</p>';
    const existing = buildCnblogsPost(syncItem(link), body).replace(/^updated:.*\n/m, '') + '<p>Local note.</p>\n';
    const filepath = writePost(postsDir, 'stable.md', existing);
    const options = {
      postsDir, imagesDir, delayMs: 0,
      async fetchRss() { return singlePostFeed(link); },
      async fetchPage() { return datedPostPage(body, link, '2026-11-04T00:25:00+08:00'); },
    };
    assert.deepEqual(await syncCnblogs(options), { created: 0, updated: 1, skipped: 0, failed: 0 });
    const saved = fs.readFileSync(filepath, 'utf8');
    assert.equal(postField(saved, 'updated'), '2026-11-04 00:25:00');
    assert.equal(postBody(saved), postBody(existing));
    assert.equal(postField(saved, 'cnblogs_content_hash'), postField(existing, 'cnblogs_content_hash'));
    fs.utimesSync(filepath, new Date('2020-01-01'), new Date('2020-01-01'));
    const mtime = fs.statSync(filepath).mtimeMs;
    assert.deepEqual(await syncCnblogs(options), { created: 0, updated: 0, skipped: 1, failed: 0 });
    assert.equal(fs.statSync(filepath).mtimeMs, mtime);
    assert.equal(fs.readFileSync(filepath, 'utf8'), saved);
    const result = await syncCnblogs({ ...options,
      async fetchPage() { return datedPostPage('<p>Remote edit.</p>', link, '2026-11-05T10:00:00+08:00'); },
    });
    assert.equal(result.failed, 1);
    assert.equal(fs.readFileSync(filepath, 'utf8'), saved);
  });
});

test('body updates advance to the source modification time and absent dates preserve the last known value', async () => {
  await withSyncDirs(async ({ postsDir, imagesDir }) => {
    const link = 'https://www.cnblogs.com/greenpia/p/2';
    const item = { ...syncItem(link), modifiedDate: '2026-07-17 10:00:00' };
    const filepath = writePost(postsDir, 'stable.md', buildCnblogsPost(item, '<p>Before.</p>'));
    const options = {
      postsDir, imagesDir, delayMs: 0,
      async fetchRss() { return singlePostFeed(link); },
      async fetchPage() { return datedPostPage('<p>After.</p>', link, '2026-11-04T00:25:00+08:00'); },
    };
    assert.equal((await syncCnblogs(options)).updated, 1);
    const saved = fs.readFileSync(filepath, 'utf8');
    assert.equal(postField(saved, 'updated'), '2026-11-04 00:25:00');
    assert.match(saved, /<p>After\.<\/p>/);
    assert.equal((await syncCnblogs({ ...options, async fetchPage() { return postPage('<p>Another edit.</p>'); } })).updated, 1);
    assert.equal(postField(fs.readFileSync(filepath, 'utf8'), 'updated'), '2026-11-04 00:25:00');
  });
});

test('importing the module does not start a sync', async () => {
  const { stdout, stderr } = await promisify(execFile)(NODE_BIN, ['-e',
    'global.fetch = () => { throw new Error("unexpected network call"); }; require("./tools/sync-posts.js");',
  ], {
    cwd: path.resolve(__dirname, '../..'),
    encoding: 'utf8',
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')),
  });
  assert.equal(stdout, '');
  assert.equal(stderr, '');
});
