package main

import (
	"net/http"
	"strings"
)

// "Karta žáka": one page per pupil for teachers – which classes they go to,
// how their week splits between subjects, their own limits and recent weeks.
// Goals are fetched by the page from /api/goals?student_id=…

type weekSum struct {
	Week     string `json:"week"`
	Minutes  int    `json:"minutes"`
	Lessons  int    `json:"lessons"`
	Subjects int    `json:"subjects"`
}

func (a *App) handleStudentCard(w http.ResponseWriter, r *http.Request) {
	id := pathID(r)
	var st *Student
	for _, s := range a.listStudents() {
		if s.ID == id {
			x := s
			st = &x
		}
	}
	if st == nil {
		writeErr(w, http.StatusNotFound, "Žák nenalezen (možná byl odebrán).")
		return
	}
	monday := weekStart(r.URL.Query().Get("week"))
	from, to := fmtDate(monday), fmtDate(monday.AddDate(0, 0, 6))

	// the week's classes: lessons the pupil signed up for, plus their group's trips
	q := `SELECT ` + eventCols + ` FROM events WHERE deleted_at IS NULL AND date>=? AND date<=? AND (id IN (SELECT event_id FROM event_signups WHERE student_id=?)`
	args := []any{from, to, st.ID}
	if st.GroupID != nil {
		q += ` OR (kind='trip' AND id IN (SELECT event_id FROM event_groups WHERE group_id=?))`
		args = append(args, *st.GroupID)
	}
	q += `) ORDER BY date, start_min`
	rows, err := a.db.Query(q, args...)
	if dbErr(w, err) {
		return
	}
	evs := []Event{}
	for rows.Next() {
		if e, err := scanEvent(rows); err == nil {
			evs = append(evs, e)
		}
	}
	rows.Close()
	a.attachRelations(evs)

	load, err := a.studentLoad(st.ID, monday)
	if dbErr(w, err) {
		return
	}
	alerts, err := a.studentAlerts(st.ID)
	if dbErr(w, err) {
		return
	}

	// the last six weeks, ending with the shown one
	start := monday.AddDate(0, 0, -35)
	hist := make([]weekSum, 6)
	subj := make([]map[int64]bool, 6)
	for i := range hist {
		hist[i].Week = fmtDate(start.AddDate(0, 0, 7*i))
		subj[i] = map[int64]bool{}
	}
	hr, err := a.db.Query(`SELECT e.date, e.end_min-e.start_min, COALESCE(e.subject_id,0) FROM events e JOIN event_signups es ON es.event_id=e.id
		WHERE es.student_id=? AND e.deleted_at IS NULL AND e.kind='lesson' AND e.date>=? AND e.date<=?`, st.ID, fmtDate(start), to)
	if dbErr(w, err) {
		return
	}
	for hr.Next() {
		var d string
		var m int
		var sid int64
		if hr.Scan(&d, &m, &sid) != nil {
			continue
		}
		for i := 5; i >= 0; i-- {
			if d >= hist[i].Week {
				hist[i].Minutes += m
				hist[i].Lessons++
				if sid != 0 {
					subj[i][sid] = true
				}
				break
			}
		}
	}
	hr.Close()
	for i := range hist {
		hist[i].Subjects = len(subj[i])
	}

	// does the pupil have an account that is linked by e-mail?
	hasAccount := false
	if st.Email != "" {
		var n int
		_ = a.db.QueryRow(`SELECT COUNT(*) FROM users WHERE role='student' AND active<>0 AND lower(email)=?`, strings.ToLower(st.Email)).Scan(&n)
		hasAccount = n > 0
	}

	writeJSON(w, map[string]any{
		"student": st, "week": from, "prev": fmtDate(monday.AddDate(0, 0, -7)),
		"events": evs, "subjects": load, "alerts": alerts, "history": hist, "has_account": hasAccount,
	})
}
