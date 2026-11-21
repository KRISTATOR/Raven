package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// Sign-in with Google.
//   teacher domains  -> role "teacher" (created on first sign-in)
//   student domains  -> role "student" (sees the schedule and own goals only)
//   any other e-mail -> must also enter the extra password; passing it grants "admin"
// The extra password is stored only as a bcrypt hash in settings (key "gate").

type googleInfo struct {
	Email string
	Name  string
}

func claimString(m map[string]any, k string) string {
	switch v := m[k].(type) {
	case string:
		return v
	case bool:
		return strconv.FormatBool(v)
	case float64:
		return strconv.FormatInt(int64(v), 10)
	}
	return ""
}

// verifyGoogleToken checks a Google ID token with Google's tokeninfo endpoint.
func verifyGoogleToken(clientID, token string) (*googleInfo, error) {
	base := os.Getenv("GOOGLE_TOKENINFO_URL") // overridable for tests
	if base == "" {
		base = "https://oauth2.googleapis.com/tokeninfo"
	}
	c := &http.Client{Timeout: 8 * time.Second}
	resp, err := c.Get(base + "?id_token=" + url.QueryEscape(token))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("token odmítnut (%d)", resp.StatusCode)
	}
	var m map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&m); err != nil {
		return nil, err
	}
	if claimString(m, "aud") != clientID {
		return nil, fmt.Errorf("token je pro jinou aplikaci")
	}
	if iss := claimString(m, "iss"); iss != "accounts.google.com" && iss != "https://accounts.google.com" {
		return nil, fmt.Errorf("neplatný vydavatel")
	}
	if exp, _ := strconv.ParseInt(claimString(m, "exp"), 10, 64); exp < time.Now().Unix() {
		return nil, fmt.Errorf("token vypršel")
	}
	if claimString(m, "email_verified") != "true" {
		return nil, fmt.Errorf("e-mail není ověřený")
	}
	email := strings.ToLower(strings.TrimSpace(claimString(m, "email")))
	if email == "" {
		return nil, fmt.Errorf("chybí e-mail")
	}
	name := strings.TrimSpace(claimString(m, "name"))
	if name == "" {
		name = email
	}
	return &googleInfo{Email: email, Name: name}, nil
}

func normDomains(s string) string {
	parts := []string{}
	for _, p := range strings.FieldsFunc(strings.ToLower(s), func(r rune) bool { return r == ',' || r == ';' || r == ' ' }) {
		p = strings.TrimPrefix(strings.TrimSpace(p), "@")
		if p != "" {
			parts = append(parts, p)
		}
	}
	return strings.Join(parts, ", ")
}

func domainIn(email, list string) bool {
	at := strings.LastIndex(email, "@")
	if at < 0 {
		return false
	}
	d := email[at+1:]
	for _, p := range strings.Split(normDomains(list), ", ") {
		if p != "" && d == p {
			return true
		}
	}
	return false
}

func roleForEmail(s Settings, email string) string {
	switch {
	case domainIn(email, s.TeacherDomains):
		return "teacher"
	case domainIn(email, s.StudentDomains):
		return "student"
	}
	return ""
}

func shortFromName(name string) string {
	f := strings.Fields(name)
	if len(f) == 0 {
		return ""
	}
	r := []rune(strings.ToUpper(f[len(f)-1]))
	if len(r) > 3 {
		r = r[:3]
	}
	return string(r)
}

