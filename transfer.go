package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// Full data export/import (JSON). Lets a school move between the online
// version and a local Raven.exe without losing anything.

type tableDef struct {
	name  string
	cols  []string
	hasID bool
}

var transferTables = []tableDef{
	{"users", []string{"id", "username", "name", "short", "role", "password_hash", "active", "created_at", "email"}, true},
	{"settings", []string{"key", "value"}, false},
	{"subjects", []string{"id", "name", "short", "color"}, true},
	{"rooms", []string{"id", "name"}, true},
	{"tutor_groups", []string{"id", "name", "tutor_id", "color", "note"}, true},
	{"students", []string{"id", "first_name", "last_name", "grade", "group_id", "note", "deleted_at", "email"}, true},
	{"holidays", []string{"id", "date_from", "date_to", "name"}, true},
	{"day_notes", []string{"date", "text", "updated_by"}, false},
	{"events", []string{"id", "kind", "date", "start_min", "end_min", "subject_id", "title", "room_id", "owner_id", "capacity", "note", "series_id", "created_by", "created_at", "updated_at", "deleted_at", "deleted_by"}, true},
	{"event_teachers", []string{"event_id", "user_id"}, false},
	{"event_groups", []string{"event_id", "group_id"}, false},
	{"event_signups", []string{"event_id", "student_id", "created_at"}, false},
	{"student_alerts", []string{"student_id", "subject_id", "min_minutes", "max_minutes"}, false},
	{"schedule_templates", []string{"id", "name", "items", "created_by", "created_at", "updated_at"}, true},
	{"consultations", []string{"id", "date", "start_min", "student_id", "teacher_id", "kind", "participants", "topic", "notes", "agreements", "follow_up", "status", "confidential", "created_at", "updated_at", "deleted_at", "deleted_by"}, true},
	{"goals", []string{"id", "student_id", "title", "description", "area", "period", "review_date", "status", "created_by", "created_at", "updated_at", "deleted_at", "deleted_by"}, true},
	{"goal_notes", []string{"id", "goal_id", "author_id", "date", "text", "created_at"}, true},
	{"audit", []string{"id", "at", "user_id", "action", "entity", "ids", "summary", "restored"}, true},
}

type exportFile struct {
	Format     string                      `json:"format"`
	Version    int                         `json:"version"`
	ExportedAt string                      `json:"exported_at"`
	Tables     map[string][]map[string]any `json:"tables"`
}

func (a *App) handleExportJSON(w http.ResponseWriter, r *http.Request) {
	out := exportFile{Format: "raven", Version: 1, ExportedAt: nowStamp(), Tables: map[string][]map[string]any{}}
	for _, t := range transferTables {
		where := ""
		if t.name == "settings" {
			where = ` WHERE key NOT IN ('ai_key','ai_key_hint')` // encrypted for this server only
		}
		rows, err := a.db.Query(`SELECT ` + strings.Join(t.cols, ",") + ` FROM ` + t.name + where + ` ORDER BY 1`)
		if dbErr(w, err) {
			return
		}
		list := []map[string]any{}
		for rows.Next() {
			vals := make([]any, len(t.cols))
			ptrs := make([]any, len(t.cols))
			for i := range vals {
				ptrs[i] = &vals[i]
			}
			if err := rows.Scan(ptrs...); err != nil {
				rows.Close()
				dbErr(w, err)
				return
			}
			m := map[string]any{}
			for i, c := range t.cols {
				if b, ok := vals[i].([]byte); ok {
					m[c] = string(b)
				} else {
					m[c] = vals[i]
				}
			}
			list = append(list, m)
		}
		rows.Close()
		out.Tables[t.name] = list
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="raven-data-%s.json"`, time.Now().Format("2006-01-02")))
	enc := json.NewEncoder(w)
	enc.SetIndent("", " ")
	_ = enc.Encode(out)
}

func jsonValue(v any) any {
	switch x := v.(type) {
	case json.Number:
		if i, err := x.Int64(); err == nil {
			return i
		}
		f, _ := x.Float64()
		return f
	case bool:
		if x {
			return int64(1)
		}
		return int64(0)
	case string, nil:
		return x
	default:
		b, _ := json.Marshal(x)
		return string(b)
	}
}

// handleImportJSON restores a full export into an EMPTY database (first run only).
func (a *App) handleImportJSON(w http.ResponseWriter, r *http.Request) {
	if a.userCount() > 0 {
		writeErr(w, http.StatusConflict, "Obnovit ze zálohy lze jen do prázdné aplikace (před vytvořením prvního účtu).")
		return
	}
	if a.setupCode != "" && strings.TrimSpace(r.Header.Get("X-Setup-Code")) != a.setupCode {
		time.Sleep(800 * time.Millisecond)
		writeErr(w, http.StatusForbidden, "Neplatný kód pro nastavení.")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 60<<20)
	dec := json.NewDecoder(r.Body)
	dec.UseNumber()
	var in exportFile
	if err := dec.Decode(&in); err != nil || (in.Format != "raven" && in.Format != "sborovna") {
		writeErr(w, http.StatusBadRequest, "Soubor není záloha Ravenu (.json).")
		return
	}
	if len(in.Tables["users"]) == 0 {
		writeErr(w, http.StatusBadRequest, "Záloha neobsahuje žádné účty.")
		return
	}
	tx, err := a.db.Begin()
	if dbErr(w, err) {
		return
	}
	defer tx.Rollback()
	total := 0
	for _, t := range transferTables {
		allowed := map[string]bool{}
		for _, c := range t.cols {
			allowed[c] = true
		}
		for _, row := range in.Tables[t.name] {
			cols, args := []string{}, []any{}
			for _, c := range t.cols {
				if v, ok := row[c]; ok && allowed[c] {
					cols = append(cols, c)
					args = append(args, jsonValue(v))
				}
			}
			if len(cols) == 0 {
				continue
			}
			q := `INSERT INTO ` + t.name + `(` + strings.Join(cols, ",") + `) VALUES(` + placeholders(len(cols)) + `)`
			if _, err := tx.Exec(q, args...); err != nil {
				writeErr(w, http.StatusBadRequest, fmt.Sprintf("Chyba v tabulce %s: %v", t.name, err))
				return
			}
			total++
		}
	}
	if a.pg {
		for _, t := range transferTables {
			if t.hasID {
				if _, err := tx.Exec(`SELECT setval(pg_get_serial_sequence('` + t.name + `','id'), (SELECT COALESCE(MAX(id),0)+1 FROM ` + t.name + `), false)`); dbErr(w, err) {
					return
				}
			}
		}
	}
	if dbErr(w, tx.Commit()) {
		return
	}
	a.audit(0, "update", "import", nil, fmt.Sprintf("Obnovena data ze zálohy (%s), záznamů: %d", in.ExportedAt, total))
	writeJSON(w, map[string]any{"ok": true, "rows": total})
}
