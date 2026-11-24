(function () {
  'use strict';
  const M = window.GoViewerModel, E = M.escape;
  const root = document.getElementById('playerProfile');
  if (window.GoViewerTheme) {
    window.GoViewerTheme.init({toggleSelector: '#playerTheme', buttonsRoot: false});
  } else {
    document.getElementById('playerTheme').onclick = () => {
      const theme = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
      document.body.dataset.theme = theme;
      try { localStorage.setItem('go_viewer_theme_v1', theme); } catch (_) {}
    };
  }
  if (location.protocol === 'file:') {
    root.innerHTML = '<h1>无法读取页面资料</h1><p>请通过本地查看器服务访问。</p>';
    return;
  }

  const index = window.TOURNAMENTS_INDEX ||= [];
  const allData = window.ALL_TOURNAMENTS_DATA ||= {};
  const query = new URLSearchParams(location.search).get('id') || '';
  const dataClient = window.GoStatsDataClient;
  const publicMode = dataClient.isPublic;
  const career = window.GoViewerCareer;

  if (!query) {
    root.innerHTML = '<h1>未找到棋手档案</h1><p>请返回赛事档案选择棋手。</p><a class="btn" href="index.html">返回赛事档案</a>';
    return;
  }

  const GAMES_URL_KEYS = {
    q: 'games_q',
    category: 'games_cat',
    color: 'games_color',
    outcome: 'games_outcome',
    sgf_only: 'games_sgf',
    sort: 'games_sort',
    year: 'games_year',
    opp_country: 'games_opp',
    page: 'games_page',
    pageSize: 'games_size'
  };
  const VALID_GAMES_SIZES = [25, 50, 100];

  function readGamesUrlState() {
    const p = new URLSearchParams(location.search);
    const rawYear = parseInt(p.get(GAMES_URL_KEYS.year) || '', 10);
    const rawPage = parseInt(p.get(GAMES_URL_KEYS.page) || '1', 10);
    const rawSize = parseInt(p.get(GAMES_URL_KEYS.pageSize) || '50', 10);
    return {
      q: (p.get(GAMES_URL_KEYS.q) || '').slice(0, 120),
      category: p.get(GAMES_URL_KEYS.category) || 'all',
      color: p.get(GAMES_URL_KEYS.color) || 'all',
      outcome: p.get(GAMES_URL_KEYS.outcome) || 'all',
      sgf_only: ['1', 'true'].includes(String(p.get(GAMES_URL_KEYS.sgf_only) || '').toLowerCase()),
      sort: p.get(GAMES_URL_KEYS.sort) === 'asc' ? 'asc' : 'desc',
      year: Number.isFinite(rawYear) && rawYear >= 1900 && rawYear <= 2100 ? rawYear : null,
      opp_country: (p.get(GAMES_URL_KEYS.opp_country) || '').slice(0, 16),
      page: Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1,
      pageSize: VALID_GAMES_SIZES.includes(rawSize) ? rawSize : 50
    };
  }

  const initialGames = readGamesUrlState();
  const gamesFilterState = {
    q: initialGames.q,
    category: initialGames.category,
    color: initialGames.color,
    outcome: initialGames.outcome,
    sgf_only: initialGames.sgf_only,
    sort: initialGames.sort,
    year: initialGames.year,
    opp_country: initialGames.opp_country
  };
  let gamesPageSize = initialGames.pageSize;
  let gamesPage = initialGames.page;
  let gamesToken = 0;
  let gamesController = null;

  function writeGamesUrl(mode) {
    let url;
    try { url = new URL(location.href); } catch (_) { return; }
    const setOrDel = (k, v) => {
      if (v === null || v === undefined || v === '' || v === false) url.searchParams.delete(k);
      else url.searchParams.set(k, String(v));
    };
    setOrDel(GAMES_URL_KEYS.q, gamesFilterState.q);
    setOrDel(GAMES_URL_KEYS.category, gamesFilterState.category !== 'all' ? gamesFilterState.category : '');
    setOrDel(GAMES_URL_KEYS.color, gamesFilterState.color !== 'all' ? gamesFilterState.color : '');
    setOrDel(GAMES_URL_KEYS.outcome, gamesFilterState.outcome !== 'all' ? gamesFilterState.outcome : '');
    setOrDel(GAMES_URL_KEYS.sgf_only, gamesFilterState.sgf_only ? '1' : '');
    setOrDel(GAMES_URL_KEYS.sort, gamesFilterState.sort !== 'desc' ? gamesFilterState.sort : '');
    setOrDel(GAMES_URL_KEYS.year, gamesFilterState.year);
    setOrDel(GAMES_URL_KEYS.opp_country, gamesFilterState.opp_country);
    setOrDel(GAMES_URL_KEYS.page, gamesPage > 1 ? gamesPage : '');
    setOrDel(GAMES_URL_KEYS.pageSize, gamesPageSize !== 50 ? gamesPageSize : '');
    try {
      if (mode === 'push') history.pushState({playerGames: true}, '', url.href);
      else history.replaceState({playerGames: true}, '', url.href);
    } catch (_) {}
  }

  // 立即渲染带定高占位的骨架，避免首屏等待与大幅布局偏移（CLS）。
  root.innerHTML = `
    <span id="overview" class="player-ratings-anchor" aria-hidden="true"></span>
    <section id="playerOverviewSection" class="player-page-identity player-hero">
      <div class="player-hero-main">
        <div id="playerIdentityHead" class="player-identity-head" aria-busy="true">
          <div class="skeleton-title"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line short"></div>
        </div>
        <div class="player-page-stats" id="playerCareerStats">
          <div data-kpi="titles"><strong>—</strong><span>世界冠军</span></div>
          <div data-kpi="runners"><strong>—</strong><span>世界亚军</span></div>
          <div data-kpi="record"><strong>—</strong><span>生涯战绩</span></div>
          <div data-kpi="rating"><strong>—</strong><span>当前等级分</span></div>
        </div>
      </div>
      <div class="player-hero-aside">
        <a href="#ratings" class="player-hero-sparkline" id="playerHeroSparkline" hidden aria-label="跳转至等级分走势图"></a>
        <div class="player-recent-form" id="playerRecentForm" aria-busy="true">
          <span class="recent-form-label">近 10 局</span>
          <span class="skeleton-dots" aria-hidden="true"></span>
        </div>
      </div>
    </section>
    <span id="ratings" class="player-ratings-anchor" aria-hidden="true"></span>
    <section class="player-career-section player-ratings-section" id="playerRatingsSection" aria-labelledby="playerRatingsTitle"></section>
    <section id="career" class="player-career-section player-career-auto" aria-labelledby="careerTitle">
      <div id="playerCareerTitles"></div>
      <div id="playerCareerAnalytics" class="player-career-analytics" hidden></div>
      <p id="careerLoadStatus" role="status" hidden></p>
      <div id="playerCareerSection" hidden>
        <div class="player-career-heading">
          <div><h2 id="careerTitle">国际战绩</h2></div>
          <div class="player-career-actions">
            <label>赛事范围 <select id="careerCategory"><option value="all">全部国际赛事</option><option value="world">世界大赛</option><option value="women_world">女子世界大赛</option><option value="international">其他国际比赛</option><option value="domestic">国内赛事</option></select></label>
            <button type="button" class="btn career-export-btn" id="btnExportCareer">导出截图</button>
          </div>
        </div>
        <div id="careerMatrix" class="career-matrix-wrap"></div>
        <div class="career-legend" aria-label="战绩图例">
          <span class="career-champion">冠军</span>
          <span class="career-runner">亚军</span>
          <span class="career-third">季军</span>
          <span class="career-fourth">殿军／4强</span>
          <span class="career-ongoing" title="当届尚未产生最终名次">进行中</span>
          <span title="本赛阶段未能取得胜局即止步"><em>斜体 = 未胜一局</em></span>
          <span title="团体赛格子显示个人胜负（胜:负）">胜:负 = 团体赛</span>
          <span title="“—”表示当届暂无对应届次，“?”表示暂无参赛记录，“预选”表示仅见预选赛">? / — / 预选</span>
        </div>
      </div>
    </section>
    <span id="games" class="player-ratings-anchor" aria-hidden="true"></span>
    <section class="player-career-section player-games-section" id="playerGamesSection" aria-labelledby="playerGamesTitle">
      <div class="player-career-heading">
        <div><h2 id="playerGamesTitle">历史对局</h2></div>
        <p class="player-games-summary" id="playerGamesSummary" role="status" aria-busy="true"></p>
      </div>
      <div class="player-games-toolbar" id="playerGamesToolbar">
        <div class="player-games-toolbar-row">
          <label class="player-games-search"><span class="sr-only">搜索对局</span><input type="search" id="gamesQueryInput" placeholder="搜索对局" autocomplete="off" spellcheck="false" value="${E(gamesFilterState.q)}"></label>
          <div class="player-games-chips" role="group" aria-label="快捷筛选">
            <button type="button" class="player-chip" data-games-chip="all">全部</button>
            <button type="button" class="player-chip" data-games-chip="win">胜</button>
            <button type="button" class="player-chip" data-games-chip="loss">负</button>
            <button type="button" class="player-chip" data-games-chip="sgf">有棋谱</button>
            <button type="button" class="player-chip" data-games-chip="world">世界大赛</button>
          </div>
          <details class="player-games-more" id="gamesMoreFilters">
            <summary>更多筛选</summary>
            <div class="player-games-more-body">
              <label><span>类别</span><select id="gamesCategoryFilter"><option value="all">全部类别</option><option value="world">世界大赛</option><option value="women_world">女子世界大赛</option><option value="international">其他国际比赛</option><option value="domestic">国内比赛</option></select></label>
              <label><span>执色</span><select id="gamesColorFilter"><option value="all">全部</option><option value="black">执黑</option><option value="white">执白</option><option value="unknown">执色未知</option></select></label>
              <label><span>赛果</span><select id="gamesResultFilter"><option value="all">全部</option><option value="win">胜</option><option value="loss">负</option><option value="no_result">无胜负</option><option value="scheduled">待赛</option><option value="pending">赛果待补</option></select></label>
              <label class="player-games-check"><input type="checkbox" id="gamesSgfOnly"><span>仅看有棋谱</span></label>
              <label><span>排序</span><select id="gamesSortOrder"><option value="desc">最新优先</option><option value="asc">最早优先</option></select></label>
              <label><span>每页</span><select id="gamesPageSize"><option value="25">25 局</option><option value="50">50 局</option><option value="100">100 局</option></select></label>
            </div>
          </details>
          <button type="button" class="btn btn-small" id="gamesResetFilters" hidden>重置筛选</button>
        </div>
        <div class="player-games-active-pills" id="gamesActivePills" hidden></div>
      </div>
      <div id="playerGamesBody" aria-busy="true">
        <div class="player-games-skeleton" aria-hidden="true"></div>
      </div>
    </section>
    <span id="h2h" class="player-ratings-anchor" aria-hidden="true"></span>
    <section id="playerH2hSection" class="player-career-section player-h2h-section" aria-labelledby="h2hTitle">
      <div class="player-career-heading">
        <div><h2 id="h2hTitle">对手交锋</h2></div>
        <div class="player-h2h-head-actions">
          <div class="player-h2h-sorts" role="group" aria-label="对手排序">
            <button type="button" class="player-chip" data-h2h-sort="decided" aria-pressed="true">交手最多</button>
            <button type="button" class="player-chip" data-h2h-sort="winrate" aria-pressed="false">胜率</button>
            <button type="button" class="player-chip" data-h2h-sort="recent" aria-pressed="false">最近</button>
          </div>
          <a class="btn" id="h2hPickOpponent" href="head-to-head.html?a=${encodeURIComponent(query)}">查看全部交锋</a>
        </div>
      </div>
      <label class="player-h2h-search"><span class="sr-only">搜索对手</span>
        <input type="search" id="h2hOpponentSearch" placeholder="搜索对手" autocomplete="off" spellcheck="false"
               role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="h2hOpponentResults">
      </label>
      <div id="h2hOpponentResults" class="player-h2h-results" role="listbox" aria-label="对手搜索候选" hidden></div>
      <ul class="player-h2h-opponents" id="h2hOpponentList" aria-busy="true">
        <li class="player-h2h-skeleton" aria-hidden="true"></li>
        <li class="player-h2h-skeleton" aria-hidden="true"></li>
        <li class="player-h2h-skeleton" aria-hidden="true"></li>
      </ul>
    </section>`;

  let activePlayer = {id: query, name_zh: ''};
  let latestRatingSummary = null;
  let latestSummaryData = null;
  let aborted = false;

  // 悬停对手链接 150ms 预取对方档案与摘要，提升跳转速度。
  const prefetchedIds = new Set();
  let prefetchTimer = 0;
  root.addEventListener('pointerenter', event => {
    const link = event.target instanceof Element ? event.target.closest('a[href^="player.html?id="]') : null;
    if (!link) return;
    clearTimeout(prefetchTimer);
    prefetchTimer = setTimeout(() => {
      try {
        const u = new URL(link.getAttribute('href'), location.href);
        const targetId = u.searchParams.get('id');
        if (targetId && targetId !== activePlayer.id && !prefetchedIds.has(targetId)) {
          prefetchedIds.add(targetId);
          dataClient.prefetchPlayer?.(targetId);
        }
      } catch (_) {}
    }, 150);
  }, true);
  root.addEventListener('pointerleave', event => {
    if (event.target instanceof Element && event.target.closest('a[href^="player.html?id="]')) {
      clearTimeout(prefetchTimer);
    }
  }, true);

  function syncNavIdentity(scrolledPastHero) {
    const label = document.getElementById('playerNavIdentity');
    if (!label) return;
    if (!scrolledPastHero || !activePlayer.name_zh) {
      label.textContent = '棋手资料';
      return;
    }
    const flag = activePlayer.nationality ? window.GoViewerFlags.html(activePlayer.nationality) : '';
    const ratingBit = latestRatingSummary && Number.isFinite(Number(latestRatingSummary.rating))
      ? ` <small class="player-nav-rating">${Number(latestRatingSummary.rating).toFixed(1)}</small>`
      : '';
    label.innerHTML = `${flag}<span>${E(activePlayer.name_zh)}</span>${ratingBit}`;
  }

  function renderHeroSparkline(payload) {
    const el = document.getElementById('playerHeroSparkline');
    if (!el) return;
    if (!payload || payload.status !== 'ok') {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    const pts = (payload.series || []).filter(item => item.has_rating && Number.isFinite(Number(item.rating)));
    if (pts.length < 2) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    const sampled = pts.length > 60
      ? pts.filter((_, i) => i === 0 || i === pts.length - 1 || i % Math.ceil(pts.length / 60) === 0)
      : pts;
    const vals = sampled.map(p => Number(p.rating));
    const minV = Math.min(...vals);
    const maxV = Math.max(...vals);
    const spanV = Math.max(1, maxV - minV);
    const w = 220, h = 54, padX = 6, padY = 8;
    const coords = sampled.map((p, idx) => {
      const x = padX + (idx / Math.max(1, sampled.length - 1)) * (w - padX * 2);
      const y = padY + (1 - (Number(p.rating) - minV) / spanV) * (h - padY * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const lastCoord = coords[coords.length - 1].split(',');
    const sysName = payload.selected_system?.name || '';
    const lastVal = Number(vals[vals.length - 1]).toFixed(1);
    el.innerHTML = `
      <div class="player-hero-sparkline-head">
        <span>${E(sysName)}走势</span>
        <strong>${E(lastVal)}</strong>
      </div>
      <svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
        <polyline fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linejoin="round" points="${coords.join(' ')}"/>
        <circle cx="${lastCoord[0]}" cy="${lastCoord[1]}" r="3" fill="var(--accent)"/>
      </svg>`;
    el.hidden = false;
  }

  function syncHeroRatings(payload) {
    const ratingCell = document.querySelector('#playerCareerStats [data-kpi="rating"]');
    if (!payload || payload.status !== 'ok') {
      latestRatingSummary = null;
      if (ratingCell) ratingCell.innerHTML = '<strong>—</strong><span>当前等级分</span>';
      renderHeroSparkline(null);
      return;
    }
    const latest = payload.all_time_summary?.latest_valid;
    const ratingVal = latest && Number.isFinite(Number(latest.rating ?? latest.public_rating))
      ? Number(latest.rating ?? latest.public_rating) : null;
    const rankVal = latest && Number.isFinite(Number(latest.rank)) && Number(latest.rank) > 0
      ? Number(latest.rank) : null;
    const sysName = payload.selected_system?.name || '';
    latestRatingSummary = ratingVal !== null ? {rating: ratingVal, rank: rankVal, system: sysName} : null;
    if (ratingCell) {
      const mainText = ratingVal !== null ? ratingVal.toFixed(1) : '—';
      const subText = [sysName, rankVal !== null ? `第 ${rankVal} 名` : ''].filter(Boolean).join(' · ') || '当前等级分';
      ratingCell.innerHTML = `<strong>${E(mainText)}</strong><span>${E(subText)}</span>`;
    }
    renderHeroSparkline(payload);
  }

  function renderRecentFormFromSummary(recentList, streak) {
    const formEl = document.getElementById('playerRecentForm');
    if (!formEl) return;
    formEl.removeAttribute('aria-busy');
    if (!Array.isArray(recentList) || !recentList.length) {
      formEl.hidden = true;
      return;
    }
    const dots = recentList.map(r => {
      const isWin = r.outcome === 'win';
      const dateStr = M.dateKey(r.date) || r.date || '日期未知';
      const tip = `${dateStr} · ${r.tournament || ''} · 对 ${r.opponent_name || '—'}（${r.outcome_label || (isWin ? '胜' : '负')}）`;
      const href = r.hasSgf
        ? `index.html?ed=${encodeURIComponent(r.editionId)}&amp;match=${encodeURIComponent(r.id)}&amp;tab=sgf`
        : `index.html?ed=${encodeURIComponent(r.editionId)}&amp;match=${encodeURIComponent(r.id)}`;
      const sgfAttr = r.hasSgf ? ' data-sgf-link="1"' : '';
      return `<a href="${href}"${sgfAttr} class="recent-form-dot recent-form-dot--${isWin ? 'win' : 'loss'}" title="${E(tip)}" aria-label="${E(tip)}">${isWin ? '胜' : '负'}</a>`;
    }).join('');
    const streakHtml = streak && streak.count >= 2
      ? `<span class="recent-form-streak recent-form-streak--${streak.type === 'win' ? 'win' : 'loss'}">${streak.count} 连${streak.type === 'win' ? '胜' : '负'}</span>`
      : '';
    formEl.innerHTML = `<span class="recent-form-label">近 ${recentList.length} 局</span><span class="recent-form-dots">${dots}</span><span class="recent-form-tail" aria-hidden="true">→</span>${streakHtml}`;
    formEl.hidden = false;
  }

  function renderCareerAnalytics(summary) {
    const container = document.getElementById('playerCareerAnalytics');
    if (!container || !summary) return;
    const years = summary.by_year || [];
    if (!years.length) {
      container.hidden = true;
      return;
    }
    const maxTotal = Math.max(1, ...years.map(y => y.wins + y.losses + (y.no_result || 0)));
    const w = Math.max(560, years.length * 36 + 60);
    const h = 190;
    const padL = 36, padR = 16, padT = 18, padB = 30;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const barStep = plotW / years.length;
    const barW = Math.max(8, Math.min(22, barStep * 0.62));

    const bars = years.map((item, i) => {
      const cx = padL + (i + 0.5) * barStep;
      const x = cx - barW / 2;
      const winH = (item.wins / maxTotal) * plotH;
      const lossH = (item.losses / maxTotal) * plotH;
      const winY = padT + plotH - winH;
      const lossY = winY - lossH;
      const ratePct = item.win_rate != null ? `${Math.round(item.win_rate * 100)}%` : '—';
      const tip = `${item.year}年：${item.wins} 胜 ${item.losses} 负${item.no_result ? ` · 无胜负 ${item.no_result}` : ''}（胜率 ${ratePct}）`;
      const showTick = years.length <= 16 || i === 0 || i === years.length - 1 || item.year % 5 === 0;
      return `
        <g class="career-year-bar" data-year="${item.year}" tabindex="0" role="button" aria-label="${E(tip)}">
          <title>${E(tip)}</title>
          <rect class="career-bar-hit" x="${(cx - barStep / 2).toFixed(1)}" y="${padT}" width="${barStep.toFixed(1)}" height="${plotH}" fill="transparent"/>
          ${item.losses ? `<rect class="career-bar-loss" x="${x.toFixed(1)}" y="${lossY.toFixed(1)}" width="${barW.toFixed(1)}" height="${lossH.toFixed(1)}" rx="1"/>` : ''}
          ${item.wins ? `<rect class="career-bar-win" x="${x.toFixed(1)}" y="${winY.toFixed(1)}" width="${barW.toFixed(1)}" height="${winH.toFixed(1)}" rx="1"/>` : ''}
          ${showTick ? `<text class="career-bar-xlabel" x="${cx.toFixed(1)}" y="${h - 10}" text-anchor="middle">${item.year}</text>` : ''}
        </g>`;
    }).join('');

    const ratePts = years
      .map((item, i) => {
        if (item.win_rate == null) return null;
        const cx = padL + (i + 0.5) * barStep;
        const cy = padT + (1 - item.win_rate) * plotH;
        return `${cx.toFixed(1)},${cy.toFixed(1)}`;
      })
      .filter(Boolean)
      .join(' ');

    const colorRows = [
      ['black', '执黑'],
      ['white', '执白'],
      ['unknown', '执色未知']
    ].map(([key, label]) => ({key, label, data: (summary.by_color || {})[key]}))
      .filter(r => r.data && r.data.total > 0);

    const catRows = [
      ['world', '世界大赛'],
      ['women_world', '女子世界大赛'],
      ['international', '其他国际比赛'],
      ['domestic', '国内比赛']
    ].map(([key, label]) => ({key, label, data: (summary.by_category || {})[key]}))
      .filter(r => r.data && r.data.total > 0);

    const countryRows = (summary.by_opponent_country || []).slice(0, 5).map(c => ({
      key: c.code,
      label: window.GoViewerFlags.info(c.code).name,
      flag: window.GoViewerFlags.html(c.code),
      data: c
    }));

    const breakdownCard = (title, items, filterType) => {
      if (!items.length) return '';
      return `
        <div class="career-breakdown-card">
          <h3>${E(title)}</h3>
          <ul>${items.map(it => {
            const d = it.data;
            const pct = d.win_rate != null ? Math.round(d.win_rate * 100) : 0;
            const rateLabel = d.win_rate != null ? `${pct}%` : '—';
            return `<li>
              <button type="button" class="career-breakdown-row" data-filter-type="${E(filterType)}" data-filter-value="${E(it.key)}">
                <span class="career-breakdown-name">${it.flag || ''}${E(it.label)}</span>
                <span class="career-breakdown-nums">${d.wins}胜 ${d.losses}负 · ${rateLabel}</span>
                <span class="career-winbar" aria-hidden="true"><span style="width:${pct}%"></span></span>
              </button>
            </li>`;
          }).join('')}</ul>
        </div>`;
    };

    container.innerHTML = `
      <div class="career-annual-chart-wrap">
        <div class="career-annual-head">
          <h3>年度胜负</h3>
          <span class="career-annual-legend">
            <span><i class="swatch-win"></i>胜</span>
            <span><i class="swatch-loss"></i>负</span>
            <span><i class="swatch-rate"></i>胜率</span>
          </span>
        </div>
        <div class="career-annual-scroll">
          <svg class="career-annual-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="年度胜负与胜率柱状图">
            <line x1="${padL}" y1="${padT + plotH}" x2="${w - padR}" y2="${padT + plotH}" stroke="var(--border-color)"/>
            <text class="career-bar-ylabel" x="${padL - 6}" y="${padT + 6}" text-anchor="end">${maxTotal}</text>
            <text class="career-bar-ylabel" x="${padL - 6}" y="${padT + plotH}" text-anchor="end">0</text>
            ${bars}
            ${ratePts ? `<polyline class="career-rate-line" fill="none" points="${ratePts}"/>` : ''}
          </svg>
        </div>
      </div>
      <div class="career-breakdown-grid">
        ${breakdownCard('执色胜负', colorRows, 'color')}
        ${breakdownCard('赛事类别', catRows, 'category')}
        ${breakdownCard('对手国家／地区', countryRows, 'opp_country')}
      </div>`;
    container.hidden = false;

    container.querySelectorAll('.career-year-bar').forEach(el => {
      const pickYear = () => {
        const y = Number(el.dataset.year);
        if (!Number.isFinite(y)) return;
        applyExternalGamesFilter({year: y});
      };
      el.addEventListener('click', pickYear);
      el.addEventListener('keydown', ev => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pickYear(); }
      });
    });

    container.querySelectorAll('.career-breakdown-row').forEach(btn => {
      btn.addEventListener('click', () => {
        const fType = btn.dataset.filterType;
        const fVal = btn.dataset.filterValue;
        if (!fType || !fVal) return;
        if (fType === 'color') applyExternalGamesFilter({color: fVal});
        else if (fType === 'category') applyExternalGamesFilter({category: fVal});
        else if (fType === 'opp_country') applyExternalGamesFilter({opp_country: fVal});
      });
    });
  }

  function applySummary(summary) {
    if (!summary || aborted) return;
    latestSummaryData = summary;
    const stats = document.getElementById('playerCareerStats');
    if (stats) {
      const titlesN = summary.world_titles_count ?? 0;
      const runnersN = summary.world_runners_count ?? 0;
      const ov = summary.overall || {};
      const wins = ov.wins ?? 0;
      const losses = ov.losses ?? 0;
      const rateStr = ov.win_rate != null ? `${(ov.win_rate * 100).toFixed(1)}%` : '—';
      const titleCell = stats.querySelector('[data-kpi="titles"]');
      const runnerCell = stats.querySelector('[data-kpi="runners"]');
      const recordCell = stats.querySelector('[data-kpi="record"]');
      if (titleCell) {
        titleCell.innerHTML = titlesN > 0
          ? `<a href="#playerCareerTitles"><strong>${titlesN}</strong><span>世界冠军</span></a>`
          : `<strong>${titlesN}</strong><span>世界冠军</span>`;
      }
      if (runnerCell) runnerCell.innerHTML = `<strong>${runnersN}</strong><span>世界亚军</span>`;
      if (recordCell) {
        const yearsSpan = (summary.career_years || []).length >= 2
          ? `${summary.career_years[0]}—${summary.career_years[1]} · ` : '';
        recordCell.innerHTML = `<strong>${wins}胜 ${losses}负</strong><span>${E(`${yearsSpan}胜率 ${rateStr}`)}</span>`;
      }
      stats.hidden = false;
    }

    const titles = summary.titles || [];
    const titlesEl = document.getElementById('playerCareerTitles');
    if (titlesEl) {
      const titleLinks = titles.map(t => `<a href="index.html?ed=${encodeURIComponent(t.edition_id)}"><strong>${E(t.tournament_short)}</strong><span>${E(t.edition_label)} · ${E(t.year_label || t.year)}年</span><small>${E(t.finals_score || '')}</small></a>`).join('');
      titlesEl.innerHTML = titleLinks
        ? `<section class="player-page-titles"><h2>世界大赛夺冠记录</h2><div class="player-title-list">${titleLinks}</div></section>`
        : '';
    }

    renderRecentFormFromSummary(summary.recent_form, summary.streak);
    renderCareerAnalytics(summary);
    ratingsInstance?.setAnnotations?.(titles);
  }

  // ---------------------------------------------------------------------------
  // 等级分模块挂载（与档案并行，独立只读）
  // ---------------------------------------------------------------------------
  const ratingsSection = document.getElementById('playerRatingsSection');
  let ratingsInstance = null;
  if (ratingsSection && window.GoViewerPlayerRatings) {
    ratingsInstance = window.GoViewerPlayerRatings.mount(ratingsSection, {
      playerId: query,
      playerName: '',
      onArchiveChange: syncHeroRatings
    });
  } else if (ratingsSection) {
    ratingsSection.innerHTML = '<p class="player-ratings-notice">等级分模块加载失败。</p>';
  }

  // ---------------------------------------------------------------------------
  // 历史对局：URL 同步、快捷芯片、局部 tbody 刷新与 AbortController
  // ---------------------------------------------------------------------------
  function syncGamesFilterControls() {
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = Boolean(val);
      else el.value = String(val);
    };
    setVal('gamesQueryInput', gamesFilterState.q);
    setVal('gamesCategoryFilter', gamesFilterState.category);
    setVal('gamesColorFilter', gamesFilterState.color);
    setVal('gamesResultFilter', gamesFilterState.outcome);
    setVal('gamesSgfOnly', gamesFilterState.sgf_only);
    setVal('gamesSortOrder', gamesFilterState.sort);
    setVal('gamesPageSize', gamesPageSize);

    document.querySelectorAll('[data-games-chip]').forEach(btn => {
      const chip = btn.dataset.gamesChip;
      let active = false;
      if (chip === 'all') {
        active = !gamesFilterState.q && gamesFilterState.category === 'all' && gamesFilterState.color === 'all'
          && gamesFilterState.outcome === 'all' && !gamesFilterState.sgf_only
          && !gamesFilterState.year && !gamesFilterState.opp_country;
      } else if (chip === 'win') active = gamesFilterState.outcome === 'win';
      else if (chip === 'loss') active = gamesFilterState.outcome === 'loss';
      else if (chip === 'sgf') active = Boolean(gamesFilterState.sgf_only);
      else if (chip === 'world') active = gamesFilterState.category === 'world';
      btn.setAttribute('aria-pressed', String(active));
    });

    const pills = document.getElementById('gamesActivePills');
    if (pills) {
      const items = [];
      if (gamesFilterState.year) {
        items.push(`<button type="button" class="player-filter-pill" data-clear-pill="year">${gamesFilterState.year} 年 ×</button>`);
      }
      if (gamesFilterState.opp_country) {
        const label = window.GoViewerFlags.info(gamesFilterState.opp_country).name;
        items.push(`<button type="button" class="player-filter-pill" data-clear-pill="opp_country">对手：${E(label)} ×</button>`);
      }
      pills.innerHTML = items.join('');
      pills.hidden = items.length === 0;
    }
  }

  function applyExternalGamesFilter(patch) {
    Object.assign(gamesFilterState, {
      q: '',
      category: 'all',
      color: 'all',
      outcome: 'all',
      sgf_only: false,
      year: null,
      opp_country: ''
    }, patch);
    gamesPage = 1;
    syncGamesFilterControls();
    writeGamesUrl('push');
    renderGames();
    document.getElementById('playerGamesSection')?.scrollIntoView({behavior: 'smooth', block: 'start'});
  }

  function gamesRowHtml(row) {
    const flag = row.opponent.nationality ? window.GoViewerFlags.html(row.opponent.nationality) : '';
    const name = E(row.opponent.name_zh || '—');
    const opponent = row.opponent.id
      ? `<a class="player-games-opponent" href="player.html?id=${encodeURIComponent(row.opponent.id)}">${flag}<span>${name}</span></a>`
      : `<span class="player-games-opponent">${flag}<span>${name}</span></span>`;
    const stone = row.color === 'black' ? 'player-games-stone-black'
      : row.color === 'white' ? 'player-games-stone-white' : 'player-games-stone-none';
    const stoneText = row.color === 'black' ? '黑' : row.color === 'white' ? '白' : '—';
    const tone = row.outcome.key === 'loss' ? 'player-games-loss'
      : row.outcome.key === 'win' ? '' : `table-status-${row.outcome.key}`;
    const detail = row.outcome.detail && row.outcome.detail !== row.outcome.label
      ? `<small>${row.outcome.key === 'loss' ? '对手' : ''}${E(row.outcome.detail)}</small>` : '';
    const link = `index.html?ed=${encodeURIComponent(row.editionId)}&amp;match=${encodeURIComponent(row.id)}`;
    const sgfBtn = row.hasSgf
      ? `<a class="btn btn-small player-games-sgf-btn" href="${link}&amp;tab=sgf" data-sgf-link="1" aria-label="查看棋谱" title="查看棋谱">棋谱</a>`
      : '';
    return `<tr data-player-game="${E(row.id)}" data-edition-id="${E(row.editionId)}">
      <td data-label="日期" class="player-games-date"><a class="player-games-match-link" href="${link}">${E(M.dateKey(row.date) || row.date || '—')}</a></td>
      <td data-label="赛事／届次" class="player-games-edition"><a href="index.html?ed=${encodeURIComponent(row.editionId)}">${E(row.tournament || '—')}</a><small>${E(row.editionMeta || '—')}</small></td>
      <td data-label="轮次">${E(row.roundName || '—')}</td>
      <td data-label="对手">${opponent}</td>
      <td data-label="执色" class="player-games-color"><span class="player-games-stone ${stone}">${stoneText}</span></td>
      <td data-label="赛果" class="player-games-result"><div class="player-games-result-cell"><div class="player-games-result-wrap"><span class="table-status ${tone}">${E(row.outcome.label)}</span>${sgfBtn}</div>${detail}</div></td>
    </tr>`;
  }

  async function renderGames() {
    if (aborted) return;
    const body = document.getElementById('playerGamesBody');
    const summaryEl = document.getElementById('playerGamesSummary');
    if (!body || !summaryEl) return;
    const token = ++gamesToken;
    if (gamesController) gamesController.abort();
    gamesController = new AbortController();

    const {q, category, color, outcome, sgf_only, sort, year, opp_country} = gamesFilterState;
    const isFiltered = Boolean(q || category !== 'all' || color !== 'all' || outcome !== 'all'
      || sgf_only || year || opp_country);
    document.getElementById('gamesResetFilters').hidden = !isFiltered;
    body.setAttribute('aria-busy', 'true');

    let payload;
    try {
      const params = {
        q, category, color, outcome,
        sgf_only: sgf_only ? '1' : undefined,
        sort,
        year: year || undefined,
        opp_country: opp_country || undefined,
        page: gamesPage,
        page_size: gamesPageSize
      };
      payload = await dataClient.playerGames(activePlayer.id || query, params, {controller: gamesController});
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      if (token !== gamesToken || aborted) return;
      body.removeAttribute('aria-busy');
      summaryEl.innerHTML = '<span>对局加载失败</span> <button type="button" class="btn btn-small">重试</button>';
      summaryEl.querySelector('button').onclick = renderGames;
      return;
    }
    if (token !== gamesToken || aborted) return;
    body.removeAttribute('aria-busy');
    summaryEl.removeAttribute('aria-busy');

    const {items: slice, counts, total, page: pagination} = payload;
    const {total: filteredCount, pages: totalPages} = pagination;
    gamesPage = pagination.page;
    const summary = [
      isFiltered ? `筛选 ${filteredCount} / ${total} 局` : `共 ${total} 局`,
      `${counts.win || 0} 胜 ${counts.loss || 0} 负`,
    ];
    for (const [key, label] of [['no_result', '无胜负'], ['scheduled', '待赛'], ['pending', '赛果待补']]) {
      if (counts[key]) summary.push(`${label} ${counts[key]}`);
    }
    summaryEl.textContent = summary.join(' · ');

    const navEl = document.getElementById('playerGamesNav');
    if (navEl && total >= 0) {
      navEl.textContent = `历史对局 ${total}`;
    }

    if (!latestSummaryData && !isFiltered && sort === 'desc' && gamesPage === 1) {
      const recent = slice.filter(r => r.outcome && (r.outcome.key === 'win' || r.outcome.key === 'loss')).slice(0, 10).reverse().map(r => ({
        id: r.id, editionId: r.editionId, date: r.date, tournament: r.tournament,
        opponent_name: r.opponent?.name_zh || '—', outcome: r.outcome.key,
        outcome_label: r.outcome.label, hasSgf: r.hasSgf
      }));
      renderRecentFormFromSummary(recent, null);
    }

    if (!slice.length) {
      body.innerHTML = `<p class="player-games-empty">${isFiltered ? '没有符合筛选条件的对局。' : '暂无对局记录。'}</p>`;
      return;
    }

    const pagerHtml = totalPages > 1 ? `<div class="table-pager player-games-pager">
      <button class="btn" type="button" id="playerGamesPrev" ${gamesPage <= 1 ? 'disabled' : ''}>上一页</button>
      <span id="playerGamesPageInfo">${gamesPage} / ${totalPages}</span>
      <button class="btn" type="button" id="playerGamesNext" ${gamesPage >= totalPages ? 'disabled' : ''}>下一页</button>
    </div>` : '';

    const rowsHtml = slice.map(gamesRowHtml).join('');
    const existingTbody = body.querySelector('.player-games-table tbody');
    if (existingTbody) {
      existingTbody.innerHTML = rowsHtml;
      const existingPager = body.querySelector('.player-games-pager');
      if (existingPager) existingPager.remove();
      if (pagerHtml) body.insertAdjacentHTML('beforeend', pagerHtml);
    } else {
      const orderLabel = gamesFilterState.sort === 'asc' ? '按日期升序' : '按日期倒序';
      body.innerHTML = `<div class="player-games-scroll" tabindex="0" role="region" aria-label="${E(activePlayer.name_zh || '')}历史对局，可滚动查看">
        <table class="matches-table player-games-table" aria-label="${E(activePlayer.name_zh || '')}历史对局，${orderLabel}，共 ${filteredCount} 局">
          <thead><tr><th scope="col">日期</th><th scope="col">赛事／届次</th><th scope="col">轮次</th><th scope="col">对手</th><th scope="col">执色</th><th scope="col">赛果</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table></div>${pagerHtml}`;
    }

    const prevBtn = document.getElementById('playerGamesPrev');
    const nextBtn = document.getElementById('playerGamesNext');
    if (prevBtn) prevBtn.onclick = () => {
      if (gamesPage > 1) { gamesPage -= 1; writeGamesUrl('replace'); renderGames(); }
    };
    if (nextBtn) nextBtn.onclick = () => {
      if (gamesPage < totalPages) { gamesPage += 1; writeGamesUrl('replace'); renderGames(); }
    };
  }

  const gamesToolbar = document.getElementById('playerGamesToolbar');
  const gamesControls = {
    gamesQueryInput: 'q', gamesCategoryFilter: 'category', gamesColorFilter: 'color',
    gamesResultFilter: 'outcome', gamesSgfOnly: 'sgf_only', gamesSortOrder: 'sort'
  };
  let gamesSearchTimer;
  function refreshGames(push = false) {
    clearTimeout(gamesSearchTimer);
    gamesPage = 1;
    syncGamesFilterControls();
    writeGamesUrl(push ? 'push' : 'replace');
    renderGames();
  }
  syncGamesFilterControls();

  gamesToolbar.addEventListener('input', event => {
    if (event.target.id !== 'gamesQueryInput') return;
    gamesFilterState.q = event.target.value.trim().slice(0, 120);
    ++gamesToken;
    clearTimeout(gamesSearchTimer);
    gamesSearchTimer = setTimeout(() => refreshGames(false), 180);
  });
  gamesToolbar.addEventListener('change', event => {
    const control = event.target;
    if (control.id === 'gamesQueryInput') return;
    if (control.id === 'gamesPageSize') {
      gamesPageSize = Number(control.value);
    } else {
      const key = gamesControls[control.id];
      if (!key) return;
      gamesFilterState[key] = control.type === 'checkbox' ? control.checked : control.value;
    }
    refreshGames(false);
  });
  gamesToolbar.addEventListener('click', event => {
    const chipBtn = event.target instanceof Element ? event.target.closest('[data-games-chip]') : null;
    if (chipBtn) {
      const chip = chipBtn.dataset.gamesChip;
      if (chip === 'all') {
        Object.assign(gamesFilterState, {q: '', category: 'all', color: 'all', outcome: 'all', sgf_only: false, year: null, opp_country: ''});
      } else if (chip === 'win' || chip === 'loss') {
        gamesFilterState.outcome = gamesFilterState.outcome === chip ? 'all' : chip;
      } else if (chip === 'sgf') {
        gamesFilterState.sgf_only = !gamesFilterState.sgf_only;
      } else if (chip === 'world') {
        gamesFilterState.category = gamesFilterState.category === 'world' ? 'all' : 'world';
      }
      refreshGames(true);
      return;
    }
    const pillBtn = event.target instanceof Element ? event.target.closest('[data-clear-pill]') : null;
    if (pillBtn) {
      const key = pillBtn.dataset.clearPill;
      if (key === 'year') gamesFilterState.year = null;
      else if (key === 'opp_country') gamesFilterState.opp_country = '';
      refreshGames(true);
    }
  });
  document.getElementById('gamesResetFilters').onclick = () => {
    Object.assign(gamesFilterState, {q: '', category: 'all', color: 'all', outcome: 'all', sgf_only: false, year: null, opp_country: ''});
    refreshGames(true);
  };

  window.addEventListener('popstate', () => {
    const next = readGamesUrlState();
    const changed = next.q !== gamesFilterState.q || next.category !== gamesFilterState.category
      || next.color !== gamesFilterState.color || next.outcome !== gamesFilterState.outcome
      || next.sgf_only !== gamesFilterState.sgf_only || next.sort !== gamesFilterState.sort
      || next.year !== gamesFilterState.year || next.opp_country !== gamesFilterState.opp_country
      || next.page !== gamesPage || next.pageSize !== gamesPageSize;
    if (!changed) return;
    Object.assign(gamesFilterState, {
      q: next.q, category: next.category, color: next.color, outcome: next.outcome,
      sgf_only: next.sgf_only, sort: next.sort, year: next.year, opp_country: next.opp_country
    });
    gamesPage = next.page;
    gamesPageSize = next.pageSize;
    syncGamesFilterControls();
    renderGames();
  });

  // ---------------------------------------------------------------------------
  // 生涯战绩矩阵：自动懒加载 + O(1) 索引 + 列高亮与悬停卡 + 白名单截图导出
  // ---------------------------------------------------------------------------
  let hasCareerRows = false;
  let exportingCareer = false;
  let careerLoading = false;
  let careerReady = false;
  let indexById = new Map();

  async function publicCareerMatches(playerId) {
    const matches = [];
    let page = 1;
    for (;;) {
      const result = await dataClient.search({player: playerId, page, page_size: 100, sort: 'date_asc'});
      matches.push(...(result.items || []));
      if (!result.page || !result.page.has_more) break;
      page += 1;
    }
    return matches;
  }

  async function hydratePublicCareer(player) {
    const directory = [];
    const [, matches] = await Promise.all([
      dataClient.catalogAllPages(100, items => directory.push(...items)),
      publicCareerMatches(player.id),
    ]);
    index.splice(0, index.length, ...directory);
    indexById = new Map(index.map(item => [item.id, item]));
    const byEdition = new Map();
    for (const match of matches) {
      if (!byEdition.has(match.edition_id)) byEdition.set(match.edition_id, []);
      byEdition.get(match.edition_id).push(match);
    }
    for (const [editionId, editionMatches] of byEdition) {
      const meta = indexById.get(editionId) || {};
      const sample = editionMatches[0] || {};
      const rounds = new Map();
      for (const match of editionMatches) {
        const key = match.round_id || 'round';
        if (!rounds.has(key)) {
          rounds.set(key, {id: key, edition_id: editionId, round_name: match.round_name || '',
            round_order: match.round_order || 0, matches: []});
        }
        rounds.get(key).matches.push(match);
      }
      allData[editionId] = {
        tournament: {id: meta.tournament_id || sample.tournament_id,
          short_name: meta.tournament_short || sample.tournament_short,
          name_zh: meta.tournament_name || sample.tournament_name,
          category: meta.category || sample.category,
          domestic_country: meta.domestic_country || null},
        edition: {id: editionId, year: meta.year ?? sample.year, edition_number: meta.edition_number ?? sample.edition_number,
          champion_id: meta.champion_id, runner_up_id: meta.runner_up_id,
          third_place_id: meta.third_place_id, fourth_place_id: meta.fourth_place_id,
          finals_score: meta.finals_score, start_date: meta.start_date,
          end_date: meta.end_date},
        champion: {id: meta.champion_id}, runner_up: {id: meta.runner_up_id},
        third_place: {id: meta.third_place_id}, fourth_place: {id: meta.fourth_place_id},
        rounds: [...rounds.values()], roster: []
      };
    }
  }

  async function loadCareer(player) {
    if (publicMode) return hydratePublicCareer(player);
    const payload = await dataClient.playerCareer(player.id, true);
    index.splice(0, index.length, ...payload.catalog);
    indexById = new Map(index.map(item => [item.id, item]));
    Object.assign(allData, payload.editions || {});
  }

  function refreshDomesticOptions() {
    const info = career.resolveDomestic(index, allData, activePlayer);
    const select = document.getElementById('careerCategory');
    if (!select) return info;
    const currentValue = select.value;
    const baseOpt = select.querySelector('option[value="domestic"]');
    if (baseOpt) baseOpt.textContent = `国内赛事（${info.primaryLabel}）`;
    for (const c of info.countries) {
      if (c.code === info.primaryCountry || c.count <= 0) continue;
      const val = `domestic:${c.code}`;
      if (!select.querySelector(`option[value="${val}"]`)) {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = `国内赛事（${c.label}）`;
        select.appendChild(opt);
      }
    }
    if (select.value !== currentValue && [...select.options].some(o => o.value === currentValue)) {
      select.value = currentValue;
    }
    return info;
  }

  function render() {
    const resolvedDomestic = refreshDomesticOptions();
    const categorySelect = document.getElementById('careerCategory');
    const selected = categorySelect.value;
    const isDomestic = selected === 'domestic' || selected.startsWith('domestic:');
    const domesticCode = selected.startsWith('domestic:')
      ? selected.slice('domestic:'.length)
      : resolvedDomestic.primaryCountry;
    const domesticLabel = domesticCode ? career.countryLabel(domesticCode) : '';
    const matrix = isDomestic
      ? career.build(index, allData, activePlayer, {category: 'domestic', country: domesticCode})
      : career.build(index, allData, activePlayer, {category: selected});
    const titleEl = document.getElementById('careerTitle');
    if (titleEl) titleEl.textContent = isDomestic ? '国内战绩' : '国际战绩';
    hasCareerRows = matrix.rows.length > 0;
    const exportBtn = document.getElementById('btnExportCareer');
    if (exportBtn && !exportingCareer) exportBtn.disabled = !hasCareerRows;
    const target = document.getElementById('careerMatrix');
    if (!matrix.rows.length) {
      target.innerHTML = isDomestic
        ? `<p class="career-empty">暂未收录${E(domesticLabel)}国内赛事战绩。</p>`
        : '<p class="career-empty">暂未收录国际赛事战绩。</p>';
      return;
    }
    const cell = ({meta, result}, colIdx) => {
      const prefix = `${meta.tournament_short} ${M.editionLabel(meta)} · ${M.editionYearLabel(meta)}年`;
      if (!result) {
        return `<a class="career-result career-unknown" href="index.html?ed=${encodeURIComponent(meta.id)}" data-col-idx="${colIdx}" title="${E(prefix)}：暂无该棋手参赛记录" aria-label="${E(prefix)}：暂无该棋手参赛记录">?</a>`;
      }
      const title = `${prefix}：${result.label}；${result.detail}`;
      return `<a class="career-result ${result.tone ? `career-${result.tone}` : ''} ${result.ongoing ? 'career-ongoing' : ''} ${result.zeroWins ? 'career-zero-wins' : ''}" href="index.html?ed=${encodeURIComponent(meta.id)}" title="${E(title)}" aria-label="${E(title)}" data-career-edition="${E(meta.id)}" data-col-idx="${colIdx}" data-hover-head="${E(prefix)}" data-hover-stage="${E(result.label)}" data-hover-detail="${E(result.detail)}">${E(result.label)}${result.ongoing ? '<small>进行中</small>' : ''}</a>`;
    };
    const tableTitle = isDomestic
      ? `${activePlayer.name_zh}${domesticLabel}国内赛事年度战绩`
      : `${activePlayer.name_zh}国际赛事年度战绩`;
    const regionLabel = isDomestic
      ? `${activePlayer.name_zh}${domesticLabel}国内战绩表，可横向滚动`
      : `${activePlayer.name_zh}国际战绩表，可横向滚动`;
    target.innerHTML = `<div class="career-scroll" tabindex="0" role="region" aria-label="${E(regionLabel)}"><table class="career-matrix"><caption>${E(tableTitle)}</caption><thead><tr><th scope="col">赛事</th>${matrix.years.map((y, idx) => `<th scope="col" data-col-idx="${idx}">${y}</th>`).join('')}</tr></thead><tbody>${matrix.rows.map(row => `<tr><th scope="row">${E(row.name)}</th>${row.cells.map((c, idx) => `<td data-col-idx="${idx}">${c.editions.length ? c.editions.map(ed => cell(ed, idx)).join('') : '<span class="career-no-edition" title="该年暂无对应届次">—</span>'}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div id="careerMatrixTooltip" class="career-matrix-tooltip" role="tooltip" hidden></div>`;
  }

  // 战绩矩阵列高亮与悬停卡片（事件委托，无需每次渲染重绑）。
  const matrixWrap = document.getElementById('careerMatrix');
  if (matrixWrap) {
    let activeColIdx = null;
    const setColHighlight = idx => {
      if (activeColIdx === idx) return;
      if (activeColIdx !== null) {
        matrixWrap.querySelectorAll(`[data-col-idx="${activeColIdx}"].is-col-hover`).forEach(el => el.classList.remove('is-col-hover'));
      }
      activeColIdx = idx;
      if (idx !== null) {
        matrixWrap.querySelectorAll(`[data-col-idx="${idx}"]`).forEach(el => el.classList.add('is-col-hover'));
      }
    };
    const showMatrixTip = el => {
      const tip = document.getElementById('careerMatrixTooltip');
      if (!tip || !el.dataset.hoverHead) return;
      tip.innerHTML = `<strong>${E(el.dataset.hoverHead)}</strong><span>${E(el.dataset.hoverStage || '')}</span>${el.dataset.hoverDetail ? `<small>${E(el.dataset.hoverDetail)}</small>` : ''}`;
      tip.hidden = false;
      const wrapRect = matrixWrap.getBoundingClientRect();
      const cellRect = el.getBoundingClientRect();
      const left = Math.max(8, Math.min(wrapRect.width - 230, cellRect.left - wrapRect.left));
      const top = Math.max(8, cellRect.bottom - wrapRect.top + 6);
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
    };
    const hideMatrixTip = () => {
      const tip = document.getElementById('careerMatrixTooltip');
      if (tip) tip.hidden = true;
    };
    matrixWrap.addEventListener('mouseover', event => {
      const target = event.target instanceof Element ? event.target : null;
      const cellEl = target?.closest('[data-col-idx]');
      setColHighlight(cellEl ? cellEl.dataset.colIdx : null);
      const resEl = target?.closest('a.career-result[data-hover-head]');
      if (resEl) showMatrixTip(resEl);
      else hideMatrixTip();
    });
    matrixWrap.addEventListener('mouseout', event => {
      const rel = event.relatedTarget instanceof Element ? event.relatedTarget : null;
      if (!rel || !matrixWrap.contains(rel)) {
        setColHighlight(null);
        hideMatrixTip();
      }
    });
    matrixWrap.addEventListener('focusin', event => {
      const resEl = event.target instanceof Element ? event.target.closest('a.career-result[data-hover-head]') : null;
      if (resEl) {
        setColHighlight(resEl.dataset.colIdx);
        showMatrixTip(resEl);
      }
    });
    matrixWrap.addEventListener('focusout', () => {
      setColHighlight(null);
      hideMatrixTip();
    });
  }

  const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const EXPORT_STYLE_WHITELIST = [
    'box-sizing', 'display', 'flex-direction', 'flex-wrap', 'align-items', 'justify-content', 'gap',
    'width', 'min-width', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'background-color', 'color', 'border-top-width', 'border-top-style', 'border-top-color',
    'border-right-width', 'border-right-style', 'border-right-color',
    'border-bottom-width', 'border-bottom-style', 'border-bottom-color',
    'border-left-width', 'border-left-style', 'border-left-color', 'border-radius',
    'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
    'text-align', 'text-decoration', 'white-space', 'vertical-align',
    'border-collapse', 'border-spacing', 'opacity'
  ];

  function copyStyled(source, copy) {
    const style = getComputedStyle(source);
    for (const key of EXPORT_STYLE_WHITELIST) {
      const val = style.getPropertyValue(key);
      if (val) copy.style.setProperty(key, val);
    }
    copy.style.transition = 'none';
    copy.style.animation = 'none';
    copy.style.caretColor = 'transparent';
    for (const attr of [...copy.attributes]) {
      if (/^on/i.test(attr.name) || attr.name === 'id' || attr.name.startsWith('data-')) copy.removeAttribute(attr.name);
    }
    if (style.position === 'sticky') copy.style.position = 'static';
    if (copy.tagName === 'A') copy.removeAttribute('href');
    if (source.tagName === 'TABLE') copy.style.removeProperty('height');
    [...source.children].forEach((child, i) => {
      if (copy.children[i]) copyStyled(child, copy.children[i]);
    });
  }

  async function rasterizeSvg(svgText, width, height) {
    const image = new Image();
    image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('截图生成失败，请稍后重试。'));
    });
    const scale = Math.min(2, 16384 / Math.max(width, height), Math.sqrt(24000000 / (width * height)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('浏览器无法生成 PNG 截图。');
    ctx.scale(scale, scale);
    ctx.drawImage(image, 0, 0);
    return new Promise((resolve, reject) => canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('PNG 生成失败，请稍后重试。')),
      'image/png'
    ));
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function exportCareerSnapshot() {
    const section = document.getElementById('playerCareerSection');
    const liveTable = section?.querySelector('.career-matrix');
    const liveSelect = document.getElementById('careerCategory');
    if (!section || !liveTable || !liveSelect || exportingCareer) return;
    const exportBtn = document.getElementById('btnExportCareer');
    exportingCareer = true;
    if (exportBtn) {
      exportBtn.disabled = true;
      exportBtn.textContent = '导出中…';
    }
    try {
      if (document.fonts?.ready) await document.fonts.ready;
      await nextFrame();
      const sectionStyle = getComputedStyle(section);
      const padX = (parseFloat(sectionStyle.paddingLeft) || 0)
        + (parseFloat(sectionStyle.paddingRight) || 0)
        + (parseFloat(sectionStyle.borderLeftWidth) || 0)
        + (parseFloat(sectionStyle.borderRightWidth) || 0);
      const tableWidth = Math.ceil(Math.max(liveTable.scrollWidth, liveTable.offsetWidth));
      const minSectionWidth = Math.ceil(section.getBoundingClientRect().width);
      const targetWidth = Math.max(minSectionWidth, tableWidth + Math.ceil(padX) + 2);

      const copy = section.cloneNode(true);
      copyStyled(section, copy);
      copy.querySelector('.career-export-btn')?.remove();
      copy.querySelector('.career-matrix-tooltip')?.remove();

      const copySelect = copy.querySelector('select');
      const scopeLabel = liveSelect.options[liveSelect.selectedIndex]?.textContent?.trim() || '战绩';
      if (copySelect) {
        const selStyle = getComputedStyle(liveSelect);
        const badge = document.createElement('span');
        badge.textContent = scopeLabel;
        Object.assign(badge.style, {
          display: 'inline-block',
          padding: selStyle.padding,
          backgroundColor: selStyle.backgroundColor,
          color: selStyle.color,
          border: selStyle.border,
          borderRadius: selStyle.borderRadius,
          font: selStyle.font,
          lineHeight: selStyle.lineHeight,
          whiteSpace: 'nowrap'
        });
        copySelect.replaceWith(badge);
      }

      for (const el of copy.querySelectorAll('.player-career-heading, .player-career-heading > div, .player-career-actions, .player-career-actions label, .career-legend')) {
        Object.assign(el.style, {width: 'auto', maxWidth: 'none', height: 'auto'});
      }
      const copyScroll = copy.querySelector('.career-scroll');
      if (copyScroll) {
        if (copyScroll.parentElement && copyScroll.parentElement !== copy) {
          Object.assign(copyScroll.parentElement.style, {
            width: 'auto', minWidth: '0', maxWidth: 'none', height: 'auto', minHeight: '0', maxHeight: 'none', overflow: 'visible'
          });
        }
        Object.assign(copyScroll.style, {
          width: 'auto', minWidth: '0', maxWidth: 'none', height: 'auto', minHeight: '0', maxHeight: 'none',
          overflow: 'visible', overflowX: 'visible', overflowY: 'visible'
        });
      }
      const copyTable = copy.querySelector('.career-matrix');
      if (copyTable) {
        Object.assign(copyTable.style, {
          width: '100%', minWidth: tableWidth + 'px', maxWidth: 'none', height: 'auto'
        });
        copyTable.querySelectorAll('caption, thead, tbody, tr, th, td, .career-result').forEach(el => {
          el.style.removeProperty('width');
          el.style.removeProperty('height');
        });
        copyTable.querySelectorAll('th, td').forEach(cell => {
          cell.style.position = 'static';
          cell.style.zIndex = 'auto';
        });
      }
      Object.assign(copy.style, {
        boxSizing: 'border-box', width: targetWidth + 'px', minWidth: '0', maxWidth: 'none',
        height: 'auto', minHeight: '0', maxHeight: 'none', margin: '0', overflow: 'visible', position: 'static'
      });

      const bodyStyle = getComputedStyle(document.body);
      const pageBg = bodyStyle.getPropertyValue('--bg-primary').trim() || bodyStyle.backgroundColor || '#f6f5f2';
      const textColor = bodyStyle.getPropertyValue('--text-main').trim() || bodyStyle.color || '#202124';
      const wrapper = document.createElement('div');
      wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
      Object.assign(wrapper.style, {
        boxSizing: 'border-box', width: (targetWidth + 32) + 'px', padding: '16px', margin: '0',
        background: pageBg, color: textColor, fontFamily: bodyStyle.fontFamily,
        position: 'fixed', left: '-100000px', top: '0', visibility: 'hidden'
      });
      wrapper.appendChild(copy);
      document.body.appendChild(wrapper);
      if (copyTable && copyScroll && copyTable.scrollWidth > copyScroll.clientWidth) {
        const extra = Math.ceil(copyTable.scrollWidth - copyScroll.clientWidth) + 2;
        copy.style.width = (targetWidth + extra) + 'px';
        wrapper.style.width = (targetWidth + extra + 32) + 'px';
      }
      const rect = wrapper.getBoundingClientRect();
      const exportWidth = Math.ceil(rect.width);
      const exportHeight = Math.ceil(rect.height);
      wrapper.remove();
      Object.assign(wrapper.style, {position: 'static', left: 'auto', top: 'auto', visibility: 'visible'});

      const titleText = document.getElementById('careerTitle')?.textContent || '生涯战绩';
      const serialized = new XMLSerializer().serializeToString(wrapper);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${exportWidth}" height="${exportHeight}" viewBox="0 0 ${exportWidth} ${exportHeight}">
        <title>${E(`${activePlayer.name_zh} ${titleText}`)}</title><rect width="100%" height="100%" fill="${pageBg}"/>
        <foreignObject x="0" y="0" width="${exportWidth}" height="${exportHeight}">${serialized}</foreignObject></svg>`;
      const pngBlob = await rasterizeSvg(svg, exportWidth, exportHeight);
      const filename = `${activePlayer.name_zh}_${scopeLabel}_年度战绩`.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') + '.png';
      downloadBlob(pngBlob, filename);
    } finally {
      exportingCareer = false;
      if (exportBtn) {
        exportBtn.textContent = '导出截图';
        exportBtn.disabled = !hasCareerRows;
      }
    }
  }

  document.getElementById('careerCategory').onchange = render;
  document.getElementById('btnExportCareer').onclick = () => {
    exportCareerSnapshot().catch(error => console.error('Career snapshot export failed:', error));
  };

  async function openCareer() {
    if (aborted || careerLoading || careerReady || !activePlayer.name_zh) return;
    const careerStatus = document.getElementById('careerLoadStatus');
    careerLoading = true;
    careerStatus.hidden = false;
    careerStatus.innerHTML = '<div class="player-skeleton-block" aria-busy="true"><div class="skeleton-line"></div><div class="skeleton-chart"></div></div>';
    try {
      await loadCareer(activePlayer);
      if (aborted) return;
      if (!latestSummaryData) {
        const overview = career.build(index, allData, activePlayer);
        const worldResults = overview.results.filter(r => !r.team && M.isWorld(indexById.get(r.editionId) || {}));
        const titles = worldResults.filter(r => r.tone === 'champion');
        const runners = worldResults.filter(r => r.tone === 'runner');
        const stats = document.getElementById('playerCareerStats');
        if (stats) {
          const tCell = stats.querySelector('[data-kpi="titles"]');
          const rCell = stats.querySelector('[data-kpi="runners"]');
          if (tCell) tCell.innerHTML = `<strong>${titles.length}</strong><span>世界冠军</span>`;
          if (rCell) rCell.innerHTML = `<strong>${runners.length}</strong><span>世界亚军</span>`;
        }
        const titleLinks = titles.map(r => {
          const meta = indexById.get(r.editionId);
          return `<a href="index.html?ed=${encodeURIComponent(meta.id)}"><strong>${E(meta.tournament_short)}</strong><span>${E(M.editionLabel(meta))} · ${E(M.editionYearLabel(meta))}年</span><small>${E(meta.finals_score || '')}</small></a>`;
        }).join('');
        const titlesEl = document.getElementById('playerCareerTitles');
        if (titlesEl && titleLinks) {
          titlesEl.innerHTML = `<section class="player-page-titles"><h2>世界大赛夺冠记录</h2><div class="player-title-list">${titleLinks}</div></section>`;
        }
      }
      document.getElementById('playerCareerSection').hidden = false;
      render();
      careerReady = true;
      careerStatus.hidden = true;
    } catch (_) {
      if (aborted) return;
      careerStatus.innerHTML = '生涯战绩加载失败 <button type="button" class="btn btn-small">重试</button>';
      careerStatus.querySelector('button').onclick = openCareer;
    } finally {
      careerLoading = false;
    }
  }

  let careerRequested = false;
  function triggerCareerLoad() {
    careerRequested = true;
    if (activePlayer.name_zh) openCareer();
  }
  const careerSectionEl = document.getElementById('career');
  if (location.hash === '#career') {
    triggerCareerLoad();
  } else if (typeof IntersectionObserver === 'function' && careerSectionEl) {
    const careerIo = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) {
        careerIo.disconnect();
        triggerCareerLoad();
      }
    }, {rootMargin: '300px 0px'});
    careerIo.observe(careerSectionEl);
  } else {
    triggerCareerLoad();
  }
  document.getElementById('playerCareerNav')?.addEventListener('click', triggerCareerLoad);
  window.addEventListener('hashchange', () => {
    if (location.hash === '#career') triggerCareerLoad();
  });

  // ---------------------------------------------------------------------------
  // 吸顶栏导航高亮与滚动头像/姓名联动
  // ---------------------------------------------------------------------------
  if (typeof IntersectionObserver === 'function') {
    const navLinks = Array.from(document.querySelectorAll('.player-page-nav a[data-section-link]'));
    const visibleSections = new Set();
    const io = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) visibleSections.add(entry.target);
        else visibleSections.delete(entry.target);
      });
      const activeId = [...visibleSections].sort((a, b) => a.offsetTop - b.offsetTop)[0]?.id;
      navLinks.forEach(link => {
        const active = link.dataset.sectionLink === activeId;
        link.classList.toggle('is-current', active);
        if (active) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
    }, {rootMargin: `-70px 0px -${Math.round(window.innerHeight / 2)}px 0px`});
    navLinks.forEach(link => {
      const target = document.getElementById(link.dataset.sectionLink);
      if (target) io.observe(target);
    });

    const heroEl = document.getElementById('playerOverviewSection');
    if (heroEl) {
      const heroIo = new IntersectionObserver(entries => {
        const entry = entries[0];
        if (!entry) return;
        syncNavIdentity(!entry.isIntersecting && entry.boundingClientRect.bottom < 70);
      }, {threshold: 0, rootMargin: '-64px 0px 0px 0px'});
      heroIo.observe(heroEl);
    }
  }

  // ---------------------------------------------------------------------------
  // 对手交锋入口：胜率条形图、排序切换与搜索
  // ---------------------------------------------------------------------------
  const opponentList = document.getElementById('h2hOpponentList');
  const searchInput = document.getElementById('h2hOpponentSearch');
  const searchResults = document.getElementById('h2hOpponentResults');
  let searchTimer = 0, searchToken = 0, searchOptions = [], searchActive = -1;
  let loadedOpponents = [];
  let opponentSort = 'decided';

  const h2hLink = opponentId =>
    `head-to-head.html?a=${encodeURIComponent(activePlayer.id || query)}&b=${encodeURIComponent(opponentId)}`;

  function opponentRow(item) {
    const decided = Math.max(1, (item.a_wins || 0) + (item.b_wins || 0));
    const winPct = Math.round(((item.a_wins || 0) / decided) * 100);
    const record = `${item.a_wins} 胜 ${item.b_wins} 负`;
    return `<li><a href="${h2hLink(item.id)}" data-opponent="${E(item.id)}">
      ${window.GoViewerFlags.html(item.nationality)}
      <span class="player-h2h-name">${E(item.name_zh)}</span>
      <span class="player-h2h-record">${record}</span>
      ${item.no_result ? `<span class="player-h2h-nr">无胜负 ${item.no_result}</span>` : ''}
      <span class="player-h2h-bar" aria-hidden="true"><span style="width:${winPct}%"></span></span>
      ${item.last_date ? `<small>${E(item.last_date)}</small>` : ''}
    </a></li>`;
  }

  function renderOpponentsList() {
    if (!opponentList) return;
    if (!loadedOpponents.length) {
      opponentList.innerHTML = '<li class="player-h2h-pending">暂无交锋记录。</li>';
      return;
    }
    const items = loadedOpponents.slice();
    if (opponentSort === 'winrate') {
      items.sort((a, b) => {
        const ra = a.decided ? a.a_wins / a.decided : 0;
        const rb = b.decided ? b.a_wins / b.decided : 0;
        return rb - ra || (b.decided - a.decided);
      });
    } else if (opponentSort === 'recent') {
      items.sort((a, b) => String(b.last_date || '').localeCompare(String(a.last_date || '')) || (b.decided - a.decided));
    } else {
      items.sort((a, b) => (b.decided - a.decided) || (b.a_wins - a.a_wins));
    }
    opponentList.innerHTML = items.slice(0, 12).map(opponentRow).join('');
  }

  document.querySelectorAll('[data-h2h-sort]').forEach(btn => {
    btn.addEventListener('click', () => {
      opponentSort = btn.dataset.h2hSort || 'decided';
      document.querySelectorAll('[data-h2h-sort]').forEach(b => {
        b.setAttribute('aria-pressed', String(b.dataset.h2hSort === opponentSort));
      });
      renderOpponentsList();
    });
  });

  async function loadOpponents() {
    try {
      const payload = await dataClient.opponents({player_id: activePlayer.id || query, limit: 20});
      if (aborted) return;
      opponentList.removeAttribute('aria-busy');
      loadedOpponents = payload.items || [];
      renderOpponentsList();
    } catch (_) {
      if (aborted) return;
      opponentList.removeAttribute('aria-busy');
      opponentList.innerHTML = '<li class="player-h2h-pending">常见对手加载失败，请稍后重试。</li>';
    }
  }

  function renderSearchResults() {
    if (!searchOptions.length) {
      searchResults.hidden = true;
      searchResults.innerHTML = '';
      searchInput.setAttribute('aria-expanded', 'false');
      searchInput.setAttribute('aria-activedescendant', '');
      return;
    }
    searchResults.hidden = false;
    searchInput.setAttribute('aria-expanded', 'true');
    searchResults.innerHTML = searchOptions.map((item, idx) => {
      const meta = [window.GoViewerFlags.info(item.nationality).name, item.default_kiin || '—',
        item.birth_date ? `生日 ${item.birth_date}` : null].filter(Boolean).join(' · ');
      return `<a href="${h2hLink(item.id)}" role="option" id="h2hSearchResult${idx}"
        aria-selected="${idx === searchActive}" data-search-opponent="${E(item.id)}"
        class="player-h2h-result${idx === searchActive ? ' active' : ''}">
        ${window.GoViewerFlags.html(item.nationality)}
        <span><strong>${E(item.name_zh)}</strong><small>${E(meta)}</small></span>
      </a>`;
    }).join('');
    searchInput.setAttribute('aria-activedescendant', searchActive >= 0 ? `h2hSearchResult${searchActive}` : '');
  }

  async function runSearch(term) {
    const token = ++searchToken;
    try {
      const payload = await dataClient.searchPlayers(term, 10);
      if (token !== searchToken) return;
      searchOptions = (payload.items || []).filter(item => item.id !== activePlayer.id);
      searchActive = searchOptions.length ? 0 : -1;
      renderSearchResults();
    } catch (_) {
      if (token !== searchToken) return;
      searchOptions = [];
      searchActive = -1;
      searchResults.hidden = false;
      searchResults.innerHTML = '<p class="player-h2h-pending" role="alert">搜索失败，请稍后重试。</p>';
    }
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const q = searchInput.value.trim();
      if (!q) { searchOptions = []; searchActive = -1; renderSearchResults(); return; }
      searchTimer = setTimeout(() => runSearch(q), 220);
    });
    searchInput.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (!searchOptions.length) return;
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        searchActive = (searchActive + delta + searchOptions.length) % searchOptions.length;
        renderSearchResults();
      } else if (event.key === 'Enter' && searchOptions.length) {
        event.preventDefault();
        location.href = h2hLink(searchOptions[Math.max(0, searchActive)].id);
      } else if (event.key === 'Escape') {
        searchOptions = []; searchActive = -1; renderSearchResults();
      }
    });
  }

  // 并行发起首屏全部请求：profile、summary、games、opponents（ratings 由 mount 异步触发）。
  const profileTask = dataClient.player(query, {page_size: 1}).then(payload => {
    const player = payload?.player;
    if (!player) {
      aborted = true;
      ratingsInstance?.destroy?.();
      if (gamesController) gamesController.abort();
      root.innerHTML = '<h1>未找到棋手档案</h1><p>请返回赛事档案选择棋手。</p><a class="btn" href="index.html">返回赛事档案</a>';
      return null;
    }
    activePlayer = player;
    document.title = `${player.name_zh} · 棋手资料 · 国际围棋赛事档案`;
    const h2hBtn = document.getElementById('h2hPickOpponent');
    if (h2hBtn) h2hBtn.href = `head-to-head.html?a=${encodeURIComponent(player.id)}`;
    const headEl = document.getElementById('playerIdentityHead');
    if (headEl) {
      headEl.removeAttribute('aria-busy');
      const metaLine = [window.GoViewerFlags.info(player.nationality).name, player.default_kiin,
        player.birth_date ? `生于 ${player.birth_date}` : ''].filter(Boolean).map(E).join(' · ');
      headEl.innerHTML = `
        <h1>${window.GoViewerFlags.html(player.nationality)}${E(player.name_zh)}</h1>
        ${M.nativeNameHtml(player)}
        <p class="player-page-meta">${metaLine}</p>
        ${player.profile_note ? `<p class="player-page-note">${E(player.profile_note)}</p>` : ''}`;
    }
    if (careerRequested) openCareer();
    return player;
  }).catch(error => {
    if (error && error.status === 404) {
      aborted = true;
      ratingsInstance?.destroy?.();
      if (gamesController) gamesController.abort();
      root.innerHTML = '<h1>未找到棋手档案</h1><p>请返回赛事档案选择棋手。</p><a class="btn" href="index.html">返回赛事档案</a>';
      return null;
    }
    throw error;
  });

  const summaryTask = dataClient.playerSummary(query)
    .then(summary => { if (summary) applySummary(summary); })
    .catch(() => null);

  renderGames();
  loadOpponents();

  Promise.all([profileTask, summaryTask]).catch(() => {
    if (!aborted) {
      root.innerHTML = '<h1>棋手档案加载失败</h1><p>请刷新页面后重试。</p><a class="btn" href="index.html">返回赛事档案</a>';
    }
  });
})();
