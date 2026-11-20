package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

func writeJSONBody(w http.ResponseWriter, v any) { _ = json.NewEncoder(w).Encode(v) }

func (a *App) tutorOfStudent(sid int64) int64 {
	var t sql.NullInt64
	_ = a.db.QueryRow(`SELECT g.tutor_id FROM students s JOIN tutor_groups g ON g.id=s.group_id WHERE s.id=?`, sid).Scan(&t)
	return t.Int64
}

// ---------- consultations ----------

type Consultation struct {
	ID           int64  `json:"id"`
	Date         string `json:"date"`
	Start        *int   `json:"start"`
	StudentID    *int64 `json:"student_id"`
	TeacherID    int64  `json:"teacher_id"`
	Kind         string `json:"kind"`
	Participants string `json:"participants"`
	Topic        string `json:"topic"`
	Notes        string `json:"notes"`
	Agreements   string `json:"agreements"`
	FollowUp     string `json:"follow_up"`
	Status       string `json:"status"`
	Confidential bool   `json:"confidential"`
	CanEdit      bool   `json:"can_edit"`
}

const consCols = `id,date,start_min,student_id,teacher_id,kind,participants,topic,notes,agreements,COALESCE(follow_up,''),status,confidential`

func scanConsultation(sc interface{ Scan(...any) error }) (Consultation, error) {
	var c Consultation
	var st, sid sql.NullInt64
	var conf int
	err := sc.Scan(&c.ID, &c.Date, &st, &sid, &c.TeacherID, &c.Kind, &c.Participants, &c.Topic, &c.Notes, &c.Agreements, &c.FollowUp, &c.Status, &conf)
	if st.Valid {
		v := int(st.Int64)
		c.Start = &v
	}
	if sid.Valid {
		c.StudentID = &sid.Int64
	}
	c.Confidential = conf == 1
	return c, err
}

func (a *App) canSeeConsultation(me *User, c Consultation) bool {
	if !c.Confidential || me.atLeast("coordinator") || c.TeacherID == me.ID {
		return true
	}
	return c.StudentID != nil && a.tutorOfStudent(*c.StudentID) == me.ID
}

func canEditConsultation(me *User, c Consultation) bool {
	return me.atLeast("coordinator") || c.TeacherID == me.ID
}

func (a *App) handleListConsultations(w http.ResponseWriter, r *http.Request) {
	me := currentUser(r)
	q := r.URL.Query()
	sqlq := `SELECT ` + consCols + ` FROM consultations WHERE deleted_at IS NULL`
	args := []any{}
	if v := q.Get("student_id"); v != "" {
		sqlq += ` AND student_id=?`
		args = append(args, v)
	}
	if v := q.Get("teacher_id"); v != "" {
		sqlq += ` AND teacher_id=?`
		args = append(args, v)
	}
	if v := q.Get("status"); v != "" {
		sqlq += ` AND status=?`
		args = append(args, v)
	}
	if v := q.Get("from"); v != "" {
		sqlq += ` AND date>=?`
		args = append(args, v)
	}
	if v := q.Get("to"); v != "" {
		sqlq += ` AND date<=?`
		args = append(args, v)
	}
	sqlq += ` ORDER BY date DESC, COALESCE(start_min,0) DESC`
	rows, err := a.db.Query(sqlq, args...)
	if dbErr(w, err) {
		return
	}
	all := []Consultation{}
	for rows.Next() {
		if c, err := scanConsultation(rows); err == nil {
			all = append(all, c)
		}
	}
	rows.Close()
	out := []Consultation{}
	for _, c := range all {
		if a.canSeeConsultation(me, c) {
			c.CanEdit = canEditConsultation(me, c)
			out = append(out, c)
		}
	}
	writeJSON(w, out)
}

