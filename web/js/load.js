import { html, useState, useEffect, useApp, api, go, Empty, addDays, mondayOf, schoolWeek, store, persist } from './lib.js';
import { weekTitle, fmtMinutes, breaches } from './schedule.js';

// "Rozložení hodin": how a pupil's week splits between subjects, counted from the
// classes they signed up for. Three chart views plus a plain table, and limits the
// pupil sets themselves ("hlídání"), which raise a warning when the week breaks them.

const MODES = [['pie', 'Koláč'], ['slope', 'Proti minulému týdnu'], ['radar', 'Radar'], ['table', 'Tabulka']];
const hrs = (m) => (Math.round((m / 60) * 10) / 10).toString().replace('.', ',') + ' h';
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0) + ' %';

export function LoadPage({ params }) {
  const { boot, maps, toast } = useApp();
  const week = params.w ? mondayOf(params.w) : schoolWeek();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const load = () => api('GET', `/api/student/load?week=${week}`, undefined, { quiet: true }).then((x) => { setD(x); setErr(''); }).catch((e) => setErr(e.message));
  useEffect(() => { setD(null); load(); }, [week]);

  if (!boot.students.length) {
    return html`<div class="page"><${Head} week=${week} />
      <${Empty}>Tvůj účet zatím není propojený se záznamem žáka. Požádej tutora, aby ke tvému jménu v Ravenu doplnil e-mail.<//></div>`;
  }
  if (err) return html`<div class="page"><${Head} week=${week} /><p class="bad">${err}</p></div>`;
  if (!d) return html`<div class="page"><${Head} week=${week} /><div class="loading-inline">Načítám…</div></div>`;

  return html`<div class="page load-page">
    <${Head} week=${week} />
    <${LoadView} d=${d} you empty=${html`Na tento ani minulý týden nejsi přihlášený na žádnou hodinu. Přihlásíš se v <a href=${'#/rozvrh?w=' + week}>rozvrhu</a> – klikni na hodinu a zaškrtni „Jdu na tuto hodinu“.`} />
    <${AlertsForm} alerts=${d.alerts} onSaved=${(a) => { setD({ ...d, alerts: a }); toast('Hlídání uloženo.'); }} />
  </div>`;
}

// Stats, warnings and the four chart views for one pupil's week. Used by the pupil's
// own "Rozložení hodin" page (you = true) and by the teachers' student card.
export function LoadView({ d, you, empty, hideWarn }) {
  const { maps } = useApp();
  const [mode, setModeRaw] = useState(() => store('loadMode', 'pie'));
  const setMode = (m) => { setModeRaw(m); persist('loadMode', m); };
  const [hover, setHover] = useState(null);
  // every subject the pupil has this week or had last week, biggest first
  const subj = (id) => maps.subjects[id] || { name: 'Předmět', short: '?', color: '#888' };
  const rows = d.subjects.map((x) => ({ ...x, name: subj(x.subject_id).name, short: subj(x.subject_id).short, color: subj(x.subject_id).color }))
    .sort((a, b) => b.minutes - a.minutes || b.prev_minutes - a.prev_minutes || a.name.localeCompare(b.name, 'cs'));
  const total = rows.reduce((t, r) => t + r.minutes, 0);
  const prevTotal = rows.reduce((t, r) => t + r.prev_minutes, 0);
  const lessons = rows.reduce((t, r) => t + r.lessons, 0);
  const warn = breaches(d, maps);
  const alertBy = Object.fromEntries(d.alerts.map((a) => [a.subject_id, a]));
  const shown = rows.filter((r) => r.minutes > 0);
  const hv = hover && rows.find((r) => r.subject_id === hover);
  return html`
    <div class="load-stats">
      <div><b>${fmtMinutes(total) || '0 h'}</b><span>výuky tento týden</span></div>
      <div><b>${lessons}</b><span>${lessons === 1 ? 'hodina' : lessons >= 2 && lessons <= 4 ? 'hodiny' : 'hodin'}</span></div>
      <div><b>${shown.length}</b><span>${shown.length === 1 ? 'předmět' : shown.length >= 2 && shown.length <= 4 ? 'předměty' : 'předmětů'}</span></div>
      <div><b>${total - prevTotal > 0 ? '+' : ''}${hrs(total - prevTotal)}</b><span>proti minulému týdnu</span></div>
    </div>
    ${!hideWarn && warn.length > 0 && html`<ul class="load-warn">${warn.map((w) => html`<li class=${'is-' + w.kind}>
      <span class="lw-icon" aria-hidden="true">${w.kind === 'low' ? '▼' : '▲'}</span>
      <span><b>${w.kind === 'low' ? 'Málo' : 'Moc'}: ${w.name}</b> – tento týden ${hrs(w.minutes)}, ${you ? 'hlídáš' : 'žák si hlídá'} ${w.kind === 'low' ? 'alespoň' : 'nejvýše'} ${hrs(w.limit)}.</span>
    </li>`)}</ul>`}
    <div class="seg load-modes" role="tablist">
      ${MODES.map(([k, label]) => html`<button type="button" role="tab" aria-selected=${mode === k} class=${'seg-b' + (mode === k ? ' on' : '')} onClick=${() => setMode(k)}>${label}</button>`)}
    </div>
    ${total === 0 && prevTotal === 0 ? html`<${Empty}>${empty}<//>` : html`
      <div class="chart-card">
        <div class="chart-readout">${hv ? html`<i style=${`background:${hv.color}`}></i><b>${hv.name}</b> · tento týden ${fmtMinutes(hv.minutes) || '0 h'} (${pct(hv.minutes, total)}) · minulý ${fmtMinutes(hv.prev_minutes) || '0 h'}`
          : html`<span class="muted">${matchMedia('(hover: none)').matches ? 'Klepni' : 'Najeď'} na předmět pro podrobnosti.</span>`}</div>
        ${mode === 'pie' && (shown.length ? html`<${Pie} rows=${shown} total=${total} hover=${hover} setHover=${setHover} />` : html`<p class="muted">Tento týden zatím žádné hodiny.</p>`)}
        ${mode === 'slope' && html`<${Slope} rows=${rows} hover=${hover} setHover=${setHover} />`}
        ${mode === 'radar' && html`<${Radar} rows=${rows} alerts=${alertBy} hover=${hover} setHover=${setHover} />`}
        ${mode === 'table' && html`<${LoadTable} rows=${rows} total=${total} alerts=${alertBy} />`}
      </div>`}`;
}

