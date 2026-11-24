/* 等级分工作区与治理系统（P1/P2/P4 前端接入）：
 * 提供按体系与月份查榜单、月度对比、单人走势历史、
 * 候选治理（审核绑定/忽略/重置）及批次管理。
 */
(function () {
'use strict';

const esc = (text) => {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const chartIcon = (name, size = 14) => {
  return window.GoViewerRatingsChart?.iconSvg ? window.GoViewerRatingsChart.iconSvg(name, size) : '';
};

const presetFlag = (nat) => {
  return window.GoViewerFlags?.html ? window.GoViewerFlags.html(nat, { size: 15 }) : '';
};

let currentTab = 'ranking';
let currentSystem = 'china';
let currentMonth = null;
let systemsList = [];
let rankingPage = 1;
let rankingLimit = 50;
let candidatePage = 1;
let candidateLimit = 30;
let pendingCompareState = null;
let viewVersion = 0;
let rankingRequest = 0;
let comparisonRequest = 0;
let trendRequest = 0;
let trendViewEvents = null;
let rankingComparePlayers = [];

function isStandalonePage() {
  return Boolean(document.body?.classList.contains('ratings-page') && !document.getElementById('ratingsDialog'));
}

function splitTrendPlayerNames(raw) {
  return String(raw || '').split(/[,，]+/).map(s => s.trim()).filter(Boolean);
}

function readRatingsUrlState() {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get('tab') || 'ranking';
  const system = params.get('system') || 'china';
  const monthRaw = params.get('month');
  const month = monthRaw && /^\d+$/.test(monthRaw) ? Number(monthRaw) : null;
  const baseRaw = params.get('base');
  const targetRaw = params.get('target');
  const base = baseRaw && /^\d+$/.test(baseRaw) ? Number(baseRaw) : null;
  const target = targetRaw && /^\d+$/.test(targetRaw) ? Number(targetRaw) : null;
  const cat = params.get('cat') || 'all';
  const cview = params.get('cview') === 'table' ? 'table' : 'charts';
  const playersRaw = params.get('players') || '';
  const players = splitTrendPlayerNames(playersRaw);
  const mode = params.get('mode') || '';
  const align = params.get('align') === 'union' ? 'union' : 'weekly';
  const view = params.get('view') === 'table' ? 'table' : 'chart';
  const edit = params.get('edit') === '1';
  return { tab, system, month, base, target, cat, cview, players, mode, align, view, edit };
}

function buildStandaloneUrl() {
  const url = new URL('ratings.html', window.location.href);
  url.searchParams.set('tab', currentTab || 'ranking');
  if (currentSystem) url.searchParams.set('system', currentSystem);
  if (currentTab === 'ranking' && currentMonth) {
    url.searchParams.set('month', String(currentMonth));
  }
  if (currentTab === 'compare') {
    const baseEl = document.getElementById('selCompareBase');
    const targetEl = document.getElementById('selCompareTarget');
    const catEl = document.getElementById('selCompareCategory');
    if (baseEl?.value) url.searchParams.set('base', baseEl.value);
    if (targetEl?.value) url.searchParams.set('target', targetEl.value);
    if (catEl?.value && catEl.value !== 'all') url.searchParams.set('cat', catEl.value);
    if (compareViewMode === 'table') url.searchParams.set('cview', 'table');
  }
  if (currentTab === 'trend') {
    const players = currentTrendPlayers;
    if (players && players.length > 0) {
      url.searchParams.set('players', players.join(','));
    }
    if (currentChartMode) url.searchParams.set('mode', currentChartMode);
    if (currentSystem === 'goratings' && goratingsDiffAlign === 'union') {
      url.searchParams.set('align', 'union');
    }
    if (currentViewType === 'table') url.searchParams.set('view', 'table');
  }
  if (document.body.classList.contains('edit-mode') || window.GoViewerEditor?.enabled?.()) {
    url.searchParams.set('edit', '1');
  }
  const themePref = window.GoViewerTheme?.getPreference?.();
  if (themePref) url.searchParams.set('theme', themePref);
  return url;
}

function syncWorkspaceUrlState() {
  const openPageLink = document.getElementById('btnRatingsOpenPage');
  if (openPageLink) {
    openPageLink.href = buildStandaloneUrl().toString();
  }
  if (isStandalonePage()) {
    try {
      const nextUrl = buildStandaloneUrl();
      if (nextUrl.search !== window.location.search) {
        history.replaceState(null, '', nextUrl);
      }
    } catch (_) {}
  }
}

/* 棋手档案跳转：独立工作区把当前视图写入 back，资料页可原样返回。 */
function workspaceBackHref() {
  if (!isStandalonePage()) return '';
  try {
    const url = buildStandaloneUrl();
    return 'ratings.html' + url.search;
  } catch (_) {
    return '';
  }
}

function buildPlayerProfileHref(playerId) {
  const id = String(playerId || '').trim();
  if (!id) return '';
  const params = new URLSearchParams();
  params.set('id', id);
  const back = workspaceBackHref();
  if (back) params.set('back', back);
  return `player.html?${params.toString()}`;
}

function playerProfileLinkHtml(playerId, playerName) {
  const href = buildPlayerProfileHref(playerId);
  if (!href) return '';
  const name = String(playerName || '').trim();
  const label = name ? `查看${name}的棋手档案` : '查看棋手档案';
  return ` <a class="player-profile-link" href="${esc(href)}" title="查看棋手档案" aria-label="${esc(label)}">档案</a>`;
}

function confirmRatingsAction(message, confirmLabel = '确定', danger = false) {
  const editor = window.GoViewerEditor;
  if (editor?.askConfirm) {
    return editor.askConfirm({title: '确认操作', message, confirmLabel, danger});
  }
  const dialog = document.getElementById('ratingsConfirmDialog');
  dialog.querySelector('.ratings-confirm-message').textContent = message;
  const confirmButton = dialog.querySelector('[value="confirm"]');
  confirmButton.textContent = confirmLabel;
  confirmButton.classList.toggle('btn-danger', danger);
  confirmButton.classList.toggle('btn-gold', !danger);
  dialog.returnValue = '';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), {once: true});
    dialog.showModal();
  });
}

function setRatingsStatus(message, isError = false) {
  const el = document.getElementById('ratingsActionStatus');
  const text = String(message || '').trim();
  if (el) {
    el.textContent = text;
    el.classList.toggle('is-error', Boolean(text && isError));
    el.hidden = !text;
  } else if (text) {
    const notice = document.getElementById('viewerNotice');
    if (notice) notice.textContent = text;
  }
  if (text) window.GoViewerEditor?.notify?.(text);
}

function formatDiff(diff, isRank) {
  if (diff === null || diff === undefined) return '<span class="diff-none">-</span>';
  const val = Number(diff);
  if (Math.abs(val) < 1e-6) return '<span class="diff-equal">0</span>';
  if (val > 0) {
    return `<span class="diff-up">↑ ${isRank ? val : val.toFixed(1)}</span>`;
  }
  return `<span class="diff-down">↓ ${isRank ? Math.abs(val) : Math.abs(val).toFixed(1)}</span>`;
}

async function apiGet(path) {
  const resp = await fetch(path, { headers: { 'Accept': 'application/json' } });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `请求失败 (${resp.status})`);
  }
  return resp.json();
}

async function apiPost(path, payload) {
  const meta = window.GoViewerEditor?.metadata() || {};
  const resp = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Editor-Token': meta.token || ''
    },
    body: JSON.stringify(payload)
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data.error || `操作失败 (${resp.status})`);
  }
  return data;
}

async function loadSystems() {
  if (systemsList.length > 0) return systemsList;
  try {
    const res = await apiGet('/api/ratings/systems');
    systemsList = res.systems || [];
    return systemsList;
  } catch (err) {
    console.error('加载等级分体系失败:', err);
    return [];
  }
}

async function loadMonths(systemId) {
  try {
    const res = await apiGet(`/api/ratings/months?system=${encodeURIComponent(systemId)}`);
    return res.months || [];
  } catch (err) {
    console.error('加载月份列表失败:', err);
    return [];
  }
}

function renderTabs() {
  const isEdit = Boolean(document.body.classList.contains('edit-mode') || window.GoViewerEditor?.enabled?.());
  const tabsContainer = document.getElementById('ratingsTabs');
  if (!tabsContainer) return;

  const tabs = [
    { id: 'ranking', label: '月度榜单' },
    { id: 'compare', label: '月度对比' },
    { id: 'trend', label: '棋手走势' },
  ];
  if (isEdit) {
    tabs.push({ id: 'import', label: '等级分导入' });
    tabs.push({ id: 'candidates', label: '候选治理与绑定' });
    tabs.push({ id: 'batches', label: '批次管理' });
  }

  tabsContainer.innerHTML = tabs.map(t => `
    <button class="ratings-tab-btn ${currentTab === t.id ? 'active' : ''}" data-tab="${t.id}" type="button">
      ${esc(t.label)}
    </button>
  `).join('');

  tabsContainer.querySelectorAll('.ratings-tab-btn').forEach(btn => {
    btn.onclick = () => switchTab(btn.dataset.tab);
  });
}

async function switchTab(tabId, targetPlayer = '') {
  const version = ++viewVersion;
  trendViewEvents?.abort();
  trendViewEvents = null;
  currentChartRenderer?.destroy();
  currentChartRenderer = null;
  currentChartData = null;
  currentComparisonRenderer = null;
  currentTab = tabId;
  setRatingsStatus('');
  renderTabs();
  syncWorkspaceUrlState();
  const content = document.getElementById('ratingsContent');
  if (!content) return;
  content.innerHTML = '<div class="ratings-loading">正在读取数据…</div>';

  if (tabId === 'ranking') {
    await renderRankingView();
  } else if (tabId === 'compare') {
    await renderCompareView();
  } else if (tabId === 'trend') {
    await renderTrendView(targetPlayer);
  } else if (tabId === 'import') {
    await renderImportView();
  } else if (tabId === 'candidates') {
    await renderCandidatesView();
  } else if (tabId === 'batches') {
    await renderBatchesView();
  }
  if (version === viewVersion) syncWorkspaceUrlState();
}

// 1. 月度榜单视图
async function renderRankingView() {
  const content = document.getElementById('ratingsContent');
  const version = viewVersion;
  const [systems, months] = await Promise.all([loadSystems(), loadMonths(currentSystem)]);
  if (version !== viewVersion) return;
  if (!months.some(m => m.month_key === currentMonth)) {
    currentMonth = months.at(-1)?.month_key ?? null;
  }

  const isGoRatings = currentSystem === 'goratings';
  content.innerHTML = `
    <div class="ratings-toolbar">
      <div class="ratings-filter-group">
        <label>体系
          <select id="selRankingSystem">
            ${systems.map(s => `<option value="${esc(s.id)}" ${s.id === currentSystem ? 'selected' : ''}>${esc(s.display_name)} (${s.month_count}${s.id === 'goratings' ? '期' : '个月'})</option>`).join('')}
          </select>
        </label>
        <div class="ratings-month-filter">
          <label for="selRankingMonth">${isGoRatings ? '期次' : '月份'}</label>
          <span class="ratings-month-stepper">
            <button class="btn btn-sm ratings-step-btn" id="btnRankPrevMonth" type="button" title="上一期" aria-label="上一期">‹</button>
            <select id="selRankingMonth">
              ${months.slice().reverse().map(m => `<option value="${m.month_key}" ${m.month_key === currentMonth ? 'selected' : ''}>${esc(m.month_str)} (${m.summary?.valid_entries || m.summary?.total_entries || 0}人)</option>`).join('')}
            </select>
            <button class="btn btn-sm ratings-step-btn" id="btnRankNextMonth" type="button" title="下一期" aria-label="下一期">›</button>
          </span>
        </div>
        <label class="ratings-search-label">搜索
          <input type="search" id="txtRankingSearch" placeholder="搜索棋手姓名${isGoRatings ? ' / 英文名' : ''}" autocomplete="off">
        </label>
        <label class="ratings-checkbox-label">
          <input type="checkbox" id="chkValidOnly" checked> 仅看有效分
        </label>
        <button class="btn btn-sm" id="btnExportCurrentMonthCsv" type="button" title="导出当前体系该期次等级分 CSV 表">${chartIcon('download')} 导出 CSV</button>
      </div>
      <div class="ratings-ranking-actions">
        <div class="ratings-stats-badge" id="rankingSnapshotSummary"></div>
        <button type="button" class="btn btn-sm" id="btnOpenRankingCompare" hidden></button>
      </div>
    </div>
    ${isGoRatings ? `<div class="ratings-info-banner" style="margin-bottom: 0.75rem;"><span class="info-icon">${chartIcon('info')}</span><span>GoRatings 采用 WHR 全历史模型按已收录对局估计棋手实力，分值为全对局回算估值。</span></div>` : ''}
    <div class="ratings-table-container" id="rankingTableWrap">
      <div class="ratings-loading">正在加载榜单…</div>
    </div>
    <div class="ratings-pager" id="rankingPager"></div>
  `;

  document.getElementById('selRankingSystem').onchange = (event) => {
    currentSystem = event.target.value;
    currentMonth = null;
    rankingPage = 1;
    switchTab('ranking');
  };

  const monthSelect = document.getElementById('selRankingMonth');
  const prevMonth = document.getElementById('btnRankPrevMonth');
  const nextMonth = document.getElementById('btnRankNextMonth');
  const monthIndex = () => months.findIndex(m => m.month_key === currentMonth);
  const syncMonthButtons = () => {
    const index = monthIndex();
    prevMonth.disabled = index <= 0;
    nextMonth.disabled = index < 0 || index >= months.length - 1;
  };
  const selectMonth = (month) => {
    currentMonth = month;
    monthSelect.value = String(month);
    rankingPage = 1;
    syncMonthButtons();
    syncWorkspaceUrlState();
    fetchAndDisplayRanking();
  };
  syncMonthButtons();
  monthSelect.onchange = () => selectMonth(Number(monthSelect.value));
  prevMonth.onclick = () => selectMonth(months[monthIndex() - 1].month_key);
  nextMonth.onclick = () => selectMonth(months[monthIndex() + 1].month_key);

  document.getElementById('btnOpenRankingCompare').onclick = () => {
    currentTrendPlayers = [...rankingComparePlayers];
    currentChartMode = currentTrendPlayers.length === 2 ? 'two-diff' : 'multi-rating';
    switchTab('trend');
  };
  syncRankingComparison();

  document.getElementById('btnExportCurrentMonthCsv').onclick = () => {
    if (!currentMonth) return;
    window.open(`/api/ratings/export/month?system=${encodeURIComponent(currentSystem)}&month=${currentMonth}`, '_blank');
  };

  let searchTimeout = null;
  document.getElementById('txtRankingSearch').oninput = (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      if (version !== viewVersion) return;
      rankingPage = 1;
      fetchAndDisplayRanking();
    }, 300);
  };

  document.getElementById('chkValidOnly').onchange = () => {
    rankingPage = 1;
    fetchAndDisplayRanking();
  };

  await fetchAndDisplayRanking();
}

function syncRankingComparison() {
  const openButton = document.getElementById('btnOpenRankingCompare');
  if (!openButton) return;
  openButton.hidden = rankingComparePlayers.length === 0;
  openButton.textContent = `查看走势对比（${rankingComparePlayers.length} 人）`;
  document.querySelectorAll('.btn-rank-add-compare').forEach(button => {
    const selected = rankingComparePlayers.includes(button.dataset.player);
    button.classList.toggle('is-added', selected);
    button.setAttribute('aria-pressed', String(selected));
    button.textContent = selected ? '已选' : '+ 对比';
  });
}

