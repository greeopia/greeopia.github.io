/**
 * sync-posts.js — 从博客园自动拉取文章到 Hexo
 *
 * 博客园：RSS 获取文章列表 → 逐篇抓取全文（#cnblogs_post_body）
 *
 * 去重：仅匹配 frontmatter 中的 cnblogs_url
 * 更新：回查 RSS 内的旧文；远端正文变化时更新，检测到本地编辑则保留并报冲突
 * 图片：校验响应后原子写入 source/images/cnblogs/
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { load } = require('cheerio/slim');

// ============================================================
//  ⚙️ 配置
// ============================================================

const SOURCES = {
  cnblogs: {
    enabled: true,
    name: '博客园',
    rss: 'https://feed.cnblogs.com/blog/u/871804/rss/',
    username: 'greenpia',
  },
};

const POSTS_DIR = path.join(__dirname, '..', 'source', '_posts');
const IMAGES_DIR = path.join(__dirname, '..', 'source', 'images', 'cnblogs');
const USER_AGENT = 'Hexo-Blog-Sync/1.0';
const REQUEST_DELAY = 800;
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif']);
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

// ============================================================
//  基础工具
// ============================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: controller.signal,
      });
      if (res.ok) return await res.text();
      console.warn(`  ⚠ HTTP ${res.status} (第 ${i + 1}/${retries} 次)`);
    } catch (err) {
      console.warn(`  ⚠ 请求失败: ${err.message} (第 ${i + 1}/${retries} 次)`);
    } finally {
      clearTimeout(timeout);
    }
    if (i < retries - 1) await sleep(1000 * (i + 1));
  }
  return null;
}

function xmlLocalName(element) {
  return String(element.name || '').split(':').pop().toLowerCase();
}

function parseFeed(xml) {
  const $ = load(String(xml), { xmlMode: true });
  const atom = isAtomFeed(xml);
  const items = [];
  const entries = $('*').filter((_, element) => xmlLocalName(element) === (atom ? 'entry' : 'item'));
  for (const element of entries.toArray()) {
    const children = name => $(element).children().filter((_, child) => xmlLocalName(child) === name);
    const text = name => children(name).first().text().trim();
    const title = text('title');
    let link = text('link');
    if (atom) {
      const alternate = children('link').filter((_, child) => {
        const rel = $(child).attr('rel');
        return !rel || rel === 'alternate';
      }).first();
      link = alternate.attr('href') || text('id');
    }
    const pubDate = atom ? text('published') || text('updated') : text('pubdate');
    const content = atom ? text('content') || text('summary') : text('encoded') || text('description');
    const categories = children('category').toArray()
      .map(category => (atom ? $(category).attr('term') || '' : $(category).text()).trim())
      .filter(Boolean);
    if (title && link) items.push({ title, link, pubDate, content, categories });
  }
  return items;
}

function isAtomFeed(xml) {
  return /<(?:[\w.-]+:)?(?:feed|entry)(?=[\s/>])/i.test(String(xml));
}

function extractCnblogsPostId(url) {
  const match = String(url || '').match(/\/(?:p|articles)\/(\d+)/i);
  return match ? match[1] : null;
}

function extractCnblogsPostRef(url) {
  try {
    const parsed = new URL(String(url));
    if (!/(^|\.)cnblogs\.com$/i.test(parsed.hostname)) return null;
    const match = parsed.pathname.match(/^\/([^/]+)\/(p|articles)\/(\d+)(?:\.html)?\/?$/i);
    if (!match) return null;
    return {
      username: match[1].toLowerCase(),
      kind: match[2].toLowerCase(),
      id: match[3],
      url: `https://www.cnblogs.com/${match[1]}/${match[2]}/${match[3]}`,
    };
  } catch {
    return null;
  }
}

function sameCnblogsPost(leftUrl, rightUrl) {
  const left = extractCnblogsPostRef(leftUrl);
  const right = extractCnblogsPostRef(rightUrl);
  return Boolean(
    left
    && right
    && left.username === right.username
    && left.kind === right.kind
    && left.id === right.id
  );
}

function parseFrontmatter(content) {
  const match = String(content).match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return null;
  return { raw: match[1], body: String(content).slice(match[0].length).replace(/^\r?\n/, '') };
}

function frontmatterValue(raw, key) {
  const match = String(raw).match(new RegExp(`^${key}:[ \t]*(.*?)[ \t]*(?:\r?\n|$)`, 'm'));
  if (!match) return null;
  let value = match[1].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return value;
}

function yamlScalar(value) {
  return JSON.stringify(String(value));
}

function upsertFrontmatterField(raw, key, value) {
  const line = `${key}: ${value}`;
  const re = new RegExp(`^${key}:[^\r\n]*`, 'm');
  if (re.test(raw)) return raw.replace(re, line);
  return raw.trimEnd() ? `${raw.trimEnd()}\n${line}` : line;
}

function slugify(title, maxLen = 50) {
  return String(title || '')
    .replace(/[【】《》？?！!，,。.：:；、“”‘’（）()[\]{}]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[\/\\:*?"<>|]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLen)
    || 'untitled';
}

function parseShanghaiTimestamp(dateStr) {
  const cleaned = String(dateStr).replace(/&#x2B;/gi, '+').replace(/\.(\d{3})\d+/, '.$1').trim();
  const hasZone = /(?:Z|GMT|UTC|[+-]\d{2}:?\d{2})$/i.test(cleaned);
  if (!hasZone) {
    const naive = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (!naive) return NaN;
    return Date.UTC(
      Number(naive[1]),
      Number(naive[2]) - 1,
      Number(naive[3]),
      Number(naive[4] || 0),
      Number(naive[5] || 0),
      Number(naive[6] || 0)
    ) - SHANGHAI_OFFSET_MS;
  }
  return Date.parse(cleaned);
}

function formatShanghaiDate(dateStr) {
  const date = dateStr ? new Date(parseShanghaiTimestamp(dateStr)) : new Date();
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() + SHANGHAI_OFFSET_MS)
    .toISOString()
    .replace('T', ' ')
    .substring(0, 19);
}

function extractShanghaiDate(dateStr) {
  const formatted = formatShanghaiDate(dateStr);
  return formatted ? formatted.slice(0, 10) : null;
}

function generateExcerpt(html, maxLen = 300) {
  let text = String(html || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length > maxLen) {
    text = text.substring(0, maxLen - 3).replace(/\s+\S*$/, '') + '...';
  }
  return text;
}

function parseCnblogsDate(dateStr) {
  const formatted = formatShanghaiDate(dateStr);
  if (!formatted) throw new Error(`无效日期: ${dateStr || '(空)'}`);
  return formatted;
}

// ============================================================
//  文章内容与 frontmatter
// ============================================================

function hasFullContent(postContent) {
  const content = String(postContent || '');
  const frontmatter = parseFrontmatter(content);
  if (frontmatter && frontmatterValue(frontmatter.raw, 'cnblogs_full') === 'true') return true;

  const marker = '<!-- more -->';
  const markerIndex = content.indexOf(marker);
  if (markerIndex < 0) return false;
  const body = content.slice(markerIndex + marker.length).trim();
  if (!body) return false;

  const sourceLinkOnly = new RegExp(
    `^(?:<p>)?(?:> ?)?\\s*原文地址:\\s*\\[[^\\]]*\\]\\([^)]*\\)\\s*(?:</p>)?$`
  );
  return !sourceLinkOnly.test(body.replace(/\r?\n/g, ' '));
}

function isRssPlaceholder(postContent, itemLink) {
  const content = String(postContent || '');
  const markerIndex = content.indexOf('<!-- more -->');
  if (markerIndex < 0) return false;
  const body = content.slice(markerIndex + '<!-- more -->'.length).trim();
  return new RegExp(
    `^(?:<p>)?(?:> ?)?\\s*原文地址:\\s*\\[[^\\]]*\\]\\(${escapeRegExp(String(itemLink || ''))}\\)\\s*(?:</p>)?$`
  ).test(body.replace(/\r?\n/g, ' '));
}

function buildFullBody(item, body) {
  const excerpt = generateExcerpt(body);
  return `${excerpt}\n<!-- more -->\n\n${body}`;
}

function buildRssBody(item) {
  const excerpt = generateExcerpt(item.content || '');
  return `${excerpt}\n<!-- more -->\n\n> 原文地址: [${item.title}](${item.link})`;
}

// 仅统一换行和首尾空白，不折叠代码块内部的空格或换行。
function contentHash(content) {
  return crypto.createHash('sha256').update(String(content).replace(/\r\n/g, '\n').trim()).digest('hex');
}

function importedBodyParts(body) {
  const appendedMarker = '<!-- cnblogs-full-body -->';
  const appendedIndex = body.lastIndexOf(appendedMarker);
  const excerptStart = appendedIndex < 0 ? 0 : appendedIndex + appendedMarker.length;
  const marker = '<!-- more -->';
  const markerIndex = body.indexOf(marker, excerptStart);
  return {
    excerptStart,
    markerIndex,
    html: markerIndex < 0 ? body.trim() : body.slice(markerIndex + marker.length).trim(),
  };
}

function assertSafeFullUpdate(existing, sourceHash) {
  const lastHash = frontmatterValue(existing.raw, 'cnblogs_content_hash');
  if (lastHash) {
    if (contentHash(existing.body) === lastHash) return;
    throw new Error('博客园正文已变化，但本地正文也有修改；保留本地文章，请核对原文后处理冲突');
  }
  // 没有历史记录时，只能为与远端一致的旧文自动建立基线。
  if (contentHash(importedBodyParts(existing.body).html) !== sourceHash) {
    throw new Error('旧文章尚无同步基线，且正文与博客园不同；保留本地文章，请先核对差异');
  }
}

function refreshImportedBody(existingBody, item, body) {
  const parts = importedBodyParts(existingBody);
  if (parts.markerIndex < 0) return body;
  const oldExcerpt = existingBody.slice(parts.excerptStart, parts.markerIndex).trim();
  if (oldExcerpt === generateExcerpt(parts.html)) {
    const prefix = parts.excerptStart ? `${existingBody.slice(0, parts.excerptStart)}\n\n` : '';
    return `${prefix}${buildFullBody(item, body)}`;
  }
  // 手写摘要、补充说明和旧版追加全文前的内容继续保留。
  return `${existingBody.slice(0, parts.markerIndex + '<!-- more -->'.length).trimEnd()}\n\n${body}`;
}

function renderExistingPost(existingContent, raw, body) {
  const eol = existingContent.includes('\r\n') ? '\r\n' : '\n';
  return `---\n${raw}\n---\n\n${body.trimEnd()}\n`.replace(/\r?\n/g, eol);
}

function buildCnblogsPost(item, body, sourceHash = body ? contentHash(body) : null) {
  const dateStr = parseCnblogsDate(item.pubDate);
  const bodyContent = body ? buildFullBody(item, body) : buildRssBody(item);
  const tags = (item.categories || []).map(tag => tag.trim()).filter(Boolean);
  const tagLines = tags.length
    ? `tags:\n${tags.map(tag => `  - ${yamlScalar(tag)}`).join('\n')}`
    : 'tags: []';

  return [
    '---',
    `title: ${yamlScalar(item.title)}`,
    tagLines,
    'categories:',
    `  - ${yamlScalar('博客园')}`,
    `date: ${yamlScalar(dateStr)}`,
    `cnblogs_url: ${yamlScalar(item.link)}`,
    `cnblogs_full: ${body ? 'true' : 'false'}`,
    ...(body ? [
      `cnblogs_source_hash: ${yamlScalar(sourceHash)}`,
      `cnblogs_content_hash: ${yamlScalar(contentHash(bodyContent))}`,
    ] : []),
    '---',
    '',
    bodyContent,
    '',
  ].join('\n');
}

function buildUpdatedPostContent(existingContent, item, body, sourceHash = body ? contentHash(body) : null) {
  if (!body) return existingContent;
  const existing = parseFrontmatter(existingContent);
  if (!existing) return buildCnblogsPost(item, body, sourceHash);
  if (hasFullContent(existingContent)) {
    if (frontmatterValue(existing.raw, 'cnblogs_source_hash') === sourceHash) return existingContent;
    assertSafeFullUpdate(existing, sourceHash);
  }

  let raw = existing.raw;
  if (!frontmatterValue(raw, 'cnblogs_url')) {
    raw = upsertFrontmatterField(raw, 'cnblogs_url', yamlScalar(item.link));
  }
  if (body) raw = upsertFrontmatterField(raw, 'cnblogs_full', 'true');

  let bodyContent;
  if (isRssPlaceholder(existingContent, item.link)) {
    const marker = '<!-- more -->';
    const markerIndex = existing.body.indexOf(marker);
    const prefix = markerIndex >= 0
      ? existing.body.slice(0, markerIndex + marker.length).trimEnd()
      : existing.body.trimEnd();
    bodyContent = `${prefix}

${body || ''}`;
  } else if (hasFullContent(existingContent)) {
    bodyContent = refreshImportedBody(existing.body, item, body);
  } else {
    bodyContent = `${existing.body.trimEnd()}\n\n<!-- cnblogs-full-body -->\n\n${buildFullBody(item, body || '')}`;
  }

  raw = upsertFrontmatterField(raw, 'cnblogs_source_hash', yamlScalar(sourceHash));
  raw = upsertFrontmatterField(raw, 'cnblogs_content_hash', yamlScalar(contentHash(bodyContent)));
  return renderExistingPost(existingContent, raw, bodyContent);
}

// ============================================================
//  博客园正文
// ============================================================

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtmlAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function imgAttr(tag, name) {
  const match = String(tag).match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return match ? (match[1] ?? match[2] ?? '') : '';
}

function normalizeLazyImage(tag) {
  const actualSrc = imgAttr(tag, 'data-src') || imgAttr(tag, 'data-original');
  if (!actualSrc) return tag;
  let normalized = String(tag)
    .replace(/\s+(?:src|data-src|data-original)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
  return normalized.replace(/^<img\b/i, `<img src="${escapeHtmlAttr(actualSrc)}"`);
}

function normalizeLazyImages(html) {
  return String(html).replace(/<img\b[^>]*>/gi, tag => normalizeLazyImage(tag));
}

function extractCnblogsBody(html) {
  const startMatch = String(html).match(/<div[^>]*id=["']cnblogs_post_body["'][^>]*>/i);
  if (!startMatch) return null;

  const startIdx = startMatch.index + startMatch[0].length;
  const rest = String(html).substring(startIdx);
  const endMatch = rest.match(/<div[^>]*id=["']blog_post_info_block["'][^>]*>/i);
  const endIdx = endMatch ? endMatch.index : rest.length;
  let content = rest.substring(0, endIdx);

  content = content.replace(/(?:\s*<\/div>\s*|\s*<div[^>]*class=["']clear["'][^>]*><\/div>\s*)+$/i, '');
  content = content.replace(/(src|href)=["'](\/[^"']+)["']/g, (_, attr, rel) => (
    rel.startsWith('//')
      ? `${attr}="https:${rel}"`
      : `${attr}="https://www.cnblogs.com${rel}"`
  ));
  return normalizeLazyImages(content).trim() || null;
}

function hasRemoteCnblogsImages(content) {
  return /<img\b[^>]*\bsrc\s*=\s*["']https?:\/\/[^"']*\.cnblogs\.com\//i.test(String(content));
}

function findPostByCnblogsUrl(postId, postsDir = POSTS_DIR, itemLink = null) {
  if (!fs.existsSync(postsDir)) return null;
  const matches = [];
  for (const filename of fs.readdirSync(postsDir)) {
    if (!filename.toLowerCase().endsWith('.md')) continue;
    const filepath = path.join(postsDir, filename);
    const content = fs.readFileSync(filepath, 'utf8');
    const frontmatter = parseFrontmatter(content);
    if (!frontmatter) continue;
    const existingUrl = frontmatterValue(frontmatter.raw, 'cnblogs_url');
    if (!existingUrl) continue;
    const existingId = extractCnblogsPostId(existingUrl);
    const existingRef = extractCnblogsPostRef(existingUrl);
    const candidateRef = extractCnblogsPostRef(itemLink || `https://www.cnblogs.com/${SOURCES.cnblogs.username}/p/${postId}`);
    if (existingId === postId && existingRef && candidateRef && sameCnblogsPost(existingRef.url, candidateRef.url)) {
      matches.push({ filename, filepath, content });
    }
  }
  if (matches.length > 1) {
    throw new Error(`cnblogs_url 匹配多个文件: ${matches.map(item => item.filename).join(', ')}`);
  }
  return matches[0] || null;
}

// ============================================================
//  图片下载与本地化
// ============================================================

function imageFilename(url, postId, ext = '') {
  try {
    const parsed = new URL(url);
    const base = decodeURIComponent(path.posix.basename(parsed.pathname));
    const originalExt = path.posix.extname(base).toLowerCase();
    const safeExt = ext && IMAGE_EXTS.has(`.${String(ext).replace(/^\./, '')}`)
      ? `.${String(ext).replace(/^\./, '')}`
      : (IMAGE_EXTS.has(originalExt) ? originalExt : '');
    const stem = path.posix.basename(base, originalExt)
      .replace(/[^\w.-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80) || 'image';
    const identity = crypto.createHash('sha1')
      .update(`${parsed.origin}${parsed.pathname}${parsed.search}`)
      .digest('hex')
      .slice(0, 10);
    return `${postId}-${stem}-${identity}${safeExt}`;
  } catch {
    return null;
  }
}

function startsWithBytes(buffer, bytes, offset = 0) {
  return bytes.every((byte, index) => buffer[offset + index] === byte);
}

function validateImageBuffer(buffer, contentType) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;
  const type = String(contentType || '').toLowerCase();
  if (type && type !== 'application/octet-stream' && !type.startsWith('image/')) return null;
  if (type === 'image/svg+xml') {
    const text = buffer.toString('utf8').trim();
    if (text.startsWith('<svg') || (text.startsWith('<?xml') && text.includes('<svg'))) return '.svg';
    return null;
  }
  if (startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return '.png';
  if (startsWithBytes(buffer, [0xff, 0xd8, 0xff])) return '.jpg';
  if (buffer.subarray(0, 3).toString('ascii') === 'GIF') return '.gif';
  if (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) return '.webp';
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('ascii').toLowerCase();
    if (brand.startsWith('avif') || brand.startsWith('avis')) return '.avif';
  }
  return null;
}

function isImageFileValid(filepath) {
  try {
    const contentType = path.extname(filepath).toLowerCase() === '.svg' ? 'image/svg+xml' : '';
    return validateImageBuffer(fs.readFileSync(filepath), contentType) !== null;
  } catch {
    return false;
  }
}

async function downloadImage(url, retries = 2) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Referer: 'https://www.cnblogs.com/',
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        console.warn(`         ⚠ 图片 HTTP ${res.status}: ${url}`);
      } else {
        const buffer = Buffer.from(await res.arrayBuffer());
        const ext = validateImageBuffer(buffer, res.headers.get('content-type'));
        if (ext) return { ok: true, buffer, ext };
        console.warn(`         ⚠ 图片响应无效（Content-Type: ${res.headers.get('content-type') || '未知'}）: ${url}`);
      }
    } catch (err) {
      console.warn(`         ⚠ 图片下载失败: ${err.message} — ${url}`);
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < retries - 1) await sleep(800 * (attempt + 1));
  }
  return { ok: false };
}

function existingImageForUrl(url, postId, imagesDir) {
  const base = imageFilename(url, postId, '');
  if (!base) return null;
  const stem = path.basename(imageFilename(url, postId, '.png'), '.png');
  try {
    const match = fs.readdirSync(imagesDir).find(filename => (
      filename === base || (path.basename(filename, path.extname(filename)) === stem && IMAGE_EXTS.has(path.extname(filename)))
    ));
    if (!match) return null;
    const filepath = path.join(imagesDir, match);
    return isImageFileValid(filepath) ? filepath : null;
  } catch {
    return null;
  }
}

function writeImageAtomically(buffer, finalPath) {
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  const tempPath = `${finalPath}.part-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    fs.writeFileSync(tempPath, buffer);
    fs.renameSync(tempPath, finalPath);
  } catch (err) {
    try { fs.unlinkSync(tempPath); } catch { /* 忽略清理失败 */ }
    throw err;
  }
}

