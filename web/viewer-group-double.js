/* 四人分组双败（GSL）迷你卡片渲染、卡内短连线与跨段棋手高亮。
 * 只基于已录入的对局胜负关系渲染展示副本，不推测或修改原始赛果。 */
(function (root) {
  'use strict';

  const M = typeof module !== 'undefined' && module.exports ? require('./viewer-model.js') : root.GoViewerModel;
  const esc = M.escape;

  function compactDate(raw) {
    const text = String(raw || '').trim();
    if (!text) return '';
    const hit = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    return hit ? `${hit[2]}-${hit[3]}` : text;
  }

  function stoneColor(game, player) {
    if (!game || !player?.id) return '';
    if (game.black_player_id === player.id) return 'black';
    if (game.white_player_id === player.id) return 'white';
    return '';
  }

  function outcomeTag(game) {
    if (!game) return '';
    const winId = game.winner?.id || game.winner_id || '';
    if (winId) return M.winnerLabel(game) || '胜';
    const status = M.matchStatus(game);
    if (status === 'no_result') return '无胜负';
    if (status === 'scheduled') return '待赛';
    return '';
  }

  function roundCornersPath(points, radius = 3) {
    if (!points.length) return '';
    if (points.length < 3) return `M ${points.map(p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L ')}`;
    const d = [`M ${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`];
    for (let i = 1; i < points.length - 1; i++) {
      const [ax, ay] = points[i - 1];
      const [bx, by] = points[i];
      const [cx, cy] = points[i + 1];
      const len1 = Math.hypot(bx - ax, by - ay);
      const len2 = Math.hypot(cx - bx, cy - by);
      const r = Math.min(radius, len1 / 2, len2 / 2);
      if (r < 0.5) {
        d.push(`L ${bx.toFixed(1)} ${by.toFixed(1)}`);
        continue;
      }
      const p1x = bx - ((bx - ax) / len1) * r;
      const p1y = by - ((by - ay) / len1) * r;
      const p2x = bx + ((cx - bx) / len2) * r;
      const p2y = by + ((cy - by) / len2) * r;
      d.push(`L ${p1x.toFixed(1)} ${p1y.toFixed(1)} Q ${bx.toFixed(1)} ${by.toFixed(1)} ${p2x.toFixed(1)} ${p2y.toFixed(1)}`);
    }
    const last = points[points.length - 1];
    d.push(`L ${last[0].toFixed(1)} ${last[1].toFixed(1)}`);
    return d.join(' ');
  }

  function renderMatchBox(game, label, role, advQual, flagHtml) {
    if (!game) {
      return `<div class="gsl-match gsl-match--empty gsl-match--${esc(role)}" data-gsl-role="${esc(role)}">
        <div class="gsl-match-head"><span class="gsl-match-label">${esc(label)}</span></div>
        <div class="gsl-match-empty" aria-label="对局未录入">—</div>
      </div>`;
    }
    const players = M.participants(game);
    const winId = game.winner?.id || game.winner_id || '';
    const fullDate = M.dateLabel(game.date);
    const fullRes = M.matchResult(game);
    const resTag = outcomeTag(game);
    const headRight = resTag || compactDate(game.date);
    const rowsHtml = players.map(p => {
      const pName = p?.name_zh || '待定';
      const won = Boolean(winId && p?.id && p.id === winId);
      const lost = Boolean(winId && p?.id && !won);
      const color = stoneColor(game, p);
      const seedMark = won && advQual && advQual.player?.id === p.id
        ? `<span class="gsl-adv-tag" title="${esc(advQual.tag)} 晋级">${advQual.seed === 1 ? '①' : '②'}</span>`
        : '';
      return `<div class="gsl-player-row${won ? ' is-winner' : lost ? ' is-loser' : ''}" data-player-name="${esc(p?.id ? pName : '')}" data-player-id="${esc(p?.id || '')}" role="button" tabindex="0">
        ${p?.id ? flagHtml(p.nationality) : ''}
        <span class="gsl-player-name">${esc(pName)}</span>
        ${color ? `<i class="stone-icon stone-${color}" aria-hidden="true"></i>` : ''}
        ${seedMark}
      </div>`;
    }).join('');
    return `<article class="gsl-match gsl-match--${esc(role)}" id="gsl-match-${esc(game.id)}" data-match-id="${esc(game.id)}" data-gsl-role="${esc(role)}" title="${esc([label, fullDate, fullRes].filter(Boolean).join(' · '))}">
      <div class="gsl-match-head" role="button" tabindex="0" aria-label="${esc(label)} 对局详情">
        <span class="gsl-match-label">${esc(label)}</span>
        ${headRight ? `<span class="gsl-match-res">${esc(headRight)}</span>` : ''}
      </div>
      <div class="gsl-match-players">${rowsHtml}</div>
    </article>`;
  }

  function renderGroupCard(group, flagHtml) {
    const qualsHtml = group.qualifiers.length
      ? group.qualifiers.map(q => {
          const p = q.player;
          const pName = p?.name_zh || p?.id || '';
          return `<button type="button" class="gsl-qual-chip" data-player-id="${esc(p?.id || '')}" data-player-name="${esc(pName)}" title="${esc(q.tag)}（${q.seed === 1 ? '胜者战出线' : '出线战晋级'}）">
            <span class="gsl-seed-mark">${q.seed === 1 ? '①' : '②'}</span>${p?.id ? flagHtml(p.nationality) : ''}<span class="gsl-qual-name">${esc(pName)}</span>
          </button>`;
        }).join('')
      : '<span class="gsl-qual-pending">—</span>';

    const winQual = group.qualifiers.find(q => q.seed === 1) || null;
    const decQual = group.qualifiers.find(q => q.seed === 2) || null;
    const extras = group.extraGames || [];
    const extrasHtml = extras.length
      ? `<div class="gsl-card-extras">${extras.map(game => {
          const ps = M.participants(game).map(p => esc(p?.name_zh || '待定')).join(' - ');
          const res = outcomeTag(game);
          return `<button type="button" class="gsl-extra-btn" data-match-id="${esc(game.id)}">加赛/重赛：${ps}${res ? `（${esc(res)}）` : ''}</button>`;
        }).join('')}</div>`
      : '';

    return `<article class="gsl-card" data-group-key="${esc(group.key)}">
      <header class="gsl-card-head">
        <span class="gsl-group-badge">${esc(group.label)}</span>
        <div class="gsl-qualifiers" aria-label="${esc(group.label)}出线棋手">${qualsHtml}</div>
      </header>
      <div class="gsl-bracket">
        <svg class="gsl-card-svg" aria-hidden="true"></svg>
        <div class="gsl-bracket-cols">
          <div class="gsl-col gsl-col-r1">
            ${renderMatchBox(group.first[0] || null, '首轮', 'r1a', null, flagHtml)}
            ${renderMatchBox(group.first[1] || null, '首轮', 'r1b', null, flagHtml)}
          </div>
          <div class="gsl-col gsl-col-r2">
            ${renderMatchBox(group.winners, '胜者战', 'win', winQual, flagHtml)}
            ${renderMatchBox(group.losers, '败者战', 'lose', null, flagHtml)}
          </div>
          <div class="gsl-col gsl-col-r3">
            ${renderMatchBox(group.decider, '出线战', 'decider', decQual, flagHtml)}
          </div>
        </div>
      </div>
      ${extrasHtml}
    </article>`;
  }

  function bindCardEvents(section, matchById, {showMatch, showPlayer, highlightPlayer}) {
    section.addEventListener('click', event => {
      const qual = event.target.closest('.gsl-qual-chip');
      if (qual && qual.dataset.playerId) {
        event.stopPropagation();
        showPlayer?.(qual.dataset.playerId);
        return;
      }
      const row = event.target.closest('.gsl-player-row');
      if (row && row.dataset.playerId) {
        event.stopPropagation();
        showPlayer?.(row.dataset.playerId);
        return;
      }
      const matchBtn = event.target.closest('[data-match-id]');
      if (matchBtn) {
        const game = matchById.get(matchBtn.dataset.matchId);
        if (game) showMatch?.(game);
      }
    });

    section.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const target = event.target.closest('.gsl-player-row, .gsl-match-head');
      if (!target) return;
      event.preventDefault();
      if (target.classList.contains('gsl-player-row')) {
        if (target.dataset.playerId) showPlayer?.(target.dataset.playerId);
      } else {
        const matchEl = target.closest('[data-match-id]');
        const game = matchEl ? matchById.get(matchEl.dataset.matchId) : null;
        if (game) showMatch?.(game);
      }
    });

    section.addEventListener('pointerover', event => {
      const actor = event.target.closest('.gsl-player-row[data-player-name], .gsl-qual-chip[data-player-name]');
      const name = actor?.dataset.playerName;
      if (name) highlightPlayer?.(name);
    });
  }

  function render({stage, canvas, flag, showMatch, showPlayer, highlightPlayer, onToggleCollapse}) {
    if (!stage || !canvas) return null;
    const flagHtml = nat => (typeof flag === 'function' ? flag(nat) : '');
    const matchById = new Map();
    for (const g of stage.groups) {
      for (const m of [...g.first, g.winners, g.losers, g.decider, ...(g.extraGames || [])]) {
        if (m?.id) matchById.set(m.id, m);
      }
    }

    const metaParts = [stage.dateRange, `${stage.groups.length} 组 · ${stage.totalGames} 局`].filter(Boolean);
    const section = document.createElement('section');
    section.className = 'group-double-section';
    section.setAttribute('aria-label', stage.title);
    section.innerHTML = `
      <header class="group-double-header">
        <div class="group-double-title-group">
          <span class="group-double-kicker">第一阶段</span>
          <h3 class="group-double-title">${esc(stage.title)}</h3>
          <span class="group-double-meta">${esc(metaParts.join(' · '))}</span>
        </div>
        <button type="button" class="btn btn-small group-double-toggle" aria-expanded="true">收起小组赛</button>
      </header>
      <div class="gsl-grid" data-group-count="${stage.groups.length}">
        ${stage.groups.map(g => renderGroupCard(g, flagHtml)).join('')}
      </div>
    `;

    const toggleBtn = section.querySelector('.group-double-toggle');
    toggleBtn?.addEventListener('click', () => {
      const collapsed = section.classList.toggle('is-collapsed');
      toggleBtn.textContent = collapsed ? '展开小组赛' : '收起小组赛';
      toggleBtn.setAttribute('aria-expanded', String(!collapsed));
      onToggleCollapse?.(collapsed);
      if (!collapsed) drawConnectors(canvas, stage);
    });

    bindCardEvents(section, matchById, {showMatch, showPlayer, highlightPlayer});
    canvas.prepend(section);
    return section;
  }

  function matchOutcomePlayers(game) {
    if (!game) return {winner: null, loser: null};
    const parts = M.participants(game);
    const winId = game.winner?.id || game.winner_id || '';
    if (!winId) return {winner: null, loser: null};
    const winner = parts.find(p => p?.id === winId) || game.winner || null;
    const loser = parts.find(p => p?.id && p.id !== winId) || null;
    return {winner, loser};
  }

  function drawConnectors(canvas, stage) {
    if (!canvas || !stage) return;
    const section = canvas.querySelector('.group-double-section');
    if (!section || section.classList.contains('is-collapsed')) return;

    const matchById = new Map();
    for (const g of stage.groups) {
      for (const m of [...g.first, g.winners, g.losers, g.decider]) {
        if (m?.id) matchById.set(m.id, m);
      }
    }

    const cards = [...section.querySelectorAll('.gsl-card')];
    for (const card of cards) {
      const bracket = card.querySelector('.gsl-bracket');
      const svg = card.querySelector('.gsl-card-svg');
      if (!bracket || !svg) continue;

      const br = bracket.getBoundingClientRect();
      const zoom = br.width / Math.max(1, bracket.offsetWidth) || 1;
      const w = Math.max(1, Math.round(bracket.offsetWidth));
      const h = Math.max(1, Math.round(bracket.offsetHeight));
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      svg.setAttribute('width', String(w));
      svg.setAttribute('height', String(h));
      svg.style.width = `${w}px`;
      svg.style.height = `${h}px`;
      svg.innerHTML = '';

      const boxOf = role => {
        const el = card.querySelector(`[data-gsl-role="${role}"]`);
        if (!el || el.classList.contains('gsl-match--empty')) return null;
        const r = el.getBoundingClientRect();
        return {
          el,
          game: el.dataset.matchId ? matchById.get(el.dataset.matchId) : null,
          left: (r.left - br.left) / zoom,
          right: (r.right - br.left) / zoom,
          top: (r.top - br.top) / zoom,
          bottom: (r.bottom - br.top) / zoom,
          cy: ((r.top + r.bottom) / 2 - br.top) / zoom,
        };
      };

      const r1a = boxOf('r1a');
      const r1b = boxOf('r1b');
      const win = boxOf('win');
      const lose = boxOf('lose');
      const decider = boxOf('decider');

      const appendEdge = (src, dst, kind, playerName, ySrcOff, yDstOff, xShift) => {
        if (!src || !dst) return;
        const x1 = src.right;
        const y1 = src.cy + ySrcOff;
        const x2 = dst.left;
        const y2 = dst.cy + yDstOff;
        const midX = (x1 + x2) / 2 + xShift;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', `gsl-conn-path gsl-conn-${kind}`);
        path.setAttribute('d', roundCornersPath([[x1, y1], [midX, y1], [midX, y2], [x2, y2]], 3));
        if (playerName) path.dataset.playerName = playerName;
        svg.appendChild(path);
      };

      const linkIfConsistent = (src, dst, kind, roleExpectWinner, ySrcOff, yDstOff, xShift) => {
        if (!src || !dst) return;
        const {winner, loser} = matchOutcomePlayers(src.game);
        const mover = roleExpectWinner ? winner : loser;
        const targetIds = dst.game ? M.participants(dst.game).map(p => p?.id).filter(Boolean) : [];
        if (mover?.id && targetIds.length && !targetIds.includes(mover.id)) return;
        appendEdge(src, dst, kind, mover?.name_zh || '', ySrcOff, yDstOff, xShift);
      };

      // R1 -> Winners / Losers (separate vertical fork channels by ±2.5px so solid & dashed stay crisp)
      linkIfConsistent(r1a, win, 'win', true, -4, -6, -2.5);
      linkIfConsistent(r1b, win, 'win', true, -4, 6, -2.5);
      linkIfConsistent(r1a, lose, 'lose', false, 4, -6, 2.5);
      linkIfConsistent(r1b, lose, 'lose', false, 4, 6, 2.5);

      // R2 -> Decider
      linkIfConsistent(win, decider, 'lose', false, 4, -6, 0);
      linkIfConsistent(lose, decider, 'win', true, -4, 6, 0);
    }
  }

  function highlightPlayer(canvas, playerName) {
    if (!canvas) return;
    const section = canvas.querySelector('.group-double-section');
    if (!section) return;
    const active = Boolean(playerName);
    const escaped = active ? CSS.escape(playerName) : '';
    section.querySelectorAll('.gsl-match:not(.gsl-match--empty)').forEach(box => {
      const hit = active && Boolean(box.querySelector(`.gsl-player-row[data-player-name="${escaped}"]`));
      box.classList.toggle('highlight', hit);
      box.classList.toggle('dimmed', active && !hit);
    });
    section.querySelectorAll('.gsl-player-row, .gsl-qual-chip').forEach(el => {
      const hit = active && el.dataset.playerName === playerName;
      el.classList.toggle('highlight-player', hit);
      el.classList.toggle('dimmed-player', active && Boolean(el.dataset.playerName) && !hit);
    });
    section.querySelectorAll('.gsl-conn-path').forEach(path => {
      path.classList.toggle('highlight', active && path.dataset.playerName === playerName);
    });
  }

  function clearHighlight(canvas) {
    if (!canvas) return;
    const section = canvas.querySelector('.group-double-section');
    if (!section) return;
    section.querySelectorAll('.gsl-match').forEach(box => box.classList.remove('highlight', 'dimmed'));
    section.querySelectorAll('.gsl-player-row, .gsl-qual-chip').forEach(el => el.classList.remove('highlight-player', 'dimmed-player'));
    section.querySelectorAll('.gsl-conn-path').forEach(path => path.classList.remove('highlight'));
  }

  const api = {render, drawConnectors, highlightPlayer, clearHighlight};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GoViewerGroupDouble = api;
})(typeof window === 'undefined' ? globalThis : window);
