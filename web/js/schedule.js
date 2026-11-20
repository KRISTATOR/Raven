import {
  html, useState, useEffect, useMemo, useCallback, useRef, useApp, api, go, Modal, Field, ErrorLine, ChipToggle, Swatch,
  addDays, mondayOf, today, isoWeek, fmtDay, fmtDate, fmtLong, hm, toMin, timeVal, weekdayOf, nowMin, DAYS, DAYS_SHORT, MONTHS_GEN, parseISO,
  holidayOn, atLeast, inkText, store, persist, TimeInput,
} from './lib.js';

const PPM = 1.45; // pixels per minute
const KIND_LABEL = { lesson: 'Hodina', trip: 'Výjezd', other: 'Jiná akce' };

function layoutDay(evs) {
  const sorted = [...evs].sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  let cluster = [], clusterEnd = -1;
  const flush = () => {
    const lanes = [], laneOf = new Map();
    for (const e of cluster) {
      let i = lanes.findIndex((end) => end <= e.start);
      if (i < 0) { i = lanes.length; lanes.push(e.end); } else lanes[i] = e.end;
      laneOf.set(e, i);
    }
    for (const e of cluster) out.push({ ev: e, lane: laneOf.get(e), lanes: lanes.length });
    cluster = [];
  };
  for (const e of sorted) {
    if (cluster.length && e.start >= clusterEnd) { flush(); clusterEnd = -1; }
    cluster.push(e);
    clusterEnd = Math.max(clusterEnd, e.end);
  }
  if (cluster.length) flush();
  return out;
}

export function eventTitle(ev, maps) {
  const s = ev.subject_id && maps.subjects[ev.subject_id];
  if (ev.kind === 'lesson') return s ? s.name : ev.title || 'Hodina';
  return ev.title || KIND_LABEL[ev.kind];
}
export function eventColor(ev, maps) {
  if (ev.kind === 'lesson') { const s = ev.subject_id && maps.subjects[ev.subject_id]; return s ? s.color : '#B8B2A3'; }
  return null;
}
const teachersOf = (ev) => [ev.owner_id, ...(ev.teacher_ids || [])];

