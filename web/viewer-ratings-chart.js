/* 等级分高保真可视化图表引擎（继承自原始 Go Ranking Tools）：
 * 支持 5 种核心走势图表模式与月度对比三大分析图表：
 * 1. 单人-独立双线（左轴等级分，右轴当月排名倒置）
 * 2. 单人-点圈标注（等级分曲线，点圈标注当月名次）
 * 3. 多人-对比等级分（多位棋手等级分折线重叠对比）
 * 4. 多人-对比排名（多位棋手排名对比曲线，Y 轴倒置）
 * 5. 双人-分差图（基准线 0，红蓝填充领先区域的分差走势）
 * 月度对比三大图表：
 * A. Top N 涨跌排行榜条形图
 * B. 前后等级分散点图 (45度对角线参考)
 * C. 分值变动分布直方图
 * 支持平滑样条、图例悬停聚焦、十字准线点位发光圈、全屏大图、数据复制与高清 PNG/无损 SVG 导出。
 */
(function () {
'use strict';

const MODES = {
  'single-dual': '单人-独立双线',
  'single-circle': '单人-点圈标注',
  'single-metric': '单人-单指标',
  'multi-rating': '多人-对比等级分',
  'multi-rank': '多人-对比排名',
  'two-diff': '双人-分差图'
};

const PALETTE = [
  '#e11d48', // 0: 玫瑰红
  '#2563eb', // 1: 皇家蓝
  '#059669', // 2: 翡翠绿
  '#d97706', // 3: 琥珀金
  '#7c3aed', // 4: 紫罗兰
  '#0891b2', // 5: 青蓝
  '#ea580c', // 6: 橙红
  '#db2777', // 7: 桃粉
  '#4b5563', // 8: 石板灰
  '#14b8a6'  // 9: 松石绿
];

const CHART_ICON_PATHS = {
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 4 3 5-6"/>',
  bar: '<path d="M3 3v18h18"/><rect x="7" y="10" width="3" height="7" rx="0.5"/><rect x="12.5" y="6" width="3" height="11" rx="0.5"/><rect x="18" y="13" width="3" height="4" rx="0.5"/>',
  trend: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  scatter: '<path d="M3 3v18h18"/><circle cx="8" cy="14" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="10" r="1.5" fill="currentColor" stroke="none"/><circle cx="17" cy="7" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="15" r="1.5" fill="currentColor" stroke="none"/>',
  download: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  expand: '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="9" y1="10" x2="9" y2="20"/>',
  close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  info: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="16" x2="12" y2="12"/><circle cx="12" cy="8" r="0.8" fill="currentColor" stroke="none"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  undo: '<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>'
};

function iconSvg(name, size = 14) {
  const inner = CHART_ICON_PATHS[name] || CHART_ICON_PATHS.chart;
  return `<svg class="ratings-btn-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

function getThemeColors(forceTheme = null) {
  const isDark = forceTheme === 'dark'
    ? true
    : (forceTheme === 'light'
      ? false
      : Boolean(document.documentElement.classList.contains('dark') ||
        document.body?.getAttribute('data-theme') === 'dark' ||
        window.matchMedia?.('(prefers-color-scheme: dark)')?.matches));
  return {
    isDark,
    bg: isDark ? '#111827' : '#ffffff',
    text: isDark ? '#f3f4f6' : '#1f2937',
    textMuted: isDark ? '#9ca3af' : '#6b7280',
    grid: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
    gridDashed: isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.12)',
    axis: isDark ? '#4b5563' : '#d1d5db',
    primaryLine: '#e11d48',
    rankLine: '#2563eb',
    zeroLine: isDark ? '#6b7280' : '#9ca3af',
    series: isDark
      ? ['#fb7185', '#60a5fa', '#34d399', '#fbbf24', '#a78bfa', '#22d3ee', '#fb923c', '#f472b6', '#94a3b8', '#2dd4bf']
      : PALETTE
  };
}

function extractMonthKey(str) {
  const m = String(str || '').match(/(\d{4})年(\d{1,2})月/);
  if (m) return parseInt(m[1], 10) * 100 + parseInt(m[2], 10);
  const m2 = String(str || '').match(/^(\d{4})(\d{2})$/);
  if (m2) return parseInt(m2[1], 10) * 100 + parseInt(m2[2], 10);
  return 0;
}

function parseDateMs(str) {
  if (!str) return null;
  const s = String(str).trim();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s;
  const ts = Date.parse(iso);
  return Number.isFinite(ts) ? ts : null;
}

function buildDateAxisTicks(minTs, maxTs, sparse = false) {
  const spanDays = Math.max(1, (maxTs - minTs) / 86400000);
  const startDt = new Date(minTs);
  const endDt = new Date(maxTs);
  const startYear = startDt.getUTCFullYear();
  const endYear = endDt.getUTCFullYear();
  const ticks = [];

  if (spanDays >= 900) {
    const yearSpan = Math.max(1, endYear - startYear);
    let stepYears = 1;
    const maxTicks = sparse ? 7 : 14;
    if (yearSpan / 5 > maxTicks) stepYears = 5;
    else if (yearSpan / 2 > maxTicks) stepYears = 2;
    else if (yearSpan > maxTicks) stepYears = 2;
    const firstTickYear = Math.ceil(startYear / stepYears) * stepYears;
    for (let y = firstTickYear; y <= endYear; y += stepYears) {
      const ts = Date.UTC(y, 0, 1);
      if (ts >= minTs && ts <= maxTs) {
        ticks.push({ ts, label: String(y) });
      }
    }
  } else if (spanDays >= 180) {
    const stepMonths = spanDays >= 450 ? 3 : 2;
    let y = startYear;
    let m = startDt.getUTCMonth();
    while (true) {
      const ts = Date.UTC(y, m, 1);
      if (ts > maxTs) break;
      if (ts >= minTs) {
        ticks.push({ ts, label: `${y}-${String(m + 1).padStart(2, '0')}` });
      }
      m += stepMonths;
      while (m >= 12) { m -= 12; y += 1; }
    }
  } else {
    const count = sparse ? 4 : 6;
    for (let i = 0; i <= count; i++) {
      const ts = minTs + (i / count) * (maxTs - minTs);
      const d = new Date(ts);
      const label = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      ticks.push({ ts, label });
    }
  }

  if (ticks.length === 0) {
    const d0 = new Date(minTs);
    ticks.push({ ts: minTs, label: d0.toISOString().slice(0, 10) });
  }
  return ticks;
}

function buildTimeLabels(timeStrings, sparse = false) {
  const labels = [];
  let lastYear = null;
  const total = timeStrings.length;
  const maxTicks = sparse ? 9 : 18;
  const step = total > maxTicks ? Math.max(1, Math.ceil((total - 1) / maxTicks)) : 1;
  const tailGuard = step > 1 ? Math.max(1, Math.floor(step * 0.55)) : 0;

  let yearStep = 1;
  if (sparse) {
    const years = new Set();
    timeStrings.forEach(s => {
      const m = String(s).match(/(\d{4})年/);
      if (m) years.add(m[1]);
    });
    if (years.size > 10) yearStep = Math.ceil(years.size / 9);
  }
  let yearIndex = 0;

  timeStrings.forEach((timeStr, index) => {
    const isFirst = index === 0;
    const isLast = index === total - 1;
    const match = String(timeStr).match(/(\d{4})年(\d{1,2})月/);

    if (match) {
      const year = match[1];
      const month = match[2];
      if (sparse) {
        const isJan = month === '1' || month === '01';
        if (isJan && year !== lastYear) yearIndex += 1;
        const showJan = isJan && ((yearIndex - 1) % yearStep === 0);
        if (isFirst || isLast || (showJan && (total - 1 - index) >= 3)) {
          labels.push(`${year}年${month}月`);
          lastYear = year;
        } else {
          labels.push('');
        }
      } else {
        const withinTail = !isFirst && !isLast && (total - 1 - index) <= tailGuard;
        if (isFirst || isLast || (index % step === 0 && !withinTail)) {
          if (year !== lastYear) {
            labels.push(`${year}年${month}月`);
            lastYear = year;
          } else {
            labels.push(`${month}月`);
          }
        } else {
          labels.push('');
        }
      }
    } else {
      const withinTail = !isFirst && !isLast && (total - 1 - index) <= tailGuard;
      labels.push(isFirst || isLast || (!sparse && index % step === 0 && !withinTail) ? String(timeStr) : '');
    }
  });

  return labels;
}

// 智能判断点位是否应绘制常驻数值标签（防止多于25点时文字糊成一片）
function shouldDisplayLabel(idx, valList, total, isRank = false) {
  if (total <= 12) return true;
  if (idx === 0 || idx === total - 1) return true;
  const v = valList[idx];
  const prev = valList[idx - 1];
  const next = valList[idx + 1];

  if (isRank) {
    if (v !== prev) return true;
    if (total <= 24 && idx % 3 === 0) return true;
    return false;
  }

  const maxV = Math.max(...valList);
  const minV = Math.min(...valList);
  if (v === maxV || v === minV) return true;

  if ((v > prev && v > next) || (v < prev && v < next)) {
    return true;
  }
  if (total <= 24 && idx % 2 === 0) return true;
  return false;
}

// 仿 Go-Ranking-Tool _draw_anti_overlap_labels：横向去密 + 纵向迭代排斥 + 细引线
function placePointLabels(svg, candidates, bounds, options = {}) {
  if (!candidates || candidates.length === 0) return;
  const {
    fontSize = 8.5,
    fontWeight = '600',
    minXSpacing = 40,
    leaderColor = null,
    maxLabels = 24
  } = options;

  const sortedByPrio = candidates.slice().sort((a, b) => (b.priority || 0) - (a.priority || 0));
  const accepted = [];

  for (const item of sortedByPrio) {
    if (accepted.length >= maxLabels && (item.priority || 0) < 3) continue;
    const estWidth = Math.max(minXSpacing, String(item.text || '').length * (fontSize * 0.85) + 12);
    const conflict = accepted.some(acc => {
      const accW = Math.max(minXSpacing, String(acc.text || '').length * (fontSize * 0.85) + 12);
      const sameZone = Math.abs(acc.anchorY - item.anchorY) < 32;
      return sameZone && Math.abs(acc.x - item.x) < Math.max(estWidth, accW);
    });
    if (!conflict) accepted.push(item);
  }

  const padTop = bounds.top + 13;
  const padBottom = bounds.top + bounds.height - 6;
  const padLeft = bounds.left + 16;
  const padRight = bounds.left + bounds.width - 16;

  const placed = accepted.map(item => {
    const offset = item.offset !== undefined ? item.offset : 9;
    const preferAbove = item.preferAbove !== false;
    const lx = Math.max(padLeft, Math.min(padRight, item.x));
    let ly = preferAbove ? item.anchorY - offset : item.anchorY + offset + 3;
    if (ly < padTop) ly = item.anchorY + offset + 4;
    if (ly > padBottom) ly = item.anchorY - offset;
    ly = Math.max(padTop, Math.min(padBottom, ly));
    return Object.assign({}, item, { lx, ly, halfW: Math.max(14, String(item.text || '').length * fontSize * 0.36 + 4) });
  });

  // 纵向迭代弛豫避免文字互压
  for (let pass = 0; pass < 14; pass++) {
    let moved = false;
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i];
        const b = placed[j];
        const dx = Math.abs(a.lx - b.lx);
        const minW = a.halfW + b.halfW;
        const dy = b.ly - a.ly;
        const minH = fontSize + 4;
        if (dx < minW && Math.abs(dy) < minH) {
          const push = (minH - Math.abs(dy)) * 0.55;
          const dir = dy >= 0 ? 1 : -1;
          a.ly = Math.max(padTop, Math.min(padBottom, a.ly - dir * push));
          b.ly = Math.max(padTop, Math.min(padBottom, b.ly + dir * push));
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  placed.forEach(item => {
    const dist = Math.hypot(item.lx - item.x, item.ly - item.anchorY);
    if (dist > 14) {
      const leader = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      leader.setAttribute('x1', item.x.toFixed(1));
      leader.setAttribute('y1', item.anchorY.toFixed(1));
      leader.setAttribute('x2', item.lx.toFixed(1));
      leader.setAttribute('y2', (item.ly > item.anchorY ? item.ly - fontSize * 0.8 : item.ly + 2).toFixed(1));
      leader.setAttribute('stroke', leaderColor || item.color);
      leader.setAttribute('stroke-width', '0.8');
      leader.setAttribute('stroke-opacity', '0.55');
      svg.appendChild(leader);
    }

    const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    lbl.setAttribute('class', 'chart-point-label');
    lbl.setAttribute('x', item.lx.toFixed(1));
    lbl.setAttribute('y', item.ly.toFixed(1));
    lbl.setAttribute('text-anchor', 'middle');
    lbl.setAttribute('fill', item.color);
    lbl.setAttribute('font-size', String(fontSize));
    lbl.setAttribute('font-weight', fontWeight);
    lbl.textContent = item.text;
    svg.appendChild(lbl);
  });
}

// 精确将鼠标事件坐标映射为 SVG viewBox 内部坐标，消灭 CSS 缩放/居中产生的坐标漂移
// =============================================================================
// 多系列绘制辅助：稳定配色、缺月切段、概览采样、端点直标、标注档位
// =============================================================================

function stableHash(str) {
  let hash = 2166136261;
  const text = String(str || '');
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function playerColorKey(player) {
  return String(player?.player_id || player?.player_clean || player?.name || '');
}

// 同一组棋手无论选择顺序如何都得到同一套颜色；隐藏某条线不改变其余颜色。
// 已出现过的棋手颜色写入本地记忆，后续新增棋手只占用未使用色位，不重排旧颜色。
const PLAYER_COLOR_STORAGE_KEY = 'go_viewer_rating_player_colors_v1';
let playerColorRegistry = null;

function loadPlayerColorRegistry() {
  if (playerColorRegistry) return playerColorRegistry;
  playerColorRegistry = new Map();
  try {
    const raw = localStorage.getItem(PLAYER_COLOR_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        Object.entries(parsed).forEach(([key, value]) => {
          const index = Number(value);
          if (key && Number.isInteger(index) && index >= 0) playerColorRegistry.set(key, index);
        });
      }
    }
  } catch (_) {}
  return playerColorRegistry;
}

function savePlayerColorRegistry() {
  if (!playerColorRegistry) return;
  try {
    const plain = {};
    playerColorRegistry.forEach((value, key) => { plain[key] = value; });
    localStorage.setItem(PLAYER_COLOR_STORAGE_KEY, JSON.stringify(plain));
  } catch (_) {}
}

function buildPlayerColorMap(players, palette) {
  const colors = Array.isArray(palette) && palette.length > 0 ? palette : PALETTE;
  const registry = loadPlayerColorRegistry();
  const keys = Array.from(new Set((players || [])
    .filter(player => !Array.isArray(player.history) || player.history.length > 0)
    .map(playerColorKey)
    .filter(Boolean))).sort();
  const map = new Map();
  const used = new Set();
  // 已记忆的颜色优先保留，保证旧棋手换组合、换页面都不变色。
  registry.forEach(index => { used.add(index); });

  let changed = false;
  keys.forEach(key => {
    let index = registry.get(key);
    if (!Number.isInteger(index) || index < 0 || index >= colors.length) {
      const start = stableHash(key) % colors.length;
      index = start;
      for (let i = 0; i < colors.length; i++) {
        const candidate = (start + i) % colors.length;
        if (!used.has(candidate)) { index = candidate; break; }
      }
      registry.set(key, index);
      used.add(index);
      changed = true;
    }
    map.set(key, colors[index] || colors[0]);
  });

  if (keys.length > 0 && changed) savePlayerColorRegistry();
  return map;
}

function monthGap(prevKey, nextKey) {
  const prev = Number(prevKey);
  const next = Number(nextKey);
  if (!Number.isFinite(prev) || !Number.isFinite(next)) return 0;
  return Math.round(next / 100) * 12 + (next % 100) - (Math.round(prev / 100) * 12 + (prev % 100));
}

// 月度轴按连续日历月切段；缺失月份不连线、不补零。
function splitMonthPoints(points) {
  const segments = [];
  let current = [];
  const keyOf = point => point?.h?.month_key ?? point?.month_key;
  (points || []).forEach(point => {
    const key = keyOf(point);
    if (current.length > 0 && monthGap(keyOf(current[current.length - 1]), key) !== 1) {
      segments.push(current);
      current = [];
    }
    current.push(point);
  });
  if (current.length > 0) segments.push(current);
  return segments;
}

function pathForPoints(points, smooth) {
  if (!points || points.length === 0) return '';
  if (smooth && points.length > 2) return buildSplinePath(points);
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

const LABEL_MODES = new Set(['none', 'endpoint', 'extreme', 'all']);

function resolveLabelMode(rawMode, chartMode) {
  if (LABEL_MODES.has(rawMode)) return rawMode;
  return chartMode === 'multi-rating' || chartMode === 'multi-rank' ? 'endpoint' : 'all';
}

function labelWanted(mode, context) {
  if (mode === 'none') return false;
  if (mode === 'endpoint') return Boolean(context.isEndpoint);
  if (mode === 'extreme') return Boolean(context.isEndpoint || context.isExtreme);
  return Boolean(context.isEndpoint || context.isExtreme
    || shouldDisplayLabel(context.index, context.values, context.total, context.isRank));
}

const AVG_MONTH_MS = 2629800000;

// 日期轴概览采样：按时间桶保留首、末、最小、最大，避免长跨度逐局点压垮图面。
function sampleDatePoints(points, valueOf, options = {}) {
  const threshold = options.threshold || 420;
  const targetPoints = options.targetPoints || 320;
  if (!Array.isArray(points) || points.length <= threshold) return {points, info: null};
  const dated = points
    .map(point => ({point, ts: parseDateMs(point.date || point.month_str)}))
    .filter(item => item.ts !== null)
    .sort((a, b) => a.ts - b.ts);
  if (dated.length <= threshold) return {points, info: null};

  const minTs = dated[0].ts;
  const maxTs = dated[dated.length - 1].ts;
  const bucketCount = Math.max(24, Math.ceil(targetPoints / 3));
  const bucketMs = Math.max(1, (maxTs - minTs) / bucketCount);
  const buckets = new Map();
  dated.forEach(item => {
    const index = Math.min(bucketCount - 1, Math.floor((item.ts - minTs) / bucketMs));
    if (!buckets.has(index)) buckets.set(index, []);
    buckets.get(index).push(item);
  });

  const kept = [];
  Array.from(buckets.keys()).sort((a, b) => a - b).forEach(index => {
    const list = buckets.get(index);
    let first = list[0];
    let last = list[list.length - 1];
    let min = list[0];
    let max = list[0];
    const numeric = point => {
      const value = valueOf(point);
      return value === null || value === undefined || value === '' ? NaN : Number(value);
    };
    list.forEach(item => {
      const value = numeric(item.point);
      if (!Number.isFinite(value)) return;
      if (value < numeric(min.point)) min = item;
      if (value > numeric(max.point)) max = item;
    });
    const picked = Array.from(new Set([first, last, min, max])).sort((a, b) => a.ts - b.ts);
    picked.forEach(item => kept.push(item.point));
  });

  if (kept.length >= points.length * 0.92) return {points, info: null};
  return {
    points: kept,
    info: {
      original: points.length,
      kept: kept.length,
      bucketMonths: Math.max(1, Math.round(bucketMs / AVG_MONTH_MS))
    }
  };
}

// 多系列端点直标：末端靠近右边界的放入右侧留白，其余直接标在末点旁，
// 避免用长引线把“已结束的生涯”画成延伸至今的假曲线。
function placeEndLabels(svg, items, bounds, options = {}) {
  if (!items || items.length === 0) return;
  const fontSize = options.fontSize || 9;
  const plotRight = bounds.left + bounds.width;
  const gutterX = plotRight + 8;
  const top = bounds.top + 12;
  const bottom = bounds.top + bounds.height - 4;
  const estimateWidth = text => {
    let width = 0;
    for (const ch of String(text || '')) width += ch.charCodeAt(0) > 127 ? fontSize : fontSize * 0.58;
    return width;
  };
  const inPlace = [];
  const gutter = [];
  items.forEach(item => {
    const width = estimateWidth(item.text);
    if (item.x + 8 + width > plotRight - 4 || item.x >= plotRight - 96) gutter.push(item);
    else inPlace.push(item);
  });

  const drawLabel = (x, y, anchor, item) => {
    const anchorDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    anchorDot.setAttribute('cx', item.x.toFixed(1));
    anchorDot.setAttribute('cy', item.y.toFixed(1));
    anchorDot.setAttribute('r', '2.6');
    anchorDot.setAttribute('fill', item.color);
    svg.appendChild(anchorDot);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('class', 'chart-point-label chart-endpoint-label');
    label.setAttribute('x', x.toFixed(1));
    label.setAttribute('y', y.toFixed(1));
    label.setAttribute('text-anchor', anchor);
    label.setAttribute('fill', item.color);
    label.setAttribute('font-size', String(fontSize));
    label.setAttribute('font-weight', '600');
    if (options.background) {
      label.setAttribute('stroke', options.background);
      label.setAttribute('stroke-width', '3');
      label.setAttribute('stroke-linejoin', 'round');
      label.setAttribute('paint-order', 'stroke');
    }
    label.textContent = item.text;
    svg.appendChild(label);
  };

  inPlace.forEach(item => {
    const width = estimateWidth(item.text);
    let anchor = 'start';
    let x = item.x + 7;
    if (x + width > plotRight - 4) {
      anchor = 'end';
      x = item.x - 7;
    }
    const y = Math.max(top, Math.min(bottom, item.y + fontSize * 0.35));
    drawLabel(x, y, anchor, item);
  });

  if (gutter.length === 0) return;
  const placed = gutter.slice().sort((a, b) => a.y - b.y);
  placed.forEach(item => { item.ly = Math.max(top, Math.min(bottom, item.y)); });
  const gap = fontSize + 5;
  for (let pass = 0; pass < 12; pass++) {
    for (let i = 1; i < placed.length; i++) {
      if (placed[i].ly - placed[i - 1].ly < gap) placed[i].ly = placed[i - 1].ly + gap;
    }
    if (placed[placed.length - 1].ly > bottom) {
      placed[placed.length - 1].ly = bottom;
      for (let i = placed.length - 2; i >= 0; i--) {
        if (placed[i + 1].ly - placed[i].ly < gap) placed[i].ly = placed[i + 1].ly - gap;
      }
    }
  }

  placed.forEach(item => {
    const ly = Math.max(top, Math.min(bottom, item.ly));
    const leader = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    leader.setAttribute('x1', item.x.toFixed(1));
    leader.setAttribute('y1', item.y.toFixed(1));
    leader.setAttribute('x2', (gutterX - 3).toFixed(1));
    leader.setAttribute('y2', ly.toFixed(1));
    leader.setAttribute('stroke', item.color);
    leader.setAttribute('stroke-width', '0.9');
    leader.setAttribute('stroke-opacity', '0.55');
    svg.appendChild(leader);

    drawLabel(gutterX, ly + fontSize * 0.35, 'start', item);
  });
}

function getSvgCoordinates(svg, e) {
  try {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (ctm) {
      return pt.matrixTransform(ctm.inverse());
    }
  } catch (err) {}
  const rect = svg.getBoundingClientRect();
  const width = svg.viewBox?.baseVal?.width || 1000;
  const height = svg.viewBox?.baseVal?.height || 560;
  return {
    x: (e.clientX - rect.left) * (width / rect.width),
    y: (e.clientY - rect.top) * (height / rect.height)
  };
}

function escapeXml(unsafe) {
  return String(unsafe || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// 统一紧包围盒导出辅助：合并基准 viewBox 与所有可见图元的真实变换后包围盒，防止裁切边角文字
function computeTightSvgViewBox(svgEl, baseWidth, baseHeight, pad = 12) {
  let minX = 0;
  let minY = 0;
  let maxX = baseWidth;
  let maxY = baseHeight;

  if (svgEl && typeof svgEl.getBBox === 'function') {
    let baseInv = null;
    try {
      const baseCTM = svgEl.getScreenCTM();
      if (baseCTM) baseInv = baseCTM.inverse();
    } catch (e) {}

    const nodes = svgEl.querySelectorAll('text, path, circle, rect, line, polygon');
    nodes.forEach(node => {
      if (node.classList.contains('chart-overlay') ||
          node.classList.contains('chart-crosshair') ||
          node.classList.contains('chart-halo-group') ||
          node.getAttribute('fill') === 'transparent') {
        return;
      }
      if (node.tagName.toLowerCase() === 'rect' &&
          Number(node.getAttribute('width')) >= baseWidth &&
          Number(node.getAttribute('height')) >= baseHeight) {
        return;
      }
      try {
        const b = node.getBBox();
        if (!b || (b.width === 0 && b.height === 0)) return;
        const corners = [
          [b.x, b.y],
          [b.x + b.width, b.y],
          [b.x, b.y + b.height],
          [b.x + b.width, b.y + b.height]
        ];
        let elCTM = null;
        if (baseInv) {
          try {
            const nodeCTM = node.getScreenCTM();
            if (nodeCTM) elCTM = baseInv.multiply(nodeCTM);
          } catch (e) {}
        }
        corners.forEach(([cx, cy]) => {
          let tx = cx;
          let ty = cy;
          if (elCTM && typeof svgEl.createSVGPoint === 'function') {
            const pt = svgEl.createSVGPoint();
            pt.x = cx;
            pt.y = cy;
            const res = pt.matrixTransform(elCTM);
            tx = res.x;
            ty = res.y;
          }
          if (Number.isFinite(tx) && Number.isFinite(ty)) {
            minX = Math.min(minX, tx - pad);
            minY = Math.min(minY, ty - pad);
            maxX = Math.max(maxX, tx + pad);
            maxY = Math.max(maxY, ty + pad);
          }
        });
      } catch (e) {}
    });
  }

  return {
    vx: Math.floor(minX),
    vy: Math.floor(minY),
    vw: Math.ceil(maxX - minX),
    vh: Math.ceil(maxY - minY)
  };
}

async function svgStringToPngBlob(svgString, width, height, scale = 2) {
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch (e) {}
  }
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = url;
  });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, width, height);

  return await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

function triggerDownloadBlob(blob, filename) {
  if (!blob) return;
  const a = document.createElement('a');
  a.download = filename;
  a.href = URL.createObjectURL(blob);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

// 平滑三阶贝塞尔样条连接算法 (Cardinal/Catmull-Rom Spline)
function buildSplinePath(pts) {
  if (!pts || pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  if (pts.length === 2) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} L ${pts[1].x.toFixed(1)} ${pts[1].y.toFixed(1)}`;

  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = i > 0 ? pts[i - 1] : pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = i < pts.length - 2 ? pts[i + 2] : p2;

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

class RatingChartRenderer {
  constructor(container, options = {}) {
    this.container = container;
    this.options = Object.assign({
      mode: 'single-dual',
      systemName: '等级分',
      sparseX: false,
      showLabels: true,
      labelMode: 'auto',       // 'auto' | 'none' | 'endpoint' | 'extreme' | 'all'
      showPoints: true,         // 是否绘制数据点（线仍保留）
      sampling: 'auto',         // 'auto' | 'all'；日期轴长跨度自动概览采样
      smooth: true,
      showGrid: true,
      ptSize: 'auto', // 'auto', 2, 4, 6, 8, 10
      lineWidth: 2,
      startKey: null,
      endKey: null,
      // 单人单指标模式（棋手独立页）与可访问性／主题参数：
      metric: 'rating',        // 'rating' | 'rank'
      theme: null,             // 'dark' | 'light'；null 时沿用工作区原有判断
      breakOnMissing: true,    // 缺月断线（不跨缺月连线）
      idPrefix: '',            // 容器内局部 ID 前缀；空串保持工作区既有固定 ID
      chartTitle: null,
      hideTitle: false,        // 隐藏 SVG 内置大标题（棋手页已由外部栏位提供）
      emptyText: null,
      axisLabel: null,
      annotations: null,       // 可选夺冠标注 [{month_key, date, label, detail}]
      onPointClick: null,      // 可选点击节点回调 ({month_key, date})
    }, options);

    this.data = null;
    this.svg = null;
    this.tooltip = null;
    this._destroyed = false;
    this._lastWidth = null;
    this._hiddenSeries = new Set();
    this._pendingFocusLegendKey = null;
    this._fullscreenRenderer = null;
    this._ownedModal = false;
    this._fullscreenKeyHandler = null;

    // 容器宽度变化（含隐藏后显示）时重绘；只按宽度阈值触发，避免自激循环。
    if (container && typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(entries => {
        if (this._destroyed || !this.data) return;
        const width = entries[0]?.contentRect?.width || 0;
        if (!width) return;
        if (this._lastWidth === null) { this._lastWidth = width; return; }
        if (Math.abs(width - this._lastWidth) < 12) return;
        this._lastWidth = width;
        this.render();
      });
      this._resizeObserver.observe(container);
    }
  }

  setData(data) {
    this.data = data;
    this._hiddenSeries.clear();
    this.render();
  }

  setOptions(newOpts) {
    Object.assign(this.options, newOpts);
    this.render();
  }

  // 页面当前有效主题：显式参数优先（人物页使用 body[data-theme]），
  // 否则维持工作区既有判断（html.dark 或系统偏好），避免影响旧调用方。
  _isDark() {
    if (this.options.theme === 'dark') return true;
    if (this.options.theme === 'light') return false;
    return Boolean(document.documentElement.classList.contains('dark') ||
      window.matchMedia?.('(prefers-color-scheme: dark)')?.matches);
  }

  _ids() {
    const prefix = this.options.idPrefix;
    const containerId = this.container?.id;
    return {
      svg: prefix ? `${prefix}Svg` : (containerId === 'fullscreenChartContainer'
        ? 'fullscreenRatingsChartSvg' : 'ratingsChartSvg'),
      tooltip: prefix ? `${prefix}Tooltip` : 'chartTooltip',
      crosshair: prefix ? `${prefix}Crosshair` : 'chartCrosshair',
      halo: prefix ? `${prefix}Halo` : 'chartHoverHaloGroup',
    };
  }

  // 释放事件、观察器、tooltip 与本实例创建的全屏资源；可重复调用。
  destroy() {
    this._destroyed = true;
    if (this._resizeObserver) { this._resizeObserver.disconnect(); this._resizeObserver = null; }
    if (this._fullscreenKeyHandler) {
      window.removeEventListener('keydown', this._fullscreenKeyHandler);
      this._fullscreenKeyHandler = null;
    }
    if (this._fullscreenRenderer) { this._fullscreenRenderer.destroy(); this._fullscreenRenderer = null; }
    if (this._ownedModal) {
      document.getElementById('ratingsFullscreenModal')?.remove();
      this._ownedModal = false;
    }
    if (this.container) this.container.innerHTML = '';
    this.data = null;
    this.svg = null;
    this.tooltip = null;
    this._highlightHelper = null;
  }

  highlightMonth(keyOrDate) {
    if (this._highlightHelper) this._highlightHelper.showByKey(keyOrDate);
  }

  clearHighlight() {
    if (this._highlightHelper) this._highlightHelper.hide();
  }


  render() {
    if (!this.container) return;
    this.container.innerHTML = '';

    if (!this.data || !this.data.players || this.data.players.length === 0) {
      this.container.innerHTML = '<div class="ratings-chart-empty">暂无图表数据，请先输入棋手查询。</div>';
      return;
    }

    const allPlayers = this.data.players;
    let players = allPlayers;
    let mode = this.options.mode;

    // 智能模式自动校验（与原始逻辑一致）
    if (mode === 'two-diff' && players.length !== 2) {
      mode = players.length > 1 ? 'multi-rating' : 'single-dual';
      this.options.mode = mode;
    } else if (players.length > 1 && (mode === 'single-dual' || mode === 'single-circle' || mode === 'single-metric')) {
      mode = 'multi-rating';
      this.options.mode = mode;
    } else if (players.length === 1 && (mode === 'multi-rating' || mode === 'multi-rank' || mode === 'two-diff')) {
      mode = 'single-dual';
      this.options.mode = mode;
    }

    // 时间范围筛选（支持常规月度网格与 GoRatings 连续日期轴）
    const isDateAxis = Boolean(
      this.options.timeScale === 'date'
      || this.data.time_scale === 'date'
      || allPlayers.some(p => (p.history || []).some(h => Boolean(h.date)))
      || (this.data.diff_series || []).some(d => Boolean(d.date))
    );

    const labelMode = resolveLabelMode(this.options.labelMode, mode);
    const showPoints = this.options.showPoints !== false;
    const themeColors = getThemeColors(this.options.theme);
    const isDark = themeColors.isDark;
    const colors = themeColors;
    const colorMap = buildPlayerColorMap(allPlayers, colors.series);
    const notes = [];

    // 图例筛选：多人模式按隐藏集合过滤；其余模式忽略隐藏状态。
    if (mode === 'multi-rating' || mode === 'multi-rank') {
      players = allPlayers.filter(player => !this._hiddenSeries.has(playerColorKey(player)));
    }

    // 日期轴概览采样：长跨度逐局点只保留时间桶内的首末与极值；单指标详情页不抽样。
    const originalMaxPts = players.reduce((max, player) => Math.max(max, (player.history || []).length), 0);
    if (isDateAxis && this.options.sampling !== 'all' && mode !== 'single-metric' && mode !== 'two-diff') {
      const samples = [];
      players = players.map(player => {
        const sampled = sampleDatePoints(player.history || [], item => item.public_rating);
        if (!sampled.info) return player;
        samples.push(sampled.info);
        return Object.assign({}, player, {history: sampled.points});
      });
      if (samples.length > 0) {
        const original = samples.reduce((sum, item) => sum + item.original, 0);
        const kept = samples.reduce((sum, item) => sum + item.kept, 0);
        const bucket = Math.max(...samples.map(item => item.bucketMonths));
        notes.push(`概览：${original.toLocaleString('zh-CN')} 个原始点按约 ${bucket} 个月抽样为 ${kept.toLocaleString('zh-CN')} 个；可在“密度”中选择全部。`);
      }
    }

    const hasMkBounds = Boolean(this.options.startKey && this.options.endKey);
    const seriesSegments = points => (isDateAxis || !this.options.breakOnMissing)
      ? [points]
      : splitMonthPoints(points);
    const sKey = hasMkBounds ? Math.min(this.options.startKey, this.options.endKey) : null;
    const eKey = hasMkBounds ? Math.max(this.options.startKey, this.options.endKey) : null;

    let allMonths = (this.data.months || []).slice();
    let minTs = null;
    let maxTs = null;

    if (isDateAxis) {
      const allTimestamps = [];
      const collectTs = list => {
        (list || []).forEach(item => {
          if (!item) return;
          if (hasMkBounds && item.month_key && (item.month_key < sKey || item.month_key > eKey)) return;
          const ts = parseDateMs(item.date || item.month_str);
          if (ts !== null) allTimestamps.push(ts);
        });
      };
      players.forEach(p => {
        collectTs(p.history);
        collectTs(p.annual_snapshots);
      });
      collectTs(this.data.diff_series);
      if (allTimestamps.length === 0) {
        this.container.innerHTML = '<div class="ratings-chart-empty">选定时间范围内没有有效日期数据。</div>';
        return;
      }
      minTs = Math.min(...allTimestamps);
      maxTs = Math.max(...allTimestamps);
      if (minTs === maxTs) {
        minTs -= 15 * 86400000;
        maxTs += 15 * 86400000;
      }
    } else {
      if (hasMkBounds) {
        allMonths = allMonths.filter(m => m.month_key >= sKey && m.month_key <= eKey);
      }
      if (allMonths.length === 0) {
        this.container.innerHTML = '<div class="ratings-chart-empty">选定时间范围内没有有效数据。</div>';
        return;
      }
    }

    const monthKeys = allMonths.map(m => m.month_key);
    const monthStrs = allMonths.map(m => m.month_str);
    const monthIndexMap = new Map();
    monthKeys.forEach((mk, i) => monthIndexMap.set(mk, i));

    const maxPlayerPts = players.reduce((m, p) => Math.max(m, (p.history || []).length), 0);
    const denseMode = isDateAxis && originalMaxPts > 220;
    const spanCountForSize = isDateAxis ? maxPlayerPts : monthKeys.length;
    const useSmooth = Boolean(this.options.smooth) && !denseMode;
    const shouldDrawPointDot = (idx, total, isExtreme) => (
      !isDateAxis || total <= 140 || isExtreme || idx % Math.ceil(total / 24) === 0
    );

    // 自适应有效点大小（按时间跨度与对比人数分档平滑缩放，避免长跨度实心线过粗）
    let effPtSize = 6;
    const playerFactor = players.length > 2 ? 0.85 : 1;
    if (this.options.ptSize === 'auto' || !this.options.ptSize) {
      if (spanCountForSize > 200) effPtSize = 2.2;
      else if (spanCountForSize > 90) effPtSize = 2.0;
      else if (spanCountForSize > 60) effPtSize = 2.6;
      else if (spanCountForSize > 36) effPtSize = 3.4;
      else if (spanCountForSize > 20) effPtSize = 4.5;
      else effPtSize = 6;
      effPtSize = Math.max(1.8, Math.round(effPtSize * playerFactor * 10) / 10);
    } else {
      effPtSize = Number(this.options.ptSize) || 6;
    }

    // 画布尺寸与边距（顶边距 68 留足标题与图例间距，底边距 96 彻底避免 X 轴月份标签截断）
    const width = 1000;
    const height = 560;
    const endLabelGutter = (mode === 'multi-rating' || mode === 'multi-rank') &&
      (labelMode === 'endpoint' || labelMode === 'extreme') ? 118 : 0;
    const margin = {
      top: 68,
      right: (mode === 'single-dual' ? 70 : 40) + endLabelGutter,
      bottom: 96,
      left: 70
    };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;

    const ids = this._ids();

    // 窄容器（手机）保留画布字号与横向滚动，但把标题改为左对齐并稀疏横轴标签，
    // 避免固定 1000 宽画布在 390px 视口中把标题与月份文字裁掉。
    const compact = Boolean(this.container && this.container.clientWidth > 0 &&
      this.container.clientWidth < 620);

    const timeLabels = isDateAxis ? [] : buildTimeLabels(monthStrs, this.options.sparseX || compact);

    // X 坐标映射（支持离散月份与连续 UTC 日期轴）
    const getX = (mKey) => {
      if (isDateAxis) {
        const ts = parseDateMs(mKey);
        if (ts === null) return null;
        return margin.left + ((ts - minTs) / Math.max(1, maxTs - minTs)) * plotWidth;
      }
      const idx = monthIndexMap.get(mKey);
      if (idx === undefined) return null;
      if (monthKeys.length === 1) return margin.left + plotWidth / 2;
      return margin.left + (idx / (monthKeys.length - 1)) * plotWidth;
    };

    const inAxis = item => {
      if (!item) return false;
      if (!isDateAxis) return monthIndexMap.has(item.month_key);
      if (hasMkBounds && item.month_key && (item.month_key < sKey || item.month_key > eKey)) return false;
      const ts = parseDateMs(item.date || item.month_str);
      return ts !== null && ts >= minTs && ts <= maxTs;
    };

    const getXItem = item => isDateAxis
      ? getX(item.date || item.month_str)
      : getX(item.month_key);

    const itemDetailKey = item => isDateAxis
      ? (item.date || item.month_str || String(item.month_key))
      : item.month_key;

    // 构建 SVG
    const svgWrap = document.createElement('div');
    svgWrap.className = 'ratings-chart-svg-wrap';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('id', ids.svg);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('class', 'ratings-chart-svg');
    svg.setAttribute('role', 'img');
    this.svg = svg;

    // 背景底板
    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bgRect.setAttribute('class', 'chart-bg-rect');
    bgRect.setAttribute('width', width);
    bgRect.setAttribute('height', height);
    bgRect.setAttribute('fill', colors.bg);
    bgRect.setAttribute('rx', '8');
    svg.appendChild(bgRect);

    // 图表标题
    const playerNames = players.map(p => p.player_clean).join('、');
    let chartTitle = this.options.chartTitle || `${this.options.systemName}历史走势 [${playerNames}]`;
    if (mode === 'two-diff' && players.length === 2) {
      chartTitle = `${this.options.systemName} [${players[0].player_clean} vs ${players[1].player_clean}] - 历史分差走势`;
    } else if (mode === 'multi-rank') {
      chartTitle = `${this.options.systemName}排名历史走势 [${playerNames}]`;
    }
    svg.setAttribute('aria-label', chartTitle);

    if (!this.options.hideTitle) {
      const titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      titleEl.setAttribute('x', compact ? margin.left : width / 2);
      titleEl.setAttribute('y', compact ? 22 : 25);
      titleEl.setAttribute('text-anchor', compact ? 'start' : 'middle');
      titleEl.setAttribute('fill', colors.text);
      titleEl.setAttribute('font-size', compact ? '13' : '15.5');
      titleEl.setAttribute('font-weight', '700');
      titleEl.textContent = chartTitle;
      svg.appendChild(titleEl);
    }

    // X 轴刻度与标签
    const xAxisG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    xAxisG.setAttribute('class', 'chart-axis chart-axis-x');

    const xAxisLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    xAxisLine.setAttribute('x1', margin.left);
    xAxisLine.setAttribute('y1', margin.top + plotHeight);
    xAxisLine.setAttribute('x2', margin.left + plotWidth);
    xAxisLine.setAttribute('y2', margin.top + plotHeight);
    xAxisLine.setAttribute('stroke', colors.axis);
    xAxisLine.setAttribute('stroke-width', '1.2');
    xAxisG.appendChild(xAxisLine);

    const xTicksToDraw = isDateAxis
      ? buildDateAxisTicks(minTs, maxTs, this.options.sparseX || compact).map((tk, idx, arr) => ({
          x: margin.left + ((tk.ts - minTs) / Math.max(1, maxTs - minTs)) * plotWidth,
          labelText: tk.label,
          drawGrid: idx > 0 && idx < arr.length - 1
        }))
      : monthKeys.map((mk, idx) => ({
          x: getX(mk),
          labelText: timeLabels[idx],
          drawGrid: idx > 0 && idx < monthKeys.length - 1
        })).filter(t => Boolean(t.labelText));

    xTicksToDraw.forEach(tk => {
      const x = tk.x;
      const tickLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      tickLine.setAttribute('x1', x);
      tickLine.setAttribute('y1', margin.top + plotHeight);
      tickLine.setAttribute('x2', x);
      tickLine.setAttribute('y2', margin.top + plotHeight + 5);
      tickLine.setAttribute('stroke', colors.axis);
      xAxisG.appendChild(tickLine);

      if (this.options.showGrid && tk.drawGrid) {
        const gridV = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        gridV.setAttribute('x1', x);
        gridV.setAttribute('y1', margin.top);
        gridV.setAttribute('x2', x);
        gridV.setAttribute('y2', margin.top + plotHeight);
        gridV.setAttribute('stroke', colors.grid);
        gridV.setAttribute('stroke-dasharray', '2 3');
        xAxisG.appendChild(gridV);
      }

      const labelEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      labelEl.setAttribute('x', x);
      labelEl.setAttribute('y', margin.top + plotHeight + 16);
      labelEl.setAttribute('transform', `rotate(-45 ${x} ${margin.top + plotHeight + 16})`);
      labelEl.setAttribute('text-anchor', 'end');
      labelEl.setAttribute('fill', colors.textMuted);
      labelEl.setAttribute('font-size', '10');
      labelEl.textContent = tk.labelText;
      xAxisG.appendChild(labelEl);
    });
    svg.appendChild(xAxisG);

    // 交互辅助集
    const interactiveData = [];

    // =========================================================================
    // 分支 0：单人-单指标（棋手独立页；公示分或公布排名单幅图）
    // 缺月断线：只连接连续日历月都有有效点的片段，绝不跨缺月连线或补零。
    // =========================================================================
    if (mode === 'single-metric') {
      const player = players[0];
      const isRank = this.options.metric === 'rank';
      const metricColor = isRank ? colors.rankLine : colors.primaryLine;
      const numeric = value => {
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? number : null;
      };
      const sourceEntries = isDateAxis
        ? ((isRank && player.annual_snapshots && player.annual_snapshots.length)
            ? player.annual_snapshots : (player.history || []))
            .filter(h => inAxis(h) && numeric(isRank ? h.rank : h.public_rating) !== null)
        : [];
      const valueByMonth = new Map();
      if (!isDateAxis) {
        monthKeys.forEach(mk => {
          const entry = (player.history || []).find(h => h.month_key === mk);
          if (!entry) return;
          const value = numeric(isRank ? entry.rank : entry.public_rating);
          if (value !== null) valueByMonth.set(mk, value);
        });
      }

      if (isDateAxis ? sourceEntries.length === 0 : valueByMonth.size === 0) {
        const message = this.options.emptyText
          || (isRank ? '选定范围内没有可用的公布排名记录。' : '选定范围内没有有效公示分记录。');
        this.container.innerHTML = `<div class="ratings-chart-empty">${escapeXml(message)}</div>`;
        return;
      }

      const values = isDateAxis
        ? sourceEntries.map(h => numeric(isRank ? h.rank : h.public_rating))
        : Array.from(valueByMonth.values());
      let minV = Math.min(...values);
      let maxV = Math.max(...values);
      if (isRank) {
        minV = Math.max(1, minV - 2);
        maxV = maxV + 2;
        if (maxV - minV < 4) maxV = minV + 4;
      } else {
        const pad = Math.max(10, (maxV - minV) * 0.15);
        minV = Math.floor(minV - pad);
        maxV = Math.ceil(maxV + pad);
        if (maxV - minV < 1) { minV -= 20; maxV += 20; }
      }

      // 排名数字越小位置越高：倒置映射。
      const getY = value => {
        const ratio = (Number(value) - minV) / (maxV - minV);
        return isRank ? margin.top + ratio * plotHeight : margin.top + plotHeight - ratio * plotHeight;
      };

      // 窄容器下标题已左对齐占用首行，不再重复绘制轴标题。
      if (!compact) {
        const axisLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        axisLabel.setAttribute('class', 'chart-axis-label');
        axisLabel.setAttribute('x', margin.left);
        axisLabel.setAttribute('y', margin.top - 30);
        axisLabel.setAttribute('text-anchor', 'start');
        axisLabel.setAttribute('fill', metricColor);
        axisLabel.setAttribute('font-size', '11');
        axisLabel.setAttribute('font-weight', '600');
        axisLabel.textContent = this.options.axisLabel || (isRank ? '公布排名' : '公示分');
        svg.appendChild(axisLabel);
      }

      const shownTicks = new Set();
      const ySteps = 5;
      for (let i = 0; i <= ySteps; i++) {
        const tickValue = Math.round(minV + (i / ySteps) * (maxV - minV));
        if (shownTicks.has(tickValue)) continue;
        shownTicks.add(tickValue);
        const y = getY(tickValue);
        if (this.options.showGrid) {
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', margin.left);
          line.setAttribute('y1', y);
          line.setAttribute('x2', margin.left + plotWidth);
          line.setAttribute('y2', y);
          line.setAttribute('stroke', colors.grid);
          svg.appendChild(line);
        }
        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.setAttribute('x', margin.left - 8);
        txt.setAttribute('y', y + 3);
        txt.setAttribute('text-anchor', 'end');
        txt.setAttribute('fill', metricColor);
        txt.setAttribute('font-size', '10');
        txt.textContent = isRank ? `第${tickValue}名` : String(tickValue);
        svg.appendChild(txt);
      }

      // 按连续月份切分线段：缺月处断开（连续日期轴按有效对局日依次连线）。
      const segments = [];
      let current = [];
      if (isDateAxis) {
        sourceEntries.forEach(entry => {
          const val = numeric(isRank ? entry.rank : entry.public_rating);
          if (val === null) return;
          current.push({
            x: getXItem(entry),
            y: getY(val),
            month_key: entry.month_key,
            date: entry.date || entry.month_str,
            value: val
          });
        });
        if (current.length) segments.push(current);
      } else {
        monthKeys.forEach(mk => {
          if (!valueByMonth.has(mk)) {
            if (current.length) { segments.push(current); current = []; }
            return;
          }
          current.push({ x: getX(mk), y: getY(valueByMonth.get(mk)), month_key: mk, value: valueByMonth.get(mk) });
        });
        if (current.length) segments.push(current);
      }

      segments.forEach(segment => {
        if (segment.length < 2) return;
        const pathD = useSmooth && segment.length > 2
          ? buildSplinePath(segment)
          : segment.map((point, index) =>
            `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        line.setAttribute('class', 'chart-line chart-line-metric');
        line.setAttribute('data-player', player.player_clean);
        line.setAttribute('d', pathD);
        line.setAttribute('fill', 'none');
        line.setAttribute('stroke', metricColor);
        line.setAttribute('stroke-width', this.options.lineWidth);
        line.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(line);
      });

      const validCount = isDateAxis ? sourceEntries.length : valueByMonth.size;
      const edgeMonths = new Set();
      segments.forEach(segment => {
        if (!segment.length) return;
        edgeMonths.add(segment[0].date || segment[0].month_key);
        edgeMonths.add(segment[segment.length - 1].date || segment[segment.length - 1].month_key);
      });

      const dotStrokeW = effPtSize <= 3 ? '0.9' : '1.4';
      const labelCandidates = [];
      const flatPoints = [];
      segments.forEach(segment => segment.forEach(pt => flatPoints.push(pt)));
      const flatVals = flatPoints.map(pt => pt.value);

      flatPoints.forEach((point, idx) => {
        const isMinMax = point.value === Math.min(...flatVals) || point.value === Math.max(...flatVals);
        const isEdge = edgeMonths.has(point.date || point.month_key);
        if (showPoints && shouldDrawPointDot(idx, flatPoints.length, isMinMax || isEdge)) {
          const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          dot.setAttribute('class', 'chart-point');
          dot.setAttribute('data-player', player.player_clean);
          dot.setAttribute('cx', point.x);
          dot.setAttribute('cy', point.y);
          dot.setAttribute('r', effPtSize);
          dot.setAttribute('fill', metricColor);
          dot.setAttribute('stroke', colors.bg);
          dot.setAttribute('stroke-width', dotStrokeW);
          svg.appendChild(dot);
        }

        if (labelMode !== 'none') {
          const isEdge = edgeMonths.has(point.date || point.month_key);
          let show;
          if (labelMode === 'all') {
            show = validCount <= 18
              ? isEdge || idx % 2 === 0 || shouldDisplayLabel(idx, flatVals, flatVals.length, isRank)
              : (isEdge || shouldDisplayLabel(idx, flatVals, flatVals.length, isRank));
          } else {
            show = labelWanted(labelMode, {
              isEndpoint: isEdge,
              isExtreme: isMinMax,
              index: idx,
              values: flatVals,
              total: flatVals.length,
              isRank
            });
          }
          if (show) {
            labelCandidates.push({
              x: point.x,
              anchorY: point.y,
              text: isRank ? String(point.value) : point.value.toFixed(1),
              color: metricColor,
              preferAbove: !isRank,
              priority: isEdge ? 4 : (isMinMax ? 3 : 1),
              offset: Math.max(7, effPtSize + 4)
            });
          }
        }
      });

      if (labelCandidates.length > 0) {
        placePointLabels(svg, labelCandidates, { left: margin.left, top: margin.top, width: plotWidth, height: plotHeight }, {
          fontSize: 8.5,
          leaderColor: metricColor
        });
      }

      if (isDateAxis) {
        flatPoints.forEach(pt => {
          interactiveData.push({
            month_key: pt.month_key,
            date: pt.date,
            x: pt.x,
            points: [{ x: pt.x, y: pt.y, color: metricColor }],
            details: [
              { label: player.player_clean, value: isRank ? `第 ${pt.value} 名` : `${pt.value.toFixed(1)}分`, color: metricColor },
              { label: '口径', value: isRank ? '年度/实时榜单' : 'WHR 对局日记录', color: colors.textMuted }
            ]
          });
        });
      } else {
        monthKeys.forEach(mk => {
          const x = getX(mk);
          const hasValue = valueByMonth.has(mk);
          const state = (this.data.monthStates || {})[mk];
          const value = valueByMonth.get(mk);
          interactiveData.push({
            month_key: mk,
            x,
            points: hasValue ? [{ x, y: getY(value), color: metricColor }] : [],
            empty: !hasValue,
            details: hasValue
              ? [
                { label: player.player_clean, value: isRank ? `第 ${value} 名` : `${value.toFixed(1)}分`, color: metricColor },
                { label: '资料状态', value: (state && state.label) || '有效记录', color: colors.textMuted }
              ]
              : [{ label: '该月', value: (state && state.label) || '无有效记录', color: colors.textMuted }]
          });
        });
      }

      const desc = document.createElementNS('http://www.w3.org/2000/svg', 'desc');
      desc.textContent = `${chartTitle}；有效月份 ${validCount} 个。`;
      svg.appendChild(desc);

      // 夺冠里程碑标注：按月或对局日吸附到曲线点，并在 Tooltip 中追加赛事。
      const annotations = Array.isArray(this.options.annotations) ? this.options.annotations : [];
      if (!isRank && annotations.length && interactiveData.length) {
        const annotG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        annotG.setAttribute('class', 'chart-annotations');
        const gold = this._isDark() ? '#f5c451' : '#d97706';
        annotations.forEach(item => {
          const rawDate = String(item.date || '');
          const mk = Number(item.month_key) || (rawDate.length >= 7 ? Number(rawDate.slice(0, 7).replace('-', '')) : 0);
          if (!mk && !rawDate) return;
          let target = null;
          if (isDateAxis && rawDate) {
            target = interactiveData.find(d => d.date && d.date >= rawDate) || null;
            if (!target && mk) target = interactiveData.find(d => d.month_key === mk) || null;
          } else if (mk) {
            target = interactiveData.find(d => d.month_key === mk) || null;
          }
          if (!target) return;
          const pt = target.points && target.points[0];
          const ax = pt ? pt.x : target.x;
          const ay = pt ? pt.y : (margin.top + 14);
          const vline = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          vline.setAttribute('x1', ax);
          vline.setAttribute('x2', ax);
          vline.setAttribute('y1', margin.top + 4);
          vline.setAttribute('y2', margin.top + plotHeight);
          vline.setAttribute('stroke', gold);
          vline.setAttribute('stroke-width', '1');
          vline.setAttribute('stroke-dasharray', '2 3');
          vline.setAttribute('opacity', '0.55');
          annotG.appendChild(vline);

          const marker = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          const my = Math.max(margin.top + 8, ay - 9);
          marker.setAttribute('d', `M ${ax} ${my - 5} L ${ax + 4.5} ${my} L ${ax} ${my + 5} L ${ax - 4.5} ${my} Z`);
          marker.setAttribute('fill', gold);
          marker.setAttribute('stroke', colors.bg);
          marker.setAttribute('stroke-width', '1');
          annotG.appendChild(marker);

          target.details.push({
            label: '夺冠',
            value: item.label || '',
            color: gold,
          });
        });
        if (annotG.children.length) svg.appendChild(annotG);
      }

    } else if (mode === 'two-diff') {
      const p1 = players[0];
      const p2 = players[1];

      const diffPoints = [];
      if (isDateAxis && Array.isArray(this.data.diff_series) && this.data.diff_series.length > 0) {
        this.data.diff_series.forEach(d => {
          if (!inAxis(d)) return;
          if (d.diff !== undefined && d.diff !== null && d.p1_rating !== undefined && d.p2_rating !== undefined) {
            diffPoints.push({
              month_key: d.month_key,
              date: d.date || d.month_str,
              diff: d.diff,
              r1: d.p1_rating,
              r2: d.p2_rating
            });
          }
        });
      } else {
        const p1Map = new Map((p1.history || []).map(h => [itemDetailKey(h), h]));
        const p2Map = new Map((p2.history || []).map(h => [itemDetailKey(h), h]));

        if (isDateAxis) {
          p1Map.forEach((h1, key) => {
            const h2 = p2Map.get(key);
            if (!h2 || !inAxis(h1)) return;
            const r1 = h1.public_rating;
            const r2 = h2.public_rating;
            if (r1 !== undefined && r1 !== null && r2 !== undefined && r2 !== null) {
              diffPoints.push({
                month_key: h1.month_key,
                date: h1.date || h1.month_str,
                diff: Math.round((r1 - r2) * 10) / 10,
                r1,
                r2
              });
            }
          });
          diffPoints.sort((a, b) => String(a.date || a.month_key).localeCompare(String(b.date || b.month_key)));
        } else {
          monthKeys.forEach(mk => {
            const h1 = p1Map.get(mk);
            const h2 = p2Map.get(mk);
            const r1 = h1 ? h1.public_rating : undefined;
            const r2 = h2 ? h2.public_rating : undefined;
            if (r1 !== undefined && r1 !== null && r2 !== undefined && r2 !== null) {
              diffPoints.push({
                month_key: mk,
                diff: Math.round((r1 - r2) * 10) / 10,
                r1,
                r2
              });
            }
          });
        }
      }

      if (diffPoints.length === 0) {
        this.container.innerHTML = `<div class="ratings-chart-empty">选定时间范围内两位棋手没有${isDateAxis ? '共同时间段' : '共同月份'}的等级分记录。</div>`;
        return;
      }

      const diffs = diffPoints.map(p => p.diff);
      let maxAbsDiff = Math.max(...diffs.map(Math.abs), 20);
      maxAbsDiff = Math.ceil(maxAbsDiff * 1.15);

      const getY = (diffVal) => {
        const ratio = (diffVal - (-maxAbsDiff)) / (maxAbsDiff * 2);
        return margin.top + plotHeight - ratio * plotHeight;
      };

      const zeroY = getY(0);

      // Y 轴刻度与横向网格
      const ySteps = 4;
      for (let i = -ySteps; i <= ySteps; i++) {
        const val = Math.round((i / ySteps) * maxAbsDiff);
        const y = getY(val);

        if (this.options.showGrid) {
          const gridLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          gridLine.setAttribute('x1', margin.left);
          gridLine.setAttribute('y1', y);
          gridLine.setAttribute('x2', margin.left + plotWidth);
          gridLine.setAttribute('y2', y);
          gridLine.setAttribute('stroke', val === 0 ? colors.zeroLine : colors.grid);
          gridLine.setAttribute('stroke-width', val === 0 ? '1.5' : '1');
          if (val === 0) gridLine.setAttribute('stroke-dasharray', '4 3');
          svg.appendChild(gridLine);
        }

        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', margin.left - 8);
        label.setAttribute('y', y + 3);
        label.setAttribute('text-anchor', 'end');
        label.setAttribute('fill', colors.textMuted);
        label.setAttribute('font-size', '10');
        label.textContent = val > 0 ? `+${val}` : String(val);
        svg.appendChild(label);
      }

      // 填充红蓝区域（多边形）
      const pts = diffPoints.map(p => ({ x: getXItem(p), y: getY(p.diff), p }));

      for (let i = 0; i < pts.length - 1; i++) {
        const pt1 = pts[i];
        const pt2 = pts[i + 1];

        // 符号相同，直接梯形填充
        if ((pt1.p.diff >= 0 && pt2.p.diff >= 0) || (pt1.p.diff <= 0 && pt2.p.diff <= 0)) {
          const isPos = pt1.p.diff >= 0 && pt2.p.diff >= 0;
          const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          poly.setAttribute('class', isPos ? 'chart-fill-positive' : 'chart-fill-negative');
          poly.setAttribute('points', `${pt1.x},${zeroY} ${pt1.x},${pt1.y} ${pt2.x},${pt2.y} ${pt2.x},${zeroY}`);
          poly.setAttribute('fill', isPos ? '#ef4444' : '#3b82f6');
          poly.setAttribute('fill-opacity', '0.22');
          svg.appendChild(poly);
        } else {
          // 穿越零线插值交点
          const t = Math.abs(pt1.p.diff) / (Math.abs(pt1.p.diff) + Math.abs(pt2.p.diff));
          const crossX = pt1.x + t * (pt2.x - pt1.x);

          const poly1 = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          poly1.setAttribute('class', pt1.p.diff >= 0 ? 'chart-fill-positive' : 'chart-fill-negative');
          poly1.setAttribute('points', `${pt1.x},${zeroY} ${pt1.x},${pt1.y} ${crossX},${zeroY}`);
          poly1.setAttribute('fill', pt1.p.diff >= 0 ? '#ef4444' : '#3b82f6');
          poly1.setAttribute('fill-opacity', '0.22');
          svg.appendChild(poly1);

          const poly2 = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          poly2.setAttribute('class', pt2.p.diff >= 0 ? 'chart-fill-positive' : 'chart-fill-negative');
          poly2.setAttribute('points', `${crossX},${zeroY} ${pt2.x},${pt2.y} ${pt2.x},${zeroY}`);
          poly2.setAttribute('fill', pt2.p.diff >= 0 ? '#ef4444' : '#3b82f6');
          poly2.setAttribute('fill-opacity', '0.22');
          svg.appendChild(poly2);
        }
      }

      // 绘制分差曲线
      const pathD = useSmooth ? buildSplinePath(pts) : pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
      const diffLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      diffLine.setAttribute('class', 'chart-line chart-diff-line');
      diffLine.setAttribute('data-player', '分差曲线');
      diffLine.setAttribute('d', pathD);
      diffLine.setAttribute('fill', 'none');
      diffLine.setAttribute('stroke', isDark ? '#f8fafc' : '#1e293b');
      diffLine.setAttribute('stroke-width', this.options.lineWidth);
      svg.appendChild(diffLine);

      // 数据点与防重叠数值标注
      const diffVals = pts.map(pt => pt.p.diff);
      const maxAbsDiffSeen = Math.max(...diffVals.map(Math.abs));
      const dotStrokeW = effPtSize <= 3 ? '0.9' : '1.4';
      const labelCandidates = [];

      pts.forEach((p, idx) => {
        const isEndpoint = idx === 0 || idx === pts.length - 1;
        const isExtreme = isEndpoint || Math.abs(p.p.diff) === maxAbsDiffSeen;
        if (showPoints && shouldDrawPointDot(idx, pts.length, isExtreme)) {
          const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          dot.setAttribute('class', 'chart-point');
          dot.setAttribute('data-player', '分差曲线');
          dot.setAttribute('cx', p.x);
          dot.setAttribute('cy', p.y);
          dot.setAttribute('r', effPtSize);
          dot.setAttribute('fill', p.p.diff >= 0 ? '#ef4444' : '#3b82f6');
          dot.setAttribute('stroke', colors.bg);
          dot.setAttribute('stroke-width', dotStrokeW);
          svg.appendChild(dot);
        }

        if (labelMode !== 'none' && labelWanted(labelMode, {
          isEndpoint, isExtreme, index: idx, values: diffVals, total: pts.length
        })) {
          labelCandidates.push({
            x: p.x,
            anchorY: p.y,
            text: p.p.diff > 0 ? `+${p.p.diff}` : String(p.p.diff),
            color: p.p.diff >= 0 ? '#ef4444' : '#3b82f6',
            preferAbove: p.p.diff >= 0,
            priority: isEndpoint ? 4 : (isExtreme ? 3 : 1),
            offset: Math.max(7, effPtSize + 4)
          });
        }

        interactiveData.push({
          month_key: p.p.month_key,
          date: p.p.date || null,
          x: p.x,
          points: [{ x: p.x, y: p.y, color: p.p.diff >= 0 ? '#ef4444' : '#3b82f6' }],
          details: [
            { label: p1.player_clean, value: `${p.p.r1.toFixed(1)}分`, color: '#ef4444' },
            { label: p2.player_clean, value: `${p.p.r2.toFixed(1)}分`, color: '#3b82f6' },
            {
              label: '分差 (' + p1.player_clean + ' - ' + p2.player_clean + ')',
              value: (p.p.diff > 0 ? `+${p.p.diff} (${p1.player_clean}领先)` : (p.p.diff < 0 ? `${p.p.diff} (${p2.player_clean}领先)` : '持平 0.0')),
              color: p.p.diff >= 0 ? '#ef4444' : '#3b82f6'
            }
          ]
        });
      });

      if (labelCandidates.length > 0) {
        placePointLabels(svg, labelCandidates, { left: margin.left, top: margin.top, width: plotWidth, height: plotHeight }, {
          fontSize: 8.5,
          leaderColor: colors.textMuted
        });
      }

      // 图例
      this._renderLegend(svg, [
        { label: `${p1.player_clean} 领先`, color: '#ef4444' },
        { label: `${p2.player_clean} 领先`, color: '#3b82f6' },
        { label: '分差', color: isDark ? '#f8fafc' : '#1e293b' }
      ], width, margin, colors);

    } else if (mode === 'single-dual') {
      // =========================================================================
      // 分支 2：单人-独立双线（等级分 Y1，排名 Y2 倒置）
      // =========================================================================
      const player = players[0];
      const validHistory = (player.history || []).filter(h => inAxis(h) && h.public_rating !== null && h.public_rating > 0);
      const rankSource = (isDateAxis && Array.isArray(player.annual_snapshots) && player.annual_snapshots.length > 0)
        ? player.annual_snapshots
        : validHistory;
      const validRankHistory = rankSource.filter(h => inAxis(h) && h.rank !== null && h.rank !== undefined);

      if (validHistory.length === 0) {
        this.container.innerHTML = '<div class="ratings-chart-empty">该棋手在选定时间范围内没有有效等级分记录。</div>';
        return;
      }

      const ratings = validHistory.map(h => h.public_rating);
      const ranks = validRankHistory.map(h => h.rank);

      let minR = Math.min(...ratings);
      let maxR = Math.max(...ratings);
      const padR = Math.max(15, (maxR - minR) * 0.1);
      minR = Math.floor(minR - padR);
      maxR = Math.ceil(maxR + padR);

      let minRank = ranks.length > 0 ? Math.min(...ranks) : 1;
      let maxRank = ranks.length > 0 ? Math.max(...ranks) : 10;
      if (minRank === maxRank) { minRank = 1; maxRank = Math.max(5, minRank + 4); }

      const getY1 = (rVal) => {
        const ratio = (rVal - minR) / (maxR - minR);
        return margin.top + plotHeight - ratio * plotHeight;
      };

      // Y2 排名倒置：第 1 名在最上方
      const getY2 = (rankVal) => {
        const ratio = (rankVal - minRank) / (maxRank - minRank);
        return margin.top + ratio * plotHeight;
      };

      // 绘制 Y1 轴标签（等级分）
      const y1Title = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      y1Title.setAttribute('class', 'chart-axis-label');
      y1Title.setAttribute('x', margin.left);
      y1Title.setAttribute('y', margin.top - 12);
      y1Title.setAttribute('text-anchor', 'start');
      y1Title.setAttribute('fill', colors.primaryLine);
      y1Title.setAttribute('font-size', '11');
      y1Title.setAttribute('font-weight', '600');
      y1Title.textContent = '等级分';
      svg.appendChild(y1Title);

      const y2Title = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      y2Title.setAttribute('class', 'chart-axis-label');
      y2Title.setAttribute('x', margin.left + plotWidth);
      y2Title.setAttribute('y', margin.top - 12);
      y2Title.setAttribute('text-anchor', 'end');
      y2Title.setAttribute('fill', colors.rankLine);
      y2Title.setAttribute('font-size', '11');
      y2Title.setAttribute('font-weight', '600');
      y2Title.textContent = isDateAxis ? '榜单排名' : '当月排名';
      svg.appendChild(y2Title);

      const y1Steps = 5;
      for (let i = 0; i <= y1Steps; i++) {
        const val = Math.round(minR + (i / y1Steps) * (maxR - minR));
        const y = getY1(val);

        if (this.options.showGrid) {
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', margin.left);
          line.setAttribute('y1', y);
          line.setAttribute('x2', margin.left + plotWidth);
          line.setAttribute('y2', y);
          line.setAttribute('stroke', colors.grid);
          svg.appendChild(line);
        }

        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.setAttribute('x', margin.left - 8);
        txt.setAttribute('y', y + 3);
        txt.setAttribute('text-anchor', 'end');
        txt.setAttribute('fill', colors.primaryLine);
        txt.setAttribute('font-size', '10');
        txt.textContent = val;
        svg.appendChild(txt);
      }

      // Y2 轴刻度
      const y2Steps = 4;
      for (let i = 0; i <= y2Steps; i++) {
        const rVal = Math.round(minRank + (i / y2Steps) * (maxRank - minRank));
        const y = getY2(rVal);

        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.setAttribute('x', margin.left + plotWidth + 8);
        txt.setAttribute('y', y + 3);
        txt.setAttribute('text-anchor', 'start');
        txt.setAttribute('fill', colors.rankLine);
        txt.setAttribute('font-size', '10');
        txt.textContent = `第 ${rVal} 名`;
        svg.appendChild(txt);
      }

      // 绘制等级分曲线（月度轴缺月断线；日期轴逐局连续）
      const pts1 = validHistory.map(h => ({ x: getXItem(h), y: getY1(h.public_rating), h }));
      const ratingSegments = seriesSegments(pts1);
      ratingSegments.forEach(segment => {
        const pathD = pathForPoints(segment, useSmooth);
        if (!pathD) return;
        const lineEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        lineEl.setAttribute('class', 'chart-line chart-line-rating');
        lineEl.setAttribute('data-player', player.player_clean);
        lineEl.setAttribute('d', pathD);
        lineEl.setAttribute('fill', 'none');
        lineEl.setAttribute('stroke', colors.primaryLine);
        lineEl.setAttribute('stroke-width', this.options.lineWidth);
        svg.appendChild(lineEl);
      });

      // 绘制排名曲线 (方块点线)
      const pts2 = validRankHistory.map(h => ({ x: getXItem(h), y: getY2(h.rank), h }));
      const rankSegments = seriesSegments(pts2);
      rankSegments.forEach(segment => {
        const pathD = pathForPoints(segment, useSmooth);
        if (!pathD) return;
        const lineEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        lineEl.setAttribute('class', 'chart-line chart-line-rank');
        lineEl.setAttribute('data-player', player.player_clean);
        lineEl.setAttribute('d', pathD);
        lineEl.setAttribute('fill', 'none');
        lineEl.setAttribute('stroke', colors.rankLine);
        lineEl.setAttribute('stroke-width', this.options.lineWidth);
        lineEl.setAttribute('stroke-dasharray', '4 3');
        svg.appendChild(lineEl);
      });

      // 绘制数据点与防重叠数值标签
      const dotStrokeW = effPtSize <= 3 ? '0.9' : '1.3';
      const labelCandidates = [];
      const minRatingSeen = Math.min(...ratings);
      const maxRatingSeen = Math.max(...ratings);

      pts1.forEach((p, idx) => {
        const isEndpoint = idx === 0 || idx === pts1.length - 1;
        const isExtreme = isEndpoint || p.h.public_rating === maxRatingSeen || p.h.public_rating === minRatingSeen;
        if (showPoints && shouldDrawPointDot(idx, pts1.length, isExtreme)) {
          const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          dot.setAttribute('class', 'chart-point');
          dot.setAttribute('data-player', player.player_clean);
          dot.setAttribute('cx', p.x);
          dot.setAttribute('cy', p.y);
          dot.setAttribute('r', effPtSize);
          dot.setAttribute('fill', colors.primaryLine);
          dot.setAttribute('stroke', colors.bg);
          dot.setAttribute('stroke-width', dotStrokeW);
          svg.appendChild(dot);
        }

        if (labelMode !== 'none' && labelWanted(labelMode, {
          isEndpoint, isExtreme, index: idx, values: ratings, total: pts1.length
        })) {
          labelCandidates.push({
            x: p.x,
            anchorY: p.y,
            text: p.h.public_rating.toFixed(1),
            color: colors.primaryLine,
            preferAbove: true,
            priority: isEndpoint ? 4 : (isExtreme ? 3 : 1),
            offset: Math.max(7, effPtSize + 4)
          });
        }
      });

      const sqSize = Math.max(1.8, effPtSize - 0.8);
      pts2.forEach((p, idx) => {
        const isEndpoint = idx === 0 || idx === pts2.length - 1;
        const isExtreme = isEndpoint || p.h.rank === minRank;
        if (showPoints && shouldDrawPointDot(idx, pts2.length, isExtreme)) {
          const sq = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          sq.setAttribute('class', 'chart-point');
          sq.setAttribute('data-player', player.player_clean);
          sq.setAttribute('x', p.x - sqSize);
          sq.setAttribute('y', p.y - sqSize);
          sq.setAttribute('width', sqSize * 2);
          sq.setAttribute('height', sqSize * 2);
          sq.setAttribute('fill', colors.rankLine);
          sq.setAttribute('stroke', colors.bg);
          sq.setAttribute('stroke-width', dotStrokeW);
          svg.appendChild(sq);
        }

        if (labelMode !== 'none' && labelWanted(labelMode, {
          isEndpoint, isExtreme, index: idx, values: ranks, total: pts2.length, isRank: true
        })) {
          labelCandidates.push({
            x: p.x,
            anchorY: p.y,
            text: String(p.h.rank),
            color: colors.rankLine,
            preferAbove: false,
            priority: isEndpoint ? 3.5 : (isExtreme ? 2.5 : 0.8),
            offset: Math.max(8, effPtSize + 5)
          });
        }
      });

      if (labelCandidates.length > 0) {
        placePointLabels(svg, labelCandidates, { left: margin.left, top: margin.top, width: plotWidth, height: plotHeight }, {
          fontSize: 8.5,
          leaderColor: colors.textMuted
        });
      }

      const rankByKey = new Map(validRankHistory.map(h => [itemDetailKey(h), h]));
      validHistory.forEach(h => {
        const x = getXItem(h);
        const y1 = getY1(h.public_rating);
        const rankEntry = h.rank !== null && h.rank !== undefined ? h : rankByKey.get(itemDetailKey(h));
        const rankVal = rankEntry ? rankEntry.rank : null;
        const y2 = rankVal ? getY2(rankVal) : null;
        const ptsList = [{ x, y: y1, color: colors.primaryLine }];
        if (y2 !== null) ptsList.push({ x, y: y2, color: colors.rankLine });

        interactiveData.push({
          month_key: h.month_key,
          date: h.date || null,
          x,
          points: ptsList,
          details: [
            { label: '棋手', value: player.player_clean, color: colors.primaryLine },
            { label: '等级分', value: `${h.public_rating.toFixed(1)}分`, color: colors.primaryLine },
            { label: isDateAxis ? '榜单排名' : '当月排名', value: rankVal ? `第 ${rankVal} 名` : '-', color: colors.rankLine },
            { label: '分值变动', value: h.rating_change || '-', color: colors.textMuted },
            { label: '排名变动', value: (rankEntry && rankEntry.rank_change) || h.rank_change || '-', color: colors.textMuted }
          ]
        });
      });

      this._renderLegend(svg, [
        { label: '等级分', color: colors.primaryLine },
        { label: isDateAxis ? '榜单排名' : '当月排名', color: colors.rankLine }
      ], width, margin, colors);

    } else if (mode === 'single-circle') {
      // =========================================================================
      // 分支 3：单人-点圈标注（点圈内/旁嵌名次）
      // =========================================================================
      const player = players[0];
      const validHistory = (player.history || []).filter(h => inAxis(h) && h.public_rating !== null && h.public_rating > 0);

      if (validHistory.length === 0) {
        this.container.innerHTML = '<div class="ratings-chart-empty">该棋手在选定时间范围内没有有效记录。</div>';
        return;
      }

      const ratings = validHistory.map(h => h.public_rating);
      let minR = Math.min(...ratings);
      let maxR = Math.max(...ratings);
      const padR = Math.max(15, (maxR - minR) * 0.1);
      minR = Math.floor(minR - padR);
      maxR = Math.ceil(maxR + padR);

      const getY = (rVal) => {
        const ratio = (rVal - minR) / (maxR - minR);
        return margin.top + plotHeight - ratio * plotHeight;
      };

      // Y 轴刻度
      const ySteps = 5;
      for (let i = 0; i <= ySteps; i++) {
        const val = Math.round(minR + (i / ySteps) * (maxR - minR));
        const y = getY(val);

        if (this.options.showGrid) {
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', margin.left);
          line.setAttribute('y1', y);
          line.setAttribute('x2', margin.left + plotWidth);
          line.setAttribute('y2', y);
          line.setAttribute('stroke', colors.grid);
          svg.appendChild(line);
        }

        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.setAttribute('x', margin.left - 8);
        txt.setAttribute('y', y + 3);
        txt.setAttribute('text-anchor', 'end');
        txt.setAttribute('fill', colors.primaryLine);
        txt.setAttribute('font-size', '10');
        txt.textContent = val;
        svg.appendChild(txt);
      }

      const pts = validHistory.map(h => ({ x: getXItem(h), y: getY(h.public_rating), h }));
      const circleSegments = seriesSegments(pts);
      circleSegments.forEach(segment => {
        const pathD = pathForPoints(segment, useSmooth);
        if (!pathD) return;
        const lineEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        lineEl.setAttribute('class', 'chart-line chart-line-rating');
        lineEl.setAttribute('data-player', player.player_clean);
        lineEl.setAttribute('d', pathD);
        lineEl.setAttribute('fill', 'none');
        lineEl.setAttribute('stroke', colors.primaryLine);
        lineEl.setAttribute('stroke-width', this.options.lineWidth);
        svg.appendChild(lineEl);
      });

      const avgStepX = pts.length > 1 ? plotWidth / (pts.length - 1) : plotWidth;
      const circleR = Math.min(11, Math.max(8.5, effPtSize * 1.65));
      const smallDotR = Math.max(2.2, Math.min(3.5, effPtSize));
      const rankedCircleIndices = new Set();

      if (avgStepX >= 20) {
        pts.forEach((_, idx) => rankedCircleIndices.add(idx));
      } else {
        const minSpacing = 26;
        const maxR = Math.max(...ratings);
        const minR2 = Math.min(...ratings);
        const rankValues = pts.map(pt => pt.h.rank).filter(r => r !== null && r !== undefined);
        const bestRank = rankValues.length ? Math.min(...rankValues) : null;

        rankedCircleIndices.add(0);
        rankedCircleIndices.add(pts.length - 1);
        pts.forEach((p, idx) => {
          if (p.h.public_rating === maxR || p.h.public_rating === minR2 || (bestRank !== null && p.h.rank === bestRank)) {
            const tooCloseEdge = (idx > 0 && Math.abs(p.x - pts[0].x) < 18) ||
              (idx < pts.length - 1 && Math.abs(p.x - pts[pts.length - 1].x) < 18);
            if (!tooCloseEdge) rankedCircleIndices.add(idx);
          }
        });

        let lastX = -Infinity;
        pts.forEach((p, idx) => {
          if (rankedCircleIndices.has(idx)) {
            lastX = p.x;
            return;
          }
          const nearEnd = Math.abs(p.x - pts[pts.length - 1].x) < minSpacing * 0.85;
          if (!nearEnd && Math.abs(p.x - lastX) >= minSpacing) {
            rankedCircleIndices.add(idx);
            lastX = p.x;
          }
        });
      }

      const maxRatingVal = Math.max(...ratings);
      const minRatingVal = Math.min(...ratings);
      const labelCandidates = [];

      pts.forEach((p, idx) => {
        const showCircle = rankedCircleIndices.has(idx);
        const isEndpoint = idx === 0 || idx === pts.length - 1;
        const isExtreme = isEndpoint || p.h.public_rating === maxRatingVal || p.h.public_rating === minRatingVal;
        if (showPoints && (showCircle || shouldDrawPointDot(idx, pts.length, isExtreme))) {
          const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          circle.setAttribute('class', showCircle ? 'chart-point chart-point-circle' : 'chart-point');
          circle.setAttribute('data-player', player.player_clean);
          circle.setAttribute('cx', p.x);
          circle.setAttribute('cy', p.y);
          circle.setAttribute('r', showCircle ? circleR : smallDotR);
          circle.setAttribute('fill', colors.primaryLine);
          circle.setAttribute('stroke', colors.bg);
          circle.setAttribute('stroke-width', showCircle ? '1.5' : '0.9');
          svg.appendChild(circle);

          if (showCircle && p.h.rank !== null && p.h.rank !== undefined) {
            const rankText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            rankText.setAttribute('class', 'chart-dot-rank');
            rankText.setAttribute('x', p.x);
            rankText.setAttribute('y', p.y + 3.5);
            rankText.setAttribute('text-anchor', 'middle');
            rankText.setAttribute('fill', '#ffffff');
            rankText.setAttribute('font-size', p.h.rank > 99 ? '7.5' : (p.h.rank > 9 ? '8.5' : '9.5'));
            rankText.setAttribute('font-weight', '700');
            rankText.textContent = p.h.rank;
            svg.appendChild(rankText);
          }
        }

        if (labelMode !== 'none' && labelWanted(labelMode, {
          isEndpoint, isExtreme, index: idx, values: ratings, total: pts.length
        })) {
          labelCandidates.push({
            x: p.x,
            anchorY: p.y,
            text: p.h.public_rating.toFixed(1),
            color: colors.primaryLine,
            preferAbove: true,
            priority: isEndpoint ? 4 : (isExtreme ? 3 : (showCircle ? 2 : 1)),
            offset: (showCircle ? circleR : smallDotR) + 5
          });
        }

        interactiveData.push({
          month_key: p.h.month_key,
          date: p.h.date || null,
          x: p.x,
          points: [{ x: p.x, y: p.y, color: colors.primaryLine }],
          details: [
            { label: '棋手', value: player.player_clean, color: colors.primaryLine },
            { label: '等级分', value: `${p.h.public_rating.toFixed(1)}分`, color: colors.primaryLine },
            { label: isDateAxis ? '榜单排名' : '当月排名', value: p.h.rank ? `第 ${p.h.rank} 名` : '-', color: colors.primaryLine },
            { label: '分值变动', value: p.h.rating_change || '-', color: colors.textMuted }
          ]
        });
      });

      if (labelCandidates.length > 0) {
        placePointLabels(svg, labelCandidates, { left: margin.left, top: margin.top, width: plotWidth, height: plotHeight }, {
          fontSize: 8.5,
          leaderColor: colors.primaryLine
        });
      }

      this._renderLegend(svg, [
        { label: isDateAxis ? '圈内数字 = 榜单排名' : '圈内数字 = 当月排名', color: colors.primaryLine }
      ], width, margin, colors);

    } else if (mode === 'multi-rating') {
      // =========================================================================
      // 分支 4：多人-对比等级分 (多折线重叠)
      // =========================================================================
      let allRatings = [];
      players.forEach(p => {
        (p.history || []).forEach(h => {
          if (inAxis(h) && h.public_rating !== null && h.public_rating > 0) {
            allRatings.push(h.public_rating);
          }
        });
      });

      if (allRatings.length === 0) {
        this.container.innerHTML = '<div class="ratings-chart-empty">选定棋手在时间范围内无有效等级分。</div>';
        return;
      }

      let minR = Math.min(...allRatings);
      let maxR = Math.max(...allRatings);
      const padR = Math.max(15, (maxR - minR) * 0.1);
      minR = Math.floor(minR - padR);
      maxR = Math.ceil(maxR + padR);

      const getY = (rVal) => {
        const ratio = (rVal - minR) / (maxR - minR);
        return margin.top + plotHeight - ratio * plotHeight;
      };

      // Y 轴刻度
      const ySteps = 5;
      for (let i = 0; i <= ySteps; i++) {
        const val = Math.round(minR + (i / ySteps) * (maxR - minR));
        const y = getY(val);

        if (this.options.showGrid) {
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', margin.left);
          line.setAttribute('y1', y);
          line.setAttribute('x2', margin.left + plotWidth);
          line.setAttribute('y2', y);
          line.setAttribute('stroke', colors.grid);
          svg.appendChild(line);
        }

        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.setAttribute('x', margin.left - 8);
        txt.setAttribute('y', y + 3);
        txt.setAttribute('text-anchor', 'end');
        txt.setAttribute('fill', colors.textMuted);
        txt.setAttribute('font-size', '10');
        txt.textContent = val;
        svg.appendChild(txt);
      }

      const legendItems = [];
      const emptyNotes = [];
      const monthDetailMap = new Map();
      const labelCandidates = [];
      const endLabels = [];
      const dotStrokeW = effPtSize <= 3 ? '0.8' : '1.2';

      // 图例基于全部棋手（含已隐藏），空系列不入图例，只在图下说明。
      allPlayers.forEach(player => {
        const key = playerColorKey(player);
        const color = colorMap.get(key) || PALETTE[0];
        const pHistory = (player.history || []).filter(h => inAxis(h) && h.public_rating !== null && h.public_rating > 0);
        if (pHistory.length === 0) {
          emptyNotes.push(`${player.player_clean}：所选范围内无有效等级分记录`);
          return;
        }
        legendItems.push({label: player.player_clean, color, key, hidden: this._hiddenSeries.has(key)});
      });
      notes.push(...emptyNotes);

      players.forEach((player, pIdx) => {
        const key = playerColorKey(player);
        const color = colorMap.get(key) || PALETTE[pIdx % PALETTE.length];
        const pHistory = (player.history || []).filter(h => inAxis(h) && h.public_rating !== null && h.public_rating > 0);
        if (pHistory.length === 0) return;

        const pts = pHistory.map(h => ({ x: getXItem(h), y: getY(h.public_rating), h }));
        const segments = seriesSegments(pts);
        segments.forEach(segment => {
          const pathD = pathForPoints(segment, useSmooth);
          if (!pathD) return;
          const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          pathEl.setAttribute('class', 'chart-line');
          pathEl.setAttribute('data-player', player.player_clean);
          pathEl.setAttribute('d', pathD);
          pathEl.setAttribute('fill', 'none');
          pathEl.setAttribute('stroke', color);
          pathEl.setAttribute('stroke-width', this.options.lineWidth);
          svg.appendChild(pathEl);
        });

        const pRatings = pts.map(pt => pt.h.public_rating);
        const maxPR = Math.max(...pRatings);
        const minPR = Math.min(...pRatings);

        pts.forEach((p, idx) => {
          const isEndpoint = idx === 0 || idx === pts.length - 1;
          const isExtreme = isEndpoint || p.h.public_rating === maxPR || p.h.public_rating === minPR;
          if (showPoints && shouldDrawPointDot(idx, pts.length, isExtreme)) {
            const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            dot.setAttribute('class', 'chart-point');
            dot.setAttribute('data-player', player.player_clean);
            dot.setAttribute('cx', p.x);
            dot.setAttribute('cy', p.y);
            dot.setAttribute('r', effPtSize);
            dot.setAttribute('fill', color);
            dot.setAttribute('stroke', colors.bg);
            dot.setAttribute('stroke-width', dotStrokeW);
            svg.appendChild(dot);
          }

          const pointIsExtreme = p.h.public_rating === maxPR || p.h.public_rating === minPR;
          const wantAllLabels = labelMode === 'all' && shouldDisplayLabel(idx, pRatings, pts.length);
          const wantExtremeLabel = labelMode === 'extreme' && pointIsExtreme && !isEndpoint;
          if (wantAllLabels || wantExtremeLabel) {
            labelCandidates.push({
              x: p.x,
              anchorY: p.y,
              text: p.h.public_rating.toFixed(1),
              color,
              preferAbove: pIdx % 2 === 0,
              priority: isEndpoint ? 4 : (pointIsExtreme ? 3 : 1),
              offset: Math.max(6, effPtSize + 4)
            });
          }

          if ((labelMode === 'endpoint' || labelMode === 'extreme') && idx === pts.length - 1) {
            endLabels.push({
              x: p.x,
              y: p.y,
              text: `${player.player_clean} ${p.h.public_rating.toFixed(1)}`,
              color
            });
          }

          const dKey = itemDetailKey(p.h);
          if (!monthDetailMap.has(dKey)) {
            monthDetailMap.set(dKey, { month_key: p.h.month_key, date: p.h.date || null, x: p.x, points: [], details: [] });
          }
          const itemWrap = monthDetailMap.get(dKey);
          itemWrap.points.push({ x: p.x, y: p.y, color });
          itemWrap.details.push({
            label: player.player_clean,
            value: p.h.rank ? `${p.h.public_rating.toFixed(1)} (第${p.h.rank}名)` : `${p.h.public_rating.toFixed(1)}分`,
            color
          });
        });
      });

      if (labelCandidates.length > 0) {
        placePointLabels(svg, labelCandidates, { left: margin.left, top: margin.top, width: plotWidth, height: plotHeight }, {
          fontSize: 8,
          leaderColor: colors.textMuted
        });
      }
      if (endLabels.length > 0) {
        placeEndLabels(svg, endLabels, { left: margin.left, top: margin.top, width: plotWidth, height: plotHeight }, {
          fontSize: 9,
          background: colors.bg
        });
      }

      Array.from(monthDetailMap.values()).sort((a, b) => a.x - b.x).forEach(v => interactiveData.push(v));
      this._renderLegend(svg, legendItems, width, margin, colors);

    } else if (mode === 'multi-rank') {
      // =========================================================================
      // 分支 5：多人-对比排名（Y 轴倒置）
      // =========================================================================
      const rankRowsOf = player => (isDateAxis && Array.isArray(player.annual_snapshots) && player.annual_snapshots.length > 0)
        ? player.annual_snapshots
        : (player.history || []);
      let allRanks = [];
      players.forEach(p => {
        rankRowsOf(p).forEach(h => {
          if (inAxis(h) && h.rank !== null && h.rank !== undefined) {
            allRanks.push(h.rank);
          }
        });
      });

      if (allRanks.length === 0) {
        this.container.innerHTML = '<div class="ratings-chart-empty">选定棋手在时间范围内无排名记录。</div>';
        return;
      }

      let minRank = Math.min(...allRanks);
      let maxRank = Math.max(...allRanks);
      if (minRank === maxRank) { minRank = 1; maxRank = 10; }

      const getY = (rankVal) => {
        const ratio = (rankVal - minRank) / (maxRank - minRank);
        return margin.top + ratio * plotHeight;
      };

      // Y 轴标题（多人排名）
      const yTitle = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      yTitle.setAttribute('class', 'chart-axis-label');
      yTitle.setAttribute('x', margin.left);
      yTitle.setAttribute('y', margin.top - 12);
      yTitle.setAttribute('text-anchor', 'start');
      yTitle.setAttribute('fill', colors.textMuted);
      yTitle.setAttribute('font-size', '11');
      yTitle.setAttribute('font-weight', '600');
      yTitle.textContent = isDateAxis ? '榜单排名' : '当月排名';
      svg.appendChild(yTitle);

      const ySteps = 5;
      for (let i = 0; i <= ySteps; i++) {
        const val = Math.round(minRank + (i / ySteps) * (maxRank - minRank));
        const y = getY(val);

        if (this.options.showGrid) {
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', margin.left);
          line.setAttribute('y1', y);
          line.setAttribute('x2', margin.left + plotWidth);
          line.setAttribute('y2', y);
          line.setAttribute('stroke', colors.grid);
          svg.appendChild(line);
        }

        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.setAttribute('x', margin.left - 8);
        txt.setAttribute('y', y + 3);
        txt.setAttribute('text-anchor', 'end');
        txt.setAttribute('fill', colors.textMuted);
        txt.setAttribute('font-size', '10');
        txt.textContent = `第 ${val} 名`;
        svg.appendChild(txt);
      }

      const legendItems = [];
      const emptyNotes = [];
      const monthDetailMap = new Map();
      const labelCandidates = [];
      const endLabels = [];
      const dotStrokeW = effPtSize <= 3 ? '0.8' : '1.2';
      const sqRadius = Math.max(1.8, effPtSize - 0.6);

      allPlayers.forEach(player => {
        const key = playerColorKey(player);
        const color = colorMap.get(key) || PALETTE[0];
        const pHistory = rankRowsOf(player).filter(h => inAxis(h) && h.rank !== null && h.rank !== undefined);
        if (pHistory.length === 0) {
          emptyNotes.push(`${player.player_clean}：所选范围内无排名记录`);
          return;
        }
        legendItems.push({label: player.player_clean, color, key, hidden: this._hiddenSeries.has(key)});
      });
      notes.push(...emptyNotes);

      players.forEach((player, pIdx) => {
        const key = playerColorKey(player);
        const color = colorMap.get(key) || PALETTE[pIdx % PALETTE.length];
        const pHistory = rankRowsOf(player).filter(h => inAxis(h) && h.rank !== null && h.rank !== undefined);
        if (pHistory.length === 0) return;

        const pts = pHistory.map(h => ({ x: getXItem(h), y: getY(h.rank), h }));
        const segments = seriesSegments(pts);
        segments.forEach(segment => {
          const pathD = pathForPoints(segment, useSmooth);
          if (!pathD) return;
          const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          pathEl.setAttribute('class', 'chart-line');
          pathEl.setAttribute('data-player', player.player_clean);
          pathEl.setAttribute('d', pathD);
          pathEl.setAttribute('fill', 'none');
          pathEl.setAttribute('stroke', color);
          pathEl.setAttribute('stroke-dasharray', '4 3');
          pathEl.setAttribute('stroke-width', this.options.lineWidth);
          svg.appendChild(pathEl);
        });

        const pRanks = pts.map(pt => pt.h.rank);
        const bestPRank = Math.min(...pRanks);

        pts.forEach((p, idx) => {
          const isEndpoint = idx === 0 || idx === pts.length - 1;
          const isExtreme = isEndpoint || p.h.rank === bestPRank;
          if (showPoints && shouldDrawPointDot(idx, pts.length, isExtreme)) {
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('class', 'chart-point');
            rect.setAttribute('data-player', player.player_clean);
            rect.setAttribute('x', p.x - sqRadius);
            rect.setAttribute('y', p.y - sqRadius);
            rect.setAttribute('width', sqRadius * 2);
            rect.setAttribute('height', sqRadius * 2);
            rect.setAttribute('fill', color);
            rect.setAttribute('stroke', colors.bg);
            rect.setAttribute('stroke-width', dotStrokeW);
            svg.appendChild(rect);
          }

          const wantAllLabels = labelMode === 'all' && shouldDisplayLabel(idx, pRanks, pts.length, true);
          const wantExtremeLabel = labelMode === 'extreme' && p.h.rank === bestPRank && !isEndpoint;
          if (wantAllLabels || wantExtremeLabel) {
            labelCandidates.push({
              x: p.x,
              anchorY: p.y,
              text: String(p.h.rank),
              color,
              preferAbove: pIdx % 2 === 0,
              priority: isEndpoint ? 4 : (p.h.rank === bestPRank ? 3 : 1),
              offset: Math.max(6, sqRadius + 4)
            });
          }

          if ((labelMode === 'endpoint' || labelMode === 'extreme') && idx === pts.length - 1) {
            endLabels.push({
              x: p.x,
              y: p.y,
              text: `${player.player_clean} 第${p.h.rank}名`,
              color
            });
          }

          const dKey = itemDetailKey(p.h);
          if (!monthDetailMap.has(dKey)) {
            monthDetailMap.set(dKey, { month_key: p.h.month_key, date: p.h.date || null, x: p.x, points: [], details: [] });
          }
          const itemWrap = monthDetailMap.get(dKey);
          itemWrap.points.push({ x: p.x, y: p.y, color });
          itemWrap.details.push({
            label: player.player_clean,
            value: `第 ${p.h.rank} 名${p.h.public_rating ? ' (' + p.h.public_rating.toFixed(1) + '分)' : ''}`,
            color
          });
        });
      });

      if (labelCandidates.length > 0) {
        placePointLabels(svg, labelCandidates, { left: margin.left, top: margin.top, width: plotWidth, height: plotHeight }, {
          fontSize: 8,
          leaderColor: colors.textMuted
        });
      }
      if (endLabels.length > 0) {
        placeEndLabels(svg, endLabels, { left: margin.left, top: margin.top, width: plotWidth, height: plotHeight }, {
          fontSize: 9,
          background: colors.bg
        });
      }

      monthDetailMap.forEach(v => interactiveData.push(v));
      this._renderLegend(svg, legendItems, width, margin, colors);
    }

    // 交互十字准线、数据点发光圈与 Tooltip 浮层
    this._attachInteractivity(svgWrap, svg, interactiveData, margin, plotWidth, plotHeight, colors);

    svgWrap.appendChild(svg);
    this.container.appendChild(svgWrap);

    if (notes.length > 0) {
      const note = document.createElement('p');
      note.className = 'ratings-chart-note';
      note.textContent = notes.join(' · ');
      this.container.appendChild(note);
    }
  }

  // 图例渲染与悬停聚焦交互（自动测宽居中并避让左右轴标题）
  _renderLegend(svg, items, width, margin, colors) {
    if (!items || items.length === 0) return;
    const legendG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    legendG.setAttribute('class', 'chart-legend');

    const measureItemWidth = text => {
      let cjk = 0;
      let ascii = 0;
      for (const ch of String(text || '')) {
        if (ch.charCodeAt(0) > 127) cjk += 1;
        else ascii += 1;
      }
      return Math.ceil(cjk * 11 + ascii * 6.5 + 32);
    };

    const itemWidths = items.map(it => measureItemWidth(it.label));
    const totalW = itemWidths.reduce((s, w) => s + w, 0);
    const safeLeft = margin.left + 68;
    const safeRight = width - margin.right - 68;
    const availW = Math.max(240, safeRight - safeLeft);
    const willWrap = totalW > availW;

    let curX = !willWrap ? safeLeft + (availW - totalW) / 2 : safeLeft;
    let curY = willWrap ? margin.top - 22 : margin.top - 16;

    items.forEach((item, idx) => {
      const itemW = itemWidths[idx];
      if (curX + itemW > width - margin.right - 20 && idx > 0) {
        curX = safeLeft;
        curY += 14;
      }
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'chart-legend-item');
      g.setAttribute('data-legend-player', item.label);
      const toggleable = Boolean(item.key);
      g.style.cursor = toggleable ? 'pointer' : 'default';

      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', curX + 5);
      dot.setAttribute('cy', curY - 4);
      dot.setAttribute('r', '4.5');
      dot.setAttribute('fill', item.color);
      g.appendChild(dot);

      const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      txt.setAttribute('class', 'chart-legend-text');
      txt.setAttribute('x', curX + 14);
      txt.setAttribute('y', curY);
      txt.setAttribute('fill', colors.textMuted);
      txt.setAttribute('font-size', '11');
      txt.setAttribute('font-weight', '500');
      txt.textContent = item.label;
      g.appendChild(txt);

      if (toggleable) {
        g.setAttribute('data-legend-key', item.key);
        g.setAttribute('tabindex', '0');
        g.setAttribute('role', 'button');
        g.setAttribute('aria-pressed', item.hidden ? 'false' : 'true');
        g.setAttribute('aria-label', `${item.label}${item.hidden ? '（已隐藏）' : ''}；点击切换显示，Alt 或双击只显示这一条`);
        if (item.hidden) {
          g.style.opacity = '0.55';
          txt.style.textDecoration = 'line-through';
        }
        g.classList.add('is-toggleable');
        if (item.hidden) g.classList.add('is-hidden');

        let lastActivation = 0;
        const activate = event => {
          const now = Date.now();
          if (now - lastActivation < 300) return;
          lastActivation = now;
          if (event && (event.altKey || event.metaKey || event.ctrlKey)) this._isolateSeries(item.key);
          else this._toggleSeries(item.key);
        };
        g.addEventListener('click', event => {
          event.stopPropagation();
          // 键盘激活已由 keydown 处理；忽略 role=button 合成的 detail=0 点击，避免双触发。
          if (event.detail === 0) return;
          activate(event);
        });
        g.addEventListener('dblclick', event => {
          event.preventDefault();
          event.stopPropagation();
          this._isolateSeries(item.key);
        });
        g.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            activate(event);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            if (this._hiddenSeries.size > 0) {
              this._hiddenSeries.clear();
              this.render();
            }
          }
        });
      }

      const matchPlayer = p => Boolean(p && (p === item.label || item.label.includes(p) || p.includes(item.label)));

      // 悬停聚焦交互：加粗并高亮本曲线，淡化其他曲线（已隐藏系列不参与）
      if (!item.hidden) {
        g.addEventListener('mouseenter', () => {
          txt.setAttribute('fill', colors.text);
          txt.setAttribute('font-weight', '700');
          svg.querySelectorAll('.chart-line').forEach(line => {
            if (matchPlayer(line.getAttribute('data-player'))) {
              line.style.strokeWidth = `${Number(this.options.lineWidth) + 2}px`;
              line.style.opacity = '1';
            } else {
              line.style.opacity = '0.18';
            }
          });
          svg.querySelectorAll('.chart-point').forEach(pt => {
            if (matchPlayer(pt.getAttribute('data-player'))) {
              pt.style.opacity = '1';
            } else {
              pt.style.opacity = '0.12';
            }
          });
        });

        g.addEventListener('mouseleave', () => {
          txt.setAttribute('fill', colors.textMuted);
          txt.setAttribute('font-weight', '500');
          svg.querySelectorAll('.chart-line').forEach(line => {
            line.style.strokeWidth = `${this.options.lineWidth}px`;
            line.style.opacity = '1';
          });
          svg.querySelectorAll('.chart-point').forEach(pt => {
            pt.style.opacity = '1';
          });
        });
      }

      legendG.appendChild(g);
      curX += itemW;
    });

    svg.appendChild(legendG);

    const focusKey = this._pendingFocusLegendKey;
    this._pendingFocusLegendKey = null;
    if (focusKey) {
      const target = Array.from(legendG.querySelectorAll('.chart-legend-item'))
        .find(node => node.getAttribute('data-legend-key') === focusKey);
      if (target && typeof target.focus === 'function') target.focus();
    }
  }

  // 图例点击：切换单条曲线的显示；至少保留一条有数据的曲线。
  _toggleSeries(key) {
    if (!key) return;
    const players = this.data?.players || [];
    if (this._hiddenSeries.has(key)) {
      this._hiddenSeries.delete(key);
    } else {
      const dataKeys = players
        .filter(player => Array.isArray(player.history) && player.history.length > 0)
        .map(playerColorKey);
      const visibleData = dataKeys.filter(item => !this._hiddenSeries.has(item));
      if (dataKeys.includes(key) && visibleData.length <= 1) return;
      this._hiddenSeries.add(key);
    }
    this._pendingFocusLegendKey = key;
    this.render();
  }

  // 图例隔离：只保留当前系列，其余全部隐藏。
  _isolateSeries(key) {
    if (!key) return;
    const players = this.data?.players || [];
    this._hiddenSeries = new Set(players.map(playerColorKey).filter(item => item && item !== key));
    this._pendingFocusLegendKey = key;
    this.render();
  }

  // 交互：准线、发光点圈、吸附 Tooltip；鼠标／触摸／键盘均可查看单月详情。
  _attachInteractivity(wrap, svg, interactiveData, margin, plotWidth, plotHeight, colors) {
    if (interactiveData.length === 0) return;
    const ids = this._ids();

    const crosshair = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    crosshair.setAttribute('class', 'chart-crosshair');
    crosshair.setAttribute('id', ids.crosshair);
    crosshair.setAttribute('y1', margin.top);
    crosshair.setAttribute('y2', margin.top + plotHeight);
    crosshair.setAttribute('stroke', colors.textMuted);
    crosshair.setAttribute('stroke-dasharray', '3 3');
    crosshair.setAttribute('stroke-width', '1.2');
    crosshair.style.display = 'none';
    svg.appendChild(crosshair);

    // 点位高亮发光圈组
    const haloGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    haloGroup.setAttribute('class', 'chart-halo-group');
    haloGroup.setAttribute('id', ids.halo);
    svg.appendChild(haloGroup);

    const tooltip = document.createElement('div');
    tooltip.id = ids.tooltip;
    tooltip.className = 'ratings-chart-tooltip';
    tooltip.style.display = 'none';
    tooltip.setAttribute('role', 'tooltip');
    wrap.appendChild(tooltip);
    this.tooltip = tooltip;

    // 键盘操作时的屏幕阅读器播报（视觉隐藏，不占用焦点序列）。
    const live = document.createElement('p');
    live.className = 'ratings-chart-live';
    live.setAttribute('aria-live', 'polite');
    wrap.appendChild(live);
    this._live = live;

    const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    overlay.setAttribute('class', 'chart-overlay');
    overlay.setAttribute('x', margin.left);
    overlay.setAttribute('y', margin.top);
    overlay.setAttribute('width', plotWidth);
    overlay.setAttribute('height', plotHeight);
    overlay.setAttribute('fill', 'transparent');
    overlay.setAttribute('tabindex', '0');
    overlay.setAttribute('focusable', 'true');
    overlay.setAttribute('role', 'application');
    overlay.setAttribute('aria-label', '图表数据；使用左右方向键查看各月数值，Home 与 End 跳到首尾');
    overlay.style.cursor = 'crosshair';
    overlay.style.outline = 'none';

    let activeIndex = -1;

    const headerTextOf = nearest => {
      if (nearest.date) return String(nearest.date);
      const monthString = String(nearest.month_key || '');
      if (monthString.length >= 6) {
        return `${monthString.slice(0, 4)}年${parseInt(monthString.slice(4), 10)}月`;
      }
      return monthString;
    };

    const showPoint = (nearest, viewportY) => {
      crosshair.setAttribute('x1', nearest.x);
      crosshair.setAttribute('x2', nearest.x);
      crosshair.style.display = 'block';

      haloGroup.innerHTML = '';
      if (nearest.points) {
        nearest.points.forEach(pt => {
          const halo = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          halo.setAttribute('cx', pt.x);
          halo.setAttribute('cy', pt.y);
          halo.setAttribute('r', '9');
          halo.setAttribute('fill', 'none');
          halo.setAttribute('stroke', pt.color);
          halo.setAttribute('stroke-width', '2.5');
          halo.setAttribute('opacity', '0.9');
          haloGroup.appendChild(halo);

          const inner = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          inner.setAttribute('cx', pt.x);
          inner.setAttribute('cy', pt.y);
          inner.setAttribute('r', '3.5');
          inner.setAttribute('fill', pt.color);
          haloGroup.appendChild(inner);
        });
      }

      const headerText = headerTextOf(nearest);
      let html = `<div class="tooltip-header"><strong>${escapeXml(headerText)}</strong></div>`;
      nearest.details.forEach(item => {
        html += `
          <div class="tooltip-row">
            <span class="tooltip-bullet" style="background-color: ${item.color};"></span>
            <span class="tooltip-label">${escapeXml(item.label)}:</span>
            <strong class="tooltip-value" style="color:${item.color}">${escapeXml(item.value)}</strong>
          </div>
        `;
      });
      tooltip.innerHTML = html;
      tooltip.style.display = 'block';

      const wrapRect = wrap.getBoundingClientRect();
      let left = (nearest.x / 1000) * wrapRect.width + 16;
      let top = viewportY == null ? 24 : viewportY - wrapRect.top - 24;
      if (left + 220 > wrapRect.width) {
        left = (nearest.x / 1000) * wrapRect.width - 230;
      }
      tooltip.style.left = `${Math.max(8, left)}px`;
      tooltip.style.top = `${Math.max(8, top)}px`;

      live.textContent = `${headerText}：${nearest.details.map(item => `${item.label} ${item.value}`).join('；')}`;
    };

    const hidePoint = () => {
      crosshair.style.display = 'none';
      tooltip.style.display = 'none';
      haloGroup.innerHTML = '';
    };

    const nearestFromX = svgX => {
      let nearest = null;
      let minDis = Infinity;
      interactiveData.forEach(item => {
        const distance = Math.abs(item.x - svgX);
        if (distance < minDis) { minDis = distance; nearest = item; }
      });
      return nearest;
    };

    overlay.addEventListener('mousemove', event => {
      const coords = getSvgCoordinates(svg, event);
      const nearest = nearestFromX(coords.x);
      if (nearest) showPoint(nearest, event.clientY);
    });

    // 触摸点选与拖动同样展开当月记录（不依赖 hover）。
    const handleTouch = event => {
      const touch = event.touches?.[0] || event.changedTouches?.[0];
      if (!touch) return;
      const coords = getSvgCoordinates(svg, touch);
      const nearest = nearestFromX(coords.x);
      if (nearest) showPoint(nearest, touch.clientY);
    };
    overlay.addEventListener('touchstart', handleTouch, {passive: true});
    overlay.addEventListener('touchmove', handleTouch, {passive: true});

    overlay.addEventListener('click', event => {
      const coords = getSvgCoordinates(svg, event);
      const nearest = nearestFromX(coords.x);
      if (nearest) {
        showPoint(nearest, event.clientY);
        if (typeof this.options.onPointClick === 'function') {
          this.options.onPointClick({month_key: nearest.month_key, date: nearest.date || null});
        }
      }
    });

    this._highlightHelper = {
      showByKey: keyOrDate => {
        const key = String(keyOrDate || '').trim();
        if (!key) return;
        const hit = interactiveData.find(d => {
          if (d.date && d.date === key) return true;
          const mk = String(d.month_key || '');
          const mkDash = mk.length === 6 ? `${mk.slice(0, 4)}-${mk.slice(4)}` : mk;
          return mk === key || mkDash === key;
        });
        if (hit) showPoint(hit, null);
      },
      hide: hidePoint,
    };

    overlay.addEventListener('mouseleave', hidePoint);
    overlay.addEventListener('blur', () => {
      hidePoint();
      overlay.style.outline = 'none';
    });
    overlay.addEventListener('keydown', event => {
      const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'Escape') {
        activeIndex = -1;
        hidePoint();
        overlay.blur();
        return;
      }
      if (event.key === 'Home') activeIndex = 0;
      else if (event.key === 'End') activeIndex = interactiveData.length - 1;
      else if (activeIndex < 0) activeIndex = 0;
      else if (event.key === 'ArrowRight') activeIndex = Math.min(interactiveData.length - 1, activeIndex + 1);
      else if (event.key === 'ArrowLeft') activeIndex = Math.max(0, activeIndex - 1);
      showPoint(interactiveData[activeIndex], null);
    });
    overlay.addEventListener('focus', () => {
      overlay.style.outline = `2px solid ${colors.primaryLine}`;
    });

    svg.appendChild(overlay);
  }

  // 复制走势数据为 TSV 表格 (可直接粘贴至 Excel)
  copyDataTsv() {
    if (!this.data || !this.data.players || this.data.players.length === 0) return false;
    const isDate = this.data.time_scale === 'date' || this.options.timeScale === 'date';
    const lines = [isDate ? '棋手\t日期\t等级分\t排名\t分值变动\t排名变动' : '棋手\t月份\t等级分\t当月排名\t分值变动\t排名变动'];
    this.data.players.forEach(p => {
      (p.history || []).forEach(h => {
        lines.push([
          p.player_clean,
          h.date || h.month_str || h.month_key,
          h.public_rating !== null && h.public_rating !== undefined ? h.public_rating.toFixed(1) : '-',
          h.rank !== null && h.rank !== undefined ? h.rank : '-',
          h.rating_change || '-',
          h.rank_change || '-'
        ].join('\t'));
      });
    });
    const tsv = lines.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(tsv);
      return true;
    }
    const ta = document.createElement('textarea');
    ta.value = tsv;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  }

  // 全屏大图查看（铺满 ratingsDialog，布局清晰无畸变，控件齐全）
  openFullscreen(systemName = '等级分') {
    if (!this.data) return;
    const parentDialog = document.getElementById('ratingsDialog') || document.body;
    let modal = document.getElementById('ratingsFullscreenModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'ratingsFullscreenModal';
      modal.className = 'ratings-fullscreen-modal';
      modal.innerHTML = `
        <div class="ratings-fullscreen-header">
          <div class="ratings-fullscreen-title-wrap">
            <h3 id="fullscreenModalTitle">${iconSvg('chart', 16)} <span>等级分走势</span></h3>
            <span class="ratings-fullscreen-sub" id="fullscreenModalSub"></span>
          </div>
          <div class="ratings-fullscreen-actions">
            <label class="ratings-checkbox-label">
              <input type="checkbox" id="chkFsSmooth" checked> 平滑曲线
            </label>
            <label class="ratings-checkbox-label">
              <input type="checkbox" id="chkFsGrid" checked> 网格
            </label>
            <label class="ratings-checkbox-label">
              <input type="checkbox" id="chkFsPoints" checked> 数据点
            </label>
            <label class="ratings-checkbox-label">
              <input type="checkbox" id="chkFsLabels" checked> 数值
            </label>
            <button class="btn btn-sm" id="btnFsExportPng">${iconSvg('download', 14)} 导出 PNG</button>
            <button class="btn btn-sm" id="btnFsExportSvg">${iconSvg('download', 14)} 导出 SVG</button>
            <button class="btn btn-sm btn-gold" id="btnFsClose">${iconSvg('close', 14)} 退出全屏</button>
          </div>
        </div>
        <div class="ratings-fullscreen-body" id="fullscreenChartContainer"></div>
      `;
      parentDialog.appendChild(modal);
      this._ownedModal = true;

      const closeModal = () => {
        modal.classList.remove('open');
        if (this._fullscreenRenderer) {
          this._fullscreenRenderer.destroy();
          this._fullscreenRenderer = null;
        }
      };
      modal.querySelector('#btnFsClose').onclick = closeModal;
      this._fullscreenKeyHandler = event => {
        if (event.key === 'Escape' && modal.classList.contains('open')) closeModal();
      };
      window.addEventListener('keydown', this._fullscreenKeyHandler);
    }

    modal.querySelector('#btnFsExportPng').onclick = () => (this._fullscreenRenderer || this).exportPng('fullscreen_chart');
    modal.querySelector('#btnFsExportSvg').onclick = () => (this._fullscreenRenderer || this).exportSvg('fullscreen_chart');

    const pNames = (this.data.players || []).map(p => p.player_clean).join('、');
    const titleEl = modal.querySelector('#fullscreenModalTitle span');
    if (titleEl) titleEl.textContent = `${systemName}历史走势`;
    else modal.querySelector('#fullscreenModalTitle').textContent = `${systemName}历史走势`;
    modal.querySelector('#fullscreenModalSub').textContent = `当前对比棋手: ${pNames}`;

    const fsContainer = modal.querySelector('#fullscreenChartContainer');
    if (this._fullscreenRenderer) this._fullscreenRenderer.destroy();
    fsContainer.innerHTML = '';
    const fsRenderer = new RatingChartRenderer(fsContainer, Object.assign({}, this.options, {
      ptSize: this.options.ptSize,
      lineWidth: 2.2
    }));
    this._fullscreenRenderer = fsRenderer;
    fsRenderer.setData(this.data);

    modal.querySelector('#chkFsSmooth').checked = this.options.smooth;
    modal.querySelector('#chkFsGrid').checked = this.options.showGrid;
    modal.querySelector('#chkFsPoints').checked = this.options.showPoints !== false;
    modal.querySelector('#chkFsLabels').checked = this.options.labelMode !== 'none' && this.options.showLabels !== false;

    modal.querySelector('#chkFsSmooth').onchange = (e) => fsRenderer.setOptions({ smooth: e.target.checked });
    modal.querySelector('#chkFsGrid').onchange = (e) => fsRenderer.setOptions({ showGrid: e.target.checked });
    modal.querySelector('#chkFsPoints').onchange = (e) => fsRenderer.setOptions({ showPoints: e.target.checked });
    modal.querySelector('#chkFsLabels').onchange = (e) => fsRenderer.setOptions({ labelMode: e.target.checked ? 'all' : 'none' });

    modal.classList.add('open');
  }

  _buildExportableSvg() {
    if (!this.svg) return null;
    const vb = this.svg.viewBox?.baseVal;
    const baseW = (vb && vb.width) ? vb.width : 1000;
    const baseH = (vb && vb.height) ? vb.height : 560;
    const { vx, vy, vw, vh } = computeTightSvgViewBox(this.svg, baseW, baseH, 12);

    const clone = this.svg.cloneNode(true);
    clone.querySelectorAll('.chart-crosshair, .chart-halo-group, .chart-overlay').forEach(el => el.remove());
    clone.querySelector('#chartCrosshair')?.remove();
    clone.querySelector('#chartHoverHaloGroup')?.remove();
    clone.querySelector('rect[fill="transparent"]')?.remove();

    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('viewBox', `${vx} ${vy} ${vw} ${vh}`);
    clone.setAttribute('width', String(vw));
    clone.setAttribute('height', String(vh));
    clone.style.fontFamily = 'system-ui, -apple-system, "Microsoft YaHei", "PingFang SC", sans-serif';

    const bgRect = clone.querySelector('.chart-bg-rect') || clone.querySelector('rect');
    if (bgRect) {
      bgRect.setAttribute('x', String(vx));
      bgRect.setAttribute('y', String(vy));
      bgRect.setAttribute('width', String(vw));
      bgRect.setAttribute('height', String(vh));
      bgRect.setAttribute('rx', '0');
    }

    return {
      svgString: new XMLSerializer().serializeToString(clone),
      width: vw,
      height: vh
    };
  }

  exportSvg(filename = 'rating_chart') {
    const built = this._buildExportableSvg();
    if (!built) return null;
    const blob = new Blob([built.svgString], { type: 'image/svg+xml;charset=utf-8' });
    triggerDownloadBlob(blob, `${filename}.svg`);
    return built;
  }

  async exportPng(filename = 'rating_chart') {
    const built = this._buildExportableSvg();
    if (!built) return null;
    const scale = 2; // 2x 高清
    const blob = await svgStringToPngBlob(built.svgString, built.width, built.height, scale);
    if (!blob) return null;
    triggerDownloadBlob(blob, `${filename}.png`);
    const meta = {
      width: Math.round(built.width * scale),
      height: Math.round(built.height * scale),
      size: blob.size,
      filename: `${filename}.png`
    };
    this._lastExportInfo = meta;
    return meta;
  }
}


// =============================================================================
// 月度对比多维可视化引擎 (ComparisonChartRenderer)
// =============================================================================
class ComparisonChartRenderer {
  constructor(container, options = {}) {
    this.container = container;
    this.options = Object.assign({
      topN: 15,
      activeSubChart: 'all', // 'all' | 'movers' | 'scatter' | 'distribution'
      theme: null
    }, options);
    this.compareData = null;
    this.activeSvg = null;
    this._lastExportInfo = null;
  }

  _colors() {
    return getThemeColors(this.options.theme);
  }

  setData(compareData) {
    this.compareData = compareData;
    this.render();
  }

  setOptions(opts) {
    Object.assign(this.options, opts);
    this.render();
  }

  render() {
    if (!this.container || !this.compareData) return;
    this.container.innerHTML = '';

    const data = this.compareData;
    const categories = data.categories || {};
    const upList = categories.up || [];
    const downList = categories.down || [];
    const topN = this.options.topN || 15;

    const wrap = document.createElement('div');
    wrap.className = 'compare-charts-dashboard';

    // 顶部控制条
    wrap.innerHTML = `
      <div class="compare-charts-header">
        <div class="compare-charts-title">
          <h4>${iconSvg('chart', 16)} 月度对比 [${escapeXml(data.base_month_str)} → ${escapeXml(data.target_month_str)}]</h4>
          <span class="compare-charts-sub">对比棋手共 ${data.summary?.total_players_compared || 0} 人</span>
        </div>
        <div class="compare-charts-toolbar">
          <label>Top 榜单规模:
            <select id="selCompareTopN" class="ratings-select">
              <option value="10" ${topN === 10 ? 'selected' : ''}>Top 10</option>
              <option value="15" ${topN === 15 ? 'selected' : ''}>Top 15</option>
              <option value="20" ${topN === 20 ? 'selected' : ''}>Top 20</option>
              <option value="30" ${topN === 30 ? 'selected' : ''}>Top 30</option>
            </select>
          </label>
          <div class="view-toggle-group">
            <button class="view-toggle-btn ${this.options.activeSubChart === 'all' ? 'active' : ''}" data-sub="all" type="button">全部三图</button>
            <button class="view-toggle-btn ${this.options.activeSubChart === 'movers' ? 'active' : ''}" data-sub="movers" type="button">涨跌排行</button>
            <button class="view-toggle-btn ${this.options.activeSubChart === 'scatter' ? 'active' : ''}" data-sub="scatter" type="button">前后散点</button>
            <button class="view-toggle-btn ${this.options.activeSubChart === 'distribution' ? 'active' : ''}" data-sub="distribution" type="button">变动分布</button>
          </div>
          <button class="btn btn-sm" id="btnExportComparePng">${iconSvg('download', 14)} 导出 PNG</button>
          <button class="btn btn-sm" id="btnExportCompareSvg">${iconSvg('download', 14)} 导出 SVG</button>
        </div>
      </div>
      <div class="compare-charts-grid" id="compareChartsGrid"></div>
    `;

    this.container.appendChild(wrap);

    const grid = wrap.querySelector('#compareChartsGrid');

    // 绑定控制器
    wrap.querySelector('#selCompareTopN').onchange = (e) => {
      this.options.topN = parseInt(e.target.value, 10);
      this.render();
    };

    wrap.querySelectorAll('.view-toggle-btn').forEach(btn => {
      btn.onclick = () => {
        this.options.activeSubChart = btn.dataset.sub;
        this.render();
      };
    });

    wrap.querySelector('#btnExportComparePng').onclick = () => {
      this.exportPng(`${data.system_id || 'ratings'}_月度对比全景图_${data.base_month_key}_${data.target_month_key}`);
    };
    wrap.querySelector('#btnExportCompareSvg').onclick = () => {
      this.exportSvg(`${data.system_id || 'ratings'}_月度对比全景图_${data.base_month_key}_${data.target_month_key}`);
    };

    const sub = this.options.activeSubChart;

    if (sub === 'all' || sub === 'movers') {
      grid.appendChild(this._buildMoversCard(upList, downList, topN, data));
    }
    if (sub === 'all' || sub === 'scatter') {
      grid.appendChild(this._buildScatterCard(data));
    }
    if (sub === 'all' || sub === 'distribution') {
      grid.appendChild(this._buildDistributionCard(data));
    }
  }

  _svgEl(tag, attrs = {}, text = null) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (v !== undefined && v !== null) el.setAttribute(k, String(v));
    });
    if (text !== null) el.textContent = text;
    return el;
  }

  // 1. Top N Movers 涨跌榜条形图
  _buildMoversCard(upList, downList, topN, data = {}) {
    const colors = this._colors();
    const card = document.createElement('div');
    card.className = 'ratings-card compare-chart-card';

    const risingCount = Math.ceil(topN / 2);
    const fallingCount = Math.floor(topN / 2);
    const risingItems = upList.slice(0, risingCount);
    const fallingItems = downList.slice(0, fallingCount).reverse();
    const movers = [...fallingItems, ...risingItems];

    card.innerHTML = `
      <div class="ratings-card-header">
        <h4>${iconSvg('bar', 15)} Top ${topN} 涨跌榜</h4>
      </div>
      <div class="compare-chart-body"></div>
    `;

    const body = card.querySelector('.compare-chart-body');
    if (movers.length === 0) {
      body.innerHTML = '<div class="ratings-empty">无有效涨跌记录。</div>';
      return card;
    }

    const width = 760;
    const height = Math.max(360, movers.length * 28 + 78);
    const margin = { top: 44, right: 86, bottom: 34, left: 86 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;

    const maxAbsDiff = Math.max(...movers.map(m => Math.abs(m.rating_diff || 0)), 10);
    const axisMax = Math.ceil(maxAbsDiff * 1.08);
    const zeroX = margin.left + plotWidth / 2;

    const svg = this._svgEl('svg', {
      viewBox: `0 0 ${width} ${height}`,
      class: 'ratings-chart-svg',
      'data-compare-chart': 'movers',
      role: 'img',
      'aria-label': `Top ${topN} 涨跌排行`
    });

    svg.appendChild(this._svgEl('rect', {
      class: 'chart-bg-rect',
      width,
      height,
      fill: colors.bg,
      rx: 8
    }));

    svg.appendChild(this._svgEl('text', {
      x: width / 2,
      y: 26,
      'text-anchor': 'middle',
      fill: colors.text,
      'font-size': 13,
      'font-weight': 700
    }, `Top ${topN} 涨跌排行 (${data.base_month_str || ''} → ${data.target_month_str || ''})`));

    // 刻度线与参考基准
    [-1, -0.5, 0, 0.5, 1].forEach(ratio => {
      const x = zeroX + ratio * (plotWidth / 2);
      const val = Math.round(ratio * axisMax);
      svg.appendChild(this._svgEl('line', {
        x1: x,
        y1: margin.top,
        x2: x,
        y2: margin.top + plotHeight,
        stroke: ratio === 0 ? colors.zeroLine : colors.gridDashed,
        'stroke-width': ratio === 0 ? 1.2 : 1,
        'stroke-dasharray': ratio === 0 ? '3 3' : '2 3'
      }));
      svg.appendChild(this._svgEl('text', {
        x,
        y: margin.top + plotHeight + 16,
        'text-anchor': 'middle',
        fill: colors.textMuted,
        'font-size': 9.5
      }, val > 0 ? `+${val}` : String(val)));
    });

    const barHeight = Math.min(18, (plotHeight / movers.length) * 0.68);

    movers.forEach((item, idx) => {
      const y = margin.top + (idx + 0.5) * (plotHeight / movers.length);
      const diff = item.rating_diff || 0;
      const isPos = diff >= 0;
      const barLen = (Math.abs(diff) / axisMax) * (plotWidth / 2);

      const rect = this._svgEl('rect', {
        x: isPos ? zeroX : zeroX - barLen,
        y: y - barHeight / 2,
        width: Math.max(2, barLen),
        height: barHeight,
        fill: isPos ? '#10b981' : '#ef4444',
        rx: 3
      });
      rect.style.cursor = 'pointer';
      rect.onclick = () => window.GoViewerRatings?.openPlayer(item.player_clean);
      svg.appendChild(rect);

      // 棋手姓名（不附加段位等冗余后缀）
      const nameTxt = this._svgEl('text', {
        x: isPos ? zeroX - 10 : zeroX + 10,
        y: y + 4,
        'text-anchor': isPos ? 'end' : 'start',
        fill: colors.text,
        'font-size': 11,
        'font-weight': 600
      }, item.player_clean);
      nameTxt.style.cursor = 'pointer';
      nameTxt.onclick = () => window.GoViewerRatings?.openPlayer(item.player_clean);
      svg.appendChild(nameTxt);

      // 变动分值
      const valTxt = this._svgEl('text', {
        x: isPos ? zeroX + barLen + 6 : zeroX - barLen - 6,
        y: y + 3.5,
        'text-anchor': isPos ? 'start' : 'end',
        fill: isPos ? '#10b981' : '#ef4444',
        'font-size': 10,
        'font-weight': 700
      }, isPos ? `+${diff.toFixed(1)}` : diff.toFixed(1));
      svg.appendChild(valTxt);
    });

    body.appendChild(svg);
    return card;
  }

  // 2. 前后等级分散点图 (45度对角参考 + 网格刻度 + Top-N 防重叠标注)
  _buildScatterCard(data) {
    const colors = this._colors();
    const card = document.createElement('div');
    card.className = 'ratings-card compare-chart-card';
    card.innerHTML = `
      <div class="ratings-card-header">
        <h4>${iconSvg('scatter', 15)} 前后等级分散点图（45°对角线）</h4>
      </div>
      <div class="compare-chart-body"></div>
    `;

    const body = card.querySelector('.compare-chart-body');
    const categories = data.categories || {};
    const allItems = [...(categories.up || []), ...(categories.down || []), ...(categories.equal || [])];

    if (allItems.length === 0) {
      body.innerHTML = '<div class="ratings-empty">无有效共同在榜记录。</div>';
      return card;
    }

    const width = 560;
    const height = 420;
    const margin = { top: 42, right: 28, bottom: 52, left: 62 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;

    const baseRatings = allItems.map(i => i.base_rating).filter(r => r !== null && r > 0);
    const targetRatings = allItems.map(i => i.target_rating).filter(r => r !== null && r > 0);

    let minR = Math.floor(Math.min(...baseRatings, ...targetRatings) - 25);
    let maxR = Math.ceil(Math.max(...baseRatings, ...targetRatings) + 25);
    if (maxR - minR < 40) { minR -= 20; maxR += 20; }

    const getX = (r) => margin.left + ((r - minR) / (maxR - minR)) * plotWidth;
    const getY = (r) => margin.top + plotHeight - ((r - minR) / (maxR - minR)) * plotHeight;

    const svg = this._svgEl('svg', {
      viewBox: `0 0 ${width} ${height}`,
      class: 'ratings-chart-svg',
      'data-compare-chart': 'scatter',
      role: 'img',
      'aria-label': '前后等级分散点图'
    });

    svg.appendChild(this._svgEl('rect', {
      class: 'chart-bg-rect',
      width,
      height,
      fill: colors.bg,
      rx: 8
    }));

    svg.appendChild(this._svgEl('text', {
      x: width / 2,
      y: 25,
      'text-anchor': 'middle',
      fill: colors.text,
      'font-size': 13,
      'font-weight': 700
    }, `前后等级分对比 (${data.base_month_str || ''} → ${data.target_month_str || ''})`));

    // 刻度与网格线
    const steps = 5;
    for (let i = 0; i <= steps; i++) {
      const val = Math.round(minR + (i / steps) * (maxR - minR));
      const x = getX(val);
      const y = getY(val);

      svg.appendChild(this._svgEl('line', {
        x1: x,
        y1: margin.top,
        x2: x,
        y2: margin.top + plotHeight,
        stroke: colors.gridDashed,
        'stroke-dasharray': '2 3'
      }));
      svg.appendChild(this._svgEl('text', {
        x,
        y: margin.top + plotHeight + 16,
        'text-anchor': 'middle',
        fill: colors.textMuted,
        'font-size': 9.5
      }, val));

      svg.appendChild(this._svgEl('line', {
        x1: margin.left,
        y1: y,
        x2: margin.left + plotWidth,
        y2: y,
        stroke: colors.gridDashed,
        'stroke-dasharray': '2 3'
      }));
      svg.appendChild(this._svgEl('text', {
        x: margin.left - 8,
        y: y + 3,
        'text-anchor': 'end',
        fill: colors.textMuted,
        'font-size': 9.5
      }, val));
    }

    // 45度参考线 (y = x)
    svg.appendChild(this._svgEl('line', {
      x1: getX(minR),
      y1: getY(minR),
      x2: getX(maxR),
      y2: getY(maxR),
      stroke: colors.zeroLine,
      'stroke-dasharray': '5 4',
      'stroke-width': 1.4
    }));

    // X / Y 轴
    svg.appendChild(this._svgEl('line', {
      x1: margin.left,
      y1: margin.top + plotHeight,
      x2: margin.left + plotWidth,
      y2: margin.top + plotHeight,
      stroke: colors.axis,
      'stroke-width': 1.2
    }));
    svg.appendChild(this._svgEl('line', {
      x1: margin.left,
      y1: margin.top,
      x2: margin.left,
      y2: margin.top + plotHeight,
      stroke: colors.axis,
      'stroke-width': 1.2
    }));

    // 轴标题
    svg.appendChild(this._svgEl('text', {
      x: margin.left + plotWidth / 2,
      y: height - 10,
      'text-anchor': 'middle',
      fill: colors.textMuted,
      'font-size': 10.5,
      'font-weight': 600
    }, `${data.base_month_str || '基准月'} 等级分`));

    svg.appendChild(this._svgEl('text', {
      x: 15,
      y: margin.top + plotHeight / 2,
      transform: `rotate(-90 15 ${margin.top + plotHeight / 2})`,
      'text-anchor': 'middle',
      fill: colors.textMuted,
      'font-size': 10.5,
      'font-weight': 600
    }, `${data.target_month_str || '目标月'} 等级分`));

    // 左上角精简图例
    const legendSpec = [
      { label: '上涨', color: '#10b981' },
      { label: '下跌', color: '#ef4444' },
      { label: '持平', color: '#6b7280' }
    ];
    legendSpec.forEach((lg, idx) => {
      const lx = margin.left + 12 + idx * 52;
      const ly = margin.top + 14;
      svg.appendChild(this._svgEl('circle', { cx: lx, cy: ly - 3, r: 3.5, fill: lg.color }));
      svg.appendChild(this._svgEl('text', {
        x: lx + 7,
        y: ly,
        fill: colors.textMuted,
        'font-size': 9.5,
        'font-weight': 600
      }, lg.label));
    });

    // 散点绘制
    const dotRadius = allItems.length > 180 ? 3.2 : 3.8;
    allItems.forEach(item => {
      if (!item.base_rating || !item.target_rating) return;
      const cx = getX(item.base_rating);
      const cy = getY(item.target_rating);
      const diff = item.rating_diff || 0;

      const circle = this._svgEl('circle', {
        cx,
        cy,
        r: dotRadius,
        fill: diff > 0 ? '#10b981' : (diff < 0 ? '#ef4444' : '#6b7280'),
        'fill-opacity': 0.72,
        stroke: colors.bg,
        'stroke-width': 0.7
      });
      circle.style.cursor = 'pointer';

      const title = this._svgEl('title', {}, `${item.player_clean}: ${item.base_rating} → ${item.target_rating} (${diff >= 0 ? '+' : ''}${diff.toFixed(1)})`);
      circle.appendChild(title);
      circle.onclick = () => window.GoViewerRatings?.openPlayer(item.player_clean);

      svg.appendChild(circle);
    });

    // Top 显著变化棋手防重叠标注（借鉴 Go-Ranking-Tool 散点标注策略）
    const notable = allItems
      .filter(i => i.base_rating && i.target_rating && Math.abs(i.rating_diff || 0) > 0)
      .slice()
      .sort((a, b) => Math.abs(b.rating_diff || 0) - Math.abs(a.rating_diff || 0))
      .slice(0, 6);
    if (notable.length > 0) {
      const labelCandidates = notable.map((item, idx) => ({
        x: getX(item.base_rating),
        anchorY: getY(item.target_rating),
        text: item.player_clean,
        color: (item.rating_diff || 0) >= 0 ? '#10b981' : '#ef4444',
        preferAbove: (item.rating_diff || 0) >= 0,
        priority: 10 - idx,
        offset: 10
      }));
      placePointLabels(svg, labelCandidates, { left: margin.left, top: margin.top, width: plotWidth, height: plotHeight }, {
        fontSize: 8.5,
        minXSpacing: 38,
        leaderColor: colors.textMuted,
        maxLabels: 6
      });
    }

    body.appendChild(svg);
    return card;
  }

  // 3. 分值变动分布直方图
  _buildDistributionCard(data) {
    const colors = this._colors();
    const card = document.createElement('div');
    card.className = 'ratings-card compare-chart-card';
    card.innerHTML = `
      <div class="ratings-card-header">
        <h4>${iconSvg('trend', 15)} 等级分变动分布直方图</h4>
      </div>
      <div class="compare-chart-body"></div>
    `;

    const body = card.querySelector('.compare-chart-body');
    const categories = data.categories || {};
    const allDiffs = [...(categories.up || []), ...(categories.down || []), ...(categories.equal || [])]
      .map(i => i.rating_diff)
      .filter(d => d !== null && d !== undefined);

    if (allDiffs.length === 0) {
      body.innerHTML = '<div class="ratings-empty">无有效分差统计。</div>';
      return card;
    }

    const bins = [
      { label: '< -20', min: -Infinity, max: -20, color: '#b91c1c' },
      { label: '-20~-10', min: -20, max: -10, color: '#ef4444' },
      { label: '-10~-5', min: -10, max: -5, color: '#f87171' },
      { label: '-5~0', min: -5, max: 0, color: '#fca5a5' },
      { label: '0~+5', min: 0, max: 5, color: '#86efac' },
      { label: '+5~+10', min: 5, max: 10, color: '#4ade80' },
      { label: '+10~+20', min: 10, max: 20, color: '#22c55e' },
      { label: '> +20', min: 20, max: Infinity, color: '#15803d' }
    ];

    bins.forEach(b => {
      b.count = allDiffs.filter(d => d > b.min && d <= b.max).length;
    });

    const maxCount = Math.max(...bins.map(b => b.count), 5);
    const width = 560;
    const height = 420;
    const margin = { top: 42, right: 24, bottom: 56, left: 54 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;

    const svg = this._svgEl('svg', {
      viewBox: `0 0 ${width} ${height}`,
      class: 'ratings-chart-svg',
      'data-compare-chart': 'distribution',
      role: 'img',
      'aria-label': '等级分变动分布直方图'
    });

    svg.appendChild(this._svgEl('rect', {
      class: 'chart-bg-rect',
      width,
      height,
      fill: colors.bg,
      rx: 8
    }));

    svg.appendChild(this._svgEl('text', {
      x: width / 2,
      y: 25,
      'text-anchor': 'middle',
      fill: colors.text,
      'font-size': 13,
      'font-weight': 700
    }, `等级分变动分布 (${data.base_month_str || ''} → ${data.target_month_str || ''})`));

    // Y 轴刻度与横向虚线网格
    const ySteps = 4;
    const shownY = new Set();
    for (let i = 0; i <= ySteps; i++) {
      const val = Math.round((i / ySteps) * maxCount);
      if (shownY.has(val)) continue;
      shownY.add(val);
      const y = margin.top + plotHeight - (val / maxCount) * plotHeight;
      svg.appendChild(this._svgEl('line', {
        x1: margin.left,
        y1: y,
        x2: margin.left + plotWidth,
        y2: y,
        stroke: colors.gridDashed,
        'stroke-dasharray': i === 0 ? null : '2 3'
      }));
      svg.appendChild(this._svgEl('text', {
        x: margin.left - 8,
        y: y + 3,
        'text-anchor': 'end',
        fill: colors.textMuted,
        'font-size': 9.5
      }, val));
    }

    svg.appendChild(this._svgEl('line', {
      x1: margin.left,
      y1: margin.top,
      x2: margin.left,
      y2: margin.top + plotHeight,
      stroke: colors.axis,
      'stroke-width': 1.2
    }));
    svg.appendChild(this._svgEl('line', {
      x1: margin.left,
      y1: margin.top + plotHeight,
      x2: margin.left + plotWidth,
      y2: margin.top + plotHeight,
      stroke: colors.axis,
      'stroke-width': 1.2
    }));

    svg.appendChild(this._svgEl('text', {
      x: 15,
      y: margin.top + plotHeight / 2,
      transform: `rotate(-90 15 ${margin.top + plotHeight / 2})`,
      'text-anchor': 'middle',
      fill: colors.textMuted,
      'font-size': 10.5,
      'font-weight': 600
    }, '棋手人数'));

    const barW = (plotWidth / bins.length) * 0.7;

    bins.forEach((b, idx) => {
      const x = margin.left + (idx + 0.5) * (plotWidth / bins.length);
      const bHeight = (b.count / maxCount) * plotHeight;
      const y = margin.top + plotHeight - bHeight;

      const rect = this._svgEl('rect', {
        x: x - barW / 2,
        y,
        width: barW,
        height: Math.max(1, bHeight),
        fill: b.color,
        rx: 3
      });

      rect.appendChild(this._svgEl('title', {}, `区间 ${b.label}: ${b.count} 人 (${((b.count / allDiffs.length) * 100).toFixed(1)}%)`));
      svg.appendChild(rect);

      // 顶部人数（使用确定主题色，避免独立 SVG 导出丢失 var()）
      if (b.count > 0) {
        svg.appendChild(this._svgEl('text', {
          x,
          y: y - 5,
          'text-anchor': 'middle',
          fill: colors.text,
          'font-size': 10,
          'font-weight': 600
        }, b.count));
      }

      // X 轴标签
      svg.appendChild(this._svgEl('text', {
        x,
        y: margin.top + plotHeight + 16,
        transform: `rotate(-25 ${x} ${margin.top + plotHeight + 16})`,
        'text-anchor': 'end',
        fill: colors.textMuted,
        'font-size': 9.5
      }, b.label));
    });

    body.appendChild(svg);
    return card;
  }

  _buildExportSvg() {
    if (!this.container) return null;
    const svgs = Array.from(this.container.querySelectorAll('svg.ratings-chart-svg'));
    if (svgs.length === 0) return null;

    const colors = this._colors();
    const fontFamily = 'system-ui, -apple-system, "Microsoft YaHei", "PingFang SC", sans-serif';

    if (svgs.length === 1) {
      const svg = svgs[0];
      const vb = svg.viewBox?.baseVal;
      const baseW = (vb && vb.width) ? vb.width : 640;
      const baseH = (vb && vb.height) ? vb.height : 420;
      const { vx, vy, vw, vh } = computeTightSvgViewBox(svg, baseW, baseH, 10);

      const clone = svg.cloneNode(true);
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('viewBox', `${vx} ${vy} ${vw} ${vh}`);
      clone.setAttribute('width', String(vw));
      clone.setAttribute('height', String(vh));
      clone.style.fontFamily = fontFamily;
      const bg = clone.querySelector('.chart-bg-rect') || clone.querySelector('rect');
      if (bg) {
        bg.setAttribute('x', String(vx));
        bg.setAttribute('y', String(vy));
        bg.setAttribute('width', String(vw));
        bg.setAttribute('height', String(vh));
        bg.setAttribute('rx', '0');
      }
      return {
        svgString: new XMLSerializer().serializeToString(clone),
        width: vw,
        height: vh
      };
    }

    // 全部三图模式：按「上行 Top N 条形图 + 下行散点图与直方图并排」无损拼合导出
    const boxes = svgs.map(svg => {
      const vb = svg.viewBox?.baseVal;
      const bw = (vb && vb.width) ? vb.width : 560;
      const bh = (vb && vb.height) ? vb.height : 420;
      return Object.assign({ svg }, computeTightSvgViewBox(svg, bw, bh, 4));
    });

    const outerPad = 24;
    const headerH = 40;
    const colGap = 20;
    const rowGap = 20;
    const bottomPair = boxes.slice(1, 3);
    const pairWidth = bottomPair.reduce((s, b) => s + b.vw, 0) + (bottomPair.length > 1 ? colGap : 0);
    const innerWidth = Math.max(pairWidth, boxes[0].vw, 960);

    const row1Scale = boxes[0].vw > innerWidth ? innerWidth / boxes[0].vw : Math.min(1.22, innerWidth / boxes[0].vw);
    const row1W = boxes[0].vw * row1Scale;
    const row1H = boxes[0].vh * row1Scale;
    const row1X = outerPad + (innerWidth - row1W) / 2;
    const row1Y = outerPad + headerH;

    const row2H = bottomPair.length ? Math.max(...bottomPair.map(b => b.vh)) : 0;
    const row2Y = row1Y + row1H + (bottomPair.length ? rowGap : 0);

    const totalW = Math.ceil(innerWidth + outerPad * 2);
    const totalH = Math.ceil(row2Y + row2H + outerPad);

    const composite = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    composite.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    composite.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);
    composite.setAttribute('width', String(totalW));
    composite.setAttribute('height', String(totalH));
    composite.style.fontFamily = fontFamily;

    composite.appendChild(this._svgEl('rect', {
      x: 0,
      y: 0,
      width: totalW,
      height: totalH,
      fill: colors.bg
    }));

    const data = this.compareData || {};
    composite.appendChild(this._svgEl('text', {
      x: totalW / 2,
      y: outerPad + 22,
      'text-anchor': 'middle',
      fill: colors.text,
      'font-size': 16,
      'font-weight': 700
    }, `月度对比 [${data.base_month_str || ''} → ${data.target_month_str || ''}] · 共 ${data.summary?.total_players_compared || 0} 人`));

    const appendPanel = (box, x, y, scale) => {
      const panelG = this._svgEl('g', {
        transform: `translate(${(x - box.vx * scale).toFixed(1)}, ${(y - box.vy * scale).toFixed(1)}) scale(${scale.toFixed(4)})`
      });
      Array.from(box.svg.childNodes).forEach(child => {
        panelG.appendChild(child.cloneNode(true));
      });
      panelG.appendChild(this._svgEl('rect', {
        x: box.vx,
        y: box.vy,
        width: box.vw,
        height: box.vh,
        fill: 'none',
        stroke: colors.axis,
        'stroke-opacity': 0.35,
        'stroke-width': 1,
        rx: 8
      }));
      composite.appendChild(panelG);
    };

    appendPanel(boxes[0], row1X, row1Y, row1Scale);

    if (bottomPair.length > 0) {
      let curX = outerPad + (innerWidth - pairWidth) / 2;
      bottomPair.forEach(box => {
        appendPanel(box, curX, row2Y, 1);
        curX += box.vw + colGap;
      });
    }

    return {
      svgString: new XMLSerializer().serializeToString(composite),
      width: totalW,
      height: totalH
    };
  }

  exportSvg(filename = 'compare_charts') {
    const built = this._buildExportSvg();
    if (!built) return null;
    const blob = new Blob([built.svgString], { type: 'image/svg+xml;charset=utf-8' });
    triggerDownloadBlob(blob, `${filename}.svg`);
    return built;
  }

  async exportPng(filename = 'compare_charts') {
    const built = this._buildExportSvg();
    if (!built) return null;
    const scale = 2;
    const blob = await svgStringToPngBlob(built.svgString, built.width, built.height, scale);
    if (!blob) return null;
    triggerDownloadBlob(blob, `${filename}.png`);
    const meta = {
      width: Math.round(built.width * scale),
      height: Math.round(built.height * scale),
      size: blob.size,
      filename: `${filename}.png`
    };
    this._lastExportInfo = meta;
    return meta;
  }
}

window.GoViewerRatingsChart = {
  MODES,
  PALETTE,
  RatingChartRenderer,
  ComparisonChartRenderer,
  create: (container, options) => new RatingChartRenderer(container, options),
  createComparison: (container, options) => new ComparisonChartRenderer(container, options),
  buildTimeLabels,
  extractMonthKey,
  buildSplinePath,
  iconSvg
};

})();