import {
  html, useState, useEffect, useMemo, useCallback, useRef, useApp, api, go, Mark,
  addDays, mondayOf, schoolWeek, today, nowMin, hm, fmtDay, isoWeek, weekdayOf, DAYS, DAYS_SHORT, holidayOn, store, persist, ROLE_LABEL,
} from './lib.js';
import { eventTitle, eventColor, EventDetail, fmtMinutes, breaches } from './schedule.js';

// The phone layout for pupils: a slim top bar, tabs at the bottom, and a timetable
// that shows one day at a time as a list. Teachers keep the computer layout.

export function useIsPhone() {
  const q = '(max-width: 760px)';
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener ? mq.addEventListener('change', on) : mq.addListener(on);
    return () => (mq.removeEventListener ? mq.removeEventListener('change', on) : mq.removeListener(on));
  }, []);
  return m;
}

const ICONS = {
  rozvrh: html`<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>`,
  rozlozeni: html`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5V12l6 6"/></svg>`,
  'moje-cile': html`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" class="fill"/></svg>`,
  asistent: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h16v10H9l-5 4z"/></svg>`,
};
export const PHONE_TABS = [['rozvrh', 'Rozvrh'], ['rozlozeni', 'Hodiny'], ['moje-cile', 'Cíle'], ['asistent', 'Asistent']];

export function PhoneShell({ route, page, onMenu, menu }) {
  const { me, boot } = useApp();
  const active = PHONE_TABS.some(([p]) => p === route.path) ? route.path : (route.path === 'aplikace' || route.path === 'o-nazvu' ? '' : 'rozvrh');
  return html`<div class="pshell">
    <header class="ptop">
      <a class="ptop-brand" href="#/rozvrh" aria-label="Raven – rozvrh"><${Mark} /><span>Raven</span></a>
      <button class="ptop-me" onClick=${onMenu} aria-expanded=${menu} aria-label="Můj účet">${me.short || me.name.slice(0, 2).toUpperCase()}</button>
    </header>
    <main class="pmain">${page}</main>
    <nav class="ptabs" aria-label="Hlavní nabídka">
      ${PHONE_TABS.map(([p, label]) => html`<a href=${'#/' + p} class=${'ptab' + (active === p ? ' on' : '')} aria-current=${active === p ? 'page' : null}>
        ${ICONS[p]}<span>${label}</span></a>`)}
    </nav>
  </div>`;
}

