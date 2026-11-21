import {
  html, useState, useMemo, useApp, api, Modal, Field, ErrorLine, PageHead, Empty, Swatch, InkPicker, useAsync,
  studentName, studentNameRev, cmpCz, atLeast, inkText, plural,
} from './lib.js';

export function PeoplePage() {
  const app = useApp();
  const { me, boot, maps } = app;
  const isCoord = atLeast(me, 'coordinator');
  const [dlg, setDlg] = useState(null);
  const [q, setQ] = useState('');
  const [grade, setGrade] = useState('');
  const [grp, setGrp] = useState('');
  const [goalsState] = useAsync(() => api('GET', '/api/goals?status=active'), []);
  const activeGoals = useMemo(() => {
    const m = {};
    for (const g of goalsState.data || []) m[g.student_id] = (m[g.student_id] || 0) + 1;
    return m;
  }, [goalsState.data]);

  const students = boot.students
    .filter((s) => !q || studentName(s).toLowerCase().includes(q.toLowerCase()))
    .filter((s) => !grade || String(s.grade) === grade)
    .filter((s) => !grp || String(s.group_id || 0) === grp)
    .sort((a, b) => cmpCz(studentNameRev(a), studentNameRev(b)));
  const grades = [...new Set([...boot.settings.grades, ...boot.students.map((s) => s.grade)])].filter(Boolean).sort((a, b) => a - b);
  const ungrouped = boot.students.filter((s) => !s.group_id);
  const done = () => { setDlg(null); app.reloadBoot(); };

  return html`<div class="page">
    <${PageHead} title="Žáci a skupiny" sub=${`${boot.students.length} žáků · ${boot.groups.length} tutorských skupin`}>
      ${isCoord && html`
        <button class="btn" onClick=${() => setDlg({ type: 'excel' })}>Excel…</button>
        <button class="btn" onClick=${() => setDlg({ type: 'group', g: null })}>+ Skupina</button>
        <button class="btn btn-primary" onClick=${() => setDlg({ type: 'student', s: null })}>+ Žák</button>`}
    <//>

    <section class="section">
      <div class="section-head"><h2>Tutorské skupiny</h2><div class="section-aside">domovské skupiny pro ranní kruhy a dělení na výjezdech</div></div>
      <div class="groups">
        ${boot.groups.map((g) => {
          const members = boot.students.filter((s) => s.group_id === g.id).sort((a, b) => a.grade - b.grade || cmpCz(studentNameRev(a), studentNameRev(b)));
          const tutor = g.tutor_id && maps.users[g.tutor_id];
          const counts = {};
          members.forEach((s) => { counts[s.grade] = (counts[s.grade] || 0) + 1; });
          return html`<article class="group-card">
            <header style=${`background:${g.color};color:${inkText(g.color)}`}>
              <h3>${g.name}</h3>
              <span class="group-n">${members.length}</span>
            </header>
            <div class="group-tutor">${tutor ? html`tutor <b>${tutor.name}</b>` : html`<span class="muted">bez tutora</span>`}</div>
            <div class="group-grades">${Object.entries(counts).map(([gr, n]) => html`<span>${gr}. roč. <b>${n}</b></span>`)}</div>
            <ul class="group-list">${members.map((s) => html`<li><a href=${'#/zak?id=' + s.id} title="Karta žáka">${studentNameRev(s)}</a><span class="muted">${s.grade}.</span></li>`)}</ul>
            ${isCoord && html`<button class="btn btn-ghost btn-block" onClick=${() => setDlg({ type: 'group', g })}>Upravit skupinu</button>`}
          </article>`;
        })}
        ${boot.groups.length === 0 && html`<${Empty}>Zatím žádné skupiny.${isCoord ? ' Založte první tlačítkem „+ Skupina“.' : ''}<//>`}
      </div>
      ${ungrouped.length > 0 && html`<p class="muted">Bez skupiny: ${ungrouped.map(studentName).join(', ')}</p>`}
    </section>

    <section class="section">
      <div class="section-head"><h2>Žáci <span class="count">${students.length}</span></h2></div>
      <div class="toolbar">
        <label class="filter filter-grow"><span class="field-label">Hledat</span><input type="search" value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="jméno" /></label>
        <label class="filter"><span class="field-label">Ročník</span>
          <select value=${grade} onChange=${(e) => setGrade(e.target.value)}><option value="">Všechny</option>${grades.map((g) => html`<option value=${g}>${g}.</option>`)}</select></label>
        <label class="filter"><span class="field-label">Skupina</span>
          <select value=${grp} onChange=${(e) => setGrp(e.target.value)}><option value="">Všechny</option>${boot.groups.map((g) => html`<option value=${g.id}>${g.name}</option>`)}<option value="0">Bez skupiny</option></select></label>
        ${isCoord && html`<button class="btn" onClick=${() => setDlg({ type: 'bulk' })}>Hromadně přidat</button>`}
      </div>
      <div class="table-wrap"><table class="ledger">
        <thead><tr><th>Příjmení a jméno</th><th>Ročník</th><th>Skupina</th><th>Tutor</th><th>Cíle</th><th></th></tr></thead>
        <tbody>${students.map((s) => {
          const g = s.group_id && maps.groups[s.group_id];
          const t = g && g.tutor_id && maps.users[g.tutor_id];
          return html`<tr>
            <td><a class="student-link" href=${'#/zak?id=' + s.id} title="Karta žáka"><b>${studentNameRev(s)}</b></a>${s.email && html`<br /><span class="mono small muted">${s.email}</span>`}${s.note && html`<br /><span class="muted small">${s.note}</span>`}</td>
            <td class="mono">${s.grade}.</td>
            <td>${g ? html`<${Swatch} color=${g.color} /> ${g.name}` : html`<span class="muted">—</span>`}</td>
            <td class="small">${t ? t.name : '—'}</td>
            <td><a href=${'#/cile?student=' + s.id}>${activeGoals[s.id] ? `${activeGoals[s.id]} probíhá` : 'zobrazit'}</a></td>
            <td class="right">${isCoord && html`<button class="btn btn-ghost btn-s" onClick=${() => setDlg({ type: 'student', s })}>Upravit</button>`}</td>
          </tr>`;
        })}</tbody>
      </table></div>
    </section>

    ${dlg?.type === 'student' && html`<${StudentDialog} s=${dlg.s} onClose=${() => setDlg(null)} onSaved=${done} />`}
    ${dlg?.type === 'group' && html`<${GroupDialog} g=${dlg.g} onClose=${() => setDlg(null)} onSaved=${done} />`}
    ${dlg?.type === 'bulk' && html`<${BulkDialog} onClose=${() => setDlg(null)} onSaved=${done} />`}
    ${dlg?.type === 'excel' && html`<${ExcelDialog} onClose=${() => setDlg(null)} onSaved=${done} />`}
  </div>`;
}

function StudentDialog({ s, onClose, onSaved }) {
  const app = useApp();
  const { boot } = app;
  const [f, setF] = useState(() => s ? { ...s } : { first_name: '', last_name: '', grade: boot.settings.grades[0] || 7, group_id: null, note: '', email: '' });
  const [err, setErr] = useState('');
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async (e) => {
    e.preventDefault();
    try {
      const body = { ...f, grade: Number(f.grade), group_id: f.group_id ? Number(f.group_id) : null };
      if (s) await api('PUT', `/api/students/${s.id}`, body); else await api('POST', '/api/students', body);
      app.toast('Uloženo.');
      onSaved();
    } catch (x) { setErr(x.message); }
  };
  const remove = async () => {
    if (!await app.confirm({ title: `Odebrat žáka ${studentName(s)}?`, text: 'Žák zmizí ze seznamů. Jeho cíle a konzultace zůstanou uložené a koordinátor jej může obnovit v historii změn.', confirm: 'Odebrat', danger: true })) return;
    try { await api('DELETE', `/api/students/${s.id}`); app.toast('Žák odebrán.'); onSaved(); } catch (x) { setErr(x.message); }
  };
  return html`<${Modal} title=${s ? 'Upravit žáka' : 'Nový žák'} onClose=${onClose}>
    <form class="form-grid" onSubmit=${save}>
      <${Field} label="Jméno" half><input required value=${f.first_name} onInput=${(e) => set('first_name', e.target.value)} /><//>
      <${Field} label="Příjmení" half><input required value=${f.last_name} onInput=${(e) => set('last_name', e.target.value)} /><//>
      <${Field} label="Ročník" half>
        <select value=${f.grade} onChange=${(e) => set('grade', e.target.value)}>
          ${[...new Set([...boot.settings.grades, Number(f.grade)])].sort((a, b) => a - b).map((g) => html`<option value=${g}>${g}.</option>`)}
        </select>
      <//>
      <${Field} label="Tutorská skupina" half>
        <select value=${f.group_id || ''} onChange=${(e) => set('group_id', e.target.value)}>
          <option value="">— bez skupiny —</option>${boot.groups.map((g) => html`<option value=${g.id}>${g.name}</option>`)}
        </select>
      <//>
      <${Field} label="Školní e-mail" hint="@montetrida.cz – podle něj se žák po přihlášení přes Google propojí se svým záznamem" wide><input type="email" value=${f.email || ''} onInput=${(e) => set('email', e.target.value)} placeholder="jmeno.prijmeni@montetrida.cz" /><//>
      <${Field} label="Poznámka" hint="viditelná všem učitelům" wide><input value=${f.note} onInput=${(e) => set('note', e.target.value)} /><//>
      <${ErrorLine} error=${err} />
      <div class="form-actions">
        ${s && html`<button type="button" class="btn btn-danger" onClick=${remove}>Odebrat žáka</button>`}
        <div class="spacer"></div>
        <button type="button" class="btn" onClick=${onClose}>Zrušit</button>
        <button class="btn btn-primary">Uložit</button>
      </div>
    </form>
  <//>`;
}