// ensureGoogleUser finds the account for an e-mail or creates it with the given role.
func (a *App) ensureGoogleUser(email, name, role string) (int64, error) {
	var id int64
	var active int
	var curName, curShort, curRole string
	s := a.loadSettings()
	fromEmail := s.NamesFromEmail && a.isSchoolAddress(s, email)
	err := a.db.QueryRow(`SELECT id,active,name,COALESCE(short,''),role FROM users WHERE lower(email)=?`, email).Scan(&id, &active, &curName, &curShort, &curRole)
	if err == nil {
		if active == 0 {
			return 0, fmt.Errorf("Tento účet je deaktivovaný. Obraťte se na správce.")
		}
		if fromEmail { // the address decides the name, every time
			a.applySchoolName(id, email, curName, curShort, curRole, name)
		}
		return id, nil
	}
	short := shortFromName(name)
	if fromEmail {
		if f, l, ok := schoolName(email, a.trustedSpellings(email, name)...); ok {
			name = strings.TrimSpace(f + " " + l)
			short = a.uniqueShort(f, l, role, 0)
		}
	}
	username := email
	var n int
	_ = a.db.QueryRow(`SELECT COUNT(*) FROM users WHERE lower(username)=?`, email).Scan(&n)
	if n > 0 {
		username = email + "#" + randToken(3)
	}
	id, err = a.db.InsertID(`INSERT INTO users(username,name,short,role,password_hash,active,email) VALUES(?,?,?,?,'',1,?)`,
		username, name, short, role, email)
	if err != nil {
		return 0, err
	}
	a.audit(id, "create", "user", []int64{id}, fmt.Sprintf("Nový účet přes Google: %s (%s, %s)", name, email, roleLabel(role)))
	return id, nil
}

func (a *App) gateHash() string {
	var h string
	_ = a.db.QueryRow(`SELECT value FROM settings WHERE key='gate'`).Scan(&h)
	return h
}

