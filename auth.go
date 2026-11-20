package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

type User struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
	Name     string `json:"name"`
	Short    string `json:"short"`
	Role     string `json:"role"`
	Active   bool   `json:"active"`
	Email    string `json:"email"`
	// HasPassword is false for accounts that only sign in with Google.
	HasPassword bool `json:"has_password"`
}

var roleRank = map[string]int{"student": 0, "teacher": 1, "coordinator": 2, "admin": 3}

func (u *User) atLeast(role string) bool { return roleRank[u.Role] >= roleRank[role] }

type ctxKey int

const userKey ctxKey = 1

const sessionCookie = "raven_session"
const sessionDays = 30

func randToken(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func hashPassword(p string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(p), bcrypt.DefaultCost)
	return string(b), err
}

func (a *App) userFromRequest(r *http.Request) *User {
	c, err := r.Cookie(sessionCookie)
	if err != nil || c.Value == "" {
		return nil
	}
	u := &User{}
	var active, hasPw int
	err = a.db.QueryRow(`SELECT u.id,u.username,u.name,u.short,u.role,u.active,COALESCE(u.email,''),CASE WHEN u.password_hash<>'' THEN 1 ELSE 0 END
		FROM sessions s JOIN users u ON u.id=s.user_id
		WHERE s.token=? AND s.expires_at>?`, c.Value, time.Now().Unix()).Scan(&u.ID, &u.Username, &u.Name, &u.Short, &u.Role, &active, &u.Email, &hasPw)
	if err != nil || active == 0 {
		return nil
	}
	u.Active = true
	u.HasPassword = hasPw == 1
	return u
}

func currentUser(r *http.Request) *User {
	u, _ := r.Context().Value(userKey).(*User)
	return u
}

// auth wraps a handler: requires a signed-in user with at least the given role.
func (a *App) auth(role string, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u := a.userFromRequest(r)
		if u == nil {
			writeErr(w, http.StatusUnauthorized, "Přihlášení vypršelo. Přihlaste se prosím znovu.")
			return
		}
		if !u.atLeast(role) {
			writeErr(w, http.StatusForbidden, "K této akci nemáte oprávnění.")
			return
		}
		if r.Method != http.MethodGet && !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") && r.Header.Get("X-Raven") != "1" {
			writeErr(w, http.StatusBadRequest, "Neplatný požadavek.")
			return
		}
		h(w, r.WithContext(context.WithValue(r.Context(), userKey, u)))
	}
}

func (a *App) userCount() int {
	var n int
	_ = a.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n)
	return n
}

func clientIP(r *http.Request) string {
	if xf := r.Header.Get("X-Forwarded-For"); xf != "" {
		return strings.TrimSpace(strings.Split(xf, ",")[0])
	}
	host := r.RemoteAddr
	if i := strings.LastIndex(host, ":"); i > 0 {
		host = host[:i]
	}
	return host
}

func (a *App) startSession(w http.ResponseWriter, uid int64) error {
	tok := randToken(32)
	exp := time.Now().Add(sessionDays * 24 * time.Hour)
	if _, err := a.db.Exec(`INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)`, tok, uid, exp.Unix()); err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: tok, Path: "/", Expires: exp, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: a.secure})
	_, _ = a.db.Exec(`DELETE FROM sessions WHERE expires_at<?`, time.Now().Unix())
	return nil
}

func (a *App) handleState(w http.ResponseWriter, r *http.Request) {
	u := a.userFromRequest(r)
	s := a.loadSettings()
	writeJSON(w, map[string]any{"needs_setup": a.userCount() == 0, "setup_code_required": a.setupCode != "", "user": u,
		"school_name": s.SchoolName, "google_client_id": s.GoogleClientID})
}

type credentials struct {
	SetupCode string `json:"setup_code"`
	Name      string `json:"name"`
	Short     string `json:"short"`
	Username  string `json:"username"`
	Password  string `json:"password"`
}

