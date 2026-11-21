package main

import (
	"fmt"
	"net/http"
	"strings"
	"time"
)

// Pupils sign up for the classes they will attend ("Jdu na tuto hodinu").
// Rules: only pupils linked to a pupil record, not for trips (whole tutor groups go),
// not for classes that are over, never above the class capacity, and never for two
// classes at the same time.

// attachSignups fills the number of signed-up pupils and, for a pupil, whether they are going.
func (a *App) attachSignups(evs []Event, u *User) {
	if len(evs) == 0 {
		return
	}
	idx := map[int64]int{}
	args := make([]any, len(evs))
	for i, e := range evs {
		idx[e.ID] = i
		args[i] = e.ID
	}
	ph := placeholders(len(evs))
	if rows, err := a.db.Query(`SELECT es.event_id, COUNT(*) FROM event_signups es JOIN students s ON s.id=es.student_id
		WHERE s.deleted_at IS NULL AND es.event_id IN (`+ph+`) GROUP BY es.event_id`, args...); err == nil {
		for rows.Next() {
			var id int64
			var n int
			_ = rows.Scan(&id, &n)
			evs[idx[id]].Signups = n
		}
		rows.Close()
	}
	if u == nil || u.Role != "student" {
		return
	}
	st := a.studentRecord(u)
	if st == nil {
		return
	}
	if rows, err := a.db.Query(`SELECT event_id FROM event_signups WHERE student_id=? AND event_id IN (`+ph+`)`, append([]any{st.ID}, args...)...); err == nil {
		for rows.Next() {
			var id int64
			_ = rows.Scan(&id)
			evs[idx[id]].Signed = true
		}
		rows.Close()
	}
}

func (a *App) classLabel(e Event) string {
	if e.Title != "" {
		return e.Title
	}
	if s := a.subjectName(e.SubjectID); s != "" {
		return s
	}
	return "hodina"
}

func (a *App) handleSignup(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	if u.Role != "student" {
		writeErr(w, http.StatusForbidden, "Na hodiny se přihlašují žáci.")
		return
	}
	st := a.studentRecord(u)
	if st == nil {
		writeErr(w, http.StatusBadRequest, "Tvůj účet zatím není propojený se záznamem žáka. Požádej tutora, aby ke tvému jménu v Ravenu doplnil e-mail.")
		return
	}
	ev, err := a.getEvent(pathID(r))
	if dbErr(w, err) {
		return
	}
	var body struct {
		Going bool `json:"going"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	if ev.Kind == "trip" {
		writeErr(w, http.StatusBadRequest, "Na výjezdy se nepřihlašuje – jede celá tutorská skupina.")
		return
	}
	if ev.Date < fmtDate(time.Now()) {
		writeErr(w, http.StatusBadRequest, "Tato hodina už proběhla.")
		return
	}

	tx, err := a.db.Begin()
	if dbErr(w, err) {
		return
	}
	defer tx.Rollback()
	if a.pg { // serialise sign-ups for the same class so the capacity cannot be exceeded
		if _, err := tx.Exec(`SELECT id FROM events WHERE id=? FOR UPDATE`, ev.ID); dbErr(w, err) {
			return
		}
	}
	count := func() int {
		var n int
		_ = tx.QueryRow(`SELECT COUNT(*) FROM event_signups es JOIN students s ON s.id=es.student_id WHERE es.event_id=? AND s.deleted_at IS NULL`, ev.ID).Scan(&n)
		return n
	}
	var already int
	_ = tx.QueryRow(`SELECT COUNT(*) FROM event_signups WHERE event_id=? AND student_id=?`, ev.ID, st.ID).Scan(&already)

	if !body.Going {
		if _, err := tx.Exec(`DELETE FROM event_signups WHERE event_id=? AND student_id=?`, ev.ID, st.ID); dbErr(w, err) {
			return
		}
	} else if already == 0 {
		if ev.Capacity != nil && count() >= *ev.Capacity {
			writeErr(w, http.StatusConflict, fmt.Sprintf("Hodina je plná (%d z %d míst). Vyber si prosím jinou.", count(), *ev.Capacity))
			return
		}
		// Not two classes at once.
		rows, err := tx.Query(`SELECT `+eventCols+` FROM events e WHERE e.deleted_at IS NULL AND e.date=? AND e.start_min<? AND e.end_min>? AND e.id<>?
			AND e.id IN (SELECT event_id FROM event_signups WHERE student_id=?)`, ev.Date, ev.End, ev.Start, ev.ID, st.ID)
		if dbErr(w, err) {
			return
		}
		var clash *Event
		for rows.Next() {
			if c, err := scanEvent(rows); err == nil && clash == nil {
				cc := c
				clash = &cc
			}
		}
		rows.Close()
		if clash != nil {
			writeErr(w, http.StatusConflict, fmt.Sprintf("V tu dobu už jdeš na hodinu %s (%s–%s). Nejdřív se z ní odhlas.", a.classLabel(*clash), hm(clash.Start), hm(clash.End)))
			return
		}
		if _, err := tx.Exec(`INSERT INTO event_signups(event_id,student_id,created_at) VALUES(?,?,?)`, ev.ID, st.ID, nowStamp()); dbErr(w, err) {
			return
		}
	}
	n := count()
	if dbErr(w, tx.Commit()) {
		return
	}
	writeJSON(w, map[string]any{"ok": true, "signed": body.Going, "signups": n, "capacity": ev.Capacity})
}

type signupRow struct {
	StudentID int64  `json:"student_id"`
	Name      string `json:"name"`
	Grade     int    `json:"grade"`
	Group     string `json:"group"`
	At        string `json:"at"`
}

// handleEventSignups lists who is coming: for the class's teachers and coordinators.
func (a *App) handleEventSignups(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	ev, err := a.getEvent(pathID(r))
	if dbErr(w, err) {
		return
	}
	allowed := u.atLeast("coordinator") || ev.OwnerID == u.ID
	for _, t := range ev.TeacherIDs {
		if t == u.ID {
			allowed = true
		}
	}
	if !allowed {
		writeErr(w, http.StatusForbidden, "Seznam přihlášených žáků vidí vyučující hodiny a koordinátor.")
		return
	}
	rows, err := a.db.Query(`SELECT s.id, s.first_name, s.last_name, s.grade, COALESCE(g.name,''), es.created_at
		FROM event_signups es JOIN students s ON s.id=es.student_id LEFT JOIN tutor_groups g ON g.id=s.group_id
		WHERE es.event_id=? AND s.deleted_at IS NULL ORDER BY lower(s.last_name), lower(s.first_name)`, ev.ID)
	if dbErr(w, err) {
		return
	}
	defer rows.Close()
	out := []signupRow{}
	for rows.Next() {
		var x signupRow
		var f, l string
		_ = rows.Scan(&x.StudentID, &f, &l, &x.Grade, &x.Group, &x.At)
		x.Name = strings.TrimSpace(l + " " + f)
		out = append(out, x)
	}
	writeJSON(w, map[string]any{"signups": out, "capacity": ev.Capacity})
}
