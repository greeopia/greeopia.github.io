'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const cheerio = require('cheerio');
const Hexo = require('hexo');
const {
  createRuntime,
  install,
  parseMathText
} = require('../../source/js/render-math');

const root = path.resolve(__dirname, '../..');
let site;

before(async () => {
  site = new Hexo(root, { silent: true });
  await site.init();
});

function mathParts(text) {
  return parseMathText(text).filter(part => part.type === 'math');
}

function fullPage(body, head = '') {
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    `<head>${head}</head>`,
    `<body>${body}</body>`,
    '</html>'
  ].join('');
}

function pageFilter() {
  const filter = site.extend.filter.list('_after_html_render')
    .find(candidate => candidate.name === 'injectMathPageAssets');
  assert.ok(filter, 'math page asset filter should be registered');
  return filter;
}

function inject(html, rootPath = '/blog/') {
  return pageFilter().call({ config: { root: rootPath } }, html);
}

class TestNode {
  constructor(nodeType, name = '', text = '') {
    this.nodeType = nodeType;
    this.nodeName = name.toUpperCase();
    this.tagName = this.nodeName;
    this.childNodes = [];
    this.parentNode = null;
    this.attributes = [];
    this._text = text;
    this.className = '';
    this.src = '';
    this.async = false;
    this.onload = null;
    this.onerror = null;
  }

  get textContent() {
    if (this.nodeType === 3) return this._text;
    return this.childNodes.map(child => child.textContent).join('');
  }

  set textContent(value) {
    if (this.nodeType === 3) {
      this._text = String(value);
      return;
    }
    this.childNodes = [];
    this.appendChild(new TestNode(3, '#text', String(value)));
  }

  appendChild(node) {
    if (node.nodeType === 11) {
      for (const child of [...node.childNodes]) this.appendChild(child);
      node.childNodes = [];
      return node;
    }
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }

  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index !== -1) this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }

  replaceChild(replacement, current) {
    let index = this.childNodes.indexOf(current);
    assert.notEqual(index, -1);
    this.childNodes.splice(index, 1);
    current.parentNode = null;
    if (replacement.nodeType === 11) {
      for (const child of [...replacement.childNodes]) {
        child.parentNode = this;
        this.childNodes.splice(index++, 0, child);
      }
      replacement.childNodes = [];
    } else {
      replacement.parentNode = this;
      this.childNodes.splice(index, 1, replacement);
    }
    return current;
  }

  setAttribute(name, value) {
    const attribute = this.attributes.find(item => item.name === name);
    if (attribute) attribute.value = value;
    else this.attributes.push({ name, value: String(value) });
    if (name === 'class') this.className = String(value);
  }

  getAttribute(name) {
    const attribute = this.attributes.find(item => item.name === name);
    return attribute ? attribute.value : null;
  }
}

const documentFragment = () => new TestNode(11);
const element = (name, attributes = {}, children = []) => {
  const node = new TestNode(1, name);
  for (const [attribute, value] of Object.entries(attributes)) {
    node.setAttribute(attribute, value);
  }
  for (const child of children) node.appendChild(child);
  return node;
};
const text = value => new TestNode(3, '#text', value);

function fakeDocument(postBodies, readyState = 'loading') {
  const handlers = {};
  const head = new TestNode(1, 'head');
  const document = {
    currentScript: null,
    documentElement: element('html'),
    head,
    readyState,
    addEventListener(name, handler) {
      handlers[name] = handler;
    },
    createDocumentFragment: documentFragment,
    createElement(name) {
      return new TestNode(1, name);
    },
    createTextNode(value) {
      return text(value);
    },
    querySelectorAll(selector) {
      return selector === '.post-body' ? postBodies : [];
    }
  };
  return { document, handlers, head };
}

function katexMock() {
  const calls = [];
  return {
    calls,
    render(expression, target, options) {
      calls.push({ expression, options });
      target.setAttribute('class', options.displayMode ? 'katex-display' : 'katex');
      target.textContent = `[math:${expression}]`;
    }
  };
}