func (a *App) handleSaveConsultation(w http.ResponseWriter, r *http.Request) {
	me := currentUser(r)
	id := pathID(r)
	var in Consultation
	if !readJSON(w, r, &in) {
		return
	}
	if _, ok := parseDate(in.Date); !ok {
		writeErr(w, http.StatusBadRequest, "Zadejte platné datum.")
		return
	}
	in.Topic = strings.TrimSpace(in.Topic)
	if in.Topic == "" && (in.StudentID == nil || *in.StudentID == 0) {
		writeErr(w, http.StatusBadRequest, "Vyberte žáka nebo vyplňte téma.")
		return
	}
	switch in.Kind {
	case "parents", "student", "team", "other":
	default:
		in.Kind = "other"
	}
	switch in.Status {
	case "planned", "done", "cancelled":
	default:
		in.Status = "planned"
	}
	if in.FollowUp != "" {
		if _, ok := parseDate(in.FollowUp); !ok {
			in.FollowUp = ""
		}
	}
	if id != 0 {
		var cur Consultation
		cur, err := scanConsultation(a.db.QueryRow(`SELECT `+consCols+` FROM consultations WHERE id=? AND deleted_at IS NULL`, id))
		if dbErr(w, err) {
			return
		}
		if !canEditConsultation(me, cur) {
			writeErr(w, http.StatusForbidden, "Upravit může jen ten, kdo konzultaci vede, nebo koordinátor.")
			return
		}
		if !me.atLeast("coordinator") {
			in.TeacherID = cur.TeacherID
		}
	}
	if in.TeacherID == 0 || !me.atLeast("coordinator") && id == 0 {
		in.TeacherID = me.ID
	}
	var start any
	if in.Start != nil {
		start = *in.Start
	}
	conf := 0
	if in.Confidential {
		conf = 1
	}
	var err error
	if id == 0 {
		id, err = a.db.InsertID(`INSERT INTO consultations(date,start_min,student_id,teacher_id,kind,participants,topic,notes,agreements,follow_up,status,confidential) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
			in.Date, start, nullInt(in.StudentID), in.TeacherID, in.Kind, in.Participants, in.Topic, in.Notes, in.Agreements, nullStr(in.FollowUp), in.Status, conf)
	} else {
		_, err = a.db.Exec(`UPDATE consultations SET date=?,start_min=?,student_id=?,teacher_id=?,kind=?,participants=?,topic=?,notes=?,agreements=?,follow_up=?,status=?,confidential=?,updated_at=? WHERE id=?`,
			in.Date, start, nullInt(in.StudentID), in.TeacherID, in.Kind, in.Participants, in.Topic, in.Notes, in.Agreements, nullStr(in.FollowUp), in.Status, conf, nowStamp(), id)
	}
	if dbErr(w, err) {
		return
	}
	writeJSON(w, map[string]any{"ok": true, "id": id})
}

func (a *App) handleDeleteConsultation(w http.ResponseWriter, r *http.Request) {
	me := currentUser(r)
	id := pathID(r)
	c, err := scanConsultation(a.db.QueryRow(`SELECT `+consCols+` FROM consultations WHERE id=? AND deleted_at IS NULL`, id))
	if dbErr(w, err) {
		return
	}
	if !canEditConsultation(me, c) {
		writeErr(w, http.StatusForbidden, "Smazat může jen ten, kdo konzultaci vede, nebo koordinátor.")
		return
	}
	if _, err := a.db.Exec(`UPDATE consultations SET deleted_at=?,deleted_by=? WHERE id=?`, nowStamp(), me.ID, id); dbErr(w, err) {
		return
	}
	who := "bez žáka"
	if c.StudentID != nil {
		who = a.studentName(*c.StudentID)
	}
	a.audit(me.ID, "delete", "consultation", []int64{id}, fmt.Sprintf("Smazána konzultace: %s, %s (%s)", who, czDate(c.Date), c.Topic))
	writeJSON(w, map[string]any{"ok": true})
}

// ---------- goals ----------

type GoalNote struct {
	ID       int64  `json:"id"`
	AuthorID int64  `json:"author_id"`
	Date     string `json:"date"`
	Text     string `json:"text"`
}

type Goal struct {
	ID          int64      `json:"id"`
	StudentID   int64      `json:"student_id"`
	Title       string     `json:"title"`
	Description string     `json:"description"`
	Area        string     `json:"area"`
	Period      string     `json:"period"`
	ReviewDate  string     `json:"review_date"`
	Status      string     `json:"status"`
	CreatedBy   int64      `json:"created_by"`
	CreatedAt   string     `json:"created_at"`
	Notes       []GoalNote `json:"notes"`
	CanManage   bool       `json:"can_manage"`
}

const goalCols = `id,student_id,title,description,area,period,COALESCE(review_date,''),status,COALESCE(created_by,0),created_at`

func scanGoal(sc interface{ Scan(...any) error }) (Goal, error) {
	var g Goal
	err := sc.Scan(&g.ID, &g.StudentID, &g.Title, &g.Description, &g.Area, &g.Period, &g.ReviewDate, &g.Status, &g.CreatedBy, &g.CreatedAt)
	g.Notes = []GoalNote{}
	return g, err
}

func (a *App) canManageStudentGoals(me *User, sid int64) bool {
	return me.atLeast("coordinator") || a.tutorOfStudent(sid) == me.ID
}

func (a *App) canEditGoal(me *User, g Goal) bool {
	return g.CreatedBy == me.ID || a.canManageStudentGoals(me, g.StudentID)
}

var goalStatuses = map[string]string{"active": "probíhá", "achieved": "splněno", "partial": "částečně splněno", "not_achieved": "nesplněno", "cancelled": "zrušeno"}

func (a *App) handleListGoals(w http.ResponseWriter, r *http.Request) {
	me := currentUser(r)
	q := r.URL.Query()
	sqlq := `SELECT ` + goalCols + ` FROM goals g WHERE deleted_at IS NULL AND student_id IN (SELECT id FROM students WHERE deleted_at IS NULL)`
	args := []any{}
	if v := q.Get("student_id"); v != "" {
		sqlq += ` AND student_id=?`
		args = append(args, v)
	}
	if v := q.Get("group_id"); v != "" {
		sqlq += ` AND student_id IN (SELECT id FROM students WHERE group_id=?)`
		args = append(args, v)
	}
	if v := q.Get("status"); v != "" {
		sqlq += ` AND status=?`
		args = append(args, v)
	}
	sqlq += ` ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, COALESCE(review_date,'9999'), id DESC`
	rows, err := a.db.Query(sqlq, args...)
	if dbErr(w, err) {
		return
	}
	goals := []Goal{}
	for rows.Next() {
		if g, err := scanGoal(rows); err == nil {
			goals = append(goals, g)
		}
	}
	rows.Close()
	if len(goals) > 0 {
		idx := map[int64]int{}
		args := make([]any, len(goals))
		for i, g := range goals {
			idx[g.ID] = i
			args[i] = g.ID
		}
		if rows, err := a.db.Query(`SELECT id,goal_id,COALESCE(author_id,0),date,text FROM goal_notes WHERE goal_id IN (`+placeholders(len(goals))+`) ORDER BY date DESC, id DESC`, args...); err == nil {
			for rows.Next() {
				var n GoalNote
				var gid int64
				_ = rows.Scan(&n.ID, &gid, &n.AuthorID, &n.Date, &n.Text)
				goals[idx[gid]].Notes = append(goals[idx[gid]].Notes, n)
			}
			rows.Close()
		}
	}
	tutorCache := map[int64]bool{}
	for i := range goals {
		sid := goals[i].StudentID
		ok, seen := tutorCache[sid]
		if !seen {
			ok = a.canManageStudentGoals(me, sid)
			tutorCache[sid] = ok
		}
		goals[i].CanManage = ok || goals[i].CreatedBy == me.ID
	}
	writeJSON(w, goals)
}

func (a *App) handleSaveGoal(w http.ResponseWriter, r *http.Request) {
	me := currentUser(r)
	id := pathID(r)
	var in Goal
	if !readJSON(w, r, &in) {
		return
	}
	in.Title = strings.TrimSpace(in.Title)
	if in.Title == "" || in.StudentID == 0 {
		writeErr(w, http.StatusBadRequest, "Vyberte žáka a pojmenujte cíl.")
		return
	}
	if _, ok := goalStatuses[in.Status]; !ok {
		in.Status = "active"
	}
	if in.ReviewDate != "" {
		if _, ok := parseDate(in.ReviewDate); !ok {
			in.ReviewDate = ""
		}
	}
	var err error
	if id == 0 {
		if !a.canManageStudentGoals(me, in.StudentID) {
			writeErr(w, http.StatusForbidden, "Cíle zakládá tutor žáka nebo koordinátor. Poznámky k cílům může přidat kdokoli.")
			return
		}
		id, err = a.db.InsertID(`INSERT INTO goals(student_id,title,description,area,period,review_date,status,created_by) VALUES(?,?,?,?,?,?,?,?)`,
			in.StudentID, in.Title, in.Description, strings.TrimSpace(in.Area), strings.TrimSpace(in.Period), nullStr(in.ReviewDate), in.Status, me.ID)
	} else {
		cur, err2 := scanGoal(a.db.QueryRow(`SELECT `+goalCols+` FROM goals WHERE id=? AND deleted_at IS NULL`, id))
		if dbErr(w, err2) {
			return
		}
		if !a.canEditGoal(me, cur) {
			writeErr(w, http.StatusForbidden, "Cíl může upravit jeho autor, tutor žáka nebo koordinátor.")
			return
		}
		if in.StudentID != cur.StudentID && !a.canManageStudentGoals(me, in.StudentID) {
			in.StudentID = cur.StudentID
		}
		_, err = a.db.Exec(`UPDATE goals SET student_id=?,title=?,description=?,area=?,period=?,review_date=?,status=?,updated_at=? WHERE id=?`,
			in.StudentID, in.Title, in.Description, strings.TrimSpace(in.Area), strings.TrimSpace(in.Period), nullStr(in.ReviewDate), in.Status, nowStamp(), id)
	}
	if dbErr(w, err) {
		return
	}
	writeJSON(w, map[string]any{"ok": true, "id": id})
}

func (a *App) handleDeleteGoal(w http.ResponseWriter, r *http.Request) {
	me := currentUser(r)
	id := pathID(r)
	g, err := scanGoal(a.db.QueryRow(`SELECT `+goalCols+` FROM goals WHERE id=? AND deleted_at IS NULL`, id))
	if dbErr(w, err) {
		return
	}
	if !a.canEditGoal(me, g) {
		writeErr(w, http.StatusForbidden, "Cíl může smazat jeho autor, tutor žáka nebo koordinátor.")
		return
	}
	if _, err := a.db.Exec(`UPDATE goals SET deleted_at=?,deleted_by=? WHERE id=?`, nowStamp(), me.ID, id); dbErr(w, err) {
		return
	}
	a.audit(me.ID, "delete", "goal", []int64{id}, fmt.Sprintf("Smazán cíl: %s – %s", a.studentName(g.StudentID), g.Title))
	writeJSON(w, map[string]any{"ok": true})
}

func (a *App) handleAddGoalNote(w http.ResponseWriter, r *http.Request) {
	me := currentUser(r)
	id := pathID(r)
	var n GoalNote
	if !readJSON(w, r, &n) {
		return
	}
	n.Text = strings.TrimSpace(n.Text)
	if n.Text == "" {
		writeErr(w, http.StatusBadRequest, "Poznámka je prázdná.")
		return
	}
	if _, ok := parseDate(n.Date); !ok {
		n.Date = fmtDate(time.Now())
	}
	var exists int
	_ = a.db.QueryRow(`SELECT COUNT(*) FROM goals WHERE id=? AND deleted_at IS NULL`, id).Scan(&exists)
	if exists == 0 {
		writeErr(w, http.StatusNotFound, "Cíl nebyl nalezen.")
		return
	}
	if _, err := a.db.Exec(`INSERT INTO goal_notes(goal_id,author_id,date,text) VALUES(?,?,?,?)`, id, me.ID, n.Date, n.Text); dbErr(w, err) {
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

func (a *App) handleDeleteGoalNote(w http.ResponseWriter, r *http.Request) {
	me := currentUser(r)
	id := pathID(r)
	var author int64
	var text string
	if err := a.db.QueryRow(`SELECT COALESCE(author_id,0),text FROM goal_notes WHERE id=?`, id).Scan(&author, &text); dbErr(w, err) {
		return
	}
	if author != me.ID && !me.atLeast("coordinator") {
		writeErr(w, http.StatusForbidden, "Smazat můžete jen své poznámky.")
		return
	}
	if _, err := a.db.Exec(`DELETE FROM goal_notes WHERE id=?`, id); dbErr(w, err) {
		return
	}
	if len([]rune(text)) > 60 {
		text = string([]rune(text)[:60]) + "…"
	}
	a.audit(me.ID, "delete", "goal_note", nil, "Smazána poznámka k cíli: "+text)
	writeJSON(w, map[string]any{"ok": true})
}