export const hoursText = hrs;

function Head({ week }) {
  return html`<div class="page-head sched-head">
    <div class="page-title-wrap">
      <div class="week-no">Rozložení hodin</div>
      <h1 class="page-title">${weekTitle(week)}</h1>
    </div>
    <div class="sched-nav">
      <button class="btn btn-sq" title="Předchozí týden" onClick=${() => go('rozlozeni', { w: addDays(week, -7) })}>←</button>
      <button class=${'btn' + (week === schoolWeek() ? ' btn-on' : '')} onClick=${() => go('rozlozeni', {})}>Tento týden</button>
      <button class="btn btn-sq" title="Další týden" onClick=${() => go('rozlozeni', { w: addDays(week, 7) })}>→</button>
    </div>
  </div>`;
}

function Legend({ rows, total, hover, setHover, prev }) {
  return html`<ul class="chart-legend">${rows.map((r) => html`<li class=${hover === r.subject_id ? 'on' : hover ? 'dim' : ''}
      onMouseEnter=${() => setHover(r.subject_id)} onMouseLeave=${() => setHover(null)}>
    <i style=${`background:${r.color}`}></i><span class="cl-name">${r.name}</span>
    <span class="cl-val">${prev ? `${hrs(r.prev_minutes)} → ${hrs(r.minutes)}` : `${hrs(r.minutes)} · ${pct(r.minutes, total)}`}</span>
  </li>`)}</ul>`;
}

// ---------- pie ----------
function Pie({ rows, total, hover, setHover }) {
  const R = 130, C = 150;
  let a0 = -Math.PI / 2;
  const slices = rows.map((r) => {
    const a1 = a0 + (r.minutes / total) * Math.PI * 2;
    const mid = (a0 + a1) / 2;
    const big = a1 - a0 > Math.PI ? 1 : 0;
    const p = (a) => `${C + R * Math.cos(a)},${C + R * Math.sin(a)}`;
    const d = rows.length === 1 ? `M${C - R},${C} a${R},${R} 0 1,0 ${2 * R},0 a${R},${R} 0 1,0 ${-2 * R},0`
      : `M${C},${C} L${p(a0)} A${R},${R} 0 ${big} 1 ${p(a1)} Z`;
    const s = { r, d, mid, share: r.minutes / total };
    a0 = a1;
    return s;
  });
  return html`<div class="chart-row">
    <svg class="chart pie" viewBox="0 0 300 300" role="img" aria-label="Podíl předmětů na týdnu">
      ${slices.map((s) => {
        const on = hover === s.r.subject_id;
        const dx = on ? Math.cos(s.mid) * 6 : 0, dy = on ? Math.sin(s.mid) * 6 : 0;
        return html`<path d=${s.d} fill=${s.r.color} class=${'slice' + (hover && !on ? ' dim' : '')} transform=${`translate(${dx},${dy})`}
          onMouseEnter=${() => setHover(s.r.subject_id)} onMouseLeave=${() => setHover(null)}><title>${s.r.name}: ${hrs(s.r.minutes)}</title></path>`;
      })}
      ${slices.filter((s) => s.share >= 0.08).map((s) => html`<text class="pie-lab" x=${C + R * 0.66 * Math.cos(s.mid)} y=${C + R * 0.66 * Math.sin(s.mid)}
          text-anchor="middle" dominant-baseline="central" style=${`fill:${inkOn(s.r.color)}`}>${s.r.short || s.r.name.slice(0, 3)}</text>`)}
    </svg>
    <${Legend} rows=${rows} total=${total} hover=${hover} setHover=${setHover} />
  </div>`;
}

