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
    root.innerHTML = '<h1>无法读取页面资料</h1><p>请运行 start_viewer.bat 后访问。</p>';
    return;
  }
  const index = window.TOURNAMENTS_INDEX ||= [];
  const allData = window.ALL_TOURNAMENTS_DATA ||= {};
  const query = new URLSearchParams(location.search).get('id') || '';
  const dataClient = window.GoStatsDataClient;
  const publicMode = dataClient.isPublic;

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
    const byEdition = new Map();
    for (const match of matches) {
      if (!byEdition.has(match.edition_id)) byEdition.set(match.edition_id, []);
      byEdition.get(match.edition_id).push(match);
    }
    for (const [editionId, editionMatches] of byEdition) {
      const meta = index.find(item => item.id === editionId) || {};
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
    Object.assign(allData, payload.editions || {});
  }

  async function start() {
    const payload = query ? await dataClient.player(query, {page_size: 1}).catch(error => {
      if (error.status === 404) return null;
      throw error;
    }) : null;
    const player = payload?.player;
    if (!query || !player) {
      root.innerHTML = '<h1>未找到棋手档案</h1><p>请返回赛事档案选择棋手。</p><a class="btn" href="index.html">返回赛事档案</a>';
      return;
    }
  document.title = `${player.name_zh} · 棋手资料 · 国际围棋赛事档案`;
  const career = window.GoViewerCareer;
  const h2hNav = document.getElementById('playerH2hNav');
  if (h2hNav) h2hNav.href = `head-to-head.html?a=${encodeURIComponent(player.id)}`;
  root.innerHTML = `
    <section class="player-page-identity">
      <h1>${window.GoViewerFlags.html(player.nationality)}${E(player.name_zh)}</h1>
      ${M.nativeNameHtml(player)}
      <p class="player-page-meta">${[window.GoViewerFlags.info(player.nationality).name, player.default_kiin, player.birth_date ? `生于 ${player.birth_date}` : ''].filter(Boolean).map(E).join(' · ')}</p>
      ${player.profile_note ? `<p>${E(player.profile_note)}</p>` : ''}
      <div class="player-page-stats" id="playerCareerStats" hidden></div>
    </section>
    <span id="games" class="player-ratings-anchor" aria-hidden="true"></span>
    <section class="player-career-section player-games-section" id="playerGamesSection" aria-labelledby="playerGamesTitle">
      <div class="player-career-heading">
        <div><h2 id="playerGamesTitle">历史对局</h2><p id="playerGamesSubtitle">按日期倒序排列，最新对局在前</p></div>
        <p class="player-games-summary" id="playerGamesSummary" role="status">加载中…</p>
      </div>
      <div class="player-games-toolbar" id="playerGamesToolbar" hidden>
        <label class="player-games-search"><span class="sr-only">搜索对局</span><input type="search" id="gamesQueryInput" placeholder="搜索对手、赛事、轮次或年份" autocomplete="off" spellcheck="false"></label>
        <label><span>类别</span><select id="gamesCategoryFilter"><option value="all">全部类别</option><option value="world">世界大赛</option><option value="women_world">女子世界大赛</option><option value="international">其他国际比赛</option><option value="domestic">国内比赛</option></select></label>
        <label><span>执色</span><select id="gamesColorFilter"><option value="all">全部</option><option value="black">执黑</option><option value="white">执白</option><option value="unknown">执色未知</option></select></label>
        <label><span>赛果</span><select id="gamesResultFilter"><option value="all">全部</option><option value="win">胜</option><option value="loss">负</option><option value="no_result">无胜负</option><option value="scheduled">待赛</option><option value="pending">赛果待补</option></select></label>
        <label class="player-games-check"><input type="checkbox" id="gamesSgfOnly"><span>仅看有棋谱</span></label>
        <label><span>排序</span><select id="gamesSortOrder"><option value="desc">最新优先</option><option value="asc">最早优先</option></select></label>
        <label><span>每页</span><select id="gamesPageSize"><option value="25">25 局</option><option value="50" selected>50 局</option><option value="100">100 局</option></select></label>
        <button type="button" class="btn btn-small" id="gamesResetFilters" hidden>重置筛选</button>
      </div>
      <div id="playerGamesBody"></div>
    </section>
    <details id="career" class="player-career-disclosure">
      <summary>生涯战绩</summary>
      <p id="careerLoadStatus" role="status" hidden></p>
    <section class="player-career-section" id="playerCareerSection" aria-labelledby="careerTitle" hidden>
      <div class="player-career-heading">
        <div><h2 id="careerTitle">国际战绩</h2></div>
        <div class="player-career-actions">
          <label>赛事范围 <select id="careerCategory"><option value="all">全部国际赛事</option><option value="world">世界大赛</option><option value="women_world">女子世界大赛</option><option value="international">其他国际比赛</option><option value="domestic">国内赛事</option></select></label>
          <button type="button" class="btn career-export-btn" id="btnExportCareer">导出截图</button>
        </div>
      </div>
      <div id="careerMatrix"></div>
      <div class="career-legend" aria-label="战绩图例"><span class="career-champion">冠军</span><span class="career-runner">亚军</span><span class="career-third">季军</span><span class="career-fourth">殿军／4强</span><span class="career-ongoing">进行中</span><span><em>斜体</em>：本赛无胜局出局</span></div>
      <ul class="career-notes"><li>“—”表示当届暂无记录，“?”表示暂无该棋手参赛记录；“预选”表示仅见预选赛，“晋级／待定”表示待定名次。</li><li>团体赛显示个人胜负（胜:负），浅绿底色表示赛事进行中。</li></ul>
    </section>
      <div id="playerCareerTitles"></div>
    </details>
    <span id="ratings" class="player-ratings-anchor" aria-hidden="true"></span>
    <section class="player-career-section player-ratings-section" id="playerRatingsSection" aria-labelledby="playerRatingsTitle">
      <p class="player-ratings-loading" role="status">加载中…</p>
    </section>
    <section class="player-career-section player-h2h-section" aria-labelledby="h2hTitle">
      <div class="player-career-heading">
        <div><h2 id="h2hTitle">对手交锋</h2><p>按有效胜负局排序</p></div>
        <a class="btn" id="h2hPickOpponent" href="head-to-head.html?a=${encodeURIComponent(player.id)}">查看全部交锋</a>
      </div>
      <label class="player-h2h-search">搜索对手
        <input type="search" id="h2hOpponentSearch" placeholder="搜索对手姓名或别名" autocomplete="off" spellcheck="false"
               role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="h2hOpponentResults">
      </label>
      <div id="h2hOpponentResults" class="player-h2h-results" role="listbox" aria-label="对手搜索候选" hidden></div>
      <ul class="player-h2h-opponents" id="h2hOpponentList"><li class="player-h2h-pending">加载中…</li></ul>
      <p class="player-h2h-note" id="h2hOpponentNote" hidden></p>
    </section>`;

  const gamesFilterState = {q: '', category: 'all', color: 'all', outcome: 'all', sgf_only: false, sort: 'desc'};
  let gamesPageSize = 50, gamesPage = 1, gamesToken = 0;
  async function renderGames() {
    const body = document.getElementById('playerGamesBody');
    const summaryEl = document.getElementById('playerGamesSummary');
    const token = ++gamesToken;
    document.getElementById('playerGamesToolbar').hidden = false;
    const {q, category, color, outcome, sgf_only, sort} = gamesFilterState;
    const isFiltered = Boolean(q || category !== 'all' || color !== 'all' || outcome !== 'all' || sgf_only);
    document.getElementById('gamesResetFilters').hidden = !isFiltered;
    document.getElementById('playerGamesSubtitle').textContent = sort === 'asc' ? '最早对局在前' : '最新对局在前';
    body.setAttribute('aria-busy', 'true');
    let payload;
    try {
      payload = await dataClient.playerGames(player.id, {...gamesFilterState, sgf_only: sgf_only ? '1' : undefined,
                                                          page: gamesPage, page_size: gamesPageSize});
    } catch (_) {
      if (token !== gamesToken) return;
      body.removeAttribute('aria-busy');
      summaryEl.innerHTML = '<span>对局加载失败</span> <button type="button" class="btn btn-small">重试</button>';
      summaryEl.querySelector('button').onclick = renderGames;
      return;
    }
    if (token !== gamesToken) return;
    body.removeAttribute('aria-busy');
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
    if (!slice.length) {
      body.innerHTML = `<p class="player-games-empty">${isFiltered ? '没有符合筛选条件的对局。' : '暂无对局记录。'}</p>`;
      return;
    }
    const orderLabel = gamesFilterState.sort === 'asc' ? '按日期升序' : '按日期倒序';
    const href = row => `index.html?ed=${encodeURIComponent(row.editionId)}&amp;match=${encodeURIComponent(row.id)}`;
    const pagerHtml = totalPages > 1 ? `<div class="table-pager player-games-pager">
      <button class="btn" type="button" id="playerGamesPrev" ${gamesPage <= 1 ? 'disabled' : ''}>上一页</button>
      <span id="playerGamesPageInfo">第 ${gamesPage} / ${totalPages} 页（每页 ${gamesPageSize} 局）</span>
      <button class="btn" type="button" id="playerGamesNext" ${gamesPage >= totalPages ? 'disabled' : ''}>下一页</button>
    </div>` : '';
    body.innerHTML = `<div class="player-games-scroll" tabindex="0" role="region" aria-label="${E(player.name_zh)}历史对局，可滚动查看">
      <table class="matches-table player-games-table" aria-label="${E(player.name_zh)}历史对局，${orderLabel}，共 ${filteredCount} 局">
        <thead><tr><th scope="col">日期</th><th scope="col">赛事／届次</th><th scope="col">轮次</th><th scope="col">对手</th><th scope="col">执色</th><th scope="col">赛果</th><th scope="col">详情</th></tr></thead>
        <tbody>${slice.map(row => {
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
          const link = href(row);
          return `<tr data-player-game="${E(row.id)}" data-edition-id="${E(row.editionId)}">
            <td data-label="日期" class="player-games-date">${E(M.dateKey(row.date) || row.date || '—')}</td>
            <td data-label="赛事／届次" class="player-games-edition"><a href="index.html?ed=${encodeURIComponent(row.editionId)}">${E(row.tournament || '—')}</a><small>${E(row.editionMeta || '—')}</small></td>
            <td data-label="轮次">${E(row.roundName || '—')}</td>
            <td data-label="对手">${opponent}</td>
            <td data-label="执色" class="player-games-color"><span class="player-games-stone ${stone}">${stoneText}</span></td>
            <td data-label="赛果" class="player-games-result"><span class="table-status ${tone}">${E(row.outcome.label)}</span>${detail}</td>
            <td data-label="详情" class="player-games-actions"><a class="btn btn-small" href="${link}">详情</a>${row.hasSgf ? `<a class="btn btn-small" href="${link}&amp;tab=sgf">棋谱</a>` : ''}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>${pagerHtml}`;
    const prevBtn = document.getElementById('playerGamesPrev');
    const nextBtn = document.getElementById('playerGamesNext');
    if (prevBtn) prevBtn.onclick = () => { if (gamesPage > 1) { gamesPage -= 1; renderGames(); } };
    if (nextBtn) nextBtn.onclick = () => { if (gamesPage < totalPages) { gamesPage += 1; renderGames(); } };
  }

  // 等级分档案：独立只读模块；失败或未关联都不影响战绩、交锋与夺冠记录。
  const ratingsSection = document.getElementById('playerRatingsSection');
  if (ratingsSection && window.GoViewerPlayerRatings) {
    window.GoViewerPlayerRatings.mount(ratingsSection, {playerId: player.id, playerName: player.name_zh});
  } else if (ratingsSection) {
    ratingsSection.innerHTML = '<p class="player-ratings-notice">等级分模块加载失败。</p>';
  }

  renderGames();
  const gamesToolbar = document.getElementById('playerGamesToolbar');
  const gamesControls = {
    gamesQueryInput: 'q', gamesCategoryFilter: 'category', gamesColorFilter: 'color',
    gamesResultFilter: 'outcome', gamesSgfOnly: 'sgf_only', gamesSortOrder: 'sort'
  };
  let gamesSearchTimer;
  function refreshGames() {
    clearTimeout(gamesSearchTimer);
    gamesPage = 1;
    renderGames();
  }
  gamesToolbar.addEventListener('input', event => {
    if (event.target.id !== 'gamesQueryInput') return;
    gamesFilterState.q = event.target.value.trim().slice(0, 120);
    ++gamesToken;
    clearTimeout(gamesSearchTimer);
    gamesSearchTimer = setTimeout(refreshGames, 180);
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
    refreshGames();
  });
  document.getElementById('gamesResetFilters').onclick = () => {
    Object.assign(gamesFilterState, {q: '', category: 'all', color: 'all', outcome: 'all', sgf_only: false});
    for (const [id, key] of Object.entries(gamesControls)) {
      const control = document.getElementById(id);
      if (control.type === 'checkbox') control.checked = gamesFilterState[key];
      else control.value = gamesFilterState[key];
    }
    refreshGames();
  };

  let hasCareerRows = false;
  let exportingCareer = false;

  function refreshDomesticOptions() {
    const info = career.resolveDomestic(index, allData, player);
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
      ? career.build(index, allData, player, {category: 'domestic', country: domesticCode})
      : career.build(index, allData, player, {category: selected});
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
    const cell = ({meta, result}) => {
      const prefix = `${meta.tournament_short} ${M.editionLabel(meta)} · ${M.editionYearLabel(meta)}年`;
      if (!result) return `<a class="career-result career-unknown" href="index.html?ed=${encodeURIComponent(meta.id)}" title="${E(prefix)}：暂无该棋手参赛记录" aria-label="${E(prefix)}：暂无该棋手参赛记录">?</a>`;
      const title = `${prefix}：${result.label}；${result.detail}`;
      return `<a class="career-result ${result.tone ? `career-${result.tone}` : ''} ${result.ongoing ? 'career-ongoing' : ''} ${result.zeroWins ? 'career-zero-wins' : ''}" href="index.html?ed=${encodeURIComponent(meta.id)}" title="${E(title)}" aria-label="${E(title)}" data-career-edition="${E(meta.id)}">${E(result.label)}${result.ongoing ? '<small>进行中</small>' : ''}</a>`;
    };
    const tableTitle = isDomestic
      ? `${player.name_zh}${domesticLabel}国内赛事年度战绩`
      : `${player.name_zh}国际赛事年度战绩`;
    const regionLabel = isDomestic
      ? `${player.name_zh}${domesticLabel}国内战绩表，可横向滚动`
      : `${player.name_zh}国际战绩表，可横向滚动`;
    target.innerHTML = `<div class="career-scroll" tabindex="0" role="region" aria-label="${E(regionLabel)}"><table class="career-matrix"><caption>${E(tableTitle)}</caption><thead><tr><th scope="col">赛事</th>${matrix.years.map(y => `<th scope="col">${y}</th>`).join('')}</tr></thead><tbody>${matrix.rows.map(row => `<tr><th scope="row">${E(row.name)}</th>${row.cells.map(c => `<td>${c.editions.length ? c.editions.map(cell).join('') : '<span class="career-no-edition" title="该年暂无对应届次">—</span>'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  function copyStyled(source, copy) {
    const style = getComputedStyle(source);
    for (const key of style) {
      if (/^(margin|padding|border|inset)-(block|inline)|^(min-|max-)?(block|inline)-size$/.test(key)) continue;
      copy.style.setProperty(key, style.getPropertyValue(key));
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
      copy.querySelector('.career-notes')?.remove();

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
            width: 'auto',
            minWidth: '0',
            maxWidth: 'none',
            height: 'auto',
            minHeight: '0',
            maxHeight: 'none',
            overflow: 'visible'
          });
        }
        Object.assign(copyScroll.style, {
          width: 'auto',
          minWidth: '0',
          maxWidth: 'none',
          height: 'auto',
          minHeight: '0',
          maxHeight: 'none',
          overflow: 'visible',
          overflowX: 'visible',
          overflowY: 'visible'
        });
      }
      const copyTable = copy.querySelector('.career-matrix');
      if (copyTable) {
        Object.assign(copyTable.style, {
          width: '100%',
          minWidth: tableWidth + 'px',
          maxWidth: 'none',
          height: 'auto'
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
        boxSizing: 'border-box',
        width: targetWidth + 'px',
        minWidth: '0',
        maxWidth: 'none',
        height: 'auto',
        minHeight: '0',
        maxHeight: 'none',
        margin: '0',
        overflow: 'visible',
        position: 'static'
      });

      const bodyStyle = getComputedStyle(document.body);
      const pageBg = bodyStyle.getPropertyValue('--bg-primary').trim() || bodyStyle.backgroundColor || '#f6f5f2';
      const textColor = bodyStyle.getPropertyValue('--text-main').trim() || bodyStyle.color || '#202124';
      const wrapper = document.createElement('div');
      wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
      Object.assign(wrapper.style, {
        boxSizing: 'border-box',
        width: (targetWidth + 32) + 'px',
        padding: '16px',
        margin: '0',
        background: pageBg,
        color: textColor,
        fontFamily: bodyStyle.fontFamily,
        position: 'fixed',
        left: '-100000px',
        top: '0',
        visibility: 'hidden'
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
      Object.assign(wrapper.style, {
        position: 'static',
        left: 'auto',
        top: 'auto',
        visibility: 'visible'
      });

      const titleText = document.getElementById('careerTitle')?.textContent || '生涯战绩';
      const serialized = new XMLSerializer().serializeToString(wrapper);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${exportWidth}" height="${exportHeight}" viewBox="0 0 ${exportWidth} ${exportHeight}">
        <title>${E(`${player.name_zh} ${titleText}`)}</title><rect width="100%" height="100%" fill="${pageBg}"/>
        <foreignObject x="0" y="0" width="${exportWidth}" height="${exportHeight}">${serialized}</foreignObject></svg>`;
      const pngBlob = await rasterizeSvg(svg, exportWidth, exportHeight);
      const filename = `${player.name_zh}_${scopeLabel}_年度战绩`.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') + '.png';
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

  const careerDisclosure = document.getElementById('career');
  const careerStatus = document.getElementById('careerLoadStatus');
  let careerLoading = false, careerReady = false;
  async function openCareer() {
    if (!careerDisclosure.open || careerLoading || careerReady) return;
    careerLoading = true;
    careerStatus.hidden = false;
    careerStatus.textContent = '正在加载生涯战绩…';
    try {
      await loadCareer(player);
      const overview = career.build(index, allData, player);
      const worldResults = overview.results.filter(r => !r.team && M.isWorld(index.find(e => e.id === r.editionId)));
      const titles = worldResults.filter(r => r.tone === 'champion');
      const runners = worldResults.filter(r => r.tone === 'runner');
      const stats = document.getElementById('playerCareerStats');
      stats.innerHTML = `<div><strong>${titles.length}</strong><span>世界大赛冠军</span></div><div><strong>${runners.length}</strong><span>世界大赛亚军</span></div><div><strong>${overview.rows.length}</strong><span>国际赛事</span></div><div><strong>${overview.years.length ? `${overview.years[0]}—${overview.years.at(-1)}` : '—'}</strong><span>参赛年份</span></div>`;
      stats.hidden = false;
      const titleLinks = titles.map(r => {
        const meta = index.find(e => e.id === r.editionId);
        return `<a href="index.html?ed=${encodeURIComponent(meta.id)}"><strong>${E(meta.tournament_short)}</strong><span>${E(M.editionLabel(meta))} · ${E(M.editionYearLabel(meta))}年</span><small>${E(meta.finals_score || '')}</small></a>`;
      }).join('');
      document.getElementById('playerCareerTitles').innerHTML = titleLinks ? `<section class="player-page-titles">
        <h2>世界大赛夺冠记录</h2><div class="player-title-list">${titleLinks}</div></section>` : '';
      document.getElementById('playerCareerSection').hidden = false;
      render();
      careerReady = true;
      careerStatus.hidden = true;
    } catch (_) {
      careerStatus.innerHTML = '生涯战绩加载失败 <button type="button" class="btn btn-small">重试</button>';
      careerStatus.querySelector('button').onclick = openCareer;
    } finally {
      careerLoading = false;
    }
  }
  careerDisclosure.addEventListener('toggle', openCareer);
  const followCareerAnchor = () => {
    if (location.hash === '#career') careerDisclosure.open = true;
  };
  window.addEventListener('hashchange', followCareerAnchor);
  followCareerAnchor();

  // ---------------------------------------------------------------------------
  // 对手交锋入口：常见对手与搜索都走轻量接口，不加载 tournaments_bundle.js。
  // 摘要数量与完整交锋页使用同一统计口径（有效胜负局）。
  // ---------------------------------------------------------------------------
  const opponentList = document.getElementById('h2hOpponentList');
  const opponentNote = document.getElementById('h2hOpponentNote');
  const searchInput = document.getElementById('h2hOpponentSearch');
  const searchResults = document.getElementById('h2hOpponentResults');
  let searchTimer = 0, searchToken = 0, searchOptions = [], searchActive = -1;

  const h2hLink = opponentId =>
    `head-to-head.html?a=${encodeURIComponent(player.id)}&b=${encodeURIComponent(opponentId)}`;

  async function fetchJson(path, params) {
    const url = new URL(path, location.href);
    for (const [key, value] of Object.entries(params || {})) url.searchParams.set(key, String(value));
    const response = await fetch(url, {headers: {Accept: 'application/json'}, cache: 'no-store'});
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error((payload && payload.error) || `HTTP ${response.status}`);
    return payload;
  }

  function opponentRow(item) {
    const record = `${item.a_wins} 胜 ${item.b_wins} 负`;
    return `<li><a href="${h2hLink(item.id)}" data-opponent="${E(item.id)}">
      ${window.GoViewerFlags.html(item.nationality)}
      <span class="player-h2h-name">${E(item.name_zh)}</span>
      <span class="player-h2h-record">${item.decided} 局有效胜负 · ${record}</span>
      ${item.no_result ? `<span class="player-h2h-nr">无胜负 ${item.no_result}</span>` : ''}
      ${item.last_date ? `<small>最近 ${E(item.last_date)}</small>` : ''}
    </a></li>`;
  }

  async function loadOpponents() {
    try {
      const payload = await fetchJson('api/head-to-head/opponents', {player_id: player.id, limit: 12});
      const items = payload.items || [];
      if (!items.length) {
        opponentList.innerHTML = '<li class="player-h2h-pending">暂无交锋记录。</li>';
        return;
      }
      opponentList.innerHTML = items.map(opponentRow).join('');
    } catch (error) {
      opponentList.innerHTML = `<li class="player-h2h-pending">常见对手加载失败，请稍后重试。</li>`;
      if (opponentNote) {
        opponentNote.hidden = false;
        opponentNote.textContent = '请通过本地服务（start_viewer.bat）打开页面。';
      }
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
    searchResults.innerHTML = searchOptions.map((item, index) => {
      const meta = [window.GoViewerFlags.info(item.nationality).name, item.default_kiin || '—',
        item.birth_date ? `生日 ${item.birth_date}` : null].filter(Boolean).join(' · ');
      return `<a href="${h2hLink(item.id)}" role="option" id="h2hSearchResult${index}"
        aria-selected="${index === searchActive}" data-search-opponent="${E(item.id)}"
        class="player-h2h-result${index === searchActive ? ' active' : ''}">
        ${window.GoViewerFlags.html(item.nationality)}
        <span><strong>${E(item.name_zh)}</strong><small>${E(meta)}</small></span>
        <span class="player-h2h-go">查看交锋 →</span></a>`;
    }).join('');
    searchInput.setAttribute('aria-activedescendant', searchActive >= 0 ? `h2hSearchResult${searchActive}` : '');
  }

  async function runSearch(query) {
    const token = ++searchToken;
    try {
      const payload = await fetchJson('api/head-to-head/players', {q: query, limit: 10});
      if (token !== searchToken) return;
      searchOptions = (payload.items || []).filter(item => item.id !== player.id);
      searchActive = searchOptions.length ? 0 : -1;
      renderSearchResults();
    } catch (error) {
      if (token !== searchToken) return;
      searchOptions = [];
      searchActive = -1;
      searchResults.hidden = false;
      searchResults.innerHTML = `<p class="player-h2h-pending" role="alert">搜索失败，请稍后重试。</p>`;
    }
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const query = searchInput.value.trim();
      if (!query) { searchOptions = []; searchActive = -1; renderSearchResults(); return; }
      searchTimer = setTimeout(() => runSearch(query), 220);
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

  loadOpponents();
  }

  start().catch(() => {
    root.innerHTML = '<h1>棋手档案加载失败</h1><p>请刷新页面后重试。</p><a class="btn" href="index.html">返回赛事档案</a>';
  });
})();
