/* global hexo */
'use strict';

const RAW_TEXT_ELEMENTS = new Set([
  'iframe',
  'noembed',
  'noframes',
  'script',
  'style',
  'template',
  'textarea',
  'title',
  'xmp'
]);
const SKIPPED_CONTENT_ELEMENTS = new Set(['code', 'pre']);
const STYLE_MARKER = 'data-math-page-asset="style"';
const RUNTIME_MARKER = 'data-math-page-asset="runtime"';

function parseTag(source, start) {
  if (source[start] !== '<') return null;
  if (source.startsWith('<!--', start)) {
    const close = source.indexOf('-->', start + 4);
    return {
      closing: false,
      end: close === -1 ? source.length : close + 3,
      name: ''
    };
  }

  let index = start + 1;
  let closing = false;
  if (source[index] === '/') {
    closing = true;
    index++;
  }
  if (source[index] === '!' || source[index] === '?') {
    const end = source.indexOf('>', index + 1);
    return end === -1 ? null : {
      closing: false,
      end: end + 1,
      name: ''
    };
  }

  const nameStart = index;
  while (/[A-Za-z0-9:-]/.test(source[index] || '')) index++;
  if (index === nameStart) return null;
  const name = source.slice(nameStart, index).toLowerCase();
  const attributesStart = index;
  let quote = null;
  while (index < source.length) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return {
        attributes: source.slice(attributesStart, index),
        closing,
        end: index + 1,
        name,
        selfClosing: /\/\s*$/.test(source.slice(attributesStart, index))
      };
    }
    index++;
  }
  return null;
}

function findClosingTag(source, name, start) {
  let index = start;
  while (index < source.length) {
    const tagStart = source.indexOf('</', index);
    if (tagStart === -1) return -1;
    const tag = parseTag(source, tagStart);
    if (tag && tag.closing && tag.name === name) return tag.end;
    index = tagStart + 2;
  }
  return -1;
}

function attributesOf(tag) {
  const attributes = new Map();
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = pattern.exec(tag.attributes || ''))) {
    attributes.set(
      match[1].toLowerCase(),
      match[2] ?? match[3] ?? match[4] ?? ''
    );
  }
  return attributes;
}

function hasClass(attributes, className) {
  return (attributes.get('class') || '').split(/\s+/).includes(className);
}

function inspectFullPage(source) {
  let index = 0;
  if (source.charCodeAt(0) === 0xFEFF) index = 1;

  let html = null;
  while (index < source.length) {
    while (/\s/.test(source[index] || '')) index++;
    if (source.startsWith('<!--', index)) {
      const comment = parseTag(source, index);
      if (!comment) return null;
      index = comment.end;
      continue;
    }
    const tag = parseTag(source, index);
    if (!tag) return null;
    if (tag.name) {
      if (tag.name === 'html' && !tag.closing) html = tag;
      break;
    }
    index = tag.end;
  }
  if (!html) return null;

  const result = {
    bodyEnd: -1,
    hasPostBody: false,
    headEnd: -1,
    htmlClosed: false,
    runtimePresent: false,
    stylePresent: false
  };
  let inBody = false;
  index = html.end;

  while (index < source.length) {
    const tagStart = source.indexOf('<', index);
    if (tagStart === -1) break;
    const tag = parseTag(source, tagStart);
    if (!tag) {
      index = tagStart + 1;
      continue;
    }

    if (!tag.name) {
      index = tag.end;
      continue;
    }

    const attributes = attributesOf(tag);
    if (!tag.closing && attributes.has('data-math-page-asset')) {
      if (attributes.get('data-math-page-asset') === 'style') {
        result.stylePresent = true;
      } else if (attributes.get('data-math-page-asset') === 'runtime') {
        result.runtimePresent = true;
      }
    }

    if (!tag.closing && (RAW_TEXT_ELEMENTS.has(tag.name)
        || SKIPPED_CONTENT_ELEMENTS.has(tag.name))) {
      const close = findClosingTag(source, tag.name, tag.end);
      index = close === -1 ? source.length : close;
      continue;
    }

    if (tag.closing) {
      if (tag.name === 'html') {
        result.htmlClosed = true;
      } else if (tag.name === 'head' && result.headEnd === -1) {
        result.headEnd = tagStart;
      } else if (tag.name === 'body' && result.bodyEnd === -1) {
        result.bodyEnd = tagStart;
        inBody = false;
      }
      index = tag.end;
      continue;
    }

    if (tag.name === 'body') inBody = true;
    if (inBody && hasClass(attributes, 'post-body')) result.hasPostBody = true;
    index = tag.end;
  }

  return result.htmlClosed ? result : null;
}

function normalizeRoot(root) {
  let value = String(root || '/').trim().replace(/\\/g, '/');
  if (!value.startsWith('/')) value = `/${value}`;
  if (!value.endsWith('/')) value = `${value}/`;
  return value;
}

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}

function installMarkdownEscapedDollar(md) {
  if (md.__mathEscapedDollarInstalled) return;
  md.__mathEscapedDollarInstalled = true;

  md.inline.ruler.before('escape', 'math_escaped_dollar', function(state, silent) {
    if (state.src[state.pos] !== '\\' || state.src[state.pos + 1] !== '$') {
      return false;
    }
    if (!silent) {
      const token = state.push('math_escaped_dollar', 'span', 0);
      token.content = '$';
      token.markup = '\\$';
    }
    state.pos += 2;
    return true;
  });

  md.renderer.rules.math_escaped_dollar = function(tokens, index, options, env, renderer) {
    const content = renderer.utils && typeof renderer.utils.escapeHtml === 'function'
      ? renderer.utils.escapeHtml(tokens[index].content)
      : '$';
    return `<span data-math-literal-dollar>${content}</span>`;
  };
}

hexo.extend.filter.register('markdown-it:renderer', installMarkdownEscapedDollar);

function injectMathPageAssets(page) {
  const info = inspectFullPage(page);
  if (!info || !info.hasPostBody
      || info.headEnd === -1 || info.bodyEnd === -1
      || (info.stylePresent && info.runtimePresent)) {
    return page;
  }

  const root = normalizeRoot(this && this.config && this.config.root);
  const styleUrl = `${root}assets/katex/katex.min.css`;
  const runtimeUrl = `${root}js/render-math.js`;
  const katexUrl = `${root}assets/katex/katex.min.js`;
  const styleTag = `\n<link rel="stylesheet" href="${escapeAttribute(styleUrl)}" ${STYLE_MARKER}>`;
  const runtimeTag = `\n<script defer src="${escapeAttribute(runtimeUrl)}" `
    + `${RUNTIME_MARKER} data-math-katex-src="${escapeAttribute(katexUrl)}"></script>`;

  let output = page;
  if (!info.runtimePresent) {
    output = output.slice(0, info.bodyEnd) + runtimeTag + output.slice(info.bodyEnd);
  }
  if (!info.stylePresent) {
    output = output.slice(0, info.headEnd) + styleTag + output.slice(info.headEnd);
  }
  return output;
}

hexo.extend.filter.register('after_render:html', injectMathPageAssets, 50);
