/**
 * sync-posts.js — 从博客园自动拉取文章到 Hexo
 *
 * 博客园：RSS 获取文章列表 → 逐篇抓取全文（#cnblogs_post_body）
 *
 * 去重：通过 frontmatter 中的 cnblogs_url 匹配已有文件
 * 更新：已有文章如果正文为空或与原文不一致，自动更新为全文
 * 图片：正文中的远程图片自动下载到 source/images/cnblogs/，并把引用改写为本地路径
 *
 * 用法：node tools/sync-posts.js
 * GitHub Actions 每天 UTC 20:00（北京时间次日 04:00）自动执行
 */

const fs = require('fs');
const path = require('path');

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

// ============================================================
//  工具函数
// ============================================================

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchWithRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) return await res.text();
      console.warn(`  ⚠ HTTP ${res.status} (第 ${i + 1}/${retries} 次)`);
    } catch (e) {
      console.warn(`  ⚠ 请求失败: ${e.message} (第 ${i + 1}/${retries} 次)`);
    }
    if (i < retries - 1) await sleep(1000 * (i + 1));
  }
  return null;
}

function extractXmlTag(xml, tag) {
  const regex = new RegExp(
    `<${tag}[^>]*>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*<\\/${tag}>`,
    'i'
  );
  const m = xml.match(regex);
  return m ? (m[1] || m[2] || '').trim() : '';
}

function extractXmlAttr(xml, tag, attr) {
  const regex = new RegExp(`<${tag}[^>]*${attr}\\s*=\\s*"([^"]*)"[^>]*/?>`, 'i');
  const m = xml.match(regex);
  return m ? m[1] : '';
}

function parseAtomFeed(xml) {
  const items = [];
  const re = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const entry = m[1];
    const title = extractXmlTag(entry, 'title');
    let link = extractXmlAttr(entry, 'link', 'href') || extractXmlTag(entry, 'id');
    const pubDate = extractXmlTag(entry, 'published') || extractXmlTag(entry, 'updated');
    const summary = extractXmlTag(entry, 'summary');
    const content = extractXmlTag(entry, 'content') || summary;
    const categories = [];
    const catRe = /<category[^>]*term\s*=\s*"([^"]*)"[^>]*\/?>/g;
    let cm;
    while ((cm = catRe.exec(entry)) !== null) categories.push(cm[1]);
    if (title && link) items.push({ title, link, pubDate, content, categories });
  }
  return items;
}

function parseRssFeed(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const item = m[1];
    const title = extractXmlTag(item, 'title');
    const link = extractXmlTag(item, 'link');
    const pubDate = extractXmlTag(item, 'pubDate');
    const description = extractXmlTag(item, 'description');
    const contentEncoded = extractXmlTag(item, 'content:encoded') || description;
    const categories = [];
    const catRe = /<category>([\s\S]*?)<\/category>/g;
    let cm;
    while ((cm = catRe.exec(item)) !== null) categories.push(cm[1].trim());
    if (title && link) items.push({ title, link, pubDate, content: contentEncoded, categories });
  }
  return items;
}

function parseFeed(xml) {
  if (xml.includes('<entry>')) return parseAtomFeed(xml);
  return parseRssFeed(xml);
}

function extractCnblogsPostId(url) {
  // 随笔: /p/123456  文章: /articles/123456
  const m = url.match(/\/(?:p|articles)\/(\d+)/);
  return m ? m[1] : null;
}

