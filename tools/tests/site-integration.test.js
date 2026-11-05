'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { before, test } = require('node:test');
const Hexo = require('hexo');

const root = path.resolve(__dirname, '../..');
let site;

before(async () => {
  site = new Hexo(root, { silent: true });
  await site.init();
});

test('fresh checkouts with different file mtimes preserve explicit dates and publication-date fallback', async () => {
  assert.equal(site.config.updated_option, 'date');
  for (const modified of ['2030-01-01T00:00:00Z', '2035-01-01T00:00:00Z']) {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hexo-post-dates-'));
    let fixture;
    try {
      const postsDir = path.join(fixtureRoot, 'source', '_posts');
      fs.mkdirSync(postsDir, { recursive: true });
      fs.writeFileSync(path.join(fixtureRoot, 'package.json'), JSON.stringify({
        name: 'post-date-test', version: '1.0.0', hexo: { version: site.version },
      }));
      fs.writeFileSync(path.join(fixtureRoot, '_config.yml'), JSON.stringify({
        theme: false, timezone: 'Asia/Shanghai', updated_option: site.config.updated_option,
      }));
      for (const [name, extra] of [['fallback', ''], ['explicit', 'updated: 2026-11-04 00:25:00\n']]) {
        const filepath = path.join(postsDir, `${name}.md`);
        fs.writeFileSync(filepath, `---\ntitle: ${name}\ndate: 2026-07-05 09:48:53\n${extra}---\n\nBody.\n`);
        fs.utimesSync(filepath, new Date(modified), new Date(modified));
      }
      fixture = new Hexo(fixtureRoot, { silent: true });
      await fixture.init();
      assert.equal(fixture.config.updated_option, 'date');
      fixture.extend.renderer.register('md', 'html', data => data.text, true);
      await fixture.load();
      const posts = fixture.model('Post');
      const fallback = posts.findOne({ title: 'fallback' });
      const explicit = posts.findOne({ title: 'explicit' });
      assert.equal(fallback.updated.valueOf(), Date.parse('2026-07-05T09:48:53+08:00'));
      assert.equal(explicit.updated.valueOf(), Date.parse('2026-11-04T00:25:00+08:00'));
    } finally {
      if (fixture) await fixture.exit();
      const target = path.resolve(fixtureRoot);
      assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
      assert.ok(path.basename(target).startsWith('hexo-post-dates-'));
      fs.rmSync(target, { recursive: true, force: true });
    }
  }
});

function classes() {
  const values = new Set();
  return {
    add: value => values.add(value),
    remove: value => values.delete(value),
    contains: value => values.has(value),
    toggle: (value, enabled) => enabled ? values.add(value) : values.delete(value)
  };
}

