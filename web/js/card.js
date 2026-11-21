import { html, useState, useEffect, useApp, api, go, Empty, addDays, mondayOf, schoolWeek, today, fmtDate, fmtDay, hm, relDay, weekdayOf, DAYS, studentName } from './lib.js';
import { weekTitle, fmtMinutes, breaches, eventTitle } from './schedule.js';
import { LoadView, hoursText } from './load.js';
import { GOAL_STATUS } from './goals.js';

// "Karta žáka": everything a teacher needs to check that a pupil is doing alright –
// which classes they go to, how their week splits between subjects, their own limits,
// the last six weeks and their personal goals. Teachers, coordinators and admins.

export function StudentCardPage({ params }) {
  const { maps } = useApp();
  const id = Number(params.id);
  const week = params.w ? mondayOf(params.w) : schoolWeek();
  const [d, setD] = useState(null);
  const [goals, setGoals] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setD(null); setErr('');
    api('GET', `/api/students/${id}/card?week=${week}`, undefined, { quiet: true }).then(setD).catch((e) => setErr(e.message));
  }, [id, week]);
  useEffect(() => {
    setGoals(null);
    api('GET', `/api/goals?student_id=${id}`, undefined, { quiet: true }).then(setGoals).catch(() => setGoals([]));
  }, [id]);

  const nav = (w) => go('zak', w ? { id, w } : { id });
  if (err) return html`<div class="page"><a class="back-link" href="#/zaci">← Žáci a skupiny</a><p class="bad">${err}</p></div>`;
  if (!d) return html`<div class="page"><div class="loading-inline">Načítám kartu žáka…</div></div>`;

  const st = d.student;
  const grp = st.group_id && maps.groups[st.group_id];
  const tutor = grp && grp.tutor_id && maps.users[grp.tutor_id];
  const lessons = d.events.filter((e) => e.kind !== 'trip');
  const minutes = lessons.reduce((t, e) => t + e.end - e.start, 0);
  const warn = breaches(d, maps);
  const gl = (goals || []).filter((g) => g.status !== 'cancelled');
  const active = gl.filter((g) => g.status === 'active');
  const achieved = gl.filter((g) => g.status === 'achieved');
  const overdue = active.filter((g) => g.review_date && g.review_date < today());
  const isPast = addDays(week, 4) < today();

  // what deserves a teacher's attention, most important first
  const flags = [];
  if (!st.email) flags.push(['bad', 'Žák nemá v Ravenu e-mail, takže se nemůže přihlásit ani zapisovat na hodiny.']);
  else if (!d.has_account) flags.push(['warn', 'Žák se do Ravenu zatím nepřihlásil.']);
  if (lessons.length === 0) flags.push(['bad', isPast ? 'V tomto týdnu nebyl přihlášený na žádnou hodinu.' : 'Na tento týden není přihlášený na žádnou hodinu.']);
  for (const w of warn) flags.push(['warn', `${w.kind === 'low' ? 'Málo' : 'Moc'} hodin: ${w.name} – ${hoursText(w.minutes)}, žák si hlídá ${w.kind === 'low' ? 'alespoň' : 'nejvýše'} ${hoursText(w.limit)}.`]);
  for (const g of overdue) flags.push(['warn', `Cíl „${g.title}“ měl revizi ${fmtDate(g.review_date)} a stále probíhá.`]);
  if (goals && gl.length === 0) flags.push(['info', 'Žák zatím nemá žádný osobní cíl.']);
  const lastWeeks = d.history.slice(0, 5);
  if (lastWeeks.every((h) => h.lessons === 0) && lessons.length === 0) flags.push(['info', 'Posledních šest týdnů bez jediné přihlášené hodiny.']);

  const byDay = [0, 1, 2, 3, 4].map((i) => addDays(week, i)).map((day) => ({ day, evs: d.events.filter((e) => e.date === day) }));
  const maxMin = Math.max(60, ...d.history.map((h) => h.minutes));

  return html`<div class="page card-page">
    <a class="back-link" href="#/zaci">← Žáci a skupiny</a>
    <div class="page-head sched-head">
      <div class="page-title-wrap">
        <div class="week-no">Karta žáka</div>
        <h1 class="page-title">${studentName(st)}</h1>
        <div class="page-sub">${st.grade}. ročník${grp ? ' · skupina ' + grp.name : ' · bez skupiny'}${tutor ? ' · tutor ' + tutor.name : ''}${st.email ? ' · ' + st.email : ''}</div>
      </div>
      <div class="sched-nav">
        <button class="btn btn-sq" title="Předchozí týden" onClick=${() => nav(addDays(week, -7))}>←</button>
        <button class=${'btn' + (week === schoolWeek() ? ' btn-on' : '')} onClick=${() => nav(null)}>Tento týden</button>
        <button class="btn btn-sq" title="Další týden" onClick=${() => nav(addDays(week, 7))}>→</button>
      </div>
    </div>

    <div class="card-summary">
      <div class=${'cs-tile' + (lessons.length === 0 ? ' is-bad' : '')}><span>Týden ${weekTitle(week)}</span><b>${lessons.length} ${lessons.length === 1 ? 'hodina' : lessons.length >= 2 && lessons.length <= 4 ? 'hodiny' : 'hodin'}</b><small>${fmtMinutes(minutes) || 'nic'}</small></div>
      <div class=${'cs-tile' + (warn.length ? ' is-warn' : '')}><span>Hlídání předmětů</span><b>${warn.length ? warn.length + '× mimo' : 'v pořádku'}</b><small>${d.alerts.length ? d.alerts.length + ' hlídaných předmětů' : 'žák si nic nehlídá'}</small></div>
      <div class=${'cs-tile' + (overdue.length ? ' is-warn' : '')}><span>Osobní cíle</span><b>${goals ? `${achieved.length} z ${gl.length} splněno` : '…'}</b><small>${goals ? `${active.length} probíhá${overdue.length ? `, ${overdue.length} po revizi` : ''}` : ''}</small></div>
    </div>

    ${flags.length > 0 ? html`<ul class="card-flags">${flags.map(([k, t]) => html`<li class=${'is-' + k}><span class="cf-icon" aria-hidden="true">${k === 'info' ? 'i' : '!'}</span>${t}</li>`)}</ul>`
      : html`<p class="card-ok"><span aria-hidden="true">✓</span> Nic k řešení – žák chodí na hodiny a drží se svých hranic.</p>`}

    <section class="section">
      <div class="section-head"><h2>Kam žák chodí</h2><div class="section-aside"><a href=${'#/rozvrh?w=' + week}>Otevřít rozvrh týdne</a></div></div>
      <div class="card-week">${byDay.map(({ day, evs }) => html`<div class=${'cw-day' + (day === today() ? ' is-today' : '')}>
        <div class="cw-head"><b>${DAYS[weekdayOf(day) - 1]}</b> <span class="mono muted">${fmtDay(day)}</span></div>
        ${evs.length === 0 ? html`<div class="cw-none">—</div>` : evs.map((e) => {
          const s = maps.subjects[e.subject_id];
          return html`<div class=${'cw-ev' + (e.kind === 'trip' ? ' is-trip' : '')} style=${`--c:${s ? s.color : 'var(--cedar)'}`}>
            <span class="mono small">${hm(e.start)}–${hm(e.end)}</span>
            <b>${e.kind === 'trip' ? 'Výjezd: ' : ''}${eventTitle(e, maps)}</b>
            <span class="muted small">${[e.kind === 'lesson' && s && e.title ? s.name : '', maps.rooms[e.room_id]?.name, maps.users[e.owner_id]?.short || maps.users[e.owner_id]?.name].filter(Boolean).join(' · ')}</span>
          </div>`;
        })}
      </div>`)}</div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Rozložení hodin</h2></div>
      <${LoadView} d=${d} hideWarn empty="V tomto ani minulém týdnu žák nebyl přihlášený na žádnou hodinu." />
    </section>

    <section class="section">
      <div class="section-head"><h2>Posledních šest týdnů</h2></div>
      <div class="card-hist" role="table">
        ${d.history.map((h) => html`<button type="button" class=${'ch-row' + (h.week === week ? ' on' : '')} role="row" onClick=${() => nav(h.week)} title="Zobrazit tento týden">
          <span class="ch-week" role="cell">${weekTitle(h.week)}</span>
          <span class="ch-bar" role="cell"><i style=${`width:${(h.minutes / maxMin) * 100}%`}></i></span>
          <span class="ch-val mono" role="cell">${h.lessons ? `${fmtMinutes(h.minutes)} · ${h.lessons}× · ${h.subjects} předm.` : 'žádná hodina'}</span>
        </button>`)}
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Osobní cíle <span class="count">${gl.length}</span></h2><div class="section-aside"><a href=${'#/cile?student=' + id}>Spravovat cíle</a></div></div>
      ${!goals ? html`<div class="loading-inline">Načítám…</div>` : gl.length === 0 ? html`<${Empty}>Žádné osobní cíle.<//>` : html`
        <div class="goal-meter" aria-label=${`${achieved.length} z ${gl.length} cílů splněno`}>
          ${gl.map((g) => html`<i class=${'gm-' + g.status} title=${`${g.title}: ${GOAL_STATUS[g.status]}`}></i>`)}
        </div>
        <ul class="card-goals">${gl.map((g) => {
          const late = g.status === 'active' && g.review_date && g.review_date < today();
          return html`<li>
            <span class=${'stamp stamp-g-' + g.status}>${GOAL_STATUS[g.status]}</span>
            <span class="cg-title">${g.title}${g.area ? html` <span class="muted">· ${g.area}</span>` : ''}</span>
            <span class=${'mono small' + (late ? ' bad' : ' muted')}>${g.review_date ? `revize ${fmtDate(g.review_date)} (${relDay(g.review_date)})` : ''}</span>
          </li>`;
        })}</ul>`}
    </section>
  </div>`;
}
