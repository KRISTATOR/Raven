import {
  html, useState, useMemo, useApp, api, Modal, Field, ErrorLine, PageHead, Empty, useAsync,
  today, fmtDate, fmtDayW, hm, toMin, timeVal, relDay, TimeInput, atLeast, studentName, studentNameRev, cmpCz, store, persist,
} from './lib.js';

export const CONS_KIND = { parents: 'S rodiči', student: 'Se žákem', team: 'Týmová porada', other: 'Jiná' };
export const CONS_STATUS = { planned: 'Plánovaná', done: 'Proběhla', cancelled: 'Zrušená' };

export function StudentSelect({ value, onChange, required, allowEmpty = true, emptyLabel = '— bez žáka —' }) {
  const { boot, maps } = useApp();
  const byGroup = {};
  for (const s of boot.students) (byGroup[s.group_id || 0] ||= []).push(s);
  const groups = [...boot.groups, { id: 0, name: 'Bez skupiny' }].filter((g) => byGroup[g.id]);
  return html`<select value=${value || ''} required=${required} onChange=${(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
    ${allowEmpty && html`<option value="">${emptyLabel}</option>`}
    ${groups.map((g) => html`<optgroup label=${g.name}>
      ${byGroup[g.id].slice().sort((a, b) => cmpCz(studentNameRev(a), studentNameRev(b))).map((s) => html`<option value=${s.id}>${studentNameRev(s)} (${s.grade}.)</option>`)}
    </optgroup>`)}
  </select>`;
}

export function ConsultationsPage({ params }) {
  const app = useApp();
  const { me, maps, boot } = app;
  const [filters, setFiltersRaw] = useState(() => ({ who: 'all', status: '', student: params.student ? Number(params.student) : null, q: '', ...store('consFilters', {}), ...(params.student ? { student: Number(params.student) } : {}) }));
  const setFilters = (f) => { setFiltersRaw(f); persist('consFilters', { who: f.who, status: f.status }); };
  const [dlg, setDlg] = useState(null);
  const [state, reload] = useAsync(() => api('GET', '/api/consultations'), []);
  const all = state.data || [];

  const list = useMemo(() => all.filter((c) => {
    if (filters.who === 'mine' && c.teacher_id !== me.id && app.tutorOf(c.student_id) !== me.id) return false;
    if (filters.who.startsWith('u:') && c.teacher_id !== Number(filters.who.slice(2))) return false;
    if (filters.status && c.status !== filters.status) return false;
    if (filters.student && c.student_id !== filters.student) return false;
    if (filters.q) {
      const q = filters.q.toLowerCase();
      const hay = [c.topic, c.notes, c.agreements, c.participants, studentName(maps.students[c.student_id])].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }), [all, filters]);

  const t = today();
  const upcoming = list.filter((c) => c.status === 'planned' && c.date >= t).sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? 0) - (b.start ?? 0));
  const pending = list.filter((c) => c.status === 'planned' && c.date < t);
  const past = list.filter((c) => c.status !== 'planned');

  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value });

  return html`<div class="page">
    <${PageHead} title="Konzultace" sub="schůzky s rodiči, žáky a týmové porady">
      <button class="btn btn-primary" onClick=${() => setDlg({ c: null })}>+ Nová konzultace</button>
    <//>
    <div class="toolbar">
      <label class="filter"><span class="field-label">Kdo</span>
        <select value=${filters.who} onChange=${set('who')}>
          <option value="all">Všechny</option>
          <option value="mine">Moje a mé skupiny</option>
          <optgroup label="Vede">${app.activeUsers.map((u) => html`<option value=${'u:' + u.id}>${u.name}</option>`)}</optgroup>
        </select></label>
      <label class="filter"><span class="field-label">Žák</span><${StudentSelect} value=${filters.student} emptyLabel="Všichni žáci" onChange=${(v) => setFilters({ ...filters, student: v })} /></label>
      <label class="filter"><span class="field-label">Stav</span>
        <select value=${filters.status} onChange=${set('status')}>
          <option value="">Všechny</option>${Object.entries(CONS_STATUS).map(([k, v]) => html`<option value=${k}>${v}</option>`)}
        </select></label>
      <label class="filter filter-grow"><span class="field-label">Hledat</span><input type="search" placeholder="téma, dohody, účastníci…" value=${filters.q} onInput=${set('q')} /></label>
    </div>

    ${state.loading ? html`<div class="loading-inline">Načítám…</div>` : html`
      ${pending.length > 0 && html`<${ConsTable} title="Čeká na zápis" hint="proběhlé schůzky, které jsou stále vedené jako plánované" rows=${pending} onOpen=${(c) => setDlg({ c })} warn />`}
      <${ConsTable} title="Nadcházející" rows=${upcoming} onOpen=${(c) => setDlg({ c })} empty="Žádné naplánované konzultace." />
      <${ConsTable} title="Proběhlé a zrušené" rows=${past} onOpen=${(c) => setDlg({ c })} empty="Zatím nic." />
    `}
    ${dlg && html`<${ConsultationDialog} c=${dlg.c} presetStudent=${filters.student} onClose=${() => setDlg(null)} onSaved=${() => { setDlg(null); reload(); }} />`}
  </div>`;
}

