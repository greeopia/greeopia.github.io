(function(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else if (root && root.document) {
    api.install(root);
  }
})(typeof globalThis === 'undefined' ? this : globalThis, function() {
  'use strict';

  const ELEMENT_NODE = 1;
  const TEXT_NODE = 3;
  const IGNORED_TAGS = new Set([
    'code',
    'math',
    'noscript',
    'option',
    'pre',
    'script',
    'style',
    'svg',
    'template',
    'textarea'
  ]);
  const IGNORED_CLASSES = new Set([
    'highlight',
    'katex',
    'katex-display',
    'katex-mathml'
  ]);
  const DISPLAY_DELIMITERS = [
    { left: '$$', right: '$$' },
    { left: '\\[', right: '\\]' }
  ];
  const INLINE_DELIMITERS = [
    { left: '\\(', right: '\\)' }
  ];

  function isEscaped(text, index) {
    let backslashes = 0;
    while (index > 0 && text[index - 1] === '\\') {
      backslashes++;
      index--;
    }
    return backslashes % 2 === 1;
  }

  function findDelimitedEnd(text, delimiter, start) {
    let braces = 0;
    let index = start;
    while (index < text.length) {
      if (braces === 0 && text.startsWith(delimiter.right, index)
          && !isEscaped(text, index)) {
        return index;
      }
      if (text[index] === '\\') {
        index += 2;
        continue;
      }
      if (text[index] === '{') braces++;
      else if (text[index] === '}' && braces > 0) braces--;
      index++;
    }
    return -1;
  }

  function findDollarEnd(text, start) {
    let close = text.indexOf('$', start);
    while (close !== -1 && isEscaped(text, close)) {
      close = text.indexOf('$', close + 1);
    }
    if (close === -1) return -1;
    const previous = text[close - 1];
    const next = text[close + 1];
    if (previous === ' ' || previous === '\t' || /[0-9]/.test(next || '')) {
      return -1;
    }
    return close;
  }

  function matchDelimiter(text, index) {
    for (const delimiter of DISPLAY_DELIMITERS) {
      if (!text.startsWith(delimiter.left, index)
          || isEscaped(text, index)) continue;
      const end = findDelimitedEnd(text, delimiter, index + delimiter.left.length);
      if (end > index + delimiter.left.length) {
        return {
          end: end + delimiter.right.length,
          display: true,
          value: text.slice(index + delimiter.left.length, end)
        };
      }
    }

    for (const delimiter of INLINE_DELIMITERS) {
      if (!text.startsWith(delimiter.left, index) || isEscaped(text, index)) continue;
      const end = findDelimitedEnd(text, delimiter, index + delimiter.left.length);
      if (end > index + delimiter.left.length) {
        return {
          end: end + delimiter.right.length,
          display: false,
          value: text.slice(index + delimiter.left.length, end)
        };
      }
    }

    if (text[index] !== '$' || isEscaped(text, index)
        || text[index + 1] === '$') return null;
    const next = text[index + 1];
    if (!next || next === ' ' || next === '\t') return null;

    const end = findDollarEnd(text, index + 1);
    if (end === -1) return null;
    return {
      end: end + 1,
      display: false,
      value: text.slice(index + 1, end)
    };
  }

  // This mirrors markdown-it-katex's dollar delimiter checks: the opening
  // delimiter may not be followed by whitespace, and the closing delimiter
  // may not be preceded by whitespace or followed by a digit.
  function parseMathText(text) {
    const parts = [];
    let cursor = 0;
    let index = 0;

    while (index < text.length) {
      const match = matchDelimiter(text, index);
      if (!match) {
        index++;
        continue;
      }
      if (index > cursor) {
        parts.push({ type: 'text', value: text.slice(cursor, index) });
      }
      parts.push({ type: 'math', ...match });
      cursor = match.end;
      index = match.end;
    }

    if (cursor < text.length) {
      parts.push({ type: 'text', value: text.slice(cursor) });
    }
    return parts.some(part => part.type === 'math')
      ? parts
      : [{ type: 'text', value: text }];
  }

  function attributeValue(element, name) {
    if (typeof element.getAttribute === 'function') {
      const value = element.getAttribute(name);
      if (value != null) return value;
    }
    if (element.attributes) {
      for (const attribute of element.attributes) {
        if (attribute.name === name) return attribute.value;
      }
    }
    return null;
  }

  function elementName(element) {
    return String(element.nodeName || element.tagName || '').toLowerCase();
  }

  function shouldIgnoreElement(element) {
    if (IGNORED_TAGS.has(elementName(element))
        || attributeValue(element, 'data-math-literal-dollar') != null) {
      return true;
    }
    if (attributeValue(element, 'data-math-rendered') != null) return true;
    const className = attributeValue(element, 'class')
      || (typeof element.className === 'string' ? element.className : '');
    return className.split(/\s+/).some(name => IGNORED_CLASSES.has(name));
  }

  function collectMathNodes(container) {
    const plans = [];

    function visit(node) {
      if (node.nodeType === TEXT_NODE) {
        const parts = parseMathText(node.textContent || node.nodeValue || '');
        if (parts.some(part => part.type === 'math')) {
          plans.push({ node, parts });
        }
        return;
      }
      if (node.nodeType !== ELEMENT_NODE || shouldIgnoreElement(node)) return;
      for (const child of Array.from(node.childNodes || [])) visit(child);
    }

    visit(container);
    return plans;
  }

  function createRuntime(window, options) {
    const settings = options || {};
    const document = window && window.document;
    if (!document) return null;

    const currentScript = settings.currentScript || document.currentScript;
    const configuredUrl = settings.katexUrl
      || (currentScript && currentScript.getAttribute
        && currentScript.getAttribute('data-math-katex-src'));
    const currentSource = (currentScript && currentScript.src) || '';
    const derivedUrl = currentSource.replace(/\/js\/render-math\.js(?:\?.*)?$/, '/assets/katex/katex.min.js');
    const katexUrl = configuredUrl || (derivedUrl !== currentSource
      ? derivedUrl
      : '/assets/katex/katex.min.js');
    let loader = null;
    let running = false;

    function loadKatex() {
      if (window.katex) return Promise.resolve(window.katex);
      if (loader) return loader;

      loader = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = katexUrl;
        script.async = true;
        if (typeof script.setAttribute === 'function') {
          script.setAttribute('data-math-katex-heavy', '');
        }
        script.onload = () => {
          if (window.katex) resolve(window.katex);
          else reject(new Error('KaTeX loaded without exposing window.katex'));
        };
        script.onerror = () => reject(new Error(`Failed to load ${katexUrl}`));
        (document.head || document.body || document.documentElement).appendChild(script);
      }).catch(error => {
        loader = null;
        throw error;
      });
      return loader;
    }

    function replaceTextNode(plan, katex) {
      const node = plan.node;
      if (!node.parentNode) return false;
      const fragment = document.createDocumentFragment();
      for (const part of plan.parts) {
        if (part.type === 'text') {
          fragment.appendChild(document.createTextNode(part.value));
          continue;
        }
        const span = document.createElement('span');
        if (typeof span.setAttribute === 'function') {
          span.setAttribute('data-math-rendered', '');
        }
        katex.render(part.value, span, {
          displayMode: part.display,
          strict: 'ignore',
          throwOnError: false
        });
        fragment.appendChild(span);
      }
      node.parentNode.replaceChild(fragment, node);
      return true;
    }

    async function render() {
      if (running) return false;
      const plans = [];
      for (const postBody of Array.from(document.querySelectorAll('.post-body'))) {
        plans.push(...collectMathNodes(postBody));
      }
      if (plans.length === 0) return false;

      running = true;
      try {
        const katex = await loadKatex();
        let changed = false;
        for (const plan of plans) changed = replaceTextNode(plan, katex) || changed;
        return changed;
      } catch (error) {
        if (window.console && typeof window.console.error === 'function') {
          window.console.error(error);
        }
        return false;
      } finally {
        running = false;
      }
    }

    return { loadKatex, parseMathText, render };
  }

  function install(window) {
    if (window.__mathPageRenderer) return window.__mathPageRenderer;
    const runtime = createRuntime(window);
    if (!runtime) return null;
    window.__mathPageRenderer = runtime;

    const run = () => runtime.render();
    window.document.addEventListener('DOMContentLoaded', run);
    window.document.addEventListener('page:loaded', run);
    if (window.document.readyState !== 'loading') {
      Promise.resolve().then(run);
    }
    return runtime;
  }

  return { createRuntime, install, parseMathText };
});