function weekTitle(mon) {
  const fri = addDays(mon, 4);
  const a = parseISO(mon), b = parseISO(fri);
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}.–${b.getDate()}. ${MONTHS_GEN[b.getMonth()]} ${b.getFullYear()}`;
  return `${a.getDate()}. ${MONTHS_GEN[a.getMonth()]} – ${b.getDate()}. ${MONTHS_GEN[b.getMonth()]} ${b.getFullYear()}`;
}

export function SchedulePage({ params }) {
  const app = useApp();
  const { me, maps, settings, boot } = app;
  const week = mondayOf(params.w || today());
  const days = [0, 1, 2, 3, 4].map((i) => addDays(week, i));
  const [data, setData] = useState({ events: [], notes: {} });
  const [loading, setLoading] = useState(true);
  const [filter, setFilterRaw] = useState(() => store('filter', 'all'));
  const [dialog, setDialog] = useState(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [noteDay, setNoteDay] = useState(null);
  const [mDay, setMDay] = useState(() => Math.min(Math.max(weekdayOf(today()), 1), 5) - 1);
  const [, tick] = useState(0);
  const setFilter = (f) => { setFilterRaw(f); persist('filter', f); };

  const load = useCallback(async () => {
    try {
      const d = await api('GET', `/api/events?from=${week}&to=${addDays(week, 4)}`);
      setData(d);
    } catch (e) { app.toast(e.message, 'err'); }
    setLoading(false);
  }, [week]);
  useEffect(() => { setLoading(true); load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) load(); tick((x) => x + 1); }, 60000);
    return () => clearInterval(t);
  }, [load]);

  const visible = useMemo(() => data.events.filter((ev) => {
    if (filter === 'all') return true;
    if (filter === 'mine') return me.role === 'student' || teachersOf(ev).includes(me.id);
    const [k, id] = filter.split(':');
    if (k === 'u') return teachersOf(ev).includes(Number(id));
    if (k === 'r') return ev.room_id === Number(id);
    if (k === 'g') return (ev.group_ids || []).includes(Number(id));
    if (k === 'k') return ev.kind === id;
    return true;
  }), [data, filter, me.id]);

  const starts = visible.map((e) => e.start), ends = visible.map((e) => e.end);
  const gridStart = Math.floor(Math.min(settings.circle_start || settings.day_start, settings.day_start, ...starts) / 30) * 30;
  const gridEnd = Math.ceil(Math.max(settings.day_end, ...ends) / 30) * 30;
  const height = (gridEnd - gridStart) * PPM;
  const marks = [];
  for (let m = gridStart; m <= gridEnd; m += 30) marks.push(m);

  const step = settings.slot_step || 5;
  const readOnly = me.role === 'student';
  const myGroupId = readOnly && boot.students[0] ? boot.students[0].group_id : null;
  const clickDay = (date, e) => {
    if (readOnly) return;
    const hol = holidayOn(boot.holidays, date);
    if (hol && !atLeast(me, 'admin')) { app.toast(`${hol.name} – na volné dny nelze plánovat.`, 'err'); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    let m = gridStart + (e.clientY - rect.top) / PPM;
    m = Math.round(m / step) * step;
    m = Math.max(gridStart, Math.min(m, gridEnd - 30));
    const isTripDay = weekdayOf(date) === settings.trip_weekday;
    setDialog({ preset: { date, start: m, kind: isTripDay && m < settings.lunch_start ? 'trip' : 'lesson' } });
  };

  const tripDayName = settings.trip_weekday ? DAYS[settings.trip_weekday - 1] : '';
  const isThisWeek = week === mondayOf(today());
  const nm = nowMin();

  return html`<div class="schedule">
    <div class="page-head sched-head">
      <div class="page-title-wrap">
        <div class="week-no">Týden ${isoWeek(week)}</div>
        <h1 class="page-title">${weekTitle(week)}</h1>
      </div>
      <div class="sched-nav">
        <button class="btn btn-sq" title="Předchozí týden" onClick=${() => go('rozvrh', { w: addDays(week, -7) })}>←</button>
        <button class=${'btn' + (isThisWeek ? ' btn-on' : '')} onClick=${() => go('rozvrh', {})}>Tento týden</button>
        <button class="btn btn-sq" title="Další týden" onClick=${() => go('rozvrh', { w: addDays(week, 7) })}>→</button>
        <input type="date" class="date-jump" title="Přejít na datum" value=${week} onChange=${(e) => e.target.value && go('rozvrh', { w: mondayOf(e.target.value) })} />
      </div>
    </div>

    <div class="toolbar">
      <label class="filter">
        <span class="field-label">Zobrazit</span>
        <select value=${filter} onChange=${(e) => setFilter(e.target.value)}>
          <option value="all">Celou školu</option>
          ${readOnly ? (myGroupId && html`<option value=${'g:' + myGroupId}>Výjezdy mé skupiny</option>`) : html`<option value="mine">Jen moje</option>`}
          <optgroup label="Typ">
            <option value="k:lesson">Jen hodiny</option>
            <option value="k:trip">Jen výjezdy</option>
          </optgroup>
          <optgroup label="Vyučující">${app.activeUsers.map((u) => html`<option value=${'u:' + u.id}>${u.name}</option>`)}</optgroup>
          ${boot.groups.length > 0 && html`<optgroup label="Tutorská skupina (výjezdy)">${boot.groups.map((g) => html`<option value=${'g:' + g.id}>${g.name}</option>`)}</optgroup>`}
          ${boot.rooms.length > 0 && html`<optgroup label="Místnost">${boot.rooms.map((r) => html`<option value=${'r:' + r.id}>${r.name}</option>`)}</optgroup>`}
        </select>
      </label>
      <div class="toolbar-spacer"></div>
      <button class="btn" onClick=${() => window.print()}>Tisk</button>
      ${!readOnly && html`<button class="btn" onClick=${() => setCopyOpen(true)}>Kopírovat týden…</button>
      <button class="btn btn-primary" onClick=${() => setDialog({ preset: { date: days[Math.min(mDay, 4)], start: settings.day_start, kind: 'lesson' } })}>+ Přidat do rozvrhu</button>`}
    </div>

    <div class="mday-tabs">
      ${days.map((d, i) => html`<button class=${'mday' + (mDay === i ? ' on' : '') + (d === today() ? ' is-today' : '')} onClick=${() => setMDay(i)}>
        <b>${DAYS_SHORT[i]}</b><span>${fmtDay(d)}</span></button>`)}
    </div>

    <div class=${'grid' + (loading ? ' is-loading' : '')} style=${`--ppm:${PPM}px`}>
      <div class="grid-corner"></div>
      ${days.map((d, i) => {
        const hol = holidayOn(boot.holidays, d);
        const trip = weekdayOf(d) === settings.trip_weekday;
        const note = data.notes[d];
        return html`<div class=${'day-head' + (d === today() ? ' is-today' : '') + (mDay === i ? ' m-on' : '')}>
          <div class="day-name"><span>${DAYS[i]}</span><b>${fmtDay(d)}</b></div>
          <div class="day-tags">
            ${trip && !hol && html`<span class="tag tag-trip">Výjezdový den</span>`}
            ${hol && html`<span class="tag tag-hol">${hol.name}</span>`}
          </div>
          ${note && html`<button class="day-note" disabled=${!atLeast(me, 'coordinator')} onClick=${() => setNoteDay(d)}>${note}</button>`}
          ${!note && atLeast(me, 'coordinator') && html`<button class="day-note-add" onClick=${() => setNoteDay(d)}>+ poznámka ke dni</button>`}
        </div>`;
      })}

      <div class="times" style=${`height:${height}px`}>
        ${marks.map((m) => html`<div class=${'tm' + (m % 60 === 0 ? ' tm-h' : '')} style=${`top:${(m - gridStart) * PPM}px`}>${hm(m)}</div>`)}
      </div>
      ${days.map((d, i) => {
        const hol = holidayOn(boot.holidays, d);
        const evs = visible.filter((e) => e.date === d);
        const laid = layoutDay(evs);
        const trip = weekdayOf(d) === settings.trip_weekday;
        return html`<div class=${'day' + (hol ? ' is-hol' : '') + (trip ? ' is-trip' : '') + (mDay === i ? ' m-on' : '')} style=${`height:${height}px`} onClick=${(e) => clickDay(d, e)}>
          ${marks.map((m) => html`<div class=${'line' + (m % 60 === 0 ? ' line-h' : '')} style=${`top:${(m - gridStart) * PPM}px`}></div>`)}
          ${settings.circle_end > settings.circle_start && html`<div class="band band-circle" style=${`top:${(settings.circle_start - gridStart) * PPM}px;height:${(settings.circle_end - settings.circle_start) * PPM}px`}><span>Ranní kruhy</span></div>`}
          ${settings.lunch_end > settings.lunch_start && html`<div class="band band-lunch" style=${`top:${(settings.lunch_start - gridStart) * PPM}px;height:${(settings.lunch_end - settings.lunch_start) * PPM}px`}><span>Oběd</span></div>`}
          ${hol && html`<div class="hol-label"><span>${hol.name}</span></div>`}
          ${laid.map(({ ev, lane, lanes }) => html`<${EventBlock} ev=${ev} lane=${lane} lanes=${lanes} top=${(ev.start - gridStart) * PPM}
              onOpen=${(e) => { e.stopPropagation(); setDialog({ ev }); }} />`)}
          ${isThisWeek && d === today() && nm >= gridStart && nm <= gridEnd && html`<div class="now" style=${`top:${(nm - gridStart) * PPM}px`}><span>${hm(nm)}</span></div>`}
        </div>`;
      })}
    </div>
    <p class="grid-hint">${readOnly ? '' : 'Klikněte do prázdného místa v rozvrhu a přidáte hodinu na daný čas. '}${tripDayName ? `Výjezdový den: ${tripDayName}.` : ''}</p>

    ${dialog && html`<${EventDialog} ev=${dialog.ev} preset=${dialog.preset} onClose=${() => setDialog(null)} onSaved=${() => { setDialog(null); load(); }} />`}
    ${copyOpen && html`<${CopyWeekDialog} week=${week} onClose=${() => setCopyOpen(false)} onDone=${(target) => { setCopyOpen(false); go('rozvrh', { w: target }); }} />`}
    ${noteDay && html`<${DayNoteDialog} date=${noteDay} text=${data.notes[noteDay] || ''} onClose=${() => setNoteDay(null)} onSaved=${() => { setNoteDay(null); load(); }} />`}
  </div>`;
}

function EventBlock({ ev, lane, lanes, top, onOpen }) {
  const { maps, me } = useApp();
  const color = eventColor(ev, maps);
  const h = Math.max((ev.end - ev.start) * PPM - 3, 18);
  const style = `top:${top + 1}px;height:${h}px;left:calc(${(lane / lanes) * 100}% + 3px);width:calc(${100 / lanes}% - 6px);` +
    (color ? `--ev:${color};--ev-text:${inkText(color)};` : '');
  const owners = teachersOf(ev).map((id) => maps.users[id]).filter(Boolean);
  const room = ev.room_id && maps.rooms[ev.room_id];
  const groups = (ev.group_ids || []).map((id) => maps.groups[id]).filter(Boolean);
  const mine = teachersOf(ev).includes(me.id);
  const compact = h < 40;
  const roomy = h >= 66;
  return html`<button class=${`ev ev-${ev.kind}` + (mine ? ' is-mine' : '') + (compact ? ' is-compact' : '')} style=${style} onClick=${onOpen}
      title=${`${eventTitle(ev, maps)} · ${hm(ev.start)}–${hm(ev.end)}`}>
    <span class="ev-time">${hm(ev.start)}–${hm(ev.end)}</span>
    <span class="ev-title">${eventTitle(ev, maps)}</span>
    ${roomy && ev.kind === 'lesson' && ev.title && html`<span class="ev-topic">${ev.title}</span>`}
    ${!compact && html`<span class="ev-meta">${owners.map((u) => u.short || u.name).join(', ')}${room ? ' · ' + room.name : ''}${ev.capacity ? ' · max ' + ev.capacity : ''}</span>`}
    ${roomy && groups.length > 0 && html`<span class="ev-groups">${groups.map((g) => html`<span class="ev-g" style=${`background:${g.color}`}></span>`)}${groups.map((g) => g.name).join(', ')}</span>`}
  </button>`;
}

function DayNoteDialog({ date, text, onClose, onSaved }) {
  const { toast } = useApp();
  const [t, setT] = useState(text);
  const save = async (val) => {
    try { await api('PUT', `/api/daynotes/${date}`, { text: val }); onSaved(); } catch (e) { toast(e.message, 'err'); }
  };
  return html`<${Modal} title="Poznámka ke dni" kicker=${fmtLong(date)} onClose=${onClose}>
    <${Field} label="Text" hint="Zobrazí se všem v hlavičce dne, např. „Focení tříd 10:30“ nebo „Po obědě volno“." wide>
      <input value=${t} maxlength="120" onInput=${(e) => setT(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && save(t)} />
    <//>
    <div class="form-actions">
      ${text && html`<button class="btn btn-danger" onClick=${() => save('')}>Odstranit</button>`}
      <div class="spacer"></div>
      <button class="btn" onClick=${onClose}>Zrušit</button>
      <button class="btn btn-primary" onClick=${() => save(t)}>Uložit</button>
    </div>
  <//>`;
}