function GroupDialog({ g, onClose, onSaved }) {
  const app = useApp();
  const { boot, maps } = app;
  const [f, setF] = useState(() => g ? { ...g } : { name: '', tutor_id: null, color: '#0078BF', note: '' });
  const [members, setMembers] = useState(() => new Set(g ? boot.students.filter((s) => s.group_id === g.id).map((s) => s.id) : []));
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const toggle = (id) => { const m = new Set(members); m.has(id) ? m.delete(id) : m.add(id); setMembers(m); };
  const save = async (e) => {
    e.preventDefault();
    try {
      const body = { ...f, tutor_id: f.tutor_id ? Number(f.tutor_id) : null, student_ids: [...members] };
      if (g) await api('PUT', `/api/groups/${g.id}`, body); else await api('POST', '/api/groups', body);
      app.toast('Skupina uložena.');
      onSaved();
    } catch (x) { setErr(x.message); }
  };
  const remove = async () => {
    if (!await app.confirm({ title: `Smazat skupinu ${g.name}?`, text: 'Žáci zůstanou v systému, jen budou bez skupiny.', confirm: 'Smazat', danger: true })) return;
    try { await api('DELETE', `/api/groups/${g.id}`); onSaved(); } catch (x) { setErr(x.message); }
  };
  const list = boot.students.filter((s) => !q || studentName(s).toLowerCase().includes(q.toLowerCase())).sort((a, b) => cmpCz(studentNameRev(a), studentNameRev(b)));
  return html`<${Modal} title=${g ? 'Upravit skupinu' : 'Nová tutorská skupina'} onClose=${onClose} wide>
    <form class="form-grid" onSubmit=${save}>
      <${Field} label="Název" half><input required value=${f.name} onInput=${(e) => set('name', e.target.value)} /><//>
      <${Field} label="Tutor" half>
        <select value=${f.tutor_id || ''} onChange=${(e) => set('tutor_id', e.target.value)}>
          <option value="">— bez tutora —</option>${app.activeUsers.map((u) => html`<option value=${u.id}>${u.name}</option>`)}
        </select>
      <//>
      <div class="field field-wide"><span class="field-label">Barva</span><${InkPicker} value=${f.color} onChange=${(c) => set('color', c)} /></div>
      <div class="field field-wide">
        <span class="field-label">Členové <em>${members.size} vybráno</em></span>
        <input type="search" placeholder="Hledat žáka" value=${q} onInput=${(e) => setQ(e.target.value)} />
        <div class="member-grid">
          ${list.map((s) => {
            const other = s.group_id && (!g || s.group_id !== g.id) ? maps.groups[s.group_id] : null;
            return html`<label class=${'member' + (members.has(s.id) ? ' on' : '')}>
              <input type="checkbox" checked=${members.has(s.id)} onChange=${() => toggle(s.id)} />
              <span>${studentNameRev(s)} <span class="muted">${s.grade}.</span></span>
              ${other && !members.has(s.id) && html`<em class="muted small">${other.name}</em>`}
            </label>`;
          })}
        </div>
        <span class="field-hint">Zaškrtnutím žáka přesunete do této skupiny (i z jiné).</span>
      </div>
      <${ErrorLine} error=${err} />
      <div class="form-actions">
        ${g && html`<button type="button" class="btn btn-danger" onClick=${remove}>Smazat skupinu</button>`}
        <div class="spacer"></div>
        <button type="button" class="btn" onClick=${onClose}>Zrušit</button>
        <button class="btn btn-primary">Uložit</button>
      </div>
    </form>
  <//>`;
}