test('dollar parsing matches markdown-it-katex currency and escape rules', () => {
  assert.equal(mathParts('价格 $5 和 $10').length, 0);
  assert.equal(mathParts('价格 $20,000 和 $30,000').length, 0);
  assert.equal(mathParts(String.raw`\$5 and \$10`).length, 0);
  assert.equal(mathParts('价格 $5 和 $10，公式 $x_1$').length, 1);
  assert.equal(mathParts(String.raw`公式 $x + \$5$`)[0].value, String.raw`x + \$5`);
  assert.equal(mathParts(String.raw`\\(literal\\)`).length, 0);
  assert.equal(mathParts(String.raw`\(x_1\)`)[0].value, 'x_1');
  assert.deepEqual(
    mathParts(String.raw`$x_1$ and $$\frac{1}{2}$$`).map(part => ({
      display: part.display,
      value: part.value
    })),
    [
      { display: false, value: 'x_1' },
      { display: true, value: String.raw`\frac{1}{2}` }
    ]
  );
});

test('Markdown escaped dollars survive as literal markers beside real formulas', async () => {
  const content = '展示 \\$x\\$，公式 $x_1$；价格 \\\\$5 and \\\\$10';
  const rendered = await site.post.render(null, { content, engine: 'md' });
  const $ = cheerio.load(rendered.content, {}, false);

  assert.equal($('[data-math-literal-dollar]').length, 2);
  assert.equal($('.katex').length, 1);
  assert.equal($('[data-math-literal-dollar]').first().text(), '$');
  assert.equal($('annotation').text().trim(), 'x_1');
  assert.match($.root().text(), /价格 \\\$5 and \\\$10/);
});

test('post pages receive only local CSS and the lightweight runtime', () => {
  const original = fullPage(
    '<div class="post-body"><p><span class="katex">已有公式</span></p></div>',
    '<meta charset="utf-8"><style>body{color:black}</style>'
  );
  const injected = inject(original, '/docs/');

  assert.equal(
    injected.match(/data-math-page-asset="style"/g).length,
    1
  );
  assert.equal(
    injected.match(/data-math-page-asset="runtime"/g).length,
    1
  );
  assert.match(injected, /href="\/docs\/assets\/katex\/katex\.min\.css"/);
  assert.match(injected, /src="\/docs\/js\/render-math\.js"/);
  assert.match(injected, /data-math-katex-src="\/docs\/assets\/katex\/katex\.min\.js"/);
  assert.doesNotMatch(
    injected,
    /<script[^>]*\ssrc="[^"]*assets\/katex\/katex\.min\.js"/
  );
  assert.equal(inject(injected, '/docs/'), injected);

  const withoutManagedTags = injected
    .replace(
      /\n<link rel="stylesheet" href="\/docs\/assets\/katex\/katex\.min\.css" data-math-page-asset="style">/,
      ''
    )
    .replace(
      /\n<script defer src="\/docs\/js\/render-math\.js" data-math-page-asset="runtime" data-math-katex-src="\/docs\/assets\/katex\/katex\.min\.js"><\/script>/,
      ''
    );
  assert.equal(withoutManagedTags, original);
});

test('pages without a real post body and fragments are unchanged', () => {
  const plainPage = fullPage('<main><p>普通页面</p></main>');
  const fragment = '<div class="post-body">$x_1$</div>';
  const incompletePage = '<html><head></head><body><div class="post-body">$x$</div></body>';
  const examplesOnly = fullPage([
    '<pre><code>&lt;div class="post-body"&gt;$x$&lt;/div&gt;</code></pre>',
    '<script>const sample = \'</head><div class="post-body">$x$</div>\';</script>'
  ].join(''));

  assert.equal(inject(plainPage), plainPage);
  assert.equal(inject(fragment), fragment);
  assert.equal(inject(incompletePage), incompletePage);
  assert.equal(inject(examplesOnly), examplesOnly);
});

