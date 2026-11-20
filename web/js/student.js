import { html, useApp, api, useAsync, Empty, PageHead, fmtDate, relDay, studentName, schoolYearLabel } from './lib.js';
import { GOAL_STATUS } from './goals.js';

// What a pupil sees under "Moje cíle": their own personal goals, read-only.
export function MyGoalsPage() {
  const { boot, maps, me } = useApp();
  const student = boot.students[0];
  const [state] = useAsync(() => api('GET', '/api/student/goals'), []);
  if (!student) {
    return html`<div class="page">
      <${PageHead} title="Moje cíle" sub=${me.email} />
      <${Empty}>Tvůj účet zatím není propojený se záznamem žáka. Požádej svého tutora, aby ke tvému jménu v Ravenu doplnil e-mail <b>${me.email}</b>.<//>
    </div>`;
  }
  const grp = student.group_id && maps.groups[student.group_id];
  const tutor = grp && grp.tutor_id && maps.users[grp.tutor_id];
  const goals = state.data || [];
  const active = goals.filter((g) => g.status === 'active');
  const closed = goals.filter((g) => g.status !== 'active');
  const card = (g) => html`<article class=${'goal goal-' + g.status}>
    <header class="goal-head">
      <div class="goal-main">
        <h3>${g.title}</h3>
        <div class="goal-meta">
          ${g.area && html`<span>${g.area}</span>`}
          ${g.period && html`<span>${g.period}</span>`}
          ${g.review_date && html`<span>revize ${fmtDate(g.review_date)} (${relDay(g.review_date)})</span>`}
        </div>
      </div>
      <span class=${'stamp stamp-g-' + g.status}>${GOAL_STATUS[g.status]}</span>
    </header>
    ${(g.description || g.notes.length > 0) && html`<div class="goal-body">
      ${g.description && html`<p class="goal-desc">${g.description}</p>`}
      ${g.notes.length > 0 && html`<ol class="notes">${g.notes.map((n) => html`<li>
        <span class="note-date mono">${fmtDate(n.date)}</span>
        <span class="note-who">${maps.users[n.author_id]?.short || ''}</span>
        <span class="note-text">${n.text}</span><span></span>
      </li>`)}</ol>`}
    </div>`}
  </article>`;
  return html`<div class="page">
    <${PageHead} title="Moje cíle" sub=${schoolYearLabel()} />
    <div class="student-head">
      <div>
        <div class="kicker">${student.grade}. ročník${grp ? ' · skupina ' + grp.name : ''}${tutor ? ' · tutor ' + tutor.name : ''}</div>
        <h2 class="student-name">${studentName(student)}</h2>
      </div>
    </div>
    ${state.loading ? html`<div class="loading-inline">Načítám…</div>` : html`
      ${goals.length === 0 && html`<${Empty}>Zatím nemáš žádný cíl. Cíle si stanovíš se svým tutorem.<//>`}
      ${active.map(card)}
      ${closed.length > 0 && html`<h3 class="subhead">Uzavřené cíle</h3>${closed.map(card)}`}
    `}
  </div>`;
}
