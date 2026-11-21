/* 人物档案抽屉（P5.4 提取）：渲染职责归本模块；数据状态所有权在 viewer.js，
 * 经 init({sources}) 适配器在每次打开时读取最新数据（保存刷新后抽屉原地把关）。
 * 公开行为不变：window.showPlayer 名称保留，抽屉 DOM 与内嵌编辑、核查信息及等级分走势加载。 */
(function () {
'use strict';

const M = window.GoViewerModel;
const esc = M.escape;
const getFlagSvg = (nat) => window.GoViewerFlags.html(nat);

let host = null;
let drawerStatusMessage = '';
let drawerStatusIsError = false;
function init(adapter) { host = adapter; }

function setDrawerStatus(message, isError = false) {
  drawerStatusMessage = String(message || '').trim();
  drawerStatusIsError = Boolean(isError);
  const el = document.getElementById('drawerRatingStatus');
  if (el) {
    el.textContent = drawerStatusMessage;
    el.classList.toggle('is-error', Boolean(drawerStatusMessage && drawerStatusIsError));
    el.hidden = !drawerStatusMessage;
  } else if (drawerStatusMessage) {
    const notice = document.getElementById('viewerNotice');
    if (notice) notice.textContent = drawerStatusMessage;
  }
  if (drawerStatusMessage) window.GoViewerEditor?.notify?.(drawerStatusMessage);
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

async function loadPlayerRatingSection(pInfo, pName) {
  const container = document.getElementById('playerRatingDrawerSection');
  if (!container) return;

  container.innerHTML = '<div class="drawer-rating-loading">加载中…</div>';

  try {
    const pid = pInfo ? pInfo.id : '';
    const res = await fetch(`/api/ratings/player-profile?player_id=${encodeURIComponent(pid)}&name_zh=${encodeURIComponent(pName)}`);
    if (!res.ok) {
      container.innerHTML = '';
      return;
    }
    const data = await res.json();
    const systems = data.systems || {};
    const sysKeys = Object.keys(systems);

    if (sysKeys.length === 0) {
      if (pInfo && (pInfo.nationality === 'CHN' || pInfo.nationality === 'KOR')) {
        container.innerHTML = `
          <div class="drawer-rating-box">
            <div class="drawer-rating-head">
              <span class="drawer-rating-title">等级分档案</span>
            </div>
            <div class="drawer-rating-empty">暂未收录该棋手的月度等级分记录。</div>
          </div>
        `;
      } else {
        container.innerHTML = '';
      }
      return;
    }

    let primarySys = sysKeys[0];
    if (systems.china && pInfo?.nationality === 'CHN') primarySys = 'china';
    if (systems.korea && pInfo?.nationality === 'KOR') primarySys = 'korea';

    const cand = data.candidate;
    const isEdit = Boolean(window.GoViewerEditor?.enabled());

    let candHtml = '';
    if (cand) {
      if (cand.status === 'approved' || data.is_linked) {
        candHtml = `<span class="badge-approved" title="等级分姓名已审核绑定到此档案">等级分已关联</span>`;
      } else if (cand.status === 'pending') {
        candHtml = `
          <span class="badge-status-pending" title="候选命中待审核">等级分待审核</span>
          ${isEdit && cand.suggested_player_id === pid ? `
            <button class="btn btn-sm btn-gold btn-drawer-bind" type="button" data-name="${esc(cand.player_clean)}">确认绑定此身份</button>
          ` : ''}
        `;
      } else if (cand.status === 'conflict') {
        candHtml = `<span class="badge-conflict" title="多重同名冲突">等级分同名待核</span>`;
      }
    }

    const cardsHtml = sysKeys.map(k => {
      const s = systems[k];
      const lat = s.latest || {};
      const peak = s.peak_rating || {};
      const best = s.best_rank || {};
      return `
        <div class="rating-system-card">
          <div class="rating-sys-header">
            <strong>${esc(s.display_name)}</strong>
            <span class="rating-sys-month">${esc(lat.month_str || '')}</span>
          </div>
          <div class="rating-sys-grid">
            <div class="rating-sys-stat">
              <span class="stat-label">${k === 'goratings' ? '最新排名' : '最新排名'}</span>
              <span class="stat-val font-accent">${lat.rank ? `第 ${lat.rank} 名` : '-'}</span>
            </div>
            <div class="rating-sys-stat">
              <span class="stat-label">${k === 'goratings' ? '最新 WHR' : '最新公示分'}</span>
              <span class="stat-val">${lat.public_rating !== null && lat.public_rating !== undefined ? lat.public_rating.toFixed(1) : '-'}</span>
            </div>
            <div class="rating-sys-stat">
              <span class="stat-label">历史最高分</span>
              <span class="stat-val" title="${esc(peak.month_str || '')}">${peak.public_rating !== null && peak.public_rating !== undefined ? peak.public_rating.toFixed(1) : '-'}</span>
            </div>
            <div class="rating-sys-stat">
              <span class="stat-label">最佳名次</span>
              <span class="stat-val" title="${esc(best.month_str || '')}">${best.rank ? `第 ${best.rank} 名` : '-'}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    const primaryRecent = systems[primarySys]?.recent_history?.slice(-6).reverse() || [];
    let recentRowsHtml = '';
    if (primaryRecent.length > 0) {
      recentRowsHtml = primaryRecent.map(r => `
        <tr>
          <td>${esc(r.month_str)}</td>
          <td><strong>${r.rank ? `第 ${r.rank} 名` : '-'}</strong></td>
          <td>${r.public_rating !== null && r.public_rating !== undefined ? r.public_rating.toFixed(1) : '-'}</td>
          <td>${r.rating_change || '-'}</td>
          <td>${r.rank_change || '-'}</td>
        </tr>
      `).join('');
    }

    container.innerHTML = `
      <div class="drawer-rating-box">
        <div class="drawer-rating-head">
          <span class="drawer-rating-title">等级分档案与走势</span>
          <div class="drawer-rating-actions">
            ${candHtml}
            <button class="btn btn-sm btn-drawer-trend" type="button" data-player="${esc(pName)}" data-sys="${esc(primarySys)}">
              查看全部走势
            </button>
          </div>
        </div>
        <div class="drawer-rating-cards">
          ${cardsHtml}
        </div>
        ${recentRowsHtml ? `
          <div class="drawer-rating-table-wrap">
            <div class="drawer-rating-subhead">近期月度走势（${esc(systems[primarySys].display_name)}）</div>
            <table class="drawer-rating-table">
              <thead>
                <tr>
                  <th>月份</th>
                  <th>名次</th>
                  <th>公示分</th>
                  <th>分值变动</th>
                  <th>名次变动</th>
                </tr>
              </thead>
              <tbody>${recentRowsHtml}</tbody>
            </table>
          </div>
        ` : ''}
      </div>
    `;

    container.querySelector('.btn-drawer-trend')?.addEventListener('click', (e) => {
      const btn = e.currentTarget;
      window.GoViewerRatings?.openPlayer(btn.dataset.player, btn.dataset.sys);
    });

    container.querySelector('.btn-drawer-bind')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      try {
        await apiPost('/api/ratings/candidate/review', {
          player_clean: btn.dataset.name,
          action: 'approve',
          target_player_id: pid
        });
        setDrawerStatus(`已成功绑定等级分姓名【${btn.dataset.name}】至棋手档案【${pName}】！`, false);
        await loadPlayerRatingSection(pInfo, pName);
      } catch (err) {
        setDrawerStatus('绑定失败: ' + err.message, true);
      }
    });

  } catch (err) {
    console.error('加载棋手等级分失败:', err);
    container.innerHTML = '';
  }
}

function show(playerNameOrId) {
  const {indexList, allData, playerList, playerAliases} = host.sources();
  const pInfo = M.findPlayer(playerList, playerNameOrId, playerAliases);
  const pName = pInfo ? pInfo.name_zh : playerNameOrId;

  // Count titles & runner ups in indexList
  const champEditions = pInfo ? indexList.filter(x => M.isWorld(x) && x.champion_id === pInfo.id) : [];
  const runnerEditions = pInfo ? indexList.filter(x => M.isWorld(x) && x.runner_up_id === pInfo.id) : [];
  const otherResults = pInfo ? indexList.filter(x => !M.isWorld(x) && [x.champion_id,x.runner_up_id].includes(pInfo.id)) : [];

  const drawer = document.getElementById("playerDrawer");
  const drawerTitle = document.getElementById("drawerPlayerName");
  const drawerBody = document.getElementById("drawerBody");

  drawerTitle.textContent = `棋手档案 · ${pName}`;
  drawer.dataset.playerId = pInfo?.id || '';
  drawerStatusMessage = '';
  drawerStatusIsError = false;
  drawerBody.innerHTML = `
    ${pInfo?.id ? `<div class="drawer-top-links"><a class="btn player-full-profile-link" href="player.html?id=${encodeURIComponent(pInfo.id)}">查看完整战绩 →</a><a class="btn player-h2h-link" href="head-to-head.html?a=${encodeURIComponent(pInfo.id)}">对手交锋</a></div>` : ''}
    ${pInfo?.id && window.GoViewerEditor?.enabled() ? '<div class="inline-editor-shell"><div id="playerInlineEditor" class="player-inline-editor"></div><div class="inline-editor-actions"><button class="btn btn-gold" type="button" data-inline-save id="playerInlineSave">保存棋手档案</button><span class="editor-help">修改档案不会影响已收录赛事的历史快照。</span></div></div>' : ''}
    <div class="stat-card stat-card--center">
      <div class="drawer-kiin-label">所属代表棋院</div>
      <div class="drawer-kiin-value">${getFlagSvg(pInfo?.nationality)} ${esc(pInfo?.default_kiin || '—')} · ${esc(window.GoViewerFlags.info(pInfo?.nationality).name)}</div>
    </div>

    ${M.nativeNameHtml(pInfo)}
    <div class="profile-birth">生日：${esc(pInfo?.birth_date || '—')}</div>
    ${otherResults.length ? `<div class="profile-birth">其他赛事成绩：${otherResults.map(e=>`${esc(M.categoryLabel(e))}·${esc(e.tournament_short)}${esc(M.editionLabel(e))}${e.champion_id===pInfo.id?'冠军':'亚军'}`).join('；')}</div>` : ''}

    <p id="drawerRatingStatus" class="drawer-action-status" role="status" aria-live="polite" hidden></p>
    <div id="playerRatingDrawerSection" class="drawer-rating-section"></div>

    <div class="drawer-stats-grid">
      <div class="stat-card">
        <div class="stat-number">${champEditions.length}</div>
        <div class="stat-title">世界大赛冠军</div>
      </div>
      <div class="stat-card">
        <div class="stat-number stat-number--silver">${runnerEditions.length}</div>
        <div class="stat-title">世界大赛亚军</div>
      </div>
    </div>

    <h4 class="drawer-section-title drawer-section-title--gold">夺冠赛事</h4>
    <div class="drawer-title-list">
      ${champEditions.length > 0 ? champEditions.map(ed => `
        <div class="title-item" onclick="loadAndCloseDrawer('${ed.id}')">
          <div class="title-item-head">${ed.year}年 ${esc(ed.tournament_short)} ${ed.edition_number != null ? `(第${ed.edition_number}届)` : ''}</div>
          <div class="title-item-sub">决赛 ${esc(ed.finals_score)} 战胜 ${esc(ed.runner_up)}</div>
        </div>
      `).join('') : '<div class="drawer-empty-note">无冠军头衔记录</div>'}
    </div>

    ${runnerEditions.length > 0 ? `
      <h4 class="drawer-section-title drawer-section-title--silver">亚军赛事</h4>
      <div class="drawer-title-list drawer-title-list--runner">
        ${runnerEditions.map(ed => `
          <div class="title-item title-item--silver" onclick="loadAndCloseDrawer('${ed.id}')">
            <div class="title-item-head">${ed.year}年 ${esc(ed.tournament_short)} ${ed.edition_number != null ? `(第${ed.edition_number}届)` : ''}</div>
            <div class="title-item-sub">决赛负于 ${esc(ed.champion)} (${esc(ed.finals_score)})</div>
          </div>
        `).join('')}
      </div>
    ` : ''}
    ${pInfo?.id ? '<div class="drawer-review" id="playerReviewInfo"></div>' : ''}
  `;

  drawer.classList.add("open");
  loadPlayerRatingSection(pInfo, pName);

  if (pInfo?.id) window.GoViewerReview?.infoInto('playerReviewInfo', 'players', pInfo.id);
  if (pInfo?.id && window.GoViewerEditor?.enabled()) {
    window.GoViewerEditor.embed(document.getElementById('playerInlineEditor'), 'players', pInfo.id, {focusFields: []}).then(session => {
      const button = document.getElementById('playerInlineSave');
      if (button && session) button.onclick = () => session.save({close: false});
    });
  }
}

window.GoViewerDrawer = {init, show};
})();
