package main

import (
	"net/http"
	"time"
)

// "Rozložení hodin": how much of each subject a pupil has in a week, counted from
// the classes they signed up for, plus the limits they set themselves.
// Kept separate from the handler so the teachers' student card can reuse it.

type subjectLoad struct {
	SubjectID   int64 `json:"subject_id"`
	Minutes     int   `json:"minutes"`
	Lessons     int   `json:"lessons"`
	PrevMinutes int   `json:"prev_minutes"`
	PrevLessons int   `json:"prev_lessons"`
}

type studentAlert struct {
	SubjectID  int64 `json:"subject_id"`
	MinMinutes *int  `json:"min_minutes"`
	MaxMinutes *int  `json:"max_minutes"`
}

func weekStart(s string) time.Time {
	t, ok := parseDate(s)
	if !ok {
		t = time.Now()
	}
	wd := (int(t.Weekday()) + 6) % 7 // 0 = Monday
	return time.Date(t.Year(), t.Month(), t.Day()-wd, 0, 0, 0, 0, time.Local)
}

func (a *App) studentLoad(studentID int64, monday time.Time) ([]subjectLoad, error) {
	prev := monday.AddDate(0, 0, -7)
	rows, err := a.db.Query(`SELECT e.subject_id, e.date, e.end_min-e.start_min FROM events e
		JOIN event_signups es ON es.event_id=e.id
		WHERE es.student_id=? AND e.deleted_at IS NULL AND e.kind='lesson' AND e.subject_id IS NOT NULL
		AND e.date>=? AND e.date<=?`, studentID, fmtDate(prev), fmtDate(monday.AddDate(0, 0, 6)))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	by := map[int64]*subjectLoad{}
	order := []int64{}
	this := fmtDate(monday)
	for rows.Next() {
		var sid int64
		var date string
		var min int
		if err := rows.Scan(&sid, &date, &min); err != nil {
			return nil, err
		}
		x := by[sid]
		if x == nil {
			x = &subjectLoad{SubjectID: sid}
			by[sid] = x
			order = append(order, sid)
		}
		if date >= this {
			x.Minutes += min
			x.Lessons++
		} else {
			x.PrevMinutes += min
			x.PrevLessons++
		}
	}
	out := make([]subjectLoad, 0, len(order))
	for _, id := range order {
		out = append(out, *by[id])
	}
	return out, rows.Err()
}

func (a *App) studentAlerts(studentID int64) ([]studentAlert, error) {
	rows, err := a.db.Query(`SELECT subject_id, min_minutes, max_minutes FROM student_alerts WHERE student_id=?`, studentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []studentAlert{}
	for rows.Next() {
		var x studentAlert
		if err := rows.Scan(&x.SubjectID, &x.MinMinutes, &x.MaxMinutes); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

func (a *App) handleStudentLoad(w http.ResponseWriter, r *http.Request) {
	st := a.studentRecord(currentUser(r))
	if st == nil {
		writeErr(w, http.StatusBadRequest, "Tvůj účet zatím není propojený se záznamem žáka. Požádej tutora, aby ke tvému jménu v Ravenu doplnil e-mail.")
		return
	}
	monday := weekStart(r.URL.Query().Get("week"))
	load, err := a.studentLoad(st.ID, monday)
	if dbErr(w, err) {
		return
	}
	alerts, err := a.studentAlerts(st.ID)
	if dbErr(w, err) {
		return
	}
	writeJSON(w, map[string]any{"week": fmtDate(monday), "prev": fmtDate(monday.AddDate(0, 0, -7)), "subjects": load, "alerts": alerts})
}

func (a *App) handleSaveAlerts(w http.ResponseWriter, r *http.Request) {
	st := a.studentRecord(currentUser(r))
	if st == nil {
		writeErr(w, http.StatusBadRequest, "Tvůj účet zatím není propojený se záznamem žáka.")
		return
	}
	var body []studentAlert
	if !readJSON(w, r, &body) {
		return
	}
	valid := map[int64]bool{}
	if rows, err := a.db.Query(`SELECT id FROM subjects`); err == nil {
		for rows.Next() {
			var id int64
			_ = rows.Scan(&id)
			valid[id] = true
		}
		rows.Close()
	}
	ok := func(p *int) bool { return p == nil || (*p >= 0 && *p <= 3000) }
	seen := map[int64]bool{}
	for _, x := range body {
		if !valid[x.SubjectID] || seen[x.SubjectID] {
			writeErr(w, http.StatusBadRequest, "Neznámý nebo zdvojený předmět.")
			return
		}
		seen[x.SubjectID] = true
		if !ok(x.MinMinutes) || !ok(x.MaxMinutes) {
			writeErr(w, http.StatusBadRequest, "Hlídaný počet hodin musí být mezi 0 a 50 hodinami týdně.")
			return
		}
		if x.MinMinutes != nil && x.MaxMinutes != nil && *x.MinMinutes > *x.MaxMinutes {
			writeErr(w, http.StatusBadRequest, "Spodní hranice nemůže být vyšší než horní.")
			return
		}
	}
	tx, err := a.db.Begin()
	if dbErr(w, err) {
		return
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM student_alerts WHERE student_id=?`, st.ID); dbErr(w, err) {
		return
	}
	for _, x := range body {
		if x.MinMinutes == nil && x.MaxMinutes == nil {
			continue
		}
		if _, err := tx.Exec(`INSERT INTO student_alerts(student_id,subject_id,min_minutes,max_minutes) VALUES(?,?,?,?)`, st.ID, x.SubjectID, x.MinMinutes, x.MaxMinutes); dbErr(w, err) {
			return
		}
	}
	if dbErr(w, tx.Commit()) {
		return
	}
	alerts, _ := a.studentAlerts(st.ID)
	writeJSON(w, alerts)
}