// ---------- timetable, one day at a time ----------
export function PhoneSchedule({ params }) {
  const app = useApp();
  const { boot, maps, settings } = app;
  const week = params.w ? mondayOf(params.w) : schoolWeek();
  const days = [0, 1, 2, 3, 4].map((i) => addDays(week, i));
  const [data, setData] = useState(null);
  const [day, setDay] = useState(() => (days.includes(today()) ? today() : days[0]));
  const [onlyMine, setOnlyMineRaw] = useState(() => store('onlyMine', false));
  const setOnlyMine = (v) => { setOnlyMineRaw(v); persist('onlyMine', v); };
  const [open, setOpen] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const myGroup = boot.students[0] ? boot.students[0].group_id : null;

  useEffect(() => { setDay(days.includes(today()) ? today() : days[0]); }, [week]);
  const load = useCallback(async () => {
    try { setData(await api('GET', `/api/events?from=${week}&to=${addDays(week, 4)}`)); } catch (e) { app.toast(e.message, 'err'); }
  }, [week]);
  useEffect(() => { setData(null); load(); }, [load]);
  useEffect(() => {
    const back = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', back);
    addEventListener('raven:resume', back);
    return () => { document.removeEventListener('visibilitychange', back); removeEventListener('raven:resume', back); };
  }, [load]);
  useEffect(() => {
    if (!boot.students.length) return;
    api('GET', `/api/student/load?week=${week}`, undefined, { quiet: true }).then((d) => setAlerts(breaches(d, maps))).catch(() => setAlerts([]));
  }, [week, data]);

  const mine = (ev) => ev.signed || (ev.kind === 'trip' && myGroup && (ev.group_ids || []).includes(myGroup));
  const all = data ? data.events : [];
  const shown = all.filter((e) => e.date === day && (!onlyMine || mine(e))).sort((a, b) => a.start - b.start || a.end - b.end);
  const myWeek = all.filter(mine);
  const hol = holidayOn(boot.holidays, day);
  const note = data && data.notes[day];
  const isTripDay = weekdayOf(day) === settings.trip_weekday;

  // swipe left/right to change the day
  const touch = useRef(null);
  const onTouchStart = (e) => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY }; };
  const onTouchEnd = (e) => {
    if (!touch.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.current.x, dy = t.clientY - touch.current.y;
    touch.current = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const i = days.indexOf(day);
    if (dx < 0) { if (i < 4) setDay(days[i + 1]); else go('rozvrh', { w: addDays(week, 7) }); }
    else { if (i > 0) setDay(days[i - 1]); else go('rozvrh', { w: addDays(week, -7) }); }
  };

  const fri = addDays(week, 4);
  const range = `${fmtDay(week)}–${fmtDay(fri)}`;
  return html`<div class="psched" onTouchStart=${onTouchStart} onTouchEnd=${onTouchEnd}>
    <div class="pweek">
      <button class="pnav" aria-label="Předchozí týden" onClick=${() => go('rozvrh', { w: addDays(week, -7) })}>‹</button>
      <button class="pweek-title" onClick=${() => go('rozvrh', {})} title="Zpět na tento týden">
        <b>Týden ${isoWeek(week)}</b><span>${range}${week !== schoolWeek() ? ' · zpět na dnešek' : ''}</span>
      </button>
      <button class="pnav" aria-label="Další týden" onClick=${() => go('rozvrh', { w: addDays(week, 7) })}>›</button>
    </div>

    <div class="pdays" role="tablist" aria-label="Den v týdnu">
      ${days.map((d, i) => {
        const n = all.filter((e) => e.date === d && mine(e)).length;
        return html`<button role="tab" aria-selected=${d === day} class=${'pday' + (d === day ? ' on' : '') + (d === today() ? ' is-today' : '') + (holidayOn(boot.holidays, d) ? ' is-hol' : '')} onClick=${() => setDay(d)}>
          <span class="pday-n">${DAYS_SHORT[i]}</span><span class="pday-d">${Number(d.slice(8))}.</span>
          <i class=${'pday-dot' + (n ? ' on' : '')} aria-label=${n ? `${n} přihlášených` : ''}></i>
        </button>`;
      })}
    </div>

    <div class="pfilter" role="group" aria-label="Které hodiny zobrazit">
      <button class=${!onlyMine ? 'on' : ''} aria-pressed=${!onlyMine} onClick=${() => setOnlyMine(false)}>Všechny hodiny</button>
      <button class=${onlyMine ? 'on' : ''} aria-pressed=${onlyMine} onClick=${() => setOnlyMine(true)}>Kam jdu <span class="pcount">${myWeek.length}</span></button>
    </div>

    ${alerts.length > 0 && html`<a class="palert" href=${'#/rozlozeni?w=' + week}><span aria-hidden="true">!</span>${alerts.length === 1 ? `${alerts[0].kind === 'low' ? 'Málo' : 'Moc'}: ${alerts[0].name}` : `${alerts.length} upozornění k hodinám`}<em>›</em></a>`}

    <h2 class="pday-title">${DAYS[weekdayOf(day) - 1]} ${fmtDay(day)}${day === today() ? html` <span class="ptag">dnes</span>` : ''}${isTripDay && !hol ? html` <span class="ptag ptag-trip">výjezdový den</span>` : ''}</h2>
    ${note && html`<p class="pnote">${note}</p>`}

    ${!data ? html`<p class="pempty">Načítám…</p>`
      : hol ? html`<div class="phol"><b>${hol.name}</b><span>Volno – žádné hodiny.</span></div>`
      : shown.length === 0 ? html`<div class="pempty">${onlyMine
          ? html`<p>Na tento den nejsi přihlášený na žádnou hodinu.</p><button class="btn" onClick=${() => setOnlyMine(false)}>Ukázat všechny hodiny</button>`
          : html`<p>Na tento den nejsou v rozvrhu žádné hodiny.</p>`}</div>`
      : html`<ul class="plist">${shown.map((ev) => html`<li><${ClassCard} ev=${ev} now=${day === today()} onOpen=${() => setOpen(ev)} /></li>`)}</ul>`}

    ${!onlyMine && data && shown.length > 0 && html`<p class="phint">Klepni na hodinu a přihlas se. Přejetím prstem do stran změníš den.</p>`}
    ${open && html`<${EventDetail} ev=${open} onClose=${() => { setOpen(null); load(); }} onRefresh=${load} />`}
  </div>`;
}

function ClassCard({ ev, now, onOpen }) {
  const { maps } = useApp();
  const color = eventColor(ev, maps) || 'var(--cedar)';
  const s = ev.subject_id && maps.subjects[ev.subject_id];
  const room = ev.room_id && maps.rooms[ev.room_id];
  const owner = maps.users[ev.owner_id];
  const full = ev.capacity && ev.signups >= ev.capacity;
  const nm = nowMin();
  const live = now && nm >= ev.start && nm < ev.end;
  const past = now && nm >= ev.end;
  let status = null;
  if (ev.kind === 'trip') status = html`<span class="pstat pstat-trip">výjezd</span>`;
  else if (ev.signed) status = html`<span class="pstat pstat-on">✓ jdu</span>`;
  else if (full) status = html`<span class="pstat pstat-full">plno</span>`;
  else if (ev.capacity) status = html`<span class="pstat">${ev.capacity - ev.signups} volných</span>`;
  return html`<button class=${'pcard' + (ev.signed ? ' is-on' : '') + (live ? ' is-live' : '') + (past ? ' is-past' : '')} style=${`--c:${color}`} onClick=${onOpen}>
    <span class="pcard-time"><b>${hm(ev.start)}</b><span>${hm(ev.end)}</span></span>
    <span class="pcard-body">
      <b class="pcard-title">${eventTitle(ev, maps)}</b>
      <span class="pcard-meta">${[s && ev.title ? s.name : '', room && room.name, owner && (owner.short || owner.name)].filter(Boolean).join(' · ')}</span>
      ${live && html`<span class="pcard-live">právě probíhá</span>`}
    </span>
    ${status}
  </button>`;
}
