/* 外观主题状态模块：统一管理 light / dark / auto 偏好、系统跟随与跨页同步。 */
(function () {
  'use strict';

  const THEME_KEY = 'go_viewer_theme_v1';
  const VALID = ['light', 'dark', 'auto'];
  let currentPreference = 'light';
  let currentRoot = null;
  let toggleButton = null;
  let listenersBound = false;

  function normalize(value, fallback) {
    if (VALID.includes(value)) return value;
    return VALID.includes(fallback) ? fallback : 'light';
  }

  function resolve(preference) {
    if (preference === 'dark') return 'dark';
    if (preference === 'light') return 'light';
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function getStoredPreference() {
    try {
      const stored = localStorage.getItem(THEME_KEY) || '';
      return VALID.includes(stored) ? stored : '';
    } catch (_) {
      return '';
    }
  }

  function getUrlPreference() {
    try {
      const value = new URLSearchParams(window.location.search).get('theme') || '';
      return VALID.includes(value) ? value : '';
    } catch (_) {
      return '';
    }
  }

  function getPreference(options) {
    const opts = options || {};
    if (!opts.ignoreUrl) {
      const fromUrl = getUrlPreference();
      if (fromUrl) return fromUrl;
    }
    const stored = getStoredPreference();
    if (stored) return stored;
    return normalize(opts.fallback, 'light');
  }

  function getEffective() {
    const attr = document.body && document.body.dataset ? document.body.dataset.theme : '';
    if (attr === 'light' || attr === 'dark') return attr;
    return resolve(currentPreference);
  }

  function syncButtons(root) {
    const target = root || currentRoot || document;
    if (!target || !target.querySelectorAll) return;
    target.querySelectorAll('[data-theme-option]').forEach(button => {
      const active = button.dataset.themeOption === currentPreference;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function syncToggle(effective) {
    if (!toggleButton) return;
    const isDark = effective === 'dark';
    toggleButton.setAttribute('aria-pressed', String(isDark));
    toggleButton.setAttribute('title', isDark ? '切换到浅色外观' : '切换到深色外观');
  }

  function apply(preference, options) {
    const opts = options || {};
    const pref = normalize(preference, opts.fallback);
    const effective = resolve(pref);
    currentPreference = pref;
    if (document.documentElement) {
      document.documentElement.dataset.themePref = pref;
    }
    if (document.body) {
      document.body.dataset.theme = effective;
      document.body.dataset.themePref = pref;
      document.body.style.colorScheme = effective;
    }
    if (opts.persist) {
      try {
        localStorage.setItem(THEME_KEY, pref);
      } catch (_) {}
    }
    syncButtons(opts.buttonsRoot);
    syncToggle(effective);
    try {
      window.dispatchEvent(new CustomEvent('go:theme-changed', {detail: {preference: pref, effective}}));
    } catch (_) {}
    return {preference: pref, effective};
  }

  function setPreference(preference, options) {
    return apply(preference, Object.assign({}, options || {}, {persist: true}));
  }

  function toggle(options) {
    const next = getEffective() === 'dark' ? 'light' : 'dark';
    return setPreference(next, options);
  }

  function bindButtons(root) {
    const target = root || document;
    currentRoot = target;
    if (!target || !target.querySelectorAll) return;
    target.querySelectorAll('[data-theme-option]').forEach(button => {
      button.onclick = () => setPreference(button.dataset.themeOption, {buttonsRoot: target});
    });
    syncButtons(target);
  }

  function bindToggle(target) {
    const button = typeof target === 'string' ? document.querySelector(target) : target;
    toggleButton = button || null;
    if (!toggleButton) return null;
    toggleButton.onclick = () => toggle();
    syncToggle(getEffective());
    return toggleButton;
  }

  function ensureListeners() {
    if (listenersBound) return;
    listenersBound = true;
    if (window.matchMedia) {
      const scheme = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => {
        if (currentPreference === 'auto') apply('auto', {persist: false});
      };
      if (scheme.addEventListener) scheme.addEventListener('change', onChange);
      else if (scheme.addListener) scheme.addListener(onChange);
    }
    window.addEventListener('storage', event => {
      if (event.key !== THEME_KEY || !VALID.includes(event.newValue)) return;
      apply(event.newValue, {persist: false});
    });
  }

  function init(options) {
    const opts = options || {};
    ensureListeners();
    const hadStored = Boolean(getStoredPreference());
    const pref = getPreference(opts);
    const shouldPersist = Boolean(opts.persistIfMissing && !hadStored);
    if (opts.buttonsRoot !== false) {
      currentRoot = opts.buttonsRoot || document;
    }
    if (opts.toggleSelector) {
      const el = typeof opts.toggleSelector === 'string'
        ? document.querySelector(opts.toggleSelector) : opts.toggleSelector;
      toggleButton = el || null;
    }
    const result = apply(pref, {persist: shouldPersist, buttonsRoot: currentRoot, fallback: opts.fallback});
    if (opts.buttonsRoot !== false) bindButtons(currentRoot);
    if (toggleButton) bindToggle(toggleButton);
    return result;
  }

  window.GoViewerTheme = {
    THEME_KEY,
    resolve,
    getStoredPreference,
    getPreference,
    getEffective,
    apply,
    setPreference,
    toggle,
    bindButtons,
    bindToggle,
    init,
  };
})();
