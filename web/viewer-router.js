/* 主工作区 URL 路由模块：统一同步 ed / mode / scope / view / match，支持历史前进后退。 */
(function () {
  'use strict';

  const VALID_MODES = ['modern', 'wiki', 'draw'];
  const VALID_ORIENTS = ['horizontal', 'vertical'];
  const VALID_SCOPES = ['main', 'prelim', 'unclassified'];
  const VALID_VIEWS = ['chart', 'table'];
  const TABLE_PARAMS = ['q', 'tournament', 'filter_ed', 'round', 'round_dim', 'status', 'sgf', 'from', 'to', 'unknown', 'sort', 'page'];

  function read(search) {
    const params = new URLSearchParams(typeof search === 'string' ? search : window.location.search);
    const mode = params.get('mode');
    const orient = params.get('orient');
    const scope = params.get('scope');
    const view = params.get('view');
    const theme = params.get('theme');
    return {
      ed: params.get('ed') || '',
      mode: VALID_MODES.includes(mode) ? mode : '',
      orient: VALID_ORIENTS.includes(orient) ? orient : '',
      scope: VALID_SCOPES.includes(scope) ? scope : 'main',
      view: VALID_VIEWS.includes(view) ? view : 'chart',
      table: view === 'table' && (params.has('filters') || TABLE_PARAMS.some(key => params.has(key)))
        ? Object.fromEntries(TABLE_PARAMS.map(key => [key, params.get(key) || ''])) : null,
      match: params.get('match') || '',
      tab: params.get('tab') || '',
      player: params.get('player') || '',
      theme: ['light', 'dark', 'auto'].includes(theme) ? theme : '',
    };
  }

  function buildUrl(state, baseHref) {
    const url = new URL(baseHref || window.location.href);
    const next = state || {};
    if (next.ed !== undefined) {
      if (next.ed) url.searchParams.set('ed', next.ed);
      else url.searchParams.delete('ed');
    }
    if (next.mode !== undefined) {
      if (VALID_MODES.includes(next.mode)) url.searchParams.set('mode', next.mode);
      else url.searchParams.delete('mode');
    }
    if (next.orient !== undefined) {
      if (next.orient === 'vertical') url.searchParams.set('orient', 'vertical');
      else url.searchParams.delete('orient');
    }
    if (next.scope !== undefined) {
      if (next.scope && next.scope !== 'main' && VALID_SCOPES.includes(next.scope)) {
        url.searchParams.set('scope', next.scope);
      } else {
        url.searchParams.delete('scope');
      }
    }
    if (next.view !== undefined) {
      if (next.view === 'table') url.searchParams.set('view', 'table');
      else url.searchParams.delete('view');
    }
    if (next.match !== undefined) {
      if (next.match) url.searchParams.set('match', next.match);
      else url.searchParams.delete('match');
    }
    if (next.tab !== undefined) {
      if (next.tab) url.searchParams.set('tab', next.tab);
      else url.searchParams.delete('tab');
    }
    if (next.player !== undefined) {
      if (next.player) url.searchParams.set('player', next.player);
      else url.searchParams.delete('player');
    }
    if (next.table !== undefined) {
      if (next.table) url.searchParams.set('filters', '1');
      else url.searchParams.delete('filters');
      for (const key of TABLE_PARAMS) {
        if (next.table?.[key]) url.searchParams.set(key, next.table[key]);
        else url.searchParams.delete(key);
      }
    }
    return url;
  }

  function sync(state, options) {
    const opts = options || {};
    const url = buildUrl(state);
    if (url.search === window.location.search && url.hash === window.location.hash) {
      return false;
    }
    try {
      if (opts.push) history.pushState({tableScroll: history.state?.tableScroll}, '', url);
      else history.replaceState(history.state, '', url);
      return true;
    } catch (_) {
      return false;
    }
  }

  function onPopState(handler) {
    if (typeof handler !== 'function') return function () {};
    const listener = () => handler(read());
    window.addEventListener('popstate', listener);
    return () => window.removeEventListener('popstate', listener);
  }

  window.GoViewerRouter = {
    read,
    buildUrl,
    sync,
    onPopState,
  };
})();