async function fetchAndDisplayRanking() {
  const tableWrap = document.getElementById('rankingTableWrap');
  const summaryBadge = document.getElementById('rankingSnapshotSummary');
  const pager = document.getElementById('rankingPager');
  if (!tableWrap) return;
  if (!currentMonth) {
    tableWrap.innerHTML = '<div class="ratings-empty">暂无榜单。</div>';
    return;
  }
  const request = ++rankingRequest;
  const version = viewVersion;
  const isCurrent = () => version === viewVersion && request === rankingRequest;

  const searchVal = document.getElementById('txtRankingSearch')?.value.trim() || '';
  const validOnly = document.getElementById('chkValidOnly')?.checked ? '1' : '0';

  tableWrap.innerHTML = '<div class="ratings-loading">正在读取榜单…</div>';

  try {
    let url = `/api/ratings/snapshot?system=${encodeURIComponent(currentSystem)}&month=${currentMonth}&page=${rankingPage}&limit=${rankingLimit}&valid_only=${validOnly}`;
    if (searchVal) url += `&search=${encodeURIComponent(searchVal)}`;

    const data = await apiGet(url);
    if (!isCurrent()) return;
    const snap = data.snapshot;

    if (summaryBadge && snap) {
      const notes = snap.integrity_notes ? ` · <span class="badge-warn">${esc(snap.integrity_notes)}</span>` : '';
      const unitLabel = currentSystem === 'goratings' ? '本期收录' : '本月收录';
      summaryBadge.innerHTML = `${unitLabel} <strong>${snap.summary?.total_entries || data.total_entries}</strong> 人（有效 <strong>${snap.summary?.valid_entries || data.total_entries}</strong> 人）${notes}`;
    }

    if (!data.entries || data.entries.length === 0) {
      tableWrap.innerHTML = '<div class="ratings-empty">未找到匹配的棋手或记录。</div>';
      pager.innerHTML = '';
      return;
    }

    const isGoRatings = currentSystem === 'goratings';
    const rowsHtml = data.entries.map(e => {
      const flagHtml = (isGoRatings && e.country && window.GoViewerFlags?.flagHtml)
        ? window.GoViewerFlags.flagHtml(e.country) + ' '
        : (isGoRatings && e.country ? `<span class="player-orig-sub">[${esc(e.country)}]</span> ` : '');
      const subName = isGoRatings && e.name_en && e.name_en !== e.player_clean
        ? `<span class="player-orig-sub" title="英文名">${esc(e.name_en)}</span>`
        : (e.player_orig !== e.player_clean ? `<span class="player-orig-sub" title="榜单原文">${esc(e.player_orig)}</span>` : '');
      const rankNum = Number(e.rank);
      const rankHtml = Number.isInteger(rankNum) && rankNum >= 1 && rankNum <= 3
        ? `<span class="rank-pill rank-pill--${rankNum}">${rankNum}</span>`
        : esc(e.rank ?? '—');
      return `
      <tr>
        <td class="cell-rank">${rankHtml}</td>
        <td class="cell-player">${flagHtml}<a href="javascript:void(0)" class="player-link" data-player="${esc(e.player_clean)}" title="查看该棋手走势">${esc(e.player_clean)}</a>${subName}${playerProfileLinkHtml(e.player_id, e.player_clean)}</td>
        <td class="cell-dan">${esc(isGoRatings ? (e.country || '-') : (e.dan || '-'))}</td>
        <td class="cell-age col-age">${esc(e.age !== null && e.age !== undefined ? e.age : '-')}</td>
        <td class="cell-rating"><strong>${e.public_rating !== null && e.public_rating !== undefined ? e.public_rating.toFixed(1) : '-'}</strong></td>
        <td class="cell-diff">${formatDiff(e.rating_change, false)}</td>
        <td class="cell-diff">${formatDiff(e.rank_change, true)}</td>
        <td class="cell-rank-actions"><button type="button" class="btn btn-sm btn-rank-add-compare" data-player="${esc(e.player_clean)}" aria-label="选择 ${esc(e.player_clean)} 加入走势对比">+ 对比</button></td>
      </tr>
    `;
    }).join('');

    tableWrap.innerHTML = `
      <table class="ratings-data-table">
        <thead>
          <tr>
            <th>名次</th>
            <th>棋手</th>
            <th>${isGoRatings ? '国家/地区' : '段位'}</th>
            <th class="col-num col-age">年龄</th>
            <th class="col-num">${isGoRatings ? 'WHR 估值' : '公示分'}</th>
            <th class="col-num">分值变动</th>
            <th class="col-num">名次变动</th>
            <th>走势对比</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;

    tableWrap.querySelectorAll('.player-link').forEach(link => {
      link.onclick = () => openPlayerTrend(link.dataset.player);
    });
    tableWrap.querySelectorAll('.btn-rank-add-compare').forEach(button => {
      button.onclick = () => {
        const name = button.dataset.player;
        rankingComparePlayers = rankingComparePlayers.includes(name)
          ? rankingComparePlayers.filter(player => player !== name)
          : [...rankingComparePlayers, name];
        syncRankingComparison();
      };
    });
    syncRankingComparison();

    // Pager
    const totalPages = Math.ceil(data.total_entries / rankingLimit) || 1;
    pager.innerHTML = `
      <button class="btn btn-sm" id="btnRankPrev" ${rankingPage <= 1 ? 'disabled' : ''}>上一页</button>
      <span class="pager-info">第 ${rankingPage} / ${totalPages} 页 (共 ${data.total_entries} 条)</span>
      <button class="btn btn-sm" id="btnRankNext" ${rankingPage >= totalPages ? 'disabled' : ''}>下一页</button>
    `;
    document.getElementById('btnRankPrev').onclick = () => {
      if (rankingPage > 1) { rankingPage--; fetchAndDisplayRanking(); }
    };
    document.getElementById('btnRankNext').onclick = () => {
      if (rankingPage < totalPages) { rankingPage++; fetchAndDisplayRanking(); }
    };
  } catch (err) {
    if (isCurrent()) tableWrap.innerHTML = `<div class="ratings-error">读取失败：${esc(err.message)}</div>`;
  }
}

// 2. 月度对比视图（支持可视化三大图表与数据明细表切换）
async function renderCompareView() {
  const content = document.getElementById('ratingsContent');
  const version = viewVersion;
  const [systems, months] = await Promise.all([loadSystems(), loadMonths(currentSystem)]);
  if (version !== viewVersion) return;

  const urlTarget = pendingCompareState?.target;
  const urlBase = pendingCompareState?.base;
  const urlCat = pendingCompareState?.cat || 'all';
  const defaultTarget = months.some(m => m.month_key === urlTarget) ? urlTarget : months.at(-1)?.month_key;
  const targetIndex = months.findIndex(m => m.month_key === defaultTarget);
  const defaultBase = urlBase !== defaultTarget && months.some(m => m.month_key === urlBase)
    ? urlBase
    : (months[targetIndex - 1] || months[targetIndex + 1])?.month_key;
  pendingCompareState = null;

  content.innerHTML = `
    <div class="ratings-toolbar">
      <div class="ratings-filter-group">
        <label>体系
          <select id="selCompareSystem">
            ${systems.map(s => `<option value="${esc(s.id)}" ${s.id === currentSystem ? 'selected' : ''}>${esc(s.display_name)}</option>`).join('')}
          </select>
        </label>
        <label>${currentSystem === 'goratings' ? '基准期' : '基准月'}
          <select id="selCompareBase">
            ${months.slice().reverse().map(m => `<option value="${m.month_key}" ${m.month_key === defaultBase ? 'selected' : ''}>${esc(m.month_str)}</option>`).join('')}
          </select>
        </label>
        <button class="btn btn-sm" id="btnSwapCompareMonths" type="button" title="互换基准期与目标期" aria-label="互换基准期与目标期">⇄</button>
        <label>${currentSystem === 'goratings' ? '目标期' : '目标月'}
          <select id="selCompareTarget">
            ${months.slice().reverse().map(m => `<option value="${m.month_key}" ${m.month_key === defaultTarget ? 'selected' : ''}>${esc(m.month_str)}</option>`).join('')}
          </select>
        </label>
        <span class="compare-quick-spans" role="group" aria-label="快捷对比跨度">
          <button class="btn btn-sm btn-compare-span" data-span="mom" type="button" title="目标期与上一期环比">环比上期</button>
          <button class="btn btn-sm btn-compare-span" data-span="yoy" type="button" title="目标期与一年前同比">同比去年</button>
        </span>
        <label>分类
          <select id="selCompareCategory">
            <option value="all" ${urlCat === 'all' ? 'selected' : ''}>全部分类</option>
            <option value="up" ${urlCat === 'up' ? 'selected' : ''}>上涨</option>
            <option value="down" ${urlCat === 'down' ? 'selected' : ''}>下跌</option>
            <option value="equal" ${urlCat === 'equal' ? 'selected' : ''}>持平</option>
            <option value="new" ${urlCat === 'new' ? 'selected' : ''}>新上榜</option>
            <option value="dropped" ${urlCat === 'dropped' ? 'selected' : ''}>退出</option>
            <option value="excluded" ${urlCat === 'excluded' ? 'selected' : ''}>排除记录</option>
          </select>
        </label>
        <button class="btn btn-gold" id="btnRunCompare" type="button">执行对比</button>
      </div>
      <div class="view-toggle-group ratings-view-toggle-auto">
        <button class="view-toggle-btn ${compareViewMode === 'charts' ? 'active' : ''}" id="btnCompareToggleCharts" type="button">${chartIcon('chart')} 对比图表</button>
        <button class="view-toggle-btn ${compareViewMode === 'table' ? 'active' : ''}" id="btnCompareToggleTable" type="button">${chartIcon('table')} 明细数据</button>
      </div>
    </div>
    <p id="compareStatus" class="ratings-load-status" role="status" hidden></p>
    <div id="compareSummaryCards" class="ratings-summary-cards"></div>
    <div id="compareChartsContainer" class="compare-charts-section" style="display: ${compareViewMode === 'charts' ? 'block' : 'none'};"></div>
    <div class="ratings-table-container" id="compareTableWrap" style="display: ${compareViewMode === 'table' ? 'block' : 'none'};"></div>
  `;

  document.getElementById('selCompareSystem').onchange = event => {
    currentSystem = event.target.value;
    switchTab('compare');
  };

  const baseSelect = document.getElementById('selCompareBase');
  const targetSelect = document.getElementById('selCompareTarget');
  const swap = document.getElementById('btnSwapCompareMonths');
  const compareButton = document.getElementById('btnRunCompare');
  const shortcuts = [...content.querySelectorAll('.btn-compare-span')];
  const updateShortcuts = () => {
    const target = Number(targetSelect.value);
    const index = months.findIndex(m => m.month_key === target);
    const previous = index > 0 ? months[index - 1].month_key : null;
    const yearAgo = previousYearSnapshot(months, target);
    for (const [button, key] of [[shortcuts[0], previous], [shortcuts[1], yearAgo]]) {
      button.disabled = !key;
      button.dataset.base = key || '';
    }
    swap.disabled = months.length < 2 || baseSelect.value === targetSelect.value;
    compareButton.disabled = months.length < 2;
  };
  const refresh = () => {
    updateShortcuts();
    syncWorkspaceUrlState();
    runComparison();
  };
  compareButton.onclick = refresh;
  document.getElementById('selCompareCategory').onchange = refresh;
  baseSelect.onchange = refresh;
  targetSelect.onchange = refresh;
  swap.onclick = () => {
    [baseSelect.value, targetSelect.value] = [targetSelect.value, baseSelect.value];
    refresh();
  };
  shortcuts.forEach(button => {
    button.onclick = () => {
      baseSelect.value = button.dataset.base;
      refresh();
    };
  });
  updateShortcuts();

  document.getElementById('btnCompareToggleCharts').onclick = () => {
    compareViewMode = 'charts';
    document.getElementById('btnCompareToggleCharts').classList.add('active');
    document.getElementById('btnCompareToggleTable').classList.remove('active');
    document.getElementById('compareChartsContainer').style.display = 'block';
    document.getElementById('compareTableWrap').style.display = 'none';
    syncWorkspaceUrlState();
  };

  document.getElementById('btnCompareToggleTable').onclick = () => {
    compareViewMode = 'table';
    document.getElementById('btnCompareToggleTable').classList.add('active');
    document.getElementById('btnCompareToggleCharts').classList.remove('active');
    document.getElementById('compareChartsContainer').style.display = 'none';
    document.getElementById('compareTableWrap').style.display = 'block';
    syncWorkspaceUrlState();
  };

  await runComparison();
  if (version === viewVersion) syncWorkspaceUrlState();
}

function previousYearSnapshot(months, target) {
  const key = String(target);
  if (key.length === 6) return months.find(m => m.month_key === target - 100)?.month_key;
  if (key.length !== 8) return null;
  const year = Number(key.slice(0, 4)) - 1;
  const month = Number(key.slice(4, 6));
  const day = Math.min(Number(key.slice(6)), new Date(Date.UTC(year, month, 0)).getUTCDate());
  const cutoff = Date.UTC(year, month - 1, day);
  const week = 7 * 86400000;
  let best = null;
  let distance = week + 1;
  for (const {month_key: snapshot} of months) {
    const date = String(snapshot);
    if (date.length !== 8 || snapshot >= target) continue;
    const delta = Math.abs(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6))) - cutoff);
    if (delta <= week && delta < distance) {
      best = snapshot;
      distance = delta;
    }
  }
  return best;
}

function setPanelStatus(status, message = '', error = false) {
  status.textContent = message;
  status.hidden = !message;
  status.classList.toggle('ratings-error', error);
}

async function runComparison() {
  const tableWrap = document.getElementById('compareTableWrap');
  const cardsWrap = document.getElementById('compareSummaryCards');
  const chartsContainer = document.getElementById('compareChartsContainer');
  const baseVal = Number(document.getElementById('selCompareBase').value);
  const targetVal = Number(document.getElementById('selCompareTarget').value);
  const catFilter = document.getElementById('selCompareCategory').value;

  const request = ++comparisonRequest;
  const version = viewVersion;
  const isCurrent = () => version === viewVersion && request === comparisonRequest;
  const status = document.getElementById('compareStatus');
  const setBusy = (busy) => {
    for (const panel of [chartsContainer, tableWrap]) {
      panel.classList.toggle('is-loading', busy);
      panel.setAttribute('aria-busy', String(busy));
      panel.inert = busy;
    }
  };
  const highlightCategory = () => {
    cardsWrap.querySelectorAll('.stat-card').forEach(card => {
      const selected = card.dataset.cat === catFilter;
      card.classList.toggle('is-active', selected);
      card.setAttribute('aria-pressed', String(selected));
    });
  };
  highlightCategory();
  if (!baseVal || !targetVal || baseVal === targetVal) {
    setBusy(false);
    setPanelStatus(status, baseVal === targetVal && baseVal ? '请选择不同的基准期与目标期。' : '至少需要两期榜单才能对比。', true);
    return;
  }

  setBusy(true);
  setPanelStatus(status, '正在计算对比…');
  try {
    const data = await apiGet(`/api/ratings/compare?system=${encodeURIComponent(currentSystem)}&base=${baseVal}&target=${targetVal}`);
    if (!isCurrent()) return;
    setPanelStatus(status);
    const s = data.summary;

    if (cardsWrap) {
      cardsWrap.innerHTML = `
        <button type="button" class="stat-card" data-cat="all">
          <span class="stat-number">${s.total_players_compared}</span>
          <span class="stat-title">对比棋手总数</span>
        </button>
        <button type="button" class="stat-card stat-card--up" data-cat="up">
          <span class="stat-number">${s.up_count}</span>
          <span class="stat-title">分值上涨</span>
        </button>
        <button type="button" class="stat-card stat-card--down" data-cat="down">
          <span class="stat-number">${s.down_count}</span>
          <span class="stat-title">分值下跌</span>
        </button>
        <button type="button" class="stat-card" data-cat="equal">
          <span class="stat-number">${s.equal_count}</span>
          <span class="stat-title">分值持平</span>
        </button>
        <button type="button" class="stat-card stat-card--new" data-cat="new">
          <span class="stat-number">${s.new_count}</span>
          <span class="stat-title">新上榜</span>
        </button>
        <button type="button" class="stat-card stat-card--dropped" data-cat="dropped">
          <span class="stat-number">${s.dropped_count}</span>
          <span class="stat-title">退出榜单</span>
        </button>
        <button type="button" class="stat-card stat-card--excluded" data-cat="excluded">
          <span class="stat-number">${s.excluded_count}</span>
          <span class="stat-title">排除记录</span>
        </button>
      `;

      highlightCategory();
      cardsWrap.querySelectorAll('.stat-card').forEach(card => {
        card.onclick = () => {
          document.getElementById('selCompareCategory').value = card.dataset.cat;
          syncWorkspaceUrlState();
          runComparison();
        };
      });
    }

    // 渲染月度对比三大分析图表
    if (chartsContainer) {
      if (currentComparisonRenderer?.container !== chartsContainer) {
        currentComparisonRenderer = window.GoViewerRatingsChart?.createComparison(chartsContainer, {
          topN: 15,
          activeSubChart: 'all'
        });
      }
      currentComparisonRenderer?.setData(data);
    }

    // 渲染明细表格
    let displayRows = [];
    if (catFilter === 'all') {
      for (const k of ['up', 'down', 'new', 'dropped', 'equal', 'excluded']) {
        displayRows = displayRows.concat(data.categories[k] || []);
      }
    } else {
      displayRows = data.categories[catFilter] || [];
    }

    if (displayRows.length === 0) {
      tableWrap.innerHTML = '<div class="ratings-empty">该分类下无对比记录。</div>';
      return;
    }

    const rowsHtml = displayRows.slice(0, 200).map(r => `
      <tr>
        <td class="cell-player"><a href="javascript:void(0)" class="player-link" data-player="${esc(r.player_clean)}">${esc(r.player_clean)}</a>${playerProfileLinkHtml(r.player_id, r.player_clean)}</td>
        <td><span class="badge-cat badge-cat-${esc(r.category)}">${esc(r.category_label)}</span></td>
        <td class="cell-rank">${r.base_rank !== null ? r.base_rank : '-'}</td>
        <td class="cell-rating">${r.base_rating !== null ? r.base_rating.toFixed(1) : '-'}</td>
        <td class="cell-rank">${r.target_rank !== null ? r.target_rank : '-'}</td>
        <td class="cell-rating"><strong>${r.target_rating !== null ? r.target_rating.toFixed(1) : '-'}</strong></td>
        <td class="cell-diff">${formatDiff(r.rating_diff, false)}</td>
        <td class="cell-diff">${formatDiff(r.rank_diff, true)}</td>
      </tr>
    `).join('');

    tableWrap.innerHTML = `
      <table class="ratings-data-table">
        <thead>
          <tr>
            <th>棋手</th>
            <th>状态</th>
            <th>基准名次</th>
            <th>基准分值</th>
            <th>目标名次</th>
            <th>目标分值</th>
            <th>等级分变化</th>
            <th>名次变动</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      ${displayRows.length > 200 ? `<div class="ratings-note">已展示前 200 项（共 ${displayRows.length} 项）。可通过分类筛选查看更多。</div>` : ''}
    `;

    tableWrap.querySelectorAll('.player-link').forEach(link => {
      link.onclick = () => openPlayerTrend(link.dataset.player);
    });
  } catch (err) {
    if (isCurrent()) setPanelStatus(status, `对比失败：${err.message}`, true);
  } finally {
    if (isCurrent()) setBusy(false);
  }
}

function getSystemDisplayName(sid) {
  const s = systemsList.find(x => x.id === sid);
  if (s) return s.display_name;
  if (sid === 'china') return '中国围棋协会等级分';
  if (sid === 'korea') return '韩国棋院等级分';
  if (sid === 'goratings') return 'GoRatings (WHR)';
  return sid;
}

// 3. 棋手历史走势视图（继承自原始 Go Ranking Tools，支持走势图与明细）
let currentChartRenderer = null;
let currentChartData = null;
let currentViewType = 'chart'; // 'chart' | 'table'
let currentChartMode = 'single-dual';
let goratingsDiffAlign = 'weekly'; // 'weekly' | 'union' (GoRatings two-diff sampling mode)
let chartSparseX = false;
let chartLabelMode = 'auto'; // 'auto' | 'none' | 'endpoint' | 'extreme' | 'all'
let chartShowPoints = true;
let chartSampling = 'auto'; // 'auto' | 'all'
let chartSmooth = true;
let chartShowGrid = true;
let chartPtSize = 'auto';
let currentTimePreset = 'all'; // 'all' | '1y' | '2y' | '3y' | '5y'
let currentTrendPlayers = ['柯洁'];
let compareViewMode = 'charts'; // 'charts' | 'table'
let currentComparisonRenderer = null;

async function renderTrendView(targetPlayer = '') {
  const content = document.getElementById('ratingsContent');
  const version = viewVersion;
  const systems = await loadSystems();
  if (version !== viewVersion) return;
  trendViewEvents = new AbortController();
  const {signal} = trendViewEvents;

  if (targetPlayer) {
    currentTrendPlayers = splitTrendPlayerNames(targetPlayer);
  }
  if (!currentTrendPlayers || currentTrendPlayers.length === 0) {
    currentTrendPlayers = ['柯洁'];
  }

  content.innerHTML = `
    <!-- 工具栏与经典预设集成行 -->
    <div class="ratings-toolbar trend-compact-toolbar">
      <div class="ratings-filter-group">
        <label>体系
          <select id="selTrendSystem">
            ${systems.map(s => `<option value="${esc(s.id)}" ${s.id === currentSystem ? 'selected' : ''}>${esc(s.display_name)}</option>`).join('')}
          </select>
        </label>
        <form id="trendPlayerForm" class="ratings-player-search">
          <label class="ratings-search-label" for="txtTrendPlayer">添加棋手</label>
          <input type="search" id="txtTrendPlayer" class="ratings-input" placeholder="姓名或英文名" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="trendPlayerOptions" aria-expanded="false">
          <div id="trendPlayerOptions" class="ratings-player-options" role="listbox" aria-label="棋手搜索结果" hidden></div>
          <button class="btn btn-sm" id="btnAddTrendPlayer" type="submit">添加</button>
        </form>
        <details id="trendPresets" class="ratings-style-popover">
          <summary class="btn btn-sm">预设 ▾</summary>
          <div class="trend-quick-presets-bar">
            <button type="button" class="btn btn-sm btn-preset-pill" data-players="柯洁, 申真谞" data-mode="two-diff">${chartIcon('trend', 13)} 柯申对决</button>
            <button type="button" class="btn btn-sm btn-preset-pill" data-players="柯洁, 丁浩" data-mode="two-diff">${presetFlag('CHN')} 柯丁双雄</button>
            <button type="button" class="btn btn-sm btn-preset-pill" data-players="柯洁, 李轩豪, 丁浩" data-mode="multi-rating">${presetFlag('CHN')} 中国三甲</button>
            <button type="button" class="btn btn-sm btn-preset-pill" data-sys="korea" data-players="申真谞, 朴廷桓, 卞相壹" data-mode="multi-rating">${presetFlag('KOR')} 韩国三甲</button>
            <button type="button" class="btn btn-sm btn-preset-pill" data-players="柯洁, 申真谞, 丁浩, 李轩豪, 朴廷桓" data-mode="multi-rating">${chartIcon('users', 13)} 中韩五强</button>
            <button type="button" class="btn btn-sm btn-preset-pill" data-sys="goratings" data-players="李昌镐, 李世石, 柯洁, 申真谞" data-mode="multi-rating">${chartIcon('trend', 13)} GoRatings 跨时代</button>
            <button type="button" class="btn btn-sm btn-preset-pill" data-sys="goratings" data-players="柯洁, 申真谞" data-mode="two-diff">${chartIcon('trend', 13)} WHR 柯申分差</button>
            <span id="trendCustomPresets" class="trend-custom-presets"></span>
            <button type="button" class="btn btn-sm btn-save-preset" id="btnSaveCustomPreset">保存当前预设</button>
          </div>
        </details>
      </div>

      <div id="trendSystemPills" class="trend-system-pills"></div>
    </div>

    <!-- 活跃棋手与热门点选融合栏 -->
    <div class="trend-players-unified-bar" id="trendActivePlayersBar">
      <span class="trend-section-label">对比棋手</span>
      <div class="trend-active-chips-list" id="trendActiveChipsList"></div>
      <button type="button" class="btn btn-sm" id="btnClearTrendPlayers">清空</button>
      <span class="trend-bar-divider"></span>
      <span class="trend-section-label">热门棋手</span>
      <div class="trend-candidate-chips-list" id="trendCandidateChipsList"></div>
    </div>
    <div id="trendNotice" class="ratings-notice-wrap"></div>
    <p id="trendStatus" class="ratings-load-status" role="status" hidden></p>
    <div id="trendCardsWrap" class="ratings-summary-cards"></div>

    <!-- 图表容器与操作控制条 -->
    <div class="ratings-chart-container" id="ratingsChartContainer">
      <div class="ratings-chart-controls" id="chartControlsBar">
        <div class="ratings-chart-controls-left">
          <div class="view-toggle-group">
            <button class="view-toggle-btn ${currentViewType === 'chart' ? 'active' : ''}" id="btnToggleChart" type="button">${chartIcon('chart')} 走势图表</button>
            <button class="view-toggle-btn ${currentViewType === 'table' ? 'active' : ''}" id="btnToggleTable" type="button">${chartIcon('table')} 明细表格</button>
          </div>
          <label>模式
            <select id="selChartMode"></select>
          </label>
          <div class="trend-time-presets-bar" id="goratingsDiffAlignWrap" style="display: none;">
            <span class="trend-time-label">采样</span>
            <button type="button" class="btn btn-sm btn-time-pill btn-align-pill ${goratingsDiffAlign !== 'union' ? 'active' : ''}" data-align="weekly" title="按自然周（周五）均匀采样">自然周</button>
            <button type="button" class="btn btn-sm btn-time-pill btn-align-pill ${goratingsDiffAlign === 'union' ? 'active' : ''}" data-align="union" title="取两位棋手所有对局日并集并前值延续">对局日并集</button>
          </div>
          <div class="trend-time-presets-bar" id="trendTimePresetsBar">
            <span class="trend-time-label">区间</span>
            <button type="button" class="btn btn-sm btn-time-pill ${currentTimePreset === 'all' ? 'active' : ''}" data-range="all">全部</button>
            <button type="button" class="btn btn-sm btn-time-pill ${currentTimePreset === '1y' ? 'active' : ''}" data-range="1y">近1年</button>
            <button type="button" class="btn btn-sm btn-time-pill ${currentTimePreset === '2y' ? 'active' : ''}" data-range="2y">近2年</button>
            <button type="button" class="btn btn-sm btn-time-pill ${currentTimePreset === '3y' ? 'active' : ''}" data-range="3y">近3年</button>
            <button type="button" class="btn btn-sm btn-time-pill ${currentTimePreset === '5y' ? 'active' : ''}" data-range="5y">近5年</button>
          </div>
          <label>从
            <select id="selChartStartMonth"></select>
          </label>
          <label>至
            <select id="selChartEndMonth"></select>
          </label>
        </div>
        <div class="ratings-chart-controls-right">
          <details class="ratings-style-popover chart-only-ctrl" id="ratingsStylePopover">
            <summary class="btn btn-sm">显示设置 ▾</summary>
            <div class="ratings-style-menu">
              <label class="chart-only-ctrl">点大小
                <select id="selChartPointSize" class="ratings-select">
                  <option value="auto" ${chartPtSize === 'auto' ? 'selected' : ''}>自动</option>
                  <option value="3" ${chartPtSize === '3' ? 'selected' : ''}>极小 (3px)</option>
                  <option value="5" ${chartPtSize === '5' ? 'selected' : ''}>小 (5px)</option>
                  <option value="7" ${chartPtSize === '7' ? 'selected' : ''}>中 (7px)</option>
                  <option value="9" ${chartPtSize === '9' ? 'selected' : ''}>大 (9px)</option>
                </select>
              </label>
              <label class="chart-only-ctrl">标注
                <select id="selChartLabelMode" class="ratings-select">
                  <option value="auto" ${chartLabelMode === 'auto' ? 'selected' : ''}>自动</option>
                  <option value="endpoint" ${chartLabelMode === 'endpoint' ? 'selected' : ''}>仅端点</option>
                  <option value="extreme" ${chartLabelMode === 'extreme' ? 'selected' : ''}>端点与极值</option>
                  <option value="all" ${chartLabelMode === 'all' ? 'selected' : ''}>全部</option>
                  <option value="none" ${chartLabelMode === 'none' ? 'selected' : ''}>不显示</option>
                </select>
              </label>
              <label class="chart-only-ctrl">密度
                <select id="selChartDensity" class="ratings-select" title="长跨度日期轴可只看概览点或全部原始点">
                  <option value="auto" ${chartSampling === 'auto' ? 'selected' : ''}>自动</option>
                  <option value="all" ${chartSampling === 'all' ? 'selected' : ''}>全部</option>
                </select>
              </label>
              <div class="ratings-style-checks">
                <label class="ratings-checkbox-label chart-only-ctrl">
                  <input type="checkbox" id="chkChartPoints" ${chartShowPoints ? 'checked' : ''}> 数据点
                </label>
                <label class="ratings-checkbox-label chart-only-ctrl">
                  <input type="checkbox" id="chkChartSmooth" ${chartSmooth ? 'checked' : ''}> 平滑曲线
                </label>
                <label class="ratings-checkbox-label chart-only-ctrl">
                  <input type="checkbox" id="chkChartGrid" ${chartShowGrid ? 'checked' : ''}> 网格
                </label>
                <label class="ratings-checkbox-label chart-only-ctrl">
                  <input type="checkbox" id="chkChartSparse" ${chartSparseX ? 'checked' : ''}> 精简横轴
                </label>
              </div>
            </div>
          </details>
          <button class="btn btn-sm chart-only-ctrl" id="btnFullscreenChart" type="button" title="全屏查看大图">${chartIcon('expand')} 全屏</button>
          <button class="btn btn-sm" id="btnCopyChartData" type="button" title="复制表格数据至剪贴板">${chartIcon('copy')} 复制数据</button>
          <button class="btn btn-sm chart-only-ctrl" id="btnExportChartPng" type="button" title="导出 2x 高清 PNG 图片">${chartIcon('download')} 导出 PNG</button>
          <button class="btn btn-sm chart-only-ctrl" id="btnExportChartSvg" type="button" title="导出无损 SVG 矢量文件">${chartIcon('download')} 导出 SVG</button>
        </div>
      </div>
      <div id="trendChartWrap" class="ratings-chart-svg-wrap" style="display: ${currentViewType === 'chart' ? 'block' : 'none'};"></div>
    </div>

    <div class="ratings-table-container" id="trendTableWrap" style="display: ${currentViewType === 'table' ? 'block' : 'none'};"></div>
  `;

  const searchInput = document.getElementById('txtTrendPlayer');
  const systemSelect = document.getElementById('selTrendSystem');
  const presets = document.getElementById('trendPresets');
  for (const panel of [presets, document.getElementById('ratingsStylePopover')]) {
    document.addEventListener('pointerdown', event => {
      if (panel.open && !panel.contains(event.target)) panel.open = false;
    }, {signal});
    panel.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !panel.open) return;
      event.preventDefault();
      event.stopPropagation();
      panel.open = false;
      panel.querySelector('summary').focus();
    });
  }

  const refreshPlayers = () => {
    renderActivePlayerChips();
    renderCandidateChips();
    syncWorkspaceUrlState();
    runPlayerTrend();
  };
  const addPlayers = (pickedName) => {
    const names = splitTrendPlayerNames(searchInput.value);
    if (pickedName) names[names.length ? names.length - 1 : 0] = pickedName;
    if (!names.length) return;
    currentTrendPlayers = [...new Set([...currentTrendPlayers, ...names])];
    searchInput.value = '';
    suggestions.hide();
    refreshPlayers();
    searchInput.focus();
  };
  const suggestions = bindPlayerSuggestions(
    searchInput, document.getElementById('trendPlayerOptions'),
    () => searchInput.value.split(/[,，]/).at(-1).trim(),
    async query => {
      if (systemSelect.value !== 'goratings') return searchPlayerDirectory(query);
      const result = await apiGet(`/api/ratings/goratings/players?q=${encodeURIComponent(query)}&limit=12`);
      return (result.players || []).map(player => ({
        value: player.name_zh || player.name_en,
        label: player.name_zh || player.name_en,
        detail: [player.name_zh ? player.name_en : '', player.country].filter(Boolean).join(' · ')
      }));
    },
    item => addPlayers(item.value), signal
  );
  document.getElementById('trendPlayerForm').onsubmit = event => {
    event.preventDefault();
    addPlayers();
  };
  document.getElementById('btnClearTrendPlayers').onclick = () => {
    currentTrendPlayers = [];
    searchInput.value = '';
    suggestions.hide();
    refreshPlayers();
    searchInput.focus();
  };
  systemSelect.onchange = () => {
    currentSystem = systemSelect.value;
    suggestions.hide();
    refreshPlayers();
  };

  bindTrendPresets(presets, systems, (players, system, mode) => {
    if (system) systemSelect.value = system;
    currentSystem = systemSelect.value;
    currentTrendPlayers = players;
    currentChartMode = mode;
    searchInput.value = '';
    suggestions.hide();
    presets.open = false;
    presets.querySelector('summary').focus();
    refreshPlayers();
  });
  renderActivePlayerChips();
  renderCandidateChips();

  // GoRatings 双人分差采样模式切换（自然周默认 vs LOCF 并集）
  document.querySelectorAll('.btn-align-pill').forEach(btn => {
    btn.onclick = () => {
      const nextAlign = btn.dataset.align === 'union' ? 'union' : 'weekly';
      if (goratingsDiffAlign === nextAlign) return;
      goratingsDiffAlign = nextAlign;
      document.querySelectorAll('.btn-align-pill').forEach(b => {
        b.classList.toggle('active', b.dataset.align === goratingsDiffAlign);
      });
      syncWorkspaceUrlState();
      runPlayerTrend();
    };
  });

  // 时间跨度预设点击
  document.querySelectorAll('.btn-time-pill[data-range]').forEach(btn => {
    btn.onclick = () => {
      applyTimePreset(btn.dataset.range);
    };
  });

  const syncControlVisibility = () => {
    const isChart = currentViewType === 'chart';
    if (!isChart) document.getElementById('ratingsStylePopover').open = false;
    document.querySelectorAll('.chart-only-ctrl').forEach(el => {
      el.style.display = isChart ? '' : 'none';
    });
  };

  document.getElementById('btnToggleChart').onclick = () => {
    currentViewType = 'chart';
    document.getElementById('btnToggleChart').classList.add('active');
    document.getElementById('btnToggleTable').classList.remove('active');
    document.getElementById('trendChartWrap').style.display = 'block';
    document.getElementById('trendTableWrap').style.display = 'none';
    syncControlVisibility();
    syncWorkspaceUrlState();
  };

  document.getElementById('btnToggleTable').onclick = () => {
    currentViewType = 'table';
    document.getElementById('btnToggleTable').classList.add('active');
    document.getElementById('btnToggleChart').classList.remove('active');
    document.getElementById('trendChartWrap').style.display = 'none';
    document.getElementById('trendTableWrap').style.display = 'block';
    syncControlVisibility();
    syncWorkspaceUrlState();
  };

  document.getElementById('selChartPointSize').onchange = (e) => {
    chartPtSize = e.target.value;
    renderChartPlot();
  };

  syncControlVisibility();

  const initialSizeSelect = document.getElementById('selChartPointSize');
  if (initialSizeSelect) initialSizeSelect.disabled = !chartShowPoints;

  document.getElementById('selChartMode').onchange = (e) => {
    currentChartMode = e.target.value;
    syncGoRatingsAlignVisibility();
    renderActivePlayerChips();
    renderChartPlot();
    renderTrendTable(document.getElementById('trendTableWrap'), currentChartData);
    syncWorkspaceUrlState();
  };

  document.getElementById('selChartStartMonth').onchange = () => {
    currentTimePreset = 'custom';
    updateTimePillActive();
    renderChartPlot();
    renderTrendTable(document.getElementById('trendTableWrap'), currentChartData);
  };

  document.getElementById('selChartEndMonth').onchange = () => {
    currentTimePreset = 'custom';
    updateTimePillActive();
    renderChartPlot();
    renderTrendTable(document.getElementById('trendTableWrap'), currentChartData);
  };

  document.getElementById('chkChartSmooth').onchange = (e) => {
    chartSmooth = e.target.checked;
    renderChartPlot();
  };

  document.getElementById('chkChartGrid').onchange = (e) => {
    chartShowGrid = e.target.checked;
    renderChartPlot();
  };

  document.getElementById('chkChartSparse').onchange = (e) => {
    chartSparseX = e.target.checked;
    renderChartPlot();
  };

  document.getElementById('chkChartPoints').onchange = (e) => {
    chartShowPoints = e.target.checked;
    const sizeSelect = document.getElementById('selChartPointSize');
    if (sizeSelect) sizeSelect.disabled = !chartShowPoints;
    renderChartPlot();
  };

  document.getElementById('selChartLabelMode').onchange = (e) => {
    chartLabelMode = e.target.value;
    renderChartPlot();
  };

  document.getElementById('selChartDensity').onchange = (e) => {
    chartSampling = e.target.value;
    renderChartPlot();
  };

  document.getElementById('btnFullscreenChart').onclick = () => {
    if (currentChartRenderer) {
      currentChartRenderer.openFullscreen(getSystemDisplayName(currentSystem));
    }
  };

  document.getElementById('btnCopyChartData').onclick = () => {
    if (currentChartRenderer) {
      const ok = currentChartRenderer.copyDataTsv();
      if (ok) {
        setRatingsStatus('走势数据已复制至剪贴板（TSV 格式），可直接在 Excel 中粘贴！', false);
      }
    }
  };

  document.getElementById('btnExportChartPng').onclick = () => {
    if (currentChartRenderer) {
      const modeLabel = window.GoViewerRatingsChart?.MODES[currentChartMode] || currentChartMode;
      const pName = (currentChartData?.players || []).map(p => p.player_clean).join('_');
      const filename = `${getSystemDisplayName(currentSystem)}_${modeLabel}_${pName}`;
      currentChartRenderer.exportPng(filename);
    }
  };

  document.getElementById('btnExportChartSvg').onclick = () => {
    if (currentChartRenderer) {
      const modeLabel = window.GoViewerRatingsChart?.MODES[currentChartMode] || currentChartMode;
      const pName = (currentChartData?.players || []).map(p => p.player_clean).join('_');
      const filename = `${getSystemDisplayName(currentSystem)}_${modeLabel}_${pName}`;
      currentChartRenderer.exportSvg(filename);
    }
  };

  await runPlayerTrend();
}

async function searchPlayerDirectory(query) {
  const result = await window.GoStatsDataClient.searchPlayers(query, 12);
  return (result.items || []).map(player => ({
    value: player.name_zh || player.name_native || player.romanized,
    label: player.name_zh || player.name_native || player.romanized,
    id: player.id,
    detail: [
      player.romanized || player.name_native,
      player.nationality && (window.GoViewerFlags?.info(player.nationality)?.name || player.nationality),
      player.default_rank,
      player.birth_date
    ].filter(Boolean).join(' · ')
  }));
}

function bindPlayerSuggestions(input, list, query, search, pick, signal) {
  let items = [];
  let index = -1;
  let generation = 0;
  let timer;
  const hide = () => {
    clearTimeout(timer);
    generation++;
    items = [];
    index = -1;
    list.hidden = true;
    list.replaceChildren();
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };
  const focusItem = (next) => {
    index = next;
    const option = list.children[index];
    input.setAttribute('aria-activedescendant', option.id);
    for (const item of list.children) item.setAttribute('aria-selected', String(item === option));
    option.scrollIntoView({block: 'nearest'});
  };
  input.addEventListener('input', () => {
    hide();
    const term = query();
    if (!term) return;
    const request = generation;
    timer = setTimeout(async () => {
      try {
        const found = await search(term);
        if (request !== generation || signal.aborted || term !== query() || document.activeElement !== input) return;
        items = found.filter(item => item.value);
        if (!items.length) return;
        list.innerHTML = items.map((item, i) => `
          <div id="${list.id}-${i}" role="option" aria-selected="false" data-index="${i}">
            <span>${esc(item.label)}</span>
            ${item.detail ? `<small>${esc(item.detail)}</small>` : ''}
          </div>
        `).join('');
        list.hidden = false;
        input.setAttribute('aria-expanded', 'true');
      } catch (_) {}
    }, 180);
  }, {signal});
  input.addEventListener('blur', hide, {signal});
  input.addEventListener('keydown', event => {
    if (event.isComposing || list.hidden) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = event.key === 'ArrowDown' ? (index + 1) % items.length
        : (index <= 0 ? items.length - 1 : index - 1);
      focusItem(next);
    } else if (event.key === 'Enter' && index >= 0) {
      event.preventDefault();
      pick(items[index]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      hide();
    }
  }, {signal});
  list.addEventListener('mousedown', event => event.preventDefault(), {signal});
  list.addEventListener('click', event => {
    const option = event.target.closest('[data-index]');
    if (option) pick(items[Number(option.dataset.index)]);
  }, {signal});
  signal.addEventListener('abort', hide, {once: true});
  return {hide};
}

function bindTrendPresets(presets, systems, apply) {
  const storageKey = 'go_viewer_rating_custom_presets_v1';
  const wrap = document.getElementById('trendCustomPresets');
  const modes = window.GoViewerRatingsChart.MODES;
  const knownSystems = new Set(systems.map(system => system.id));
  const read = () => {
    try {
      const list = JSON.parse(localStorage.getItem(storageKey) || '[]');
      return Array.isArray(list) ? list.filter(item =>
        typeof item?.label === 'string' && typeof item.players === 'string' &&
        splitTrendPlayerNames(item.players).length && knownSystems.has(item.sys) &&
        Object.hasOwn(modes, item.mode)
      ) : [];
    } catch (_) {
      return [];
    }
  };
  const write = (list) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(list));
      render();
      return true;
    } catch (_) {
      setRatingsStatus('无法保存本地预设。', true);
      return false;
    }
  };
  const render = () => {
    wrap.innerHTML = read().map((item, index) => `
      <span class="custom-preset-item">
        <button type="button" class="btn btn-sm btn-preset-pill" data-sys="${esc(item.sys)}" data-players="${esc(item.players)}" data-mode="${esc(item.mode)}" title="${esc(getSystemDisplayName(item.sys))} · ${esc(modes[item.mode])}">${esc(item.label)}</button>
        <button type="button" class="custom-preset-del" data-index="${index}" aria-label="删除预设 ${esc(item.label)}">×</button>
      </span>
    `).join('');
  };
  presets.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.matches('.btn-preset-pill')) {
      apply(splitTrendPlayerNames(button.dataset.players), button.dataset.sys, button.dataset.mode);
    } else if (button.matches('.custom-preset-del')) {
      if (write(read().filter((_, index) => index !== Number(button.dataset.index)))) {
        document.getElementById('btnSaveCustomPreset').focus();
      }
    }
  });
  document.getElementById('btnSaveCustomPreset').onclick = () => {
    if (!currentTrendPlayers.length || !currentChartData) return;
    const list = read();
    const players = currentTrendPlayers.join(', ');
    if (list.some(item => item.players === players && item.sys === currentSystem && item.mode === currentChartMode)) {
      setRatingsStatus('当前组合与图表模式已保存。');
      return;
    }
    if (list.length >= 12) {
      setRatingsStatus('已保存 12 个预设，请先删除一个。', true);
      return;
    }
    const names = currentTrendPlayers.slice(0, 3).join('·');
    const label = currentTrendPlayers.length > 3 ? `${names}等${currentTrendPlayers.length}人` : names;
    if (write([...list, {label, sys: currentSystem, players, mode: currentChartMode}])) {
      setRatingsStatus(`已保存预设「${label}」。`);
    }
  };
  render();
}

function renderActivePlayerChips() {
  const listWrap = document.getElementById('trendActiveChipsList');
  if (!listWrap) return;
  const players = currentChartData?.players || [];
  const hasIndividualLines = currentChartMode === 'multi-rating' || currentChartMode === 'multi-rank';
  const chart = window.GoViewerRatingsChart;
  const colors = hasIndividualLines ? chart.getPlayerColors(players) : new Map();
  const findPlayer = name => players.find(player => player.searched_name === name || player.player_clean === name);
  const canColor = player => Boolean(player && colors.get(player));

  listWrap.innerHTML = currentTrendPlayers.map(name => {
    const player = findPlayer(name);
    const color = colors.get(player);
    return `
      <span class="trend-active-chip"${color ? ` style="--chip-color: ${color};"` : ''} data-player="${esc(name)}">
        ${canColor(player) ? `<button type="button" class="chip-color-dot" aria-label="切换 ${esc(name)} 曲线颜色" title="切换曲线颜色"></button>` : ''}
        <span class="chip-name">${esc(name)}</span>
        ${playerProfileLinkHtml(player?.player_id, name)}
        <button type="button" class="chip-remove-btn" aria-label="移除 ${esc(name)}" title="移出对比">✕</button>
      </span>
    `;
  }).join('');

  listWrap.querySelectorAll('.trend-active-chip').forEach(chip => {
    const name = chip.dataset.player;
    const player = findPlayer(name);
    const dot = chip.querySelector('.chip-color-dot');
    if (dot) {
      const updateFocus = () => currentChartRenderer?.focusPlayer(chip.matches(':hover, :focus-within') ? player : null);
      for (const event of ['pointerenter', 'pointerleave', 'focusin', 'focusout']) {
        chip.addEventListener(event, () => queueMicrotask(updateFocus));
      }
      dot.onclick = () => {
        if (!chart.cyclePlayerColor(player, players)) {
          setRatingsStatus('同图配色已用完。');
          return;
        }
        renderActivePlayerChips();
        renderChartPlot();
        [...listWrap.children].find(item => item.dataset.player === name)?.querySelector('.chip-color-dot')?.focus();
      };
    }
    chip.querySelector('.chip-remove-btn').onclick = () => {
      currentTrendPlayers = currentTrendPlayers.filter(item => item !== name);
      renderActivePlayerChips();
      renderCandidateChips();
      document.getElementById('txtTrendPlayer').focus();
      runPlayerTrend();
    };
  });
}

// 辅助：渲染热门棋手快捷点选条
function renderCandidateChips() {
  const listWrap = document.getElementById('trendCandidateChipsList');
  if (!listWrap) return;
  const popular = ['柯洁', '申真谞', '丁浩', '李轩豪', '王星昊', '朴廷桓', '卞相壹', '杨鼎新', '党毅飞', '连笑', '崔精', '一力辽'];

  listWrap.innerHTML = popular.map(name => {
    const isAct = currentTrendPlayers.includes(name);
    return `
      <button type="button" class="btn btn-sm btn-quick-player ${isAct ? 'active' : ''}" data-player="${esc(name)}" aria-pressed="${isAct}">
        ${isAct ? '✓ ' : '+ '}${esc(name)}
      </button>
    `;
  }).join('');

  listWrap.querySelectorAll('.btn-quick-player').forEach(btn => {
    btn.onclick = () => {
      const name = btn.dataset.player;
      if (currentTrendPlayers.includes(name)) {
        currentTrendPlayers = currentTrendPlayers.filter(x => x !== name);
      } else {
        currentTrendPlayers.push(name);
      }
      renderActivePlayerChips();
      renderCandidateChips();
      runPlayerTrend();
    };
  });
}

// 辅助：快速应用时间区间预设
function applyTimePreset(range) {
  currentTimePreset = range;
  updateTimePillActive();

  const startSel = document.getElementById('selChartStartMonth');
  const endSel = document.getElementById('selChartEndMonth');
  if (!startSel || !endSel || !currentChartData || !currentChartData.months) return;

  const months = trendTimeOptions(currentChartData);
  if (!months.length) return;
  [startSel.value, endSel.value] = timePresetBounds(range, months);
  renderChartPlot();
  renderTrendTable(document.getElementById('trendTableWrap'), currentChartData);
}

function dateTimeline(rows) {
  const keys = new Map();
  for (const row of rows) {
    const date = row.date || row.month_str;
    const key = window.GoViewerRatingsChart.plotTimeKey(row, true);
    if (key >= 1000000) keys.set(key, {month_key: key, date, month_str: date});
  }
  return [...keys.values()].sort((a, b) => a.month_key - b.month_key);
}

function trendTimeOptions(data) {
  if (data.time_scale !== 'date') return data.months || [];
  return dateTimeline([
    ...data.months,
    ...data.players.flatMap(player => player.annual_snapshots || []),
    ...(data.diff_series || [])
  ]);
}

function timePresetBounds(range, months) {
  const end = months.at(-1).month_key;
  const years = {'1y': 1, '2y': 2, '3y': 3, '5y': 5}[range];
  if (!years) return [months[0].month_key, end];
  const start = String(end).length === 8
    ? months.find(month => month.month_key >= end - years * 10000)
    : months[Math.max(0, months.length - years * 12)];
  return [start.month_key, end];
}

function updateTimePillActive() {
  document.querySelectorAll('.btn-time-pill[data-range]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.range === currentTimePreset);
  });
}

function syncGoRatingsAlignVisibility() {
  const wrap = document.getElementById('goratingsDiffAlignWrap');
  if (!wrap) return;
  const isGoTwoDiff = (currentChartData?.system_id === 'goratings' || currentSystem === 'goratings')
    && (currentChartData?.players?.length === 2)
    && currentChartMode === 'two-diff';
  wrap.style.display = isGoTwoDiff ? '' : 'none';
  wrap.querySelectorAll('.btn-align-pill').forEach(b => {
    b.classList.toggle('active', b.dataset.align === goratingsDiffAlign);
  });
}

async function runPlayerTrend() {
  const tableWrap = document.getElementById('trendTableWrap');
  const cardsWrap = document.getElementById('trendCardsWrap');
  const chartWrap = document.getElementById('trendChartWrap');
  const noticeWrap = document.getElementById('trendNotice');
  const pillsWrap = document.getElementById('trendSystemPills');
  const sysSelect = document.getElementById('selTrendSystem');
  const savePreset = document.getElementById('btnSaveCustomPreset');
  const status = document.getElementById('trendStatus');
  if (!chartWrap) return;

  const request = ++trendRequest;
  const version = viewVersion;
  const isCurrent = () => version === viewVersion && request === trendRequest;
  const setBusy = busy => {
    for (const panel of [chartWrap, tableWrap]) {
      panel.classList.toggle('is-loading', busy);
      panel.setAttribute('aria-busy', String(busy));
      panel.inert = busy;
    }
    savePreset.disabled = busy || !currentChartData || currentChartData.system_id !== currentSystem;
  };
  currentSystem = sysSelect.value;
  const playerList = [...currentTrendPlayers];
  syncWorkspaceUrlState();
  if (!playerList.length) {
    currentChartRenderer?.destroy();
    currentChartRenderer = null;
    currentChartData = null;
    noticeWrap.replaceChildren();
    cardsWrap.replaceChildren();
    pillsWrap.replaceChildren();
    chartWrap.innerHTML = '<div class="ratings-chart-empty">添加棋手以查看走势。</div>';
    tableWrap.replaceChildren();
    updateChartControls(null);
    syncGoRatingsAlignVisibility();
    setPanelStatus(status);
    setBusy(false);
    return;
  }

  setPanelStatus(status, '正在加载走势…');
  setBusy(true);
  let loaded = false;
  try {
    let chartData = null;
    if (playerList.length > 1) {
      // 多人查询模式
      const alignParam = currentSystem === 'goratings' ? `&align=${encodeURIComponent(goratingsDiffAlign)}` : '';
      const data = await apiGet(`/api/ratings/multi-history?system=${encodeURIComponent(currentSystem)}&players=${encodeURIComponent(playerList.join(','))}${alignParam}`);
      if (!isCurrent()) return;
      chartData = data;
      pillsWrap.replaceChildren();
      if (noticeWrap) {
        if (currentSystem === 'goratings' || chartData.time_scale === 'date') {
          noticeWrap.innerHTML = `
            <div class="ratings-info-banner">
              <span class="info-icon">${chartIcon('info')}</span>
              <span>${esc(chartData.methodology_note || 'GoRatings 使用 WHR 全历史模型按全部已收录对局估计棋手各时期实力；双人分差图默认按自然周采样，可切换对局日并集 LOCF。')}</span>
            </div>
          `;
        } else {
          noticeWrap.innerHTML = '';
        }
      }
    } else {
      // 单人查询模式
      const data = await apiGet(`/api/ratings/history?system=${encodeURIComponent(currentSystem)}&player=${encodeURIComponent(playerList[0])}`);
      if (!isCurrent()) return;
      if (data.auto_switched && data.system_id && data.system_id !== currentSystem) {
        currentSystem = data.system_id;
        if (sysSelect) sysSelect.value = data.system_id;
        const unit = data.system_id === 'goratings' ? '个对局日' : '个月';
        if (noticeWrap) {
          noticeWrap.innerHTML = `
            <div class="ratings-info-banner">
              <span class="info-icon">${chartIcon('info')}</span>
              <span>棋手 ${esc(data.player_clean)} 在原体系未收录，已自动切换至 ${esc(getSystemDisplayName(data.system_id))}（共 ${data.total_records} ${unit}记录）。</span>
            </div>
          `;
        }
      } else if (noticeWrap) {
        if (data.system_id === 'goratings' || data.time_scale === 'date') {
          noticeWrap.innerHTML = `
            <div class="ratings-info-banner">
              <span class="info-icon">${chartIcon('info')}</span>
              <span>${esc(data.methodology_note || 'GoRatings 采用 WHR 全历史模型回算分值，年度与实时排名来自官网快照。')}</span>
            </div>
          `;
        } else {
          noticeWrap.innerHTML = '';
        }
      }

      // 快捷体系药丸
      if (pillsWrap && data.available_systems) {
        const otherSys = Object.keys(data.available_systems).filter(k => k !== currentSystem);
        if (otherSys.length > 0) {
          pillsWrap.innerHTML = `
            <span class="pills-label">其他收录体系：</span>
            ${otherSys.map(k => `
              <button class="btn btn-sm btn-sys-pill" type="button" data-sys="${esc(k)}">
                ${esc(getSystemDisplayName(k))} (${data.available_systems[k]}${k === 'goratings' ? '个对局日' : '个月'})
              </button>
            `).join('')}
          `;
          pillsWrap.querySelectorAll('.btn-sys-pill').forEach(pill => {
            pill.onclick = () => {
              currentSystem = pill.dataset.sys;
              if (sysSelect) sysSelect.value = pill.dataset.sys;
              runPlayerTrend();
            };
          });
        } else {
          pillsWrap.innerHTML = '';
        }
      } else if (pillsWrap) {
        pillsWrap.innerHTML = '';
      }

      chartData = {
        system_id: data.system_id,
        time_scale: data.time_scale || (data.system_id === 'goratings' ? 'date' : 'month'),
        methodology_note: data.methodology_note || null,
        players: [{
          searched_name: data.searched_player,
          player_clean: data.player_clean,
          player_id: data.player_id || null,
          country: data.country || null,
          name_en: data.name_en || null,
          total_records: data.total_records,
          history: data.history,
          annual_snapshots: data.annual_snapshots || [],
          available_systems: data.available_systems
        }],
        months: (data.history || []).map(h => ({
          month_key: h.month_key,
          month_str: h.date || h.month_str,
          date: h.date || null
        })),
        diff_series: []
      };
    }

    const sameSystem = currentChartData?.system_id === chartData.system_id;
    if (chartData.time_scale === 'date') {
      chartData.months = dateTimeline(chartData.players.flatMap(player => player.history || []));
    }
    currentChartData = chartData;
    if (!sameSystem) currentTimePreset = 'all';
    updateChartControls(chartData);
    renderActivePlayerChips();
    renderTrendStatsCards(cardsWrap, chartData);
    syncGoRatingsAlignVisibility();

    // 绘制等级分矢量图表
    renderChartPlot();

    // 渲染数据表格
    renderTrendTable(tableWrap, chartData);
    syncWorkspaceUrlState();
    setPanelStatus(status);
    loaded = true;
  } catch (err) {
    if (isCurrent()) setPanelStatus(status, `走势加载失败：${err.message}`, true);
  } finally {
    if (isCurrent()) {
      setBusy(false);
      savePreset.disabled = !loaded;
    }
  }
}

function updateChartControls(chartData) {
  const modeSelect = document.getElementById('selChartMode');
  const startSelect = document.getElementById('selChartStartMonth');
  const endSelect = document.getElementById('selChartEndMonth');
  if (!modeSelect || !startSelect || !endSelect) return;

  const pCount = chartData?.players.length || 0;
  const previousBounds = [startSelect.value, endSelect.value];
  modeSelect.disabled = startSelect.disabled = endSelect.disabled = !pCount;
  let modeOptions = [];
  if (pCount === 1) {
    modeOptions = [
      { id: 'single-dual', label: '单人-独立双线' },
      { id: 'single-circle', label: '单人-点圈标注' }
    ];
    if (currentChartMode !== 'single-dual' && currentChartMode !== 'single-circle') {
      currentChartMode = 'single-dual';
    }
  } else if (pCount === 2) {
    modeOptions = [
      { id: 'two-diff', label: '双人-分差图' },
      { id: 'multi-rating', label: '多人-对比等级分' },
      { id: 'multi-rank', label: '多人-对比排名' }
    ];
    if (!['two-diff', 'multi-rating', 'multi-rank'].includes(currentChartMode)) {
      currentChartMode = 'two-diff';
    }
  } else if (pCount > 2) {
    modeOptions = [
      { id: 'multi-rating', label: '多人-对比等级分' },
      { id: 'multi-rank', label: '多人-对比排名' }
    ];
    if (!['multi-rating', 'multi-rank'].includes(currentChartMode)) {
      currentChartMode = 'multi-rating';
    }
  }

  modeSelect.innerHTML = modeOptions.map(m => `
    <option value="${m.id}" ${m.id === currentChartMode ? 'selected' : ''}>${esc(m.label)}</option>
  `).join('');

  // 填充起止月份下拉
  const months = chartData ? trendTimeOptions(chartData) : [];
  if (months.length > 0) {
    startSelect.innerHTML = months.map((m, idx) => `
      <option value="${m.month_key}" ${idx === 0 ? 'selected' : ''}>${esc(m.month_str)}</option>
    `).join('');
    endSelect.innerHTML = months.map((m, idx) => `
      <option value="${m.month_key}" ${idx === months.length - 1 ? 'selected' : ''}>${esc(m.month_str)}</option>
    `).join('');
    if (currentTimePreset === 'custom') {
      const keys = months.map(month => String(month.month_key));
      if (keys.includes(previousBounds[0]) && keys.includes(previousBounds[1])) {
        [startSelect.value, endSelect.value] = previousBounds;
      } else {
        currentTimePreset = 'all';
      }
    } else {
      [startSelect.value, endSelect.value] = timePresetBounds(currentTimePreset, months);
    }
  } else {
    startSelect.innerHTML = '';
    endSelect.innerHTML = '';
  }
  updateTimePillActive();
}

function renderChartPlot() {
  const chartWrap = document.getElementById('trendChartWrap');
  if (!chartWrap || !currentChartData) return;

  const startVal = document.getElementById('selChartStartMonth')?.value;
  const endVal = document.getElementById('selChartEndMonth')?.value;
  const sparseX = Boolean(document.getElementById('chkChartSparse')?.checked);
  const smooth = Boolean(document.getElementById('chkChartSmooth')?.checked ?? true);
  const showGrid = Boolean(document.getElementById('chkChartGrid')?.checked ?? true);

  const options = {
    mode: currentChartMode,
    timeScale: currentChartData.time_scale || (currentChartData.system_id === 'goratings' ? 'date' : 'month'),
    systemName: getSystemDisplayName(currentChartData.system_id),
    theme: document.body.dataset.theme,
    sparseX: sparseX,
    showLabels: true,
    labelMode: chartLabelMode,
    showPoints: chartShowPoints,
    sampling: chartSampling,
    smooth: smooth,
    showGrid: showGrid,
    ptSize: chartPtSize,
    startKey: startVal ? parseInt(startVal, 10) : null,
    endKey: endVal ? parseInt(endVal, 10) : null,
    onBrushRange: ({startKey, endKey}) => {
      const startSel = document.getElementById('selChartStartMonth');
      const endSel = document.getElementById('selChartEndMonth');
      if (!startSel || !endSel) return;
      const previousBounds = [startSel.value, endSel.value];
      startSel.value = String(startKey);
      endSel.value = String(endKey);
      if (!startSel.value || !endSel.value) {
        [startSel.value, endSel.value] = previousBounds;
        return;
      }
      currentTimePreset = 'custom';
      updateTimePillActive();
      renderChartPlot();
      renderTrendTable(document.getElementById('trendTableWrap'), currentChartData);
      setRatingsStatus('已放大所选时间区间（双击画布可恢复全部区间）。', false);
    },
    onResetZoom: () => {
      applyTimePreset('all');
      setRatingsStatus('已恢复全部时间区间。', false);
    }
  };
  if (currentChartRenderer?.data === currentChartData) {
    currentChartRenderer.setOptions(options);
  } else {
    currentChartRenderer?.destroy();
    currentChartRenderer = window.GoViewerRatingsChart.create(chartWrap, options);
    currentChartRenderer.setData(currentChartData);
  }
}

function renderTrendStatsCards(cardsWrap, chartData) {
  if (!cardsWrap) return;
  const players = chartData.players || [];
  const isDate = chartData.time_scale === 'date' || chartData.system_id === 'goratings';

  if (players.length === 1) {
    const p = players[0];
    const history = p.history || [];
    if (history.length === 0) {
      cardsWrap.innerHTML = '';
      return;
    }
    const validHistory = history.filter(h => h.public_rating !== null && h.public_rating > 0);
    const rankRows = isDate && Array.isArray(p.annual_snapshots) && p.annual_snapshots.length > 0
      ? p.annual_snapshots.filter(h => h.rank !== null && h.rank !== undefined)
      : validHistory.filter(h => h.rank !== null && h.rank !== undefined);
    const bestRank = rankRows.length > 0 ? Math.min(...rankRows.map(h => h.rank)) : '-';
    const peakRating = validHistory.length > 0 ? Math.max(...validHistory.map(h => h.public_rating)).toFixed(1) : '-';
    const latest = history[history.length - 1];

    cardsWrap.innerHTML = `
      <div class="stat-card">
        <div class="stat-number">${history.length}</div>
        <div class="stat-title">${isDate ? '已收录对局日' : '已收录月数'}</div>
      </div>
      <div class="stat-card stat-card--gold">
        <div class="stat-number">${bestRank}</div>
        <div class="stat-title">${isDate ? '年度/实时最高名次' : '历史最高名次'}</div>
      </div>
      <div class="stat-card stat-card--up">
        <div class="stat-number">${peakRating}</div>
        <div class="stat-title">${isDate ? 'WHR 历史最高分' : '历史最高等级分'}</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${latest.public_rating ? latest.public_rating.toFixed(1) : '-'}</div>
        <div class="stat-title">最新分值 (${esc(latest.date || latest.month_str)})</div>
      </div>
    `;
  } else if (players.length === 2) {
    const p1 = players[0];
    const p2 = players[1];
    const diffs = chartData.diff_series || [];
    const latestDiff = diffs.length > 0 ? diffs[diffs.length - 1] : null;

    let leadText = '持平';
    let leadCardClass = 'stat-card--lead-tie';
    if (latestDiff) {
      if (latestDiff.diff > 0) {
        leadText = `${p1.player_clean} +${latestDiff.diff}`;
        leadCardClass = 'stat-card--lead-p1';
      } else if (latestDiff.diff < 0) {
        leadText = `${p2.player_clean} +${Math.abs(latestDiff.diff)}`;
        leadCardClass = 'stat-card--lead-p2';
      }
    }

    const sampleTitle = isDate
      ? `对比采样点数 (${chartData.align === 'union' ? '对局日并集' : '自然周'})`
      : '共同对局月数';

    cardsWrap.innerHTML = `
      <div class="stat-card">
        <div class="stat-number">${diffs.length}</div>
        <div class="stat-title">${sampleTitle}</div>
      </div>
      <div class="stat-card stat-card--lead-p1">
        <div class="stat-number">${latestDiff ? latestDiff.p1_rating.toFixed(1) : '-'}</div>
        <div class="stat-title">${esc(p1.player_clean)} 最新分</div>
      </div>
      <div class="stat-card stat-card--lead-p2">
        <div class="stat-number">${latestDiff ? latestDiff.p2_rating.toFixed(1) : '-'}</div>
        <div class="stat-title">${esc(p2.player_clean)} 最新分</div>
      </div>
      <div class="stat-card ${leadCardClass}">
        <div class="stat-number stat-number--compact">${esc(leadText)}</div>
        <div class="stat-title">最新分差 (${esc(latestDiff?.date || latestDiff?.month_str || '-')})</div>
        ${(p1.player_id && p2.player_id && p1.player_id !== p2.player_id) ? `<a class="stat-h2h-link" href="head-to-head.html?a=${encodeURIComponent(p1.player_id)}&amp;b=${encodeURIComponent(p2.player_id)}" target="_blank" rel="noopener noreferrer">查看历史交锋 →</a>` : ''}
      </div>
    `;
  } else {
    const nodeCount = isDate
      ? new Set(players.flatMap(p => (p.history || [])
        .map(h => h.date || h.month_key || h.month_str)
        .filter(Boolean))).size
      : (chartData.months?.length || new Set(players.flatMap(p => (p.history || [])
        .map(h => h.month_key).filter(Boolean))).size);
    cardsWrap.innerHTML = `
      <div class="stat-card">
        <div class="stat-number">${players.length}</div>
        <div class="stat-title">对比棋手人数</div>
      </div>
      <div class="stat-card stat-card--gold">
        <div class="stat-number">${nodeCount}</div>
        <div class="stat-title">${isDate ? '时间节点数' : '总收录月份数'}</div>
      </div>
      <div class="stat-card">
        <div class="stat-number stat-number--roster">${players.map(p => esc(p.player_clean)).join('、')}</div>
        <div class="stat-title">对比棋手阵容</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${esc(getSystemDisplayName(chartData.system_id))}</div>
        <div class="stat-title">等级分体系</div>
      </div>
    `;
  }
}

function renderTrendTable(tableWrap, chartData) {
  if (!tableWrap || !chartData) return;
  const players = chartData.players || [];
  const isDate = chartData.time_scale === 'date' || chartData.system_id === 'goratings';
  if (players.length === 0) {
    tableWrap.innerHTML = '<div class="ratings-empty">未找到数据。</div>';
    return;
  }

  // 1 人：个人全量走势表格
  if (players.length === 1) {
    const history = players[0].history || [];
    const rowsHtml = history.slice().reverse().map(h => `
      <tr>
        <td class="cell-month"><strong>${esc(h.date || h.month_str)}</strong></td>
        <td class="cell-rank">${h.rank !== null && h.rank !== undefined ? h.rank : '-'}</td>
        <td class="cell-dan">${esc(h.dan || '-')}</td>
        <td class="cell-age">${esc(h.age !== null && h.age !== undefined ? h.age : '-')}</td>
        <td class="cell-rating"><strong>${h.public_rating !== null && h.public_rating !== undefined ? h.public_rating.toFixed(1) : '-'}</strong></td>
        <td class="cell-diff">${formatDiff(h.rating_change, false)}</td>
        <td class="cell-diff">${formatDiff(h.rank_change, true)}</td>
        <td class="cell-source">${esc(h.source_locator || '-')}</td>
      </tr>
    `).join('');

    tableWrap.innerHTML = `
      <table class="ratings-data-table">
        <thead>
          <tr>
            <th>${isDate ? '日期' : '月份'}</th>
            <th>排名</th>
            <th>段位</th>
            <th>年龄</th>
            <th>${isDate ? 'WHR 估值' : '公示分'}</th>
            <th>分值变动</th>
            <th>名次变动</th>
            <th>来源定位</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;
    return;
  }

  // 2 人双人分差表
  if (players.length === 2 && currentChartMode === 'two-diff') {
    const p1 = players[0];
    const p2 = players[1];
    const diffs = (chartData.diff_series || []).slice().reverse();

    const rowsHtml = diffs.map(d => {
      const leader = d.diff > 0 ? `${p1.player_clean} 领先` : d.diff < 0 ? `${p2.player_clean} 领先` : '持平';
      const leadClass = d.diff > 0 ? 'ratings-lead--p1' : d.diff < 0 ? 'ratings-lead--p2' : 'ratings-muted';
      const r1Rank = d.p1_rank ? ` <small>(第${d.p1_rank}名)</small>` : '';
      const r2Rank = d.p2_rank ? ` <small>(第${d.p2_rank}名)</small>` : '';
      return `
        <tr>
          <td class="cell-month"><strong>${esc(d.date || d.month_str)}</strong></td>
          <td class="cell-rating">${d.p1_rating.toFixed(1)}${r1Rank}</td>
          <td class="cell-rating">${d.p2_rating.toFixed(1)}${r2Rank}</td>
          <td class="cell-diff"><strong>${d.diff > 0 ? '+' + d.diff : d.diff}</strong></td>
          <td><span class="${leadClass}">${esc(leader)}</span></td>
        </tr>
      `;
    }).join('');

    tableWrap.innerHTML = `
      <table class="ratings-data-table">
        <thead>
          <tr>
            <th>${isDate ? '日期' : '月份'}</th>
            <th>${esc(p1.player_clean)} 等级分</th>
            <th>${esc(p2.player_clean)} 等级分</th>
            <th>分差 (${esc(p1.player_clean)} - ${esc(p2.player_clean)})</th>
            <th>当期领先方</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;
    return;
  }

  // 多人对比表格
  const months = (chartData.months || []).slice().reverse();
  const keyOf = item => isDate ? (item.date || item.month_str || String(item.month_key)) : item.month_key;
  const playerHistMaps = players.map(p => new Map((p.history || []).map(h => [keyOf(h), h])));

  const rowsHtml = months.map(m => {
    const mKey = keyOf(m);
    return `
    <tr>
      <td class="cell-month"><strong>${esc(m.date || m.month_str)}</strong></td>
      ${players.map((p, pIdx) => {
        const item = playerHistMaps[pIdx].get(mKey);
        if (!item || item.public_rating === null || item.public_rating === undefined) return '<td>-</td>';
        return `
          <td><strong>${item.public_rating.toFixed(1)}</strong>${item.rank ? ` <small>(第${item.rank}名)</small>` : ''}</td>
        `;
      }).join('')}
    </tr>
  `;
  }).join('');

  tableWrap.innerHTML = `
    <table class="ratings-data-table">
      <thead>
        <tr>
          <th>${isDate ? '日期' : '月份'}</th>
          ${players.map(p => `<th>${esc(p.player_clean)}</th>`).join('')}
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
}

function openPlayerTrend(playerName) {
  switchTab('trend', playerName);
}

// 4. 等级分导入

async function renderImportView() {
  const content = document.getElementById('ratingsContent');
  const version = viewVersion;
  const systems = await loadSystems();

  if (version !== viewVersion) return;
  content.innerHTML = `
    <div class="ratings-import-container">
      <div class="ratings-import-header">
        <h3>${chartIcon('download', 18)} 等级分数据文件导入与月度导出</h3>
        <p class="ratings-import-desc">支持导入 Excel 文件（.xlsx, .xls）与标准 CSV 文件，自动识别月份并生成可撤销批次。</p>
      </div>

      <div class="ratings-import-cards-grid">
        <!-- 卡片 1：文件导入与预检 -->
        <div class="ratings-card ratings-import-card">
          <div class="ratings-card-header">
            <h4>1. 数据文件导入 (Excel / CSV)</h4>
          </div>
          <div class="ratings-card-body">
            <div class="ratings-form-row">
              <label>目标等级分体系
                <select id="selImportSystem" class="ratings-select">
                  ${systems.map(s => `<option value="${esc(s.id)}" ${s.id === currentSystem ? 'selected' : ''}>${esc(s.display_name)}</option>`).join('')}
                </select>
              </label>
            </div>

            <div class="ratings-form-row">
              <label for="fileRatingImport">导入文件</label>
              <div class="ratings-file-dropzone" id="importDropzone">
                <input type="file" id="fileRatingImport" class="ratings-file-input" accept=".xlsx,.xls,.csv">
                <button type="button" class="btn" id="btnChooseImportFile">${chartIcon('folder')} 选择本地文件</button>
                <span id="txtChosenFileName" class="chosen-filename">可拖入 Excel 或 CSV</span>
              </div>
            </div>

            <details class="ratings-advanced-path">
              <summary>服务器文件路径</summary>
              <div class="ratings-form-row">
                <label>文件路径
                  <input type="text" id="txtServerImportPath" class="ratings-input">
                </label>
              </div>
            </details>

            <div class="ratings-import-actions">
              <button type="button" class="btn btn-gold" id="btnPreviewImport">${chartIcon('search')} 预检解析文件</button>
              <button type="button" class="btn btn-gold" id="btnCommitImport" disabled>${chartIcon('zap')} 确认并导入入库</button>
            </div>

            <div id="importStatusNotice" class="ratings-notice-wrap"></div>
          </div>
        </div>

        <!-- 卡片 2：月度 CSV 导出 -->
        <div class="ratings-card ratings-import-card">
          <div class="ratings-card-header">
            <h4>2. 月度等级分 CSV 导出</h4>
          </div>
          <div class="ratings-card-body">
            <p class="ratings-import-desc">选择体系与月份，导出 UTF-8 BOM CSV 明细表。</p>
            <div class="ratings-form-row">
              <label>体系
                <select id="selExportSystem" class="ratings-select">
                  ${systems.map(s => `<option value="${esc(s.id)}" ${s.id === currentSystem ? 'selected' : ''}>${esc(s.display_name)}</option>`).join('')}
                </select>
              </label>
            </div>
            <div class="ratings-form-row">
              <label>月份
                <select id="selExportMonth" class="ratings-select"></select>
              </label>
            </div>
            <div class="ratings-import-actions">
              <button type="button" class="btn" id="btnRunMonthExport">${chartIcon('download')} 下载月度 CSV</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 预检详情与样本预览展示区 -->
      <div id="importPreviewSection" class="ratings-card ratings-preview-card" style="display:none;">
        <div class="ratings-card-header ratings-card-header--split">
          <h4>文件预检结果预览</h4>
          <span id="previewMetaBadge" class="badge ratings-preview-badge"></span>
        </div>
        <div class="ratings-card-body">
          <div id="previewMonthsWrap" class="import-months-wrap"></div>
          <div id="previewSamplesWrap" class="import-samples-wrap"></div>
        </div>
      </div>

      <!-- 导入完成结果面板 -->
      <div id="importResultSection" class="ratings-card ratings-result-card" style="display:none;"></div>
    </div>
  `;

  let chosenFile = null;
  let preview = null;
  let sourceVersion = 0;
  let importing = false;

  const fileInput = document.getElementById('fileRatingImport');
  const txtFileName = document.getElementById('txtChosenFileName');
  const txtServerPath = document.getElementById('txtServerImportPath');
  const noticeWrap = document.getElementById('importStatusNotice');
  const previewSection = document.getElementById('importPreviewSection');
  const previewMeta = document.getElementById('previewMetaBadge');
  const monthsWrap = document.getElementById('previewMonthsWrap');
  const samplesWrap = document.getElementById('previewSamplesWrap');
  const resultSection = document.getElementById('importResultSection');
  const btnPreview = document.getElementById('btnPreviewImport');
  const btnCommit = document.getElementById('btnCommitImport');
  const systemSelect = document.getElementById('selImportSystem');
  const isActive = () => version === viewVersion;
  const invalidatePreview = () => {
    sourceVersion++;
    preview = null;
    btnCommit.disabled = true;
    btnPreview.disabled = false;
    btnPreview.innerHTML = `${chartIcon('search')} 预检解析文件`;
    previewSection.style.display = 'none';
    resultSection.style.display = 'none';
    noticeWrap.replaceChildren();
  };

  const acceptFiles = files => {
    if (!files.length || importing) return;
    invalidatePreview();
    chosenFile = null;
    txtServerPath.value = '';
    const file = files[0];
    if (files.length !== 1 || !/\.(xlsx|xls|csv)$/i.test(file.name)) {
      fileInput.value = '';
      txtFileName.textContent = '未选择文件';
      noticeWrap.innerHTML = '<div class="ratings-error">请选择一个 .xlsx、.xls 或 .csv 文件。</div>';
      return;
    }
    chosenFile = file;
    txtFileName.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
  };
  document.getElementById('btnChooseImportFile').onclick = () => fileInput.click();
  fileInput.onchange = () => acceptFiles(fileInput.files);
  const dropzone = document.getElementById('importDropzone');
  const enableDrop = event => {
    if (importing || !event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    dropzone.classList.add('is-dragover');
  };
  dropzone.addEventListener('dragenter', enableDrop);
  dropzone.addEventListener('dragover', enableDrop);
  dropzone.addEventListener('dragleave', event => {
    if (!dropzone.contains(event.relatedTarget)) dropzone.classList.remove('is-dragover');
  });
  dropzone.addEventListener('drop', event => {
    event.preventDefault();
    dropzone.classList.remove('is-dragover');
    fileInput.value = '';
    acceptFiles(event.dataTransfer?.files || []);
  });

  systemSelect.onchange = invalidatePreview;
  txtServerPath.oninput = () => {
    invalidatePreview();
    if (txtServerPath.value.trim()) {
      chosenFile = null;
      fileInput.value = '';
    }
    if (!chosenFile) txtFileName.textContent = txtServerPath.value.trim() ? '使用服务器端路径' : '未选择文件';
  };

  // 读取文件内容为 Base64
  function readFileBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        const b64 = dataUrl.split(',')[1];
        resolve(b64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  const importSource = async (file, serverPath) => file
    ? {file_base64: await readFileBase64(file), file_name: file.name}
    : {source_path: serverPath};

  // 1. 预检解析
  btnPreview.onclick = async () => {
    invalidatePreview();
    const request = sourceVersion;
    const isCurrent = () => isActive() && request === sourceVersion;
    const system = systemSelect.value;
    const file = chosenFile;
    const serverPath = txtServerPath.value.trim();

    if (!file && !serverPath) {
      noticeWrap.innerHTML = '<div class="ratings-error">请选择文件或输入服务器路径。</div>';
      return;
    }
    btnPreview.disabled = true;
    btnPreview.textContent = '解析中…';

    try {
      const source = await importSource(file, serverPath);
      if (!isCurrent()) return;
      const res = await apiPost('/api/ratings/import/preview', {system, ...source});
      if (!isCurrent()) return;
      if (!res.ok) {
        noticeWrap.innerHTML = `<div class="ratings-error">预检解析失败：${esc((res.errors || []).join('; ') || '未能识别等级分内容')}</div>`;
        return;
      }

      preview = {system, file, serverPath, total: res.total_records};
      previewSection.style.display = 'block';
      previewMeta.textContent = `共识别 ${(res.months || []).length} 个月份，${res.total_records} 条记录`;

      // 渲染月份勾选列表
      monthsWrap.innerHTML = `
        <div class="ratings-preview-subtitle">包含的月份与记录数（勾选需导入的月份）：</div>
        <div class="import-months-list">
          ${(res.months || []).map(m => `
            <label class="import-month-item">
              <input type="checkbox" class="chk-import-month" value="${m.month_key}" checked>
              <span><strong>${esc(m.month_str)}</strong> (${m.record_count}条)</span>
              ${m.has_existing_snapshot ? `<span class="ratings-tag-override">[覆盖修订]</span>` : `<span class="ratings-tag-new">[新增]</span>`}
            </label>
          `).join('')}
        </div>
      `;

      // 渲染样本数据预览表格
      const samples = res.sample_entries || [];
      samplesWrap.innerHTML = `
        <div class="ratings-preview-subtitle ratings-preview-subtitle--spaced">数据样本预览（前 ${samples.length} 条）：</div>
        <table class="import-sample-table">
          <thead>
            <tr>
              <th>名次</th>
              <th>棋手姓名</th>
              <th>段位</th>
              <th>年龄</th>
              <th>等级分 / 公示分</th>
              <th>名次变动</th>
              <th>分值变动</th>
            </tr>
          </thead>
          <tbody>
            ${samples.map(s => `
              <tr>
                <td><strong>${s.rank}</strong></td>
                <td>${esc(s.player_clean)}</td>
                <td>${esc(s.dan || '-')}</td>
                <td>${s.age || '-'}</td>
                <td class="ratings-cell-accent">${s.public_rating !== null ? s.public_rating.toFixed(1) : (s.rating || '-')}</td>
                <td>${esc(s.rank_change || '-')}</td>
                <td>${esc(s.rating_change || '-')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;

      btnCommit.disabled = false;
      noticeWrap.innerHTML = `<div class="ratings-info-banner"><span class="info-icon">${chartIcon('check')}</span><span>文件预检解析完成，请核对上方月份与样本无误后，点击“确认并导入入库”。</span></div>`;

    } catch (err) {
      if (isCurrent()) noticeWrap.innerHTML = `<div class="ratings-error">解析失败：${esc(err.message)}</div>`;
    } finally {
      if (isCurrent()) {
        btnPreview.disabled = false;
        btnPreview.innerHTML = `${chartIcon('search')} 预检解析文件`;
      }
    }
  };

  // 2. 确认提交导入
  btnCommit.onclick = async () => {
    if (!preview || importing) return;
    const selectedPreview = preview;

    const checkedBoxes = [...previewSection.querySelectorAll('.chk-import-month:checked')];
    if (checkedBoxes.length === 0) {
      const msg = '请至少勾选一个要导入的月份！';
      noticeWrap.innerHTML = `<div class="ratings-error">${msg}</div>`;
      setRatingsStatus(msg, true);
      return;
    }
    const selectedMonths = checkedBoxes.map(cb => parseInt(cb.value, 10));

    const accepted = await confirmRatingsAction(
      `将所选 ${selectedMonths.length} 期等级分写入数据库？预检共识别 ${selectedPreview.total} 条记录。`,
      '确认导入'
    );
    if (!accepted || !isActive() || preview !== selectedPreview || importing) return;

    importing = true;
    const sourceControls = [fileInput, txtServerPath, systemSelect, document.getElementById('btnChooseImportFile'), btnPreview];
    sourceControls.forEach(control => { control.disabled = true; });
    btnCommit.disabled = true;
    btnCommit.textContent = '正在导入…';
    noticeWrap.innerHTML = '<div class="ratings-loading">正在写入等级分快照…</div>';

    try {
      const {system, file, serverPath} = selectedPreview;
      const payload = {
        system,
        ...await importSource(file, serverPath),
        selected_months: selectedMonths,
        dry_run: false
      };

      const res = await apiPost('/api/ratings/import/commit', payload);
      if (!isActive()) return;

      resultSection.style.display = 'block';
      resultSection.innerHTML = `
        <div class="ratings-card-header ratings-card-header--success">
          ${chartIcon('check', 16)} 等级分数据导入成功！
        </div>
        <div class="ratings-card-body">
          <div class="ratings-result-summary">
            <div><strong>批次编号：</strong><code>${esc(res.batch_id)}</code></div>
            <div><strong>成功入库：</strong>${res.entries_inserted} 条等级分记录，创建/更新 ${res.snapshots_created} 个月度快照。</div>
            <div><strong>候选棋手扫描：</strong>发现并录入 ${res.candidate_summary?.new_candidates || 0} 个新候选棋手，冲突 ${res.candidate_summary?.conflicts || 0} 个。</div>
            <div class="ratings-result-backup">已自动创建一致性备份快照：<code>${esc(res.backup_path)}</code></div>
          </div>
          <div class="ratings-result-actions">
            <button class="btn btn-sm btn-gold" id="btnGoToRankingAfterImport">${chartIcon('table')} 前往月度榜单查看</button>
            <button class="btn btn-sm" id="btnGoToCandidatesAfterImport">${chartIcon('users')} 前往候选治理</button>
            <button class="btn btn-sm" id="btnUndoCurrentImportBatch" data-batch="${esc(res.batch_id)}">${chartIcon('undo')} 撤销此批次</button>
          </div>
        </div>
      `;

      noticeWrap.innerHTML = '';
      previewSection.style.display = 'none';

      document.getElementById('btnGoToRankingAfterImport').onclick = () => switchTab('ranking');
      document.getElementById('btnGoToCandidatesAfterImport').onclick = () => switchTab('candidates');
      document.getElementById('btnUndoCurrentImportBatch').onclick = async (e) => {
        const bId = e.currentTarget.dataset.batch;
        if (!(await confirmRatingsAction(`撤销刚刚导入的批次「${bId}」？`, '撤销批次', true))) return;
        try {
          await apiPost('/api/ratings/undo', { batch_id: bId });
          await renderImportView();
          setRatingsStatus('撤销成功！已恢复导入前的状态。', false);
        } catch (err) {
          setRatingsStatus('撤销失败: ' + err.message, true);
        }
      };

    } catch (err) {
      noticeWrap.innerHTML = `<div class="ratings-error">导入失败：${esc(err.message)}</div>`;
      btnCommit.disabled = false;
      btnCommit.innerHTML = `${chartIcon('zap')} 确认并导入入库`;
    } finally {
      importing = false;
      sourceControls.forEach(control => { control.disabled = false; });
    }
  };

  // 3. 月度 CSV 导出联动
  const refreshExportMonths = async () => {
    const system = document.getElementById('selExportSystem');
    const sys = system.value;
    const ms = await loadMonths(sys);
    if (!isActive() || sys !== system.value) return;
    const sel = document.getElementById('selExportMonth');
    if (ms.length > 0) {
      sel.innerHTML = ms.slice().reverse().map(m => `
        <option value="${m.month_key}">${esc(m.month_str)} (${m.summary?.valid_entries || m.summary?.total_entries || 0}人)</option>
      `).join('');
    } else {
      sel.innerHTML = '<option value="">无月份记录</option>';
    }
  };

  document.getElementById('selExportSystem').onchange = refreshExportMonths;
  await refreshExportMonths();
  if (!isActive()) return;

  document.getElementById('btnRunMonthExport').onclick = () => {
    const sys = document.getElementById('selExportSystem').value;
    const m = document.getElementById('selExportMonth').value;
    if (sys && m) {
      window.open(`/api/ratings/export/month?system=${encodeURIComponent(sys)}&month=${encodeURIComponent(m)}`, '_blank');
    }
  };
}


// 4. 候选治理视图（编辑模式可用）
async function renderCandidatesView() {
  const version = viewVersion;
  const content = document.getElementById('ratingsContent');

  content.innerHTML = `
    <div class="ratings-toolbar">
      <div class="ratings-filter-group">
        <label>状态
          <select id="selCandidateStatus">
            <option value="">全部状态</option>
            <option value="pending" selected>待审核</option>
            <option value="conflict">有冲突</option>
            <option value="approved">已绑定</option>
            <option value="ignored">已忽略</option>
          </select>
        </label>
        <label class="ratings-search-label">搜索
          <input type="search" id="txtCandidateSearch" placeholder="搜索姓名或棋手 ID" autocomplete="off">
        </label>
        <button class="btn btn-sm btn-gold" id="btnAutoBindCandidates" type="button" title="一键将可信度较高的候选全部完成绑定">
          ${chartIcon('zap')} 一键绑定高可信度
        </button>
      </div>
      <div class="ratings-stats-badge" id="candidatesSummary"></div>
    </div>
    <div class="ratings-table-container" id="candidatesTableWrap">
      <div class="ratings-loading">正在读取候选队列…</div>
    </div>
    <div class="ratings-pager" id="candidatesPager"></div>
    <dialog class="confirm-dialog ratings-candidate-picker" id="ratingsCandidatePicker" aria-labelledby="ratingsCandidateTitle">
      <form method="dialog">
        <div class="modal-header"><h3 id="ratingsCandidateTitle"></h3></div>
        <div class="modal-body">
          <div class="ratings-player-search">
            <label for="ratingsCandidateSearch">搜索棋手</label>
            <input type="search" class="ratings-input" id="ratingsCandidateSearch" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="ratingsCandidateOptions" aria-expanded="false" autofocus>
            <div id="ratingsCandidateOptions" class="ratings-player-options" role="listbox" aria-label="棋手搜索结果" hidden></div>
          </div>
          <p id="ratingsCandidateSelection" role="status"></p>
        </div>
        <div class="editor-footer">
          <button class="btn" value="cancel" type="submit">取消</button>
          <button class="btn btn-gold" value="confirm" type="submit" disabled>确认绑定</button>
        </div>
      </form>
    </dialog>
  `;

  const btnAutoBind = document.getElementById('btnAutoBindCandidates');
  if (btnAutoBind) {
    btnAutoBind.onclick = async () => {
      if (!(await confirmRatingsAction('确定要一键绑定全部高可信度的候选棋手吗？（将自动绑定唯一确定匹配档案，排除冲突与有歧义异人）'))) {
        return;
      }
      btnAutoBind.disabled = true;
      btnAutoBind.textContent = '正在自动绑定…';
      try {
        const res = await apiPost('/api/ratings/candidates/auto-bind', {});
        setRatingsStatus(`绑定完成：成功绑定 ${res.approved_count} 项，冲突标记 ${res.conflict_updated_count} 项，未匹配跳过 ${res.skipped_unmatched_count} 项。`, false);
        await fetchAndDisplayCandidates();
      } catch (err) {
        setRatingsStatus('自动绑定失败: ' + err.message, true);
      } finally {
        btnAutoBind.disabled = false;
        btnAutoBind.innerHTML = `${chartIcon('zap')} 一键绑定高可信度`;
      }
    };
  }

  document.getElementById('selCandidateStatus').onchange = () => {
    candidatePage = 1;
    fetchAndDisplayCandidates();
  };

  let searchTimeout = null;
  document.getElementById('txtCandidateSearch').oninput = () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      if (version !== viewVersion) return;
      candidatePage = 1;
      fetchAndDisplayCandidates();
    }, 300);
  };

  await fetchAndDisplayCandidates();
}

async function fetchAndDisplayCandidates() {
  const tableWrap = document.getElementById('candidatesTableWrap');
  const summaryBadge = document.getElementById('candidatesSummary');
  const pager = document.getElementById('candidatesPager');
  if (!tableWrap) return;

  const statusVal = document.getElementById('selCandidateStatus')?.value || '';
  const searchVal = document.getElementById('txtCandidateSearch')?.value.trim() || '';

  tableWrap.innerHTML = '<div class="ratings-loading">正在读取候选列表…</div>';

  try {
    let url = `/api/ratings/candidates?limit=${candidateLimit}&offset=${(candidatePage - 1) * candidateLimit}`;
    if (statusVal) url += `&status=${encodeURIComponent(statusVal)}`;
    if (searchVal) url += `&search=${encodeURIComponent(searchVal)}`;

    const data = await apiGet(url);
    if (!tableWrap.isConnected) return;

    if (summaryBadge) {
      summaryBadge.innerHTML = `候选总数：<strong>${data.total}</strong> 项`;
    }

    if (!data.candidates || data.candidates.length === 0) {
      tableWrap.innerHTML = '<div class="ratings-empty">未找到匹配的候选记录。</div>';
      pager.innerHTML = '';
      return;
    }

    const rowsHtml = data.candidates.map(c => {
      const systemsStr = (c.systems || []).map(s => {
        if (s === 'china') return '中国';
        if (s === 'korea') return '韩国';
        if (s === 'goratings') return 'GoRatings';
        return s;
      }).join(' / ');

      let actionHtml = '';
      if (c.status === 'pending' && c.suggested_player_id) {
        actionHtml = `
          <button class="btn btn-sm btn-gold btn-approve-candidate" data-name="${esc(c.player_clean)}" data-target="${esc(c.suggested_player_id)}">
            确认绑定为 [${esc(c.suggested_player_id)}]
          </button>
          <button class="btn btn-sm btn-ignore-candidate" data-name="${esc(c.player_clean)}">忽略</button>
        `;
      } else if (c.status === 'approved') {
        actionHtml = `
          <span class="badge-approved">已绑定: ${esc(c.linked_player_id || c.suggested_player_id)}</span>
          <button class="btn btn-sm btn-reset-candidate" data-name="${esc(c.player_clean)}">解除绑定</button>
        `;
      } else if (c.status === 'conflict') {
        const ids = c.conflict_ids || [];
        actionHtml = `
          <div class="candidate-conflict-group">
            ${ids.length ? `<details class="candidate-conflict-details">
              <summary>查看 ${ids.length} 个冲突档案</summary>
              ${c.notes ? `<p>${esc(c.notes)}</p>` : ''}
              <ul>${ids.map(id => `<li data-profile-id="${esc(id)}"><a href="${esc(buildPlayerProfileHref(id))}" target="_blank" rel="noopener">${esc(id)}</a><small></small></li>`).join('')}</ul>
            </details>` : ''}
            <button class="btn btn-sm btn-specify-candidate" data-name="${esc(c.player_clean)}">搜索档案</button>
          </div>
        `;
      } else if (c.status === 'ignored') {
        actionHtml = `
          <span class="badge-ignored">已忽略</span>
          <button class="btn btn-sm btn-reset-candidate" data-name="${esc(c.player_clean)}">恢复待审核</button>
        `;
      } else {
        actionHtml = `
          <button class="btn btn-sm btn-specify-candidate" data-name="${esc(c.player_clean)}">搜索档案</button>
          <button class="btn btn-sm btn-ignore-candidate" data-name="${esc(c.player_clean)}">忽略</button>
        `;
      }

      return `
        <tr>
          <td class="cell-player">
            <strong>${esc(c.player_clean)}</strong>${playerProfileLinkHtml(c.linked_player_id, c.player_clean)}
          </td>
          <td>${esc(systemsStr)}</td>
          <td>${c.record_count} 条</td>
          <td>${c.first_month_key} ~ ${c.last_month_key}</td>
          <td><span class="badge-status badge-status-${esc(c.status)}">${esc(({pending: '待审核', conflict: '有冲突', approved: '已绑定', ignored: '已忽略'})[c.status] || c.status)}</span></td>
          <td class="cell-candidate-actions">${actionHtml}</td>
        </tr>
      `;
    }).join('');

    tableWrap.innerHTML = `
      <table class="ratings-data-table">
        <thead>
          <tr>
            <th>榜单姓名</th>
            <th>涵盖体系</th>
            <th>收录条数</th>
            <th>首末月份</th>
            <th>状态</th>
            <th>治理操作</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;

    tableWrap.querySelectorAll('.candidate-conflict-details').forEach(details => {
      details.addEventListener('toggle', async () => {
        if (!details.open || details.dataset.loaded) return;
        details.dataset.loaded = 'true';
        const items = [...details.querySelectorAll('[data-profile-id]')];
        await Promise.all(items.map(async item => {
          const id = item.dataset.profileId;
          const [profile, summary] = await Promise.allSettled([
            apiGet(`/api/page-data/player-profile?id=${encodeURIComponent(id)}`),
            window.GoStatsDataClient.playerSummary(id)
          ]);
          if (!item.isConnected) return;
          const player = profile.value?.player;
          if (player?.name_zh) item.querySelector('a').textContent = player.name_zh;
          const nationality = player?.nationality;
          const count = summary.value?.overall?.total;
          item.querySelector('small').textContent = [
            nationality && (window.GoViewerFlags.info(nationality).name || nationality),
            Number.isInteger(count) ? `${count} 局` : '',
            player?.name_zh ? id : ''
          ].filter(Boolean).join(' · ');
        }));
      });
    });

    // 绑定事件
    tableWrap.querySelectorAll('.btn-approve-candidate').forEach(btn => {
      btn.onclick = async () => {
        try {
          await apiPost('/api/ratings/candidate/review', {
            player_clean: btn.dataset.name,
            action: 'approve',
            target_player_id: btn.dataset.target
          });
          await fetchAndDisplayCandidates();
        } catch (err) {
          setRatingsStatus('操作失败: ' + err.message, true);
        }
      };
    });

    tableWrap.querySelectorAll('.btn-ignore-candidate').forEach(btn => {
      btn.onclick = async () => {
        try {
          await apiPost('/api/ratings/candidate/review', {
            player_clean: btn.dataset.name,
            action: 'ignore'
          });
          await fetchAndDisplayCandidates();
        } catch (err) {
          setRatingsStatus('操作失败: ' + err.message, true);
        }
      };
    });

    tableWrap.querySelectorAll('.btn-reset-candidate').forEach(btn => {
      btn.onclick = async () => {
        try {
          await apiPost('/api/ratings/candidate/review', {
            player_clean: btn.dataset.name,
            action: 'reset'
          });
          await fetchAndDisplayCandidates();
        } catch (err) {
          setRatingsStatus('操作失败: ' + err.message, true);
        }
      };
    });

    tableWrap.querySelectorAll('.btn-specify-candidate').forEach(btn => {
      btn.onclick = async () => {
        const target = await selectCandidatePlayer(btn.dataset.name);
        if (!target || !tableWrap.isConnected) return;
        btn.disabled = true;
        try {
          await apiPost('/api/ratings/candidate/review', {
            player_clean: btn.dataset.name,
            action: 'approve',
            target_player_id: target.id
          });
          await fetchAndDisplayCandidates();
        } catch (err) {
          setRatingsStatus('绑定失败：' + err.message, true);
        } finally {
          btn.disabled = false;
        }
      };
    });

    // Pager
    const totalPages = Math.ceil(data.total / candidateLimit) || 1;
    pager.innerHTML = `
      <button class="btn btn-sm" id="btnCandPrev" ${candidatePage <= 1 ? 'disabled' : ''}>上一页</button>
      <span class="pager-info">第 ${candidatePage} / ${totalPages} 页 (共 ${data.total} 项)</span>
      <button class="btn btn-sm" id="btnCandNext" ${candidatePage >= totalPages ? 'disabled' : ''}>下一页</button>
    `;
    document.getElementById('btnCandPrev').onclick = () => {
      if (candidatePage > 1) { candidatePage--; fetchAndDisplayCandidates(); }
    };
    document.getElementById('btnCandNext').onclick = () => {
      if (candidatePage < totalPages) { candidatePage++; fetchAndDisplayCandidates(); }
    };
  } catch (err) {
    tableWrap.innerHTML = `<div class="ratings-error">读取失败：${esc(err.message)}</div>`;
  }
}

// 5. 批次管理视图（编辑模式可用）
function selectCandidatePlayer(name) {
  const dialog = document.getElementById('ratingsCandidatePicker');
  const input = document.getElementById('ratingsCandidateSearch');
  const list = document.getElementById('ratingsCandidateOptions');
  const selection = document.getElementById('ratingsCandidateSelection');
  const confirmButton = dialog.querySelector('[value="confirm"]');
  const controller = new AbortController();
  let selected = null;
  document.getElementById('ratingsCandidateTitle').textContent = `为「${name}」绑定棋手档案`;
  input.value = '';
  selection.textContent = '';
  confirmButton.disabled = true;
  dialog.returnValue = '';

  const suggestions = bindPlayerSuggestions(input, list, () => input.value.trim(), searchPlayerDirectory, item => {
    selected = item;
    selection.textContent = [item.label, item.detail, item.id].filter(Boolean).join(' · ');
    confirmButton.disabled = false;
    suggestions.hide();
    confirmButton.focus();
  }, controller.signal);
  input.addEventListener('input', () => {
    selected = null;
    selection.textContent = '';
    confirmButton.disabled = true;
  }, {signal: controller.signal});
  dialog.querySelector('form').addEventListener('submit', event => {
    if (event.submitter?.value !== 'cancel' && (event.submitter !== confirmButton || !selected)) event.preventDefault();
  }, {signal: controller.signal});
  return new Promise(resolve => {
    dialog.addEventListener('close', () => {
      controller.abort();
      resolve(dialog.returnValue === 'confirm' ? selected : null);
    }, {once: true});
    dialog.showModal();
  });
}

async function renderBatchesView() {
  const content = document.getElementById('ratingsContent');
  const version = viewVersion;
  content.innerHTML = '<div class="ratings-loading">正在读取导入批次…</div>';

  try {
    const data = await apiGet('/api/ratings/batches');
    if (version !== viewVersion) return;
    const batches = data.batches || [];

    if (batches.length === 0) {
      content.innerHTML = '<div class="ratings-empty">暂无导入批次记录。</div>';
      return;
    }

    const rowsHtml = batches.map(b => `
      <tr>
        <td><code>${esc(b.id)}</code></td>
        <td>${esc(b.source_file_name)}</td>
        <td>${b.entries_count} 条</td>
        <td>${b.snapshots_count} 个</td>
        <td>${esc(b.created_at ? b.created_at.slice(0, 19).replace('T', ' ') : '-')}</td>
        <td><span class="badge-undo-${esc(b.undo_status)}">${b.undo_status === 'undone' ? '已撤销' : '有效'}</span></td>
        <td>
          ${b.undo_status !== 'undone' ? `
            <button class="btn btn-sm btn-undo-batch" data-batch="${esc(b.id)}">撤销此批次</button>
          ` : `<span class="ratings-muted">-</span>`}
        </td>
      </tr>
    `).join('');

    content.innerHTML = `
      <div class="ratings-table-container">
        <table class="ratings-data-table">
          <thead>
            <tr>
              <th>批次 ID</th>
              <th>来源文件</th>
              <th>条目数</th>
              <th>快照数</th>
              <th>导入时间</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    `;

    content.querySelectorAll('.btn-undo-batch').forEach(btn => {
      btn.onclick = async () => {
        if (!(await confirmRatingsAction(`撤销批次「${btn.dataset.batch}」并停用该批次的等级分快照？`, '撤销批次', true))) return;
        try {
          await apiPost('/api/ratings/undo', { batch_id: btn.dataset.batch });
          await renderBatchesView();
          setRatingsStatus('撤销批次成功！', false);
        } catch (err) {
          setRatingsStatus('撤销失败: ' + err.message, true);
        }
      };
    });
  } catch (err) {
    content.innerHTML = `<div class="ratings-error">读取批次失败：${esc(err.message)}</div>`;
  }
}

// 打开等级分工作区（弹窗或独立全屏页）
async function open({ view = 'ranking', system = 'china', player = null } = {}) {
  const standalone = isStandalonePage();
  const dialog = document.getElementById('ratingsDialog');
  if (!standalone && !dialog) return;

  currentSystem = system;
  currentTab = view;
  setRatingsStatus('');

  renderTabs();
  if (dialog && !dialog.open) {
    dialog.showModal();
  }

  await switchTab(view, player || '');
}

function close() {
  const dialog = document.getElementById('ratingsDialog');
  if (dialog && dialog.open) {
    dialog.close();
  }
}

async function initStandaloneEditSupport(wantEdit = false) {
  if (!isStandalonePage() || window.GO_STATS_DATA_MODE === 'public') return;
  const toggleBtn = document.getElementById('ratingsEditToggle');
  if (!toggleBtn) return;

  let editToken = '';
  try {
    const resp = await fetch('/api/editor?lightweight=1', { headers: { 'Accept': 'application/json' } });
    if (!resp.ok) return;
    const meta = await resp.json();
    if (!meta || !meta.token) return;
    editToken = String(meta.token);
  } catch (_) {
    return;
  }

  if (!window.GoViewerEditor) {
    window.GoViewerEditor = {
      enabled: () => document.body.classList.contains('edit-mode'),
      metadata: () => ({ token: editToken }),
      notify: () => {}
    };
  }

  const syncEditUi = (active) => {
    document.body.classList.toggle('edit-mode', active);
    toggleBtn.classList.toggle('is-active', active);
    toggleBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
    toggleBtn.textContent = active ? '退出编辑' : '编辑模式';
  };

  toggleBtn.hidden = false;
  syncEditUi(Boolean(wantEdit));

  toggleBtn.addEventListener('click', async () => {
    const nextActive = !document.body.classList.contains('edit-mode');
    syncEditUi(nextActive);
    if (!nextActive && ['import', 'candidates', 'batches'].includes(currentTab)) {
      await switchTab('ranking');
    } else {
      renderTabs();
      syncWorkspaceUrlState();
    }
  });
}

window.GoViewerRatings = {
  open,
  close,
  openPlayer: (playerName, system = 'china') => {
    currentTrendPlayers = [playerName];
    open({ view: 'trend', system, player: playerName });
  }
};

window.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('btnRatings')?.addEventListener('click', () => {
    open({ view: 'ranking' });
  });
  document.getElementById('ratingsClose')?.addEventListener('click', close);
  document.getElementById('ratingsFooterClose')?.addEventListener('click', close);
  document.getElementById('ratingsDialog')?.addEventListener('close', () => {
    if (document.getElementById('ratingsDialog').open) return;
    viewVersion++;
    trendViewEvents?.abort();
    currentChartRenderer?.destroy();
    currentChartRenderer = null;
    currentChartData = null;
    currentComparisonRenderer = null;
  });

  const openPageLink = document.getElementById('btnRatingsOpenPage');
  if (openPageLink) {
    const refreshHref = () => syncWorkspaceUrlState();
    openPageLink.addEventListener('pointerenter', refreshHref);
    openPageLink.addEventListener('focus', refreshHref);
    openPageLink.addEventListener('click', refreshHref);
  }

  window.addEventListener('go:theme-changed', () => {
    if (currentTab === 'trend' && currentChartData) {
      renderActivePlayerChips();
      renderChartPlot();
    } else if (currentTab === 'compare' && currentComparisonRenderer) {
      currentComparisonRenderer.render?.();
    }
  });

  if (isStandalonePage()) {
    window.GoViewerTheme?.init?.({ toggleSelector: '#ratingsTheme' });
    const state = readRatingsUrlState();
    await initStandaloneEditSupport(state.edit);

    if (state.month) currentMonth = state.month;
    if (state.base || state.target || (state.cat && state.cat !== 'all')) {
      pendingCompareState = { base: state.base, target: state.target, cat: state.cat || 'all' };
    }
    if (state.players.length > 0) {
      currentTrendPlayers = state.players;
    }
    if (state.mode) {
      currentChartMode = state.mode;
    }
    if (state.align) {
      goratingsDiffAlign = state.align;
    }
    currentViewType = state.view;
    compareViewMode = state.cview;

    const validTabs = ['ranking', 'compare', 'trend', 'import', 'candidates', 'batches'];
    const isEdit = Boolean(document.body.classList.contains('edit-mode') || window.GoViewerEditor?.enabled?.());
    let initialTab = validTabs.includes(state.tab) ? state.tab : 'ranking';
    if (!isEdit && ['import', 'candidates', 'batches'].includes(initialTab)) {
      initialTab = 'ranking';
    }

    await open({
      view: initialTab,
      system: state.system || 'china'
    });
  }
});

})();
