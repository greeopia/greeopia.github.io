'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const {
  createRuntime,
  install
} = require('../../source/js/visitor-stats');

const root = path.resolve(__dirname, '../..');

function fakeWindow(options = {}) {
  const values = [
    { textContent: '正在读取' },
    { textContent: '正在读取' }
  ];
  const containers = {
    busuanzi_container_site_uv: { style: { display: 'inline' } },
    busuanzi_container_site_pv: { style: { display: 'inline' } }
  };
  const attributes = new Map([['data-state', 'loading']]);
  const statisticsRoot = {
    querySelectorAll() { return values; },
    setAttribute(name, value) { attributes.set(name, value); },
    getAttribute(name) { return attributes.get(name) || null; }
  };
  const scripts = [];
  const timers = [];
  const listeners = {};
  const observer = { disconnect() { this.disconnected = true; } };
  const document = {
    currentScript: {
      dataset: {
        busuanziAllowedHost: 'greeopia.github.io',
        busuanziSrc: 'https://busuanzi.example.test/counter.js'
      }
    },
    querySelector(selector) {
      return selector === '[data-visitor-stats]' ? statisticsRoot : null;
    },
    getElementById(id) {
      return containers[id] || scripts.find(script => script.id === id) || null;
    },
    createElement(name) {
      return { name, id: '', async: false, src: '', onerror: null };
    },
    head: {
      appendChild(script) {
        scripts.push(script);
      }
    }
  };
  const window = {
    document,
    location: options.location || {
      protocol: 'https:',
      hostname: 'greeopia.github.io'
    },
    navigator: { onLine: options.onLine !== false },
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.disconnected = false;
        window.observer = this;
      }

      observe() {}
      disconnect() { this.disconnected = true; }
    },
    setTimeout(callback, delay) {
      timers.push({ callback, delay, cleared: false });
      return timers.length - 1;
    },
    clearTimeout(id) {
      if (timers[id]) timers[id].cleared = true;
    },
    addEventListener(name, callback) {
      listeners[name] = callback;
    },
    removeEventListener(name, callback) {
      if (listeners[name] === callback) delete listeners[name];
    }
  };
  return {
    attributes,
    containers,
    listeners,
    observer,
    scripts,
    statisticsRoot,
    timers,
    values,
    window
  };
}

