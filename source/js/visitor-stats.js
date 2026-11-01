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

  const OFFICIAL_SCRIPT_URL = 'https://busuanzi.ibruce.info/busuanzi/2.3/busuanzi.pure.mini.js';
  const REMOTE_SCRIPT_ID = 'busuanzi-official-script';
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

    const settings = options || {};
    const timeoutMs = Number.isFinite(settings.timeoutMs)
      ? settings.timeoutMs
      : DEFAULT_TIMEOUT_MS;
    const currentScript = document.currentScript;
    const scriptUrl = settings.scriptUrl
      || (currentScript && currentScript.dataset && currentScript.dataset.busuanziSrc)
      || OFFICIAL_SCRIPT_URL;
    const allowedHost = String(
      settings.allowedHost
      || (currentScript && currentScript.dataset && currentScript.dataset.busuanziAllowedHost)
      || ''
    ).toLowerCase();

    let observer = null;
    let timeoutId = null;
    let requestStarted = false;
    let settled = false;

    function setState(state) {
      root.setAttribute('data-state', state);
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
      // The original JSONP request can still complete after the display timeout.
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

      if (!isAllowedProductionOrigin(window.location)) {
        markUnavailable();
        return;
      }

      if (window.navigator && window.navigator.onLine === false) {
        markUnavailable();
        return;
      }

      watchValues();
      if (typeof window.addEventListener === 'function') {
        window.addEventListener('offline', markUnavailable);
      }
      timeoutId = window.setTimeout(markUnavailable, timeoutMs);

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
