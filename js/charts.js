// Hand-drawn SVG charts (no library, works offline). Colors come from CSS theme variables.
import { esc } from './ui.js';

function niceTicks(min, max, count = 4) {
  if (min === max) { min = min - 1; max = max + 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || mag * 10;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { lo, hi, ticks };
}
const fmtTick = (v) => (Math.abs(v) >= 10000 ? `${Math.round(v / 1000)}k` : Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(Math.round(v * 10) / 10));

// points: [{label, value|null}] — nulls are gaps; the line connects across them.
export function lineChart(points, { height = 180, unit = '', zeroBased = false, fmt = (v) => fmtTick(v) } = {}) {
  const W = 340, H = height, L = 36, R = 12, T = 14, B = 24;
  const vals = points.map((p) => p.value).filter((v) => v != null);
  if (!vals.length) return `<div class="chart-empty">No data in this range yet</div>`;
  let min = Math.min(...vals), max = Math.max(...vals);
  if (zeroBased) min = 0; else { const pad = (max - min) * 0.15 || max * 0.05 || 1; min -= pad; max += pad; }
  const { lo, hi, ticks } = niceTicks(min, max);
  const x = (i) => L + (points.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (points.length - 1));
  const y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo || 1));
  const pts = points.map((p, i) => (p.value == null ? null : [x(i), y(p.value), p]));
  const real = pts.filter(Boolean);
  const d = real.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const area = real.length > 1 ? `${d} L${real[real.length - 1][0].toFixed(1)} ${H - B} L${real[0][0].toFixed(1)} ${H - B}Z` : '';
  const labelEvery = Math.ceil(points.length / 6);
  const last = real[real.length - 1];
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Line chart">
    ${ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${L - 6}" y="${y(t) + 3.5}" text-anchor="end" class="tick">${fmt(t)}</text>`).join('')}
    ${points.map((p, i) => ((points.length - 1 - i) % labelEvery === 0 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" class="tick">${esc(p.label)}</text>` : '')).join('')}
    ${area ? `<path d="${area}" class="area"/>` : ''}
    <path d="${d}" class="line"/>
    ${real.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="3" class="dot"><title>${esc(p[2].label)}: ${fmt(p[2].value)}${unit}</title></circle>`).join('')}
    <circle cx="${last[0]}" cy="${last[1]}" r="5.5" class="dot end"/>
    <text x="${Math.min(last[0], W - R - 2)}" y="${Math.max(last[1] - 10, 10)}" text-anchor="end" class="endlabel">${fmt(last[2].value)}${unit}</text>
  </svg>`;
}

export function barChart(points, { height = 170, unit = '', fmt = fmtTick, highlightLast = true, target = null } = {}) {
  const W = 340, H = height, L = 36, R = 8, T = 14, B = 24;
  const max0 = Math.max(...points.map((p) => p.value || 0), target || 0);
  if (!max0) return `<div class="chart-empty">No workouts logged in this range yet</div>`;
  const { hi, ticks } = niceTicks(0, max0);
  const slot = (W - L - R) / points.length;
  const bw = Math.min(26, slot * 0.62);
  const y = (v) => T + (H - T - B) * (1 - v / hi);
  const labelEvery = Math.ceil(points.length / 6);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Bar chart">
    ${ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${L - 6}" y="${y(t) + 3.5}" text-anchor="end" class="tick">${fmt(t)}</text>`).join('')}
    ${target ? `<line x1="${L}" x2="${W - R}" y1="${y(target)}" y2="${y(target)}" class="target"/>` : ''}
    ${points.map((p, i) => {
      const cx = L + slot * i + slot / 2, v = p.value || 0, top = y(v);
      const cls = highlightLast && i === points.length - 1 ? 'vbar now' : 'vbar';
      return `<rect x="${cx - bw / 2}" y="${top}" width="${bw}" height="${Math.max(0, H - B - top)}" rx="4" class="${cls}"><title>${esc(p.label)}: ${fmt(v)}${unit}</title></rect>
        ${(points.length - 1 - i) % labelEvery === 0 ? `<text x="${cx}" y="${H - 6}" text-anchor="middle" class="tick">${esc(p.label)}</text>` : ''}`;
    }).join('')}
  </svg>`;
}

// Horizontal bars, e.g. sets per muscle group this week vs last week
export function hbars(rows, { fmt = (v) => v } = {}) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.a || 0, r.b || 0]));
  return `<div class="hbars">${rows.map((r) => `
    <div class="hb-row"><span class="hb-l">${esc(r.label)}</span>
      <div class="hb-tracks"><div class="hb a" style="width:${((r.a || 0) / max) * 100}%"></div><div class="hb b" style="width:${((r.b || 0) / max) * 100}%"></div></div>
      <span class="hb-v">${fmt(r.a || 0)}</span></div>`).join('')}</div>`;
}

export function ring(frac, size = 64, stroke = 7) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="ring-svg"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-bg" stroke-width="${stroke}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-fg" stroke-width="${stroke}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - Math.max(0, Math.min(1, frac)))}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>`;
}

export function sparkline(values, { w = 120, h = 34 } = {}) {
  const v = values.filter((x) => x != null);
  if (v.length < 2) return '';
  const min = Math.min(...v), max = Math.max(...v);
  const pts = v.map((val, i) => [(i * (w - 6)) / (v.length - 1) + 3, h - 4 - ((val - min) / (max - min || 1)) * (h - 8)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const l = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><path d="${d}" class="line"/><circle cx="${l[0]}" cy="${l[1]}" r="3" class="dot end"/></svg>`;
}
