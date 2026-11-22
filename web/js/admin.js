import {
  html, useState, useEffect, useApp, api, go, Modal, Field, ErrorLine, PageHead, Empty, Swatch, InkPicker, useAsync,
  today, parseISO, iso, addDays, fmtDate, hm, toMin, timeVal, daysBetween, atLeast, ROLE_LABEL, ROLE_INFO, DAYS, cmpCz, plural, TimeInput,
} from './lib.js';
import { TemplatesTab } from './templates.js';

const TABS = [
  ['ucty', 'Uživatelé', 'admin'],
  ['nastaveni', 'Nastavení školy', 'admin'],
  ['volno', 'Volné dny', 'admin'],
  ['bloky', 'Bloky hodin', 'coordinator'],
  ['predmety', 'Předměty a místnosti', 'coordinator'],
  ['sablony', 'Šablony rozvrhu', 'admin'],
  ['historie', 'Historie změn', 'coordinator'],
  ['zaloha', 'Zálohy', 'admin'],
];

export function AdminPage({ params }) {
  const { me } = useApp();
  const tabs = TABS.filter(([, , r]) => atLeast(me, r));
  const tab = tabs.find(([k]) => k === params.tab) ? params.tab : tabs[0][0];
  let body;
  switch (tab) {
    case 'ucty': body = html`<${UsersTab} />`; break;
    case 'nastaveni': body = html`<${SettingsTab} />`; break;
    case 'volno': body = html`<${HolidaysTab} />`; break;
    case 'bloky': body = html`<${BlocksTab} />`; break;
    case 'predmety': body = html`<${SubjectsTab} />`; break;
    case 'sablony': body = html`<${TemplatesTab} />`; break;
    case 'historie': body = html`<${HistoryTab} />`; break;
    case 'zaloha': body = html`<${BackupTab} />`; break;
  }
  return html`<div class="page">
    <${PageHead} title="Správa" sub=${ROLE_LABEL[me.role]} />
    <div class="tabs">${tabs.map(([k, label]) => html`<a href=${'#/sprava?tab=' + k} class=${'tab' + (k === tab ? ' on' : '')}>${label}</a>`)}</div>
    ${body}
  </div>`;
}

// ---------- lunch break (coordinators and admins) ----------
function LunchForm() {
  const app = useApp();
  const [f, setF] = useState({ lunch_start: app.settings.lunch_start, lunch_end: app.settings.lunch_end });
  const [err, setErr] = useState('');
  const save = async (e) => {
    e.preventDefault(); setErr('');
    if (f.lunch_end < f.lunch_start) { setErr('Konec oběda musí být po jeho začátku.'); return; }
    try { await api('PUT', '/api/settings/lunch', f); app.toast('Čas oběda uložen.'); app.reloadBoot(); } catch (x) { setErr(x.message); }
  };
  return html`<section class="section">
    <div class="section-head"><h2>Oběd</h2></div>
    <p class="muted">Pruh „Oběd“ v rozvrhu. Stejný začátek i konec = oběd se v rozvrhu nezobrazí.</p>
    <form class="lunch-form" onSubmit=${save}>
      <${Field} label="Oběd od"><${TimeInput} value=${f.lunch_start} onChange=${(v) => v != null && setF({ ...f, lunch_start: v })} /><//>
      <${Field} label="Oběd do"><${TimeInput} value=${f.lunch_end} onChange=${(v) => v != null && setF({ ...f, lunch_end: v })} /><//>
      <button class="btn btn-primary">Uložit oběd</button>
    </form>
    <${ErrorLine} error=${err} />
  </section>`;
}