function slugify(title, maxLen = 50) {
  return title
    .replace(/[【】《》？?！!，,。.：:；、""''（）()\[\]{}]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[\/\\:*?"<>|]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLen)
    || 'untitled';
}

function generateExcerpt(html, maxLen = 300) {
  let text = html
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

function formatDate(dateStr) {
  if (!dateStr) return new Date().toISOString().replace('T', ' ').substring(0, 19);
  // 处理 HTML 实体和超长小数秒
  const cleaned = dateStr.replace(/&#x2B;/gi, '+').replace(/\.(\d{3})\d+/, '.$1');
  const d = new Date(cleaned);
  if (isNaN(d.getTime())) return new Date().toISOString().replace('T', ' ').substring(0, 19);
  // 转换为本地时间字符串（东八区）
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().replace('T', ' ').substring(0, 19);
}
function extractLocalDate(dateStr) {
  // 从带时区的日期字符串直接提取本地日期部分
  if (!dateStr) return new Date().toISOString().split('T')[0];
  const cleaned = dateStr.replace(/&#x2B;/gi, '+');
  const m = cleaned.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : new Date().toISOString().split('T')[0];
}

// ============================================================
//  去重
// ============================================================

function findPostByCnblogsUrl(postId) {
  if (!fs.existsSync(POSTS_DIR)) return null;
  const editUrlPosts = `https://i.cnblogs.com/posts/edit;postId=${postId}`;
  const editUrlArticles = `https://i.cnblogs.com/articles/edit;postId=${postId}`;
  const essayUrl = `https://www.cnblogs.com/${SOURCES.cnblogs.username}/p/${postId}`;
  const articleUrl = `https://www.cnblogs.com/${SOURCES.cnblogs.username}/articles/${postId}`;

  for (const f of fs.readdirSync(POSTS_DIR)) {
    if (!f.endsWith('.md')) continue;
    const filepath = path.join(POSTS_DIR, f);
    const content = fs.readFileSync(filepath, 'utf-8');
    if (content.includes(editUrlPosts) || content.includes(editUrlArticles) || content.includes(essayUrl) || content.includes(articleUrl)) {
      return { filename: f, filepath, content };
    }
  }
  return null;
}

function hasFullContent(postContent) {
  if (postContent.includes('[阅读原文]') || postContent.includes('点击阅读原文')) return false;
  if (postContent.includes('<!-- more -->')) return true;
  const parts = postContent.split('---');
  const body = parts.length >= 3 ? parts.slice(2).join('---').trim() : postContent.trim();
  return body.length > 200;
}

// ============================================================
//  博客园
// ============================================================

function extractCnblogsBody(html) {
  const startMatch = html.match(/<div[^>]*id="cnblogs_post_body"[^>]*>/);
  if (!startMatch) return null;

  const startIdx = startMatch.index + startMatch[0].length;
  const rest = html.substring(startIdx);
  const endMatch = rest.match(/<div[^>]*id="blog_post_info_block"[^>]*>/);
  const endIdx = endMatch ? startIdx + endMatch.index : html.length;

  let content = html.substring(startIdx, endIdx);

  content = content.replace(
    /(?:\s*<\/div>\s*|\s*<div[^>]*class="clear"[^>]*><\/div>\s*)+$/,
    ''
  );

  content = content.replace(
    /(src|href)="(\/[^"]+)"/g,
    (_, attr, rel) => rel.startsWith('//')
     ? `${attr}="https:${rel}"`
     : `${attr}="https://www.cnblogs.com${rel}"`
  );

  // 博客园图片懒加载：data-src / data-original → src
  content = content.replace(/<img([^>]*?)data-src="([^"]+)"([^>]*?)>/g, '<img$1src="$2"$3>');
  content = content.replace(/<img([^>]*?)data-original="([^"]+)"([^>]*?)>/g, '<img$1src="$2"$3>');

  return content.trim() || null;
}

// 正文里是否还残留博客园远程图片（用于判断已有文章是否需要回填本地图片）
function hasRemoteCnblogsImages(content) {
  return /(?:src|href)\s*=\s*["'](?:https?:)?\/\/(?:img\d*|images?|pic)\.cnblogs\.com\//i.test(content);
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 由图片 URL 生成稳定的本地文件名：<postId>-<URL 文件名>
function imageFilename(url, postId) {
  try {
    const u = new URL(url);
    const base = decodeURIComponent(path.posix.basename(u.pathname));
    const ext = path.posix.extname(base).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) return null;
    const stem = path.posix
      .basename(base, ext)
      .replace(/[^\w.-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80);
    if (!stem) return null;
    return `${postId}-${stem}${ext}`;
  } catch (e) {
    return null;
  }
}

async function downloadImage(url, destPath, retries = 2) {
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Referer: 'https://www.cnblogs.com/',
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) {
        console.warn(`         ⚠ 图片 HTTP ${res.status}: ${url}`);
      } else {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 0) {
          fs.writeFileSync(destPath, buf);
          return true;
        }
      }
    } catch (e) {
      console.warn(`         ⚠ 图片下载失败: ${e.message} — ${url}`);
    }
    if (i < retries - 1) await sleep(800 * (i + 1));
  }
  return false;
}

