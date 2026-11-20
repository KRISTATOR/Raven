package main

import (
	"database/sql"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

type Subject struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Short string `json:"short"`
	Color string `json:"color"`
}

type Room struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

type Group struct {
	ID         int64   `json:"id"`
	Name       string  `json:"name"`
	TutorID    *int64  `json:"tutor_id"`
	Color      string  `json:"color"`
	Note       string  `json:"note"`
	StudentIDs []int64 `json:"student_ids,omitempty"`
}

type Student struct {
	ID        int64  `json:"id"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
	Grade     int    `json:"grade"`
	GroupID   *int64 `json:"group_id"`
	Note      string `json:"note"`
	Email     string `json:"email"`
}

type Holiday struct {
	ID       int64  `json:"id"`
	DateFrom string `json:"date_from"`
	DateTo   string `json:"date_to"`
	Name     string `json:"name"`
}

func pathID(r *http.Request) int64 {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	return id
}

var hexColor = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)

func (a *App) listUsers(all bool) []User {
	q := `SELECT id,username,name,short,role,active,COALESCE(email,''),CASE WHEN password_hash<>'' THEN 1 ELSE 0 END FROM users`
	if !all {
		q += ` WHERE active=1`
	}
	q += ` ORDER BY lower(name)`
	rows, err := a.db.Query(q)
	out := []User{}
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var u User
		var act, pw int
		_ = rows.Scan(&u.ID, &u.Username, &u.Name, &u.Short, &u.Role, &act, &u.Email, &pw)
		u.Active = act == 1
		u.HasPassword = pw == 1
		out = append(out, u)
	}
	return out
}

func (a *App) listStudents() []Student {
	out := []Student{}
	rows, err := a.db.Query(`SELECT id,first_name,last_name,grade,group_id,note,COALESCE(email,'') FROM students WHERE deleted_at IS NULL ORDER BY lower(last_name), lower(first_name)`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var s Student
		var g sql.NullInt64
		_ = rows.Scan(&s.ID, &s.FirstName, &s.LastName, &s.Grade, &g, &s.Note, &s.Email)
		if g.Valid {
			s.GroupID = &g.Int64
		}
		out = append(out, s)
	}
	return out
}

func (a *App) listGroups() []Group {
	out := []Group{}
	rows, err := a.db.Query(`SELECT id,name,tutor_id,color,note FROM tutor_groups ORDER BY lower(name)`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var g Group
		var t sql.NullInt64
		_ = rows.Scan(&g.ID, &g.Name, &t, &g.Color, &g.Note)
		if t.Valid {
			g.TutorID = &t.Int64
		}
		out = append(out, g)
	}
	return out
}

func (a *App) handleBootstrap(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	if u.Role == "student" {
		a.studentBootstrap(w, u)
		return
	}
	subjects := []Subject{}
	if rows, err := a.db.Query(`SELECT id,name,short,color FROM subjects ORDER BY lower(name)`); err == nil {
		for rows.Next() {
			var s Subject
			_ = rows.Scan(&s.ID, &s.Name, &s.Short, &s.Color)
			subjects = append(subjects, s)
		}
		rows.Close()
	}
	rooms := []Room{}
	if rows, err := a.db.Query(`SELECT id,name FROM rooms ORDER BY lower(name)`); err == nil {
		for rows.Next() {
			var x Room
			_ = rows.Scan(&x.ID, &x.Name)
			rooms = append(rooms, x)
		}
		rows.Close()
	}
	holidays := []Holiday{}
	if rows, err := a.db.Query(`SELECT id,date_from,date_to,name FROM holidays ORDER BY date_from`); err == nil {
		for rows.Next() {
			var h Holiday
			_ = rows.Scan(&h.ID, &h.DateFrom, &h.DateTo, &h.Name)
			holidays = append(holidays, h)
		}
		rows.Close()
	}
	writeJSON(w, map[string]any{
		"user":     u,
		"settings": a.loadSettings(),
		"users":    a.listUsers(true),
		"subjects": subjects,
		"rooms":    rooms,
		"groups":   a.listGroups(),
		"students": a.listStudents(),
		"holidays": holidays,
		"mode":     map[bool]string{true: "online", false: "local"}[a.pg],
	})
}

// ---------- settings ----------

func (a *App) handleSaveSettings(w http.ResponseWriter, r *http.Request) {
	var s Settings
	if !readJSON(w, r, &s) {
		return
	}
	lens := []int{}
	seen := map[int]bool{}
	for _, l := range s.LessonLengths {
		if l >= 5 && l <= 600 && !seen[l] {
			lens = append(lens, l)
			seen[l] = true
		}
	}
	sort.Ints(lens)
	if len(lens) == 0 {
		writeErr(w, http.StatusBadRequest, "Zadejte alespoň jednu délku hodiny.")
		return
	}
	s.LessonLengths = lens
	if s.DayEnd <= s.DayStart {
		writeErr(w, http.StatusBadRequest, "Konec dne musí být po začátku výuky.")
		return
	}
	if s.CircleEnd < s.CircleStart || s.LunchEnd < s.LunchStart {
		writeErr(w, http.StatusBadRequest, "Zkontrolujte časy ranních kruhů a oběda.")
		return
	}
	if s.TripWeekday < 0 || s.TripWeekday > 5 {
		s.TripWeekday = 0
	}
	if s.SlotStep <= 0 {
		s.SlotStep = 5
	}
	s.SchoolName = strings.TrimSpace(s.SchoolName)
	s.GoogleClientID = strings.TrimSpace(s.GoogleClientID)
	s.TeacherDomains = normDomains(s.TeacherDomains)
	s.StudentDomains = normDomains(s.StudentDomains)
	if err := a.saveSettings(s); dbErr(w, err) {
		return
	}
	a.audit(currentUser(r).ID, "update", "settings", nil, "Změněno nastavení školy")
	writeJSON(w, s)
}

// ---------- users ----------

func (a *App) handleListUsers(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, a.listUsers(true))
}

func (a *App) handleSaveUser(w http.ResponseWriter, r *http.Request) {
	me := currentUser(r)
	id := pathID(r)
	var body struct {
		Username string `json:"username"`
		Name     string `json:"name"`
		Short    string `json:"short"`
		Role     string `json:"role"`
		Active   bool   `json:"active"`
		Password string `json:"password"`
		Email    string `json:"email"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	body.Username = strings.TrimSpace(body.Username)
	body.Name = strings.TrimSpace(body.Name)
	body.Short = strings.ToUpper(strings.TrimSpace(body.Short))
	body.Email = strings.ToLower(strings.TrimSpace(body.Email))
	if body.Username == "" {
		body.Username = body.Email
	}
	if body.Username == "" || body.Name == "" {
		writeErr(w, http.StatusBadRequest, "Vyplňte jméno a přihlašovací jméno.")
		return
	}
	if _, ok := roleRank[body.Role]; !ok {
		writeErr(w, http.StatusBadRequest, "Neplatná role.")
		return
	}
	if body.Password != "" && len(body.Password) < 6 {
		writeErr(w, http.StatusBadRequest, "Heslo musí mít alespoň 6 znaků.")
		return
	}
	if id == 0 {
		if body.Password == "" && body.Email == "" {
			writeErr(w, http.StatusBadRequest, "Zadejte úvodní heslo, nebo e-mail pro přihlášení přes Google.")
			return
		}
		h := ""
		if body.Password != "" {
			h, _ = hashPassword(body.Password)
		}
		_, err := a.db.Exec(`INSERT INTO users(username,name,short,role,password_hash,active,email) VALUES(?,?,?,?,?,1,?)`, body.Username, body.Name, body.Short, body.Role, h, nullStr(body.Email))
		if err != nil {
			writeErr(w, http.StatusConflict, "Přihlašovací jméno nebo e-mail už existuje.")
			return
		}
		a.audit(me.ID, "create", "user", nil, "Vytvořen účet: "+body.Name+" ("+roleLabel(body.Role)+")")
	} else {
		if id == me.ID && (body.Role != "admin" || !body.Active) {
			writeErr(w, http.StatusBadRequest, "Nemůžete odebrat správcovská práva ani deaktivovat sami sebe.")
			return
		}
		act := 0
		if body.Active {
			act = 1
		}
		_, err := a.db.Exec(`UPDATE users SET username=?,name=?,short=?,role=?,active=?,email=? WHERE id=?`, body.Username, body.Name, body.Short, body.Role, act, nullStr(body.Email), id)
		if err != nil {
			writeErr(w, http.StatusConflict, "Přihlašovací jméno nebo e-mail už existuje.")
			return
		}
		if body.Password != "" {
			h, _ := hashPassword(body.Password)
			_, _ = a.db.Exec(`UPDATE users SET password_hash=? WHERE id=?`, h, id)
			_, _ = a.db.Exec(`DELETE FROM sessions WHERE user_id=?`, id)
		}
		if !body.Active {
			_, _ = a.db.Exec(`DELETE FROM sessions WHERE user_id=?`, id)
		}
		a.audit(me.ID, "update", "user", []int64{id}, "Upraven účet: "+body.Name+" ("+roleLabel(body.Role)+")")
	}
	writeJSON(w, a.listUsers(true))
}

