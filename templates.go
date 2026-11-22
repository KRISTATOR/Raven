package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// Schedule templates ("šablony rozvrhu"): an admin saves a typical week under a name
// and applies it to any weeks later. Days off are skipped, so a week with a holiday
// gets the template minus that day – nothing has to be deleted by hand.

type templateItem struct {
	Weekday    int     `json:"weekday"` // 1 = Monday … 5 = Friday
	Kind       string  `json:"kind"`
	Start      int     `json:"start"`
	End        int     `json:"end"`
	SubjectID  *int64  `json:"subject_id"`
	Title      string  `json:"title"`
	RoomID     *int64  `json:"room_id"`
	OwnerID    int64   `json:"owner_id"`
	TeacherIDs []int64 `json:"teacher_ids"`
	GroupIDs   []int64 `json:"group_ids"`
	Capacity   *int    `json:"capacity"`
	Note       string  `json:"note"`
}

type scheduleTemplate struct {
	ID        int64          `json:"id"`
	Name      string         `json:"name"`
	Items     []templateItem `json:"items"`
	CreatedAt string         `json:"created_at"`
}

func (a *App) listTemplates() ([]scheduleTemplate, error) {
	rows, err := a.db.Query(`SELECT id, name, items, created_at FROM schedule_templates ORDER BY lower(name)`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []scheduleTemplate{}
	for rows.Next() {
		var t scheduleTemplate
		var raw string
		if err := rows.Scan(&t.ID, &t.Name, &raw, &t.CreatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(raw), &t.Items)
		if t.Items == nil {
			t.Items = []templateItem{}
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (a *App) getTemplate(id int64) (*scheduleTemplate, error) {
	all, err := a.listTemplates()
	if err != nil {
		return nil, err
	}
	for _, t := range all {
		if t.ID == id {
			x := t
			return &x, nil
		}
	}
	return nil, fmt.Errorf("Šablona nenalezena.")
}

// weekEvents returns the classes of the week starting on monday (Mon–Fri).
func (a *App) weekEvents(monday time.Time) ([]Event, error) {
	rows, err := a.db.Query(`SELECT `+eventCols+` FROM events WHERE deleted_at IS NULL AND date>=? AND date<=? ORDER BY date, start_min`,
		fmtDate(monday), fmtDate(monday.AddDate(0, 0, 4)))
	if err != nil {
		return nil, err
	}
	evs := []Event{}
	for rows.Next() {
		if e, err := scanEvent(rows); err == nil {
			evs = append(evs, e)
		}
	}
	rows.Close()
	a.attachRelations(evs)
	return evs, nil
}

func (a *App) handleListTemplates(w http.ResponseWriter, r *http.Request) {
	ts, err := a.listTemplates()
	if dbErr(w, err) {
		return
	}
	writeJSON(w, ts)
}

// handleCreateTemplate saves the classes of one week as a new template.
func (a *App) handleCreateTemplate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
		Week string `json:"week"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	body.Name = strings.TrimSpace(body.Name)
	if body.Name == "" || len([]rune(body.Name)) > 60 {
		writeErr(w, http.StatusBadRequest, "Zadejte název šablony (nejvýše 60 znaků).")
		return
	}
	monday := weekStart(body.Week)
	evs, err := a.weekEvents(monday)
	if dbErr(w, err) {
		return
	}
	items := []templateItem{}
	for _, e := range evs {
		d, _ := parseDate(e.Date)
		items = append(items, templateItem{
			Weekday: (int(d.Weekday())+6)%7 + 1, Kind: e.Kind, Start: e.Start, End: e.End,
			SubjectID: e.SubjectID, Title: e.Title, RoomID: e.RoomID, OwnerID: e.OwnerID,
			TeacherIDs: e.TeacherIDs, GroupIDs: e.GroupIDs, Capacity: e.Capacity, Note: e.Note,
		})
	}
	if len(items) == 0 {
		writeErr(w, http.StatusBadRequest, "V tomto týdnu nejsou žádné hodiny – není z čeho šablonu uložit.")
		return
	}
	raw, _ := json.Marshal(items)
	id, err := a.db.InsertID(`INSERT INTO schedule_templates(name, items, created_by) VALUES(?,?,?)`, body.Name, string(raw), currentUser(r).ID)
	if dbErr(w, err) {
		return
	}
	a.audit(currentUser(r).ID, "create", "template", []int64{id}, fmt.Sprintf("Šablona rozvrhu „%s“ z týdne %s (%d položek)", body.Name, czDate(fmtDate(monday)), len(items)))
	t, _ := a.getTemplate(id)
	writeJSON(w, t)
}

func (a *App) handleRenameTemplate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	body.Name = strings.TrimSpace(body.Name)
	if body.Name == "" || len([]rune(body.Name)) > 60 {
		writeErr(w, http.StatusBadRequest, "Zadejte název šablony (nejvýše 60 znaků).")
		return
	}
	if _, err := a.db.Exec(`UPDATE schedule_templates SET name=?, updated_at=? WHERE id=?`, body.Name, nowStamp(), pathID(r)); dbErr(w, err) {
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

func (a *App) handleDeleteTemplate(w http.ResponseWriter, r *http.Request) {
	t, err := a.getTemplate(pathID(r))
	if err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	if _, err := a.db.Exec(`DELETE FROM schedule_templates WHERE id=?`, t.ID); dbErr(w, err) {
		return
	}
	a.audit(currentUser(r).ID, "delete", "template", nil, fmt.Sprintf("Smazána šablona rozvrhu „%s“", t.Name))
	writeJSON(w, map[string]any{"ok": true})
}

// handleApplyTemplate fills one or more weeks from a template. mode "replace" first
// removes the week's existing classes (they can be restored from the change history);
// mode "add" keeps them and skips template classes that are already there.
func (a *App) handleApplyTemplate(w http.ResponseWriter, r *http.Request) {
	me := currentUser(r)
	t, err := a.getTemplate(pathID(r))
	if err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	var body struct {
		From  string `json:"from"`
		Weeks int    `json:"weeks"`
		Mode  string `json:"mode"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	if body.Weeks < 1 || body.Weeks > 52 {
		writeErr(w, http.StatusBadRequest, "Počet týdnů musí být 1 až 52.")
		return
	}
	if body.Mode != "replace" {
		body.Mode = "add"
	}
	active := map[int64]bool{}
	for _, u := range a.listUsers(false) {
		active[u.ID] = true
	}
	first := weekStart(body.From)
	holiday := map[string]bool{} // looked up before the transaction (SQLite: one writer)
	for i := 0; i < 7*body.Weeks; i++ {
		ds := fmtDate(first.AddDate(0, 0, i))
		if _, hol := a.isHoliday(ds); hol {
			holiday[ds] = true
		}
	}
	tx, err := a.db.Begin()
	if dbErr(w, err) {
		return
	}
	defer tx.Rollback()
	created, removed := []int64{}, []int64{}
	holidaySkips, inactive, dups := 0, 0, 0
	stamp := nowStamp()
	for wk := 0; wk < body.Weeks; wk++ {
		monday := first.AddDate(0, 0, 7*wk)
		if body.Mode == "replace" {
			rows, err := tx.Query(`SELECT id FROM events WHERE deleted_at IS NULL AND date>=? AND date<=?`, fmtDate(monday), fmtDate(monday.AddDate(0, 0, 4)))
			if dbErr(w, err) {
				return
			}
			var ids []int64
			for rows.Next() {
				var id int64
				_ = rows.Scan(&id)
				ids = append(ids, id)
			}
			rows.Close()
			for _, id := range ids {
				if _, err := tx.Exec(`UPDATE events SET deleted_at=?, deleted_by=? WHERE id=?`, stamp, me.ID, id); dbErr(w, err) {
					return
				}
			}
			removed = append(removed, ids...)
		}
		for _, it := range t.Items {
			if it.Weekday < 1 || it.Weekday > 5 {
				continue
			}
			date := fmtDate(monday.AddDate(0, 0, it.Weekday-1))
			if holiday[date] {
				holidaySkips++
				continue
			}
			if !active[it.OwnerID] {
				inactive++
				continue
			}
			if body.Mode == "add" {
				var dup int
				_ = tx.QueryRow(`SELECT COUNT(*) FROM events WHERE deleted_at IS NULL AND owner_id=? AND date=? AND start_min=? AND end_min=? AND kind=? AND title=? AND COALESCE(subject_id,0)=?`,
					it.OwnerID, date, it.Start, it.End, it.Kind, it.Title, derefOr(it.SubjectID, 0)).Scan(&dup)
				if dup > 0 {
					dups++
					continue
				}
			}
			teachers := []int64{}
			for _, id := range it.TeacherIDs {
				if active[id] {
					teachers = append(teachers, id)
				}
			}
			e := Event{Kind: it.Kind, Date: date, Start: it.Start, End: it.End, SubjectID: it.SubjectID, Title: it.Title,
				RoomID: it.RoomID, OwnerID: it.OwnerID, TeacherIDs: teachers, GroupIDs: it.GroupIDs, Capacity: it.Capacity, Note: it.Note}
			id, err := insertEventTx(tx, e, me.ID)
			if dbErr(w, err) {
				return
			}
			created = append(created, id)
		}
	}
	if dbErr(w, tx.Commit()) {
		return
	}
	span := czDate(fmtDate(first))
	if body.Weeks > 1 {
		span += fmt.Sprintf(" a dalších %d týdnů", body.Weeks-1)
	}
	if len(removed) > 0 {
		a.audit(me.ID, "delete", "event", removed, fmt.Sprintf("Nahrazeno šablonou „%s“ (týden %s): odebráno %d položek", t.Name, span, len(removed)))
	}
	if len(created) > 0 {
		a.audit(me.ID, "create", "event", created, fmt.Sprintf("Použita šablona „%s“ (týden %s): přidáno %d položek", t.Name, span, len(created)))
	}
	writeJSON(w, map[string]any{"created": len(created), "removed": len(removed), "holiday_skipped": holidaySkips, "inactive_skipped": inactive, "duplicates": dups})
}

// ---------- days off that land on planned classes ----------

func (a *App) countEventsInRange(from, to string) int {
	var n int
	_ = a.db.QueryRow(`SELECT COUNT(*) FROM events WHERE deleted_at IS NULL AND date>=? AND date<=?`, from, to).Scan(&n)
	return n
}

// handleClearRange cancels every class in a date range (e.g. a newly added holiday);
// they stay restorable from the change history.
func (a *App) handleClearRange(w http.ResponseWriter, r *http.Request) {
	me := currentUser(r)
	var body struct {
		From   string `json:"from"`
		To     string `json:"to"`
		Reason string `json:"reason"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	f, ok1 := parseDate(body.From)
	t, ok2 := parseDate(body.To)
	if !ok1 || !ok2 || t.Before(f) || t.Sub(f) > 120*24*time.Hour {
		writeErr(w, http.StatusBadRequest, "Neplatné období.")
		return
	}
	rows, err := a.db.Query(`SELECT id FROM events WHERE deleted_at IS NULL AND date>=? AND date<=?`, body.From, body.To)
	if dbErr(w, err) {
		return
	}
	var ids []int64
	for rows.Next() {
		var id int64
		_ = rows.Scan(&id)
		ids = append(ids, id)
	}
	rows.Close()
	stamp := nowStamp()
	for _, id := range ids {
		if _, err := a.db.Exec(`UPDATE events SET deleted_at=?, deleted_by=? WHERE id=?`, stamp, me.ID, id); dbErr(w, err) {
			return
		}
	}
	if len(ids) > 0 {
		reason := strings.TrimSpace(body.Reason)
		if reason == "" {
			reason = "volno"
		}
		a.audit(me.ID, "delete", "event", ids, fmt.Sprintf("Zrušeny hodiny %s – %s (%s): %d položek", czDate(body.From), czDate(body.To), reason, len(ids)))
	}
	writeJSON(w, map[string]any{"removed": len(ids)})
}