// ---------- time blocks: ready-made class times to pick from when planning ----------
function BlocksTab() {
  const app = useApp();
  const { settings } = app;
  // editor state: one list of blocks per weekday (1 = Monday … 5 = Friday)
  const fromSettings = () => {
    const by = { 1: [], 2: [], 3: [], 4: [], 5: [] };
    for (const b of settings.blocks) for (const d of (b.days && b.days.length ? b.days : [1, 2, 3, 4, 5])) by[d].push({ name: b.name, start: b.start, end: b.end });
    for (const d of [1, 2, 3, 4, 5]) by[d].sort((x, y) => x.start - y.start);
    return by;
  };
  const [byDay, setByDay] = useState(fromSettings);
  const [day, setDay] = useState(1);
  const [hover, setHover] = useState(null);
  const [copyTo, setCopyTo] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const rows = byDay[day];
  const change = (d, list) => { setByDay({ ...byDay, [d]: list }); setDirty(true); };
  const set = (i, k, v) => change(day, rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const add = () => {
    const last = [...rows].sort((x, y) => x.end - y.end)[rows.length - 1];
    const start = last ? last.end + 10 : settings.day_start;
    change(day, [...rows, { name: '', start, end: Math.min(start + 45, 24 * 60 - 5) }]);
  };
  const copy = () => {
    if (!copyTo.length) return;
    const next = { ...byDay };
    for (const d of copyTo) next[d] = rows.map((r) => ({ ...r }));
    setByDay(next); setDirty(true); setCopyTo([]);
    app.toast(`Bloky z ${DAYS[day - 1]}ka zkopírovány na ${copyTo.map((d) => DAYS[d - 1]).join(', ')}. Nezapomeňte uložit.`);
  };
  const save = async () => {
    setErr('');
    for (const d of [1, 2, 3, 4, 5]) for (const [i, r] of byDay[d].entries()) if (!(r.end > r.start)) { setDay(d); setErr(`${DAYS[d - 1]}, blok č. ${i + 1}: konec musí být po začátku.`); return; }
    const body = [];
    for (const d of [1, 2, 3, 4, 5]) for (const r of byDay[d]) body.push({ name: r.name, start: Number(r.start), end: Number(r.end), days: [d] });
    setBusy(true);
    try { await api('PUT', '/api/settings/blocks', body); app.toast('Bloky hodin uloženy.'); setDirty(false); app.reloadBoot(); } catch (x) { setErr(x.message); }
    setBusy(false);
  };
  // overlapping blocks within a day are flagged (allowed, but usually a typo)
  const overlaps = (list) => list.map((r, i) => list.some((o, j) => j !== i && o.start < r.end && o.end > r.start));
  const ov = overlaps(rows);
  return html`<${LunchForm} />
  <section class="section blocks">
    <div class="section-head"><h2>Bloky hodin</h2>
      <div class="section-aside">${dirty && html`<span class="unsaved">neuložené změny</span>`}<button class="btn btn-primary" disabled=${busy || !dirty} onClick=${save}>Uložit bloky</button></div></div>
    <p class="muted">Pevné časy hodin, ze kterých si vyučující při plánování jen vyberou. Každý den může mít jiný počet bloků i jiné časy. Blok platí i tehdy, když jeho délka není mezi povolenými délkami. Upravovat je může koordinátor a správce.</p>

    <${BlockTimeline} byDay=${byDay} day=${day} hover=${hover} onDay=${setDay} />

    <div class="seg block-days" role="tablist">
      ${[1, 2, 3, 4, 5].map((d) => html`<button type="button" role="tab" aria-selected=${d === day} class=${'seg-b' + (d === day ? ' on' : '')} onClick=${() => setDay(d)}>
        ${DAYS[d - 1]} <span class="bd-count">${byDay[d].length}</span></button>`)}
    </div>

    ${rows.length === 0 ? html`<${Empty}>${DAYS[day - 1][0].toUpperCase() + DAYS[day - 1].slice(1)} zatím nemá žádné bloky.<//>` : html`
    <div class="blocks-grid">
      <span class="field-label">Název <em>nepovinné</em></span><span class="field-label">Začátek</span><span class="field-label">Konec</span><span class="field-label">Délka</span><span></span>
      ${rows.map((r, i) => html`
        <input value=${r.name} maxlength="40" placeholder=${(i + 1) + '. blok'} onInput=${(e) => set(i, 'name', e.target.value)} onFocus=${() => setHover(i)} onBlur=${() => setHover(null)} aria-label=${'Název bloku ' + (i + 1)} />
        <span onMouseEnter=${() => setHover(i)} onMouseLeave=${() => setHover(null)}><${TimeInput} value=${r.start} onChange=${(v) => v != null && set(i, 'start', v)} /></span>
        <span onMouseEnter=${() => setHover(i)} onMouseLeave=${() => setHover(null)}><${TimeInput} value=${r.end} onChange=${(v) => v != null && set(i, 'end', v)} /></span>
        <span class=${'mono small' + (r.end > r.start && !ov[i] ? '' : ' bad')}>${r.end > r.start ? (r.end - r.start) + ' min' : '—'}${ov[i] ? ' · překryv' : ''}</span>
        <button type="button" class="btn btn-sq" title="Odebrat blok" onClick=${() => change(day, rows.filter((_, j) => j !== i))}>×</button>`)}
    </div>`}
    <${ErrorLine} error=${err} />
    <div class="block-actions">
      <button type="button" class="btn" onClick=${add}>+ Přidat blok</button>
      ${rows.length > 0 && html`<div class="block-copy">
        <span>Zkopírovat ${DAYS[day - 1]} na:</span>
        ${[1, 2, 3, 4, 5].filter((d) => d !== day).map((d) => html`<label class="check"><input type="checkbox" checked=${copyTo.includes(d)} onChange=${(e) => setCopyTo(e.target.checked ? [...copyTo, d] : copyTo.filter((x) => x !== d))} /> ${DAYS[d - 1]}</label>`)}
        <button type="button" class="btn" disabled=${!copyTo.length} onClick=${copy}>Zkopírovat</button>
      </div>`}
    </div>
  </section>`;
}

// The week at a glance: every day's blocks on one time axis, with morning circles and lunch.
function BlockTimeline({ byDay, day, hover, onDay }) {
  const { settings } = useApp();
  const all = [1, 2, 3, 4, 5].flatMap((d) => byDay[d]);
  const lo = Math.floor(Math.min(settings.circle_start || settings.day_start, settings.day_start, ...all.map((r) => r.start)) / 60) * 60;
  const hi = Math.ceil(Math.max(settings.day_end, settings.lunch_end || 0, ...all.map((r) => r.end)) / 60) * 60;
  const pct = (m) => ((Math.min(Math.max(m, lo), hi) - lo) / (hi - lo)) * 100;
  const hours = [];
  for (let m = lo; m <= hi; m += 60) hours.push(m);
  const band = (from, to, cls, label) => to > from && html`<div class=${'bt-band ' + cls} style=${`left:${pct(from)}%;width:${pct(to) - pct(from)}%`}><span>${label}</span></div>`;
  return html`<div class="bt" aria-label="Bloky v týdnu">
    <div class="bt-axis"><span></span><div class="bt-ticks">${hours.map((m) => html`<span style=${`left:${pct(m)}%`}>${hm(m)}</span>`)}</div></div>
    ${[1, 2, 3, 4, 5].map((d) => {
      const list = byDay[d];
      const ov = list.map((r, i) => list.some((o, j) => j !== i && o.start < r.end && o.end > r.start));
      return html`<div class=${'bt-row' + (d === day ? ' on' : '')} onClick=${() => onDay(d)} title=${'Upravit ' + DAYS[d - 1]}>
        <span class="bt-day">${DAYS[d - 1]}</span>
        <div class="bt-track">
          ${hours.map((m) => html`<i class="bt-line" style=${`left:${pct(m)}%`}></i>`)}
          ${band(settings.circle_start, settings.circle_end, 'bt-circle', 'kruhy')}
          ${band(settings.lunch_start, settings.lunch_end, 'bt-lunch', 'oběd')}
          ${list.map((r, i) => html`<div class=${'bt-block' + (ov[i] ? ' is-over' : '') + (d === day && hover === i ? ' is-hover' : '')} style=${`left:${pct(r.start)}%;width:${Math.max(pct(r.end) - pct(r.start), 0.6)}%`}>
            <b>${r.name || (i + 1) + '.'}</b><span>${hm(r.start)}–${hm(r.end)}</span>
          </div>`)}
        </div>
      </div>`;
    })}
  </div>`;
}

// ---------- users ----------
function UsersTab() {
  const app = useApp();
  const [state, reload] = useAsync(() => api('GET', '/api/users'), []);
  const [dlg, setDlg] = useState(null);
  const users = state.data || [];
  return html`<section class="section">
    <div class="section-head"><h2>Účty <span class="count">${users.length}</span></h2>
      <div class="section-aside"><button class="btn btn-primary" onClick=${() => setDlg({ u: null })}>+ Nový účet</button></div></div>
    <div class="role-legend">
      ${['student', 'teacher', 'coordinator', 'admin'].map((r) => html`<div><span class=${'role role-' + r}>${ROLE_LABEL[r]}</span><p>${ROLE_INFO[r]}</p></div>`)}
    </div>
    <div class="table-wrap"><table class="ledger ledger-click">
      <thead><tr><th>Jméno</th><th>Zkratka</th><th>Přihlášení</th><th>Role</th><th>Stav</th></tr></thead>
      <tbody>${users.map((u) => html`<tr class=${u.active ? '' : 'inactive'} onClick=${() => setDlg({ u })}>
        <td><b>${u.name}</b></td><td class="mono">${u.short}</td><td class="mono small">${u.email || u.username}${!u.has_password && u.email ? html` <span class="muted">(Google)</span>` : ''}</td>
        <td><span class=${'role role-' + u.role}>${ROLE_LABEL[u.role]}</span></td>
        <td>${u.active ? 'aktivní' : html`<span class="muted">deaktivován</span>`}</td>
      </tr>`)}</tbody>
    </table></div>
    ${dlg && html`<${UserDialog} u=${dlg.u} onClose=${() => setDlg(null)} onSaved=${() => { setDlg(null); reload(); app.reloadBoot(); }} />`}
  </section>`;
}

function UserDialog({ u, onClose, onSaved }) {
  const app = useApp();
  const [f, setF] = useState(() => u ? { ...u, password: '' } : { name: '', short: '', username: '', email: '', role: 'teacher', active: true, password: '' });
  const [err, setErr] = useState('');
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const st = app.settings;
  const dom = (f.email || '').toLowerCase().split('@')[1] || '';
  const inList = (list) => (list || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean).includes(dom);
  const nameLocked = st.names_from_email && /^[^@]+\.[^@]+@/.test(f.email || '') && (inList(st.teacher_domains) || inList(st.student_domains));
  const save = async (e) => {
    e.preventDefault();
    try {
      if (u) await api('PUT', `/api/users/${u.id}`, f); else await api('POST', '/api/users', f);
      app.toast(f.password && u ? 'Uloženo, heslo bylo změněno.' : 'Uloženo.');
      onSaved();
    } catch (x) { setErr(x.message); }
  };
  return html`<${Modal} title=${u ? 'Upravit účet' : 'Nový účet'} onClose=${onClose}>
    <form class="form-grid" onSubmit=${save}>
      <${Field} label="Jméno a příjmení" hint=${nameLocked ? 'vezme se ze školního e-mailu (jmeno.prijmeni@…); zde lze jen doplnit diakritiku' : ''} wide><input required=${!nameLocked} value=${f.name} onInput=${(e) => set('name', e.target.value)} placeholder=${nameLocked ? 'doplní se z e-mailu' : ''} /><//>
      <${Field} label="Zkratka" hint="do rozvrhu, např. NOV" half><input maxlength="5" value=${f.short} onInput=${(e) => set('short', e.target.value)} /><//>
      <${Field} label="E-mail" hint="pro přihlášení přes Google" half><input type="email" value=${f.email || ''} onInput=${(e) => set('email', e.target.value)} /><//>
      <${Field} label="Přihlašovací jméno" hint="pro přihlášení heslem; prázdné = e-mail" wide><input value=${f.username} onInput=${(e) => set('username', e.target.value)} /><//>
      <div class="field field-wide">
        <span class="field-label">Role</span>
        ${['student', 'teacher', 'coordinator', 'admin'].map((r) => html`<label class="radio radio-block"><input type="radio" checked=${f.role === r} onChange=${() => set('role', r)} />
          <span><b>${ROLE_LABEL[r]}</b><br /><span class="muted small">${ROLE_INFO[r]}</span></span></label>`)}
      </div>
      <${Field} label=${u ? 'Nové heslo' : 'Úvodní heslo'} hint=${u ? 'vyplňte jen při obnově hesla (min. 6 znaků)' : 'nepovinné, pokud se bude přihlašovat přes Google'} wide>
        <input type="text" autocomplete="off" value=${f.password} onInput=${(e) => set('password', e.target.value)} />
      <//>
      ${u && html`<label class="check field-wide"><input type="checkbox" checked=${f.active} onChange=${(e) => set('active', e.target.checked)} /> Účet je aktivní (deaktivovaný se nepřihlásí, jeho záznamy zůstanou)</label>`}
      <${ErrorLine} error=${err} />
      <div class="form-actions"><button type="button" class="btn" onClick=${onClose}>Zrušit</button><button class="btn btn-primary">Uložit</button></div>
    </form>
  <//>`;
}

// ---------- settings ----------
function AIForm({ f, set }) {
  const app = useApp();
  const [st, setSt] = useState(null);
  const [key, setKey] = useState('');
  const [instr, setInstr] = useState(null);
  useEffect(() => { api('GET', '/api/settings/ai').then((s) => { setSt(s); setInstr(s.instructions); }).catch(() => {}); }, []);
  const save = async (body, msg) => {
    try { const s = await api('PUT', '/api/settings/ai', body); setSt(s); setInstr(s.instructions); setKey(''); app.toast(msg); } catch (x) { app.toast(x.message, 'err'); }
  };
  return html`<section class="section">
    <div class="section-head"><h2>Osobní asistent</h2><div class="section-aside">Žáci: Claude Haiku 5.5 · učitelé: Claude Sonnet 5.5 (střední úsilí)</div></div>
    ${st && html`<p class="ai-status">${st.configured
      ? (st.readable ? html`API klíč: <b>nastaven</b> <span class="mono">(…${st.hint})</span>` : html`<span class="bad">API klíč nelze načíst – vložte ho prosím znovu.</span>`)
      : html`<span class="muted">API klíč zatím není nastaven – asistent je vypnutý.</span>`}
      ${st.usage_30d && st.usage_30d.answers > 0 && html` · za 30 dní ${st.usage_30d.answers} odpovědí`}</p>`}
    <div class="gate-form">
      <span class="field-label">API klíč Anthropic</span>
      <div class="inline-add">
        <input type="password" autocomplete="off" placeholder="sk-ant-…" value=${key} onInput=${(e) => setKey(e.target.value)} />
        <button type="button" class="btn" disabled=${key.trim().length < 20} onClick=${() => save({ api_key: key }, 'API klíč uložen.')}>Uložit klíč</button>
        ${st && st.configured && html`<button type="button" class="btn btn-ghost" onClick=${() => save({ api_key: '' }, 'API klíč odebrán.')}>Odebrat</button>`}
      </div>
      <span class="field-hint">Klíč se uloží zašifrovaně (AES-256) a už nikdy se nezobrazí. Zašifrovat, ne zahashovat: Raven ho musí posílat službě Claude.</span>
    </div>
    <div class="form-grid" style="margin-top:14px">
      <label class="check"><input type="checkbox" checked=${f.ai_students} onChange=${(e) => set('ai_students', e.target.checked)} /> Zapnuto pro žáky</label>
      <label class="check"><input type="checkbox" checked=${f.ai_teachers} onChange=${(e) => set('ai_teachers', e.target.checked)} /> Zapnuto pro učitele</label>
    </div>
    <p class="field-hint">Zapnutí pro žáky a učitele se uloží tlačítkem „Uložit nastavení“ dole.</p>
    ${instr !== null && html`<div class="field" style="margin-top:12px">
      <span class="field-label">Doplňující pokyny pro asistenta <em>nepovinné, vidí je jen správce</em></span>
      <textarea rows="3" maxlength="3000" value=${instr} onInput=${(e) => setInstr(e.target.value)} placeholder="např. Při otázkách na obědy odkaž na jídelnu. Žákům tykej."></textarea>
      <span class="field-hint">Mohou upravit tón nebo zdůraznit témata. Základní pravidla (jen otázky k Ravenu, ochrana před „ignoruj pokyny“, přístup jen k povoleným údajům) jsou pevně v serveru a pokyny je nepřepíšou.</span>
      <div><button type="button" class="btn" onClick=${() => save({ instructions: instr }, 'Pokyny uloženy.')}>Uložit pokyny</button></div>
    </div>`}
  </section>`;
}

function GateForm() {
  const app = useApp();
  const [pw, setPw] = useState('');
  const save = async (value) => {
    try {
      const r = await api('PUT', '/api/settings/gate', { password: value });
      setPw('');
      app.toast(r.enabled ? 'Doplňkové heslo uloženo.' : 'Přihlášení mimo školní domény je vypnuté.');
    } catch (x) { app.toast(x.message, 'err'); }
  };
  return html`<div class="gate-form">
    <span class="field-label">Doplňkové heslo pro adresy mimo školu</span>
    <div class="inline-add">
      <input type="text" autocomplete="off" placeholder="nové heslo (min. 8 znaků)" value=${pw} onInput=${(e) => setPw(e.target.value)} />
      <button type="button" class="btn" disabled=${pw.length < 8} onClick=${() => save(pw)}>Nastavit</button>
      <button type="button" class="btn btn-ghost" onClick=${() => save('')}>Vypnout</button>
    </div>
    <span class="field-hint">Uloží se jen zašifrovaně (hash), současné heslo proto nelze zobrazit.</span>
  </div>`;
}
function SettingsTab() {
  const app = useApp();
  const [f, setF] = useState(() => ({ ...app.settings, grades_text: app.settings.grades.join(', ') }));
  const [newLen, setNewLen] = useState('');
  const [err, setErr] = useState('');
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const addLen = () => {
    const n = parseInt(newLen, 10);
    if (n >= 5 && n <= 600 && !f.lesson_lengths.includes(n)) set('lesson_lengths', [...f.lesson_lengths, n].sort((a, b) => a - b));
    setNewLen('');
  };
  const save = async (e) => {
    e.preventDefault();
    setErr('');
    const grades = f.grades_text.split(/[,;\s]+/).map((x) => parseInt(x, 10)).filter((x) => x > 0 && x < 14);
    const body = { ...f, grades, trip_weekday: Number(f.trip_weekday) };
    delete body.grades_text;
    try { await api('PUT', '/api/settings', body); app.toast('Nastavení uloženo.'); app.reloadBoot(); } catch (x) { setErr(x.message); }
  };
  const T = (k) => html`<${TimeInput} value=${f[k]} onChange=${(v) => v != null && set(k, v)} />`;
  return html`<form class="settings" onSubmit=${save}>
    <section class="section">
      <div class="section-head"><h2>Škola</h2></div>
      <div class="form-grid">
        <${Field} label="Název školy" half><input value=${f.school_name} onInput=${(e) => set('school_name', e.target.value)} /><//>
        <${Field} label="Ročníky" hint="čísla oddělená čárkou" half><input value=${f.grades_text} onInput=${(e) => set('grades_text', e.target.value)} /><//>
      </div>
    </section>
    <section class="section">
      <div class="section-head"><h2>Přihlašování</h2><div class="section-aside">Role se přiděluje podle domény e-mailu. Ostatní adresy musí zadat doplňkové heslo a získají roli správce.</div></div>
      <div class="form-grid">
        <${Field} label="Google Client ID" hint="z Google Cloud Console (končí .apps.googleusercontent.com); prázdné = jen přihlášení heslem" wide><input class="mono" value=${f.google_client_id || ''} onInput=${(e) => set('google_client_id', e.target.value)} /><//>
        <${Field} label="Domény učitelů" hint="oddělené čárkou" half><input value=${f.teacher_domains || ''} onInput=${(e) => set('teacher_domains', e.target.value)} placeholder="zsarcha.cz" /><//>
        <${Field} label="Domény žáků" hint="oddělené čárkou" half><input value=${f.student_domains || ''} onInput=${(e) => set('student_domains', e.target.value)} placeholder="montetrida.cz" /><//>
        <div class="field field-wide">
          <label class="check"><input type="checkbox" checked=${f.names_from_email} onChange=${(e) => set('names_from_email', e.target.checked)} /> <b>Jména podle školního e-mailu</b></label>
          <span class="field-hint">U adres ze školních domén (jmeno.prijmeni@…) Raven vezme jméno a zkratku z adresy – ne z Google profilu, takže se nikdo nemůže vydávat za jiného. Diakritiku převezme z Google profilu nebo záznamu žáka jen tehdy, když písmena přesně odpovídají adrese. Po uložení se opraví i stávající účty.</span>
        </div>
      </div>
      <${GateForm} />
    </section>
    <${AIForm} f=${f} set=${set} />
    <section class="section">
      <div class="section-head"><h2>Délky hodin</h2><div class="section-aside">Učitelé a koordinátoři mohou zakládat jen hodiny těchto délek.</div></div>
      <div class="len-chips">
        ${f.lesson_lengths.map((l) => html`<span class="len-chip"><b>${l}</b> min <button type="button" title="Odebrat" onClick=${() => set('lesson_lengths', f.lesson_lengths.filter((x) => x !== l))}>×</button></span>`)}
        <span class="len-add"><input type="number" min="5" max="600" placeholder="min" value=${newLen} onInput=${(e) => setNewLen(e.target.value)}
          onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); addLen(); } }} /><button type="button" class="btn" onClick=${addLen}>Přidat</button></span>
      </div>
    </section>
    <section class="section">
      <div class="section-head"><h2>Školní den</h2></div>
      <div class="form-grid form-grid-4">
        <${Field} label="Ranní kruhy od">${T('circle_start')}<//>
        <${Field} label="Ranní kruhy do">${T('circle_end')}<//>
        <${Field} label="Začátek výuky">${T('day_start')}<//>
        <${Field} label="Konec dne">${T('day_end')}<//>
        <${Field} label="Oběd od">${T('lunch_start')}<//>
        <${Field} label="Oběd do">${T('lunch_end')}<//>
        <${Field} label="Krok v rozvrhu" hint="zaokrouhlení času">
          <select value=${f.slot_step} onChange=${(e) => set('slot_step', Number(e.target.value))}>${[5, 10, 15].map((s) => html`<option value=${s}>${s} min</option>`)}</select>
        <//>
        <${Field} label="Výjezdový den">
          <select value=${f.trip_weekday} onChange=${(e) => set('trip_weekday', e.target.value)}>
            <option value="0">žádný</option>${DAYS.slice(0, 5).map((d, i) => html`<option value=${i + 1}>${d}</option>`)}
          </select>
        <//>
      </div>
    </section>
    <${ErrorLine} error=${err} />
    <div class="form-actions"><button class="btn btn-primary">Uložit nastavení</button></div>
  </form>`;
}

// ---------- holidays ----------
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(new Date(y, month - 1, day));
}
function stateHolidays(startYear) {
  const y = startYear, n = startYear + 1, e = easter(n);
  return [
    [`${y}-09-28`, `${y}-09-28`, 'Den české státnosti'],
    [`${y}-10-28`, `${y}-10-28`, 'Den vzniku samostatného československého státu'],
    [`${y}-11-17`, `${y}-11-17`, 'Den boje za svobodu a demokracii'],
    [`${y}-12-24`, `${y}-12-26`, 'Vánoční svátky'],
    [`${n}-01-01`, `${n}-01-01`, 'Nový rok, Den obnovy samostatného českého státu'],
    [addDays(e, -2), addDays(e, -2), 'Velký pátek'],
    [addDays(e, 1), addDays(e, 1), 'Velikonoční pondělí'],
    [`${n}-05-01`, `${n}-05-01`, 'Svátek práce'],
    [`${n}-05-08`, `${n}-05-08`, 'Den vítězství'],
  ];
}

