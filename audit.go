package main

import (
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

var restorable = map[string]string{"event": "events", "consultation": "consultations", "goal": "goals", "student": "students"}

func (a *App) handleListAudit(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.Query(`SELECT a.id,a.at,COALESCE(u.name,''),a.action,a.entity,a.ids,a.summary,a.restored FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 400`)
	if dbErr(w, err) {
		return
	}
	defer rows.Close()
	type row struct {
		ID         int64  `json:"id"`
		At         string `json:"at"`
		User       string `json:"user"`
		Action     string `json:"action"`
		Entity     string `json:"entity"`
		Summary    string `json:"summary"`
		Restored   bool   `json:"restored"`
		Restorable bool   `json:"restorable"`
	}
	out := []row{}
	for rows.Next() {
		var x row
		var ids string
		var restored int
		_ = rows.Scan(&x.ID, &x.At, &x.User, &x.Action, &x.Entity, &ids, &x.Summary, &restored)
		x.Restored = restored == 1
		_, ok := restorable[x.Entity]
		x.Restorable = ok && x.Action == "delete" && ids != "" && !x.Restored
		out = append(out, x)
	}
	writeJSON(w, out)
}

func (a *App) handleRestore(w http.ResponseWriter, r *http.Request) {
	me := currentUser(r)
	id := pathID(r)
	var entity, ids, summary, action string
	var restored int
	err := a.db.QueryRow(`SELECT entity,ids,summary,action,restored FROM audit WHERE id=?`, id).Scan(&entity, &ids, &summary, &action, &restored)
	if dbErr(w, err) {
		return
	}
	table, ok := restorable[entity]
	if !ok || action != "delete" || ids == "" || restored == 1 {
		writeErr(w, http.StatusBadRequest, "Tento záznam nelze obnovit.")
		return
	}
	list := strings.Split(ids, ",")
	args := make([]any, len(list))
	for i, s := range list {
		n, _ := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
		args[i] = n
	}
	if _, err := a.db.Exec(`UPDATE `+table+` SET deleted_at=NULL WHERE id IN (`+placeholders(len(list))+`)`, args...); dbErr(w, err) {
		return
	}
	_, _ = a.db.Exec(`UPDATE audit SET restored=1 WHERE id=?`, id)
	a.audit(me.ID, "restore", entity, nil, "Obnoveno: "+strings.TrimPrefix(strings.TrimPrefix(strings.TrimPrefix(summary, "Smazáno: "), "Smazána "), "Smazán "))
	writeJSON(w, map[string]any{"ok": true})
}

// ---------- backups ----------

func (a *App) snapshot(path string) error {
	_ = os.Remove(path)
	_, err := a.db.Exec(`VACUUM INTO ?`, path)
	return err
}

func (a *App) handleBackup(w http.ResponseWriter, r *http.Request) {
	if a.pg {
		a.handleExportJSON(w, r)
		return
	}
	tmp := filepath.Join(os.TempDir(), fmt.Sprintf("raven-%d.db", time.Now().UnixNano()))
	if err := a.snapshot(tmp); dbErr(w, err) {
		return
	}
	defer os.Remove(tmp)
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="raven-zaloha-%s.db"`, time.Now().Format("2006-01-02")))
	http.ServeFile(w, r, tmp)
}

// backupLoop keeps one snapshot per day in the "zalohy" folder (last 30 days).
func (a *App) backupLoop() {
	dir := filepath.Join(a.dataDir, "zalohy")
	_ = os.MkdirAll(dir, 0o755)
	for {
		name := filepath.Join(dir, "raven-"+time.Now().Format("2006-01-02")+".db")
		if _, err := os.Stat(name); os.IsNotExist(err) {
			if err := a.snapshot(name); err != nil {
				log.Printf("záloha selhala: %v", err)
			}
			files, _ := filepath.Glob(filepath.Join(dir, "raven-*.db"))
			sort.Strings(files)
			for len(files) > 30 {
				_ = os.Remove(files[0])
				files = files[1:]
			}
		}
		time.Sleep(time.Hour)
	}
}

var _ = sql.ErrNoRows
