package main

import (
	"database/sql"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type Event struct {
	ID         int64   `json:"id"`
	Kind       string  `json:"kind"`
	Date       string  `json:"date"`
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
	SeriesID   string  `json:"series_id"`
	Signups    int     `json:"signups"`          // pupils signed up for this class
	Signed     bool    `json:"signed,omitempty"` // the signed-in pupil is going
}

type eventInput struct {
	Event
	RepeatUntil string `json:"repeat_until"`
	Force       bool   `json:"force"`
}

type Conflict struct {
	Date   string `json:"date"`
	Start  int    `json:"start"`
	End    int    `json:"end"`
	Label  string `json:"label"`
	Reason string `json:"reason"`
}

const eventCols = `id,kind,date,start_min,end_min,subject_id,title,room_id,owner_id,capacity,note,COALESCE(series_id,'')`

func scanEvent(sc interface{ Scan(...any) error }) (Event, error) {
	var e Event
	var subj, room sql.NullInt64
	var capa sql.NullInt64
	err := sc.Scan(&e.ID, &e.Kind, &e.Date, &e.Start, &e.End, &subj, &e.Title, &room, &e.OwnerID, &capa, &e.Note, &e.SeriesID)
	if subj.Valid {
		e.SubjectID = &subj.Int64
	}
	if room.Valid {
		e.RoomID = &room.Int64
	}
	if capa.Valid {
		c := int(capa.Int64)
		e.Capacity = &c
	}
	e.TeacherIDs = []int64{}
	e.GroupIDs = []int64{}
	return e, err
}

// attachRelations fills teacher and group ids for the given events.
func (a *App) attachRelations(evs []Event) {
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
	if rows, err := a.db.Query(`SELECT event_id,user_id FROM event_teachers WHERE event_id IN (`+ph+`)`, args...); err == nil {
		for rows.Next() {
			var eid, uid int64
			_ = rows.Scan(&eid, &uid)
			evs[idx[eid]].TeacherIDs = append(evs[idx[eid]].TeacherIDs, uid)
		}
		rows.Close()
	}
	if rows, err := a.db.Query(`SELECT event_id,group_id FROM event_groups WHERE event_id IN (`+ph+`)`, args...); err == nil {
		for rows.Next() {
			var eid, gid int64
			_ = rows.Scan(&eid, &gid)
			evs[idx[eid]].GroupIDs = append(evs[idx[eid]].GroupIDs, gid)
		}
		rows.Close()
	}
}

func (a *App) getEvent(id int64) (Event, error) {
	e, err := scanEvent(a.db.QueryRow(`SELECT `+eventCols+` FROM events WHERE id=? AND deleted_at IS NULL`, id))
	if err != nil {
		return e, err
	}
	list := []Event{e}
	a.attachRelations(list)
	return list[0], nil
}

func (a *App) eventLabel(e Event) string {
	label := e.Title
	if s := a.subjectName(e.SubjectID); s != "" {
		if label != "" {
			label = s + " – " + label
		} else {
			label = s
		}
	}
	if label == "" {
		label = "akce"
	}
	return fmt.Sprintf("%s, %s %s–%s (%s)", label, czDate(e.Date), hm(e.Start), hm(e.End), a.userName(e.OwnerID))
}

func (a *App) handleListEvents(w http.ResponseWriter, r *http.Request) {
	from, to := r.URL.Query().Get("from"), r.URL.Query().Get("to")
	if _, ok := parseDate(from); !ok {
		writeErr(w, http.StatusBadRequest, "Neplatné datum.")
		return
	}
	if _, ok := parseDate(to); !ok {
		writeErr(w, http.StatusBadRequest, "Neplatné datum.")
		return
	}
	evs := []Event{}
	rows, err := a.db.Query(`SELECT `+eventCols+` FROM events WHERE deleted_at IS NULL AND date>=? AND date<=? ORDER BY date,start_min,end_min`, from, to)
	if dbErr(w, err) {
		return
	}
	for rows.Next() {
		e, err := scanEvent(rows)
		if err == nil {
			evs = append(evs, e)
		}
	}
	rows.Close()
	a.attachRelations(evs)
	a.attachSignups(evs, currentUser(r))
	notes := map[string]string{}
	if rows, err := a.db.Query(`SELECT date,text FROM day_notes WHERE date>=? AND date<=?`, from, to); err == nil {
		for rows.Next() {
			var d, t string
			_ = rows.Scan(&d, &t)
			notes[d] = t
		}
		rows.Close()
	}
	writeJSON(w, map[string]any{"events": evs, "notes": notes})
}

// validate normalises an event and checks it against the school rules.
func (a *App) validateEvent(me *User, e *Event, s Settings) string {
	e.Title = strings.TrimSpace(e.Title)
	e.Note = strings.TrimSpace(e.Note)
	switch e.Kind {
	case "lesson", "trip", "other":
	default:
		return "Neznámý typ záznamu."
	}
	if _, ok := parseDate(e.Date); !ok {
		return "Zadejte platné datum."
	}
	if e.Start < 0 || e.End > 24*60 || e.End <= e.Start {
		return "Konec musí být po začátku."
	}
	if e.Kind == "lesson" {
		if (e.SubjectID == nil || *e.SubjectID == 0) && e.Title == "" {
			return "Vyberte předmět nebo zadejte název hodiny."
		}
		if !me.atLeast("admin") && !s.blockFor(e.Start, e.End) {
			ok := false
			for _, l := range s.LessonLengths {
				if e.End-e.Start == l {
					ok = true
				}
			}
			if !ok {
				return fmt.Sprintf("Délka hodiny %d min není povolená. Povolené délky nastavuje správce.", e.End-e.Start)
			}
		}
	} else if e.Title == "" {
		if e.Kind == "trip" {
			return "Zadejte cíl výjezdu."
		}
		return "Zadejte název akce."
	}
	if e.SubjectID != nil && *e.SubjectID == 0 {
		e.SubjectID = nil
	}
	if e.RoomID != nil && *e.RoomID == 0 {
		e.RoomID = nil
	}
	if e.Capacity != nil && *e.Capacity <= 0 {
		e.Capacity = nil
	}
	if !me.atLeast("coordinator") || e.OwnerID == 0 {
		if !me.atLeast("coordinator") && e.OwnerID != 0 && e.OwnerID != me.ID {
			return "Hodiny můžete zakládat jen sami za sebe."
		}
		e.OwnerID = me.ID
	} else {
		var act int
		if err := a.db.QueryRow(`SELECT active FROM users WHERE id=?`, e.OwnerID).Scan(&act); err != nil || act == 0 {
			return "Vybraný vyučující neexistuje nebo je deaktivovaný."
		}
	}
	seen := map[int64]bool{e.OwnerID: true}
	tids := []int64{}
	for _, t := range e.TeacherIDs {
		if !seen[t] {
			seen[t] = true
			tids = append(tids, t)
		}
	}
	e.TeacherIDs = tids
	gseen := map[int64]bool{}
	gids := []int64{}
	for _, g := range e.GroupIDs {
		if !gseen[g] {
			gseen[g] = true
			gids = append(gids, g)
		}
	}
	e.GroupIDs = gids
	return ""
}

func (a *App) findConflicts(dates []string, e Event, exclude []int64) []Conflict {
	out := []Conflict{}
	if len(dates) == 0 {
		return out
	}
	args := []any{}
	for _, d := range dates {
		args = append(args, d)
	}
	args = append(args, e.End, e.Start)
	q := `SELECT ` + eventCols + ` FROM events WHERE deleted_at IS NULL AND date IN (` + placeholders(len(dates)) + `) AND start_min<? AND end_min>?`
	if len(exclude) > 0 {
		q += ` AND id NOT IN (` + placeholders(len(exclude)) + `)`
		for _, x := range exclude {
			args = append(args, x)
		}
	}
	rows, err := a.db.Query(q, args...)
	if err != nil {
		return out
	}
	others := []Event{}
	for rows.Next() {
		if o, err := scanEvent(rows); err == nil {
			others = append(others, o)
		}
	}
	rows.Close()
	a.attachRelations(others)
	mine := map[int64]bool{e.OwnerID: true}
	for _, t := range e.TeacherIDs {
		mine[t] = true
	}
	for _, o := range others {
		reasons := []string{}
		if e.RoomID != nil && o.RoomID != nil && *e.RoomID == *o.RoomID {
			reasons = append(reasons, "stejná místnost")
		}
		theirs := append([]int64{o.OwnerID}, o.TeacherIDs...)
		for _, t := range theirs {
			if mine[t] {
				reasons = append(reasons, "vyučující "+a.userName(t)+" je jinde")
				break
			}
		}
		if len(reasons) > 0 {
			out = append(out, Conflict{Date: o.Date, Start: o.Start, End: o.End, Label: a.eventLabel(o), Reason: strings.Join(reasons, ", ")})
		}
	}
	return out
}

func insertEventTx(tx *Tx, e Event, createdBy int64) (int64, error) {
	var series any
	if e.SeriesID != "" {
		series = e.SeriesID
	}
	var capa any
	if e.Capacity != nil {
		capa = *e.Capacity
	}
	id, err := tx.InsertID(`INSERT INTO events(kind,date,start_min,end_min,subject_id,title,room_id,owner_id,capacity,note,series_id,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
		e.Kind, e.Date, e.Start, e.End, nullInt(e.SubjectID), e.Title, nullInt(e.RoomID), e.OwnerID, capa, e.Note, series, createdBy)
	if err != nil {
		return 0, err
	}
	return id, setRelationsTx(tx, id, e)
}

func setRelationsTx(tx *Tx, id int64, e Event) error {
	if _, err := tx.Exec(`DELETE FROM event_teachers WHERE event_id=?`, id); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM event_groups WHERE event_id=?`, id); err != nil {
		return err
	}
	for _, t := range e.TeacherIDs {
		if _, err := tx.Exec(`INSERT INTO event_teachers(event_id,user_id) VALUES(?,?) ON CONFLICT DO NOTHING`, id, t); err != nil {
			return err
		}
	}
	for _, g := range e.GroupIDs {
		if _, err := tx.Exec(`INSERT INTO event_groups(event_id,group_id) VALUES(?,?) ON CONFLICT DO NOTHING`, id, g); err != nil {
			return err
		}
	}
	return nil
}

func conflictResponse(w http.ResponseWriter, c []Conflict) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusConflict)
	writeJSONBody(w, map[string]any{"error": "Kolize v rozvrhu", "conflicts": c})
}