function parseBulk(text, defaultGrade) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
    const parts = line.split(/[;,\t]/).map((x) => x.trim()).filter(Boolean);
    let names = parts[0] || '', grade = defaultGrade;
    const m = line.match(/(\d{1,2})\.?\s*$/);
    if (parts.length > 1 && /^\d{1,2}\.?$/.test(parts[parts.length - 1])) grade = parseInt(parts[parts.length - 1], 10);
    else if (m && parts.length === 1) { grade = parseInt(m[1], 10); names = line.slice(0, m.index).trim(); }
    const w = names.split(/\s+/);
    const last = w.length > 1 ? w.slice(1).join(' ') : '';
    return { first_name: w[0] || '', last_name: last, grade };
  });
}

function BulkDialog({ onClose, onSaved }) {
  const app = useApp();
  const { boot } = app;
  const [text, setText] = useState('');
  const [grade, setGrade] = useState(boot.settings.grades[0] || 7);
  const [group, setGroup] = useState('');
  const [err, setErr] = useState('');
  const rows = parseBulk(text, Number(grade));
  const valid = rows.filter((r) => r.first_name && r.last_name);
  const save = async () => {
    try {
      const r = await api('POST', '/api/students/bulk', { students: valid.map((x) => ({ ...x, group_id: group ? Number(group) : null })) });
      app.toast(`Přidáno žáků: ${r.created}.`);
      onSaved();
    } catch (x) { setErr(x.message); }
  };
  return html`<${Modal} title="Hromadně přidat žáky" onClose=${onClose} wide>
    <div class="form-grid">
      <${Field} label="Seznam žáků" hint="Každý žák na nový řádek: Jméno Příjmení, případně za čárkou ročník (např. „Anna Malá, 8“). Lze vložit i sloupce zkopírované z Excelu." wide>
        <textarea rows="8" value=${text} onInput=${(e) => setText(e.target.value)} placeholder=${'Anna Malá, 8\nJakub Veselý, 9\nEma Krásná'}></textarea>
      <//>
      <${Field} label="Výchozí ročník" half>
        <select value=${grade} onChange=${(e) => setGrade(e.target.value)}>${boot.settings.grades.map((g) => html`<option value=${g}>${g}.</option>`)}</select>
      <//>
      <${Field} label="Zařadit do skupiny" half>
        <select value=${group} onChange=${(e) => setGroup(e.target.value)}><option value="">— zatím žádná —</option>${boot.groups.map((g) => html`<option value=${g.id}>${g.name}</option>`)}</select>
      <//>
      ${rows.length > 0 && html`<div class="field-wide bulk-preview">
        <span class="field-label">Náhled (${valid.length} v pořádku${rows.length - valid.length ? `, ${rows.length - valid.length} bez příjmení` : ''})</span>
        <ul>${rows.slice(0, 60).map((r) => html`<li class=${r.last_name ? '' : 'bad'}>${r.first_name} <b>${r.last_name || '?'}</b> · ${r.grade}.</li>`)}</ul>
      </div>`}
      <${ErrorLine} error=${err} />
      <div class="form-actions"><button class="btn" onClick=${onClose}>Zrušit</button><button class="btn btn-primary" disabled=${!valid.length} onClick=${save}>Přidat ${valid.length || ''}</button></div>
    </div>
  <//>`;
}