function HolidaysTab() {
  const app = useApp();
  const { boot } = app;
  const [f, setF] = useState({ name: '', date_from: today(), date_to: today() });
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(null);
  const d = parseISO(today());
  const sy = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
  const add = async (e) => {
    e.preventDefault();
    try {
      const r = await api('POST', '/api/holidays', f);
      setF({ name: '', date_from: f.date_from, date_to: f.date_from }); app.reloadBoot(); setErr('');
      await offerClear(app, r, f.name);
    } catch (x) { setErr(x.message); }
  };
  const del = async (h) => {
    if (!await app.confirm({ title: `Smazat „${h.name}“?`, confirm: 'Smazat', danger: true })) return;
    try { await api('DELETE', `/api/holidays/${h.id}`); app.reloadBoot(); } catch (x) { app.toast(x.message, 'err'); }
  };
  const addState = async () => {
    const list = stateHolidays(sy).filter(([from]) => !boot.holidays.some((h) => h.date_from <= from && h.date_to >= from));
    if (!list.length) { app.toast('Státní svátky už jsou doplněné.'); return; }
    for (const [from, to, name] of list) await api('POST', '/api/holidays', { date_from: from, date_to: to, name });
    app.toast(`Doplněno: ${list.length}.`);
    app.reloadBoot();
  };
  const t = today();
  const upcoming = boot.holidays.filter((h) => h.date_to >= t);
  const past = boot.holidays.filter((h) => h.date_to < t);
  const row = (h) => html`<tr>
    <td><b>${h.name}</b></td>
    <td class="mono nowrap">${fmtDate(h.date_from)}${h.date_to !== h.date_from ? ' – ' + fmtDate(h.date_to) : ''}</td>
    <td class="mono">${daysBetween(h.date_from, h.date_to) + 1}</td>
    <td class="right nowrap"><button class="btn btn-ghost btn-s" onClick=${() => setEdit(h)}>Upravit</button><button class="btn btn-ghost btn-s" onClick=${() => del(h)}>Smazat</button></td>
  </tr>`;
  return html`<div>
    <section class="section">
      <div class="section-head"><h2>Přidat volno</h2><div class="section-aside">prázdniny, svátky, ředitelské volno – v tyto dny nelze plánovat</div></div>
      <form class="form-grid form-grid-4" onSubmit=${add}>
        <${Field} label="Název"><input required value=${f.name} onInput=${(e) => setF({ ...f, name: e.target.value })} placeholder="např. Jarní prázdniny" /><//>
        <${Field} label="Od"><input type="date" required value=${f.date_from} onChange=${(e) => setF({ ...f, date_from: e.target.value, date_to: f.date_to < e.target.value ? e.target.value : f.date_to })} /><//>
        <${Field} label="Do"><input type="date" required value=${f.date_to} min=${f.date_from} onChange=${(e) => setF({ ...f, date_to: e.target.value })} /><//>
        <div class="field field-end"><button class="btn btn-primary">Přidat</button></div>
      </form>
      <${ErrorLine} error=${err} />
      <p><button class="btn" onClick=${addState}>Doplnit státní svátky pro školní rok ${sy}/${String((sy + 1) % 100).padStart(2, '0')}</button></p>
    </section>
    <section class="section">
      <div class="section-head"><h2>Nadcházející <span class="count">${upcoming.length}</span></h2></div>
      ${upcoming.length ? html`<div class="table-wrap"><table class="ledger"><thead><tr><th>Název</th><th>Termín</th><th>Dní</th><th></th></tr></thead><tbody>${upcoming.map(row)}</tbody></table></div>` : html`<${Empty}>Žádné volno v plánu.<//>`}
    </section>
    ${past.length > 0 && html`<section class="section"><div class="section-head"><h2>Proběhlé</h2></div>
      <div class="table-wrap"><table class="ledger muted-table"><tbody>${past.slice().reverse().map(row)}</tbody></table></div></section>`}
    ${edit && html`<${HolidayDialog} h=${edit} onClose=${() => setEdit(null)} onSaved=${() => { setEdit(null); app.reloadBoot(); }} />`}
  </div>`;
}

// After a day off is saved: offer to cancel the classes already planned on those days.
async function offerClear(app, r, name) {
  if (!r || !r.classes) return;
  const ok = await app.confirm({
    title: `Zrušit ${plural(r.classes, 'naplánovanou hodinu', 'naplánované hodiny', 'naplánovaných hodin')}?`,
    text: `Na ${fmtDate(r.date_from)}${r.date_to !== r.date_from ? ' – ' + fmtDate(r.date_to) : ''} (${name}) už jsou v rozvrhu hodiny. Mají se zrušit? Kdyby bylo potřeba, obnovíte je v Historii změn.`,
    confirm: 'Zrušit hodiny', cancel: 'Ponechat', danger: true,
  });
  if (!ok) return;
  try {
    const c = await api('POST', '/api/events/clear-range', { from: r.date_from, to: r.date_to, reason: name });
    app.toast(`Zrušeno: ${plural(c.removed, 'hodina', 'hodiny', 'hodin')}.`);
  } catch (x) { app.toast(x.message, 'err'); }
}

function HolidayDialog({ h, onClose, onSaved }) {
  const app = useApp();
  const [f, setF] = useState({ ...h });
  const [err, setErr] = useState('');
  const save = async (e) => {
    e.preventDefault();
    try { const r = await api('PUT', `/api/holidays/${h.id}`, f); onSaved(); await offerClear(app, r, f.name); } catch (x) { setErr(x.message); }
  };
  return html`<${Modal} title="Upravit volno" onClose=${onClose}>
    <form class="form-grid" onSubmit=${save}>
      <${Field} label="Název" wide><input required value=${f.name} onInput=${(e) => setF({ ...f, name: e.target.value })} /><//>
      <${Field} label="Od" half><input type="date" value=${f.date_from} onChange=${(e) => setF({ ...f, date_from: e.target.value })} /><//>
      <${Field} label="Do" half><input type="date" value=${f.date_to} onChange=${(e) => setF({ ...f, date_to: e.target.value })} /><//>
      <${ErrorLine} error=${err} />
      <div class="form-actions"><button type="button" class="btn" onClick=${onClose}>Zrušit</button><button class="btn btn-primary">Uložit</button></div>
    </form>
  <//>`;
}