func (a *App) handleCreateEvent(w http.ResponseWriter, r *http.Request) {
	me := currentUser(r)
	var in eventInput
	if !readJSON(w, r, &in) {
		return
	}
	s := a.loadSettings()
	if msg := a.validateEvent(me, &in.Event, s); msg != "" {
		writeErr(w, http.StatusBadRequest, msg)
		return
	}
	if name, hol := a.isHoliday(in.Date); hol && !me.atLeast("admin") {
		writeErr(w, http.StatusBadRequest, fmt.Sprintf("%s je volno (%s). Na volné dny nelze plánovat.", czDate(in.Date), name))
		return
	}
	dates := []string{in.Date}
	skipped := []string{}
	if in.RepeatUntil != "" {
		until, ok := parseDate(in.RepeatUntil)
		start, _ := parseDate(in.Date)
		if !ok || until.Before(start) {
			writeErr(w, http.StatusBadRequest, "Datum konce opakování je neplatné.")
			return
		}
		for d := start.AddDate(0, 0, 7); !d.After(until) && len(dates) < 60; d = d.AddDate(0, 0, 7) {
			ds := fmtDate(d)
			if _, hol := a.isHoliday(ds); hol {
				skipped = append(skipped, ds)
				continue
			}
			dates = append(dates, ds)
		}
	}
	if msg := a.parallelLimit(dates, in.Event, nil); msg != "" {
		writeErr(w, http.StatusBadRequest, msg)
		return
	}
	if !in.Force {
		if c := a.findConflicts(dates, in.Event, nil); len(c) > 0 {
			conflictResponse(w, c)
			return
		}
	}
	if len(dates) > 1 {
		in.SeriesID = randToken(8)
	} else {
		in.SeriesID = ""
	}
	tx, err := a.db.Begin()
	if dbErr(w, err) {
		return
	}
	defer tx.Rollback()
	ids := []int64{}
	for _, d := range dates {
		e := in.Event
		e.Date = d
		id, err := insertEventTx(tx, e, me.ID)
		if dbErr(w, err) {
			return
		}
		ids = append(ids, id)
	}
	if dbErr(w, tx.Commit()) {
		return
	}
	sum := "Přidáno: " + a.eventLabel(in.Event)
	if len(ids) > 1 {
		sum += fmt.Sprintf(" – opakováno týdně, celkem %d×", len(ids))
	}
	a.audit(me.ID, "create", "event", ids, sum)
	writeJSON(w, map[string]any{"ok": true, "created": len(ids), "skipped": skipped})
}