function ExcelDialog({ onClose, onSaved }) {
  const app = useApp();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const check = async (fl) => {
    setFile(fl); setErr(''); setPreview(null);
    if (!fl) return;
    setBusy(true);
    try { setPreview(await api('POST', '/api/excel/import', fl)); } catch (x) { setErr(x.message); }
    setBusy(false);
  };
  const apply = async () => {
    setBusy(true);
    try {
      const r = await api('POST', '/api/excel/import?apply=1', file);
      app.toast(`Uloženo: ${r.created} nových, ${r.updated} upravených.`);
      onSaved();
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  const total = preview ? preview.creates.length + preview.updates.length : 0;
  return html`<${Modal} title="Žáci a cíle v Excelu" onClose=${onClose} wide>
    <div class="excel-steps">
      <div class="excel-step">
        <span class="step-no">1</span>
        <div><b>Stáhněte aktuální data.</b><p class="muted">Soubor obsahuje listy „Žáci“ a „Cíle“ a krátký návod.</p>
          <a class="btn" href="/api/excel/export" download>Stáhnout .xlsx</a></div>
      </div>
      <div class="excel-step">
        <span class="step-no">2</span>
        <div><b>Upravte v Excelu a uložte.</b><p class="muted">Sloupec ID neměňte. Nový žák nebo cíl = řádek s prázdným ID. Smazání řádku v aplikaci nic nesmaže.</p></div>
      </div>
      <div class="excel-step">
        <span class="step-no">3</span>
        <div><b>Nahrajte zpět a zkontrolujte změny.</b>
          <p><input type="file" accept=".xlsx" onChange=${(e) => check(e.target.files[0])} /></p></div>
      </div>
    </div>
    ${busy && html`<div class="loading-inline">Zpracovávám…</div>`}
    ${preview && html`<div class="import-preview">
      <div class="import-sum">
        <span><b>${preview.creates.length}</b> nových</span>
        <span><b>${preview.updates.length}</b> změněných</span>
        <span><b>${preview.unchanged}</b> beze změny</span>
        <span class=${preview.errors.length ? 'bad' : ''}><b>${preview.errors.length}</b> chyb</span>
      </div>
      ${preview.errors.length > 0 && html`<h4>Chyby (tyto řádky se přeskočí)</h4><ul class="import-list bad">${preview.errors.map((e) => html`<li><span class="mono">${e.sheet}${e.row ? ' ř. ' + e.row : ''}</span> ${e.message}</li>`)}</ul>`}
      ${preview.creates.length > 0 && html`<h4>Nové</h4><ul class="import-list">${preview.creates.map((x) => html`<li><span class="mono">${x.sheet} ř. ${x.row}</span> ${x.label}</li>`)}</ul>`}
      ${preview.updates.length > 0 && html`<h4>Změny</h4><ul class="import-list">${preview.updates.map((x) => html`<li><span class="mono">${x.sheet} ř. ${x.row}</span> <b>${x.label}</b> – ${x.changes.join('; ')}</li>`)}</ul>`}
    </div>`}
    <${ErrorLine} error=${err} />
    <div class="form-actions">
      <button class="btn" onClick=${onClose}>Zavřít</button>
      ${preview && html`<button class="btn btn-primary" disabled=${busy || total === 0} onClick=${apply}>Uložit ${plural(total, 'změnu', 'změny', 'změn')}</button>`}
    </div>
  <//>`;
}