function CopyWeekDialog({ week, onClose, onDone }) {
  const { me, toast } = useApp();
  const [target, setTarget] = useState(addDays(week, 7));
  const [scope, setScope] = useState('mine');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const tMon = mondayOf(target);
  const submit = async () => {
    if (tMon === week) return setErr('Vyberte jiný týden, než ze kterého kopírujete.');
    setBusy(true);
    try {
      const r = await api('POST', '/api/events/copy-week', { from: week, to: tMon, scope });
      toast(`Zkopírováno: ${r.created}${r.skipped ? `, přeskočeno ${r.skipped} (volno nebo už existuje)` : ''}.`);
      onDone(tMon);
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  return html`<${Modal} title="Kopírovat týden" kicker=${'z týdne ' + weekTitle(week)} onClose=${onClose}>
    <div class="form-grid">
      <${Field} label="Do týdne" hint=${'Týden ' + isoWeek(tMon) + ': ' + weekTitle(tMon)} wide>
        <input type="date" value=${target} onChange=${(e) => e.target.value && setTarget(e.target.value)} />
      <//>
      <div class="field field-wide">
        <span class="field-label">Co kopírovat</span>
        <label class="radio"><input type="radio" checked=${scope === 'mine'} onChange=${() => setScope('mine')} /> Jen moje hodiny a akce</label>
        ${atLeast(me, 'coordinator') && html`<label class="radio"><input type="radio" checked=${scope === 'all'} onChange=${() => setScope('all')} /> Celý rozvrh školy</label>`}
      </div>
      <p class="muted field-wide">Nic se nemaže. Volné dny a položky, které v cílovém týdnu už jsou, se přeskočí.</p>
      <${ErrorLine} error=${err} />
      <div class="form-actions"><button class="btn" onClick=${onClose}>Zrušit</button><button class="btn btn-primary" disabled=${busy} onClick=${submit}>Kopírovat</button></div>
    </div>
  <//>`;
}

function EventDetail({ ev, onClose }) {
  const { maps, me } = useApp();
  const owner = maps.users[ev.owner_id];
  const extra = (ev.teacher_ids || []).map((id) => maps.users[id]).filter(Boolean);
  const room = ev.room_id && maps.rooms[ev.room_id];
  const groups = (ev.group_ids || []).map((id) => maps.groups[id]).filter(Boolean);
  const color = eventColor(ev, maps);
  return html`<${Modal} title=${eventTitle(ev, maps)} kicker=${KIND_LABEL[ev.kind] + ' · ' + fmtLong(ev.date) + ' · ' + hm(ev.start) + '–' + hm(ev.end)} onClose=${onClose}>
    ${color && html`<div class="detail-ink" style=${`background:${color}`}></div>`}
    <dl class="detail">
      ${ev.kind === 'lesson' && ev.title && html`<dt>Téma</dt><dd>${ev.title}</dd>`}
      <dt>${ev.kind === 'trip' ? 'Vede' : 'Vyučuje'}</dt><dd>${owner ? owner.name : '—'}</dd>
      ${extra.length > 0 && html`<dt>${ev.kind === 'trip' ? 'Doprovod' : 'Spolu s'}</dt><dd>${extra.map((u) => u.name).join(', ')}</dd>`}
      ${room && html`<dt>Místnost</dt><dd>${room.name}</dd>`}
      ${groups.length > 0 && html`<dt>Skupiny</dt><dd>${groups.map((g) => g.name).join(', ')}</dd>`}
      ${ev.capacity && html`<dt>Kapacita</dt><dd>${ev.capacity} žáků</dd>`}
      ${ev.note && html`<dt>Poznámka</dt><dd class="pre">${ev.note}</dd>`}
      ${ev.series_id && html`<dt>Opakování</dt><dd>Součást týdenní řady</dd>`}
    </dl>
    ${me.role !== 'student' && html`<p class="muted">Upravit může jen ${owner ? owner.name : 'vyučující'}, koordinátor nebo správce.</p>`}
  <//>`;
}

function EventDialog(props) {
  const { me } = useApp();
  const { ev } = props;
  const canEdit = !ev || atLeast(me, 'coordinator') || ev.owner_id === me.id;
  if (!canEdit) return html`<${EventDetail} ev=${ev} onClose=${props.onClose} />`;
  return html`<${EventForm} ...${props} />`;
}

function EventForm({ ev, preset, onClose, onSaved }) {
  const app = useApp();
  const { me, settings, boot, maps } = app;

  const isAdmin = atLeast(me, 'admin');
  const isCoord = atLeast(me, 'coordinator');
  const lengths = settings.lesson_lengths;
  const initLen = ev ? ev.end - ev.start : (lengths.includes(45) ? 45 : lengths[0]);
  const [f, setF] = useState(() => ev ? {
    kind: ev.kind, date: ev.date, start: ev.start, len: ev.end - ev.start, end: ev.end,
    subject_id: ev.subject_id || '', title: ev.title, room_id: ev.room_id || '', owner_id: ev.owner_id,
    teacher_ids: ev.teacher_ids || [], group_ids: ev.group_ids || [], capacity: ev.capacity || '', note: ev.note,
    repeat: false, repeat_until: '',
  } : {
    kind: preset.kind || 'lesson', date: preset.date, start: preset.start, len: initLen,
    end: Math.min(preset.start + 120, settings.day_end), subject_id: '', title: '', room_id: '', owner_id: me.id,
    teacher_ids: [], group_ids: [], capacity: '', note: '', repeat: false, repeat_until: addDays(preset.date, 28),
  });
  const [customLen, setCustomLen] = useState(() => ev && ev.kind === 'lesson' && !lengths.includes(ev.end - ev.start));
  const [scope, setScope] = useState('one');
  const [err, setErr] = useState('');
  const [conflicts, setConflicts] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const isLesson = f.kind === 'lesson';
  const end = isLesson ? f.start + Number(f.len) : f.end;
  const hol = holidayOn(boot.holidays, f.date);
  const lenOptions = [...new Set([...lengths, ...(ev && isLesson ? [ev.end - ev.start] : [])])].sort((a, b) => a - b);

  const payload = (force) => ({
    kind: f.kind, date: f.date, start: Number(f.start), end: Number(end),
    subject_id: isLesson && f.subject_id ? Number(f.subject_id) : null,
    title: f.title, room_id: f.room_id ? Number(f.room_id) : null, owner_id: Number(f.owner_id),
    teacher_ids: f.teacher_ids, group_ids: f.group_ids,
    capacity: f.capacity ? Number(f.capacity) : null, note: f.note,
    repeat_until: !ev && f.repeat ? f.repeat_until : '', force,
  });

  const save = async (force = false) => {
    setErr(''); setBusy(true);
    try {
      let r;
      if (ev) r = await api('PUT', `/api/events/${ev.id}?scope=${scope}`, payload(force));
      else r = await api('POST', '/api/events', payload(force));
      if (!ev && r.created > 1) app.toast(`Přidáno ${r.created}× (každý týden)${r.skipped?.length ? `, vynecháno ${r.skipped.length}× kvůli volnu` : ''}.`);
      else app.toast(ev ? 'Uloženo.' : 'Přidáno do rozvrhu.');
      onSaved();
    } catch (e) {
      setBusy(false);
      if (e.status === 409 && e.data && e.data.conflicts) { setConflicts(e.data.conflicts); return; }
      setErr(e.message);
    }
  };

  const remove = async () => {
    let sc = 'one';
    if (ev.series_id) {
      const v = await app.confirm({ title: 'Smazat opakovanou hodinu?', text: 'Tato hodina je součástí týdenní řady.',
        choices: [{ value: 'one', label: 'Jen tuto', danger: true }, { value: 'following', label: 'Tuto a všechny další', danger: true }] });
      if (!v) return;
      sc = v;
    } else {
      const ok = await app.confirm({ title: 'Smazat z rozvrhu?', text: `${eventTitle(ev, maps)}, ${fmtLong(ev.date)} ${hm(ev.start)}–${hm(ev.end)}. Koordinátor ji případně může obnovit v historii.`, confirm: 'Smazat', danger: true });
      if (!ok) return;
    }
    try {
      const r = await api('DELETE', `/api/events/${ev.id}?scope=${sc}`);
      app.toast(r.deleted > 1 ? `Smazáno ${r.deleted}×.` : 'Smazáno.');
      onSaved();
    } catch (e) { setErr(e.message); }
  };

  const others = app.activeUsers.filter((u) => u.id !== Number(f.owner_id));
  const title = ev ? 'Upravit' : 'Přidat do rozvrhu';

  return html`<${Modal} title=${title} kicker=${fmtLong(f.date)} onClose=${onClose} wide>
    <div class="seg">
      ${['lesson', 'trip', 'other'].map((k) => html`<button type="button" class=${'seg-b' + (f.kind === k ? ' on' : '')} onClick=${() => set('kind', k)}>${KIND_LABEL[k]}</button>`)}
    </div>
    ${hol && html`<div class="warn-line">${fmtDate(f.date)} je volno: ${hol.name}.${isAdmin ? ' Jako správce můžete přesto plánovat.' : ''}</div>`}
    <form class="form-grid" onSubmit=${(e) => { e.preventDefault(); save(false); }}>
      ${isLesson && html`
        <${Field} label="Předmět" half>
          <select value=${f.subject_id} onChange=${(e) => set('subject_id', e.target.value)}>
            <option value="">— vyberte —</option>
            ${boot.subjects.map((s) => html`<option value=${s.id}>${s.name}</option>`)}
          </select>
        <//>
        <${Field} label="Téma / název" hint="nepovinné" half><input value=${f.title} onInput=${(e) => set('title', e.target.value)} placeholder="např. Lineární rovnice" /><//>`}
      ${!isLesson && html`<${Field} label=${f.kind === 'trip' ? 'Cíl výjezdu' : 'Název akce'} wide>
        <input value=${f.title} onInput=${(e) => set('title', e.target.value)} placeholder=${f.kind === 'trip' ? 'např. Školní farma, Národní galerie…' : 'např. Projektový den'} required />
      <//>`}

      <${Field} label="Datum" half><input type="date" required value=${f.date} onChange=${(e) => e.target.value && set('date', e.target.value)} /><//>
      <${Field} label=${f.kind === 'trip' ? 'Odjezd' : 'Začátek'} half><${TimeInput} required value=${f.start} onChange=${(v) => v != null && set('start', v)} /><//>
      ${isLesson && !customLen && html`<${Field} label="Délka" hint=${'konec v ' + hm(end)} half>
        <select value=${f.len} onChange=${(e) => { if (e.target.value === 'custom') setCustomLen(true); else set('len', Number(e.target.value)); }}>
          ${lenOptions.map((l) => html`<option value=${l}>${l} min${l >= 90 ? ` (${Math.floor(l / 60)} h ${l % 60 ? (l % 60) + ' min' : ''})` : ''}</option>`)}
          ${isAdmin && html`<option value="custom">Vlastní konec…</option>`}
        </select>
      <//>`}
      ${isLesson && customLen && html`<${Field} label="Konec" hint=${(end - f.start) + ' min (mimo povolené délky)'} half>
        <${TimeInput} value=${end} onChange=${(v) => v != null && set('len', v - f.start)} />
      <//>`}
      ${!isLesson && html`<${Field} label=${f.kind === 'trip' ? 'Návrat' : 'Konec'} half>
        <${TimeInput} value=${f.end} onChange=${(v) => v != null && set('end', v)} />
        ${f.kind === 'trip' && html`<span class="quick">
          <button type="button" onClick=${() => set('end', settings.lunch_start)}>k obědu (${hm(settings.lunch_start)})</button>
          <button type="button" onClick=${() => set('end', settings.day_end)}>do konce dne (${hm(settings.day_end)})</button>
        </span>`}
      <//>`}

      <${Field} label=${f.kind === 'trip' ? 'Vede' : 'Vyučující'} half>
        ${isCoord
          ? html`<select value=${f.owner_id} onChange=${(e) => set('owner_id', Number(e.target.value))}>${app.activeUsers.map((u) => html`<option value=${u.id}>${u.name}</option>`)}</select>`
          : html`<input value=${maps.users[f.owner_id]?.name || me.name} disabled />`}
      <//>
      ${f.kind !== 'trip' && html`<${Field} label="Místnost" half>
        <select value=${f.room_id} onChange=${(e) => set('room_id', e.target.value)}>
          <option value="">—</option>${boot.rooms.map((r) => html`<option value=${r.id}>${r.name}</option>`)}
        </select>
      <//>`}
      ${f.kind === 'trip' && html`<div class="field field-wide">
        <span class="field-label">Jedou tutorské skupiny</span>
        <${ChipToggle} items=${boot.groups} value=${f.group_ids} onChange=${(v) => set('group_ids', v)}
          render=${(g) => html`<${Swatch} color=${g.color} />${g.name}`} />
      </div>`}
      <div class="field field-wide">
        <span class="field-label">${f.kind === 'trip' ? 'Doprovod' : 'Další vyučující'} <em>nepovinné</em></span>
        <${ChipToggle} items=${others} value=${f.teacher_ids.filter((id) => id !== Number(f.owner_id))} onChange=${(v) => set('teacher_ids', v)}
          render=${(u) => u.short || u.name} />
      </div>
      ${isLesson && html`<${Field} label="Kapacita" hint="max. počet žáků, nepovinné" half><input type="number" min="1" max="200" value=${f.capacity} onInput=${(e) => set('capacity', e.target.value)} /><//>`}
      <${Field} label="Poznámka" wide><textarea rows="2" value=${f.note} onInput=${(e) => set('note', e.target.value)} placeholder=${f.kind === 'trip' ? 'Sraz, co s sebou, oběd…' : ''}></textarea><//>

      ${!ev && html`<div class="field field-wide repeat">
        <label class="check"><input type="checkbox" checked=${f.repeat} onChange=${(e) => set('repeat', e.target.checked)} /> Opakovat každý týden</label>
        ${f.repeat && html`<span class="repeat-until">do <input type="date" value=${f.repeat_until} min=${f.date} onChange=${(e) => set('repeat_until', e.target.value)} /> <em>volné dny se vynechají</em></span>`}
      </div>`}
      ${ev && ev.series_id && html`<div class="field field-wide">
        <span class="field-label">Změnu použít pro</span>
        <label class="radio"><input type="radio" checked=${scope === 'one'} onChange=${() => setScope('one')} /> jen tuto hodinu</label>
        <label class="radio"><input type="radio" checked=${scope === 'following'} onChange=${() => setScope('following')} /> tuto a všechny další v řadě</label>
      </div>`}

      ${conflicts && html`<div class="conflicts field-wide">
        <b>Pozor, kolize v rozvrhu:</b>
        <ul>${conflicts.map((c) => html`<li><span class="mono">${hm(c.start)}–${hm(c.end)}</span> ${c.label} <em>(${c.reason})</em></li>`)}</ul>
        <div class="form-actions"><button type="button" class="btn" onClick=${() => setConflicts(null)}>Upravit</button><button type="button" class="btn btn-primary" onClick=${() => save(true)}>Uložit i přesto</button></div>
      </div>`}
      <${ErrorLine} error=${err} />
      ${!conflicts && html`<div class="form-actions">
        ${ev && html`<button type="button" class="btn btn-danger" onClick=${remove}>Smazat</button>`}
        <div class="spacer"></div>
        <button type="button" class="btn" onClick=${onClose}>Zrušit</button>
        <button class="btn btn-primary" disabled=${busy}>${ev ? 'Uložit změny' : 'Přidat'}</button>
      </div>`}
    </form>
  <//>`;
}