func canEditEvent(me *User, e Event) bool {
	return me.atLeast("coordinator") || e.OwnerID == me.ID
}

// targets returns the event plus (for scope=following) the later events in its series.
func (a *App) eventTargets(me *User, ev Event, scope string) []Event {
	if scope != "following" || ev.SeriesID == "" {
		return []Event{ev}
	}
	out := []Event{}
	rows, err := a.db.Query(`SELECT `+eventCols+` FROM events WHERE deleted_at IS NULL AND series_id=? AND date>=? ORDER BY date`, ev.SeriesID, ev.Date)
	if err != nil {
		return []Event{ev}
	}
	for rows.Next() {
		if e, err := scanEvent(rows); err == nil && canEditEvent(me, e) {
			out = append(out, e)
		}
	}
	rows.Close()
	return out
}

func (a *App) handleUpdateEvent(w http.ResponseWriter, r *http.Request) {
	me := currentUser(r)
	ev, err := a.getEvent(pathID(r))
	if dbErr(w, err) {
		return
	}
	if !canEditEvent(me, ev) {
		writeErr(w, http.StatusForbidden, "Můžete upravovat jen své vlastní hodiny.")
		return
	}
	var in eventInput
	if !readJSON(w, r, &in) {
		return
	}
	s := a.loadSettings()
	if msg := a.validateEvent(me, &in.Event, s); msg != "" {
		writeErr(w, http.StatusBadRequest, msg)
		return
	}
	oldDay, _ := parseDate(ev.Date)
	newDay, _ := parseDate(in.Date)
	delta := int(newDay.Sub(oldDay).Hours()/24 + 0.5)
	if newDay.Before(oldDay) {
		delta = -int(oldDay.Sub(newDay).Hours()/24 + 0.5)
	}
	targets := a.eventTargets(me, ev, r.URL.Query().Get("scope"))
	dates := []string{}
	exclude := []int64{}
	newDates := map[int64]string{}
	for _, t := range targets {
		d, _ := parseDate(t.Date)
		nd := fmtDate(d.AddDate(0, 0, delta))
		if name, hol := a.isHoliday(nd); hol && !me.atLeast("admin") {
			writeErr(w, http.StatusBadRequest, fmt.Sprintf("%s je volno (%s). Na volné dny nelze plánovat.", czDate(nd), name))
			return
		}
		newDates[t.ID] = nd
		dates = append(dates, nd)
		exclude = append(exclude, t.ID)
	}
	if msg := a.parallelLimit(dates, in.Event, exclude); msg != "" {
		writeErr(w, http.StatusBadRequest, msg)
		return
	}
	if !in.Force {
		if c := a.findConflicts(dates, in.Event, exclude); len(c) > 0 {
			conflictResponse(w, c)
			return
		}
	}
	tx, err := a.db.Begin()
	if dbErr(w, err) {
		return
	}
	defer tx.Rollback()
	var capa any
	if in.Capacity != nil {
		capa = *in.Capacity
	}
	for _, t := range targets {
		_, err := tx.Exec(`UPDATE events SET kind=?,date=?,start_min=?,end_min=?,subject_id=?,title=?,room_id=?,owner_id=?,capacity=?,note=?,updated_at=? WHERE id=?`,
			in.Kind, newDates[t.ID], in.Start, in.End, nullInt(in.SubjectID), in.Title, nullInt(in.RoomID), in.OwnerID, capa, in.Note, nowStamp(), t.ID)
		if dbErr(w, err) {
			return
		}
		if dbErr(w, setRelationsTx(tx, t.ID, in.Event)) {
			return
		}
	}
	if dbErr(w, tx.Commit()) {
		return
	}
	sum := "Upraveno: " + a.eventLabel(in.Event)
	if len(targets) > 1 {
		sum += fmt.Sprintf(" (a další v řadě, celkem %d×)", len(targets))
	}
	a.audit(me.ID, "update", "event", exclude, sum)
	writeJSON(w, map[string]any{"ok": true, "updated": len(targets)})
}

