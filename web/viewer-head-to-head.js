/* 对手交锋独立页：查询状态、双方选择、概览、执色拆分、筛选、页签、列表与 URL 同步。
 *
 * 只调用 /api/head-to-head* 的按需查询接口，不加载 tournaments_bundle.js；
 * 胜率、统计范围与分类全部由 Python 服务给出，这里只负责状态、呈现和导航。
 */
(function () {
  'use strict';
  const M = window.GoViewerModel;
  const E = M.escape;
  const F = window.GoViewerFlags;
  const DEFAULT_SIZE = 50;
  const SIZE_OPTIONS = [25, 50, 100];
  // URL 参数 → 内部状态字段。只在不同于默认值时写入地址，保证分享地址简短可读。
  const URL_FIELDS = [
    ['a', 'a', ''], ['b', 'b', ''], ['view', 'view', 'games'],
    ['category', 'category', 'all'], ['tournament', 'tournament', ''],
    ['stage', 'stage', 'all'], ['competition', 'competition', 'all'],
    ['a_color', 'color', 'all'], ['from', 'from', ''], ['to', 'to', ''],
    ['result', 'result', 'all'],
  ];
  const state = {
    a: '', b: '', view: 'games', category: 'all', tournament: '', stage: 'all',
    competition: 'all', strict: false, color: 'all', from: '', to: '', unknown: true,
    result: 'all', sgf: false, page: 1, size: DEFAULT_SIZE,
  };
  const dom = {};
  let requestToken = 0;
  let lastPayload = null;
  let searchTimers = {a: 0, b: 0};
  let searchTokens = {a: 0, b: 0};
  let picking = {a: false, b: false};
  let activeOption = {a: -1, b: -1};
  let options = {a: [], b: []};

  // -------------------------------------------------------------------------
  // 基础工具
  // -------------------------------------------------------------------------

  const $ = id => document.getElementById(id);

  function rate(value) {
    if (value === null || value === undefined) return '—';
    const percent = value * 100;
    const text = Math.abs(percent - Math.round(percent)) < 0.05
      ? String(Math.round(percent)) : percent.toFixed(1);
    return text + '%';
  }

  function number(value) {
    return (Number(value) || 0).toLocaleString('zh-CN');
  }

  function flag(nationality) {
    return nationality ? F.html(nationality) : '<span class="h2h-flag-empty" aria-hidden="true"></span>';
  }

  function nationName(nationality) {
    return nationality ? F.info(nationality).name : '地区未知';
  }

  function dateText(item) {
    const raw = String(item.date || '').trim();
    return raw || '日期未知';
  }

  function precisionHint(item) {
    return {day: '完整日期', month: '仅到月份', year: '仅到年份', none: '日期未知'}[item.date_precision] || '日期未知';
  }

  function colorLabel(color) {
    return color === 'black' ? '黑' : color === 'white' ? '白' : '执色未载';
  }

  function editionText(item) {
    return `${item.tournament_short || ''} ${item.edition_label || ''}`.trim();
  }

  // -------------------------------------------------------------------------
  // URL 状态
  // -------------------------------------------------------------------------

  function readUrl() {
    const params = new URLSearchParams(location.search);
    for (const [key, field, fallback] of URL_FIELDS) {
      const value = params.get(key);
      state[field] = value === null ? fallback : value;
    }
    state.unknown = params.get('include_unknown_date') !== '0';
    state.sgf = params.get('only_with_sgf') === '1';
    state.strict = params.get('strict') === '1';
    const page = Number(params.get('page'));
    state.page = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
    const size = Number(params.get('page_size'));
    state.size = SIZE_OPTIONS.includes(size) ? size : DEFAULT_SIZE;
  }

  // 用户操作写入一条新历史记录（返回／前进可恢复状态）；服务返回后的规范化
  // （别名解析成规范 ID、页码被夹到末页）只替换当前记录，避免污染历史。
  function writeUrl(push) {
    const url = new URL(location.href);
    for (const [key, field, fallback] of URL_FIELDS) {
      if (state[field] === fallback || state[field] === '' || state[field] === undefined) url.searchParams.delete(key);
      else url.searchParams.set(key, state[field]);
    }
    url.searchParams.delete('include_unknown_date');
    if (!state.unknown) url.searchParams.set('include_unknown_date', '0');
    url.searchParams.delete('only_with_sgf');
    if (state.sgf) url.searchParams.set('only_with_sgf', '1');
    url.searchParams.delete('strict');
    if (state.strict) url.searchParams.set('strict', '1');
    url.searchParams.delete('page');
    if (state.page > 1) url.searchParams.set('page', String(state.page));
    url.searchParams.delete('page_size');
    if (state.size !== DEFAULT_SIZE) url.searchParams.set('page_size', String(state.size));
    try {
      history[push ? 'pushState' : 'replaceState'](null, '', url);
    } catch (_) { /* 本地文件协议下忽略 */ }
    const backPlayer = $('h2hBackPlayer');
    if (backPlayer) {
      const targetId = state.a || state.b;
      if (targetId) {
        backPlayer.href = 'player.html?id=' + encodeURIComponent(targetId);
        backPlayer.hidden = false;
      } else {
        backPlayer.hidden = true;
      }
    }
  }

  // -------------------------------------------------------------------------
  // 请求
  // -------------------------------------------------------------------------

  async function api(path, params) {
    const url = new URL(path, location.href);
    for (const [key, value] of Object.entries(params || {})) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
    }
    const response = await fetch(url, {headers: {Accept: 'application/json'}, cache: 'no-store'});
    let payload = null;
    try { payload = await response.json(); } catch (_) { /* 非 JSON 错误页 */ }
    if (!response.ok) {
      const error = new Error((payload && payload.error) || `读取失败（HTTP ${response.status}）`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    if (!payload || typeof payload !== 'object') throw new Error('读取失败：返回内容不是有效资料。');
    return payload;
  }

  function mainParams() {
    return {
      a: state.a, b: state.b, view: state.view, category: state.category,
      tournament: state.tournament, stage: state.stage, competition: state.competition,
      strict: state.strict,
      a_color: state.color, date_from: state.from, date_to: state.to,
      include_unknown_date: state.unknown, result_status: state.result,
      only_with_sgf: state.sgf, page: state.page, page_size: state.size,
    };
  }

  // -------------------------------------------------------------------------
  // 状态提示
  // -------------------------------------------------------------------------

  function setStatus(message, tone) {
    dom.status.textContent = message || '';
    dom.status.hidden = !message;
    dom.status.dataset.tone = tone || 'info';
  }

  function showBody(visible) {
    dom.body.hidden = !visible;
  }

  // -------------------------------------------------------------------------
  // 双方资料栏
  // -------------------------------------------------------------------------

  function playerCard(side, payload) {
    const role = side === 'a' ? '甲方' : '乙方';
    const player = payload || {id: '', name_zh: '', known: false};
    const name = player.name_zh || player.id || '未选择';
    const meta = [
      nationName(player.nationality),
      player.default_kiin || '—',
      M.formatRank(player.default_rank),
    ].filter(Boolean).join(' · ');
    const link = player.id && player.known !== false
      ? `<a href="player.html?id=${encodeURIComponent(player.id)}" class="h2h-player-link">${E(name)}</a>`
      : `<span class="h2h-player-name">${E(name)}</span>`;
    return `
      <p class="h2h-player-role">${role}</p>
      <div class="h2h-player-identity">
        <span class="h2h-player-flag">${flag(player.nationality)}</span>
        <div>
          <strong data-player-name="${side}">${link}</strong>
          <p class="h2h-player-meta">${E(meta)}</p>
        </div>
      </div>
      <button type="button" class="btn h2h-player-change" data-change="${side}" aria-expanded="${picking[side] ? 'true' : 'false'}">${state[side] ? '更换棋手' : '选择棋手'}</button>
      <div class="h2h-picker" data-picker="${side}" ${picking[side] ? '' : 'hidden'}>
        <label class="h2h-visually-hidden" for="h2hSearch${side.toUpperCase()}">搜索${role}</label>
        <input type="search" id="h2hSearch${side.toUpperCase()}" data-search="${side}"
               placeholder="中文名、原文名或已审核别名" autocomplete="off" spellcheck="false"
               role="combobox" aria-expanded="${picking[side] ? 'true' : 'false'}" aria-autocomplete="list"
               aria-controls="h2hOptions${side.toUpperCase()}" aria-activedescendant="">
        <div class="h2h-picker-list" id="h2hOptions${side.toUpperCase()}" role="listbox" aria-label="${role}搜索候选"></div>
      </div>`;
  }

  function renderPlayers(payload) {
    const players = payload || {
      a: state.a ? {id: state.a, name_zh: state.a, known: false} : null,
      b: state.b ? {id: state.b, name_zh: state.b, known: false} : null,
    };
    dom.playerA.innerHTML = playerCard('a', players.a);
    dom.playerB.innerHTML = playerCard('b', players.b);
    for (const side of ['a', 'b']) {
      const change = dom[side === 'a' ? 'playerA' : 'playerB'].querySelector(`[data-change="${side}"]`);
      if (change) change.addEventListener('click', () => togglePicker(side));
      const input = dom[side === 'a' ? 'playerA' : 'playerB'].querySelector(`[data-search="${side}"]`);
      if (input) bindPicker(side, input);
      if (picking[side]) {
        renderOptions(side);
        if (input) input.focus();
      }
    }
  }

  function togglePicker(side) {
    picking[side] = !picking[side];
    const card = side === 'a' ? dom.playerA : dom.playerB;
    const picker = card.querySelector(`[data-picker="${side}"]`);
    const button = card.querySelector(`[data-change="${side}"]`);
    if (picker) picker.hidden = !picking[side];
    if (button) button.setAttribute('aria-expanded', String(picking[side]));
    if (picking[side]) {
      options[side] = [];
      activeOption[side] = -1;
      renderOptions(side);
      const input = card.querySelector(`[data-search="${side}"]`);
      if (input) { input.value = ''; input.focus(); }
    }
  }

  function bindPicker(side, input) {
    input.addEventListener('input', () => {
      clearTimeout(searchTimers[side]);
      const query = input.value.trim();
      if (!query) { options[side] = []; activeOption[side] = -1; renderOptions(side); return; }
      searchTimers[side] = setTimeout(() => { runSearch(side, query); }, 220);
    });
    input.addEventListener('keydown', event => handlePickerKey(side, event));
  }

  function handlePickerKey(side, event) {
    const list = options[side];
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!list.length) return;
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      activeOption[side] = (activeOption[side] + delta + list.length) % list.length;
      renderOptions(side);
      return;
    }
    if (event.key === 'Enter') {
      if (!list.length) return;
      event.preventDefault();
      chooseOption(side, Math.max(0, activeOption[side]));
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      picking[side] = false;
      const card = side === 'a' ? dom.playerA : dom.playerB;
      const picker = card.querySelector(`[data-picker="${side}"]`);
      const button = card.querySelector(`[data-change="${side}"]`);
      if (picker) picker.hidden = true;
      if (button) button.setAttribute('aria-expanded', 'false');
      button?.focus();
    }
  }

  function renderOptions(side) {
    const card = side === 'a' ? dom.playerA : dom.playerB;
    const list = card.querySelector(`#h2hOptions${side.toUpperCase()}`);
    const input = card.querySelector(`[data-search="${side}"]`);
    if (!list) return;
    const items = options[side];
    if (!items.length) {
      list.innerHTML = '<p class="h2h-picker-empty" role="status">输入姓名后从候选里选择一名棋手。同名候选会列出国家、棋院等区分信息。</p>';
      if (input) input.setAttribute('aria-activedescendant', '');
      return;
    }
    list.innerHTML = items.map((item, index) => {
      const meta = [nationName(item.nationality), item.default_kiin || '—',
        item.birth_date ? `生日 ${item.birth_date}` : null,
        item.romanized && item.romanized !== item.name_zh ? item.romanized : null]
        .filter(Boolean).join(' · ');
      const alias = item.matched_alias ? `<span class="h2h-picker-alias">别名：${E(item.matched_alias)}</span>` : '';
      return `<button type="button" class="h2h-picker-option${index === activeOption[side] ? ' active' : ''}"
        role="option" id="h2hOpt${side.toUpperCase()}${index}" aria-selected="${index === activeOption[side]}"
        data-pick-player="${E(item.id)}" data-side="${side}" data-index="${index}">
        <span class="h2h-picker-flag">${flag(item.nationality)}</span>
        <span class="h2h-picker-text"><strong>${E(item.name_zh)}</strong><small>${E(meta)}</small>${alias}</span>
      </button>`;
    }).join('');
    if (input) {
      input.setAttribute('aria-activedescendant', activeOption[side] >= 0
        ? `h2hOpt${side.toUpperCase()}${activeOption[side]}` : '');
    }
    list.querySelectorAll('[data-pick-player]').forEach(button => {
      button.addEventListener('click', () => chooseOption(side, Number(button.dataset.index)));
    });
  }

  async function runSearch(side, query) {
    const token = ++searchTokens[side];
    const card = side === 'a' ? dom.playerA : dom.playerB;
    const list = card.querySelector(`#h2hOptions${side.toUpperCase()}`);
    if (list) list.innerHTML = '<p class="h2h-picker-empty" role="status">正在搜索…</p>';
    try {
      const result = await api('api/head-to-head/players', {q: query, limit: 12});
      if (token !== searchTokens[side]) return;
      options[side] = result.items || [];
      activeOption[side] = options[side].length ? 0 : -1;
      renderOptions(side);
    } catch (error) {
      if (token !== searchTokens[side]) return;
      options[side] = [];
      activeOption[side] = -1;
      if (list) list.innerHTML = `<p class="h2h-picker-empty" role="alert">搜索失败：${E(error.message)}</p>`;
    }
  }

  function chooseOption(side, index) {
    const item = options[side][index];
    if (!item) return;
    if (state[side === 'a' ? 'b' : 'a'] === item.id) {
      setStatus('请选择两名不同棋手。', 'error');
      return;
    }
    state[side] = item.id;
    state.page = 1;
    picking[side] = false;
    options[side] = [];
    activeOption[side] = -1;
    writeUrl(true);
    load();
  }

  // -------------------------------------------------------------------------
  // 概览
  // -------------------------------------------------------------------------

  function segment(key, label, count, total, tone) {
    // 计数为 0 的分段不渲染：空分段带着内边距会在条形图右端留下无意义的色块。
    if (!count) return '';
    const share = total > 0 ? Math.max(0, count / total) : 0;
    const width = `${(share * 100).toFixed(2)}%`;
    return `<span class="h2h-bar-seg h2h-bar-${tone}" style="width:${width}" data-segment="${key}">
      <span class="h2h-bar-label">${E(label)} ${number(count)}</span></span>`;
  }

  // 窄屏放不下条形图内的文字时，用同一份数字与姓名的图例代替，避免裁掉关键信息。
  function barLegend(entries) {
    const items = entries.filter(entry => entry.count > 0);
    if (!items.length) return '';
    return `<ul class="h2h-bar-legend" aria-label="交锋结果图例">${items.map(entry =>
      `<li class="h2h-bar-key h2h-bar-${entry.tone}" data-legend="${entry.key}">
        <i aria-hidden="true"></i><span>${E(entry.label)} ${number(entry.count)}</span></li>`).join('')}</ul>`;
  }

  function renderSummary(payload) {
    const summary = payload.summary || {};
    const a = payload.players?.a?.name_zh || '甲方';
    const b = payload.players?.b?.name_zh || '乙方';
    const barTotal = summary.decided_games + summary.no_result + summary.other_results;
    const bar = barTotal
      ? `<div class="h2h-bar" role="img" aria-label="${E(
        `${a}胜 ${summary.a_wins} 局，${b}胜 ${summary.b_wins} 局，无胜负 ${summary.no_result} 局，其他完成结果 ${summary.other_results} 局`)}">
          ${segment('a_win', `${a} 胜`, summary.a_wins, barTotal, 'a')}
          ${segment('b_win', `${b} 胜`, summary.b_wins, barTotal, 'b')}
          ${segment('no_result', '无胜负', summary.no_result, barTotal, 'nr')}
          ${segment('other_result', '其他完成', summary.other_results, barTotal, 'other')}
        </div>`
      : '<p class="h2h-empty-bar">本库尚未收录双方任何已完成的单局交锋。</p>';
    const onlyScheduled = summary.total_games > 0 && summary.completed_games === 0;
    const recentItems = state.view === 'games' && payload.pagination?.page === 1
      ? (payload.items || []).filter(item => item.winner_side === 'a' || item.winner_side === 'b' || item.outcome === 'no_result').slice(0, 10).reverse()
      : [];
    const recentFormHtml = recentItems.length
      ? `<div class="h2h-recent-form" aria-label="近期交锋走势"><span class="recent-form-label">近期 ${recentItems.length} 局</span><span class="recent-form-dots">${recentItems.map(item => {
          const tone = item.winner_side === 'a' ? 'a' : item.winner_side === 'b' ? 'b' : 'nr';
          const short = item.winner_side === 'a' ? Array.from(a)[0] : item.winner_side === 'b' ? Array.from(b)[0] : '—';
          const who = item.winner_side === 'a' ? `${a} 胜` : item.winner_side === 'b' ? `${b} 胜` : '无胜负';
          const tip = `${dateText(item)} · ${editionText(item)} · ${who}`;
          return `<span class="recent-form-dot h2h-dot--${tone}" title="${E(tip)}" aria-label="${E(tip)}">${E(short)}</span>`;
        }).join('')}</span><span class="recent-form-tail">最新 →</span></div>`
      : '';
    dom.summary.innerHTML = `
      <h2 id="h2hSummaryTitle">交锋概览</h2>
      ${bar}
      ${barLegend([
        {key: 'a_win', label: `${a} 胜`, count: summary.a_wins, tone: 'a'},
        {key: 'b_win', label: `${b} 胜`, count: summary.b_wins, tone: 'b'},
        {key: 'no_result', label: '无胜负', count: summary.no_result, tone: 'nr'},
        {key: 'other_result', label: '其他完成', count: summary.other_results, tone: 'other'},
      ])}
      <ul class="h2h-figures">
        <li data-figure="a_wins"><strong>${number(summary.a_wins)}</strong><span>${E(a)} 胜</span></li>
        <li data-figure="b_wins"><strong>${number(summary.b_wins)}</strong><span>${E(b)} 胜</span></li>
        <li data-figure="no_result"><strong>${number(summary.no_result)}</strong><span>无胜负</span></li>
        <li data-figure="other_results"><strong>${number(summary.other_results)}</strong><span>其他完成结果</span></li>
        <li data-figure="decided_games"><strong>${number(summary.decided_games)}</strong><span>有效胜负局</span></li>
      </ul>
      ${recentFormHtml}
      <p class="h2h-rate" data-figure="a_win_rate">有效胜负局胜率
        <strong>${rate(summary.a_win_rate)}</strong>
        <span>（${E(a)} ${number(summary.a_wins)} 胜 ÷ 有效胜负局 ${number(summary.decided_games)} 局）</span></p>
      <p class="h2h-tally">已完成单局交锋 <strong data-figure="completed_games">${number(summary.completed_games)}</strong> 局
        ＝ 胜负 ${number(summary.decided_games)} ＋ 无胜负 ${number(summary.no_result)} ＋ 其他完成 ${number(summary.other_results)}；
        另列待赛 ${number(summary.scheduled)} 局、赛果待补 ${number(summary.pending)} 局、统计待核 ${number(summary.review)} 条。</p>
      ${onlyScheduled ? `<p class="h2h-callout">当前范围只有待赛或赛果待补记录，尚无已完成的单局交锋；这些记录不计入胜率。</p>` : ''}`;
  }

  function renderColors(payload) {
    const groups = payload.color_breakdown || [];
    const a = payload.players?.a?.name_zh || '甲方';
    const b = payload.players?.b?.name_zh || '乙方';
    const rows = groups.map(group => {
      const total = group.a_wins + group.b_wins + group.no_result + group.other_results;
      const width = value => total > 0 ? `${(value / total * 100).toFixed(2)}%` : '0%';
      return `<tr data-color-group="${group.key}">
        <th scope="row">${E(group.label)}</th>
        <td class="h2h-color-games">${number(group.games)} 局</td>
        <td class="h2h-color-bar-cell">
          <span class="h2h-mini-bar" aria-hidden="true">
            <i class="h2h-mini-a" style="width:${width(group.a_wins)}"></i>
            <i class="h2h-mini-b" style="width:${width(group.b_wins)}"></i>
            <i class="h2h-mini-nr" style="width:${width(group.no_result)}"></i>
          </span>
        </td>
        <td>${E(a)} 胜 ${number(group.a_wins)}</td>
        <td>${E(b)} 胜 ${number(group.b_wins)}</td>
        <td>无胜负 ${number(group.no_result)}</td>
        ${group.other_results ? `<td>其他完成 ${number(group.other_results)}</td>` : '<td></td>'}
      </tr>`;
    }).join('');
    dom.colors.innerHTML = `
      <h2 id="h2hColorsTitle">执色胜负统计</h2>
      <p class="h2h-section-note">未知执色不推定为黑或白，单独计入“执色未载”。</p>
      <div class="h2h-table-wrap" tabindex="0" role="region" aria-label="按执色拆分双方胜负，可横向滚动">
        <table class="h2h-table h2h-color-table">
          <caption class="h2h-visually-hidden">按A方执色拆分双方胜负</caption>
          <thead><tr><th scope="col">执色</th><th scope="col">局数</th><th scope="col">比例</th>
            <th scope="col">${E(a)} 胜</th><th scope="col">${E(b)} 胜</th><th scope="col">无胜负</th><th scope="col">其他</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  // -------------------------------------------------------------------------
  // 筛选
  // -------------------------------------------------------------------------

  function fillSelect(select, entries, value, label) {
    if (!select) return;
    select.innerHTML = entries.map(item =>
      `<option value="${E(item.key)}">${E(item.label)}</option>`).join('');
    select.value = entries.some(item => item.key === value) ? value : (entries[0]?.key || '');
    select.setAttribute('aria-label', label);
  }

  function syncFilters(payload) {
    const facets = payload.facets || {};
    const scope = payload.scope || {};
    const categories = [{key: 'all', label: '全部赛事'}].concat((facets.categories || []).map(item => ({
      key: item.key, label: `${item.label}（${number(item.games)}）`,
    })));
    fillSelect(dom.category, categories, state.category, '赛事类别');

    const tournaments = [{key: '', label: '全部赛事'}].concat((facets.tournaments || []).map(item => ({
      key: item.id, label: `${item.short_name || item.name_zh}（${number(item.games)}）`,
    })));
    fillSelect(dom.tournament, tournaments, state.tournament, '赛事');
    if (state.tournament && !tournaments.some(item => item.key === state.tournament)) {
      state.tournament = '';
      dom.tournament.value = '';
    }

    fillSelect(dom.stage, [{key: 'all', label: '全部赛段'}].concat((facets.stages || []).map(item => ({
      key: item.key, label: `${item.label}（${number(item.games)}）`,
    }))), state.stage, '赛段');

    fillSelect(dom.competition, [{key: 'all', label: '个人与团体'}].concat((facets.competitions || []).map(item => ({
      key: item.key, label: `${item.label}（${number(item.games)}）`,
    }))), state.competition, '赛事范围');

    fillSelect(dom.color, [{key: 'all', label: '全部执色'}].concat((facets.colors || []).map(item => ({
      key: item.key, label: item.label,
    }))), state.color, '执色');

    fillSelect(dom.result, [{key: 'all', label: '全部结果'}].concat((facets.result_filters || []).map(item => ({
      key: item.key, label: item.label,
    }))), state.result, '结果筛选');

    dom.from.value = state.from;
    dom.to.value = state.to;
    dom.unknown.checked = state.unknown;
    dom.sgf.checked = state.sgf;
    if (dom.strict) dom.strict.checked = state.strict;

    // 系列赛页签继承赛事类别／赛事／个人团体与日期；其余单局筛选不适用时停用。
    const seriesView = state.view === 'series';
    for (const control of [dom.color, dom.stage, dom.result, dom.sgf]) {
      if (control) control.disabled = seriesView;
    }
    dom.listHint.textContent = seriesView
      ? '系列赛页签继承赛事类别、赛事与个人／团体范围，并按系列赛时间区间筛选；执色、赛段与单局结果筛选不适用。'
      : '结果与“仅看有棋谱”只筛选下方记录，不改变概览。';
    const notes = [];
    if (seriesView) notes.push('当前为系列赛页签：执色、赛段、单局结果筛选已停用。');
    dom.filterNote.textContent = notes.join(' ');
    dom.filterNote.hidden = !notes.length;
    const presetBar = document.getElementById('h2hQuickPresets');
    if (presetBar) {
      const recent3yFrom = String(new Date().getFullYear() - 2);
      const isAll = state.category === 'all' && !state.tournament && state.stage === 'all'
        && state.competition === 'all' && !state.strict && state.color === 'all' && !state.from && !state.to
        && state.unknown && state.result === 'all' && !state.sgf;
      presetBar.querySelectorAll('[data-h2h-preset]').forEach(btn => {
        const key = btn.dataset.h2hPreset;
        const active = key === 'all' ? isAll
          : key === 'world' ? state.category === 'world'
          : key === 'recent3y' ? state.from === recent3yFrom && !state.to
          : key === 'sgf' ? Boolean(state.sgf) : false;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', String(active));
        if (key === 'sgf') btn.disabled = seriesView;
      });
    }
  }

  // -------------------------------------------------------------------------
  // 逐局列表
  // -------------------------------------------------------------------------

  function gameRow(item, payload) {
    const a = payload.players?.a || {};
    const b = payload.players?.b || {};
    const colorText = item.color_a === 'black' ? `${E(a.name_zh)} 执黑`
      : item.color_a === 'white' ? `${E(a.name_zh)} 执白` : '执色未载';
    const winner = item.winner_side === 'a' ? `${E(a.name_zh)} 胜`
      : item.winner_side === 'b' ? `${E(b.name_zh)} 胜`
      : (item.outcome === 'no_result' ? '无胜负' : item.outcome === 'scheduled' ? '待赛'
        : item.outcome === 'pending' ? '赛果待补' : '未确认');
    const review = item.outcome === 'review'
      ? `<p class="h2h-review">统计待核：${E((item.review_labels || []).join('；') || '需人工确认')}</p>` : '';
    const protect = item.protected
      ? '<span class="h2h-badge h2h-badge-protect" title="用户指定保留，页面只按现有值展示">保留</span>' : '';
    // 赛果文字与状态标签重复时只保留一处，避免“无胜负 无胜负”。
    const detail = String(item.result_text || '').trim();
    const detailHtml = detail && detail !== item.outcome_label && detail !== item.status_label
      ? `<small>${E(detail)}</small>` : '';
    const edition = `index.html?ed=${encodeURIComponent(item.edition_id)}&amp;match=${encodeURIComponent(item.match_id)}`;
    const sgfHref = `${edition}&amp;tab=sgf`;
    return `<tr data-match-id="${E(item.match_id)}" data-edition-id="${E(item.edition_id)}" data-outcome="${E(item.outcome)}">
      <td data-label="日期" class="h2h-date"><span class="h2h-date-value">${E(dateText(item))}</span><small>${E(precisionHint(item))}</small></td>
      <td data-label="赛事／届次"><a href="index.html?ed=${encodeURIComponent(item.edition_id)}">${E(editionText(item))}</a>
        <small>${E(item.edition_year_label || '')}年${item.category_label ? ` · ${E(item.category_label)}` : ''}${item.is_team ? ' · 团体赛' : ''}</small></td>
      <td data-label="轮次"><span>${E(item.round_name || '—')}</span><small>${E(item.stage_label || '')}</small></td>
      <td data-label="执色"><span class="h2h-stone h2h-stone-${item.color_a || 'none'}" title="${E(colorText)}">${item.color_a === 'black' ? '黑' : item.color_a === 'white' ? '白' : '—'}</span>
        <small>${E(colorText)}</small></td>
      <td data-label="胜者"><span class="h2h-winner-${item.winner_side || 'none'}">${winner}</span>
        ${detailHtml}</td>
      <td data-label="赛果"><span class="h2h-status-chip h2h-status-${E(item.outcome)}">${E(item.outcome_label)}</span>
        ${item.result_method_label && item.result_method_label !== item.outcome_label
          ? `<small>${E(item.result_method_label)}</small>` : ''}${protect}</td>
      <td data-label="棋谱" class="h2h-actions">
        ${item.has_sgf
          ? `<a class="btn h2h-btn-sgf" href="${sgfHref}" data-sgf-link="1">棋谱</a>`
          : '<span class="h2h-no-sgf" title="本库尚未关联该局棋谱">无棋谱</span>'}
        <a class="btn" href="${edition}">查看赛事</a>
      </td>
    </tr>${review ? `<tr class="h2h-review-row"><td colspan="7">${review}</td></tr>` : ''}`;
  }

  function renderGames(payload) {
    const items = payload.items || [];
    if (!items.length) {
      dom.listBody.innerHTML = `<p class="h2h-empty">${
        (payload.pagination && payload.pagination.list_filtered)
          ? '当前列表筛选下没有记录；概览仍按公共范围统计。'
          : '当前范围内本库尚未收录双方交锋记录。'}</p>`;
      return;
    }
    dom.listBody.innerHTML = `<div class="h2h-table-wrap" tabindex="0" role="region" aria-label="逐局交锋记录，可横向滚动">
      <table class="h2h-table h2h-games-table">
        <caption class="h2h-visually-hidden">逐局交锋记录，最新在前</caption>
        <thead><tr><th scope="col">日期</th><th scope="col">赛事／届次</th><th scope="col">轮次</th>
          <th scope="col">双方执色</th><th scope="col">胜者</th><th scope="col">赛果</th><th scope="col">记录</th></tr></thead>
        <tbody>${items.map(item => gameRow(item, payload)).join('')}</tbody>
      </table></div>`;
  }

  // -------------------------------------------------------------------------
  // 系列赛列表
  // -------------------------------------------------------------------------

  function seriesCard(entry, payload) {
    const a = payload.players?.a?.name_zh || '甲方';
    const b = payload.players?.b?.name_zh || '乙方';
    const winner = entry.winner_side === 'a' ? a : entry.winner_side === 'b' ? b : null;
    const winnerText = entry.winner_confirmed
      ? `${E(winner || '')}${entry.winner_source === 'calculated' ? '（按已收录子局推算）' : ''}`
      : '胜者未确认';
    const sourceText = {declared: '已保存摘要', matches: '子局摘要', calculated: '按已收录子局推算'}[entry.score_source] || '';
    const gamesLink = `index.html?ed=${encodeURIComponent(entry.edition_id)}`;
    const sample = entry.sample_match_id
      ? `&amp;match=${encodeURIComponent(entry.sample_match_id)}` : '';
    const sgf = entry.sample_sgf
      ? `<a class="btn" href="index.html?ed=${encodeURIComponent(entry.edition_id)}${sample}&amp;tab=sgf" data-sgf-link="1">棋谱</a>` : '';
    return `<article class="h2h-series" data-series-id="${E(entry.series_id)}">
      <header>
        <div>
          <h3><a href="index.html?ed=${encodeURIComponent(entry.edition_id)}${sample}">${E(entry.tournament_short || '')} ${E(entry.edition_label || '')}</a></h3>
          <p class="h2h-series-meta">${E(entry.round_name || '—')}${entry.finals_type ? ` · ${E(entry.finals_type)}` : ''}${entry.single_game_final ? ' · 单局决赛' : ''}${entry.is_team ? ' · 团体赛' : ''}</p>
          <p class="h2h-series-date">${E(entry.date_label || '日期未知')}</p>
        </div>
        <div class="h2h-series-score">
          <strong>${E(entry.declared_score || '—')}</strong>
          <small>${sourceText}</small>
        </div>
      </header>
      <dl class="h2h-series-figures">
        <div><dt>记录总比分</dt><dd data-series-score>${E(entry.declared_score || '—')}</dd></div>
        <div><dt>已收录单局</dt><dd data-series-games>${number(entry.games_total)} 局</dd></div>
        <div><dt>${E(a)} 胜</dt><dd>${number(entry.a_wins)}</dd></div>
        <div><dt>${E(b)} 胜</dt><dd>${number(entry.b_wins)}</dd></div>
        <div><dt>无胜负</dt><dd>${number(entry.no_result)}</dd></div>
        <div><dt>系列赛胜者</dt><dd data-series-winner>${winnerText}</dd></div>
      </dl>
      ${entry.games_total === 0
        ? '<p class="h2h-series-note">只有已保存的总比分与冠军，没有可确认的逐局记录；本页不生成不存在的单局。</p>' : ''}
      ${entry.games_total > 0 && entry.no_result > 0
        ? `<p class="h2h-series-note">已收录 ${number(entry.no_result)} 局无胜负，不计入任何一方胜局。</p>` : ''}
      ${!entry.winner_confirmed
        ? '<p class="h2h-series-note">系列结构与赛制尚不足以确认胜者，只显示已收录局分，不推算总比分。</p>' : ''}
      ${entry.protected ? '<p class="h2h-series-note">本系列含受保护的保留记录。</p>' : ''}
      <footer class="h2h-series-actions">
        <a class="btn" href="${gamesLink}${sample}">查看赛事</a>${sgf}
        <button type="button" class="btn h2h-series-goto" data-games-tournament="${E(entry.tournament_id)}">查看逐局交锋</button>
      </footer>
    </article>`;
  }

  function renderSeries(payload) {
    const items = payload.items || [];
    if (!items.length) {
      dom.listBody.innerHTML = `<p class="h2h-empty">当前范围内本库尚未收录可确认的系列赛交锋。
        无法确认系列关系的记录仍可在“逐局交锋”中查看。</p>`;
      return;
    }
    dom.listBody.innerHTML = `<div class="h2h-series-list">${items.map(entry => seriesCard(entry, payload)).join('')}</div>`;
    dom.listBody.querySelectorAll('[data-games-tournament]').forEach(button => {
      button.addEventListener('click', () => {
        state.view = 'games';
        state.tournament = button.dataset.gamesTournament || '';
        state.page = 1;
        writeUrl(true);
        load();
      });
    });
  }

  // -------------------------------------------------------------------------
  // 分页与说明
  // -------------------------------------------------------------------------

  function renderPager(payload) {
    const pagination = payload.pagination || {page: 1, pages: 1, total: 0};
    const total = pagination.total || 0;
    dom.pager.innerHTML = `
      <button type="button" class="btn" id="h2hPrev" ${pagination.page <= 1 ? 'disabled' : ''}>上一页</button>
      <span class="h2h-page-info" role="status">第 ${pagination.page} / ${Math.max(1, pagination.pages)} 页 ·
        共 ${number(total)} ${state.view === 'series' ? '个系列赛' : '局'}${pagination.list_filtered ? '（列表筛选后）' : ''}</span>
      <button type="button" class="btn" id="h2hNext" ${pagination.page >= pagination.pages ? 'disabled' : ''}>下一页</button>
      <label class="h2h-page-size">每页<select id="h2hPageSize">${SIZE_OPTIONS.map(size =>
        `<option value="${size}"${size === state.size ? ' selected' : ''}>${size}</option>`).join('')}</select>条</label>`;
    $('h2hPrev').addEventListener('click', () => { state.page = Math.max(1, pagination.page - 1); writeUrl(true); load(); });
    $('h2hNext').addEventListener('click', () => { state.page = Math.min(pagination.pages, pagination.page + 1); writeUrl(true); load(); });
    $('h2hPageSize').addEventListener('change', event => {
      state.size = Number(event.target.value) || DEFAULT_SIZE;
      state.page = 1;
      writeUrl(true);
      load();
    });
  }

  function renderNotes(payload) {
    const coverage = payload.coverage || {};
    const notes = coverage.notes || [];
    const scope = payload.scope || {};
    const list = notes.map(note => `<li data-note="${E(note.key)}"><strong>${E(note.label)}：${number(note.count)}</strong>
      <span>${E(note.detail)}</span></li>`).join('');
    dom.notes.innerHTML = `
      <h2 id="h2hNotesTitle">资料说明</h2>
      <p class="h2h-section-note">${E(coverage.scope_note || '')}</p>
      <ul class="h2h-note-list">
        <li>当前范围：${E(scope.category_label || '全部赛事')} · ${E(scope.stage_label || '全部赛段')} ·
          ${E(scope.competition_label || '全部')}${state.strict ? ' · 严格口径' : ''} · ${E(scope.a_color_label || '全部执色')}${state.from || state.to
            ? ` · 日期 ${E(state.from || '不限')} 至 ${E(state.to || '不限')}` : ''}${state.unknown ? '（含未知日期）' : '（不含未知日期）'}。</li>
        ${list}
        <li>胜率只按已保存的明确胜负计算：无胜负、待赛、赛果待补、统计待核与其他完成结果都不进入分母。</li>
        <li>系列赛优先采用已保存的总比分与冠军；摘要与逐局记录分别显示，不覆盖其中任一方。</li>
        <li>逐局记录均可在赛事页定位到原始单局；棋谱按钮只在已有谱时可用。</li>
      </ul>
      <p class="h2h-revision">数据修订 <code>${E(payload.data_revision || '')}</code>${payload.policy_id ? ` · 保护政策 <code>${E(payload.policy_id)}</code>` : ''}</p>`;
  }

  // -------------------------------------------------------------------------
  // 主流程
  // -------------------------------------------------------------------------

  function applyPayload(payload) {
    lastPayload = payload;
    state.page = payload.pagination?.page || state.page;
    state.size = payload.pagination?.page_size || state.size;
    // 已审核别名解析为规范 ID：地址与后续请求都使用规范 ID，原记录不改写。
    if (payload.players?.a?.id && payload.players.a.id !== state.a) state.a = payload.players.a.id;
    if (payload.players?.b?.id && payload.players.b.id !== state.b) state.b = payload.players.b.id;
    writeUrl(false);
    renderPlayers(payload.players);
    renderSummary(payload);
    renderColors(payload);
    syncFilters(payload);
    renderPager(payload);
    renderNotes(payload);
    if (state.view === 'series') renderSeries(payload); else renderGames(payload);
    for (const tab of dom.tabs.querySelectorAll('[data-view]')) {
      const active = tab.dataset.view === state.view;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    }
    showBody(true);
    const summary = payload.summary || {};
    const total = payload.pagination?.total || 0;
    const seriesTotal = payload.coverage?.series_total || 0;
    if (!total && !summary.total_games && !seriesTotal) {
      setStatus('本库尚未收录双方的任何交锋记录。可以更换棋手或放宽筛选范围。', 'empty');
    } else if (!total && payload.pagination?.list_filtered) {
      setStatus('当前列表筛选下没有记录；概览仍按公共范围统计。', 'empty');
    } else if (!total && state.view === 'games' && !summary.total_games && seriesTotal) {
      setStatus('本库只收录了双方的系列赛总比分，没有可确认的逐局记录；请切换到“系列赛交锋”查看。', 'info');
    } else if (!total && state.view === 'series') {
      setStatus('当前范围内暂无系列赛记录。', 'info');
    } else {
      setStatus('');
    }
    document.title = `${payload.players.a.name_zh} 对 ${payload.players.b.name_zh} · 对手交锋 · 国际围棋赛事档案`;
  }

  async function load() {
    const token = ++requestToken;
    dom.retry?.remove();
    dom.retry = null;
    if (!state.a || !state.b) {
      lastPayload = null;
      renderPlayers(null);
      showBody(false);
      const backPlayer = $('h2hBackPlayer');
      if (backPlayer) {
        const targetId = state.a || state.b;
        if (targetId) {
          backPlayer.href = 'player.html?id=' + encodeURIComponent(targetId);
          backPlayer.hidden = false;
        } else {
          backPlayer.hidden = true;
        }
      }
      setStatus(state.a || state.b ? '已固定一名棋手，请选择另一名棋手后查看双方交锋。'
        : '选择两名棋手后查看双方交锋；也可以从棋手资料页进入。', 'info');
      return;
    }
    if (state.a === state.b) {
      showBody(false);
      setStatus('请选择两名不同棋手。', 'error');
      return;
    }
    setStatus('正在读取交锋资料…', 'loading');
    dom.body.setAttribute('aria-busy', 'true');
    try {
      const payload = await api('api/head-to-head', mainParams());
      if (token !== requestToken) return;
      applyPayload(payload);
    } catch (error) {
      if (token !== requestToken) return;
      showBody(false);
      const which = error.payload && error.payload.which;
      if (error.status === 404) {
        setStatus(`${which === 'b' ? '乙方' : which === 'a' ? '甲方' : ''}棋手不存在或已不在资料库中，请重新选择。`, 'error');
      } else if (error.status === 400) {
        setStatus(error.message || '请求参数不正确，请调整筛选条件。', 'error');
      } else {
        setStatus('读取失败，请确认本地服务是否仍在运行。', 'error');
      }
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'btn';
      retry.id = 'h2hRetry';
      retry.textContent = '重试';
      retry.addEventListener('click', load);
      dom.status.after(retry);
      dom.retry = retry;
    } finally {
      if (token === requestToken) dom.body.removeAttribute('aria-busy');
    }
  }

  function switchView(view) {
    if (state.view === view) return;
    state.view = view;
    state.page = 1;
    writeUrl(true);
    if (lastPayload) { load(); return; }
    load();
  }

  function bindControls() {
    dom.swap.addEventListener('click', () => {
      if (!state.a && !state.b) return;
      [state.a, state.b] = [state.b, state.a];
      // 交换双方时保留范围，但把 A 执黑／A 执白互换，保留原来的执色记录集合。
      if (state.color === 'black') state.color = 'white';
      else if (state.color === 'white') state.color = 'black';
      state.page = 1;
      writeUrl(true);
      load();
    });
    dom.tabs.addEventListener('click', event => {
      const tab = event.target.closest('[data-view]');
      if (!tab) return;
      switchView(tab.dataset.view);
    });
    dom.tabs.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      const tabs = [...dom.tabs.querySelectorAll('[data-view]')];
      const index = tabs.findIndex(tab => tab.dataset.view === state.view);
      const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      event.preventDefault();
      next.focus();
      switchView(next.dataset.view);
    });
    dom.filterToggle.addEventListener('click', () => {
      const open = dom.filterBody.classList.toggle('h2h-filters-open');
      dom.filterToggle.setAttribute('aria-expanded', String(open));
      dom.filterToggle.textContent = open ? '收起筛选' : '展开筛选';
    });
    const reload = (key, value, resetPage) => {
      state[key] = value;
      if (resetPage !== false) state.page = 1;
      writeUrl(true);
      load();
    };
    dom.category.addEventListener('change', event => {
      // 换赛事类别后原赛事可能不在范围内，交给服务返回的 facets 校正。
      state.tournament = '';
      reload('category', event.target.value);
    });
    dom.tournament.addEventListener('change', event => reload('tournament', event.target.value));
    dom.stage.addEventListener('change', event => reload('stage', event.target.value));
    dom.competition.addEventListener('change', event => reload('competition', event.target.value));
    dom.color.addEventListener('change', event => reload('color', event.target.value));
    dom.result.addEventListener('change', event => reload('result', event.target.value));
    dom.unknown.addEventListener('change', event => reload('unknown', event.target.checked));
    dom.sgf.addEventListener('change', event => reload('sgf', event.target.checked));
    if (dom.strict) dom.strict.addEventListener('change', event => reload('strict', event.target.checked));
    let dateTimer = 0;
    const dateChanged = () => {
      clearTimeout(dateTimer);
      dateTimer = setTimeout(() => reload('from', dom.from.value.trim(), true), 260);
    };
    dom.from.addEventListener('input', dateChanged);
    dom.to.addEventListener('input', () => {
      clearTimeout(dateTimer);
      dateTimer = setTimeout(() => reload('to', dom.to.value.trim(), true), 260);
    });
    const presetBar = document.getElementById('h2hQuickPresets');
    if (presetBar) {
      presetBar.addEventListener('click', event => {
        const btn = event.target.closest('[data-h2h-preset]');
        if (!btn || btn.disabled) return;
        const key = btn.dataset.h2hPreset;
        const recent3yFrom = String(new Date().getFullYear() - 2);
        if (key === 'all') {
          Object.assign(state, {
            category: 'all', tournament: '', stage: 'all', competition: 'all', strict: false, color: 'all',
            from: '', to: '', unknown: true, result: 'all', sgf: false, page: 1,
          });
        } else if (key === 'world') {
          state.tournament = '';
          state.category = state.category === 'world' ? 'all' : 'world';
          state.page = 1;
        } else if (key === 'recent3y') {
          if (state.from === recent3yFrom && !state.to) {
            state.from = '';
          } else {
            state.from = recent3yFrom;
            state.to = '';
          }
          state.page = 1;
        } else if (key === 'sgf') {
          state.sgf = !state.sgf;
          state.page = 1;
        }
        writeUrl(true);
        load();
      });
    }
    dom.reset.addEventListener('click', () => {
      Object.assign(state, {
        category: 'all', tournament: '', stage: 'all', competition: 'all', strict: false, color: 'all',
        from: '', to: '', unknown: true, result: 'all', sgf: false, page: 1,
      });
      writeUrl(true);
      load();
    });
    window.addEventListener('popstate', () => {
      readUrl();
      load();
    });
    document.addEventListener('click', event => {
      if (!event.target.closest('.h2h-player')) {
        for (const side of ['a', 'b']) {
          if (!picking[side]) continue;
          picking[side] = false;
          const card = side === 'a' ? dom.playerA : dom.playerB;
          const picker = card.querySelector(`[data-picker="${side}"]`);
          const button = card.querySelector(`[data-change="${side}"]`);
          if (picker) picker.hidden = true;
          if (button) button.setAttribute('aria-expanded', 'false');
        }
      }
    });
  }

  function init() {
    dom.status = $('h2hStatus');
    dom.players = $('h2hPlayers');
    dom.playerA = $('h2hPlayerA');
    dom.playerB = $('h2hPlayerB');
    dom.body = $('h2hBody');
    dom.summary = $('h2hSummary');
    dom.colors = $('h2hColors');
    dom.listBody = $('h2hListBody');
    dom.pager = $('h2hPager');
    dom.notes = $('h2hNotes');
    dom.tabs = $('h2hTabs');
    dom.swap = $('h2hSwap');
    dom.filterToggle = $('h2hFilterToggle');
    dom.filterBody = $('h2hFilterBody');
    dom.filterNote = $('h2hFilterNote');
    dom.reset = $('h2hReset');
    dom.category = $('h2hCategory');
    dom.tournament = $('h2hTournament');
    dom.stage = $('h2hStage');
    dom.competition = $('h2hCompetition');
    dom.strict = $('h2hStrict');
    dom.color = $('h2hColor');
    dom.from = $('h2hFrom');
    dom.to = $('h2hTo');
    dom.unknown = $('h2hUnknown');
    dom.result = $('h2hResult');
    dom.sgf = $('h2hSgf');
    dom.listHint = $('h2hListHint');
    if (!window.GoViewerModel || !window.GoViewerFlags) {
      setStatus('页面脚本未能加载，请通过本地服务打开本页。', 'error');
      return;
    }
    readUrl();
    bindControls();
    renderPlayers(null);
    load();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // 供浏览器检查读取当前状态，不参与页面渲染。
  window.GoViewerHeadToHead = {
    state,
    reload: load,
    api,
  };
})();
