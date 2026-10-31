/* global hexo */
'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const MarkdownIt = require('markdown-it');
const { escapeHTML } = require('hexo-util');

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
  'meta', 'param', 'source', 'track', 'wbr'
]);
const RAW_TEXT_ELEMENTS = new Set([
  'hexopostrendercodeblock',
  'iframe',
  'noembed',
  'noframes',
  'script',
  'style',
  'textarea',
  'title',
  'xmp'
]);
const CODE_CONTAINER_ELEMENTS = new Set(['code', 'template']);
const TEMPLATE_DELIMITERS = [
  ['{{', '}}'],
  ['{%', '%}'],
  ['{#', '#}']
];

// Only block tokens are needed: inline examples, fences and indented code
// must never become candidates, including inside lists and blockquotes.
const contextParser = new MarkdownIt({ html: true });
contextParser.core.ruler.enableOnly(['normalize', 'block']);

function blankRange(chars, start, end) {
  for (let index = start; index < end; index++) {
    if (chars[index] !== '\n' && chars[index] !== '\r') chars[index] = ' ';
  }
}

function parseTag(source, start) {
  if (source[start] !== '<') return null;
  if (source.startsWith('<!--', start)) {
    const end = source.indexOf('-->', start + 4);
    return end === -1
      ? { closing: false, end: source.length, name: '' }
      : { closing: false, end: end + 3, name: '' };
  }
  if (source.startsWith('<![CDATA[', start)) {
    const end = source.indexOf(']]>', start + 9);
    return end === -1
      ? { closing: false, end: source.length, name: '' }
      : { closing: false, end: end + 3, name: '' };
  }

  let index = start + 1;
  let closing = false;
  if (source[index] === '/') {
    closing = true;
    index++;
  }
  if (source[index] === '!' || source[index] === '?') {
    const end = source.indexOf('>', index + 1);
    return end === -1 ? null : { closing: false, end: end + 1, name: '' };
  }

  const nameStart = index;
  while (/[A-Za-z0-9:-]/.test(source[index] || '')) index++;
  if (index === nameStart) return null;

  const name = source.slice(nameStart, index).toLowerCase();
  let quote = null;
  while (index < source.length) {
    const char = source[index];
    if (quote) {
      if (char === '\\') {
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      const selfClosing = VOID_ELEMENTS.has(name) || /\/\s*$/.test(source.slice(nameStart, index));
      return { closing, end: index + 1, name, selfClosing };
    }
    index++;
  }
  return null;
}

function findRawTextEnd(source, name, start) {
  // HTML raw text ends at the first matching end tag. Same-name opening
  // tags inside JavaScript/CSS strings do not introduce nested elements.
  const closing = new RegExp(`</${name}\\s*>`, 'ig');
  closing.lastIndex = start;
  return closing.exec(source) ? closing.lastIndex : null;
}

function findElementEnd(source, name, start) {
  let depth = 1;
  let index = start;
  while (index < source.length) {
    const tagStart = source.indexOf('<', index);
    if (tagStart === -1) return null;
    const tag = parseTag(source, tagStart);
    if (!tag) {
      index = tagStart + 1;
      continue;
    }
    if (tag.name === name) {
      if (tag.closing) depth--;
      else if (!tag.selfClosing) depth++;
      if (depth === 0) return tag.end;
    } else if (!tag.closing && !tag.selfClosing && RAW_TEXT_ELEMENTS.has(tag.name)) {
      const end = findRawTextEnd(source, tag.name, tag.end);
      if (end === null) return null;
      index = end;
      continue;
    }
    index = tag.end;
  }
  return null;
}

function findTemplateEnd(source, start, opening, closing) {
  if (opening === '{#') {
    const end = source.indexOf(closing, start + 2);
    return end === -1 ? source.length : end + closing.length;
  }

  let quote = null;
  let index = start + 2;
  while (index < source.length) {
    const char = source[index];
    if (quote) {
      if (char === '\\') {
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (source.startsWith(closing, index)) {
      return index + closing.length;
    }
    index++;
  }
  return source.length;
}

// Preserve positions so the original source can still be passed to the
// highlighter. Hide template expressions before Markdown classifies blocks,
// so HTML inside a Nunjucks string cannot start or end a real HTML block.
function maskTemplateContexts(source) {
  const chars = source.split('');
  let index = 0;

  while (index < source.length) {
    const delimiter = TEMPLATE_DELIMITERS.find(([opening]) => (
      source.startsWith(opening, index)
    ));
    if (delimiter) {
      const end = findTemplateEnd(source, index, delimiter[0], delimiter[1]);
      blankRange(chars, index, end);
      index = end;
      continue;
    }

    if (source[index] === '<') {
      const tag = parseTag(source, index);
      if (tag && !tag.closing && !tag.selfClosing) {
        if (RAW_TEXT_ELEMENTS.has(tag.name)) {
          index = findRawTextEnd(source, tag.name, tag.end) ?? source.length;
          continue;
        }
        // Leave template syntax inside code literal, even if it is incomplete.
        if (tag.name === 'pre' || CODE_CONTAINER_ELEMENTS.has(tag.name)) {
          index = findElementEnd(source, tag.name, tag.end) ?? source.length;
          continue;
        }
      }
      if (tag) {
        index = tag.end;
        continue;
      }
    }

    index++;
  }

  return chars.join('');
}

function findCodePreBlocksInHtml(source, start, end) {
  const blocks = [];
  let index = start;

  while (index < end) {
    const tagStart = source.indexOf('<', index);
    if (tagStart === -1 || tagStart >= end) break;
    const tag = parseTag(source, tagStart);
    if (!tag) {
      index = tagStart + 1;
      continue;
    }

    if (!tag.closing && !tag.selfClosing) {
      if (RAW_TEXT_ELEMENTS.has(tag.name)) {
        index = findRawTextEnd(source, tag.name, tag.end) ?? source.length;
        continue;
      }
      // Ordinary containers and void tags need no search for a closing tag.
      if (tag.name === 'pre' || CODE_CONTAINER_ELEMENTS.has(tag.name)) {
        const elementEnd = findElementEnd(source, tag.name, tag.end);
        if (elementEnd === null) {
          index = source.length;
          break;
        }
        if (tag.name === 'pre') {
          blocks.push({ start: tagStart, end: elementEnd });
        }
        index = elementEnd;
        continue;
      }
    }
    index = tag.end;
  }

  return { blocks, end: Math.max(index, end) };
}

function findCodePreBlocks(source) {
  const lineOffsets = [0];
  for (const match of source.matchAll(/\r\n?|\n/g)) {
    lineOffsets.push(match.index + match[0].length);
  }

  const blocks = [];
  let cursor = 0;
  for (const token of contextParser.parse(source, {})) {
    if (token.type !== 'html_block') continue;
    const start = Math.max(cursor, lineOffsets[token.map[0]]);
    const end = lineOffsets[token.map[1]] ?? source.length;
    if (start >= end) continue;
    // A pre element can begin inside a larger HTML block, whose Markdown
    // token stops at a blank line inside the code. Keep the whole element
    // once its opening tag is known to be in HTML, and skip overlapping maps.
    const result = findCodePreBlocksInHtml(source, start, end);
    blocks.push(...result.blocks);
    cursor = result.end;
  }
  return blocks;
}

function importedCodeDetails(source) {
  const $ = cheerio.load(source, {}, false);
  const pre = $('pre').first();
  if (!pre.length) return null;

  const contents = pre.contents().toArray().filter(node => (
    node.type !== 'text' || node.data.trim()
  ));
  if (contents.length !== 1
      || contents[0].type !== 'tag'
      || contents[0].name !== 'code') {
    return null;
  }

  const code = $(contents[0]);
  code.find('br').replaceWith('\n');
  const classes = `${code.attr('class') || ''} ${pre.attr('class') || ''}`;
  return {
    classes,
    text: code.text()
  };
}

hexo.extend.filter.register('before_post_render', function(data) {
  const masked = maskTemplateContexts(data.content);
  const blocks = findCodePreBlocks(masked);
  if (!blocks.length) return data;

  let cursor = 0;
  let output = '';
  for (const block of blocks) {
    output += data.content.slice(cursor, block.start);
    const original = data.content.slice(block.start, block.end);
    const details = importedCodeDetails(original);
    if (!details) {
      output += original;
      cursor = block.end;
      continue;
    }

    const language = details.classes.match(/(?:^|\s)(?:language-|lang-)([\w.+-]+)/i);
    const highlighter = this.config.syntax_highlighter;
    const html = this.extend.highlight.query(highlighter)
      ? this.extend.highlight.exec(highlighter, {
        context: this,
        args: [details.text, {
          lang: language && language[1],
          lines_length: details.text.split('\n').length
        }]
      })
      : `<pre><code>${escapeHTML(details.text)}</code></pre>`;

    // Use Hexo's own escape mechanism: neither Markdown nor Nunjucks should
    // interpret comments, operators, quotes, or template syntax inside code.
    output += '<hexoPostRenderCodeBlock>'
      + html.replace(/{/g, '&#123;').replace(/}/g, '&#125;')
      + '</hexoPostRenderCodeBlock>';
    cursor = block.end;
  }
  output += data.content.slice(cursor);
  data.content = output;
  return data;
}, 20);

// Serve the installed KaTeX version and its fonts locally; no runtime CDN is
// needed, including for formulas embedded in imported HTML paragraphs.
hexo.extend.generator.register('math-assets', function() {
  const dist = path.dirname(require.resolve('katex/dist/katex.min.css'));
  const files = ['katex.min.css', 'katex.min.js'];
  files.push(...fs.readdirSync(path.join(dist, 'fonts')).map(name => `fonts/${name}`));
  return files.map(file => ({
    path: `assets/katex/${file}`,
    data: () => fs.createReadStream(path.join(dist, file))
  }));
});