func (a *App) handleSetup(w http.ResponseWriter, r *http.Request) {
	if a.userCount() > 0 {
		writeErr(w, http.StatusConflict, "Aplikace už je nastavena.")
		return
	}
	var c credentials
	if !readJSON(w, r, &c) {
		return
	}
	if a.setupCode != "" && strings.TrimSpace(c.SetupCode) != a.setupCode {
		time.Sleep(800 * time.Millisecond)
		writeErr(w, http.StatusForbidden, "Neplatný kód pro nastavení.")
		return
	}
	c.Username = strings.TrimSpace(c.Username)
	c.Name = strings.TrimSpace(c.Name)
	if c.Username == "" || c.Name == "" || len(c.Password) < 6 {
		writeErr(w, http.StatusBadRequest, "Vyplňte jméno, přihlašovací jméno a heslo (alespoň 6 znaků).")
		return
	}
	h, _ := hashPassword(c.Password)
	id, err := a.db.InsertID(`INSERT INTO users(username,name,short,role,password_hash) VALUES(?,?,?,?,?)`, c.Username, c.Name, strings.ToUpper(strings.TrimSpace(c.Short)), "admin", h)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = a.startSession(w, id)
	writeJSON(w, map[string]any{"ok": true})
}

func (a *App) handleLogin(w http.ResponseWriter, r *http.Request) {
	var c credentials
	if !readJSON(w, r, &c) {
		return
	}
	uname := strings.ToLower(strings.TrimSpace(c.Username))
	ip := clientIP(r)
	cutoff := time.Now().Add(-15 * time.Minute).Unix()
	var byUser, byIP int
	_ = a.db.QueryRow(`SELECT COUNT(*) FROM login_attempts WHERE username=? AND at>?`, uname, cutoff).Scan(&byUser)
	_ = a.db.QueryRow(`SELECT COUNT(*) FROM login_attempts WHERE ip=? AND at>?`, ip, cutoff).Scan(&byIP)
	if byUser >= 8 || byIP >= 30 {
		writeErr(w, http.StatusTooManyRequests, "Příliš mnoho neúspěšných pokusů. Zkuste to prosím za 15 minut.")
		return
	}
	var id int64
	var hash string
	var active int
	err := a.db.QueryRow(`SELECT id,password_hash,active FROM users WHERE lower(username)=? OR lower(email)=?`, uname, uname).Scan(&id, &hash, &active)
	if err == nil && active == 1 && hash != "" && bcrypt.CompareHashAndPassword([]byte(hash), []byte(c.Password)) == nil {
		_, _ = a.db.Exec(`DELETE FROM login_attempts WHERE username=?`, uname)
		if err := a.startSession(w, id); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, map[string]any{"ok": true})
		return
	}
	_, _ = a.db.Exec(`INSERT INTO login_attempts(username,ip,at) VALUES(?,?,?)`, uname, ip, time.Now().Unix())
	_, _ = a.db.Exec(`DELETE FROM login_attempts WHERE at<?`, time.Now().Add(-24*time.Hour).Unix())
	time.Sleep(600 * time.Millisecond)
	if err == nil && active == 0 {
		writeErr(w, http.StatusUnauthorized, "Tento účet je deaktivovaný. Obraťte se na správce.")
		return
	}
	writeErr(w, http.StatusUnauthorized, "Nesprávné přihlašovací jméno nebo heslo.")
}

func (a *App) handleLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		_, _ = a.db.Exec(`DELETE FROM sessions WHERE token=?`, c.Value)
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1})
	writeJSON(w, map[string]any{"ok": true})
}

func (a *App) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	var body struct {
		Old string `json:"old"`
		New string `json:"new"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	var hash string
	_ = a.db.QueryRow(`SELECT password_hash FROM users WHERE id=?`, u.ID).Scan(&hash)
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(body.Old)) != nil {
		writeErr(w, http.StatusBadRequest, "Současné heslo nesouhlasí.")
		return
	}
	if len(body.New) < 6 {
		writeErr(w, http.StatusBadRequest, "Nové heslo musí mít alespoň 6 znaků.")
		return
	}
	h, _ := hashPassword(body.New)
	_, _ = a.db.Exec(`UPDATE users SET password_hash=? WHERE id=?`, h, u.ID)
	writeJSON(w, map[string]any{"ok": true})
}

// ---------- JSON helpers ----------

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": msg})
}

func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		writeErr(w, http.StatusBadRequest, "Neplatná data formuláře.")
		return false
	}
	return true
}

func dbErr(w http.ResponseWriter, err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, sql.ErrNoRows) {
		writeErr(w, http.StatusNotFound, "Záznam nebyl nalezen.")
		return true
	}
	writeErr(w, http.StatusInternalServerError, "Chyba databáze: "+err.Error())
	return true
}