func roleLabel(r string) string {
	switch r {
	case "admin":
		return "správce"
	case "coordinator":
		return "koordinátor"
	case "student":
		return "žák"
	}
	return "učitel"
}

// ---------- subjects & rooms ----------

func (a *App) handleSaveSubject(w http.ResponseWriter, r *http.Request) {
	var s Subject
	if !readJSON(w, r, &s) {
		return
	}
	s.Name = strings.TrimSpace(s.Name)
	if s.Name == "" {
		writeErr(w, http.StatusBadRequest, "Zadejte název předmětu.")
		return
	}
	if !hexColor.MatchString(s.Color) {
		s.Color = "#FFE800"
	}
	id := pathID(r)
	var err error
	if id == 0 {
		_, err = a.db.Exec(`INSERT INTO subjects(name,short,color) VALUES(?,?,?)`, s.Name, strings.TrimSpace(s.Short), s.Color)
	} else {
		_, err = a.db.Exec(`UPDATE subjects SET name=?,short=?,color=? WHERE id=?`, s.Name, strings.TrimSpace(s.Short), s.Color, id)
	}
	if dbErr(w, err) {
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

func (a *App) handleDeleteSubject(w http.ResponseWriter, r *http.Request) {
	id := pathID(r)
	var n int
	_ = a.db.QueryRow(`SELECT COUNT(*) FROM events WHERE subject_id=? AND deleted_at IS NULL`, id).Scan(&n)
	if n > 0 {
		writeErr(w, http.StatusConflict, fmt.Sprintf("Předmět je použit v rozvrhu (%d×). Nejprve jej odeberte z hodin.", n))
		return
	}
	_, err := a.db.Exec(`DELETE FROM subjects WHERE id=?`, id)
	if dbErr(w, err) {
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

func (a *App) handleSaveRoom(w http.ResponseWriter, r *http.Request) {
	var x Room
	if !readJSON(w, r, &x) {
		return
	}
	x.Name = strings.TrimSpace(x.Name)
	if x.Name == "" {
		writeErr(w, http.StatusBadRequest, "Zadejte název místnosti.")
		return
	}
	id := pathID(r)
	var err error
	if id == 0 {
		_, err = a.db.Exec(`INSERT INTO rooms(name) VALUES(?)`, x.Name)
	} else {
		_, err = a.db.Exec(`UPDATE rooms SET name=? WHERE id=?`, x.Name, id)
	}
	if dbErr(w, err) {
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

func (a *App) handleDeleteRoom(w http.ResponseWriter, r *http.Request) {
	_, err := a.db.Exec(`DELETE FROM rooms WHERE id=?`, pathID(r))
	if dbErr(w, err) {
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

// ---------- tutor groups ----------

func (a *App) handleSaveGroup(w http.ResponseWriter, r *http.Request) {
	me := currentUser(r)
	var g Group
	if !readJSON(w, r, &g) {
		return
	}
	g.Name = strings.TrimSpace(g.Name)
	if g.Name == "" {
		writeErr(w, http.StatusBadRequest, "Zadejte název skupiny.")
		return
	}
	if !hexColor.MatchString(g.Color) {
		g.Color = "#0078BF"
	}
	id := pathID(r)
	tx, err := a.db.Begin()
	if dbErr(w, err) {
		return
	}
	defer tx.Rollback()
	if id == 0 {
		newID, err := tx.InsertID(`INSERT INTO tutor_groups(name,tutor_id,color,note) VALUES(?,?,?,?)`, g.Name, nullInt(g.TutorID), g.Color, g.Note)
		if dbErr(w, err) {
			return
		}
		id = newID
	} else {
		if _, err := tx.Exec(`UPDATE tutor_groups SET name=?,tutor_id=?,color=?,note=? WHERE id=?`, g.Name, nullInt(g.TutorID), g.Color, g.Note, id); dbErr(w, err) {
			return
		}
	}
	if g.StudentIDs != nil {
		if _, err := tx.Exec(`UPDATE students SET group_id=NULL WHERE group_id=?`, id); dbErr(w, err) {
			return
		}
		for _, sid := range g.StudentIDs {
			if _, err := tx.Exec(`UPDATE students SET group_id=? WHERE id=?`, id, sid); dbErr(w, err) {
				return
			}
		}
	}
	if dbErr(w, tx.Commit()) {
		return
	}
	a.audit(me.ID, "update", "group", []int64{id}, "Uložena tutorská skupina: "+g.Name)
	writeJSON(w, map[string]any{"ok": true, "id": id})
}

func (a *App) handleDeleteGroup(w http.ResponseWriter, r *http.Request) {
	id := pathID(r)
	var name string
	_ = a.db.QueryRow(`SELECT name FROM tutor_groups WHERE id=?`, id).Scan(&name)
	_, err := a.db.Exec(`DELETE FROM tutor_groups WHERE id=?`, id)
	if dbErr(w, err) {
		return
	}
	a.audit(currentUser(r).ID, "delete", "group", nil, "Smazána tutorská skupina: "+name+" (žáci zůstali bez skupiny)")
	writeJSON(w, map[string]any{"ok": true})
}

// ---------- students ----------

func (a *App) handleSaveStudent(w http.ResponseWriter, r *http.Request) {
	var s Student
	if !readJSON(w, r, &s) {
		return
	}
	s.FirstName = strings.TrimSpace(s.FirstName)
	s.LastName = strings.TrimSpace(s.LastName)
	s.Email = strings.ToLower(strings.TrimSpace(s.Email))
	if s.FirstName == "" || s.LastName == "" {
		writeErr(w, http.StatusBadRequest, "Vyplňte jméno i příjmení.")
		return
	}
	id := pathID(r)
	var err error
	if id == 0 {
		id, err = a.db.InsertID(`INSERT INTO students(first_name,last_name,grade,group_id,note,email) VALUES(?,?,?,?,?,?)`, s.FirstName, s.LastName, s.Grade, nullInt(s.GroupID), s.Note, nullStr(s.Email))
	} else {
		_, err = a.db.Exec(`UPDATE students SET first_name=?,last_name=?,grade=?,group_id=?,note=?,email=? WHERE id=?`, s.FirstName, s.LastName, s.Grade, nullInt(s.GroupID), s.Note, nullStr(s.Email), id)
	}
	if dbErr(w, err) {
		return
	}
	writeJSON(w, map[string]any{"ok": true, "id": id})
}

func (a *App) handleBulkStudents(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Students []Student `json:"students"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	tx, err := a.db.Begin()
	if dbErr(w, err) {
		return
	}
	defer tx.Rollback()
	n := 0
	for _, s := range body.Students {
		if strings.TrimSpace(s.FirstName) == "" || strings.TrimSpace(s.LastName) == "" {
			continue
		}
		if _, err := tx.Exec(`INSERT INTO students(first_name,last_name,grade,group_id) VALUES(?,?,?,?)`, strings.TrimSpace(s.FirstName), strings.TrimSpace(s.LastName), s.Grade, nullInt(s.GroupID)); dbErr(w, err) {
			return
		}
		n++
	}
	if dbErr(w, tx.Commit()) {
		return
	}
	a.audit(currentUser(r).ID, "create", "student", nil, fmt.Sprintf("Hromadně přidáno žáků: %d", n))
	writeJSON(w, map[string]any{"ok": true, "created": n})
}

func (a *App) handleDeleteStudent(w http.ResponseWriter, r *http.Request) {
	id := pathID(r)
	name := a.studentName(id)
	_, err := a.db.Exec(`UPDATE students SET deleted_at=? WHERE id=?`, nowStamp(), id)
	if dbErr(w, err) {
		return
	}
	a.audit(currentUser(r).ID, "delete", "student", []int64{id}, "Odebrán žák: "+name)
	writeJSON(w, map[string]any{"ok": true})
}

// ---------- holidays & day notes ----------

func (a *App) handleSaveHoliday(w http.ResponseWriter, r *http.Request) {
	var h Holiday
	if !readJSON(w, r, &h) {
		return
	}
	h.Name = strings.TrimSpace(h.Name)
	if h.DateTo == "" {
		h.DateTo = h.DateFrom
	}
	f, ok1 := parseDate(h.DateFrom)
	t, ok2 := parseDate(h.DateTo)
	if !ok1 || !ok2 || t.Before(f) || h.Name == "" {
		writeErr(w, http.StatusBadRequest, "Zadejte název a platné datum od–do.")
		return
	}
	id := pathID(r)
	var err error
	if id == 0 {
		_, err = a.db.Exec(`INSERT INTO holidays(date_from,date_to,name) VALUES(?,?,?)`, h.DateFrom, h.DateTo, h.Name)
	} else {
		_, err = a.db.Exec(`UPDATE holidays SET date_from=?,date_to=?,name=? WHERE id=?`, h.DateFrom, h.DateTo, h.Name, id)
	}
	if dbErr(w, err) {
		return
	}
	a.audit(currentUser(r).ID, "update", "holiday", nil, fmt.Sprintf("Volno: %s (%s – %s)", h.Name, czDate(h.DateFrom), czDate(h.DateTo)))
	writeJSON(w, map[string]any{"ok": true})
}

func (a *App) handleDeleteHoliday(w http.ResponseWriter, r *http.Request) {
	id := pathID(r)
	var name string
	_ = a.db.QueryRow(`SELECT name FROM holidays WHERE id=?`, id).Scan(&name)
	_, err := a.db.Exec(`DELETE FROM holidays WHERE id=?`, id)
	if dbErr(w, err) {
		return
	}
	a.audit(currentUser(r).ID, "delete", "holiday", nil, "Smazáno volno: "+name)
	writeJSON(w, map[string]any{"ok": true})
}

func (a *App) handleSaveDayNote(w http.ResponseWriter, r *http.Request) {
	date := r.PathValue("date")
	if _, ok := parseDate(date); !ok {
		writeErr(w, http.StatusBadRequest, "Neplatné datum.")
		return
	}
	var body struct {
		Text string `json:"text"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	var err error
	if strings.TrimSpace(body.Text) == "" {
		_, err = a.db.Exec(`DELETE FROM day_notes WHERE date=?`, date)
	} else {
		_, err = a.db.Exec(`INSERT INTO day_notes(date,text,updated_by) VALUES(?,?,?) ON CONFLICT(date) DO UPDATE SET text=excluded.text, updated_by=excluded.updated_by`, date, strings.TrimSpace(body.Text), currentUser(r).ID)
	}
	if dbErr(w, err) {
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}