test('runtime skips code, currency, escaped dollars and existing KaTeX', async () => {
  const currency = element('p', {}, [text('价格 $5 和 $10')]);
  const escaped = element('p', {}, [
    element('span', { 'data-math-literal-dollar': '' }, [text('$')]),
    text('x'),
    element('span', { 'data-math-literal-dollar': '' }, [text('$')])
  ]);
  const existing = element('span', { class: 'katex' }, [text('$existing$')]);
  const code = element('pre', {}, [element('code', {}, [text('$HOME')])]);
  const postBody = element('div', { class: 'post-body' }, [
    currency,
    escaped,
    existing,
    code
  ]);
  const { document } = fakeDocument([postBody]);
  const appended = [];
  document.head.appendChild = script => {
    appended.push(script.src);
  };
  const window = { document, console };

  const runtime = createRuntime(window, { katexUrl: '/assets/katex/katex.min.js' });
  assert.equal(await runtime.render(), false);
  assert.deepEqual(appended, []);
  assert.equal(postBody.textContent.includes('价格 $5 和 $10'), true);
  assert.equal(postBody.textContent.includes('$x$'), true);
  assert.equal(postBody.textContent.includes('$existing$'), true);
  assert.equal(postBody.textContent.includes('$HOME'), true);
});

test('raw HTML formulas load KaTeX once and page events do not rerender', async () => {
  const mixed = element('p', {}, [
    text('价格 $5 和 $10；转义 '),
    element('span', { 'data-math-literal-dollar': '' }, [text('$')]),
    text('x'),
    element('span', { 'data-math-literal-dollar': '' }, [text('$')]),
    text(String.raw`；HTML 公式 $x_1$ 和 $$\frac{1}{2}$$`)
  ]);
  const existing = element('span', { class: 'katex' }, [text('existing')]);
  const postBody = element('div', { class: 'post-body' }, [mixed, existing]);
  const { document, handlers, head } = fakeDocument([postBody]);
  const appended = [];
  const katex = katexMock();
  const append = head.appendChild.bind(head);
  head.appendChild = script => {
    append(script);
    appended.push(script.src);
    Promise.resolve().then(() => {
      window.katex = katex;
      script.onload();
    });
  };
  const window = { document, console };

  const runtime = install(window);
  assert.equal(runtime, window.__mathPageRenderer);
  await handlers.DOMContentLoaded();
  await handlers['page:loaded']();

  assert.deepEqual(appended, ['/assets/katex/katex.min.js']);
  assert.equal(katex.calls.length, 2);
  assert.deepEqual(katex.calls.map(call => call.expression), [
    'x_1',
    String.raw`\frac{1}{2}`
  ]);
  assert.equal(katex.calls[1].options.displayMode, true);
  assert.equal(postBody.textContent.includes('价格 $5 和 $10'), true);
  assert.equal(postBody.textContent.includes('$x$'), true);
  assert.equal(postBody.textContent.includes('existing'), true);
  assert.equal(postBody.textContent.includes('[math:x_1]'), true);
});

test('runtime uses the site root stored on its script when no URL is passed', async () => {
  const formula = element('p', {}, [text('$x$')]);
  const postBody = element('div', { class: 'post-body' }, [formula]);
  const { document, head } = fakeDocument([postBody]);
  const appended = [];
  const katex = katexMock();
  head.appendChild = script => {
    appended.push(script.src);
    Promise.resolve().then(() => {
      window.katex = katex;
      script.onload();
    });
  };
  const currentScript = {
    src: 'https://example.test/docs/js/render-math.js',
    getAttribute(name) {
      return name === 'data-math-katex-src'
        ? '/docs/assets/katex/katex.min.js'
        : null;
    }
  };
  document.currentScript = currentScript;
  const window = { document, console };

  await createRuntime(window).render();
  assert.deepEqual(appended, ['/docs/assets/katex/katex.min.js']);
});