async function localizePostImages(html, postId, options = {}) {
  if (!html) return html;
  const imagesDir = options.imagesDir || IMAGES_DIR;
  const download = options.downloadImage || downloadImage;
  let result = normalizeLazyImages(html);
  const tasks = new Map();

  for (const match of result.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const url = imgAttr(tag, 'src').replace(/&amp;/g, '&');
    if (!/^https?:\/\//i.test(url)) continue;
    if (!tasks.has(url)) tasks.set(url, []);
    tasks.get(url).push(tag);
  }
  if (!tasks.size) return result;

  fs.mkdirSync(imagesDir, { recursive: true });
  let failed = 0;

  for (const [url, tags] of tasks) {
    let finalPath = existingImageForUrl(url, postId, imagesDir);
    if (!finalPath) {
      const downloaded = await download(url);
      if (!downloaded.ok) {
        failed++;
        if (options.onFailure) options.onFailure(url);
        continue;
      }
      const filename = imageFilename(url, postId, downloaded.ext);
      if (!filename) {
        failed++;
        if (options.onFailure) options.onFailure(url);
        continue;
      }
      finalPath = path.join(imagesDir, filename);
      if (!isImageFileValid(finalPath)) writeImageAtomically(downloaded.buffer, finalPath);
    }
    for (const tag of tags) {
      const replacement = tag.replace(
        /\bsrc\s*=\s*(?:"[^"]*"|'[^']*')/i,
        `src="/images/cnblogs/${path.basename(finalPath)}"`
      );
      if (replacement !== tag) result = result.split(tag).join(replacement);
    }
  }

  if (failed) console.warn(`       ⚠ ${failed} 张图片下载失败，保留远程地址`);
  return result;
}

async function retryExistingPostImages(existing, postId, imageOptions) {
  if (!hasFullContent(existing.content)) return false;
  let localized = await localizePostImages(existing.content, postId, imageOptions);
  if (localized === existing.content) return false;
  const frontmatter = parseFrontmatter(existing.content);
  // 图片重试不能把手改内容误认成上次导入的正文。
  if (frontmatterValue(frontmatter.raw, 'cnblogs_content_hash') === contentHash(frontmatter.body)) {
    const parsed = parseFrontmatter(localized);
    const raw = upsertFrontmatterField(parsed.raw, 'cnblogs_content_hash', yamlScalar(contentHash(parsed.body)));
    localized = renderExistingPost(localized, raw, parsed.body);
  }
  writeTextAtomically(existing.filepath, localized);
  console.log('       🖼 已最小替换远程图片引用\n');
  return true;
}

function writeTextAtomically(filepath, content) {
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  const tempPath = `${filepath}.part-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tempPath, content, 'utf8');
    fs.renameSync(tempPath, filepath);
  } catch (err) {
    try { fs.unlinkSync(tempPath); } catch { /* 忽略清理失败 */ }
    throw err;
  }
}

// ============================================================
//  主流程
// ============================================================

function newPostPath(item, postId, postsDir) {
  const dateStr = extractShanghaiDate(item.pubDate);
  if (!dateStr) throw new Error(`无效日期: ${item.pubDate || '(空)'}`);
  let filename = `${dateStr}-${postId}-${slugify(item.title)}.md`;
  let filepath = path.join(postsDir, filename);
  const hash = crypto.createHash('sha1').update(item.link).digest('hex').slice(0, 8);
  let suffix = 0;
  while (fs.existsSync(filepath)) {
    filename = `${dateStr}-${postId}-${hash}${suffix ? `-${suffix + 1}` : ''}-${slugify(item.title)}.md`;
    filepath = path.join(postsDir, filename);
    suffix++;
  }
  return filepath;
}

async function syncCnblogs(options = {}) {
  const postsDir = options.postsDir || POSTS_DIR;
  const imagesDir = options.imagesDir || IMAGES_DIR;
  const fetchRss = options.fetchRss || fetchWithRetry;
  const fetchPage = options.fetchPage || fetchWithRetry;
  const delayMs = options.delayMs ?? REQUEST_DELAY;

  console.log('════ 博客园同步 ════\n');
  console.log(`📡 获取 RSS: ${SOURCES.cnblogs.rss}`);
  const rssXml = await fetchRss(SOURCES.cnblogs.rss);
  if (!rssXml) {
    console.error('❌ 无法获取博客园 RSS');
    return { created: 0, updated: 0, skipped: 0, failed: 1 };
  }

  const items = parseFeed(rssXml);
  console.log(`📋 RSS 中有 ${items.length} 篇文章\n`);
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  fs.mkdirSync(postsDir, { recursive: true });

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    let itemFailed = false;
    const imageOptions = {
      imagesDir,
      downloadImage: options.downloadImage,
      onFailure() { itemFailed = true; },
    };
    console.log(`[${i + 1}/${items.length}] ${item.title}`);
    let existing = null;
    try {
      const postId = extractCnblogsPostId(item.link);
      if (!postId) {
        console.warn('       ⚠ 无法提取 postId，跳过');
        itemFailed = true;
        continue;
      }

      existing = findPostByCnblogsUrl(postId, postsDir, item.link);
      console.log(`       ⬇ 抓取全文: ${item.link}`);
      const pageHtml = await fetchPage(item.link);
      let body = null;
      if (pageHtml) {
        body = extractCnblogsBody(pageHtml);
        if (body) {
          console.log(`       ✓ 正文提取成功 (${body.length} 字符)`);
        } else {
          console.warn('       ⚠ 无法提取正文');
        }
      }

      if (!body) {
        itemFailed = true;
        if (existing) {
          if (await retryExistingPostImages(existing, postId, imageOptions)) updated++;
          console.warn('       ⚠ 无法抓取正文，保留已有正文\n');
          continue;
        }
        console.warn('       ⚠ 无法抓取正文，仅保存可重试的 RSS 占位\n');
      }

      // 远端哈希必须在本地化图片前计算，避免本地路径和下载状态造成假更新。
      const sourceHash = body ? contentHash(body) : null;
      if (existing && hasFullContent(existing.content)) {
        const frontmatter = parseFrontmatter(existing.content);
        if (frontmatterValue(frontmatter.raw, 'cnblogs_source_hash') === sourceHash) {
          if (await retryExistingPostImages(existing, postId, imageOptions)) {
            updated++;
          } else {
            if (!itemFailed) skipped++;
            console.log('       ⏭ 已核对，博客园正文未变化\n');
          }
          continue;
        }
        assertSafeFullUpdate(frontmatter, sourceHash);
      }
      if (body) body = await localizePostImages(body, postId, imageOptions);

      const postContent = existing
        ? buildUpdatedPostContent(existing.content, item, body, sourceHash)
        : buildCnblogsPost(item, body, sourceHash);
      const targetPath = existing ? existing.filepath : newPostPath(item, postId, postsDir);

      if (existing && postContent === existing.content) {
        if (!itemFailed) skipped++;
        continue;
      }
      writeTextAtomically(targetPath, postContent);
      if (existing) {
        updated++;
        console.log('       ✏ 已同步已有文章\n');
      } else {
        created++;
        console.log('       ✨ 新文章\n');
      }
    } catch (err) {
      itemFailed = true;
      console.error(`       ❌ 处理文章失败 (${existing ? existing.filename : item.link}): ${err.message}\n`);
    } finally {
      if (itemFailed) failed++;
      await sleep(delayMs);
    }
  }

  console.log(`✅ 博客园: 新增 ${created}, 更新 ${updated}, 跳过 ${skipped}, 失败 ${failed}\n`);
  return { created, updated, skipped, failed };
}

async function main() {
  console.log('🚀 开始同步外部文章...\n');
  const results = await syncCnblogs();
  const totalCreated = results.created;
  const totalUpdated = results.updated;
  const totalSkipped = results.skipped;
  const totalFailed = results.failed;

  console.log('═══════════════════════════════════');
  console.log('🎉 同步结束！');
  console.log(`   新创建: ${totalCreated}  更新: ${totalUpdated}  跳过: ${totalSkipped}  失败: ${totalFailed}`);
  console.log('═══════════════════════════════════');
  if (totalFailed > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(err => {
    console.error('同步失败:', err);
    process.exitCode = 1;
  });
}

module.exports = {
  buildCnblogsPost,
  buildUpdatedPostContent,
  contentHash,
  extractCnblogsBody,
  extractCnblogsPostId,
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
  slugify,
  syncCnblogs,
  validateImageBuffer,
};
