package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"math/big"
	"net/http"
	"strings"
	"time"
)

// Signing in from the phone apps. Google does not allow its sign-in inside apps
// (Android WebView, iPhone home-screen web app), so the app asks the server for a
// pending login, opens the phone's browser, the pupil signs in there as usual and
// types the short code the app shows. Meanwhile the app polls with a secret only it
// knows; once the browser approves, the app receives its own session.
//
//	app:     POST /api/auth/app/start            → id, code, secret
//	browser: #/aplikace?id=…  (signed in)  POST /api/auth/app/approve {id, code}
//	app:     POST /api/auth/app/poll {id, secret} → session cookie

const appLoginTTL = 10 * time.Minute
const codeAlphabet = "ACDEFHJKMNPRTUVWXY3479" // no look-alikes (0/O, 1/I/L, 5/S, 8/B…)

func shortCode(n int) string {
	var sb strings.Builder
	for i := 0; i < n; i++ {
		k, _ := rand.Int(rand.Reader, big.NewInt(int64(len(codeAlphabet))))
		sb.WriteByte(codeAlphabet[k.Int64()])
	}
	return sb.String()
}

func sha(s string) string { h := sha256.Sum256([]byte(s)); return hex.EncodeToString(h[:]) }

func (a *App) handleAppLoginStart(w http.ResponseWriter, r *http.Request) {
	now := time.Now().Unix()
	_, _ = a.db.Exec(`DELETE FROM app_logins WHERE expires_at<?`, now)
	var pending int
	_ = a.db.QueryRow(`SELECT COUNT(*) FROM app_logins`).Scan(&pending)
	if pending > 300 {
		writeErr(w, http.StatusTooManyRequests, "Příliš mnoho rozpracovaných přihlášení. Zkus to prosím za pár minut.")
		return
	}
	id, secret, code := randToken(16), randToken(24), shortCode(4)
	if _, err := a.db.Exec(`INSERT INTO app_logins(id,code,secret_hash,expires_at) VALUES(?,?,?,?)`,
		id, code, sha(secret), time.Now().Add(appLoginTTL).Unix()); dbErr(w, err) {
		return
	}
	writeJSON(w, map[string]any{"id": id, "code": code, "secret": secret, "expires_in": int(appLoginTTL.Seconds())})
}

// handleAppLoginInfo tells the browser page whether the request still waits.
func (a *App) handleAppLoginInfo(w http.ResponseWriter, r *http.Request) {
	var uid *int64
	var exp int64
	err := a.db.QueryRow(`SELECT user_id, expires_at FROM app_logins WHERE id=?`, r.URL.Query().Get("id")).Scan(&uid, &exp)
	switch {
	case err != nil || exp < time.Now().Unix():
		writeJSON(w, map[string]any{"state": "expired"})
	case uid != nil:
		writeJSON(w, map[string]any{"state": "approved"})
	default:
		writeJSON(w, map[string]any{"state": "pending"})
	}
}

func (a *App) handleAppLoginApprove(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	var body struct {
		ID   string `json:"id"`
		Code string `json:"code"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	var code string
	var exp int64
	var tries int
	var uid *int64
	if err := a.db.QueryRow(`SELECT code, expires_at, tries, user_id FROM app_logins WHERE id=?`, body.ID).Scan(&code, &exp, &tries, &uid); err != nil || exp < time.Now().Unix() {
		writeErr(w, http.StatusGone, "Tato žádost o přihlášení vypršela. V aplikaci začni znovu.")
		return
	}
	if uid != nil {
		writeErr(w, http.StatusConflict, "Aplikace už je přihlášená.")
		return
	}
	typed := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(body.Code), " ", ""))
	if typed != code {
		tries++
		if tries >= 5 { // a guessing attacker gets five tries, then the request is gone
			_, _ = a.db.Exec(`DELETE FROM app_logins WHERE id=?`, body.ID)
			writeErr(w, http.StatusGone, "Kód byl pětkrát špatně. V aplikaci začni znovu.")
			return
		}
		_, _ = a.db.Exec(`UPDATE app_logins SET tries=? WHERE id=?`, tries, body.ID)
		writeErr(w, http.StatusBadRequest, "Kód nesouhlasí s tím, který ukazuje aplikace.")
		return
	}
	if _, err := a.db.Exec(`UPDATE app_logins SET user_id=? WHERE id=?`, u.ID, body.ID); dbErr(w, err) {
		return
	}
	a.audit(u.ID, "login", "user", []int64{u.ID}, "Přihlášení aplikace na telefonu")
	writeJSON(w, map[string]any{"ok": true})
}

func (a *App) handleAppLoginPoll(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID     string `json:"id"`
		Secret string `json:"secret"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	var hash string
	var exp int64
	var uid *int64
	if err := a.db.QueryRow(`SELECT secret_hash, expires_at, user_id FROM app_logins WHERE id=?`, body.ID).Scan(&hash, &exp, &uid); err != nil || exp < time.Now().Unix() || hash != sha(body.Secret) {
		writeErr(w, http.StatusGone, "Žádost o přihlášení vypršela.")
		return
	}
	if uid == nil {
		writeJSON(w, map[string]any{"state": "pending"})
		return
	}
	var active int
	if err := a.db.QueryRow(`SELECT active FROM users WHERE id=?`, *uid).Scan(&active); err != nil || active == 0 {
		writeErr(w, http.StatusForbidden, "Účet je deaktivovaný.")
		return
	}
	_, _ = a.db.Exec(`DELETE FROM app_logins WHERE id=?`, body.ID) // one use only
	if err := a.startSession(w, *uid); dbErr(w, err) {
		return
	}
	writeJSON(w, map[string]any{"state": "approved"})
}