function ConsTable({ title, hint, rows, onOpen, empty, warn }) {
  const { maps } = useApp();
  return html`<section class=${'section' + (warn ? ' section-warn' : '')}>
    <div class="section-head"><h2>${title} <span class="count">${rows.length}</span></h2>${hint && html`<div class="section-aside">${hint}</div>`}</div>
    ${rows.length === 0 ? html`<${Empty}>${empty}<//>` : html`<div class="table-wrap"><table class="ledger ledger-click">
      <thead><tr><th>Datum</th><th>Žák</th><th>Typ</th><th>Téma</th><th>Vede</th><th>Stav</th><th>Další krok</th></tr></thead>
      <tbody>${rows.map((c) => {
        const s = maps.students[c.student_id];
        const g = s && s.group_id && maps.groups[s.group_id];
        return html`<tr onClick=${() => onOpen(c)} tabindex="0" onKeyDown=${(e) => e.key === 'Enter' && onOpen(c)}>
          <td class="mono nowrap">${fmtDayW(c.date)}${c.start != null ? html`<br /><span class="muted">${hm(c.start)}</span>` : ''}<br /><span class="muted small">${relDay(c.date)}</span></td>
          <td>${s ? html`<b>${studentNameRev(s)}</b><br /><span class="muted small">${s.grade}. roč.${g ? ' · ' + g.name : ''}</span>` : html`<span class="muted">—</span>`}</td>
          <td class="small">${CONS_KIND[c.kind]}</td>
          <td>${c.topic}${c.confidential && html` <span class="badge badge-conf">důvěrné</span>`}</td>
          <td class="small">${maps.users[c.teacher_id]?.name || '—'}</td>
          <td><span class=${'stamp stamp-' + c.status}>${CONS_STATUS[c.status]}</span></td>
          <td class="mono small nowrap">${c.follow_up ? html`<span class=${c.follow_up < today() && c.status !== 'cancelled' ? 'overdue' : ''}>${fmtDate(c.follow_up)}</span>` : '—'}</td>
        </tr>`;
      })}</tbody>
    </table></div>`}
  </section>`;
}