// ---------- subjects & rooms ----------
function SubjectsTab() {
  const app = useApp();
  const { boot } = app;
  const [subj, setSubj] = useState(null);
  const [room, setRoom] = useState('');
  const addRoom = async (e) => {
    e.preventDefault();
    if (!room.trim()) return;
    try { await api('POST', '/api/rooms', { name: room }); setRoom(''); app.reloadBoot(); } catch (x) { app.toast(x.message, 'err'); }
  };
  const renameRoom = async (r) => {
    const name = prompt('Nový název místnosti', r.name);
    if (!name) return;
    try { await api('PUT', `/api/rooms/${r.id}`, { name }); app.reloadBoot(); } catch (x) { app.toast(x.message, 'err'); }
  };
  const delRoom = async (r) => {
    if (!await app.confirm({ title: `Smazat místnost ${r.name}?`, text: 'U hodin v této místnosti se místnost vymaže.', confirm: 'Smazat', danger: true })) return;
    try { await api('DELETE', `/api/rooms/${r.id}`); app.reloadBoot(); } catch (x) { app.toast(x.message, 'err'); }
  };
  return html`<div class="two-col">
    <section class="section">
      <div class="section-head"><h2>Předměty <span class="count">${boot.subjects.length}</span></h2>
        <div class="section-aside"><button class="btn btn-primary" onClick=${() => setSubj({})}>+ Předmět</button></div></div>
      <ul class="subject-list">
        ${boot.subjects.map((s) => html`<li><button class="subject-row" onClick=${() => setSubj(s)}>
          <span class="subject-ink" style=${`background:${s.color}`}>${s.short}</span><span>${s.name}</span></button></li>`)}
      </ul>
      ${boot.subjects.length === 0 && html`<${Empty}>Přidejte předměty, které se na škole učí.<//>`}
    </section>
    <section class="section">
      <div class="section-head"><h2>Místnosti <span class="count">${boot.rooms.length}</span></h2></div>
      <form class="inline-add" onSubmit=${addRoom}><input placeholder="Název místnosti" value=${room} onInput=${(e) => setRoom(e.target.value)} /><button class="btn">Přidat</button></form>
      <ul class="room-list">${boot.rooms.map((r) => html`<li><span>${r.name}</span><span><button class="btn btn-ghost btn-s" onClick=${() => renameRoom(r)}>Přejmenovat</button><button class="btn btn-ghost btn-s" onClick=${() => delRoom(r)}>Smazat</button></span></li>`)}</ul>
    </section>
    ${subj && html`<${SubjectDialog} s=${subj} onClose=${() => setSubj(null)} onSaved=${() => { setSubj(null); app.reloadBoot(); }} />`}
  </div>`;
}

function SubjectDialog({ s, onClose, onSaved }) {
  const app = useApp();
  const [f, setF] = useState({ name: s.name || '', short: s.short || '', color: s.color || '#FFE800' });
  const [err, setErr] = useState('');
  const save = async (e) => {
    e.preventDefault();
    try { if (s.id) await api('PUT', `/api/subjects/${s.id}`, f); else await api('POST', '/api/subjects', f); onSaved(); } catch (x) { setErr(x.message); }
  };
  const del = async () => {
    if (!await app.confirm({ title: `Smazat předmět ${s.name}?`, confirm: 'Smazat', danger: true })) return;
    try { await api('DELETE', `/api/subjects/${s.id}`); onSaved(); } catch (x) { setErr(x.message); }
  };
  return html`<${Modal} title=${s.id ? 'Upravit předmět' : 'Nový předmět'} onClose=${onClose}>
    <form class="form-grid" onSubmit=${save}>
      <${Field} label="Název" half><input required value=${f.name} onInput=${(e) => setF({ ...f, name: e.target.value })} /><//>
      <${Field} label="Zkratka" half><input maxlength="4" value=${f.short} onInput=${(e) => setF({ ...f, short: e.target.value })} /><//>
      <div class="field field-wide"><span class="field-label">Barva v rozvrhu</span><${InkPicker} value=${f.color} onChange=${(c) => setF({ ...f, color: c })} /></div>
      <${ErrorLine} error=${err} />
      <div class="form-actions">
        ${s.id && html`<button type="button" class="btn btn-danger" onClick=${del}>Smazat</button>`}
        <div class="spacer"></div>
        <button type="button" class="btn" onClick=${onClose}>Zrušit</button><button class="btn btn-primary">Uložit</button>
      </div>
    </form>
  <//>`;
}