func (a *App) handleGoogleLogin(w http.ResponseWriter, r *http.Request) {
	s := a.loadSettings()
	if s.GoogleClientID == "" {
		writeErr(w, http.StatusBadRequest, "Přihlášení přes Google zatím není nastavené.")
		return
	}
	var body struct {
		Credential string `json:"credential"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	info, err := verifyGoogleToken(s.GoogleClientID, body.Credential)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "Ověření přes Google se nezdařilo: "+err.Error())
		return
	}
	role := roleForEmail(s, info.Email)
	if role == "" {
		// Not a school address: a second step with the extra password is required.
		if a.gateHash() == "" {
			writeErr(w, http.StatusForbidden, "Přihlásit se lze jen školní e-mailovou adresou.")
			return
		}
		ticket := randToken(24)
		_, _ = a.db.Exec(`DELETE FROM pending_logins WHERE expires_at<?`, time.Now().Unix())
		if _, err := a.db.Exec(`INSERT INTO pending_logins(token,email,name,expires_at) VALUES(?,?,?,?)`,
			ticket, info.Email, info.Name, time.Now().Add(5*time.Minute).Unix()); dbErr(w, err) {
			return
		}
		writeJSON(w, map[string]any{"need_gate": true, "ticket": ticket, "email": info.Email})
		return
	}
	uid, err := a.ensureGoogleUser(info.Email, info.Name, role)
	if err != nil {
		writeErr(w, http.StatusForbidden, err.Error())
		return
	}
	if err := a.startSession(w, uid); dbErr(w, err) {
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

func (a *App) handleGate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Ticket   string `json:"ticket"`
		Password string `json:"password"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	var email, name string
	if err := a.db.QueryRow(`SELECT email,name FROM pending_logins WHERE token=? AND expires_at>?`, body.Ticket, time.Now().Unix()).Scan(&email, &name); err != nil {
		writeErr(w, http.StatusUnauthorized, "Přihlášení vypršelo. Přihlaste se přes Google znovu.")
		return
	}
	key, ip := "gate:"+email, clientIP(r)
	cutoff := time.Now().Add(-15 * time.Minute).Unix()
	var byKey, byIP int
	_ = a.db.QueryRow(`SELECT COUNT(*) FROM login_attempts WHERE username=? AND at>?`, key, cutoff).Scan(&byKey)
	_ = a.db.QueryRow(`SELECT COUNT(*) FROM login_attempts WHERE ip=? AND at>?`, ip, cutoff).Scan(&byIP)
	if byKey >= 5 || byIP >= 30 {
		writeErr(w, http.StatusTooManyRequests, "Příliš mnoho neúspěšných pokusů. Zkuste to prosím za 15 minut.")
		return
	}
	h := a.gateHash()
	if h == "" || bcrypt.CompareHashAndPassword([]byte(h), []byte(body.Password)) != nil {
		_, _ = a.db.Exec(`INSERT INTO login_attempts(username,ip,at) VALUES(?,?,?)`, key, ip, time.Now().Unix())
		time.Sleep(600 * time.Millisecond)
		writeErr(w, http.StatusUnauthorized, "Nesprávné doplňkové heslo.")
		return
	}
	_, _ = a.db.Exec(`DELETE FROM pending_logins WHERE token=?`, body.Ticket)
	_, _ = a.db.Exec(`DELETE FROM login_attempts WHERE username=?`, key)
	uid, err := a.ensureGoogleUser(email, name, "admin")
	if err != nil {
		writeErr(w, http.StatusForbidden, err.Error())
		return
	}
	if err := a.startSession(w, uid); dbErr(w, err) {
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

// handleSaveGate sets (or with an empty password disables) the extra password for non-school addresses.
func (a *App) handleSaveGate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Password string `json:"password"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	if body.Password == "" {
		_, _ = a.db.Exec(`DELETE FROM settings WHERE key='gate'`)
		a.audit(currentUser(r).ID, "update", "settings", nil, "Vypnuto přihlášení mimo školní domény")
		writeJSON(w, map[string]any{"ok": true, "enabled": false})
		return
	}
	if len(body.Password) < 8 {
		writeErr(w, http.StatusBadRequest, "Doplňkové heslo musí mít alespoň 8 znaků.")
		return
	}
	h, _ := hashPassword(body.Password)
	if _, err := a.db.Exec(`INSERT INTO settings(key,value) VALUES('gate',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, h); dbErr(w, err) {
		return
	}
	a.audit(currentUser(r).ID, "update", "settings", nil, "Změněno doplňkové heslo pro adresy mimo školu")
	writeJSON(w, map[string]any{"ok": true, "enabled": true})
}

// ---------- student view ----------

func (a *App) studentRecord(u *User) *Student {
	if u.Email == "" {
		return nil
	}
	for _, s := range a.listStudents() {
		if s.Email != "" && strings.EqualFold(s.Email, u.Email) {
			st := s
			return &st
		}
	}
	return nil
}

func (a *App) studentBootstrap(w http.ResponseWriter, u *User) {
	staff := []User{}
	for _, x := range a.listUsers(true) {
		if x.Role != "student" {
			staff = append(staff, User{ID: x.ID, Name: x.Name, Short: x.Short, Role: x.Role, Active: x.Active})
		}
	}
	students := []Student{}
	if st := a.studentRecord(u); st != nil {
		st.Note = ""
		students = append(students, *st)
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
	groups := a.listGroups()
	for i := range groups {
		groups[i].Note = ""
	}
	writeJSON(w, map[string]any{
		"user": u, "settings": a.loadSettings(), "users": staff, "subjects": subjects, "rooms": rooms,
		"groups": groups, "students": students, "holidays": holidays,
		"mode": map[bool]string{true: "online", false: "local"}[a.pg],
	})
}

func (a *App) handleStudentGoals(w http.ResponseWriter, r *http.Request) {
	st := a.studentRecord(currentUser(r))
	goals := []Goal{}
	if st == nil {
		writeJSON(w, goals)
		return
	}
	rows, err := a.db.Query(`SELECT `+goalCols+` FROM goals WHERE deleted_at IS NULL AND student_id=? AND status<>'cancelled'
		ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, COALESCE(review_date,'9999'), id DESC`, st.ID)
	if dbErr(w, err) {
		return
	}
	for rows.Next() {
		if g, err := scanGoal(rows); err == nil {
			goals = append(goals, g)
		}
	}
	rows.Close()
	for i := range goals {
		if nr, err := a.db.Query(`SELECT id,COALESCE(author_id,0),date,text FROM goal_notes WHERE goal_id=? ORDER BY date DESC, id DESC`, goals[i].ID); err == nil {
			for nr.Next() {
				var n GoalNote
				_ = nr.Scan(&n.ID, &n.AuthorID, &n.Date, &n.Text)
				goals[i].Notes = append(goals[i].Notes, n)
			}
			nr.Close()
		}
	}
	writeJSON(w, goals)
}
