import { html, useState, useEffect, useApp, api, Modal, Field, ErrorLine, Empty, hm, plural, fmtDate, addDays, DAYS_SHORT, isoWeek } from './lib.js';
import { weekTitle } from './schedule.js';

// Schedule templates ("šablony rozvrhu"), admins only. A template is a saved week;
// applying it fills chosen weeks and leaves out days off, so a holiday week needs no
// deleting by hand.

const perDay = (items) => [1, 2, 3, 4, 5].map((d) => items.filter((it) => it.weekday === d).length);

function itemTitle(it, maps) {
  return it.title || (it.subject_id && maps.subjects[it.subject_id]?.name) || (it.kind === 'trip' ? 'Výjezd' : 'Akce');
}

// ---------- on the timetable: apply a template / save this week ----------
export function TemplatesDialog({ week, onClose, onDone }) {
  const app = useApp();
  const { boot } = app;
  const [list, setList] = useState(null);
  const [pick, setPick] = useState(null);
  const [weeks, setWeeks] = useState(1);
  const [mode, setMode] = useState('add');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => api('GET', '/api/templates').then((l) => { setList(l); if (l.length && !pick) setPick(l[0].id); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const lastWeek = addDays(week, 7 * (Math.max(1, Number(weeks) || 1) - 1));
  const holidaysIn = boot.holidays.filter((h) => h.date_to >= week && h.date_from <= addDays(lastWeek, 4));

  const apply = async () => {
    const t = list.find((x) => x.id === pick);
    if (!t) return;
    if (mode === 'replace' && !await app.confirm({
      title: 'Nahradit hodiny?',
      text: `Hodiny v ${weeks > 1 ? `${weeks} týdnech od ${weekTitle(week)}` : `týdnu ${weekTitle(week)}`} se odeberou a nahradí šablonou „${t.name}“. Přihlášky žáků k odebraným hodinám zaniknou. Odebrané hodiny jdou obnovit v Historii změn.`,
      confirm: 'Nahradit', danger: true,
    })) return;
    setBusy(true); setErr('');
    try {
      const r = await api('POST', `/api/templates/${t.id}/apply`, { from: week, weeks: Number(weeks), mode });
      const parts = [`Přidáno ${plural(r.created, 'položka', 'položky', 'položek')}`];
      if (r.removed) parts.push(`odebráno ${r.removed}`);
      if (r.holiday_skipped) parts.push(`${r.holiday_skipped}× vynecháno kvůli volnu`);
      if (r.duplicates) parts.push(`${r.duplicates}× už v rozvrhu bylo`);
      if (r.inactive_skipped) parts.push(`${r.inactive_skipped}× vynecháno (neaktivní vyučující)`);
      app.toast(parts.join(', ') + '.');
      onDone();
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const t = await api('POST', '/api/templates', { name, week });
      app.toast(`Šablona „${t.name}“ uložena (${plural(t.items.length, 'položka', 'položky', 'položek')}).`);
      setName(''); setPick(t.id); await load();
    } catch (x) { setErr(x.message); }
    setBusy(false);
  };

  return html`<${Modal} title="Šablony rozvrhu" kicker=${'týden ' + isoWeek(week) + ' · ' + weekTitle(week)} onClose=${onClose} wide>
    <section class="tpl-sec">
      <h3 class="tpl-h">Použít šablonu</h3>
      ${!list ? html`<p class="muted">Načítám…</p>` : list.length === 0 ? html`<p class="muted">Zatím žádná šablona. Naplánujte běžný týden a uložte ho níže jako šablonu.</p>` : html`
        <div class="tpl-picks" role="radiogroup" aria-label="Šablona">
          ${list.map((t) => html`<label class=${'tpl-pick' + (pick === t.id ? ' on' : '')}>
            <input type="radio" name="tpl" checked=${pick === t.id} onChange=${() => setPick(t.id)} />
            <b>${t.name}</b>
            <span class="tpl-days">${perDay(t.items).map((n, i) => html`<span title=${`${DAYS_SHORT[i]}: ${n}`}><i>${DAYS_SHORT[i]}</i>${n}</span>`)}</span>
            <span class="muted small">${plural(t.items.length, 'položka', 'položky', 'položek')}</span>
          </label>`)}
        </div>
        <div class="tpl-opts">
          <${Field} label="Na kolik týdnů" hint=${weeks > 1 ? `do ${fmtDate(addDays(lastWeek, 4))}` : 'jen tento týden'}>
            <input type="number" min="1" max="52" value=${weeks} onInput=${(e) => setWeeks(e.target.value)} />
          <//>
          <div class="field">
            <span class="field-label">Existující hodiny</span>
            <label class="check"><input type="radio" name="mode" checked=${mode === 'add'} onChange=${() => setMode('add')} /> ponechat a doplnit šablonu</label>
            <label class="check"><input type="radio" name="mode" checked=${mode === 'replace'} onChange=${() => setMode('replace')} /> nahradit šablonou</label>
          </div>
        </div>
        ${holidaysIn.length > 0 && html`<p class="tpl-hol">Volno se vynechá: ${holidaysIn.map((h) => `${h.name} (${fmtDate(h.date_from)}${h.date_to !== h.date_from ? ' – ' + fmtDate(h.date_to) : ''})`).join(', ')}.</p>`}
        <div class="form-actions"><button class="btn btn-primary" disabled=${busy || !pick} onClick=${apply}>Použít šablonu</button></div>`}
    </section>
    <section class="tpl-sec">
      <h3 class="tpl-h">Uložit tento týden jako šablonu</h3>
      <form class="tpl-save" onSubmit=${save}>
        <input required maxlength="60" placeholder="např. Běžný týden" value=${name} onInput=${(e) => setName(e.target.value)} aria-label="Název šablony" />
        <button class="btn" disabled=${busy}>Uložit šablonu</button>
      </form>
      <p class="muted small">Uloží všechny hodiny, výjezdy a akce z tohoto týdne (po–pá) včetně vyučujících, místností a kapacit.</p>
    </section>
    <${ErrorLine} error=${err} />
  <//>`;
}

// ---------- Správa → Šablony rozvrhu: look inside, rename, delete ----------
export function TemplatesTab() {
  const app = useApp();
  const { maps } = app;
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);
  const [err, setErr] = useState('');
  const load = () => api('GET', '/api/templates').then(setList).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const rename = async (t) => {
    const n = window.prompt('Nový název šablony', t.name);
    if (!n || n.trim() === t.name) return;
    try { await api('PUT', `/api/templates/${t.id}`, { name: n.trim() }); load(); } catch (x) { app.toast(x.message, 'err'); }
  };
  const del = async (t) => {
    if (!await app.confirm({ title: `Smazat šablonu „${t.name}“?`, text: 'Hodiny, které už byly podle ní naplánované, zůstanou v rozvrhu.', confirm: 'Smazat', danger: true })) return;
    try { await api('DELETE', `/api/templates/${t.id}`); load(); } catch (x) { app.toast(x.message, 'err'); }
  };
  return html`<section class="section">
    <div class="section-head"><h2>Šablony rozvrhu <span class="count">${list ? list.length : ''}</span></h2></div>
    <p class="muted">Šablona je uložený týden. V Rozvrhu ji přes tlačítko <b>Šablony…</b> použijete na libovolné týdny – dny volna se vynechají samy, takže v týdnu s prázdninami není nic potřeba mazat. Novou šablonu uložíte tamtéž z naplánovaného týdne.</p>
    <${ErrorLine} error=${err} />
    ${!list ? html`<p class="muted">Načítám…</p>` : list.length === 0 ? html`<${Empty}>Zatím žádné šablony.<//>` : html`
      <div class="tpl-list">${list.map((t) => html`<article class="tpl-card">
        <header>
          <button class="tpl-toggle" aria-expanded=${open === t.id} onClick=${() => setOpen(open === t.id ? null : t.id)}>
            <b>${t.name}</b><span class="muted small">${plural(t.items.length, 'položka', 'položky', 'položek')} · uloženo ${fmtDate(t.created_at.slice(0, 10))}</span>
          </button>
          <span class="tpl-days">${perDay(t.items).map((n, i) => html`<span><i>${DAYS_SHORT[i]}</i>${n}</span>`)}</span>
          <button class="btn btn-ghost btn-s" onClick=${() => rename(t)}>Přejmenovat</button>
          <button class="btn btn-ghost btn-s" onClick=${() => del(t)}>Smazat</button>
        </header>
        ${open === t.id && html`<div class="tpl-week">${[1, 2, 3, 4, 5].map((d) => html`<div>
          <b class="tpl-dn">${DAYS_SHORT[d - 1]}</b>
          ${t.items.filter((it) => it.weekday === d).sort((a, b) => a.start - b.start).map((it) => html`<div class="tpl-it" style=${`--c:${(it.subject_id && maps.subjects[it.subject_id]?.color) || 'var(--cedar)'}`}>
            <span class="mono small">${hm(it.start)}–${hm(it.end)}</span> ${itemTitle(it, maps)}
            <span class="muted small">${maps.users[it.owner_id]?.short || ''}</span>
          </div>`)}
        </div>`)}</div>`}
      </article>`)}</div>`}
  </section>`;
}