export function ConsultationDialog({ c, presetStudent, onClose, onSaved }) {
  const app = useApp();
  const { me, maps } = app;
  const isCoord = atLeast(me, 'coordinator');
  const editable = !c || c.can_edit;
  const [f, setF] = useState(() => c ? { ...c } : {
    date: today(), start: null, student_id: presetStudent || null, teacher_id: me.id, kind: 'parents', participants: '',
    topic: '', notes: '', agreements: '', follow_up: '', status: 'planned', confidential: false,
  });
  const [err, setErr] = useState('');
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async (e) => {
    e && e.preventDefault();
    try {
      if (c) await api('PUT', `/api/consultations/${c.id}`, f); else await api('POST', '/api/consultations', f);
      app.toast('Konzultace uložena.');
      onSaved();
    } catch (x) { setErr(x.message); }
  };
  const remove = async () => {
    if (!await app.confirm({ title: 'Smazat konzultaci?', text: 'Koordinátor ji případně může obnovit v historii změn.', confirm: 'Smazat', danger: true })) return;
    try { await api('DELETE', `/api/consultations/${c.id}`); app.toast('Smazáno.'); onSaved(); } catch (x) { setErr(x.message); }
  };
  const s = maps.students[f.student_id];

  if (!editable) {
    return html`<${Modal} title=${f.topic || 'Konzultace'} kicker=${fmtDayW(f.date) + (f.start != null ? ' · ' + hm(f.start) : '') + ' · ' + CONS_KIND[f.kind]} onClose=${onClose} wide>
      <dl class="detail">
        <dt>Žák</dt><dd>${s ? studentName(s) : '—'}</dd>
        <dt>Vede</dt><dd>${maps.users[f.teacher_id]?.name}</dd>
        ${f.participants && html`<dt>Účastníci</dt><dd>${f.participants}</dd>`}
        <dt>Stav</dt><dd><span class=${'stamp stamp-' + f.status}>${CONS_STATUS[f.status]}</span></dd>
        ${f.notes && html`<dt>Záznam</dt><dd class="pre">${f.notes}</dd>`}
        ${f.agreements && html`<dt>Dohody</dt><dd class="pre">${f.agreements}</dd>`}
        ${f.follow_up && html`<dt>Kontrola</dt><dd>${fmtDate(f.follow_up)}</dd>`}
      </dl>
      <p class="muted">Upravit může ${maps.users[f.teacher_id]?.name || 'vedoucí konzultace'} nebo koordinátor.</p>
    <//>`;
  }

  return html`<${Modal} title=${c ? 'Konzultace' : 'Nová konzultace'} kicker=${s ? studentName(s) : ''} onClose=${onClose} wide>
    <form class="form-grid" onSubmit=${save}>
      <${Field} label="Žák" half><${StudentSelect} value=${f.student_id} onChange=${(v) => set('student_id', v)} /><//>
      <${Field} label="Typ" half>
        <select value=${f.kind} onChange=${(e) => set('kind', e.target.value)}>${Object.entries(CONS_KIND).map(([k, v]) => html`<option value=${k}>${v}</option>`)}</select>
      <//>
      <${Field} label="Datum" half><input type="date" required value=${f.date} onChange=${(e) => set('date', e.target.value)} /><//>
      <${Field} label="Čas" hint="nepovinné" half><${TimeInput} value=${f.start} onChange=${(v) => set('start', v)} /><//>
      <${Field} label="Téma" wide><input value=${f.topic} onInput=${(e) => set('topic', e.target.value)} placeholder="o čem se bude / bylo jednáno" /><//>
      <${Field} label="Účastníci" half><input value=${f.participants} onInput=${(e) => set('participants', e.target.value)} placeholder="např. matka, tutor, žák" /><//>
      <${Field} label="Vede" half>
        ${isCoord ? html`<select value=${f.teacher_id} onChange=${(e) => set('teacher_id', Number(e.target.value))}>${app.activeUsers.map((u) => html`<option value=${u.id}>${u.name}</option>`)}</select>`
          : html`<input disabled value=${maps.users[f.teacher_id]?.name || me.name} />`}
      <//>
      <${Field} label="Záznam z průběhu" wide><textarea rows="4" value=${f.notes} onInput=${(e) => set('notes', e.target.value)}></textarea><//>
      <${Field} label="Dohody a další kroky" wide><textarea rows="3" value=${f.agreements} onInput=${(e) => set('agreements', e.target.value)}></textarea><//>
      <${Field} label="Termín kontroly" hint="kdy se k dohodám vrátit" half><input type="date" value=${f.follow_up || ''} onChange=${(e) => set('follow_up', e.target.value)} /><//>
      <${Field} label="Stav" half>
        <select value=${f.status} onChange=${(e) => set('status', e.target.value)}>${Object.entries(CONS_STATUS).map(([k, v]) => html`<option value=${k}>${v}</option>`)}</select>
      <//>
      <label class="check field-wide"><input type="checkbox" checked=${f.confidential} onChange=${(e) => set('confidential', e.target.checked)} />
        Důvěrné – uvidí jen vedoucí konzultace, tutor žáka, koordinátor a správce</label>
      <${ErrorLine} error=${err} />
      <div class="form-actions">
        ${c && html`<button type="button" class="btn btn-danger" onClick=${remove}>Smazat</button>`}
        <div class="spacer"></div>
        <button type="button" class="btn" onClick=${onClose}>Zrušit</button>
        <button class="btn btn-primary">Uložit</button>
      </div>
    </form>
  <//>`;
}
