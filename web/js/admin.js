import {
  html, useState, useApp, api, go, Modal, Field, ErrorLine, PageHead, Empty, Swatch, InkPicker, useAsync,
  today, parseISO, iso, addDays, fmtDate, hm, toMin, timeVal, daysBetween, atLeast, ROLE_LABEL, ROLE_INFO, DAYS, cmpCz, plural, TimeInput,
} from './lib.js';

const TABS = [
  ['ucty', 'Uživatelé', 'admin'],
  ['nastaveni', 'Nastavení školy', 'admin'],
  ['volno', 'Volné dny', 'admin'],
  ['predmety', 'Předměty a místnosti', 'coordinator'],
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
    case 'predmety': body = html`<${SubjectsTab} />`; break;
    case 'historie': body = html`<${HistoryTab} />`; break;
    case 'zaloha': body = html`<${BackupTab} />`; break;
  }
  return html`<div class="page">
    <${PageHead} title="Správa" sub=${ROLE_LABEL[me.role]} />
    <div class="tabs">${tabs.map(([k, label]) => html`<a href=${'#/sprava?tab=' + k} class=${'tab' + (k === tab ? ' on' : '')}>${label}</a>`)}</div>
    ${body}
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
      ${['teacher', 'coordinator', 'admin'].map((r) => html`<div><span class=${'role role-' + r}>${ROLE_LABEL[r]}</span><p>${ROLE_INFO[r]}</p></div>`)}
    </div>
    <div class="table-wrap"><table class="ledger ledger-click">
      <thead><tr><th>Jméno</th><th>Zkratka</th><th>Přihlášení</th><th>Role</th><th>Stav</th></tr></thead>
      <tbody>${users.map((u) => html`<tr class=${u.active ? '' : 'inactive'} onClick=${() => setDlg({ u })}>
        <td><b>${u.name}</b></td><td class="mono">${u.short}</td><td class="mono">${u.username}</td>
        <td><span class=${'role role-' + u.role}>${ROLE_LABEL[u.role]}</span></td>
        <td>${u.active ? 'aktivní' : html`<span class="muted">deaktivován</span>`}</td>
      </tr>`)}</tbody>
    </table></div>
    ${dlg && html`<${UserDialog} u=${dlg.u} onClose=${() => setDlg(null)} onSaved=${() => { setDlg(null); reload(); app.reloadBoot(); }} />`}
  </section>`;
}

function UserDialog({ u, onClose, onSaved }) {
  const app = useApp();
  const [f, setF] = useState(() => u ? { ...u, password: '' } : { name: '', short: '', username: '', role: 'teacher', active: true, password: '' });
  const [err, setErr] = useState('');
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
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
      <${Field} label="Jméno a příjmení" wide><input required value=${f.name} onInput=${(e) => set('name', e.target.value)} /><//>
      <${Field} label="Zkratka" hint="do rozvrhu, např. NOV" half><input maxlength="5" value=${f.short} onInput=${(e) => set('short', e.target.value)} /><//>
      <${Field} label="Přihlašovací jméno" half><input required value=${f.username} onInput=${(e) => set('username', e.target.value)} /><//>
      <div class="field field-wide">
        <span class="field-label">Role</span>
        ${['teacher', 'coordinator', 'admin'].map((r) => html`<label class="radio radio-block"><input type="radio" checked=${f.role === r} onChange=${() => set('role', r)} />
          <span><b>${ROLE_LABEL[r]}</b><br /><span class="muted small">${ROLE_INFO[r]}</span></span></label>`)}
      </div>
      <${Field} label=${u ? 'Nové heslo' : 'Úvodní heslo'} hint=${u ? 'vyplňte jen při obnově hesla (min. 6 znaků)' : 'min. 6 znaků, učitel si ho pak změní'} wide>
        <input type="text" autocomplete="off" value=${f.password} onInput=${(e) => set('password', e.target.value)} required=${!u} />
      <//>
      ${u && html`<label class="check field-wide"><input type="checkbox" checked=${f.active} onChange=${(e) => set('active', e.target.checked)} /> Účet je aktivní (deaktivovaný se nepřihlásí, jeho záznamy zůstanou)</label>`}
      <${ErrorLine} error=${err} />
      <div class="form-actions"><button type="button" class="btn" onClick=${onClose}>Zrušit</button><button class="btn btn-primary">Uložit</button></div>
    </form>
  <//>`;
}

// ---------- settings ----------
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
    try { await api('POST', '/api/holidays', f); setF({ name: '', date_from: f.date_from, date_to: f.date_from }); app.reloadBoot(); setErr(''); } catch (x) { setErr(x.message); }
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

function HolidayDialog({ h, onClose, onSaved }) {
  const [f, setF] = useState({ ...h });
  const [err, setErr] = useState('');
  const save = async (e) => {
    e.preventDefault();
    try { await api('PUT', `/api/holidays/${h.id}`, f); onSaved(); } catch (x) { setErr(x.message); }
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
