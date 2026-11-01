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

function fakeElement(key, field = 'data-visitor-stats-value') {
  const attributes = new Map([[field, key]]);
  return {
    textContent: '正在读取',
    getAttribute(name) { return attributes.get(name) || null; },
    setAttribute(name, value) { attributes.set(name, value); }
  };
}

function fakeWindow(options = {}) {
  const values = [
    fakeElement('site_uv'),
    fakeElement('site_pv')
  ];
  const mirrors = [
    fakeElement('site_uv', 'data-visitor-stats-mirror'),
    fakeElement('site_pv', 'data-visitor-stats-mirror')
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
        counterAllowedHost: 'greeopia.github.io',
        counterSrc: 'https://vercount.example.test/counter.js'
      }
    },
    querySelector(selector) {
      return selector === '[data-visitor-stats]' ? statisticsRoot : null;
    },
    querySelectorAll(selector) {
      return selector === '[data-visitor-stats-mirror]' ? mirrors : [];
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
      notify() {
        if (!this.disconnected) this.callback();
      }
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
    mirrors,
    observer,
    scripts,
    statisticsRoot,
    timers,
    values,
    window
  };
}

test('VerCount supplies one compatible counter request for the footer and floating panel', () => {
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
  assert.match(footer, /data-visitor-stats-value="site_uv">正在读取</);
  assert.match(footer, /data-visitor-stats-value="site_pv">正在读取</);
  assert.match(footer, /style="display:inline"/);

  const statistics = fs.readFileSync(
    path.join(root, 'themes/hexo-theme-next-master/layout/_third-party/statistics/busuanzi-counter.njk'),
    'utf8'
  );
  const loaderTag = statistics.match(/<script\b[^>]*><\/script>/);
  assert.ok(loaderTag);
  assert.match(statistics, /visitor-stats\.js/);
  assert.match(statistics, /data-counter-src="https:\/\/events\.vercount\.one\/js"/);
  assert.match(statistics, /data-counter-allowed-host="greeopia\.github\.io"/);
  assert.doesNotMatch(loaderTag[0], /\ssrc="https:\/\//);
  assert.doesNotMatch(statistics, /busuanzi\.ibruce\.info/);

  const layout = fs.readFileSync(path.join(root, 'themes/hexo-theme-next-master/layout/_layout.njk'), 'utf8');
  for (const key of ['site_uv', 'site_pv']) {
    assert.equal(layout.match(new RegExp(`data-visitor-stats-mirror="${key}"`, 'g')).length, 1);
    assert.doesNotMatch(layout, new RegExp(`id="busuanzi_value_${key}"`));
  }
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
    assert.deepEqual(fake.mirrors.map(item => item.textContent), ['预览', '预览']);
    assert.equal(fake.scripts.length, 0, location.hostname);
  }
});

test('non-production hosts fail closed without contacting the counting service', () => {
  const fake = fakeWindow({
    location: { protocol: 'https:', hostname: 'preview.example.test' }
  });
  createRuntime(fake.window).start();

  assert.equal(fake.statisticsRoot.getAttribute('data-state'), 'unavailable');
  assert.deepEqual(fake.values.map(item => item.textContent), ['暂不可用', '暂不可用']);
  assert.deepEqual(fake.mirrors.map(item => item.textContent), ['—', '—']);
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
  assert.equal(fake.scripts[0].src, 'https://vercount.example.test/counter.js');
  assert.deepEqual(fake.mirrors.map(item => item.textContent), ['…', '…']);
  assert.equal(fake.timers[0].delay, 6000);

  fake.values[0].textContent = '1,234';
  fake.values[1].textContent = '5,678';
  assert.equal(runtime.check(), true);
  assert.equal(fake.statisticsRoot.getAttribute('data-state'), 'ready');
  assert.deepEqual(fake.mirrors.map(item => item.textContent), ['1,234', '5,678']);
  assert.ok(fake.mirrors.every(item => item.getAttribute('data-state') === 'ready'));
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

test('late official values recover after timeout, script error, or going offline without retrying', () => {
  for (const failure of ['timeout', 'script-error', 'offline']) {
    const fake = fakeWindow();
    const runtime = install(fake.window);
    if (failure === 'timeout') fake.timers[0].callback();
    if (failure === 'script-error') fake.scripts[0].onerror();
    if (failure === 'offline') fake.listeners.offline();

    assert.equal(fake.statisticsRoot.getAttribute('data-state'), 'unavailable', failure);
    assert.equal(fake.window.observer.disconnected, false, failure);
    assert.equal(fake.timers[0].cleared, true, failure);
    assert.equal(fake.listeners.offline, undefined, failure);

    fake.values[0].textContent = '1,234';
    fake.values[1].textContent = '5,678';
    fake.window.observer.notify();

    assert.equal(fake.statisticsRoot.getAttribute('data-state'), 'ready', failure);
    assert.deepEqual(fake.values.map(item => item.textContent), ['1,234', '5,678']);
    assert.equal(fake.window.observer.disconnected, true, failure);

    fake.scripts[0].onerror();
    fake.timers[0].callback();
    runtime.start();
    assert.equal(install(fake.window), runtime);
    assert.equal(fake.statisticsRoot.getAttribute('data-state'), 'ready', failure);
    assert.equal(fake.scripts.length, 1, failure);
    assert.equal(fake.timers.length, 1, failure);
  }
});

test('unavailable needs complete numeric output before recovering and never supplies a fallback count', () => {
  const fake = fakeWindow();
  install(fake.window);
  fake.timers[0].callback();

  // Our own placeholder mutations must not trigger success or a second request.
  fake.window.observer.notify();
  assert.equal(fake.statisticsRoot.getAttribute('data-state'), 'unavailable');
  assert.deepEqual(fake.values.map(item => item.textContent), ['暂不可用', '暂不可用']);

  fake.values[0].textContent = '12';
  fake.window.observer.notify();
  assert.equal(fake.statisticsRoot.getAttribute('data-state'), 'unavailable');
  assert.equal(fake.window.observer.disconnected, false);

  // A duplicate failure signal must not erase a result that arrived in stages.
  fake.scripts[0].onerror();
  assert.equal(fake.values[0].textContent, '12');

  for (const value of ['', 'undefined', 'NaN', '-1', '1.5']) {
    fake.values[1].textContent = value;
    fake.window.observer.notify();
    assert.equal(fake.statisticsRoot.getAttribute('data-state'), 'unavailable', value);
  }

  // A literal zero written by the service is valid; the controller creates none.
  fake.values[1].textContent = '0';
  fake.window.observer.notify();
  assert.equal(fake.statisticsRoot.getAttribute('data-state'), 'ready');
  assert.deepEqual(fake.values.map(item => item.textContent), ['12', '0']);
  assert.equal(fake.window.observer.disconnected, true);
  assert.equal(fake.scripts.length, 1);
});
