import {
  html, useApp, api, useAsync, Empty, Swatch,
  today, addDays, weekdayOf, fmtLong, fmtDayW, fmtDate, hm, relDay, holidayOn, studentName, studentNameRev, cmpCz, atLeast, inkText,
} from './lib.js';
import { eventTitle, eventColor } from './schedule.js';
import { CONS_KIND } from './consultations.js';
import { GOAL_STATUS } from './goals.js';

function nextSchoolDay(boot, from) {
  let d = addDays(from, 1);
  for (let i = 0; i < 14; i++) {
    if (weekdayOf(d) <= 5 && !holidayOn(boot.holidays, d)) return d;
    d = addDays(d, 1);
  }
  return addDays(from, 1);
}

export function Dashboard() {
  const app = useApp();
  const { me, boot, maps, settings } = app;
  const t = today();
  const next = nextSchoolDay(boot, t);
  const [evState] = useAsync(() => api('GET', `/api/events?from=${t}&to=${next}`), []);
  const [consState] = useAsync(() => api('GET', '/api/consultations'), []);
  const [goalState] = useAsync(() => api('GET', '/api/goals?status=active'), []);

  const mine = (ev) => ev.owner_id === me.id || (ev.teacher_ids || []).includes(me.id);
  const evs = (evState.data?.events || []).filter(mine);
  const notes = evState.data?.notes || {};
  const holToday = holidayOn(boot.holidays, t);

  const cons = consState.data || [];
  const myCons = cons.filter((c) => c.teacher_id === me.id || app.tutorOf(c.student_id) === me.id);
  const upcoming = myCons.filter((c) => c.status === 'planned' && c.date >= t && c.date <= addDays(t, 14)).sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? 0) - (b.start ?? 0));
  const toWrite = myCons.filter((c) => c.status === 'planned' && c.date < t);
  const followUps = myCons.filter((c) => c.status === 'done' && c.follow_up && c.follow_up <= addDays(t, 7) && c.follow_up >= addDays(t, -14));

  const goals = (goalState.data || []).filter((g) => g.can_manage);
  const review = goals.filter((g) => g.review_date && g.review_date <= addDays(t, 14)).sort((a, b) => a.review_date.localeCompare(b.review_date));

  const nextHol = boot.holidays.find((h) => h.date_from > t);

  const DayList = ({ date, label }) => {
    const list = evs.filter((e) => e.date === date).sort((a, b) => a.start - b.start);
    const hol = holidayOn(boot.holidays, date);
    return html`<div class="agenda">
      <div class="agenda-head"><b>${label}</b> <span>${fmtLong(date)}</span>${weekdayOf(date) === settings.trip_weekday && !hol && html` <span class="tag tag-trip">Výjezdový den</span>`}</div>
      ${notes[date] && html`<div class="day-note static">${notes[date]}</div>`}
      ${hol ? html`<div class="muted pad">Volno – ${hol.name}</div>`
        : list.length === 0 ? html`<div class="muted pad">V rozvrhu nemáte nic.</div>`
        : html`<ol class="agenda-list">${list.map((e) => {
          const c = eventColor(e, maps);
          const room = e.room_id && maps.rooms[e.room_id];
          const groups = (e.group_ids || []).map((id) => maps.groups[id]?.name).filter(Boolean);
          return html`<li class=${'agenda-item ag-' + e.kind}>
            <span class="ag-time mono">${hm(e.start)}<br /><span class="muted">${hm(e.end)}</span></span>
            <span class="ag-bar" style=${c ? `background:${c}` : ''}></span>
            <span class="ag-body"><span><b>${eventTitle(e, maps)}</b>${e.kind === 'lesson' && e.title && e.subject_id && maps.subjects[e.subject_id] ? html` <span class="muted">· ${maps.subjects[e.subject_id].name}</span>` : ''}</span>
              <span class="muted small">${[room?.name, groups.join(', '), e.owner_id !== me.id ? 'vede ' + maps.users[e.owner_id]?.name : ''].filter(Boolean).join(' · ')}</span></span>
          </li>`;
        })}</ol>`}
    </div>`;
  };

  return html`<div class="page dash">
    <div class="dash-head">
      <div>
        <div class="kicker">${me.name}</div>
        <h1 class="page-title">${fmtLong(t).replace(/^./, (c) => c.toUpperCase())}</h1>
      </div>
      <div class="dash-facts">
        ${nextHol && html`<div><span class="field-label">Nejbližší volno</span><b>${nextHol.name}</b><span class="mono small">${fmtDate(nextHol.date_from)} · ${relDay(nextHol.date_from)}</span></div>`}
      </div>
    </div>
    ${holToday && html`<div class="banner">Dnes je volno: <b>${holToday.name}</b></div>`}

    <div class="dash-grid">
      <section class="section dash-today">
        <div class="section-head"><h2>Můj rozvrh</h2><div class="section-aside"><a href="#/rozvrh">celý týden →</a></div></div>
        <${DayList} date=${t} label="Dnes" />
        <${DayList} date=${next} label=${next === addDays(t, 1) ? 'Zítra' : 'Příště'} />
      </section>

      <section class="section">
        <div class="section-head"><h2>Konzultace</h2><div class="section-aside"><a href="#/konzultace">všechny →</a></div></div>
        ${toWrite.length > 0 && html`<div class="callout"><b>${toWrite.length}× čeká na zápis</b> – proběhlé schůzky stále vedené jako plánované.
          <a href="#/konzultace">Doplnit</a></div>`}
        ${upcoming.length === 0 ? html`<${Empty}>Na příští dva týdny nic naplánováno.<//>` : html`<ul class="mini-list">
          ${upcoming.map((c) => html`<li>
            <span class="mono small nowrap">${fmtDayW(c.date)}${c.start != null ? html`<br /><span class="muted">${hm(c.start)}</span>` : ''}</span>
            <span><b>${studentName(maps.students[c.student_id]) !== '—' ? studentName(maps.students[c.student_id]) : c.topic}</b><br />
              <span class="muted small">${CONS_KIND[c.kind]}${c.topic ? ' · ' + c.topic : ''}</span></span>
          </li>`)}
        </ul>`}
        ${followUps.length > 0 && html`<h3 class="subhead">Kontrola dohod</h3><ul class="mini-list">
          ${followUps.map((c) => html`<li><span class="mono small nowrap">${fmtDayW(c.follow_up)}</span><span>${studentName(maps.students[c.student_id])}<br /><span class="muted small">${c.agreements || c.topic}</span></span></li>`)}
        </ul>`}
      </section>

      <section class="section">
        <div class="section-head"><h2>Cíle k revizi</h2><div class="section-aside"><a href="#/cile">osobní cíle →</a></div></div>
        ${review.length === 0 ? html`<${Empty}>V nejbližších dvou týdnech žádná revize.<//>` : html`<ul class="mini-list">
          ${review.map((g) => html`<li><span class=${'mono small nowrap' + (g.review_date <= t ? ' overdue' : '')}>${fmtDayW(g.review_date)}</span>
            <span><a href=${'#/cile?student=' + g.student_id}><b>${studentName(maps.students[g.student_id])}</b></a><br /><span class="muted small">${g.title}</span></span></li>`)}
        </ul>`}
      </section>

      ${app.myGroups.map((g) => {
        const members = boot.students.filter((s) => s.group_id === g.id).sort((a, b) => a.grade - b.grade || cmpCz(studentNameRev(a), studentNameRev(b)));
        const goalCount = {};
        (goalState.data || []).forEach((x) => { goalCount[x.student_id] = (goalCount[x.student_id] || 0) + 1; });
        return html`<section class="section dash-group">
          <div class="section-head"><h2><${Swatch} color=${g.color} /> Moje skupina ${g.name} <span class="count">${members.length}</span></h2></div>
          <ul class="group-roster">${members.map((s) => html`<li><a href=${'#/cile?student=' + s.id}>
            <span>${studentNameRev(s)}</span><span class="muted">${s.grade}.</span>
            <span class="roster-goals" title="probíhající cíle">${goalCount[s.id] || '–'}</span></a></li>`)}</ul>
        </section>`;
      })}
    </div>
  </div>`;
}
