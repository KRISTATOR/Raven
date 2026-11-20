import {
  html, useState, useMemo, useEffect, useApp, api, go, Modal, Field, ErrorLine, PageHead, Empty, Swatch, useAsync,
  today, addDays, fmtDate, relDay, studentName, studentNameRev, cmpCz, schoolYearLabel, atLeast, store, persist,
} from './lib.js';
import { StudentSelect } from './consultations.js';

export const GOAL_STATUS = { active: 'Probíhá', achieved: 'Splněno', partial: 'Částečně splněno', not_achieved: 'Nesplněno', cancelled: 'Zrušeno' };

export function GoalsPage({ params }) {
  const app = useApp();
  const { me, boot, maps } = app;
  const defaultGroup = app.myGroups[0] ? String(app.myGroups[0].id) : '';
  const [group, setGroupRaw] = useState(() => store('goalsGroup', defaultGroup));
  const setGroup = (g) => { setGroupRaw(g); persist('goalsGroup', g); };
  const [q, setQ] = useState('');
  const [onlyActive, setOnlyActive] = useState(false);
  const [state, reload] = useAsync(() => api('GET', '/api/goals'), []);
  const goals = state.data || [];
  const selected = params.student ? Number(params.student) : null;

  const byStudent = useMemo(() => {
    const m = {};
    for (const g of goals) (m[g.student_id] ||= []).push(g);
    return m;
  }, [goals]);

  const students = boot.students
    .filter((s) => !group || String(s.group_id || '') === group)
    .filter((s) => !q || studentName(s).toLowerCase().includes(q.toLowerCase()))
    .filter((s) => !onlyActive || (byStudent[s.id] || []).some((g) => g.status === 'active'))
    .sort((a, b) => cmpCz(studentNameRev(a), studentNameRev(b)));

  useEffect(() => {
    if (!selected && students.length && matchMedia('(min-width: 900px)').matches) go('cile', { student: students[0].id });
  }, [selected, group]);

  const t = today();
  return html`<div class="page">
    <${PageHead} title="Osobní cíle" sub=${schoolYearLabel()} />
    <div class="split">
      <aside class="split-list">
        <div class="list-tools">
          <select value=${group} onChange=${(e) => setGroup(e.target.value)}>
            <option value="">Všichni žáci</option>
            ${boot.groups.map((g) => html`<option value=${g.id}>${g.name}${g.tutor_id === me.id ? ' (moje)' : ''}</option>`)}
          </select>
          <input type="search" placeholder="Hledat žáka" value=${q} onInput=${(e) => setQ(e.target.value)} />
          <label class="check small"><input type="checkbox" checked=${onlyActive} onChange=${(e) => setOnlyActive(e.target.checked)} /> jen s probíhajícím cílem</label>
        </div>
        <ul class="plist">
          ${students.map((s) => {
            const gs = byStudent[s.id] || [];
            const active = gs.filter((g) => g.status === 'active');
            const due = active.some((g) => g.review_date && g.review_date <= t);
            const grp = s.group_id && maps.groups[s.group_id];
            return html`<li><a href=${'#/cile?student=' + s.id} class=${'pitem' + (selected === s.id ? ' on' : '')}>
              ${grp && html`<${Swatch} color=${grp.color} />`}
              <span class="pname">${studentNameRev(s)}</span>
              <span class="pgrade">${s.grade}.</span>
              <span class=${'pcount' + (due ? ' due' : '')} title=${due ? 'Cíl čeká na revizi' : 'Probíhající cíle'}>${active.length || ''}</span>
            </a></li>`;
          })}
          ${students.length === 0 && html`<li class="muted pad">Žádní žáci.</li>`}
        </ul>
      </aside>
      <div class="split-main">
        ${selected && maps.students[selected]
          ? html`<${StudentGoals} student=${maps.students[selected]} goals=${byStudent[selected] || []} reload=${reload} />`
          : html`<${Empty}>Vyberte žáka vlevo.<//>`}
      </div>
    </div>
  </div>`;
}

function StudentGoals({ student, goals, reload }) {
  const app = useApp();
  const { maps } = app;
  const [dlg, setDlg] = useState(null);
  const grp = student.group_id && maps.groups[student.group_id];
  const tutor = grp && grp.tutor_id && maps.users[grp.tutor_id];
  const canCreate = app.canManageGoals(student.id);
  const active = goals.filter((g) => g.status === 'active');
  const closed = goals.filter((g) => g.status !== 'active');
  return html`<div>
    <div class="student-head">
      <div>
        <div class="kicker">${student.grade}. ročník${grp ? ' · skupina ' + grp.name : ''}${tutor ? ' · tutor ' + tutor.name : ''}</div>
        <h2 class="student-name">${studentName(student)}</h2>
      </div>
      <div class="page-actions">
        <a class="btn" href=${'#/konzultace?student=' + student.id}>Konzultace</a>
        ${canCreate && html`<button class="btn btn-primary" onClick=${() => setDlg({ g: null })}>+ Nový cíl</button>`}
      </div>
    </div>
    ${student.note && html`<p class="student-note">${student.note}</p>`}
    ${goals.length === 0 && html`<${Empty}>${canCreate ? 'Žák zatím nemá žádný cíl. Založte první.' : 'Žák zatím nemá žádný cíl. Cíle zakládá tutor nebo koordinátor.'}<//>`}
    ${active.map((g) => html`<${GoalCard} g=${g} onEdit=${() => setDlg({ g })} reload=${reload} />`)}
    ${closed.length > 0 && html`<h3 class="subhead">Uzavřené cíle</h3>${closed.map((g) => html`<${GoalCard} g=${g} onEdit=${() => setDlg({ g })} reload=${reload} closed />`)}`}
    ${dlg && html`<${GoalDialog} g=${dlg.g} studentId=${student.id} onClose=${() => setDlg(null)} onSaved=${() => { setDlg(null); reload(); }} />`}
  </div>`;
}

function GoalCard({ g, onEdit, reload, closed }) {
  const app = useApp();
  const { me, maps } = app;
  const [note, setNote] = useState('');
  const [date, setDate] = useState(today());
  const [open, setOpen] = useState(!closed);
  const due = g.status === 'active' && g.review_date && g.review_date <= today();
  const addNote = async (e) => {
    e.preventDefault();
    if (!note.trim()) return;
    try { await api('POST', `/api/goals/${g.id}/notes`, { text: note, date }); setNote(''); reload(); } catch (x) { app.toast(x.message, 'err'); }
  };
  const delNote = async (n) => {
    if (!await app.confirm({ title: 'Smazat poznámku?', text: n.text, confirm: 'Smazat', danger: true })) return;
    try { await api('DELETE', `/api/goal-notes/${n.id}`); reload(); } catch (x) { app.toast(x.message, 'err'); }
  };
  return html`<article class=${'goal goal-' + g.status}>
    <header class="goal-head" onClick=${() => setOpen(!open)}>
      <div class="goal-main">
        <h3>${g.title}</h3>
        <div class="goal-meta">
          ${g.area && html`<span>${g.area}</span>`}
          ${g.period && html`<span>${g.period}</span>`}
          ${g.review_date && html`<span class=${due ? 'overdue' : ''}>revize ${fmtDate(g.review_date)} (${relDay(g.review_date)})</span>`}
        </div>
      </div>
      <span class=${'stamp stamp-g-' + g.status}>${GOAL_STATUS[g.status]}</span>
    </header>
    ${open && html`<div class="goal-body">
      ${g.description && html`<p class="goal-desc">${g.description}</p>`}
      <ol class="notes">
        ${g.notes.map((n) => html`<li>
          <span class="note-date mono">${fmtDate(n.date)}</span>
          <span class="note-who">${maps.users[n.author_id]?.short || maps.users[n.author_id]?.name || ''}</span>
          <span class="note-text">${n.text}</span>
          ${(n.author_id === me.id || atLeast(me, 'coordinator')) && html`<button class="note-x" title="Smazat poznámku" onClick=${() => delNote(n)}>×</button>`}
        </li>`)}
      </ol>
      <form class="note-add" onSubmit=${addNote}>
        <input type="date" value=${date} onChange=${(e) => setDate(e.target.value)} />
        <input placeholder="Přidat poznámku k průběhu…" value=${note} onInput=${(e) => setNote(e.target.value)} />
        <button class="btn">Přidat</button>
      </form>
      ${g.can_manage && html`<div class="goal-actions"><button class="btn btn-ghost" onClick=${onEdit}>Upravit cíl</button></div>`}
    </div>`}
  </article>`;
}

function GoalDialog({ g, studentId, onClose, onSaved }) {
  const app = useApp();
  const { boot } = app;
  const [f, setF] = useState(() => g ? { ...g } : { student_id: studentId, title: '', description: '', area: '', period: schoolYearLabel(), review_date: addDays(today(), 28), status: 'active' });
  const [err, setErr] = useState('');
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const [areas] = useAsync(async () => [...new Set((await api('GET', '/api/goals')).map((x) => x.area).filter(Boolean))].sort(cmpCz), []);
  const save = async (e) => {
    e.preventDefault();
    try {
      if (g) await api('PUT', `/api/goals/${g.id}`, f); else await api('POST', '/api/goals', f);
      app.toast('Cíl uložen.');
      onSaved();
    } catch (x) { setErr(x.message); }
  };
  const remove = async () => {
    if (!await app.confirm({ title: 'Smazat cíl?', text: `„${g.title}“ včetně poznámek. Koordinátor jej může obnovit v historii.`, confirm: 'Smazat', danger: true })) return;
    try { await api('DELETE', `/api/goals/${g.id}`); app.toast('Cíl smazán.'); onSaved(); } catch (x) { setErr(x.message); }
  };
  return html`<${Modal} title=${g ? 'Upravit cíl' : 'Nový osobní cíl'} kicker=${studentName(app.maps.students[f.student_id])} onClose=${onClose} wide>
    <form class="form-grid" onSubmit=${save}>
      ${g && html`<${Field} label="Žák" wide><${StudentSelect} value=${f.student_id} allowEmpty=${false} onChange=${(v) => set('student_id', v)} /><//>`}
      <${Field} label="Cíl" hint="krátce a srozumitelně, ideálně slovy žáka" wide><input required value=${f.title} onInput=${(e) => set('title', e.target.value)} /><//>
      <${Field} label="Popis / jak poznám, že je splněno" wide><textarea rows="3" value=${f.description} onInput=${(e) => set('description', e.target.value)}></textarea><//>
      <${Field} label="Oblast" half>
        <input list="goal-areas" value=${f.area} onInput=${(e) => set('area', e.target.value)} placeholder="např. Matematika, Organizace" />
        <datalist id="goal-areas">${(areas.data || []).map((a) => html`<option value=${a} />`)}</datalist>
      <//>
      <${Field} label="Období" half><input value=${f.period} onInput=${(e) => set('period', e.target.value)} /><//>
      <${Field} label="Termín revize" half><input type="date" value=${f.review_date || ''} onChange=${(e) => set('review_date', e.target.value)} /><//>
      <${Field} label="Stav" half>
        <select value=${f.status} onChange=${(e) => set('status', e.target.value)}>${Object.entries(GOAL_STATUS).map(([k, v]) => html`<option value=${k}>${v}</option>`)}</select>
      <//>
      <${ErrorLine} error=${err} />
      <div class="form-actions">
        ${g && html`<button type="button" class="btn btn-danger" onClick=${remove}>Smazat</button>`}
        <div class="spacer"></div>
        <button type="button" class="btn" onClick=${onClose}>Zrušit</button>
        <button class="btn btn-primary">Uložit</button>
      </div>
    </form>
  <//>`;
}