func (a *App) handleDeleteEvent(w http.ResponseWriter, r *http.Request) {
	me := currentUser(r)
	ev, err := a.getEvent(pathID(r))
	if dbErr(w, err) {
		return
	}
	if !canEditEvent(me, ev) {
		writeErr(w, http.StatusForbidden, "Můžete mazat jen své vlastní hodiny.")
		return
	}
	targets := a.eventTargets(me, ev, r.URL.Query().Get("scope"))
	ids := []int64{}
	stamp := nowStamp()
	for _, t := range targets {
		if _, err := a.db.Exec(`UPDATE events SET deleted_at=?,deleted_by=? WHERE id=?`, stamp, me.ID, t.ID); dbErr(w, err) {
			return
		}
		ids = append(ids, t.ID)
	}
	sum := "Smazáno: " + a.eventLabel(ev)
	if len(ids) > 1 {
		sum += fmt.Sprintf(" a další v řadě (celkem %d×)", len(ids))
	}
	a.audit(me.ID, "delete", "event", ids, sum)
	writeJSON(w, map[string]any{"ok": true, "deleted": len(ids)})
}

func (a *App) handleCopyWeek(w http.ResponseWriter, r *http.Request) {
	me := currentUser(r)
	var body struct {
		From  string `json:"from"`
		To    string `json:"to"`
		Scope string `json:"scope"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	from, ok1 := parseDate(body.From)
	to, ok2 := parseDate(body.To)
	if !ok1 || !ok2 || from.Weekday() != time.Monday || to.Weekday() != time.Monday || from.Equal(to) {
		writeErr(w, http.StatusBadRequest, "Vyberte dva různé týdny.")
		return
	}
	if body.Scope == "all" && !me.atLeast("coordinator") {
		writeErr(w, http.StatusForbidden, "Celý týden může kopírovat jen koordinátor nebo správce.")
		return
	}
	q := `SELECT ` + eventCols + ` FROM events WHERE deleted_at IS NULL AND date>=? AND date<=?`
	args := []any{fmtDate(from), fmtDate(from.AddDate(0, 0, 6))}
	if body.Scope != "all" {
		q += ` AND owner_id=?`
		args = append(args, me.ID)
	}
	rows, err := a.db.Query(q, args...)
	if dbErr(w, err) {
		return
	}
	src := []Event{}
	for rows.Next() {
		if e, err := scanEvent(rows); err == nil {
			src = append(src, e)
		}
	}
	rows.Close()
	a.attachRelations(src)
	delta := int(to.Sub(from).Hours()/24 + 0.5)
	if to.Before(from) {
		delta = -int(from.Sub(to).Hours()/24 + 0.5)
	}
	holidayDates := map[string]bool{}
	for i := 0; i < 7; i++ {
		ds := fmtDate(to.AddDate(0, 0, i))
		if _, hol := a.isHoliday(ds); hol {
			holidayDates[ds] = true
		}
	}
	tx, err := a.db.Begin()
	if dbErr(w, err) {
		return
	}
	defer tx.Rollback()
	ids := []int64{}
	skipped := 0
	for _, e := range src {
		d, _ := parseDate(e.Date)
		e.Date = fmtDate(d.AddDate(0, 0, delta))
		if holidayDates[e.Date] {
			skipped++
			continue
		}
		var dup int
		_ = tx.QueryRow(`SELECT COUNT(*) FROM events WHERE deleted_at IS NULL AND owner_id=? AND date=? AND start_min=? AND end_min=? AND kind=? AND title=? AND COALESCE(subject_id,0)=?`,
			e.OwnerID, e.Date, e.Start, e.End, e.Kind, e.Title, derefOr(e.SubjectID, 0)).Scan(&dup)
		if dup > 0 {
			skipped++
			continue
		}
		e.SeriesID = ""
		id, err := insertEventTx(tx, e, me.ID)
		if dbErr(w, err) {
			return
		}
		ids = append(ids, id)
	}
	if dbErr(w, tx.Commit()) {
		return
	}
	scope := "své hodiny"
	if body.Scope == "all" {
		scope = "celý rozvrh"
	}
	if len(ids) > 0 {
		a.audit(me.ID, "create", "event", ids, fmt.Sprintf("Zkopírován týden (%s) z %s do %s, počet položek: %d", scope, czDate(body.From), czDate(body.To), len(ids)))
	}
	writeJSON(w, map[string]any{"ok": true, "created": len(ids), "skipped": skipped})
}

func derefOr(p *int64, d int64) int64 {
	if p == nil {
		return d
	}
	return *p
}

// maxParallel is the most classes that may run at the same time, on any day.
const maxParallel = 5

// parallelLimit returns a message when the new event would make more than maxParallel
// classes run at once on one of the dates. Trips count as classes too.
func (a *App) parallelLimit(dates []string, e Event, exclude []int64) string {
	for _, d := range dates {
		args := []any{d, e.End, e.Start}
		q := `SELECT start_min,end_min FROM events WHERE deleted_at IS NULL AND date=? AND start_min<? AND end_min>?`
		if len(exclude) > 0 {
			q += ` AND id NOT IN (` + placeholders(len(exclude)) + `)`
			for _, x := range exclude {
				args = append(args, x)
			}
		}
		rows, err := a.db.Query(q, args...)
		if err != nil {
			continue
		}
		type span struct{ from, to int }
		spans := []span{{e.Start, e.End}}
		for rows.Next() {
			var from, to int
			_ = rows.Scan(&from, &to)
			spans = append(spans, span{from, to})
		}
		rows.Close()
		// The count can only peak where a class starts, so check those moments inside the new class.
		points := []int{e.Start}
		for _, sp := range spans[1:] {
			if sp.from >= e.Start && sp.from < e.End {
				points = append(points, sp.from)
			}
		}
		for _, p := range points {
			n := 0
			for _, sp := range spans {
				if sp.from <= p && p < sp.to {
					n++
				}
			}
			if n > maxParallel {
				return fmt.Sprintf("V %s v %s by běželo současně %d hodin. Nejvýše %d hodin může běžet současně.", czDate(d), hm(p), n, maxParallel)
			}
		}
	}
	return ""
}
