/* SGF 按落点查找（P5.5 提取）：状态所有权归本模块；宿主面板通过 init(adapter) 表达依赖。
 * 只列出当前路径上发生在该交叉点的着手，不改变局面、不自动落子；与研究试下互斥。
 * 宿主适配器键：engine, escape, panel(), getNavigator(), getData(), getNodeId(), setNodeId(id),
 * setMessage(text, kind), stopAutoplay(), hasTrialMoves(), exitTrial(force),
 * confirmExitTrial(message), clearMainlineFollow(), renderShell(), renderPosition()。 */
(function () {
'use strict';

let host = null;
let findMode = false, findPoint = null, findResults = [], findCoordText = '';

function init(adapter) { host = adapter; }
function isActive() { return findMode; }
function reset() { findMode = false; findPoint = null; findResults = []; findCoordText = ''; }

  function findResultsHtml() {
    if (!findMode) return '';
    if (!findPoint) return '<p class="sgf-find-empty">尚未选择落点。</p>';
    const coord = host.engine.coordinate(host.getData()?.sgf?.board_size || 19, findPoint.x, findPoint.y);
    if (!findResults.length) {
      return `<p class="sgf-find-empty">${host.escape(coord)} 在当前路径中没有着手；查找不会自动落子。</p>`;
    }
    return `<ol class="sgf-find-list" aria-label="该落点的着手">${findResults.map(entry => `
      <li><button type="button" class="sgf-find-item${entry.id === host.getNodeId() ? ' active' : ''}" data-find-node="${host.escape(entry.id)}">
        <span class="sgf-find-move">第 ${entry.number} 手 · ${entry.color === 'B' ? '黑' : '白'}</span>
        <span class="sgf-find-coord">${host.escape(coord)}</span>
        <span class="sgf-find-comment">${host.escape((entry.comment || '无解说').slice(0, 60))}</span>
      </button></li>`).join('')}</ol>`;
  }

  function findPanelHtml() {
    if (!findMode) return '';
    const coord = findPoint ? host.engine.coordinate(host.getData()?.sgf?.board_size || 19, findPoint.x, findPoint.y) : '';
    const summary = findPoint
      ? (findResults.length ? `${coord} · ${findResults.length} 个结果` : `${coord} · 没有着手`)
      : '尚未选择落点';
    return `<section class="sgf-find-panel" id="sgfFindPanel" aria-label="按落点查找着手">
      <div class="sgf-find-bar">
        <strong>查找着手</strong>
        <span class="sgf-find-hint">点击棋盘交叉点或输入坐标；只列出当前路径的着手，不会自动落子。</span>
        <button class="btn" id="sgfFindExit" type="button">退出查找</button>
      </div>
      <div class="sgf-find-tools">
        <label>坐标 <input id="sgfFindCoord" type="text" value="${host.escape(findCoordText)}" placeholder="如 Q16" autocomplete="off" spellcheck="false" aria-label="输入坐标查找着手"></label>
        <button class="btn" id="sgfFindGo" type="button">查找</button>
        <span class="sgf-find-status" id="sgfFindStatus" role="status" aria-live="polite">${host.escape(summary)}</span>
      </div>
      <div class="sgf-find-results" id="sgfFindResults">${findResultsHtml()}</div>
    </section>`;
  }

  function setFindStatus(text, kind = '') {
    const element = host.panel().querySelector('#sgfFindStatus');
    if (element) { element.textContent = text; element.className = 'sgf-find-status ' + kind; }
  }

  function pointFromText(text) {
    const size = host.getData()?.sgf?.board_size;
    if (!size) return null;
    const match = /^([A-HJ-Ta-hj-t])\s*(\d{1,2})$/.exec(String(text || '').trim());
    if (!match) return null;
    const x = host.engine.COLUMNS.indexOf(match[1].toUpperCase());
    const y = size - Number(match[2]);
    if (x < 0 || y < 0 || y >= size) return null;
    return {x, y};
  }

  function searchFindPoint(x, y) {
    if (!navigator || !host.getData()?.sgf) return;
    findPoint = {x, y};
    findCoordText = host.engine.coordinate(host.getData().sgf.board_size, x, y);
    const path = host.getNavigator().pathTo(host.getNodeId());
    const results = [];
    for (const id of path) {
      const move = host.getNavigator().nodes[id]?.move;
      if (!move || move.pass || move.x !== x || move.y !== y) continue;
      let number = 0;
      try { number = host.getNavigator().stateAt(id).moveNumber; } catch (_) { number = 0; }
      results.push({id, color: move.color, number, comment: host.getNavigator().nodes[id]?.comment || ''});
    }
    findResults = results;
    const resultsEl = host.panel().querySelector('#sgfFindResults');
    if (resultsEl) resultsEl.innerHTML = findResultsHtml();
    const input = host.panel().querySelector('#sgfFindCoord');
    if (input) input.value = findCoordText;
    setFindStatus(results.length ? `${findCoordText} · ${results.length} 个结果` : `${findCoordText} · 没有着手`, results.length ? '' : 'error');
  }

  function jumpToFindResult(id) {
    if (!id || !host.getNavigator()?.nodes?.[id]) return;
    host.stopAutoplay();
    host.clearMainlineFollow();
    host.setNodeId(id);
    host.setMessage(`已定位到第 ${(() => { try { return host.getNavigator().stateAt(id).moveNumber; } catch (_) { return ''; } })()} 手。`);
    host.renderPosition();
    const resultsEl = host.panel().querySelector('#sgfFindResults');
    if (resultsEl) resultsEl.innerHTML = findResultsHtml();
  }

  function enterFindMode() {
    if (!navigator || !host.getData()?.sgf) { host.setMessage('当前没有可查找的棋谱。', 'info'); return; }
    if (host.hasTrialMoves() && !host.confirmExitTrial('查找着手会退出试下研究，未保存的试下落子将丢弃。是否继续？')) return;
    host.exitTrial(true);
    host.stopAutoplay();
    findMode = true;
    findPoint = null;
    findResults = [];
    findCoordText = '';
    host.renderShell();
    host.setMessage('查找着手：点击棋盘交叉点，或输入坐标（如 Q16）。');
    host.panel().querySelector('#sgfFindCoord')?.focus();
  }

  function exitFindMode() {
    if (!findMode) return;
    findMode = false;
    findPoint = null;
    findResults = [];
    findCoordText = '';
    host.renderShell();
    host.setMessage('');
  }

  // 便捷入口（宿主薄转发用）
  function toggle() { if (findMode) exitFindMode(); else enterFindMode(); }
  function exitIfActive() { if (findMode) exitFindMode(); }
  function submitCoordText(text) {
    const point = pointFromText(text);
    if (!point) {
      setFindStatus('坐标格式应为 A—T 与 1—19，例如 Q16。', 'error');
      host.panel().querySelector('#sgfFindCoord')?.focus();
      return;
    }
    searchFindPoint(point.x, point.y);
  }

  window.GoViewerSgfFind = {init, reset, isActive, toggle, exitIfActive, exit: exitFindMode,
                            enter: enterFindMode, panelHtml: findPanelHtml, html: findResultsHtml,
                            setFindStatus, submitCoordText, search: searchFindPoint, jump: jumpToFindResult};
})();