async function routeText(route) {
  const chunks = [];
  for await (const chunk of route.data()) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

test('formula scripts, stylesheet and every referenced font are generated locally', async () => {
  const generator = site.extend.generator.get('math-assets');
  assert.equal(typeof generator, 'function');
  const routes = await generator.call(site);
  const byPath = new Map(routes.map(route => [route.path, route]));
  for (const asset of ['katex.min.css', 'katex.min.js']) {
    assert.ok(byPath.has(`assets/katex/${asset}`), asset);
    assert.ok((await routeText(byPath.get(`assets/katex/${asset}`))).length > 0, asset);
  }
  const css = (await routeText(byPath.get('assets/katex/katex.min.css'))).toString();
  const fonts = [...css.matchAll(/url\(["']?(fonts\/[^"')]+)["']?\)/g)].map(match => match[1]);
  assert.ok(fonts.length > 0);
  for (const font of fonts) {
    const route = byPath.get(`assets/katex/${font}`);
    assert.ok(route, font);
    assert.ok((await routeText(route)).length > 0, font);
  }
});

test('site word count uses full published bodies without duplicate excerpts or hidden text', () => {
  const count = site.extend.helper.get('site_word_count');
  const context = { site: { posts: [
    { more: '<p>甲乙 😀</p><span class="gutter">123</span><span class="katex-mathml">hidden</span>', content: '<p>duplicated excerpt</p>' },
    { content: '<p>ABC</p><script>hidden</script>' }
  ] } };
  assert.equal(count.call(context), 6);
  assert.equal(count.call(context), 6);
  assert.equal(count.call({ site: { posts: [] } }), 0);
});

test('blocked browser storage does not break theme or scrolling initialization', () => {
  const source = fs.readFileSync(path.join(root, 'source/_data/body-end.njk'), 'utf8');
  const script = source.match(/<script>([\s\S]*)<\/script>/)[1];
  const handlers = {};
  const icon = {};
  const classList = classes();
  const header = { classList: classes() };
  const themeButton = { addEventListener: (name, fn) => { handlers[`theme:${name}`] = fn; }, querySelector: () => icon };
  const topButton = { addEventListener: (name, fn) => { handlers[`top:${name}`] = fn; } };
  const document = {
    documentElement: { classList },
    getElementById: id => ({ 'btn-theme-toggle': themeButton, 'btn-scroll-top': topButton }[id] || null),
    querySelector: selector => selector === '.header' ? header : null,
    dispatchEvent() {}
  };
  const window = {
    scrollY: 0,
    innerHeight: 720,
    addEventListener: (name, fn) => { handlers[`window:${name}`] = fn; },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    scrollTo: options => { handlers.scrollTarget = options.top; }
  };
  const storage = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } };
  assert.doesNotThrow(() => vm.runInNewContext(script, {
    document, window, localStorage: storage,
    CustomEvent: class { constructor(type) { this.type = type; } },
    setTimeout() {}, setInterval() {}
  }));
  handlers['theme:click']();
  assert.equal(classList.contains('dark-mode'), true);
  handlers['top:click']();
  assert.equal(handlers.scrollTarget, 0);
  assert.equal(typeof handlers['window:scroll'], 'function');
  assert.equal(header.classList.contains('scrolled'), true);
});

test('an absent mobile menu button does not stop the remaining theme events', () => {
  const source = fs.readFileSync(path.join(root, 'themes/hexo-theme-next-master/source/js/next-boot.js'), 'utf8');
  const handlers = {};
  const warnings = [];
  let codeblockTarget;
  const context = {
    NexT: { utils: {
      registerScrollPercent() {}, registerCanIUseTag() {}, updateFooterPosition() {},
      registerCodeblock(target) { codeblockTarget = target; }
    } },
    document: { querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
    window: { addEventListener: (name, handler) => { handlers[name] = handler; } },
    location: { hash: '' },
    console: { warn: (...args) => warnings.push(args) }
  };
  vm.runInNewContext(source, context);
  context.NexT.boot.registerEvents();
  assert.deepEqual(warnings, []);
  assert.equal(typeof handlers.hashchange, 'function');
  assert.equal(typeof handlers['tabs:click'], 'function');
  const tab = { id: 'example-tab' };
  handlers['tabs:click']({ target: tab });
  assert.equal(codeblockTarget, tab);
});

test('comments use the site theme initially and after a manual theme change', async () => {
  const source = fs.readFileSync(path.join(root, 'themes/hexo-theme-next-master/source/js/third-party/comments/giscus.js'), 'utf8');
  const handlers = {};
  const messages = [];
  const classList = classes();
  classList.add('dark-mode');
  let scriptOptions;
  const frame = {
    contentWindow: { postMessage: (...args) => messages.push(args) },
    addEventListener: (name, fn) => { handlers[`frame:${name}`] = fn; }
  };
  const context = {
    document: {
      documentElement: { classList },
      addEventListener: (name, fn) => { handlers[name] = fn; },
      querySelector: selector => selector === 'iframe.giscus-frame'
        ? frame : {}
    },
    CONFIG: { page: { comments: true }, giscus: { theme: 'preferred_color_scheme' } },
    NexT: { utils: { loadComments: async () => {}, getScript: async (url, options) => { scriptOptions = options; } } }
  };
  vm.runInNewContext(source, context);
  await handlers['page:loaded']();
  assert.equal(scriptOptions.attributes.dataset.theme, 'dark');
  classList.remove('dark-mode');
  handlers['blog:themechange']();
  assert.equal(messages.at(-1)[0].giscus.setConfig.theme, 'light');
  assert.equal(messages.at(-1)[1], 'https://giscus.app');
  classList.add('dark-mode');
  handlers['frame:load']();
  assert.equal(messages.at(-1)[0].giscus.setConfig.theme, 'dark');
});
