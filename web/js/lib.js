import { html, render, useState, useEffect, useMemo, useRef, useCallback, useContext, createContext } from '../vendor/preact-htm.js';
export { html, render, useState, useEffect, useMemo, useRef, useCallback, useContext, createContext };

export const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

// ---------- API ----------
export async function api(method, url, body, opts = {}) {
  const init = { method, headers: {}, credentials: 'same-origin' };
  if (body instanceof Blob || body instanceof ArrayBuffer) {
    init.headers['Content-Type'] = 'application/octet-stream';
    init.headers['X-Raven'] = '1';
    init.body = body;
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  } else if (method !== 'GET') {
    init.headers['Content-Type'] = 'application/json';
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error('Server neodpovídá. Běží Raven na školním počítači?');
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Chyba ${res.status}`);
    err.status = res.status;
    err.data = data;
    if (res.status === 401 && !opts.quiet) window.dispatchEvent(new Event('raven:logout'));
    throw err;
  }
  return data;
}

// ---------- dates & times (always local, never UTC) ----------
export const pad = (n) => String(n).padStart(2, '0');
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
export const today = () => iso(new Date());
export const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
export const weekdayOf = (s) => ((parseISO(s).getDay() + 6) % 7) + 1; // 1 = Monday
export const mondayOf = (s) => addDays(s, 1 - weekdayOf(s));
export const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);
export function isoWeek(s) {
  const d = parseISO(s);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const w1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - w1) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}
export const DAYS = ['pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota', 'neděle'];
export const DAYS_SHORT = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];
export const MONTHS_GEN = ['ledna', 'února', 'března', 'dubna', 'května', 'června', 'července', 'srpna', 'září', 'října', 'listopadu', 'prosince'];
export const fmtDate = (s) => { if (!s) return ''; const d = parseISO(s); return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`; };
export const fmtDay = (s) => { const d = parseISO(s); return `${d.getDate()}. ${d.getMonth() + 1}.`; };
export const fmtDayW = (s) => `${DAYS_SHORT[weekdayOf(s) - 1]} ${fmtDay(s)}`;
export const fmtLong = (s) => { const d = parseISO(s); return `${DAYS[weekdayOf(s) - 1]} ${d.getDate()}. ${MONTHS_GEN[d.getMonth()]}`; };
export const hm = (m) => `${Math.floor(m / 60)}:${pad(m % 60)}`;
export const toMin = (str) => { if (!str) return null; const [h, m] = str.split(':').map(Number); return h * 60 + m; };
export const timeVal = (m) => (m == null ? '' : `${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
export function relDay(s) {
  const n = daysBetween(today(), s);
  if (n === 0) return 'dnes';
  if (n === 1) return 'zítra';
  if (n === -1) return 'včera';
  if (n > 1 && n < 5) return `za ${n} dny`;
  if (n >= 5) return `za ${n} dní`;
  if (n < -1 && n > -5) return `před ${-n} dny`;
  return `před ${-n} dny`;
}
export function schoolYearLabel(s = today()) {
  const d = parseISO(s);
  const y = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
  const half = d.getMonth() >= 8 || d.getMonth() === 0 ? 1 : 2;
  return `${half}. pololetí ${y}/${String((y + 1) % 100).padStart(2, '0')}`;
}

export function holidayOn(holidays, date) {
  return holidays.find((h) => h.date_from <= date && h.date_to >= date) || null;
}

// ---------- roles ----------
export const RANK = { teacher: 1, coordinator: 2, admin: 3 };
export const atLeast = (me, role) => RANK[me.role] >= RANK[role];
export const ROLE_LABEL = { teacher: 'Učitel', coordinator: 'Koordinátor', admin: 'Správce' };
export const ROLE_INFO = {
  teacher: 'Přidává, upravuje a maže jen své hodiny. Zapisuje konzultace a vede cíle své tutorské skupiny.',
  coordinator: 'Navíc upravuje a maže hodiny všech, spravuje žáky, skupiny, předměty a místnosti a vidí historii změn s možností obnovy.',
  admin: 'Navíc spravuje účty, délky hodin, časy dne, výjezdový den, volné dny a zálohy.',
};

// ---------- colours (risograph ink palette) ----------
export const INKS = [
  ['#FFE800', 'Žlutá'], ['#FFB511', 'Slunečnice'], ['#FF6C2F', 'Oranžová'], ['#F15060', 'Jasně červená'],
  ['#FF48B0', 'Fluo růžová'], ['#AA60BF', 'Orchidej'], ['#3255A4', 'Námořní'], ['#0078BF', 'Modrá'],
  ['#5EC8E5', 'Akvamarín'], ['#82D8D5', 'Máta'], ['#00A95C', 'Zelená'], ['#67B346', 'Travní'],
  ['#00838A', 'Petrolejová'], ['#A75154', 'Cihlová'], ['#E3ED55', 'Limetka'], ['#B8B2A3', 'Šedá'],
];
export function inkText(hex) {
  if (!hex || hex.length < 7) return '#16140F';
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.36 ? '#16140F' : '#FFFFFF';
}

// ---------- routing ----------
export function useHash() {
  const [h, setH] = useState(location.hash);
  useEffect(() => {
    const f = () => setH(location.hash);
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  const raw = h.replace(/^#\/?/, '');
  const [path, q = ''] = raw.split('?');
  return { path: path || 'prehled', params: Object.fromEntries(new URLSearchParams(q)) };
}
export function go(path, params) {
  const q = params ? new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString() : '';
  location.hash = '#/' + path + (q ? '?' + q : '');
}

export function store(key, fallback) {
  try { const v = localStorage.getItem('raven.' + key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}
export function persist(key, value) {
  try { localStorage.setItem('raven.' + key, JSON.stringify(value)); } catch { /* private mode */ }
}

export const studentName = (s) => (s ? `${s.first_name} ${s.last_name}` : '—');
export const studentNameRev = (s) => (s ? `${s.last_name} ${s.first_name}` : '—');
export const cmpCz = (a, b) => a.localeCompare(b, 'cs');

// ---------- UI primitives ----------
export function Modal({ title, onClose, children, footer, wide, kicker }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', onKey);
    const el = ref.current && ref.current.querySelector('input:not([type=hidden]):not([type=checkbox]):not([disabled]), select, textarea');
    if (el && !('ontouchstart' in window)) setTimeout(() => el.focus(), 30);
    return () => removeEventListener('keydown', onKey);
  }, []);
  return html`
    <div class="overlay" onMouseDown=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class=${'dialog' + (wide ? ' dialog-wide' : '')} role="dialog" aria-modal="true" ref=${ref}>
        <div class="dialog-head">
          <div>
            ${kicker && html`<div class="dialog-kicker">${kicker}</div>`}
            <h2>${title}</h2>
          </div>
          <button class="dialog-x" onClick=${onClose} aria-label="Zavřít">×</button>
        </div>
        <div class="dialog-body">${children}</div>
        ${footer && html`<div class="dialog-foot">${footer}</div>`}
      </div>
    </div>`;
}

export function Field({ label, hint, children, wide, half }) {
  return html`<label class=${'field' + (wide ? ' field-wide' : '') + (half ? ' field-half' : '')}>
    <span class="field-label">${label}</span>
    ${children}
    ${hint && html`<span class="field-hint">${hint}</span>`}
  </label>`;
}

export function ErrorLine({ error }) {
  return error ? html`<div class="error-line" role="alert">${error}</div>` : null;
}

export function Empty({ children }) {
  return html`<div class="empty">${children}</div>`;
}

export function Swatch({ color, size }) {
  return html`<span class="swatch" style=${`background:${color};${size ? `width:${size}px;height:${size}px` : ''}`}></span>`;
}

export function InkPicker({ value, onChange }) {
  return html`<div class="ink-picker">
    ${INKS.map(([c, n]) => html`<button type="button" title=${n} class=${'ink-chip' + (value === c ? ' on' : '')} style=${`background:${c}`} onClick=${() => onChange(c)}></button>`)}
  </div>`;
}

export function ChipToggle({ items, value, onChange, render: renderItem }) {
  const set = new Set(value);
  return html`<div class="chips">
    ${items.map((it) => html`<button type="button" class=${'chip' + (set.has(it.id) ? ' on' : '')}
      onClick=${() => { const s = new Set(value); s.has(it.id) ? s.delete(it.id) : s.add(it.id); onChange([...s]); }}>
      ${renderItem ? renderItem(it) : it.name}</button>`)}
  </div>`;
}

export function PageHead({ title, sub, children }) {
  return html`<div class="page-head">
    <div class="page-title-wrap">
      <h1 class="page-title">${title}</h1>
      ${sub && html`<div class="page-sub">${sub}</div>`}
    </div>
    <div class="page-actions">${children}</div>
  </div>`;
}

export function Section({ title, aside, children, cls }) {
  return html`<section class=${'section ' + (cls || '')}>
    <div class="section-head"><h2>${title}</h2>${aside && html`<div class="section-aside">${aside}</div>`}</div>
    ${children}
  </section>`;
}

export function useAsync(fn, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const reload = useCallback(async () => {
    try {
      const data = await fn();
      setState({ loading: false, data, error: null });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e.message }));
    }
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return [state, reload];
}

export const plural = (n, one, few, many) => `${n} ${n === 1 ? one : n >= 2 && n <= 4 ? few : many}`;

// Locale-independent 24h time field: accepts 8:20, 8.20, 820, 8 — arrow keys step by 5 min.
export function parseTime(t) {
  const s = String(t || '').trim().replace(/[.,h]/g, ':');
  if (!s) return null;
  let h, m;
  if (s.includes(':')) { [h, m] = s.split(':').map((x) => parseInt(x || '0', 10)); }
  else if (/^\d{1,2}$/.test(s)) { h = parseInt(s, 10); m = 0; }
  else if (/^\d{3,4}$/.test(s)) { h = parseInt(s.slice(0, -2), 10); m = parseInt(s.slice(-2), 10); }
  else return null;
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}
export function TimeInput({ value, onChange, required, step = 5 }) {
  const fmt = (v) => (v == null ? '' : hm(v));
  const [txt, setTxt] = useState(fmt(value));
  useEffect(() => { setTxt(fmt(value)); }, [value]);
  const commit = () => {
    const m = parseTime(txt);
    if (m == null) { if (!txt.trim() && !required) onChange(null); else setTxt(fmt(value)); return; }
    onChange(m); setTxt(fmt(m));
  };
  const onKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const base = parseTime(txt) ?? value ?? 480;
      const m = Math.max(0, Math.min(23 * 60 + 55, base + (e.key === 'ArrowUp' ? step : -step)));
      onChange(m); setTxt(fmt(m));
    }
  };
  return html`<input class="time-input" inputmode="numeric" autocomplete="off" placeholder="h:mm" required=${required}
    value=${txt} onInput=${(e) => setTxt(e.target.value)} onBlur=${commit} onKeyDown=${onKey} />`;
}