test('Busuanzi remains a single official-service integration', () => {
  const config = fs.readFileSync(
    path.join(root, 'themes/hexo-theme-next-master/_config.yml'),
    'utf8'
  );
  const busuanziConfig = config.match(/busuanzi_count:\r?\n([\s\S]*?)(?:\r?\n\r?\n|$)/);
  assert.ok(busuanziConfig);
  assert.match(busuanziConfig[1], /^\s+enable: true$/m);
  assert.match(busuanziConfig[1], /^\s+total_visitors: true$/m);
  assert.match(busuanziConfig[1], /^\s+total_views: true$/m);
  assert.match(busuanziConfig[1], /^\s+post_views: false$/m);

  const footer = fs.readFileSync(
    path.join(root, 'themes/hexo-theme-next-master/layout/_partials/footer.njk'),
    'utf8'
  );
  for (const id of [
    'busuanzi_container_site_uv',
    'busuanzi_value_site_uv',
    'busuanzi_container_site_pv',
    'busuanzi_value_site_pv'
  ]) {
    assert.equal(footer.match(new RegExp(`id="${id}"`, 'g')).length, 1, id);
  }
  assert.match(footer, /data-visitor-stats-value>正在读取</);
  assert.match(footer, /style="display:inline"/);

  const statistics = fs.readFileSync(
    path.join(root, 'themes/hexo-theme-next-master/layout/_third-party/statistics/busuanzi-counter.njk'),
    'utf8'
  );
  const loaderTag = statistics.match(/<script\b[^>]*><\/script>/);
  assert.ok(loaderTag);
  assert.match(statistics, /visitor-stats\.js/);
  assert.match(statistics, /data-busuanzi-src="https:\/\/busuanzi\.ibruce\.info/);
  assert.match(statistics, /data-busuanzi-allowed-host="greeopia\.github\.io"/);
  assert.doesNotMatch(loaderTag[0], /\ssrc="https:\/\/busuanzi/);
});

test('local preview hosts never request the production statistics service', () => {
  for (const location of [
    { protocol: 'http:', hostname: 'localhost' },
    { protocol: 'http:', hostname: 'preview.localhost' },
    { protocol: 'http:', hostname: '127.0.0.1' },
    { protocol: 'http:', hostname: '::1' },
    { protocol: 'file:', hostname: '' }
  ]) {
    const fake = fakeWindow({ location });
    createRuntime(fake.window).start();

    assert.equal(fake.statisticsRoot.getAttribute('data-state'), 'local-preview', location.hostname);
    assert.deepEqual(fake.values.map(item => item.textContent), ['本地预览', '本地预览']);
    assert.equal(fake.scripts.length, 0, location.hostname);
  }
});

test('non-production hosts fail closed without contacting Busuanzi', () => {
  const fake = fakeWindow({
    location: { protocol: 'https:', hostname: 'preview.example.test' }
  });
  createRuntime(fake.window).start();

  assert.equal(fake.statisticsRoot.getAttribute('data-state'), 'unavailable');
  assert.deepEqual(fake.values.map(item => item.textContent), ['暂不可用', '暂不可用']);
  assert.equal(fake.scripts.length, 0);
});

test('offline state is explicit and does not request the official script', () => {
  const fake = fakeWindow({ onLine: false });
  const runtime = createRuntime(fake.window, { timeoutMs: 100 });
  runtime.start();

  assert.equal(fake.statisticsRoot.getAttribute('data-state'), 'unavailable');
  assert.deepEqual(fake.values.map(item => item.textContent), ['暂不可用', '暂不可用']);
  assert.equal(fake.scripts.length, 0);
});

test('the official script is injected once and successful values become ready', () => {
  const fake = fakeWindow();
  const runtime = install(fake.window);

  assert.equal(install(fake.window), runtime);
  assert.equal(fake.scripts.length, 1);
  assert.equal(fake.scripts[0].src, 'https://busuanzi.example.test/counter.js');
  assert.equal(fake.timers[0].delay, 6000);

  fake.values[0].textContent = '1,234';
  fake.values[1].textContent = '5,678';
  assert.equal(runtime.check(), true);
  assert.equal(fake.statisticsRoot.getAttribute('data-state'), 'ready');
  assert.equal(fake.window.observer.disconnected, true);
  assert.equal(fake.timers[0].cleared, true);
});

test('script errors and data timeouts show unavailable instead of zero', () => {
  const failed = fakeWindow();
  createRuntime(failed.window, { timeoutMs: 100 }).start();
  failed.scripts[0].onerror();
  assert.equal(failed.statisticsRoot.getAttribute('data-state'), 'unavailable');
  assert.deepEqual(failed.values.map(item => item.textContent), ['暂不可用', '暂不可用']);

  const timedOut = fakeWindow();
  createRuntime(timedOut.window, { timeoutMs: 100 }).start();
  timedOut.containers.busuanzi_container_site_uv.style.display = 'none';
  timedOut.containers.busuanzi_container_site_pv.style.display = 'none';
  timedOut.timers[0].callback();
  assert.equal(timedOut.statisticsRoot.getAttribute('data-state'), 'unavailable');
  assert.deepEqual(timedOut.values.map(item => item.textContent), ['暂不可用', '暂不可用']);
  assert.equal(timedOut.containers.busuanzi_container_site_uv.style.display, 'inline');
  assert.equal(timedOut.containers.busuanzi_container_site_pv.style.display, 'inline');
});