// 把正文 HTML 中的远程图片下载到 source/images/cnblogs/ 并改写为本地引用
async function localizePostImages(html, postId) {
  if (!html) return html;

  const tags = [...html.matchAll(/<img\b[^>]*>/gi)].map(m => m[0]);
  if (tags.length === 0) return html;

  fs.mkdirSync(IMAGES_DIR, { recursive: true });

  let localized = 0;
  let failed = 0;
  const processed = new Set();

  for (const tag of tags) {
    const srcMatch = tag.match(/\bsrc\s*=\s*"([^"]+)"/i) || tag.match(/\bsrc\s*=\s*'([^']+)'/i);
    if (!srcMatch) continue;

    let url = srcMatch[1].replace(/&amp;/g, '&');
    if (url.startsWith('//')) url = 'https:' + url;
    else if (!/^https?:\/\//i.test(url)) continue; // data: 或相对路径，不处理
    if (processed.has(url)) continue;
    processed.add(url);

    const filename = imageFilename(url, postId);
    if (!filename) continue;

    const destPath = path.join(IMAGES_DIR, filename);
    if (!fs.existsSync(destPath)) {
      const ok = await downloadImage(url, destPath);
      if (!ok) {
        failed++;
        continue;
      }
      await sleep(150);
    }

    const srcQuote = srcMatch[0][srcMatch[0].length - 1];
    const newSrc = `src=${srcQuote}/images/cnblogs/${filename}${srcQuote}`;
    const replacementTag = tag.replace(new RegExp(`src\\s*=\\s*${srcQuote}${escapeRegExp(srcMatch[1])}${srcQuote}`, 'i'), newSrc);
    html = html.split(tag).join(replacementTag);
    localized++;
  }

  if (localized > 0) {
    const extra = failed > 0 ? `，${failed} 张失败保留远程地址` : '';
    console.log(`       🖼 图片本地化 ${localized} 张 → source/images/cnblogs/${extra}`);
  } else if (failed > 0) {
    console.log(`       ⚠ ${failed} 张图片下载失败，保留远程地址`);
  }

  return html;
}