// ---------- slope: last week → this week ----------
function Slope({ rows, hover, setHover }) {
  const W = 560, H = 340, top = 24, bot = 36, xL = 70, xR = 330;
  const max = Math.max(60, ...rows.map((r) => Math.max(r.minutes, r.prev_minutes)));
  const step = niceStep(max / 60);
  const maxH = Math.ceil(max / 60 / step) * step;
  const y = (m) => top + (H - top - bot) * (1 - m / 60 / maxH);
  const ticks = [];
  for (let t = 0; t <= maxH + 1e-9; t += step) ticks.push(t);
  // right-hand labels, pushed apart so they never overlap
  const labs = rows.map((r) => ({ r, y: y(r.minutes) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labs.length; i++) if (labs[i].y - labs[i - 1].y < 16) labs[i].y = labs[i - 1].y + 16;
  return html`<div class="chart-row">
    <svg class="chart slope" viewBox=${`0 0 ${W} ${H}`} role="img" aria-label="Změna počtu hodin proti minulému týdnu">
      ${ticks.map((t) => html`<g class="grid"><line x1=${xL - 8} x2=${xR + 8} y1=${y(t * 60)} y2=${y(t * 60)} /><text x=${xL - 16} y=${y(t * 60)} text-anchor="end" dominant-baseline="central">${String(t).replace('.', ',')} h</text></g>`)}
      <line class="axis" x1=${xL} x2=${xL} y1=${top - 6} y2=${H - bot} /><line class="axis" x1=${xR} x2=${xR} y1=${top - 6} y2=${H - bot} />
      <text class="axis-lab" x=${xL} y=${H - 12} text-anchor="middle">minulý týden</text>
      <text class="axis-lab" x=${xR} y=${H - 12} text-anchor="middle">tento týden</text>
      ${rows.map((r) => {
        const on = hover === r.subject_id, dim = hover && !on;
        return html`<g class=${'sl' + (dim ? ' dim' : '') + (on ? ' on' : '')} onMouseEnter=${() => setHover(r.subject_id)} onMouseLeave=${() => setHover(null)}>
          <line class="sl-hit" x1=${xL} y1=${y(r.prev_minutes)} x2=${xR} y2=${y(r.minutes)} />
          <line class="sl-line" x1=${xL} y1=${y(r.prev_minutes)} x2=${xR} y2=${y(r.minutes)} stroke=${r.color} />
          <circle class="sl-dot" cx=${xL} cy=${y(r.prev_minutes)} r="5" fill=${r.color} />
          <circle class="sl-dot" cx=${xR} cy=${y(r.minutes)} r="5" fill=${r.color} />
        </g>`;
      })}
      ${labs.map(({ r, y: ly }) => html`<text class=${'sl-lab' + (hover && hover !== r.subject_id ? ' dim' : '')} x=${xR + 14} y=${ly} dominant-baseline="central"
          onMouseEnter=${() => setHover(r.subject_id)} onMouseLeave=${() => setHover(null)}>${r.name} <tspan class="sl-val">${hrs(r.minutes)}</tspan></text>`)}
    </svg>
    <${Legend} rows=${rows} prev hover=${hover} setHover=${setHover} />
  </div>`;
}

// ---------- radar: one axis per subject, with the pupil's own limits ----------
function Radar({ rows, alerts, hover, setHover }) {
  // watched subjects the pupil has no class in still get an axis, so a "too little" shows as zero
  const { maps } = useApp();
  const list = [...rows];
  for (const id of Object.keys(alerts).map(Number)) {
    if (list.some((r) => r.subject_id === id)) continue;
    const s = maps.subjects[id] || {};
    list.push({ subject_id: id, name: s.name || 'Předmět', short: s.short, color: s.color || '#888', minutes: 0, prev_minutes: 0, lessons: 0 });
  }
  if (list.length < 3) return html`<p class="muted">Radar potřebuje alespoň tři předměty – tento týden jich máš ${list.length}. Zkus koláč nebo tabulku.</p>`;
  const S = 360, C = S / 2, R = 128;
  const lim = (a) => Math.max(a?.min_minutes || 0, a?.max_minutes || 0);
  const max = Math.max(60, ...list.map((r) => Math.max(r.minutes, r.prev_minutes, lim(alerts[r.subject_id]))));
  const step = niceStep(max / 60);
  const maxH = Math.ceil(max / 60 / step) * step;
  const ang = (i) => -Math.PI / 2 + (i / list.length) * Math.PI * 2;
  const pt = (i, m) => [C + R * (m / 60 / maxH) * Math.cos(ang(i)), C + R * (m / 60 / maxH) * Math.sin(ang(i))];
  const poly = (f) => list.map((r, i) => pt(i, f(r)).join(',')).join(' ');
  const rings = [];
  for (let t = step; t <= maxH + 1e-9; t += step) rings.push(t);
  return html`<div class="chart-row">
    <svg class="chart radar" viewBox=${`0 0 ${S} ${S}`} role="img" aria-label="Hodiny podle předmětů">
      ${rings.map((t) => html`<polygon class="ring" points=${list.map((_, i) => pt(i, t * 60).join(',')).join(' ')} />`)}
      ${rings.map((t) => { const g = -Math.PI / 2 + Math.PI / list.length, r = R * (t / maxH); // between the first two spokes
        return html`<text class="ring-lab" x=${C + r * Math.cos(g)} y=${C + r * Math.sin(g)} text-anchor="middle" dominant-baseline="central">${String(t).replace('.', ',')} h</text>`; })}
      ${list.map((r, i) => { const [x, y] = pt(i, maxH * 60); return html`<line class="spoke" x1=${C} y1=${C} x2=${x} y2=${y} />`; })}
      <polygon class="rd-prev" points=${poly((r) => r.prev_minutes)} />
      <polygon class="rd-now" points=${poly((r) => r.minutes)} />
      ${list.map((r, i) => {
        const a = alerts[r.subject_id];
        const tick = (m, cls) => { const [x, y] = pt(i, m); const n = ang(i) + Math.PI / 2; return html`<line class=${'rd-lim ' + cls} x1=${x - 6 * Math.cos(n)} y1=${y - 6 * Math.sin(n)} x2=${x + 6 * Math.cos(n)} y2=${y + 6 * Math.sin(n)} />`; };
        return html`${a?.min_minutes != null && tick(a.min_minutes, 'is-min')}${a?.max_minutes != null && tick(a.max_minutes, 'is-max')}`;
      })}
      ${list.map((r, i) => { const [x, y] = pt(i, r.minutes); return html`<circle class=${'rd-dot' + (hover === r.subject_id ? ' on' : '')} cx=${x} cy=${y} r=${hover === r.subject_id ? 7 : 5} fill=${r.color}
          onMouseEnter=${() => setHover(r.subject_id)} onMouseLeave=${() => setHover(null)}><title>${r.name}: ${hrs(r.minutes)}</title></circle>`; })}
      ${list.map((r, i) => { const [x, y] = pt(i, maxH * 60 * 1.13); const c = Math.cos(ang(i));
        return html`<text class=${'rd-lab' + (hover && hover !== r.subject_id ? ' dim' : '')} x=${x} y=${y} text-anchor=${Math.abs(c) < 0.2 ? 'middle' : c > 0 ? 'start' : 'end'} dominant-baseline="central"
          onMouseEnter=${() => setHover(r.subject_id)} onMouseLeave=${() => setHover(null)}>${r.short || r.name}</text>`; })}
    </svg>
    <div class="radar-key">
      <div><i class="k-now"></i>tento týden</div>
      <div><i class="k-prev"></i>minulý týden</div>
      <div><i class="k-min"></i>tvoje spodní hranice</div>
      <div><i class="k-max"></i>tvoje horní hranice</div>
      <${Legend} rows=${list} total=${list.reduce((t, r) => t + r.minutes, 0)} hover=${hover} setHover=${setHover} />
    </div>
  </div>`;
}

function LoadTable({ rows, total, alerts }) {
  return html`<div class="table-wrap"><table class="ledger load-table">
    <thead><tr><th>Předmět</th><th class="num">Tento týden</th><th class="num">Podíl</th><th class="num">Minulý týden</th><th class="num">Změna</th><th>Hlídání</th></tr></thead>
    <tbody>${rows.map((r) => {
      const a = alerts[r.subject_id];
      const diff = r.minutes - r.prev_minutes;
      return html`<tr>
        <td><i class="sw" style=${`background:${r.color}`}></i>${r.name}</td>
        <td class="num">${fmtMinutes(r.minutes) || '–'} <span class="muted">(${r.lessons}×)</span></td>
        <td class="num">${pct(r.minutes, total)}</td>
        <td class="num">${fmtMinutes(r.prev_minutes) || '–'}</td>
        <td class="num">${diff === 0 ? '0' : (diff > 0 ? '+' : '−') + hrs(Math.abs(diff))}</td>
        <td>${a ? [a.min_minutes != null && `alespoň ${hrs(a.min_minutes)}`, a.max_minutes != null && `nejvýše ${hrs(a.max_minutes)}`].filter(Boolean).join(', ') : html`<span class="muted">–</span>`}</td>
      </tr>`;
    })}</tbody>
    <tfoot><tr><td>Celkem</td><td class="num">${fmtMinutes(total) || '0 h'}</td><td></td><td class="num">${fmtMinutes(rows.reduce((t, r) => t + r.prev_minutes, 0)) || '0 h'}</td><td></td><td></td></tr></tfoot>
  </table></div>`;
}

// ---------- the pupil's own limits ----------
function AlertsForm({ alerts, onSaved }) {
  const { boot } = useApp();
  const toVal = (m) => (m == null ? '' : String(m / 60).replace('.', ','));
  const init = () => Object.fromEntries(boot.subjects.map((s) => { const a = alerts.find((x) => x.subject_id === s.id); return [s.id, { min: toVal(a?.min_minutes), max: toVal(a?.max_minutes) }]; }));
  const [f, setF] = useState(init);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(alerts.length > 0);
  const parse = (v) => { const t = String(v).trim().replace(',', '.'); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? Math.round(n * 60) : NaN; };
  const save = async (e) => {
    e.preventDefault();
    const body = [];
    for (const s of boot.subjects) {
      const min = parse(f[s.id].min), max = parse(f[s.id].max);
      if (Number.isNaN(min) || Number.isNaN(max)) { setErr(`${s.name}: zadej počet hodin číslem, např. 2 nebo 1,5.`); return; }
      if (min != null && max != null && min > max) { setErr(`${s.name}: spodní hranice je vyšší než horní.`); return; }
      if (min != null || max != null) body.push({ subject_id: s.id, min_minutes: min, max_minutes: max });
    }
    setBusy(true); setErr('');
    try { onSaved(await api('PUT', '/api/student/alerts', body)); } catch (x) { setErr(x.message); }
    setBusy(false);
  };
  return html`<section class="section alerts-sec">
    <div class="section-head"><h2>Hlídání předmětů</h2>
      <div class="section-aside"><button class="btn" onClick=${() => setOpen(!open)}>${open ? 'Skrýt' : 'Nastavit upozornění'}</button></div></div>
    <p class="muted">Napiš, kolik hodin týdně chceš mít alespoň nebo nejvýše. Když týden hranici překročí, Raven tě upozorní tady i v rozvrhu. Prázdné pole = nehlídat.</p>
    ${open && html`<form class="alerts-form" onSubmit=${save}>
      <div class="af-grid">
        <span class="field-label">Předmět</span><span class="field-label">Alespoň (h)</span><span class="field-label">Nejvýše (h)</span>
        ${boot.subjects.map((s) => html`
          <span class="af-name"><i class="sw" style=${`background:${s.color}`}></i>${s.name}</span>
          <input inputmode="decimal" placeholder="–" value=${f[s.id].min} onInput=${(e) => setF({ ...f, [s.id]: { ...f[s.id], min: e.target.value } })} aria-label=${s.name + ' alespoň'} />
          <input inputmode="decimal" placeholder="–" value=${f[s.id].max} onInput=${(e) => setF({ ...f, [s.id]: { ...f[s.id], max: e.target.value } })} aria-label=${s.name + ' nejvýše'} />`)}
      </div>
      ${err && html`<p class="bad">${err}</p>`}
      <div class="form-actions"><button class="btn btn-primary" disabled=${busy}>Uložit hlídání</button></div>
    </form>`}
  </section>`;
}

// ---------- helpers ----------
function niceStep(maxHours) {
  for (const s of [0.5, 1, 2, 3, 5, 10]) if (maxHours / s <= 6) return s;
  return 20;
}

// dark or light text on a subject colour, whichever reads better
function inkOn(hex) {
  const h = (hex || '#888').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.25 ? '#121316' : '#F8F6F1';
}