// ---------- history ----------
const ACTION = { create: 'přidáno', update: 'změněno', delete: 'smazáno', restore: 'obnoveno' };
function HistoryTab() {
  const app = useApp();
  const [state, reload] = useAsync(() => api('GET', '/api/audit'), []);
  const [kind, setKind] = useState('');
  const rows = (state.data || []).filter((r) => !kind || r.action === kind);
  const restore = async (r) => {
    if (!await app.confirm({ title: 'Obnovit smazané?', text: r.summary, confirm: 'Obnovit' })) return;
    try { await api('POST', `/api/audit/${r.id}/restore`); app.toast('Obnoveno.'); reload(); app.reloadBoot(); } catch (x) { app.toast(x.message, 'err'); }
  };
  return html`<section class="section">
    <div class="section-head"><h2>Historie změn</h2>
      <div class="section-aside"><select value=${kind} onChange=${(e) => setKind(e.target.value)}><option value="">Vše</option>${Object.entries(ACTION).map(([k, v]) => html`<option value=${k}>${v}</option>`)}</select></div></div>
    <p class="muted">Každé smazání hodiny, konzultace, cíle nebo žáka se zde zapíše a lze je vrátit tlačítkem „Obnovit“.</p>
    <div class="table-wrap"><table class="ledger">
      <thead><tr><th>Kdy</th><th>Kdo</th><th></th><th>Co</th><th></th></tr></thead>
      <tbody>${rows.map((r) => html`<tr>
        <td class="mono nowrap small">${fmtDate(r.at.slice(0, 10))} ${r.at.slice(11, 16)}</td>
        <td class="small nowrap">${r.user || '—'}</td>
        <td><span class=${'act act-' + r.action}>${ACTION[r.action] || r.action}</span></td>
        <td>${r.summary}${r.restored && html` <span class="muted small">(obnoveno)</span>`}</td>
        <td class="right">${r.restorable && html`<button class="btn btn-s" onClick=${() => restore(r)}>Obnovit</button>`}</td>
      </tr>`)}</tbody>
    </table></div>
    ${!state.loading && rows.length === 0 && html`<${Empty}>Zatím žádné změny.<//>`}
  </section>`;
}

// ---------- backup ----------
function BackupTab() {
  const { boot } = useApp();
  const online = boot.mode === 'online';
  return html`<section class="section">
    <div class="section-head"><h2>Zálohy</h2></div>
    <div class="prose">
      ${online
        ? html`<p>Raven běží online. Jednou za čas si stáhněte kompletní zálohu všech dat a uložte ji na bezpečné místo (školní disk, flash disk).</p>`
        : html`<p>Aplikace si každý den sama uloží zálohu do složky <code>raven-data\\zalohy</code> vedle souboru Raven.exe a uchovává posledních 30 dní.</p>`}
      <p><a class="btn btn-primary" href="/api/export.json" download>Stáhnout všechna data (.json)</a>
        ${!online && html` <a class="btn" href="/api/backup" download>Stáhnout soubor databáze (.db)</a>`}</p>
      <h3 class="subhead">Přesun mezi online a místní verzí</h3>
      <p>Soubor <b>.json</b> obsahuje vše včetně účtů. Kdykoli jej lze nahrát do nové, prázdné instalace Ravenu – ${online ? 'například do Raven.exe na školním počítači' : 'například do online verze'} – na úvodní obrazovce volbou „Mám zálohu – obnovit data“.</p>
      ${!online && html`<p class="muted">Obnova ze souboru .db: ukončete Raven, nahraďte soubor <code>raven-data\\raven.db</code> zálohou a spusťte ji znovu.</p>`}
    </div>
  </section>`;
}
