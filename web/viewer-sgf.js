/* SGF tab: on-demand loading, import preview, archive actions and board browsing. */
(function () {
  const M = window.GoViewerModel, E = M.escape;
  const engine = window.GoSgfEngine;
  const dialog = document.getElementById('matchDialog');
  const body = document.getElementById('matchDialogBody');
  const panel = document.getElementById('sgfPanel');
  const tabInfo = document.getElementById('matchTabInfo');
  const tabSgf = document.getElementById('matchTabSgf');
  const editor = () => window.GoViewerEditor;
  // 公开模式同样通过 HTTP 提供棋谱（只读）；file:// 打开时仍给出本地服务指引。
  const local = () => ['http:', 'https:'].includes(location.protocol);
  let games = [], matchId = null, data = null, navigator = null, nodeId = null, seq = 0;
  // loadedFor 记录当前面板内容对应的对局；同一对局、同一棋盘版本内切换页签不再重新载入。
  let loadedFor = null;
  let preview = null, pendingFile = null, previewEncoding = '', showNumbers = false;
  let message = '', importing = false, showUnlink = false, versionId = null;
  let staleNotice = '';
const find = window.GoViewerSgfFind;
  let numberMode = 'none'; // 'none' | 'last1' | 'last5' | 'last10' | 'all'
  let showLastMarker = true;
  let focusMode = false, focusCommentsOpen = true, previousFocusElement = null;
  let isPlaying = false, playTimer = null, playSpeed = 1000;
  let mainlineFollowConfirmed = false;
  let trialSession = null, trialHoverPoint = null;
  const BOARD_THEME_KEY = 'go_sgf_board_theme_v1';
  const boardThemes = new Set(['auto', 'kaya', 'minimal', 'slate']);
  const boardGridCache = new Map();
  let boardTheme = 'auto';
  try { boardTheme = localStorage.getItem(BOARD_THEME_KEY) || 'auto'; } catch (_) {}
  if (!boardThemes.has(boardTheme)) boardTheme = 'auto';
  const svgIcon = name => {
    const paths = {
      trial: '<path d="M9 3h6m-5 0v7l-5.7 8.5A1.6 1.6 0 0 0 5.6 21h12.8a1.6 1.6 0 0 0 1.3-2.5L14 10V3M8 15h8"/>',
      find: '<circle cx="11" cy="11" r="7"/><path d="M11 7v8m-4-4h8m1.5 5.5L21 21"/>',
      focus: '<path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"/>',
      download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M4 20h16"/>',
      start: '<path d="M5 5v14m13-14L9 12l9 7z"/>',
      end: '<path d="M19 5v14M6 5l9 7-9 7z"/>',
      prev: '<path d="m16 5-9 7 9 7z"/>',
      next: '<path d="m8 5 9 7-9 7z"/>',
      fastPrev: '<path d="m12 5-8 7 8 7zm8 0-8 7 8 7z"/>',
      fastNext: '<path d="m4 5 8 7-8 7zm8 0 8 7-8 7z"/>',
      play: '<path d="m8 5 11 7-11 7z"/>',
      pause: '<path d="M7 5h3v14H7zm7 0h3v14h-3z"/>',
      undo: '<path d="M9 8 4 12l5 4M4 12h10a6 6 0 0 1 0 12"/>',
      redo: '<path d="m15 8 5 4-5 4m5-4H10a6 6 0 0 0 0 12"/>',
      reset: '<path d="M4 12a8 8 0 1 1 2.3 5.7M4 17v-5h5"/>',
      pass: '<circle cx="12" cy="12" r="8"/><path d="M8 12h8"/>',
      branch: '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="18" r="2"/><circle cx="6" cy="18" r="2"/><path d="M6 7v9m0-4c7 0 12 0 12 4"/>',
    };
    return `<svg class="sgf-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ''}</svg>`;
  };
  function resolvedBoardTheme() {
    return boardTheme === 'auto' ? (document.body.dataset.theme === 'dark' ? 'slate' : 'kaya') : boardTheme;
  }
  function applyBoardTheme() {
    const board = panel.querySelector('#sgfBoard');
    if (board) board.dataset.boardTheme = resolvedBoardTheme();
  }
  new MutationObserver(applyBoardTheme).observe(document.body, {attributes: true, attributeFilter: ['data-theme']});
  // 命令菜单“进入研究”先打开对局，再等棋谱按需载入完成后进入试下研究。
  let pendingStudy = false;
  // 按落点查找：只列出当前路径上发生在该交叉点的着手，不改变局面、不自动落子。
  
  function token() { return editor()?.metadata()?.token || ''; }
  function canEdit() { return !!editor()?.enabled(); }
  async function api(path, body) {
    const options = body === undefined ? {cache: 'no-store'} : {
      method: 'POST', cache: 'no-store',
      headers: {'Content-Type': 'application/json', 'X-Editor-Token': token()},
      body: JSON.stringify(body),
    };
    options.headers = {...(options.headers || {}), 'X-Viewer-Compact': 'players-v1'};
    let response;
    try { response = await fetch(path, options); }
    catch (_) { throw new Error(local() ? '本地服务连接失败，请确认 start_viewer.bat 仍在运行。' : '需要本地服务：请通过 start_viewer.bat 打开页面。'); }
    let payload = null;
    try { payload = await response.json(); } catch (_) { throw new Error('棋谱服务返回了无法识别的结果。'); }
    if (!response.ok) {
      const error = new Error(payload.error || '棋谱操作失败。'); error.status = response.status; error.data = payload; throw error;
    }
    return payload;
  }
  function setMessage(text, kind = '') {
    message = text;
    const element = panel.querySelector('#sgfMessage');
    if (element) { element.textContent = text; element.className = 'sgf-message ' + kind; }
  }
  function playerName(g, side) {
    const p = side === 'B' ? (g.black_player || g.participant_1) : (g.white_player || g.participant_2);
    return p?.name_zh || g[side === 'B' ? 'black_player_id' : 'white_player_id'] || '待定';
  }
  function matchPlayerDisplay(g, data) {
    const meta = data?.sgf?.meta || {};
    const match = data?.match || {};
    const dbColorKnown = !!(match.color_known || g?.black_player_id);
    const dbBlack = match.black || g?.black_player?.name_zh || (g?.black_player_id ? g.black_player_id : null);
    const dbWhite = match.white || g?.white_player?.name_zh || (g?.white_player_id ? g.white_player_id : null);
    const sgfBlack = meta.black_name || '';
    const sgfWhite = meta.white_name || '';

    if (dbColorKnown && dbBlack && dbWhite) {
      return {
        mode: 'known',
        black: { name: dbBlack, source: 'db' },
        white: { name: dbWhite, source: 'db' },
      };
    }
    if (sgfBlack && sgfWhite) {
      return {
        mode: 'sgf_color',
        black: { name: sgfBlack, source: 'sgf' },
        white: { name: sgfWhite, source: 'sgf' },
      };
    }
    const [p1, p2] = g ? M.participants(g) : [{name_zh: match.black || '待定'}, {name_zh: match.white || '待定'}];
    return {
      mode: 'unknown',
      p1: p1?.name_zh || '待定',
      p2: p2?.name_zh || '待定'
    };
  }
  function gameLabel(g, index) {
    const [a, b] = M.participants(g);
    return `第${index + 1}局 · ${M.dateLabel(g.date)} · ${a?.name_zh || '待定'} / ${b?.name_zh || '待定'}`;
  }
  function activeGame() { return games.find(g => g.id === matchId) || null; }

  function syncTabClass(active) {
    dialog.classList.toggle('sgf-tab-active', !!active);
  }

  function reset() {
    stopAutoplay();
    if (navigator) navigator.clearBranchSelections();
    if (focusMode) exitFocusMode();
    focusCommentsOpen = true;
    dialog.classList.remove('sgf-comments-collapsed');
    seq++; games = []; matchId = null; data = null; navigator = null; nodeId = null; loadedFor = null;
    GoViewerSgfFind.reset();
    preview = null; pendingFile = null; previewEncoding = ''; showUnlink = false; message = ''; mainlineFollowConfirmed = false; versionId = null; staleNotice = '';
    pendingStudy = false;
    panel.replaceChildren(); panel.hidden = true; body.hidden = false;
    tabInfo?.classList.add('active'); tabSgf?.classList.remove('active');
    tabInfo?.setAttribute('aria-selected', 'true'); tabSgf?.setAttribute('aria-selected', 'false');
    syncTabClass(false);
  }

  function updateMatchDialog(nextGames) {
    stopAutoplay();
    if (navigator) navigator.clearBranchSelections();
    if (focusMode) exitFocusMode();
    focusCommentsOpen = true;
    dialog.classList.remove('sgf-comments-collapsed');
    seq++;
    games = Array.isArray(nextGames) ? nextGames : [];
    matchId = games[0]?.id || null;
    data = null; navigator = null; nodeId = null; loadedFor = null; preview = null; pendingFile = null;
    GoViewerSgfFind.reset();
    previewEncoding = ''; showUnlink = false; message = ''; versionId = null; staleNotice = '';
    pendingStudy = false;
    panel.replaceChildren(); panel.hidden = true; body.hidden = false;
    tabInfo?.classList.add('active'); tabSgf?.classList.remove('active');
    tabInfo?.setAttribute('aria-selected', 'true'); tabSgf?.setAttribute('aria-selected', 'false');
    syncTabClass(false);
    if (tabSgf) {
      const has = games.some(g => g.sgf?.present);
      tabSgf.textContent = has ? '棋谱 · 已关联' : '棋谱';
    }
  }

  function selectTab(name) {
    const sgf = name === 'sgf';
    if (!sgf) {
      // 返回资料页签只切换显示：棋谱面板 DOM、当前节点与试下状态都保留，不重新载入。
      stopAutoplay();
      seq++;
    }
    tabInfo?.classList.toggle('active', !sgf); tabSgf?.classList.toggle('active', sgf);
    tabInfo?.setAttribute('aria-selected', String(!sgf)); tabSgf?.setAttribute('aria-selected', String(sgf));
    syncTabClass(sgf);
    body.hidden = sgf; panel.hidden = !sgf;
    dialog.dispatchEvent(new CustomEvent('go:match-tab', {detail: sgf ? 'sgf' : null}));
    if (!sgf) return;

    if (!matchId) matchId = games[0]?.id || null;
    if (!matchId) {
      panel.innerHTML = `<div class="sgf-empty"><p>请选择一盘对局。</p></div>`;
      return;
    }

    const summary = games.find(g => g.id === matchId);
    const summaryVersion = summary?.sgf?.present ? summary.sgf.id : null;
    const knownVersion = data?.current_version_id || null;
    const versionChanged = !!(data && loadedFor === matchId && summaryVersion && knownVersion &&
      String(summaryVersion) !== String(knownVersion));
    const sgfRemoved = !!(data && loadedFor === matchId && summary && !summary.sgf?.present && data.sgf);
    const needsLoad = !data || loadedFor !== matchId || versionChanged || sgfRemoved;

    if (needsLoad) {
      load(matchId, null, versionChanged ? '棋谱版本已变化，已重新载入当前版本。' : staleNotice);
      return;
    }
    setMessage('');
    maybeEnterPendingStudy();
  }

  function maybeEnterPendingStudy() {
    if (!pendingStudy) return;
    if (!data || loadedFor !== matchId) return;
    pendingStudy = false;
    if (data.sgf) enterTrialMode();
    else setMessage('这盘对局没有可研究的棋谱。', 'error');
  }

  function openStudy(id) {
    if (!id) return;
    if (trialSession) {
      setMessage('已在试下研究模式中；请先退出研究再切换棋谱。', 'info');
      return;
    }
    pendingStudy = true;
    matchId = id;
    selectTab('sgf');
  }

  function updateTabLabel() {
    if (!tabSgf) return;
    const has = games.some(g => g.sgf?.present);
    tabSgf.textContent = has ? '棋谱 · 已关联' : '棋谱';
  }

  /*
   * 保存后刷新页面数据时，用最新的对局摘要更新本地列表，但保留已载入的棋谱面板。
   * 只有棋盘版本真的变化（或关联被解除）时才作废缓存，并在下次进入页签时重新载入。
   */
  function syncGames(nextGames) {
    games = Array.isArray(nextGames) ? nextGames : [];
    updateTabLabel();
    if (!matchId) matchId = games[0]?.id || null;
    if (!data || !matchId) return;
    const summary = games.find(g => g.id === matchId);
    const summaryVersion = summary?.sgf?.present ? summary.sgf.id : null;
    const knownVersion = data.current_version_id || null;
    const changed = (summaryVersion && knownVersion && String(summaryVersion) !== String(knownVersion)) ||
      (!summaryVersion && !!data.sgf);
    if (!changed) return;
    loadedFor = null;
    staleNotice = '棋谱版本已变化，已重新载入当前版本。';
    if (!panel.hidden) load(matchId, null, staleNotice);
  }

  function skeleton() {
    panel.innerHTML = `<div class="sgf-empty"><p>加载中…</p></div>`;
  }

  async function load(id, version = null, notice = '') {
    if (!id) { panel.innerHTML = `<div class="sgf-empty"><p>请选择一盘对局。</p></div>`; return; }
    const studyAfterLoad = pendingStudy;
    pendingStudy = false;
    if (trialSession && trialSession.hasTrialMoves()) {
      if (!confirm('当前试下尚未保存，切换棋谱将清空，是否继续？')) {
        return;
      }
    }
    trialSession = null;
    trialHoverPoint = null;
    matchId = id; versionId = version || null;
    loadedFor = null;
    GoViewerSgfFind.reset();
    staleNotice = '';
    preview = null; pendingFile = null; previewEncoding = ''; showUnlink = false; message = notice;
    if (!local()) {
      panel.innerHTML = `<div class="sgf-empty"><strong>棋谱需要通过本地服务打开</strong>
        <p>直接打开 HTML 文件时无法加载 SGF 棋谱，请通过 <strong>start_viewer.bat</strong> 启动本地服务后查看。</p></div>`;
      return;
    }
    const request = ++seq; skeleton();
    try {
      const result = await api(version
        ? `/api/sgf/version/${encodeURIComponent(id)}/${encodeURIComponent(version)}`
        : `/api/sgf/match/${encodeURIComponent(id)}`);
      if (request !== seq) return;
      data = result; nodeId = result.sgf?.tree?.root || null;
      if (result.sgf?.tree) navigator = new engine.Navigator(result.sgf.board_size, result.sgf.tree, result.sgf.meta?.handicap);
      loadedFor = id;
      renderShell();
      if (studyAfterLoad) {
        if (data?.sgf) enterTrialMode();
        else setMessage('这盘对局没有可研究的棋谱。', 'error');
      }
    } catch (error) {
      if (request !== seq) return;
      panel.innerHTML = `<div class="sgf-empty sgf-error"><strong>棋谱加载失败</strong><p>${E(error.message)}</p>
        <button class="btn" type="button" data-sgf-retry>重试</button></div>`;
    }
  }

  function gameSelector() {
    if (games.length <= 1) return '';
    return `<label class="sgf-game-select"><span>本场对局</span><select id="sgfGameSelect">${games.map((g, index) =>
      `<option value="${E(g.id)}" ${g.id === matchId ? 'selected' : ''}>${E(gameLabel(g, index))}${g.sgf?.present ? ' · 有棋谱' : ''}</option>`).join('')}</select></label>`;
  }

  function versionSelector() {
    const versions = data?.versions || [];
    if (versions.length <= 1) return '';
    return `<label class="sgf-version-select"><span>浏览版本</span><select id="sgfVersionSelect">${versions.map((item, index) =>
      `<option value="${E(item.id)}" ${item.id === (versionId || data.browsing_version_id || data.current_version_id) ? 'selected' : ''}>${E(`版本${index + 1} · ${item.filename} · ${item.main_line_moves}手${item.is_current ? ' · 当前' : ''}`)}</option>`).join('')}</select></label>`;
  }

  function header() {
    const sgf = data?.sgf;
    const current = (data?.versions || []).find(item => item.id === data?.current_version_id);
    const historical = !!(sgf && data?.current_version_id && !sgf.is_current);
    const editable = canEdit() && data?.can_write && !historical;
    const filename = sgf?.filename || (data?.protected?.locked ? '受保护棋局' : (editable ? '可导入 SGF' : '未导入棋谱'));
    const match = data?.match || {};
    const g = activeGame();

    const tournamentName = match.tournament || g?.tournament_name || '';
    const edNum = match.edition_number || g?.edition_number;
    const roundName = match.round_name || g?.round_name || '';
    const matchNum = match.match_number || g?.match_number;
    const eyebrowParts = [];
    if (tournamentName) eyebrowParts.push(tournamentName);
    if (edNum) eyebrowParts.push(`第${edNum}届`);
    if (roundName) eyebrowParts.push(roundName);
    if (matchNum && games.length > 1) eyebrowParts.push(`第${matchNum}局`);
    const eyebrow = eyebrowParts.join(' · ') || match.label || '围棋对局';

    const players = matchPlayerDisplay(g, data);
    const resultColor = /^B\+/.test(sgf?.meta?.result || '') ? 'B' : /^W\+/.test(sgf?.meta?.result || '') ? 'W' : '';
    const winnerColor = g?.winner_id && g.winner_id === g.black_player_id ? 'B'
      : g?.winner_id && g.winner_id === g.white_player_id ? 'W' : (g ? '' : resultColor);
    let titleHtml = '';
    if (players.mode === 'known') {
      titleHtml = `<span class="sgf-player${winnerColor === 'B' ? ' winner' : ''}"><span class="sgf-stone-dot black" aria-hidden="true"></span>黑：${E(players.black.name)}${winnerColor === 'B' ? '<small class="sgf-winner-mark">胜</small>' : ''}</span>
        <span class="sgf-vs">VS</span>
        <span class="sgf-player${winnerColor === 'W' ? ' winner' : ''}"><span class="sgf-stone-dot white" aria-hidden="true"></span>白：${E(players.white.name)}${winnerColor === 'W' ? '<small class="sgf-winner-mark">胜</small>' : ''}</span>`;
    } else if (players.mode === 'sgf_color') {
      titleHtml = `<span class="sgf-player${winnerColor === 'B' ? ' winner' : ''}"><span class="sgf-stone-dot black" aria-hidden="true"></span>黑：${E(players.black.name)}<small class="sgf-source-badge">（来自棋谱）</small>${winnerColor === 'B' ? '<small class="sgf-winner-mark">胜</small>' : ''}</span>
        <span class="sgf-vs">VS</span>
        <span class="sgf-player${winnerColor === 'W' ? ' winner' : ''}"><span class="sgf-stone-dot white" aria-hidden="true"></span>白：${E(players.white.name)}<small class="sgf-source-badge">（来自棋谱）</small>${winnerColor === 'W' ? '<small class="sgf-winner-mark">胜</small>' : ''}</span>`;
    } else {
      titleHtml = `<span class="sgf-player">参赛者：${E(players.p1)} VS ${E(players.p2)}<small class="sgf-source-badge">（执色未知）</small></span>`;
    }

    const dateVal = g?.date || match.date || sgf?.meta?.date || '';
    const dateStr = dateVal ? M.dateLabel(dateVal) : '—';
    let resultStr = '—';
    if (g && M.hasResult(g)) {
      resultStr = M.matchResult(g);
    } else if (match.result_detail || match.result_type) {
      resultStr = match.result_detail || match.result_type;
    } else if (sgf?.meta?.result) {
      resultStr = `${sgf.meta.result}（棋谱）`;
    }

    const mismatches = data?.comparison?.mismatches || [];
    let diffAlert = '';
    if (mismatches.length > 0) {
      const summary = mismatches.map(m => m.message).join('；');
      diffAlert = `<div class="sgf-diff-alert" role="alert">
        <span title="${E(summary)}">元数据差异：${E(summary)}</span>
        <button type="button" class="sgf-diff-link" data-sgf-open-details>查看对照</button>
      </div>`;
    }

    return `<div class="sgf-head">
      <div class="sgf-head-main" data-filename="${E(filename)}">
        <div class="sgf-event-eyebrow">${E(eyebrow)}</div>
        <strong class="sgf-match-title" role="heading" aria-level="2">${titleHtml}</strong>
        <div class="sgf-match-meta">
          <span>比赛日期：${E(dateStr)}</span>
          <span>赛果：<strong>${E(resultStr)}</strong></span>
        </div>
        ${diffAlert}
      </div>
      <div class="sgf-head-actions">
        ${gameSelector()}
        ${versionSelector()}
        ${sgf && !trialSession ? `<button id="sgfBtnTrial" class="btn btn-trial" type="button" data-sgf-trial title="以当前局面进入试下研究">${svgIcon('trial')}试下研究</button>` : ''}
        ${sgf && trialSession ? `<button id="sgfBtnExitTrialHead" class="btn sgf-trial-btn-exit" type="button" data-sgf-trial-exit title="退出试下研究并返回原谱">返回原谱</button>` : ''}
        ${sgf ? `<button id="sgfBtnFind" class="btn${GoViewerSgfFind.isActive() ? ' active' : ''}" type="button" data-sgf-find aria-pressed="${GoViewerSgfFind.isActive()}" title="点击棋盘交叉点查找该位置的着手">${svgIcon('find')}查找着手</button>` : ''}
        ${sgf ? `<button id="sgfBtnToggleSidebar" class="btn${focusCommentsOpen ? ' active' : ''}" type="button" data-sgf-toggle-sidebar aria-expanded="${focusCommentsOpen}" aria-controls="sgfInfoPanel" title="展开或收起右侧解说与变化栏">${focusCommentsOpen ? '收起侧栏' : '展开侧栏'}</button>` : ''}
        ${sgf ? `<button id="sgfBtnFocus" class="btn btn-focus" type="button" data-sgf-focus title="全屏浏览棋谱（Esc 退出）">${svgIcon('focus')}专注看谱</button>` : ''}
        ${data.protected?.locked ? '<span class="sgf-readonly">用户指定保留 · 棋谱只读</span>' : ''}
        ${!trialSession && sgf && editable ? `<button class="btn" type="button" data-sgf-replace>替换棋谱</button><button class="btn btn-danger" type="button" data-sgf-unlink>解除关联</button>` : ''}
        ${!sgf && editable ? `<button class="btn btn-gold" type="button" data-sgf-import>导入 SGF</button>` : ''}
        <input id="sgfFileInput" type="file" accept=".sgf,application/x-go-sgf" hidden>
      </div>
    </div>${historical ? `<p class="sgf-version-note">正在浏览历史来源版本；本局当前关联为“${E(current?.filename || '未知版本')}”。</p>` : ''}`;
  }

  function techDetailsHtml() {
    const sgf = data.sgf;
    if (!sgf) return '';
    const meta = sgf.meta || {};
    const encoding = sgf.encoding || {};
    const warningCount = (sgf.warnings || []).length;
    const comparison = data.comparison;
    const warnings = sgf.warnings || [];
    const unsupported = sgf.unsupported_properties || [];

    return `<details class="sgf-tech-details" id="sgfTechDetails">
      <summary><span>棋谱详情</span></summary>
      <div class="sgf-tech-body">
        <div class="sgf-tech-group">
          <h5>棋局规则与设置</h5>
          <dl class="sgf-meta-grid">
            <div><dt>棋盘路数</dt><dd>${E(sgf.board_size)} 路</dd></div>
            <div><dt>主线手数</dt><dd>${E(sgf.stats?.main_line_moves || 0)} 手</dd></div>
            <div><dt>比赛规则</dt><dd>${E(meta.rules || '—')}</dd></div>
            <div><dt>贴目</dt><dd>${E(meta.komi ?? '—')}</dd></div>
            <div><dt>让子</dt><dd>${E(meta.handicap ?? '—')}</dd></div>
            <div><dt>棋谱日期</dt><dd>${E(meta.date || '—')}</dd></div>
            <div><dt>棋谱赛果</dt><dd>${E(meta.result || '—')}</dd></div>
          </dl>
        </div>

        <div class="sgf-tech-group">
          <h5>文件与解析信息</h5>
          <dl class="sgf-meta-grid">
            <div><dt>原始文件名</dt><dd>${E(sgf.filename || '—')}</dd></div>
            <div><dt>文件大小</dt><dd>${E(sgf.byte_size || 0)} 字节</dd></div>
            <div><dt>编码及判定</dt><dd>${E(encoding.value || '—')}（${E(encoding.source || '—')}）</dd></div>
            <div><dt>节点与分支</dt><dd>总节点 ${E(sgf.stats?.nodes || 0)} · 分支 ${E(sgf.stats?.branches || 0)}</dd></div>
            <div><dt>棋局指纹</dt><dd>${E((sgf.game_fingerprint_sha256 || '').slice(0, 16) || '未生成')}</dd></div>
            <div><dt>解析器</dt><dd>${E(sgf.parser?.name || '')} ${E(sgf.parser?.version || '')}</dd></div>
            <div><dt>解析状态</dt><dd>${E(sgf.parse_status === 'ok' ? '解析正常' : '有警告')}${warningCount ? ` · ${warningCount} 条` : ''}</dd></div>
          </dl>
        </div>

        ${data.sgf.note || data.sgf.source_note || data.previous ? `
        <div class="sgf-tech-group">
          <h5>来源与关联说明</h5>
          ${data.sgf.note ? `<p class="sgf-footnote">关联说明：${E(data.sgf.note)}</p>` : ''}
          ${data.sgf.source_note ? `<p class="sgf-footnote">导入说明：${E(data.sgf.source_note)}</p>` : ''}
          ${data.previous ? `<p class="sgf-footnote">当前没有关联；上一份“${E(data.previous.filename || '')}”仍保留，可在修改历史中撤销解除。</p>` : ''}
        </div>` : ''}

        ${comparison && comparison.comparisons?.length ? `
        <div class="sgf-tech-group">
          <h5>SGF 与数据库资料对照</h5>
          <div class="sgf-compare" role="table" aria-label="SGF与数据库资料比较">
            ${comparison.comparisons.map(item => `
              <div class="sgf-compare-row ${item.status}" role="row">
                <span>${E(item.label)}</span>
                <span>SGF：${E(item.sgf)}</span>
                <span>数据库：${E(item.database)}</span>
                <strong>${E(statusLabel(item.status))}</strong>
              </div>`).join('')}
          </div>
          ${comparison.mismatches?.length ? `
            <div class="sgf-mismatch">
              <strong>差异说明</strong>
              <ul>${comparison.mismatches.map(item => `<li>${E(item.message)}</li>`).join('')}</ul>
              <p>不会自动覆盖数据库资料或原始 SGF。</p>
            </div>` : '<p class="sgf-ok">未发现姓名、日期或赛果的明确不一致。</p>'}
        </div>` : ''}

        ${warnings.length || unsupported.length ? `
        <div class="sgf-tech-group">
          <h5>解析提示</h5>
          <ul class="sgf-warnings">${warnings.map(item => `
            <li class="sgf-warning-${E(item.severity || 'warning')}">
              <span>${E(item.severity === 'error' ? '需注意' : item.severity === 'info' ? '说明' : '警告')}</span>${E(item.message)}
            </li>`).join('')}</ul>
          ${unsupported.length ? `<p class="sgf-footnote">暂未渲染的标记：${E(unsupported.join('、'))}。原文仍完整保留。</p>` : ''}
        </div>` : ''}
      </div>
    </details>`;
  }

  function emptyHtml() {
    const blocked = data?.protected?.locked;
    const editable = canEdit() && data?.can_write;
    return `<div class="sgf-empty">
      <strong>暂无棋谱</strong>
      ${blocked ? `<p class="sgf-protected">本局受保护，仅支持只读查看。</p>` : editable
        ? `<p>选择 SGF 文件后可预览并导入。</p><button class="btn btn-gold" type="button" data-sgf-import>选择本地 SGF 文件</button>`
        : `<p>开启编辑模式后可导入 SGF。</p>`}
      ${data?.previous ? `<p class="sgf-footnote">上一份“${E(data.previous.filename || '')}”仍保留，可在修改历史中撤销。</p>` : ''}
    </div>`;
  }


  function isNumberVisible(num, currentMove, mode) {
    if (!num || num <= 0) return false;
    if (num > currentMove) return false;
    if (mode === 'none') return false;
    if (mode === 'last1') return num === currentMove;
    if (mode === 'last5') return num >= currentMove - 4 && num <= currentMove;
    if (mode === 'last10') return num >= currentMove - 9 && num <= currentMove;
    if (mode === 'all') return true;
    return false;
  }

  function enterFocusMode() {
    if (focusMode) return;
    previousFocusElement = document.activeElement;
    focusMode = true;
    dialog.classList.add('sgf-in-focus');
    if (!focusCommentsOpen) dialog.classList.add('sgf-comments-collapsed');
    renderPosition();
    const exitBtn = panel.querySelector('[data-sgf-focus-exit]');
    exitBtn?.focus();
  }

  function exitFocusMode() {
    if (!focusMode) return;
    focusMode = false;
    focusCommentsOpen = true;
    dialog.classList.remove('sgf-in-focus');
    dialog.classList.remove('sgf-comments-collapsed');
    const sideBtn = panel.querySelector('[data-sgf-toggle-sidebar]');
    if (sideBtn) {
      sideBtn.classList.add('active');
      sideBtn.setAttribute('aria-expanded', 'true');
      sideBtn.textContent = '收起侧栏';
    }
    renderPosition();
    if (previousFocusElement && typeof previousFocusElement.focus === 'function') {
      previousFocusElement.focus();
    } else {
      panel.querySelector('[data-sgf-focus]')?.focus();
    }
  }

  function toggleFocusComments() {
    focusCommentsOpen = !focusCommentsOpen;
    dialog.classList.toggle('sgf-comments-collapsed', !focusCommentsOpen);
    const btn = panel.querySelector('[data-sgf-toggle-comments]');
    if (btn) {
      btn.classList.toggle('active', focusCommentsOpen);
      btn.setAttribute('aria-expanded', String(focusCommentsOpen));
    }
    const sideBtn = panel.querySelector('[data-sgf-toggle-sidebar]');
    if (sideBtn) {
      sideBtn.classList.toggle('active', focusCommentsOpen);
      sideBtn.setAttribute('aria-expanded', String(focusCommentsOpen));
      sideBtn.textContent = focusCommentsOpen ? '收起侧栏' : '展开侧栏';
    }
    renderPosition();
  }

  function focusBarHtml() {
    if (!data?.sgf) return '';
    const match = data?.match || {};
    const g = activeGame();
    const tournamentName = match.tournament || g?.tournament_name || '';
    const edNum = match.edition_number || g?.edition_number;
    const roundName = match.round_name || g?.round_name || '';
    const matchNum = match.match_number || g?.match_number;
    const eyebrowParts = [];
    if (tournamentName) eyebrowParts.push(tournamentName);
    if (edNum) eyebrowParts.push(`第${edNum}届`);
    if (roundName) eyebrowParts.push(roundName);
    if (matchNum && games.length > 1) eyebrowParts.push(`第${matchNum}局`);
    const eyebrow = eyebrowParts.join(' · ') || match.label || '围棋对局';

    const players = matchPlayerDisplay(g, data);
    let titleHtml = '';
    if (players.mode === 'known') {
      titleHtml = `<span class="sgf-player"><span class="sgf-stone-dot black" aria-hidden="true"></span>黑：${E(players.black.name)}</span>
        <span class="sgf-vs">VS</span>
        <span class="sgf-player"><span class="sgf-stone-dot white" aria-hidden="true"></span>白：${E(players.white.name)}</span>`;
    } else if (players.mode === 'sgf_color') {
      titleHtml = `<span class="sgf-player"><span class="sgf-stone-dot black" aria-hidden="true"></span>黑：${E(players.black.name)}<small class="sgf-source-badge">（来自棋谱）</small></span>
        <span class="sgf-vs">VS</span>
        <span class="sgf-player"><span class="sgf-stone-dot white" aria-hidden="true"></span>白：${E(players.white.name)}<small class="sgf-source-badge">（来自棋谱）</small></span>`;
    } else {
      titleHtml = `<span class="sgf-player">${E(players.p1)} VS ${E(players.p2)}</span>`;
    }

    const dateVal = g?.date || match.date || data.sgf?.meta?.date || '';
    const dateStr = dateVal ? M.dateLabel(dateVal) : '';
    let resultStr = '';
    if (g && M.hasResult(g)) {
      resultStr = M.matchResult(g);
    } else if (match.result_detail || match.result_type) {
      resultStr = match.result_detail || match.result_type;
    } else if (data.sgf?.meta?.result) {
      resultStr = data.sgf.meta.result;
    }

    return `<div class="sgf-focus-bar" id="sgfFocusBar">
      <div class="sgf-focus-title">
        <span class="sgf-focus-eyebrow">${E(eyebrow)}</span>
        <span class="sgf-focus-match">${titleHtml}</span>
        ${dateStr || resultStr ? `<span class="sgf-focus-meta">${E([dateStr, resultStr].filter(Boolean).join(' · '))}</span>` : ''}
      </div>
      <div class="sgf-focus-actions">
        ${data.sgf && !trialSession ? `<button id="sgfFocusBtnTrial" class="btn btn-trial" type="button" data-sgf-trial title="以当前局面进入试下研究">试下研究</button>` : ''}
        ${data.sgf && trialSession ? `<button id="sgfFocusBtnExitTrial" class="btn sgf-trial-btn-exit" type="button" data-sgf-trial-exit title="退出试下研究并返回原谱">返回原谱</button>` : ''}
        <button id="sgfFocusCommentsToggle" class="btn ${focusCommentsOpen ? 'active' : ''}" type="button" data-sgf-toggle-comments aria-expanded="${focusCommentsOpen}" aria-controls="sgfInfoPanel" title="展开或收起解说与变化">解说与变化<span class="sgf-badge" id="sgfBranchBadge" hidden></span></button>
        <button class="btn" type="button" data-sgf-open-details title="展开棋谱详情">棋谱详情</button>
        <button id="sgfBtnExitFocus" class="btn btn-focus-exit" type="button" data-sgf-focus-exit title="退出专注模式（Esc）">退出专注</button>
      </div>
    </div>`;
  }

  function updateAutoplayUi() {
    const btn = panel.querySelector('#sgfBtnAutoplay');
    if (btn) {
      btn.innerHTML = `${svgIcon(isPlaying ? 'pause' : 'play')}<span>${isPlaying ? '暂停' : '播放'}</span>`;
      btn.classList.toggle('btn-pause', isPlaying);
      btn.setAttribute('aria-label', isPlaying ? '暂停自动播放' : '开始自动播放');
    }
  }

  function startAutoplay() {
    if (!navigator || !data?.sgf) return;
    if (isPlaying) return;
    const nextId = navigator.next(nodeId);
    if (!nextId) {
      setMessage('已在当前路径末手。');
      return;
    }
    isPlaying = true;
    updateAutoplayUi();
    scheduleNextStep();
  }

  function stopAutoplay(reason) {
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }
    if (isPlaying) {
      isPlaying = false;
      updateAutoplayUi();
    }
    if (reason) setMessage(reason);
  }

  function toggleAutoplay() {
    if (isPlaying) stopAutoplay();
    else startAutoplay();
  }

  function scheduleNextStep() {
    if (!isPlaying) return;
    if (playTimer) clearTimeout(playTimer);
    playTimer = setTimeout(stepAutoplay, playSpeed);
  }

  function stepAutoplay() {
    if (!isPlaying || !navigator || !data?.sgf) return;
    playTimer = null;

    // Check if current node is a fork that has not been explicitly chosen
    const choices = navigator.branchChoices(nodeId);
    const isMainlineNode = Boolean(data.sgf.tree.nodes[nodeId]?.mainline);
    const isFork = choices.length > 1;
    const isUnchosenFork = isFork && !navigator.hasSelectedBranch(nodeId) && !(isMainlineNode && mainlineFollowConfirmed);
    if (isUnchosenFork) {
      stopAutoplay('遇到分支，请选择实战主线或变化后继续播放。');
      const branchEl = panel.querySelector('#sgfBranches');
      branchEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }

    const nextId = navigator.next(nodeId);
    if (!nextId) {
      stopAutoplay('已播放到当前变化末尾。');
      return;
    }

    const nextNode = data.sgf.tree.nodes[nextId];
    if (!nextNode || nextNode.position_error || nextNode.blocked) {
      stopAutoplay(`停止在无法重建的节点：${nextNode?.position_error || '节点受阻'}`);
      return;
    }

    const candidateState = navigator.stateAt(nextId);
    if (candidateState.error) {
      stopAutoplay(`停止在错误前缀：${candidateState.error}`);
      return;
    }

    nodeId = nextId;
    renderPosition({ isAutoplay: true });

    // Check if new node is at the end
    if (!navigator.next(nodeId)) {
      stopAutoplay('已播放到当前变化末尾。');
      return;
    }

    scheduleNextStep();
  }

  function selectBranchAndAdvance(childId) {
    if (!navigator || !data?.sgf) return;
    stopAutoplay();
    navigator.selectBranch(nodeId, childId);
    nodeId = childId;
    if (data?.sgf?.tree?.nodes[childId]?.mainline) {
      mainlineFollowConfirmed = true;
    } else {
      mainlineFollowConfirmed = false;
    }
    setMessage('');
    renderPosition();
  }

  function trialBannerHtml() {
    if (!trialSession) return '';
    const st = trialSession.currentState;
    const originDesc = trialSession.originPathDesc;
    const moveCount = trialSession.trialMoveCount;
    const toMoveName = st.toMove === 'B' ? '黑先' : '白先';
    const caps = `提子：黑 ${st.captures.B} / 白 ${st.captures.W}`;

    return `<div class="sgf-trial-banner" role="region" aria-label="试下研究模式状态">
      <div class="sgf-trial-title-wrap">
        <span class="sgf-trial-badge">${svgIcon('trial')}试下研究</span>
        <span class="sgf-trial-meta">起点：${E(originDesc)} · 当前试下 <strong>${moveCount}</strong> 手 · 下一手：<strong>${toMoveName}</strong> · ${E(caps)}</span>
      </div>
      <div class="sgf-trial-actions">
        <button class="btn sgf-trial-btn-exit" id="sgfBtnExitTrial" type="button" data-sgf-trial-exit title="退出试下研究并返回原谱">返回原谱</button>
      </div>
    </div>`;
  }

  function trialControlHtml() {
    if (!trialSession) return '';
    const canUndo = trialSession.canUndo();
    const canRedo = trialSession.canRedo();
    const hasMoves = trialSession.hasTrialMoves();

    return `<section class="sgf-board-column">
      ${trialBannerHtml()}
      <div class="sgf-board-wrap"><div id="sgfBoard" class="sgf-board" tabindex="0" role="region" aria-label="研究模式棋盘，可通过鼠标点击或方向键移动落子"></div></div>
      <div id="sgfMobileConfirmSlot"></div>
      <div class="sgf-controls sgf-trial-controls" role="group" aria-label="试下研究操作">
        ${settingsHtml()}
        <div class="sgf-control-group sgf-control-group--history">
          <button class="btn" type="button" data-sgf-trial-action="undo" ${canUndo ? '' : 'disabled'} title="悔棋一步（Ctrl+Z）">${svgIcon('undo')}悔棋</button>
          <button class="btn" type="button" data-sgf-trial-action="redo" ${canRedo ? '' : 'disabled'} title="重做一步（Ctrl+Y）">${svgIcon('redo')}重做</button>
          <button class="btn" type="button" data-sgf-trial-action="pass" title="当前执色方停一手">${svgIcon('pass')}停一手</button>
          <button class="btn" type="button" data-sgf-trial-action="reset" ${hasMoves ? '' : 'disabled'} title="清空试下，重置回研究起点">${svgIcon('reset')}重置试下</button>
        </div>
        <div class="sgf-control-group sgf-control-group--display">
          <div class="sgf-number-group" role="group" aria-label="落子编号">
            <span class="sgf-control-label">编号</span>
            <div class="sgf-segmented" id="sgfNumberModeGroup" role="radiogroup" aria-label="落子编号模式">
              <label class="sgf-segmented-btn ${numberMode === 'none' ? 'active' : ''}" data-sgf-number="none" title="不显示落子编号">
                <input type="radio" name="sgfNumberMode" value="none" ${numberMode === 'none' ? 'checked' : ''}>无
              </label>
              <label class="sgf-segmented-btn ${numberMode === 'last1' ? 'active' : ''}" data-sgf-number="last1" title="显示最近 1 手编号">
                <input type="radio" name="sgfNumberMode" value="last1" ${numberMode === 'last1' ? 'checked' : ''}>最近1手
              </label>
              <label class="sgf-segmented-btn ${numberMode === 'last5' ? 'active' : ''}" data-sgf-number="last5" title="显示最近 5 手编号">
                <input type="radio" name="sgfNumberMode" value="last5" ${numberMode === 'last5' ? 'checked' : ''}>最近5手
              </label>
              <label class="sgf-segmented-btn ${numberMode === 'last10' ? 'active' : ''}" data-sgf-number="last10" title="显示最近 10 手编号">
                <input type="radio" name="sgfNumberMode" value="last10" ${numberMode === 'last10' ? 'checked' : ''}>最近10手
              </label>
              <label class="sgf-segmented-btn ${numberMode === 'all' ? 'active' : ''}" data-sgf-number="all" title="显示全部落子编号">
                <input type="radio" name="sgfNumberMode" value="all" ${numberMode === 'all' ? 'checked' : ''}>全部
              </label>
            </div>
          </div>
          <label class="sgf-toggle sgf-last-marker-toggle" title="显示或隐藏当前最后一手落子标记">
            <input id="sgfShowLastMarker" type="checkbox" ${showLastMarker ? 'checked' : ''}>
            <span>最后一手标记</span>
          </label>
        </div>
        <div class="sgf-control-group sgf-control-group--exit">
          <button class="btn sgf-trial-btn-exit" type="button" data-sgf-trial-exit title="退出试下研究并返回原谱">返回原谱</button>
        </div>
      </div>
      <div class="sgf-path-status" id="sgfPathStatus" aria-live="polite"></div>
    </section>`;
  }

  function enterTrialMode() {
    if (!navigator || !data?.sgf) return;
    GoViewerSgfFind.exitIfActive();
    const state = navigator.stateAt(nodeId);
    if (state.error) {
      setMessage('当前局面存在错误或受阻，无法以此为起点进行试下研究。', 'error');
      return;
    }
    stopAutoplay();

    const bounds = navigator.currentPathBounds(nodeId);
    const originInfo = navigator.branchOriginInfo(nodeId);
    const trialEngineModule = window.GoSgfTrialEngine || globalThis.GoSgfTrialEngine;
    const initialKo = trialEngineModule?.detectOriginKo(data.sgf.tree, navigator, nodeId, data.sgf.board_size);

    trialSession = new trialEngineModule.TrialSession({
      boardSize: data.sgf.board_size,
      matchId,
      nodeId,
      moveNumber: state.moveNumber,
      pathDesc: originInfo.isMainline
        ? `实战主线第 ${state.moveNumber} 手`
        : `变化分支（从第 ${originInfo.branchedAtMove} 手分出）第 ${state.moveNumber} 手`,
      comment: data.sgf.tree.nodes[nodeId]?.comment || '',
      branchSelections: Object.fromEntries(navigator.branchSelections.entries()),
      initialState: state,
      initialKoPoint: initialKo
    });

    setMessage('已进入试下研究（退出后不保存），点击棋盘空点即可落子。');
    renderShell();
  }

  function exitTrialMode(force = false) {
    if (!trialSession) return;
    if (!force && trialSession.hasTrialMoves()) {
      if (!confirm('当前有未保存的试下落子，返回原谱将丢弃本次试下。是否确认返回？')) {
        return;
      }
    }
    trialSession = null;
    trialHoverPoint = null;
    setMessage('已退出试下研究模式，恢复原谱浏览。');
    renderShell();
  }

  /* ---------- 按落点查找 ---------- */









  function trialUndo() {
    if (!trialSession || !trialSession.canUndo()) return;
    trialSession.undo();
    setMessage('');
    renderPosition();
  }

  function trialRedo() {
    if (!trialSession || !trialSession.canRedo()) return;
    trialSession.redo();
    setMessage('');
    renderPosition();
  }

  function trialPass() {
    if (!trialSession) return;
    const res = trialSession.playPass();
    if (res.consecutivePass) {
      setMessage('双方连续停一手。可继续试下或返回原谱。', 'info');
    } else {
      setMessage(res.replaced ? '已停一手（并替换原有后续试下）。' : '已停一手。');
    }
    renderPosition();
  }

  function trialReset() {
    if (!trialSession) return;
    if (trialSession.hasTrialMoves()) {
      if (!confirm('是否确认清空当前试下，重置回研究起点？')) {
        return;
      }
    }
    trialSession.reset();
    setMessage('已重置回研究起点。');
    renderPosition();
  }

  function boardPointFromEvent(event) {
    if (!data?.sgf) return null;
    const boardEl = panel.querySelector('#sgfBoard svg');
    if (!boardEl) return null;
    const rect = boardEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    let clientX, clientY;
    if (event.touches && event.touches.length) {
      clientX = event.touches[0].clientX;
      clientY = event.touches[0].clientY;
    } else if (event.changedTouches && event.changedTouches.length) {
      clientX = event.changedTouches[0].clientX;
      clientY = event.changedTouches[0].clientY;
    } else {
      clientX = event.clientX;
      clientY = event.clientY;
    }

    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
      return null;
    }

    const vx = ((clientX - rect.left) / rect.width) * 100;
    const vy = ((clientY - rect.top) / rect.height) * 100;

    const size = data.sgf.board_size;
    const start = 10, end = 90, step = (end - start) / (size - 1);

    const bx = Math.round((vx - start) / step);
    const by = Math.round((vy - start) / step);

    if (bx >= 0 && bx < size && by >= 0 && by < size) {
      const exactX = start + bx * step;
      const exactY = start + by * step;
      const dist = Math.hypot(vx - exactX, vy - exactY);
      if (dist <= step * 0.55) {
        return { x: bx, y: by };
      }
    }
    return null;
  }

  function settingsHtml(playback = false) {
    const sgf = data.sgf;
    return `<details class="sgf-settings">
      <summary class="btn">设置</summary>
      <div class="sgf-settings-panel">
        <div class="sgf-board-theme-group" id="sgfBoardThemeGroup" role="group" aria-label="棋盘材质"><span class="sgf-control-label">棋盘</span>${[['auto','自动'],['kaya','榧木'],['minimal','暖灰'],['slate','石板']].map(([key,label]) => `<button class="sgf-board-theme-btn${boardTheme === key ? ' active' : ''}" type="button" data-sgf-board-theme="${key}" aria-pressed="${boardTheme === key}">${label}</button>`).join('')}</div>
        ${sgf.source_url ? `<a class="btn" href="${E(sgf.source_url)}" download>${svgIcon('download')}下载棋谱</a>` : ''}
        ${playback ? `<div class="sgf-control-group sgf-control-group--shortcuts">
          <button class="btn" type="button" data-sgf-nav="start" title="回到开局（Home）" aria-label="回到开局">${svgIcon('start')}</button>
          <button class="btn" type="button" data-sgf-nav="fast-prev" title="快退五手（PageUp）" aria-label="快退五手">${svgIcon('fastPrev')}</button>
          <button class="btn" type="button" data-sgf-nav="fast-next" title="快进五手（PageDown）" aria-label="快进五手">${svgIcon('fastNext')}</button>
          <button class="btn" type="button" data-sgf-nav="end" title="跳到当前变化末手（End）" aria-label="末手">${svgIcon('end')}</button>
        </div>
        <div class="sgf-control-group sgf-control-group--play">
          <label class="sgf-speed-select" title="自动播放每手间隔时间">
            <span>速度</span>
            <select id="sgfPlaySpeed">
              ${[500, 1000, 2000, 3000].map(ms => `<option value="${ms}" ${ms === playSpeed ? 'selected' : ''}>${ms / 1000}秒</option>`).join('')}
            </select>
          </label>
          <label class="sgf-jump"><span>手数</span><input id="sgfMoveInput" type="number" min="0" step="1" inputmode="numeric"><button class="btn" type="button" data-sgf-nav="jump">跳转</button></label>
        </div>
        <div class="sgf-control-group sgf-control-group--display">
          <div class="sgf-number-group" role="group" aria-label="落子编号">
            <span class="sgf-control-label">编号</span>
            <div class="sgf-segmented" id="sgfNumberModeGroup" role="radiogroup" aria-label="落子编号模式">
              <label class="sgf-segmented-btn ${numberMode === 'none' ? 'active' : ''}" data-sgf-number="none" title="不显示落子编号">
                <input type="radio" name="sgfNumberMode" value="none" ${numberMode === 'none' ? 'checked' : ''}>无
              </label>
              <label class="sgf-segmented-btn ${numberMode === 'last1' ? 'active' : ''}" data-sgf-number="last1" title="显示最近 1 手编号">
                <input type="radio" name="sgfNumberMode" value="last1" ${numberMode === 'last1' ? 'checked' : ''}>最近1手
              </label>
              <label class="sgf-segmented-btn ${numberMode === 'last5' ? 'active' : ''}" data-sgf-number="last5" title="显示最近 5 手编号">
                <input type="radio" name="sgfNumberMode" value="last5" ${numberMode === 'last5' ? 'checked' : ''}>最近5手
              </label>
              <label class="sgf-segmented-btn ${numberMode === 'last10' ? 'active' : ''}" data-sgf-number="last10" title="显示最近 10 手编号">
                <input type="radio" name="sgfNumberMode" value="last10" ${numberMode === 'last10' ? 'checked' : ''}>最近10手
              </label>
              <label class="sgf-segmented-btn ${numberMode === 'all' ? 'active' : ''}" data-sgf-number="all" title="显示全部落子编号">
                <input type="radio" name="sgfNumberMode" value="all" ${numberMode === 'all' ? 'checked' : ''}>全部
              </label>
            </div>
            <input id="sgfShowNumbers" type="checkbox" ${numberMode !== 'none' ? 'checked' : ''} hidden>
          </div>
          <label class="sgf-toggle sgf-last-marker-toggle" title="显示或隐藏当前最后一手落子标记">
            <input id="sgfShowLastMarker" type="checkbox" ${showLastMarker ? 'checked' : ''}>
            <span>最后一手标记</span>
          </label>
        </div>
        <div class="sgf-control-group sgf-control-group--branch">
          <button class="btn" type="button" data-sgf-nav="fork" id="sgfBtnFork" title="返回上一个分叉节点" disabled>${svgIcon('branch')}返回分叉处</button>
          <button class="btn" type="button" data-sgf-nav="mainline" id="sgfBtnMainline">${svgIcon('branch')}回到主线</button>
        </div>` : ''}
      </div>
    </details>`;
  }

  function controlHtml() {
    return `<section class="sgf-board-column">
      <div class="sgf-board-wrap"><div id="sgfBoard" class="sgf-board"></div></div>
      <div class="sgf-player-deck">
      <div class="sgf-progress-wrap" role="group" aria-label="手数进度">
        <div class="sgf-progress-meta">
          <span class="sgf-progress-text">第 <strong id="sgfProgressCurrent">0</strong> 手 / 共 <span id="sgfProgressTotal">0</span> 手</span>
          <span class="sgf-progress-badge badge-mainline" id="sgfProgressBadge">实战主线</span>
        </div>
        <div class="sgf-progress-track"><input type="range" id="sgfProgressBar" class="sgf-progress-slider" min="0" max="0" value="0" step="1" aria-label="棋谱手数进度条"><output class="sgf-progress-preview" id="sgfProgressPreview" for="sgfProgressBar" hidden></output></div>
      </div>
      <div class="sgf-controls" role="group" aria-label="棋谱逐手导航">
        <div class="sgf-control-group sgf-control-group--nav">
          <button class="btn" type="button" data-sgf-nav="prev" title="上一手（←）" aria-label="上一手">${svgIcon('prev')}</button>
          <button class="btn btn-autoplay" type="button" id="sgfBtnAutoplay" data-sgf-autoplay title="自动播放/暂停（快捷键 空格）">${svgIcon('play')}<span>播放</span></button>
          <button class="btn" type="button" data-sgf-nav="next" title="下一手（→）" aria-label="下一手">${svgIcon('next')}</button>
        </div>
        ${settingsHtml(true)}
      </div>
      </div>
      <div class="sgf-path-status" id="sgfPathStatus" aria-live="polite"></div>
    </section>`;
  }

  function renderShell() {
    if (!data) return;
    if (data.error) {
      panel.innerHTML = header() + `<div class="sgf-empty sgf-error"><strong>棋谱读取异常</strong><p>${E(data.error)}</p>
        <button class="btn" type="button" data-sgf-retry>重新读取</button></div>`;
      bindShell(); return;
    }
    panel.innerHTML = focusBarHtml() + header() + GoViewerSgfFind.panelHtml() + (data.sgf ? `<div class="sgf-layout">${trialSession ? trialControlHtml() : controlHtml()}<section class="sgf-info" id="sgfInfoPanel" aria-label="棋谱资料">
      <div class="sgf-status-card">
        <div class="sgf-status-head">
          <h4 id="sgfCurrentHeading" class="sgf-status-heading">当前节点</h4>
          <span class="sgf-status-next" id="sgfNextLabel"></span>
        </div>
        <div class="sgf-status-detail" id="sgfMoveDetail"></div>
        <div class="sgf-status-error" id="sgfErrorBanner" hidden></div>
      </div>
      <div class="sgf-branches" id="sgfBranches" hidden></div>
      <div class="sgf-comment-section">
        <h4>解说与评论</h4>
        <p id="sgfNodeComment" class="sgf-comment"></p>
      </div>
      <details class="sgf-tree-card" id="sgfTreeCard">
        <summary class="sgf-tree-summary"><span>变化路径结构</span><span class="sgf-tree-pill" id="sgfTreePill">实战主线</span></summary>
        <div class="sgf-tree-body" id="sgfTreeBody"></div>
      </details>
      ${techDetailsHtml()}
    </section></div>` : emptyHtml()) +
      `<div id="sgfImportArea"></div><p id="sgfMessage" class="sgf-message" role="status" aria-live="polite">${E(message)}</p>`;
    if (focusMode) {
      dialog.classList.add('sgf-in-focus');
    }
    dialog.classList.toggle('sgf-comments-collapsed', !focusCommentsOpen);
    bindShell();
    if (data.sgf) renderPosition();
  }

  function bindShell() {
    panel.querySelectorAll('[data-sgf-import],[data-sgf-replace]').forEach(button => button.addEventListener('click', () => {
      panel.querySelector('#sgfFileInput')?.click();
    }));
    panel.querySelector('#sgfFileInput')?.addEventListener('change', event => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) prepareFile(file);
    });
    panel.querySelectorAll('[data-sgf-nav]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.sgfNav)));
    panel.querySelectorAll('[data-sgf-board-theme]').forEach(button => button.addEventListener('click', () => {
      boardTheme = button.dataset.sgfBoardTheme;
      try { localStorage.setItem(BOARD_THEME_KEY, boardTheme); } catch (_) {}
      panel.querySelectorAll('[data-sgf-board-theme]').forEach(item => {
        const active = item.dataset.sgfBoardTheme === boardTheme;
        item.classList.toggle('active', active);
        item.setAttribute('aria-pressed', String(active));
      });
      applyBoardTheme();
    }));
    panel.querySelector('#sgfMoveInput')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); navigate('jump'); }
    });

    // Progress bar slider
    const progressBar = panel.querySelector('#sgfProgressBar');
    if (progressBar) {
      const handleProgress = event => {
        stopAutoplay();
        const val = Number(event.target.value);
        if (Number.isInteger(val)) {
          nodeId = navigator.nodeForMove(nodeId, val);
          if (val <= 0) mainlineFollowConfirmed = false;
          setMessage('');
          renderPosition();
        }
      };
      progressBar.addEventListener('input', handleProgress);
      progressBar.addEventListener('change', handleProgress);
      const preview = panel.querySelector('#sgfProgressPreview');
      const updatePreview = event => {
        const rect = progressBar.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        const move = Math.round(pct * Number(progressBar.max || 0));
        preview.textContent = `第 ${move} 手`;
        preview.style.left = `${pct * 100}%`;
        preview.hidden = false;
      };
      progressBar.addEventListener('pointermove', updatePreview);
      progressBar.addEventListener('pointerleave', () => { preview.hidden = true; });
      progressBar.addEventListener('pointercancel', () => { preview.hidden = true; });
    }

    // Autoplay button and speed selector
    panel.querySelector('#sgfBtnAutoplay')?.addEventListener('click', toggleAutoplay);
    panel.querySelector('#sgfPlaySpeed')?.addEventListener('change', event => {
      playSpeed = Number(event.target.value) || 1000;
      if (isPlaying) {
        clearTimeout(playTimer);
        scheduleNextStep();
      }
    });

    // 按落点查找：点击棋盘或输入坐标，只列出当前路径的着手。
    panel.querySelector('#sgfBtnFind')?.addEventListener('click', () => GoViewerSgfFind.toggle());
    panel.querySelector('#sgfFindExit')?.addEventListener('click', () => GoViewerSgfFind.exit());
    const runFind = () => {
GoViewerSgfFind.submitCoordText(panel.querySelector('#sgfFindCoord')?.value);
};
    panel.querySelector('#sgfFindGo')?.addEventListener('click', runFind);
    panel.querySelector('#sgfFindCoord')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); runFind(); }
    });
    panel.querySelector('#sgfFindPanel')?.addEventListener('click', event => {
      const button = event.target.closest('[data-find-node]');
      if (button) { event.preventDefault(); GoViewerSgfFind.jump(button.dataset.findNode); }
    });

    // Board candidate marker click & keyboard delegation
    const boardEl = panel.querySelector('#sgfBoard');
    if (boardEl) {
      boardEl.addEventListener('click', event => {
        if (GoViewerSgfFind.isActive()) {
          const pt = boardPointFromEvent(event);
          if (!pt) return;
          event.preventDefault();
          GoViewerSgfFind.search(pt.x, pt.y);
          return;
        }
        if (trialSession) {
          const pt = boardPointFromEvent(event);
          if (!pt) return;
          const isTouch = window.matchMedia('(pointer: coarse)').matches || (window.innerWidth <= 640 && event.pointerType === 'touch');
          if (isTouch) {
            const check = trialSession.validateMove(pt.x, pt.y);
            if (!check.legal) {
              setMessage(check.reason, 'error');
              trialSession.pendingMobilePoint = null;
              renderPosition();
              return;
            }
            trialSession.pendingMobilePoint = pt;
            trialHoverPoint = null;
            setMessage(`已选择落点：${trialSession.currentState.toMove === 'B' ? '黑' : '白'} ${engine.coordinate(trialSession.boardSize, pt.x, pt.y)}，请点击“确认落子”落子。`);
            renderPosition();
            return;
          }
          const res = trialSession.playMove(pt.x, pt.y);
          if (res.success) {
            trialHoverPoint = null;
            setMessage(res.replaced ? '落子成功（已替换原有后续试下）。' : '');
          } else {
            setMessage(res.reason, 'error');
          }
          renderPosition();
          return;
        }

        const cand = event.target.closest('.sgf-cand-marker');
        if (cand && cand.dataset.candId) {
          event.stopPropagation();
          selectBranchAndAdvance(cand.dataset.candId);
        }
      });
      boardEl.addEventListener('keydown', event => {
        const cand = event.target.closest('.sgf-cand-marker');
        if (cand && cand.dataset.candId && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          event.stopPropagation();
          selectBranchAndAdvance(cand.dataset.candId);
        }
      });
      boardEl.addEventListener('mousemove', event => {
        if (!trialSession) return;
        if (window.matchMedia('(pointer: coarse)').matches) return;
        const pt = boardPointFromEvent(event);
        if (!pt) {
          if (trialHoverPoint) {
            trialHoverPoint = null;
            renderPosition();
          }
          return;
        }
        if (!trialHoverPoint || trialHoverPoint.x !== pt.x || trialHoverPoint.y !== pt.y) {
          const check = trialSession.validateMove(pt.x, pt.y);
          if (check.legal) {
            trialHoverPoint = pt;
          } else {
            trialHoverPoint = null;
          }
          renderPosition();
        }
      });

      boardEl.addEventListener('mouseleave', () => {
        if (trialSession && trialHoverPoint) {
          trialHoverPoint = null;
          renderPosition();
        }
      });
    }
    // Number mode segmented radio group
    panel.querySelectorAll('input[name="sgfNumberMode"]').forEach(radio => {
      radio.addEventListener('change', event => {
        if (event.target.checked) {
          numberMode = event.target.value;
          panel.querySelectorAll('.sgf-segmented-btn').forEach(btn => {
            const inp = btn.querySelector('input');
            btn.classList.toggle('active', inp && inp.value === numberMode);
          });
          const legacyCheckbox = panel.querySelector('#sgfShowNumbers');
          if (legacyCheckbox) legacyCheckbox.checked = numberMode !== 'none';
          renderPosition();
        }
      });
    });

    // Legacy checkbox synchronization
    panel.querySelector('#sgfShowNumbers')?.addEventListener('change', event => {
      numberMode = event.target.checked ? 'all' : 'none';
      panel.querySelectorAll('input[name="sgfNumberMode"]').forEach(radio => {
        radio.checked = radio.value === numberMode;
      });
      panel.querySelectorAll('.sgf-segmented-btn').forEach(btn => {
        const inp = btn.querySelector('input');
        btn.classList.toggle('active', inp && inp.value === numberMode);
      });
      renderPosition();
    });

    // Last move marker checkbox
    panel.querySelector('#sgfShowLastMarker')?.addEventListener('change', event => {
      showLastMarker = event.target.checked;
      renderPosition();
    });

    // Trial Mode Actions
    panel.querySelectorAll('[data-sgf-trial]').forEach(btn => btn.addEventListener('click', enterTrialMode));
    panel.querySelectorAll('[data-sgf-trial-exit]').forEach(btn => btn.addEventListener('click', () => exitTrialMode()));
    panel.querySelector('[data-sgf-trial-action="undo"]')?.addEventListener('click', trialUndo);
    panel.querySelector('[data-sgf-trial-action="redo"]')?.addEventListener('click', trialRedo);
    panel.querySelector('[data-sgf-trial-action="pass"]')?.addEventListener('click', trialPass);
    panel.querySelector('[data-sgf-trial-action="reset"]')?.addEventListener('click', trialReset);



    // Focus mode buttons
    panel.querySelectorAll('[data-sgf-focus]').forEach(btn => btn.addEventListener('click', enterFocusMode));
    panel.querySelectorAll('[data-sgf-focus-exit]').forEach(btn => btn.addEventListener('click', exitFocusMode));
    panel.querySelectorAll('[data-sgf-toggle-comments],[data-sgf-toggle-sidebar]').forEach(btn => btn.addEventListener('click', toggleFocusComments));
    panel.querySelector('#sgfGameSelect')?.addEventListener('change', event => {
      const id = event.target.value;
      if (id) { matchId = id; load(id); updateTabLabel(); }
    });
    panel.querySelector('#sgfVersionSelect')?.addEventListener('change', event => {
      if (event.target.value) load(matchId, event.target.value);
    });
    panel.querySelector('[data-sgf-unlink]')?.addEventListener('click', () => { showUnlink = true; renderUnlink(); });
    panel.querySelector('[data-sgf-retry]')?.addEventListener('click', () => load(matchId));
    panel.querySelectorAll('[data-sgf-open-details]').forEach(btn => btn.addEventListener('click', () => {
      const details = panel.querySelector('#sgfTechDetails');
      if (details) {
        details.open = true;
        details.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }));
  }

  function navigate(action) {
    if (!navigator || !data?.sgf) return;
    stopAutoplay();
    const bounds = navigator.currentPathBounds(nodeId);
    if (action === 'start') {
      nodeId = bounds.openingNodeId;
      mainlineFollowConfirmed = false;
      setMessage('');
    } else if (action === 'prev') {
      nodeId = navigator.previous(nodeId) || nodeId;
      setMessage('');
    } else if (action === 'fast-prev' || action === 'fast-next') {
      const current = navigator.stateAt(nodeId).moveNumber;
      const target = Math.max(0, Math.min(bounds.maxMove, current + (action === 'fast-next' ? 5 : -5)));
      nodeId = navigator.nodeForMove(nodeId, target);
      if (target === 0) mainlineFollowConfirmed = false;
      setMessage('');
    } else if (action === 'next') {
      const state = navigator.stateAt(nodeId); if (state.error) return;
      nodeId = navigator.next(nodeId) || nodeId;
      setMessage('');
    } else if (action === 'end') {
      let state = navigator.stateAt(nodeId); if (state.error) return;
      let guard = 0;
      while (navigator.next(nodeId) && guard++ < 100000) {
        const nextId = navigator.next(nodeId);
        const nextNode = data.sgf.tree.nodes[nextId];
        if (nextNode?.position_error || nextNode?.blocked) break;
        const candidate = navigator.stateAt(nextId);
        if (candidate.error) break;
        nodeId = nextId;
      }
      setMessage('');
    } else if (action === 'jump') {
      const input = panel.querySelector('#sgfMoveInput');
      const rawVal = input?.value?.trim();
      const value = Number(rawVal);
      if (!rawVal || !Number.isInteger(value)) {
        setMessage('请输入有效的整数手数。', 'error');
        return;
      }
      if (value < 0) {
        setMessage(`手数不能为负数，请输入 0 到 ${bounds.maxMove} 之间的手数。`, 'error');
        return;
      }
      if (value > bounds.maxMove) {
        setMessage(`当前变化最多为 ${bounds.maxMove} 手，请输入 0 到 ${bounds.maxMove} 之间的手数。`, 'error');
        return;
      }
      nodeId = navigator.nodeForMove(nodeId, value);
      if (value <= 0) mainlineFollowConfirmed = false;
      setMessage('');
    } else if (action === 'fork') {
      const forkId = navigator.nearestFork(nodeId);
      if (forkId) {
        nodeId = forkId;
        setMessage('');
      } else {
        setMessage('当前分支上方无其他分叉点。', 'info');
      }
    } else if (action === 'mainline') {
      navigator.clearBranchSelections();
      mainlineFollowConfirmed = true;
      const state = navigator.stateAt(nodeId);
      const targetMove = state.moveNumber;
      nodeId = navigator.mainlineNodeForMove(targetMove);
      const mainlineMoves = data.sgf.stats?.main_line_moves || 0;
      if (targetMove > mainlineMoves) {
        setMessage(`已定位至主线末手（主线共 ${mainlineMoves} 手）。`);
      } else {
        setMessage('');
      }
    }
    renderPosition();
  }

  function boardSvg(state) {
    const size = data.sgf.board_size, start = 10, end = 90, step = (end - start) / (size - 1);
    const radius = Math.max(1.7, step * 0.44);
    const xy = (x, y) => [start + x * step, start + y * step];
    let grid = boardGridCache.get(size);
    const stones = [], markers = [];
    if (!grid) {
      grid = [];
      for (let i = 0; i < size; i++) {
        const p = start + i * step;
        grid.push(`<line x1="${start}" y1="${p}" x2="${end}" y2="${p}" class="sgf-grid-line"/>`);
        grid.push(`<line x1="${p}" y1="${start}" x2="${p}" y2="${end}" class="sgf-grid-line"/>`);
      }
      grid.push('<rect x="10" y="10" width="80" height="80" class="sgf-grid-border"/>');
      for (const star of engine.starPoints(size)) {
        const [x, y] = xy(star.x, star.y);
        grid.push(`<circle cx="${x}" cy="${y}" r="${Math.max(.6, radius * .2)}" class="sgf-star"/>`);
      }
      for (let i = 0; i < size; i++) {
        const p = start + i * step;
        const label = engine.COLUMNS[i];
        grid.push(`<text x="${p}" y="6.2" text-anchor="middle" class="sgf-coord">${E(label)}</text>`);
        grid.push(`<text x="${p}" y="96.8" text-anchor="middle" class="sgf-coord">${E(label)}</text>`);
        grid.push(`<text x="5" y="${p + 1.1}" text-anchor="middle" class="sgf-coord">${E(String(size - i))}</text>`);
        grid.push(`<text x="95" y="${p + 1.1}" text-anchor="middle" class="sgf-coord">${E(String(size - i))}</text>`);
      }
      boardGridCache.set(size, grid);
    }
    // Check if the last move stone is currently present on the board
    let hasLastStone = false;
    let lastX = -1, lastY = -1;
    if (showLastMarker && state.moveNumber > 0 && state.lastMove && !state.lastMove.pass) {
      lastX = state.lastMove.x;
      lastY = state.lastMove.y;
      if (lastX >= 0 && lastX < size && lastY >= 0 && lastY < size) {
        const lastIdx = lastY * size + lastX;
        const expectedColour = state.lastMove.colour === 'B' ? 1 : 2;
        if (state.cells[lastIdx] === expectedColour) {
          hasLastStone = true;
        }
      }
    }

    const stoneList = trialSession ? trialSession.stones() : navigator.stones(state);
    for (const stone of stoneList) {
      const [x, y] = xy(stone.x, stone.y);
      stones.push(`<g class="sgf-stone-group" data-pt="${stone.x},${stone.y}" data-color="${stone.colour}"><circle cx="${x}" cy="${y}" r="${radius}" class="sgf-stone ${stone.colour === 'B' ? 'black' : 'white'}"/>`);

      // Last move marker (outer concentric ring that does not obscure center number)
      if (hasLastStone && stone.x === lastX && stone.y === lastY) {
        const ringRadius = radius * 0.78;
        const ringStroke = Math.max(0.3, radius * 0.16);
        markers.push(`<circle cx="${x}" cy="${y}" r="${ringRadius.toFixed(2)}" class="sgf-last-ring ${stone.colour === 'B' ? 'on-black' : 'on-white'}" fill="none" stroke-width="${ringStroke.toFixed(2)}"/>`);
      }

      // Move numbering according to numberMode
      if (isNumberVisible(stone.number, state.moveNumber, numberMode)) {
        const numStr = String(stone.number);
        const numLen = numStr.length;
        const fontScale = numLen >= 3 ? 0.66 : numLen === 2 ? 0.82 : 0.94;
        const fontSize = Math.max(1.2, radius * fontScale);
        const yOffset = radius * (numLen >= 3 ? 0.24 : 0.32);
        stones.push(`<text x="${x}" y="${y + yOffset}" text-anchor="middle" class="sgf-move-number ${stone.colour === 'B' ? 'on-black' : 'on-white'}" style="font-size:${fontSize.toFixed(2)}px" data-move-num="${stone.number}">${stone.number}</text>`);
      }
      stones.push('</g>');
    }

    if (state.lastMove?.pass) {
      markers.push(`<text x="${end + 2}" y="${start + 3}" text-anchor="start" class="sgf-pass-mark">停</text>`);
    }

    // Trial mode overlays: hover preview, keyboard cursor, mobile pending touch
    if (trialSession) {
      if (trialHoverPoint && !trialSession.pendingMobilePoint) {
        const [hx, hy] = xy(trialHoverPoint.x, trialHoverPoint.y);
        const toMoveColor = state.toMove === 'B' ? 'black' : 'white';
        markers.push(`<circle cx="${hx}" cy="${hy}" r="${radius}" class="sgf-stone-preview ${toMoveColor}"/>`);
      }
      if (trialSession.keyboardCursor) {
        const [kx, ky] = xy(trialSession.keyboardCursor.x, trialSession.keyboardCursor.y);
        const kSize = radius * 1.8;
        markers.push(`<rect x="${(kx - kSize/2).toFixed(2)}" y="${(ky - kSize/2).toFixed(2)}" width="${kSize.toFixed(2)}" height="${kSize.toFixed(2)}" class="sgf-keyboard-cursor" rx="${(radius * 0.25).toFixed(2)}"/>`);
      }
      if (trialSession.pendingMobilePoint) {
        const [tx, ty] = xy(trialSession.pendingMobilePoint.x, trialSession.pendingMobilePoint.y);
        const toMoveColor = state.toMove === 'B' ? 'black' : 'white';
        markers.push(`<circle cx="${tx}" cy="${ty}" r="${radius}" class="sgf-stone-preview ${toMoveColor}"/>`);
        markers.push(`<circle cx="${tx}" cy="${ty}" r="${(radius * 1.3).toFixed(2)}" class="sgf-touch-point"/>`);
      }
    }

    // Candidate branch markers (suppressed in trial mode)
    const candidates = !trialSession ? navigator.candidateMoves(nodeId) : [];
    if (candidates.length > 1) {
      const pointMap = new Map();
      for (const cand of candidates) {
        if (cand.hasCoord) {
          const key = `${cand.x},${cand.y}`;
          if (!pointMap.has(key)) pointMap.set(key, []);
          pointMap.get(key).push(cand);
        }
      }
      for (const [key, cList] of pointMap.entries()) {
        const [px, py] = key.split(',').map(Number);
        const [cx, cy] = xy(px, py);
        const isCombo = cList.length > 1;
        const firstCand = cList[0];
        const comboLetters = isCombo ? cList.map(c => c.letter).join('/') : firstCand.letter;
        const isMainline = cList.some(c => c.isMainline);
        const isChosen = cList.some(c => c.isChosen);
        const candColor = firstCand.color === 'B' ? 'cand-on-black' : 'cand-on-white';
        const boxW = radius * (isCombo ? 2.3 : 1.7);
        const boxH = radius * 1.6;
        const fontSz = radius * (isCombo ? 0.62 : 0.82);
        const titleText = cList.map(c => `[${c.letter}] ${c.label}${c.comment ? ' (' + c.comment.slice(0, 50) + ')' : ''}`).join('\n');

        markers.push(`<g class="sgf-cand-marker ${isMainline ? 'cand-mainline' : 'cand-branch'} ${isChosen ? 'cand-chosen' : ''} ${candColor}" data-cand-id="${firstCand.childId}" tabindex="0" role="button" aria-label="候选着手 ${comboLetters}：${E(titleText)}">`);
        markers.push(`<rect x="${(cx - boxW/2).toFixed(2)}" y="${(cy - boxH/2).toFixed(2)}" width="${boxW.toFixed(2)}" height="${boxH.toFixed(2)}" rx="${(radius * 0.35).toFixed(2)}" class="sgf-cand-box"/>`);
        markers.push(`<text x="${cx.toFixed(2)}" y="${(cy + fontSz * 0.35).toFixed(2)}" text-anchor="middle" class="sgf-cand-text" style="font-size:${fontSz.toFixed(2)}px">${comboLetters}</text>`);
        markers.push(`<title>${E(titleText)}</title>`);
        markers.push(`</g>`);
      }
    }
    const current = data.sgf.tree.nodes[nodeId];
    const move = current?.move;
    const aria = `${data.sgf.board_size}路棋盘，第${state.moveNumber}手${state.lastMove?.pass ? '停一手' : move ? `，${move.color === 'B' ? '黑' : '白'}${engine.coordinate(size, move.x, move.y)}` : ''}`;
    return `<svg viewBox="0 0 100 100" role="img" aria-label="${E(aria)}" data-board-size="${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="sgfBoardSheen" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" class="sgf-board-grad-start"/><stop offset="100%" class="sgf-board-grad-end"/></linearGradient>
        <pattern id="sgfBoardGrain" patternUnits="userSpaceOnUse" width="100" height="7"><path d="M0 2 Q25 1 50 2 T100 2 M0 5 Q28 6 55 5 T100 5" class="sgf-board-grain-line"/></pattern>
        <radialGradient id="sgfBlackStoneGrad" cx="32%" cy="28%" r="68%"><stop offset="0%" class="sgf-black-highlight"/><stop offset="45%" class="sgf-black-mid"/><stop offset="100%" class="sgf-black-edge"/></radialGradient>
        <radialGradient id="sgfWhiteStoneGrad" cx="30%" cy="26%" r="72%"><stop offset="0%" class="sgf-white-highlight"/><stop offset="65%" class="sgf-white-mid"/><stop offset="100%" class="sgf-white-edge"/></radialGradient>
        <filter id="sgfStoneShadow" x="-30%" y="-30%" width="170%" height="170%"><feDropShadow dx="0.18" dy="0.32" stdDeviation="0.28" class="sgf-stone-shadow"/></filter>
      </defs>
      <rect width="100" height="100" class="sgf-board-surface"/>
      <rect width="100" height="100" class="sgf-board-grain"/>
      <g class="sgf-layer-grid">${grid.join('')}</g>
      <g class="sgf-layer-captures"></g>
      <g class="sgf-layer-stones">${stones.join('')}</g>
      <g class="sgf-layer-markers">${markers.join('')}</g>
    </svg>`;
  }

  function renderBoard(state) {
    const board = panel.querySelector('#sgfBoard');
    if (!board) return;
    applyBoardTheme();
    const markup = boardSvg(state);
    const current = board.querySelector('svg');
    const matchKey = `${matchId}:${trialSession ? 'trial' : 'record'}`;
    if (!current || Number(current.dataset.boardSize) !== data.sgf.board_size) {
      board.innerHTML = markup;
      board.dataset.renderMatch = matchKey;
      board.dataset.renderMove = state.moveNumber;
      return;
    }
    const next = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;
    const stoneLayer = current.querySelector('.sgf-layer-stones');
    const captureLayer = current.querySelector('.sgf-layer-captures');
    const markerLayer = current.querySelector('.sgf-layer-markers');
    const nextStones = [...next.querySelectorAll('.sgf-layer-stones > .sgf-stone-group')];
    const nextByPoint = new Map(nextStones.map(group => [group.dataset.pt, group]));
    const previous = new Map([...stoneLayer.children].map(group => [group.dataset.pt, group]));
    const singleStep = board.dataset.renderMatch === matchKey &&
      Math.abs(Number(board.dataset.renderMove) - state.moveNumber) === 1 &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!singleStep) captureLayer.replaceChildren();
    for (const [point, group] of previous) {
      const nextGroup = nextByPoint.get(point);
      if (!nextGroup || nextGroup.dataset.color !== group.dataset.color) {
        if (singleStep) {
          const ghost = group.cloneNode(true);
          ghost.classList.add('is-captured-stone');
          captureLayer.append(ghost);
          setTimeout(() => ghost.remove(), 190);
        }
        group.remove();
        previous.delete(point);
      }
    }
    for (const nextGroup of nextStones) {
      const old = previous.get(nextGroup.dataset.pt);
      if (old) {
        // Preserve the circle and its DOM identity; only numbering changes.
        const oldNumber = old.querySelector('.sgf-move-number');
        const newNumber = nextGroup.querySelector('.sgf-move-number');
        if ((oldNumber?.outerHTML || '') !== (newNumber?.outerHTML || '')) {
          oldNumber?.remove();
          if (newNumber) old.append(document.importNode(newNumber, true));
        }
      } else {
        const group = document.importNode(nextGroup, true);
        if (singleStep) {
          group.classList.add('is-new-stone');
          group.addEventListener('animationend', () => group.classList.remove('is-new-stone'), {once: true});
        }
        stoneLayer.append(group);
      }
    }
    const markerNodes = [...next.querySelector('.sgf-layer-markers').children].map(item => document.importNode(item, true));
    if (singleStep) markerNodes.find(item => item.classList?.contains('sgf-last-ring'))?.classList.add('is-new-ring');
    markerLayer.replaceChildren(...markerNodes);
    current.setAttribute('aria-label', next.getAttribute('aria-label'));
    board.dataset.renderMatch = matchKey;
    board.dataset.renderMove = state.moveNumber;
  }

  function renderTrialPosition() {
    if (!trialSession) return;
    const state = trialSession.currentState;
    const size = trialSession.boardSize;

    renderBoard(state);

    const path = panel.querySelector('#sgfPathStatus');
    if (path) {
      const moveCount = trialSession.trialMoveCount;
      const lastMove = state.lastMove;
      let text = `试下研究 · 起点：${trialSession.originPathDesc} · 当前试下第 ${moveCount} 手`;
      if (lastMove?.pass) {
        text += '（本手停一手）';
      } else if (lastMove) {
        text += `（本手：${lastMove.colour === 'B' ? '黑' : '白'} ${engine.coordinate(size, lastMove.x, lastMove.y)}）`;
      }
      text += ` · 下一手：${state.toMove === 'B' ? '黑' : '白'} · 提子：黑 ${state.captures.B} / 白 ${state.captures.W}。`;
      if (trialSession.lastNotice) text += ` ${trialSession.lastNotice}`;
      path.textContent = text;
      path.classList.remove('error');
    }

    const comment = panel.querySelector('#sgfNodeComment');
    if (comment) {
      comment.textContent = trialSession.originComment || '起点暂无解说或评论。';
      comment.classList.toggle('empty', !trialSession.originComment);
    }

    const branches = panel.querySelector('#sgfBranches');
    if (branches) {
      branches.hidden = true;
      branches.replaceChildren();
    }
    const treeCard = panel.querySelector('#sgfTreeCard');
    if (treeCard) {
      treeCard.hidden = true;
    }

    const banner = panel.querySelector('.sgf-trial-banner .sgf-trial-meta');
    if (banner) {
      const moveCount = trialSession.trialMoveCount;
      const toMoveName = state.toMove === 'B' ? '黑先' : '白先';
      const caps = `提子：黑 ${state.captures.B} / 白 ${state.captures.W}`;
      banner.innerHTML = `起点：${E(trialSession.originPathDesc)} · 当前试下 <strong>${moveCount}</strong> 手 · 下一手：<strong>${toMoveName}</strong> · ${E(caps)}`;
    }

    const btnUndo = panel.querySelector('[data-sgf-trial-action="undo"]');
    if (btnUndo) btnUndo.disabled = !trialSession.canUndo();
    const btnRedo = panel.querySelector('[data-sgf-trial-action="redo"]');
    if (btnRedo) btnRedo.disabled = !trialSession.canRedo();
    const btnReset = panel.querySelector('[data-sgf-trial-action="reset"]');
    if (btnReset) btnReset.disabled = !trialSession.hasTrialMoves();

    const confirmSlot = panel.querySelector('#sgfMobileConfirmSlot');
    if (confirmSlot) {
      if (trialSession.pendingMobilePoint) {
        const pt = trialSession.pendingMobilePoint;
        confirmSlot.innerHTML = `<div class="sgf-mobile-confirm-bar" id="sgfMobileConfirmBar">
          <span>待落子：<strong>${state.toMove === 'B' ? '黑' : '白'} ${engine.coordinate(size, pt.x, pt.y)}</strong></span>
          <div class="sgf-mobile-confirm-actions">
            <button class="btn btn-primary" type="button" id="sgfBtnMobileConfirm">确认落子</button>
            <button class="btn" type="button" id="sgfBtnMobileCancel">取消</button>
          </div>
        </div>`;
        confirmSlot.querySelector('#sgfBtnMobileConfirm')?.addEventListener('click', () => {
          const res = trialSession.playMove(pt.x, pt.y);
          if (res.success) setMessage(res.replaced ? '落子成功（已替换原有后续试下）。' : '');
          else setMessage(res.reason, 'error');
          renderPosition();
        });
        confirmSlot.querySelector('#sgfBtnMobileCancel')?.addEventListener('click', () => {
          trialSession.pendingMobilePoint = null;
          setMessage('');
          renderPosition();
        });
        // 触控落点后把确认区带入视野，但不自动落子，也不改变原确认流程。
        requestAnimationFrame(() => {
          confirmSlot.querySelector('#sgfMobileConfirmBar')?.scrollIntoView({block: 'nearest'});
        });
      } else {
        confirmSlot.replaceChildren();
      }
    }
  }

  function renderPosition(options = {}) {
    if (trialSession) {
      renderTrialPosition();
      return;
    }
    const state = navigator.stateAt(nodeId);
    const node = data.sgf.tree.nodes[nodeId];
    const bounds = navigator.currentPathBounds(nodeId);
    const originInfo = navigator.branchOriginInfo(nodeId);

    renderBoard(state);

    const input = panel.querySelector('#sgfMoveInput');
    if (input && document.activeElement !== input) {
      input.value = state.moveNumber;
      input.max = bounds.maxMove;
    }

    // Progress bar synchronization
    const progressBar = panel.querySelector('#sgfProgressBar');
    if (progressBar && document.activeElement !== progressBar) {
      progressBar.max = bounds.maxMove;
      progressBar.value = state.moveNumber;
    }
    if (progressBar) progressBar.style.setProperty('--progress-pct', `${bounds.maxMove ? state.moveNumber / bounds.maxMove * 100 : 0}%`);
    const progressCurrent = panel.querySelector('#sgfProgressCurrent');
    if (progressCurrent) progressCurrent.textContent = state.moveNumber;
    const progressTotal = panel.querySelector('#sgfProgressTotal');
    if (progressTotal) progressTotal.textContent = bounds.maxMove;
    const progressBadge = panel.querySelector('#sgfProgressBadge');
    if (progressBadge) {
      progressBadge.textContent = bounds.isMainline ? '实战主线' : '变化分支';
      progressBadge.className = `sgf-progress-badge ${bounds.isMainline ? 'badge-mainline' : 'badge-branch'}`;
    }

    const heading = panel.querySelector('#sgfCurrentHeading');
    if (heading) heading.textContent = '局面';
    const nextLabel = panel.querySelector('#sgfNextLabel');
    if (nextLabel) nextLabel.textContent = `下一手：${state.toMove === 'B' ? '黑方' : '白方'}`;

    const moveDetail = panel.querySelector('#sgfMoveDetail');
    if (moveDetail) {
      if (state.moveNumber === 0) {
        moveDetail.textContent = '开局初始局面' + (navigator.handicap >= 2 ? `（让 ${navigator.handicap} 子）` : '');
      } else if (state.lastMove?.pass) {
        moveDetail.textContent = `本手：${state.lastMove.colour === 'B' ? '黑方' : '白方'} 停一手`;
      } else if (state.lastMove) {
        const coord = engine.coordinate(data.sgf.board_size, state.lastMove.x, state.lastMove.y);
        moveDetail.textContent = `本手：${state.lastMove.colour === 'B' ? '黑' : '白'} ${coord}${node?.name ? ' · ' + node.name : ''}`;
      } else {
        moveDetail.textContent = node?.name || '初始局面';
      }
    }

    const branchBadge = panel.querySelector('#sgfBranchBadge');
    if (branchBadge) {
      const childCount = (node?.children || []).length;
      if (childCount > 1) {
        branchBadge.hidden = false;
        branchBadge.textContent = '· ' + childCount + ' 变化';
      } else {
        branchBadge.hidden = true;
      }
    }

    const errorBanner = panel.querySelector('#sgfErrorBanner');
    if (errorBanner) {
      if (state.error) {
        errorBanner.hidden = false;
        errorBanner.textContent = `棋谱解析受阻（节点 ${state.errorNode || nodeId}）：${state.error}`;
      } else {
        errorBanner.hidden = true;
      }
    }

    const comment = panel.querySelector('#sgfNodeComment');
    if (comment) {
      comment.textContent = node?.comment || '暂无解说或评论。';
      comment.classList.toggle('empty', !node?.comment);
    }

    const path = panel.querySelector('#sgfPathStatus');
    if (path) {
      const previousMove = node?.move;
      const nextChild = node?.children?.[0] ? data.sgf.tree.nodes[node.children[0]] : null;
      let text = state.error
        ? `停止（节点 ${state.errorNode || '未知'}）：${state.error} 当前只显示错误前的可靠局面。`
        : previousMove?.pass ? `本手停一手；下一手：${state.toMove === 'B' ? '黑' : '白'}。`
        : previousMove ? `本手：${previousMove.color === 'B' ? '黑' : '白'} ${engine.coordinate(data.sgf.board_size, previousMove.x, previousMove.y)}；下一手：${state.toMove === 'B' ? '黑' : '白'}。`
        : state.moveNumber === 0 ? `开局；下一手：${state.toMove === 'B' ? '黑' : '白'}。`
        : state.lastMove ? `本手：${state.lastMove.colour === 'B' ? '黑' : '白'} ${state.lastMove.pass ? '停一手' : engine.coordinate(data.sgf.board_size, state.lastMove.x, state.lastMove.y)}；下一手：${state.toMove === 'B' ? '黑' : '白'}。`
        : `开局；下一手：${state.toMove === 'B' ? '黑' : '白'}。`;
      if (!state.error && nextChild?.move?.pass) text += ' 下一节点为停一手。';
      if (originInfo.isMainline) {
        text += ` 实战主线 · 共 ${bounds.maxMove} 手 · 当前第 ${state.moveNumber} 手。`;
      } else {
        text += ` 变化分支（从第 ${originInfo.branchedAtMove} 手分出 · ${originInfo.branchLabel}） · 共 ${bounds.maxMove} 手 · 当前第 ${state.moveNumber} 手。`;
      }
      path.textContent = text;
      path.classList.toggle('error', !!state.error);
    }

    const candidates = navigator.candidateMoves(nodeId);
    const branches = panel.querySelector('#sgfBranches');
    if (branches) {
      if (candidates.length > 1) {
        branches.hidden = false;
        branches.innerHTML = `<h4>选择变化（${candidates.length} 个分支）</h4>
          <div class="sgf-branch-buttons">${candidates.map(c => `
            <button class="btn sgf-branch-btn ${c.isChosen ? 'active' : ''} ${c.isMainline ? 'branch-mainline' : ''}" type="button" data-sgf-branch="${E(c.childId)}" title="${E(c.comment || '')}">
              <span class="sgf-branch-letter">${c.letter}</span>
              <span class="sgf-branch-name">${E(c.label)}</span>
              ${c.isMainline ? '<span class="sgf-branch-tag">实战</span>' : ''}
            </button>`).join('')}</div>`;
        branches.querySelectorAll('[data-sgf-branch]').forEach(button => {
          button.addEventListener('click', () => {
            selectBranchAndAdvance(button.dataset.sgfBranch);
          });
        });
      } else {
        branches.hidden = true;
        branches.replaceChildren();
      }
    }

    // Variation tree breadcrumb
    const treeCard = panel.querySelector('#sgfTreeCard');
    const treeBody = panel.querySelector('#sgfTreeBody');
    const treePill = panel.querySelector('#sgfTreePill');
    if (treePill) {
      treePill.textContent = originInfo.isMainline ? '实战主线' : `分支（第${originInfo.branchedAtMove}手）`;
      treePill.className = `sgf-tree-pill ${originInfo.isMainline ? 'pill-mainline' : 'pill-branch'}`;
    }
    if (treeCard && treeBody) {
      const breadcrumbs = navigator.variationBreadcrumb(nodeId);
      treeBody.innerHTML = `<div class="sgf-tree-crumbs">${breadcrumbs.map((crumb, idx) => `
        <div class="sgf-crumb-node ${crumb.isCurrent ? 'crumb-active' : ''} ${crumb.isFork ? 'crumb-fork' : ''}">
          <button type="button" class="sgf-crumb-btn" data-sgf-goto="${crumb.id}" title="${E(crumb.name || crumb.comment || '')}">
            <span class="crumb-idx">${crumb.moveNumber > 0 ? crumb.moveNumber : '开局'}</span>
            <span class="crumb-label">${E(crumb.label)}</span>
            ${crumb.childCount > 1 ? `<span class="crumb-badge">${crumb.childCount}分支</span>` : ''}
          </button>
          ${idx < breadcrumbs.length - 1 ? '<span class="crumb-arrow">➔</span>' : ''}
        </div>
      `).join('')}</div>`;
      treeBody.querySelectorAll('[data-sgf-goto]').forEach(btn => {
        btn.addEventListener('click', () => {
          stopAutoplay();
          nodeId = btn.dataset.sgfGoto;
          setMessage('');
          renderPosition();
        });
      });
    }

    const controls = {
      start: nodeId === bounds.openingNodeId,
      prev: !navigator.previous(nodeId),
      next: !navigator.next(nodeId) || !!state.error,
      end: !navigator.next(nodeId) || !!state.error,
      jump: !!state.error,
      fork: !navigator.nearestFork(nodeId) || !!state.error,
      mainline: bounds.isMainline || !!state.error,
    };
    for (const button of panel.querySelectorAll('[data-sgf-nav]')) {
      if (button.dataset.sgfNav in controls) button.disabled = controls[button.dataset.sgfNav];
    }
    updateAutoplayUi();
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || ''), comma = result.indexOf(',');
        if (comma < 0) reject(new Error('无法读取文件。')); else resolve(result.slice(comma + 1));
      };
      reader.onerror = () => reject(new Error('无法读取文件。'));
      reader.readAsDataURL(file);
    });
  }

  async function prepareFile(file, encoding = '') {
    if (!file) return;
    if (file.size > 2_000_000) { setMessage('SGF 文件大小不能超过 2 MB。', 'error'); return; }
    if (!canEdit()) { setMessage('请先开启编辑模式。', 'error'); return; }
    pendingFile = {name: file.name, file, base64: await fileToBase64(file)};
    previewEncoding = encoding;
    setMessage('正在解析 SGF 并读取数据库对局…');
    try {
      preview = await api('/api/sgf/preview', {
        match_id: matchId, filename: file.name, content_base64: pendingFile.base64,
        encoding: encoding || undefined,
      });
      message = ''; setMessage('');
      panel.querySelector('.sgf-empty')?.setAttribute('hidden', '');
      renderPreview();
    } catch (error) {
      preview = null;
      panel.querySelector('.sgf-empty')?.setAttribute('hidden', '');
      const candidates = error.data?.candidates || [];
      panel.querySelector('#sgfImportArea').innerHTML = `<section class="sgf-preview">
        <h4>无法解析或预览</h4><p class="sgf-error-text">${E(error.message)}</p>
        ${candidates.length ? `<label class="sgf-note-label">手动选择编码<select id="sgfEncodingRetry">${candidates.map(item => `<option value="${E(item)}">${E(item)}</option>`).join('')}</select></label>
          <button class="btn" type="button" id="sgfRetryEncoding">按所选编码重新预览</button>` : ''}
        <button class="btn" type="button" id="sgfCancelPreview">取消</button></section>`;
      panel.querySelector('#sgfCancelPreview')?.addEventListener('click', clearPreview);
      panel.querySelector('#sgfRetryEncoding')?.addEventListener('click', () => {
        const value = panel.querySelector('#sgfEncodingRetry')?.value;
        if (value) prepareFile(file, value);
      });
    }
  }

  function statusLabel(status) {
    return status === 'match' ? '一致' : status === 'mismatch' ? '不一致' : '未载，无法比较';
  }

  function renderPreview() {
    if (!preview) return;
    const area = panel.querySelector('#sgfImportArea');
    const comparison = preview.comparison || {comparisons: [], mismatches: []};
    const warnings = preview.sgf?.warnings || [];
    const encoding = preview.sgf?.encoding || {};
    const candidates = encoding.candidates || [];
    const existing = preview.existing;
    const duplicate = preview.file_duplicate || preview.duplicate;
    const relationship = preview.relationship || {kind: 'new', message: ''};
    const sameGame = preview.same_game || {versions: [], linked_other: []};
    const prefixes = preview.prefix || [];
    const blocked = !preview.can_write;
    const fileReuse = relationship.kind === 'file_reuse';
    const heading = fileReuse ? '无需导入' : preview.action === 'version' ? '确认后保存为新版本并设为当前'
      : preview.action === 'replace' ? '确认后将替换当前棋谱' : '确认后将新增棋谱关联';
    const actionText = fileReuse ? '已有相同文件，无需导入'
      : preview.action === 'version' ? '保存为新版本并设为当前'
      : preview.action === 'replace' ? '确认替换并关联' : '确认导入并关联';
    const matchLine = item => `${item.short_name}${M.editionLabel(item)} · ${item.round_name} · ${item.black || '待定'} / ${item.white || '待定'}`;
    const otherMatches = relationship.linked_other || [];
    const versionLines = (sameGame.versions || []).map(item =>
      `<li>${E(item.filename)} · ${E(item.main_line_moves)}手 · ${item.is_current ? '当前' : '历史版本'}${item.linked_other?.length ? ` · 另关联：${item.linked_other.map(matchLine).join('；')}` : ''}</li>`).join('');
    const prefixLines = prefixes.map(item => `<li>${E(item.filename)} · ${E(item.main_line_moves)}手 · ${item.relation === 'prefix_left' ? '本文件是它的前缀' : '它是本文件的前缀'}</li>`).join('');
    area.innerHTML = `<section class="sgf-preview">
      <div class="sgf-preview-head"><h4>关联预览</h4><span>${E(heading)}</span></div>
      <p class="sgf-target"><strong>目标：</strong>${E(preview.match.label)}<br><strong>SGF：</strong>${E(preview.sgf.filename)} · ${E(preview.sgf.board_size)}路 · 主线 ${E(preview.sgf.stats.main_line_moves)} 手 · 编码 ${E(encoding.value)}（${E(encoding.source)}）</p>
      ${existing ? `<p class="sgf-footnote">当前棋谱：${E(existing.filename)}（${E(existing.main_line_moves)}手）。${preview.action === 'version' ? '旧版本原文仍保留，可在版本选择中切换浏览。' : '替换后旧原文仍保留，可通过修改历史撤销。'}</p>` : ''}
      <div class="sgf-dedup ${E(relationship.kind || 'new')}">
        <strong>去重判断</strong><p>${E(relationship.message || '')}</p>
        ${otherMatches.length ? `<div class="sgf-dedup-other"><b>该棋谱已关联其他对局</b><ul>${otherMatches.map(item => `<li>${E(matchLine(item))}</li>`).join('')}</ul><p>系统不会自动迁移或删除原关联；请确认本次归属。</p></div>` : ''}
        ${versionLines ? `<div class="sgf-version-list"><b>同局已有版本</b><ul>${versionLines}</ul></div>` : ''}
        ${prefixLines ? `<div class="sgf-version-list"><b>疑似同局的不完整版本</b><ul>${prefixLines}</ul></div>` : ''}
      </div>
      <div class="sgf-compare" role="table" aria-label="SGF与数据库资料比较">
        ${comparison.comparisons.map(item => `<div class="sgf-compare-row ${item.status}" role="row"><span>${E(item.label)}</span><span>SGF：${E(item.sgf)}</span><span>数据库：${E(item.database)}</span><strong>${E(statusLabel(item.status))}</strong></div>`).join('')}
      </div>
      ${comparison.mismatches.length ? `<div class="sgf-mismatch"><strong>需要核对的不一致</strong><ul>${comparison.mismatches.map(item => `<li>${E(item.message)}</li>`).join('')}</ul><p>不会自动覆盖数据库姓名、执色、日期或赛果。确认关联只保存棋谱原文与关联。</p></div>` : '<p class="sgf-ok">未发现姓名、日期或赛果的明确不一致。</p>'}
      ${warnings.length ? `<details class="sgf-preview-warnings" open><summary>解析警告 ${warnings.length} 条</summary><ul>${warnings.map(item => `<li>${E(item.message)}</li>`).join('')}</ul></details>` : ''}
      ${candidates.length && !encoding.confident ? `<label class="sgf-note-label">当前编码不确定，可手动选择后重新预览<select id="sgfEncodingChoice">${candidates.map(item => `<option value="${E(item)}" ${item === encoding.value ? 'selected' : ''}>${E(item)}</option>`).join('')}</select></label><button class="btn" type="button" id="sgfRepreview">按所选编码重新预览</button>` : ''}
      <label class="sgf-note-label">关联说明${preview.requires_note ? '（存在不一致、同局版本或疑似重复，必填）' : '（可选）'}<textarea id="sgfImportNote" rows="3" maxlength="2000" placeholder="例如：SGF 中姓名使用棋手原文，已按别名核对。"></textarea></label>
      ${preview.requires_confirmation ? `<label class="sgf-confirm"><input id="sgfConfirmWarnings" type="checkbox"> 我已查看上述警告、同局版本或其他关联，仍确认按当前操作保存；不自动修改比赛资料。</label>` : ''}
      ${blocked ? `<p class="sgf-protected">${preview.protected?.locked ? '本局按用户指定保留，不能写入棋谱关联。' : fileReuse ? '相同文件已关联本局，可直接复用，不新增版本。' : '本局已有关联或当前状态不允许再次导入。'}</p>` : ''}
      <div class="sgf-preview-actions"><button class="btn btn-gold" type="button" id="sgfConfirmImport" ${blocked ? 'disabled' : ''}>${E(actionText)}</button><button class="btn" type="button" id="sgfCancelPreview">取消</button></div>
      <p class="sgf-message" id="sgfPreviewMessage" role="status" aria-live="polite"></p>
    </section>`;
    const rePreview = () => {
      const choice = panel.querySelector('#sgfEncodingChoice')?.value;
      if (pendingFile?.file) prepareFile(pendingFile.file, choice || '');
    };
    panel.querySelector('#sgfRepreview')?.addEventListener('click', rePreview);
    panel.querySelector('#sgfCancelPreview')?.addEventListener('click', clearPreview);
    const confirm = panel.querySelector('#sgfConfirmImport');
    const checkbox = panel.querySelector('#sgfConfirmWarnings');
    const note = panel.querySelector('#sgfImportNote');
    const guard = () => {
      const problem = preview.requires_confirmation && !checkbox?.checked ? '请勾选确认已核对警告或差异。'
        : preview.requires_note && !note?.value.trim() ? '存在不一致或疑似重复，请填写关联说明。' : '';
      if (confirm) confirm.disabled = blocked || !!problem;
      panel.querySelector('#sgfPreviewMessage').textContent = problem;
      return !problem;
    };
    checkbox?.addEventListener('change', guard); note?.addEventListener('input', guard); guard();
    confirm?.addEventListener('click', async () => {
      if (!guard() || importing) return;
      importing = true; confirm.disabled = true;
      panel.querySelector('#sgfPreviewMessage').textContent = '正在写入原文、解析结果与关联…';
      try {
        const response = await api('/api/sgf/import', {
          match_id: matchId, action: preview.action, expected_revision: preview.link_revision,
          filename: pendingFile.name, content_base64: pendingFile.base64,
          encoding: previewEncoding || undefined, note: note.value,
          confirm_warnings: !!checkbox?.checked,
        });
        importing = false;
        preview = null; pendingFile = null;
        patchLocalSgf(matchId, response.sgf);
        message = response.message || '棋谱已保存。';
        await load(matchId); updateTabLabel();
        if (response.refresh_pending) renderSyncRetry();
        setMessage(message, response.refresh_pending ? 'error' : 'ok');
      } catch (error) {
        importing = false; confirm.disabled = false;
        panel.querySelector('#sgfPreviewMessage').textContent = error.message;
        if (error.data?.preview) preview = error.data.preview;
      }
    });
  }

  function renderSyncRetry() {
    const area = panel.querySelector('#sgfImportArea');
    if (!area || area.querySelector('[data-sgf-sync]')) return;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'btn'; button.dataset.sgfSync = '1'; button.textContent = '重试页面同步';
    button.addEventListener('click', async () => {
      button.disabled = true; button.textContent = '正在重新同步…';
      try {
        const response = await fetch('/api/sync', {method: 'POST', cache: 'no-store',
          headers: {'X-Editor-Token': token(), 'X-Viewer-Compact': 'players-v1'}});
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || '页面同步失败。');
        button.remove(); setMessage('页面资料已重新同步；棋谱原文与关联没有重复写入。', 'ok');
      } catch (error) { button.disabled = false; button.textContent = '重试页面同步'; setMessage('页面同步失败：' + error.message, 'error'); }
    });
    area.append(button);
  }

  function clearPreview() {
    preview = null; pendingFile = null; previewEncoding = '';
    message = '';
    if (!data?.sgf) { renderShell(); return; }
    const area = panel.querySelector('#sgfImportArea');
    if (area) area.replaceChildren();
    setMessage('');
  }

  function renderUnlink() {
    if (!showUnlink) return;
    const area = panel.querySelector('#sgfImportArea');
    area.innerHTML = `<section class="sgf-preview"><h4>解除当前棋谱关联</h4>
      <p>解除后本局显示“暂无棋谱”，棋谱原文与关联版本仍保留；可通过修改历史撤销。不会删除原文。</p>
      <label class="sgf-note-label">解除说明（可选）<textarea id="sgfUnlinkNote" rows="2" maxlength="2000"></textarea></label>
      <div class="sgf-preview-actions"><button class="btn btn-danger" type="button" id="sgfConfirmUnlink">确认解除关联</button><button class="btn" type="button" id="sgfCancelUnlink">取消</button></div>
      <p class="sgf-message" id="sgfUnlinkMessage" role="status" aria-live="polite"></p></section>`;
    panel.querySelector('#sgfCancelUnlink').addEventListener('click', () => { showUnlink = false; area.replaceChildren(); });
    panel.querySelector('#sgfConfirmUnlink').addEventListener('click', async event => {
      event.target.disabled = true; panel.querySelector('#sgfUnlinkMessage').textContent = '正在解除关联…';
      try {
        const response = await api('/api/sgf/unlink', {match_id: matchId,
          expected_revision: data.link_revision, note: panel.querySelector('#sgfUnlinkNote').value});
        showUnlink = false; patchLocalSgf(matchId, response.sgf);
        message = response.message; await load(matchId); updateTabLabel();
        if (response.refresh_pending) renderSyncRetry();
        setMessage(message, response.refresh_pending ? 'error' : 'ok');
      } catch (error) {
        event.target.disabled = false;
        panel.querySelector('#sgfUnlinkMessage').textContent = error.message;
      }
    });
  }

  function patchLocalSgf(id, summary) {
    // 当前届次优先；本地按需模式只保留已载入的少数届次，不做整库遍历假设。
    const store = window.ALL_TOURNAMENTS_DATA || {};
    const currentId = window.GoViewerNavigate?.currentEdition?.() || '';
    const editions = currentId && store[currentId] ? [store[currentId]] : [];
    for (const [editionId, edition] of Object.entries(store)) {
      if (editionId !== currentId) editions.push(edition);
    }
    for (const edition of editions) {
      for (const round of edition.rounds || []) {
        const match = (round.matches || []).find(item => item.id === id);
        if (!match) continue;
        if (summary?.present) match.sgf = summary; else delete match.sgf;
        const localGame = games.find(item => item.id === id);
        if (localGame) { if (summary?.present) localGame.sgf = summary; else delete localGame.sgf; }
        return;
      }
    }
  }

  document.getElementById('matchTabInfo')?.addEventListener('click', () => selectTab('info'));
  document.getElementById('matchTabSgf')?.addEventListener('click', () => selectTab('sgf'));
  dialog.addEventListener('click', event => {
    const button = event.target.closest('[data-sgf-open]');
    if (button) { matchId = button.dataset.sgfOpen; selectTab('sgf'); }
  });
  dialog.addEventListener('cancel', event => {
    if (GoViewerSgfFind.isActive()) {
      event.preventDefault();
      GoViewerSgfFind.exit();
      return;
    }
    if (trialSession && trialSession.pendingMobilePoint) {
      event.preventDefault();
      trialSession.pendingMobilePoint = null;
      renderPosition();
      return;
    }
    if (focusMode) {
      event.preventDefault();
      exitFocusMode();
      return;
    }
    if (trialSession && trialSession.hasTrialMoves()) {
      event.preventDefault();
      if (confirm('当前有未保存的试下落子，关闭将丢弃试下。是否确认离开？')) {
        trialSession = null;
        dialog.close();
      }
      return;
    }
  });

  window.addEventListener('beforeunload', event => {
    if (trialSession && trialSession.hasTrialMoves()) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && isPlaying) stopAutoplay();
  });
  window.addEventListener('blur', () => {
    if (isPlaying) stopAutoplay();
  });

  dialog.addEventListener('pointerdown', event => {
    const settings = panel.querySelector('.sgf-settings[open]');
    if (settings && !settings.contains(event.target)) settings.open = false;
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && dialog.open && !panel.hidden) {
      const settings = panel.querySelector('.sgf-settings[open]');
      if (settings) {
        event.preventDefault();
        event.stopPropagation();
        settings.open = false;
        settings.querySelector('summary').focus();
        return;
      }
    }
    if ((event.key === 'PageUp' || event.key === 'PageDown') && dialog.open && !panel.hidden && data?.sgf && !trialSession) {
      const tag = (event.target.tagName || '').toLowerCase();
      if (!['input', 'textarea', 'select'].includes(tag) && !event.target.isContentEditable) {
        event.preventDefault();
        navigate(event.key === 'PageUp' ? 'fast-prev' : 'fast-next');
        return;
      }
    }
    if (event.key === 'Escape' && GoViewerSgfFind.isActive()) {
      event.preventDefault();
      event.stopPropagation();
      GoViewerSgfFind.exit();
      return;
    }
    // Spacebar toggles autoplay if focused appropriately
    if (event.key === ' ' || event.code === 'Space') {
      const target = event.target;
      const tag = (target.tagName || '').toLowerCase();
      const isTextInput = target.closest('.sgf-settings') || (tag === 'textarea') || (tag === 'select') || target.isContentEditable ||
        (tag === 'input' && !['button', 'submit', 'reset', 'checkbox', 'radio', 'range'].includes(target.type));
      if (!isTextInput) {
        if (dialog.open && !panel.hidden && data?.sgf) {
          if (trialSession) {
            // Autoplay is disabled in trial mode
            return;
          }
          event.preventDefault();
          toggleAutoplay();
          return;
        }
      }
    }
    if (event.key === 'Escape') {
      // 1. Cancel pending mobile point in trial mode
      if (trialSession && trialSession.pendingMobilePoint) {
        event.preventDefault();
        event.stopPropagation();
        trialSession.pendingMobilePoint = null;
        setMessage('已取消待确认落点。');
        renderPosition();
        return;
      }

      // 2. Focus mode exit (preserves trial session!)
      if (focusMode) {
        const openDialogs = Array.from(document.querySelectorAll('dialog[open]'));
        const topDialog = openDialogs[openDialogs.length - 1];
        if (topDialog && topDialog !== dialog) return;
        event.preventDefault();
        event.stopPropagation();
        exitFocusMode();
        return;
      }

      // 3. Normal mode: if trial has moves, confirm discard
      if (trialSession && trialSession.hasTrialMoves()) {
        event.preventDefault();
        event.stopPropagation();
        if (confirm('当前有未保存的试下落子，关闭将丢弃试下。是否确认离开？')) {
          trialSession = null;
          dialog.close();
        }
        return;
      }
    }
    if (!dialog.open || panel.hidden || !navigator) return;
    const target = event.target;

    if (trialSession) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        trialUndo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        trialRedo();
        return;
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        if (!target.closest('input,textarea,select,[contenteditable="true"]')) {
          event.preventDefault();
          const cur = trialSession.keyboardCursor || { x: 0, y: 0 };
          const sz = trialSession.boardSize;
          let nx = cur.x, ny = cur.y;
          if (event.key === 'ArrowUp') ny = Math.max(0, ny - 1);
          if (event.key === 'ArrowDown') ny = Math.min(sz - 1, ny + 1);
          if (event.key === 'ArrowLeft') nx = Math.max(0, nx - 1);
          if (event.key === 'ArrowRight') nx = Math.min(sz - 1, nx + 1);
          trialSession.keyboardCursor = { x: nx, y: ny };
          renderPosition();
          return;
        }
      }
      if (event.key === 'Enter') {
        if (!target.closest('input,textarea,select,button,[contenteditable="true"]')) {
          event.preventDefault();
          if (trialSession.pendingMobilePoint) {
            const pt = trialSession.pendingMobilePoint;
            const res = trialSession.playMove(pt.x, pt.y);
            if (res.success) setMessage(res.replaced ? '落子成功（已替换原有后续试下）。' : '');
            else setMessage(res.reason, 'error');
            renderPosition();
          } else if (trialSession.keyboardCursor) {
            const res = trialSession.playMove(trialSession.keyboardCursor.x, trialSession.keyboardCursor.y);
            if (res.success) setMessage(res.replaced ? '落子成功（已替换原有后续试下）。' : '');
            else setMessage(res.reason, 'error');
            renderPosition();
          }
          return;
        }
      }
      return; // Do not process normal SGF navigation keys in trial mode
    }

    if (target.closest('input,textarea,select,[contenteditable="true"]') || event.ctrlKey || event.metaKey || event.altKey) return;
    const actions = {ArrowLeft: 'prev', ArrowRight: 'next', Home: 'start', End: 'end'};
    if (!(event.key in actions)) return;
    event.preventDefault(); navigate(actions[event.key]);
  });

find.init({
  engine, escape: E,
  panel: () => panel,
  getNavigator: () => navigator,
  getData: () => data,
  getNodeId: () => nodeId,
  setNodeId: (id) => { nodeId = id; },
  setMessage,
  stopAutoplay,
  hasTrialMoves: () => !!(trialSession && trialSession.hasTrialMoves()),
  exitTrial: (force) => exitTrialMode(force),
  confirmExitTrial: (message) => confirm(message),
  clearMainlineFollow: () => { mainlineFollowConfirmed = false; },
  renderShell,
  renderPosition,
});

  window.GoViewerSgf = {updateMatchDialog, syncGames, selectTab, load, reset, openStudy,
    context: () => ({matchId, loadedFor, hasData: !!data, tabActive: !panel.hidden}),
    openMatch: id => { matchId = id; selectTab('sgf'); }};
})();