async function syncCnblogs() {
  console.log('════ 博客园同步 ════\n');

  console.log(`📡 获取 RSS: ${SOURCES.cnblogs.rss}`);
  const rssXml = await fetchWithRetry(SOURCES.cnblogs.rss);
  if (!rssXml) {
    console.error('❌ 无法获取博客园 RSS');
    return { created: 0, updated: 0, skipped: 0 };
  }

  const items = parseFeed(rssXml);
  console.log(`📋 RSS 中有 ${items.length} 篇文章\n`);

  let created = 0, updated = 0, skipped = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const progress = `[${i + 1}/${items.length}]`;
    console.log(`${progress} ${item.title}`);

    const postId = extractCnblogsPostId(item.link);
    if (!postId) {
      console.log(`       ⚠ 无法提取 postId，跳过\n`);
      skipped++;
      continue;
    }

    const existing = findPostByCnblogsUrl(postId);

    // 已有全文且图片已本地化 → 跳过；
    // 已有全文但还残留博客园远程图片 → 重新抓取并回填本地图片。
    if (existing && hasFullContent(existing.content) && !hasRemoteCnblogsImages(existing.content)) {
      console.log(`       ⏭ 已有全文，跳过\n`);
      skipped++;
      continue;
    }

    console.log(`       ⬇ 抓取全文: ${item.link}`);
    const pageHtml = await fetchWithRetry(item.link);
    let body = null;
    if (pageHtml) {
      body = extractCnblogsBody(pageHtml);
      if (body) {
        body = await localizePostImages(body, postId);
        console.log(`       ✓ 正文提取成功 (${body.length} 字符)`);
      } else {
        console.log(`       ⚠ 无法提取正文`);
      }
    }

    // 已存在的文章抓取失败时，保留原文件，避免覆盖成摘要
    if (!body && existing) {
      console.log(`       ⚠ 无法抓取正文，保留已有文件\n`);
      skipped++;
      await sleep(REQUEST_DELAY);
      continue;
    }

    const postContent = buildCnblogsPost(item, body, postId);

    let targetPath;
    if (existing) {
      targetPath = existing.filepath;
      updated++;
      console.log(`       ✏ 更新已有文章`);
    } else {
      const dateStr = new Date(item.pubDate).toISOString().split('T')[0];
      const filename = `${dateStr}-${slugify(item.title)}.md`;
      targetPath = path.join(POSTS_DIR, filename);
      created++;
      console.log(`       ✨ 新文章`);
    }

    fs.writeFileSync(targetPath, postContent, 'utf-8');
    console.log('');

    await sleep(REQUEST_DELAY);
  }

  console.log(`✅ 博客园: 新增 ${created}, 更新 ${updated}, 跳过 ${skipped}\n`);
  return { created, updated, skipped };
}

function buildCnblogsPost(item, body, postId) {
  const allLabels = (item.categories || []).filter(l => l.trim());
  // 博客园标签映射为 Hexo tags
  const categories = ['博客园'];
  const tags = allLabels;

  let tagsYaml = 'tags: []';
  if (tags.length > 0) {
    tagsYaml = 'tags:\n' + tags.map(t => `  - ${t}`).join('\n');
  }

  let categoriesYaml = '';
  if (categories.length > 0) {
    categoriesYaml = '\ncategories:\n'
      + categories.map(c => `  - ${c}`).join('\n');
  }

  const dateStr = formatDate(item.pubDate);
  const cnblogsUrl = item.link;

  let bodyContent;
  if (body) {
    const excerpt = generateExcerpt(body);
    bodyContent = `${excerpt}\n<!-- more -->\n\n${body}`;
  } else {
    const desc = item.content || '';
    const excerpt = generateExcerpt(desc);
    bodyContent = `${excerpt}\n<!-- more -->\n\n> 原文地址: [${item.title}](${item.link})`;
    console.log(`       ⚠ 使用 RSS 摘要作为正文`);
  }

  return `---
title: ${item.title}
${tagsYaml}${categoriesYaml}
date: ${dateStr}
cnblogs_url: ${cnblogsUrl}
---

${bodyContent}
`;
}

// ============================================================
//  主流程
// ============================================================

async function main() {
  console.log('🚀 开始同步外部文章...\n');

  if (!fs.existsSync(POSTS_DIR)) {
    fs.mkdirSync(POSTS_DIR, { recursive: true });
  }

  const results = {};

  if (SOURCES.cnblogs.enabled) {
    try {
      results.cnblogs = await syncCnblogs();
    } catch (err) {
      console.error(`❌ 博客园同步失败: ${err.message}`);
      results.cnblogs = { created: 0, updated: 0, skipped: 0, error: err.message };
    }
  }

  const totalCreated = results.cnblogs?.created || 0;
  const totalUpdated = results.cnblogs?.updated || 0;
  const totalSkipped = results.cnblogs?.skipped || 0;

  console.log('═══════════════════════════════════');
  console.log(`🎉 同步完成！`);
  console.log(`   新创建: ${totalCreated}  更新: ${totalUpdated}  跳过: ${totalSkipped}`);
  console.log('═══════════════════════════════════');
}

main().catch(err => {
  console.error('同步失败:', err);
  process.exit(1);
});
