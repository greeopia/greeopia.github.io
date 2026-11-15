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

  const OFFICIAL_SCRIPT_URL = 'https://events.vercount.one/js';
  const OFFICIAL_READ_URL = 'https://events.vercount.one/api/v2/log';
  const REMOTE_SCRIPT_ID = 'visitor-counter-script';
  const DEFAULT_TIMEOUT_MS = 6000;
  const LOADING_TEXT = '正在读取';
  const LOCAL_PREVIEW_TEXT = '本地预览';
  const UNAVAILABLE_TEXT = '暂不可用';

  function hasNumericValue(element) {
    const value = element && String(element.textContent || '').trim();
    return /^\d(?:[\d,]*\d)?$/.test(value || '');
  }

  function createRuntime(window, options) {
    if (!window || !window.document) return null;

    const document = window.document;
    const root = document.querySelector('[data-visitor-stats]');
    if (!root) return null;

    const values = Array.from(root.querySelectorAll('[data-visitor-stats-value]'));
    if (values.length === 0) return null;
    const mirrors = Array.from(document.querySelectorAll('[data-visitor-stats-mirror]'));

    const settings = options || {};
    const timeoutMs = Number.isFinite(settings.timeoutMs)
      ? settings.timeoutMs
      : DEFAULT_TIMEOUT_MS;
    const currentScript = document.currentScript;
    const countPage = currentScript && currentScript.dataset
      && currentScript.dataset.counterCountPage === 'true';
    const scriptUrl = settings.scriptUrl
      || (currentScript && currentScript.dataset && currentScript.dataset.counterSrc)
      || OFFICIAL_SCRIPT_URL;
    const readUrl = settings.readUrl
      || (currentScript && currentScript.dataset && currentScript.dataset.counterReadSrc)
      || OFFICIAL_READ_URL;
    const allowedHost = String(
      settings.allowedHost
      || (currentScript && currentScript.dataset && currentScript.dataset.counterAllowedHost)
      || ''
    ).toLowerCase();

    let observer = null;
    let timeoutId = null;
    let requestStarted = false;
    let settled = false;

    function setState(state) {
      root.setAttribute('data-state', state);
      for (const mirror of mirrors) {
        const key = mirror.getAttribute('data-visitor-stats-mirror');
        const value = values.find(element => element.getAttribute('data-visitor-stats-value') === key);
        mirror.setAttribute('data-state', state);
        mirror.textContent = state === 'ready' && value ? value.textContent
          : state === 'local-preview' ? '预览' : state === 'loading' ? '…' : '—';
        mirror.title = state === 'unavailable' ? '统计服务暂时未返回数据'
          : state === 'local-preview' ? '本地预览不计入访问量' : '';
      }
    }

    function setValues(text) {
      for (const element of values) element.textContent = text;
    }

    function showContainers() {
      for (const id of [
        'busuanzi_container_site_uv',
        'busuanzi_container_site_pv'
      ]) {
        const container = document.getElementById(id);
        if (container && container.style) container.style.display = 'inline';
      }
    }

    function removeOfflineListener() {
      if (typeof window.removeEventListener === 'function') {
        window.removeEventListener('offline', markUnavailable);
      }
    }

    function clearPending() {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
      removeOfflineListener();
    }

    function stopWatch() {
      if (observer) observer.disconnect();
      clearPending();
    }

    function markUnavailable() {
      if (settled || root.getAttribute('data-state') === 'unavailable') return;
      // The provider can still supply a result after the display timeout.
      // Keep observing its output until complete numeric values arrive.
      clearPending();
      setValues(UNAVAILABLE_TEXT);
      showContainers();
      setState('unavailable');
    }

    function check() {
      if (settled) return root.getAttribute('data-state') === 'ready';
      if (!values.every(hasNumericValue)) return false;

      settled = true;
      stopWatch();
      showContainers();
      setState('ready');
      return true;
    }

    function isLocalPreview(location) {
      if (!location) return false;
      const hostname = String(location.hostname || '').toLowerCase();
      return location.protocol === 'file:'
        || hostname === 'localhost'
        || hostname.endsWith('.localhost')
        || hostname === '127.0.0.1'
        || hostname === '0.0.0.0'
        || hostname === '::1'
        || hostname === '[::1]';
    }

    function isAllowedProductionOrigin(location) {
      if (!location || !allowedHost) return false;
      return location.protocol === 'https:'
        && String(location.hostname || '').toLowerCase() === allowedHost;
    }

    function watchValues() {
      if (typeof window.MutationObserver !== 'function') return;
      observer = new window.MutationObserver(check);
      for (const element of values) {
        observer.observe(element, { childList: true, characterData: true, subtree: true });
      }
    }

    async function readTotals() {
      try {
        const response = await window.fetch(`${readUrl}?url=${encodeURIComponent(window.location.href)}`, {
          method: 'GET',
          cache: 'no-store'
        });
        if (!response.ok) throw new Error('Counter read failed');
        const result = await response.json();
        if (result.status !== 'success' || !result.data) throw new Error('Invalid counter response');
        const totals = values.map(element => result.data[element.getAttribute('data-visitor-stats-value')]);
        if (!totals.every(value => Number.isSafeInteger(value) && value >= 0)) {
          throw new Error('Invalid counter values');
        }
        values.forEach((element, index) => { element.textContent = String(totals[index]); });
        check();
      } catch {
        markUnavailable();
      }
    }

    function beginRequest(shouldCount) {
      if (typeof window.addEventListener === 'function') {
        window.addEventListener('offline', markUnavailable);
      }
      timeoutId = window.setTimeout(markUnavailable, timeoutMs);

      if (!shouldCount) {
        readTotals();
        return;
      }

      watchValues();
      const existingScript = document.getElementById(REMOTE_SCRIPT_ID);
      if (existingScript) {
        check();
        return;
      }

      const script = document.createElement('script');
      script.id = REMOTE_SCRIPT_ID;
      script.async = true;
      script.referrerPolicy = 'no-referrer-when-downgrade';
      script.src = scriptUrl;
      script.onerror = markUnavailable;

      try {
        document.head.appendChild(script);
      } catch (error) {
        markUnavailable();
      }
    }

    function start() {
      if (requestStarted) return;
      requestStarted = true;

      if (check()) return;
      setValues(LOADING_TEXT);
      setState('loading');

      if (isLocalPreview(window.location)) {
        settled = true;
        setValues(LOCAL_PREVIEW_TEXT);
        showContainers();
        setState('local-preview');
        return;
      }

      if (!isAllowedProductionOrigin(window.location)
        || (window.navigator && window.navigator.onLine === false)) {
        markUnavailable();
        return;
      }

      beginRequest(countPage);
    }

    return { check, start };
  }

  function install(window) {
    if (window.__visitorStatsRuntime) return window.__visitorStatsRuntime;

    const runtime = createRuntime(window);
    if (!runtime) return null;
    window.__visitorStatsRuntime = runtime;
    runtime.start();
    return runtime;
  }

  return { createRuntime, install };
});
