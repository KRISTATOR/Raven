package main

import (
	"database/sql"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/xuri/excelize/v2"
	"golang.org/x/text/collate"
	"golang.org/x/text/language"
)

const (
	sheetStudents = "Žáci"
	sheetGoals    = "Cíle"
	sheetLists    = "Seznamy"
	sheetHelp     = "Návod"
)

var statusLabels = []string{"probíhá", "splněno", "částečně splněno", "nesplněno", "zrušeno"}
var statusByLabel = map[string]string{"probíhá": "active", "splněno": "achieved", "částečně splněno": "partial", "nesplněno": "not_achieved", "zrušeno": "cancelled"}

func czShortDate(iso string) string {
	t, ok := parseDate(iso)
	if !ok {
		return ""
	}
	return fmt.Sprintf("%d.%d.%d", t.Day(), int(t.Month()), t.Year())
}

// parseCellDate accepts ISO dates, Czech d.m.yyyy and Excel serial numbers.
func parseCellDate(v string) (string, bool) {
	v = strings.TrimSpace(v)
	if v == "" {
		return "", true
	}
	if t, ok := parseDate(v); ok {
		return fmtDate(t), true
	}
	compact := strings.ReplaceAll(v, " ", "")
	for _, layout := range []string{"2.1.2006", "02.01.2006", "2.1.06"} {
		if t, err := time.ParseInLocation(layout, compact, time.Local); err == nil {
			return fmtDate(t), true
		}
	}
	if f, err := strconv.ParseFloat(v, 64); err == nil && f > 20000 && f < 80000 {
		if t, err := excelize.ExcelDateToTime(f, false); err == nil {
			return t.Format("2006-01-02"), true
		}
	}
	return "", false
}

func (a *App) handleExcelExport(w http.ResponseWriter, r *http.Request) {
	f := excelize.NewFile()
	defer f.Close()
	_ = f.SetSheetName("Sheet1", sheetStudents)
	_, _ = f.NewSheet(sheetGoals)
	_, _ = f.NewSheet(sheetLists)
	_, _ = f.NewSheet(sheetHelp)

	head, _ := f.NewStyle(&excelize.Style{
		Font:   &excelize.Font{Bold: true, Color: "#15130F"},
		Fill:   excelize.Fill{Type: "pattern", Color: []string{"#FFE800"}, Pattern: 1},
		Border: []excelize.Border{{Type: "bottom", Color: "#15130F", Style: 2}},
	})
	idStyle, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Color: "#7A766B"}})
	wrap, _ := f.NewStyle(&excelize.Style{Alignment: &excelize.Alignment{WrapText: true, Vertical: "top"}})
	textFmt := "@"
	textStyle, _ := f.NewStyle(&excelize.Style{CustomNumFmt: &textFmt})

	groups := a.listGroups()
	groupName := map[int64]string{}
	for _, g := range groups {
		groupName[g.ID] = g.Name
	}

	// Žáci
	_ = f.SetSheetRow(sheetStudents, "A1", &[]any{"ID", "Příjmení", "Jméno", "Ročník", "Tutorská skupina", "Poznámka", "E-mail"})
	_ = f.SetCellStyle(sheetStudents, "A1", "G1", head)
	students := a.listStudents()
	cz := collate.New(language.Czech, collate.IgnoreCase)
	sort.SliceStable(students, func(i, j int) bool {
		return cz.CompareString(students[i].LastName+" "+students[i].FirstName, students[j].LastName+" "+students[j].FirstName) < 0
	})
	for i, s := range students {
		g := ""
		if s.GroupID != nil {
			g = groupName[*s.GroupID]
		}
		_ = f.SetSheetRow(sheetStudents, fmt.Sprintf("A%d", i+2), &[]any{s.ID, s.LastName, s.FirstName, s.Grade, g, s.Note, s.Email})
	}
	_ = f.SetCellStyle(sheetStudents, "A2", fmt.Sprintf("A%d", len(students)+300), idStyle)
	for col, wdt := range map[string]float64{"A": 7, "B": 18, "C": 16, "D": 9, "E": 22, "F": 34, "G": 30} {
		_ = f.SetColWidth(sheetStudents, col, col, wdt)
	}
	_ = f.SetPanes(sheetStudents, &excelize.Panes{Freeze: true, YSplit: 1, TopLeftCell: "A2", ActivePane: "bottomLeft"})

	// Seznamy (lists for drop-downs)
	_ = f.SetCellValue(sheetLists, "A1", "Tutorské skupiny")
	_ = f.SetCellValue(sheetLists, "B1", "Stav cíle")
	for i, g := range groups {
		_ = f.SetCellValue(sheetLists, fmt.Sprintf("A%d", i+2), g.Name)
	}
	for i, s := range statusLabels {
		_ = f.SetCellValue(sheetLists, fmt.Sprintf("B%d", i+2), s)
	}
	_ = f.SetCellStyle(sheetLists, "A1", "B1", head)
	_ = f.SetColWidth(sheetLists, "A", "B", 24)
	if len(groups) > 0 {
		dv := excelize.NewDataValidation(true)
		dv.Sqref = "E2:E1000"
		dv.SetSqrefDropList(fmt.Sprintf("'%s'!$A$2:$A$%d", sheetLists, len(groups)+1))
		_ = f.AddDataValidation(sheetStudents, dv)
	}

	// Cíle
	_ = f.SetSheetRow(sheetGoals, "A1", &[]any{"ID", "ID žáka", "Žák", "Cíl", "Popis", "Oblast", "Období", "Revize", "Stav"})
	_ = f.SetCellStyle(sheetGoals, "A1", "I1", head)
	type goalRow struct {
		id, sid                                                  int64
		sortKey, name, title, desc, area, period, review, status string
	}
	goalRows := []goalRow{}
	rows, err := a.db.Query(`SELECT g.id,g.student_id,s.last_name||' '||s.first_name,s.first_name||' '||s.last_name,g.title,g.description,g.area,g.period,COALESCE(g.review_date,''),g.status
		FROM goals g JOIN students s ON s.id=g.student_id WHERE g.deleted_at IS NULL AND s.deleted_at IS NULL ORDER BY g.id`)
	if err == nil {
		for rows.Next() {
			var x goalRow
			_ = rows.Scan(&x.id, &x.sid, &x.sortKey, &x.name, &x.title, &x.desc, &x.area, &x.period, &x.review, &x.status)
			goalRows = append(goalRows, x)
		}
		rows.Close()
	}
	sort.SliceStable(goalRows, func(i, j int) bool { return cz.CompareString(goalRows[i].sortKey, goalRows[j].sortKey) < 0 })
	n := len(goalRows)
	for i, x := range goalRows {
		_ = f.SetSheetRow(sheetGoals, fmt.Sprintf("A%d", i+2), &[]any{x.id, x.sid, x.name, x.title, x.desc, x.area, x.period, czShortDate(x.review), goalStatuses[x.status]})
	}
	_ = f.SetCellStyle(sheetGoals, "A2", fmt.Sprintf("B%d", n+300), idStyle)
	_ = f.SetCellStyle(sheetGoals, "E2", fmt.Sprintf("E%d", n+300), wrap)
	_ = f.SetCellStyle(sheetGoals, "H2", fmt.Sprintf("H%d", n+300), textStyle)
	for col, wdt := range map[string]float64{"A": 7, "B": 8, "C": 22, "D": 34, "E": 48, "F": 16, "G": 16, "H": 12, "I": 18} {
		_ = f.SetColWidth(sheetGoals, col, col, wdt)
	}
	_ = f.SetPanes(sheetGoals, &excelize.Panes{Freeze: true, YSplit: 1, TopLeftCell: "A2", ActivePane: "bottomLeft"})
	dv := excelize.NewDataValidation(true)
	dv.Sqref = "I2:I2000"
	dv.SetSqrefDropList(fmt.Sprintf("'%s'!$B$2:$B$%d", sheetLists, len(statusLabels)+1))
	_ = f.AddDataValidation(sheetGoals, dv)

	// Návod
	help := []string{
		"Jak upravovat žáky a cíle v Excelu",
		"",
		"1. Upravte buňky na listech „Žáci“ a „Cíle“. Názvy listů ani pořadí sloupců neměňte.",
		"2. Sloupec ID nechte beze změny. Podle něj aplikace pozná, který záznam upravujete.",
		"3. Nový žák nebo nový cíl = nový řádek s prázdným ID.",
		"4. U nového cíle vyplňte ID žáka, nebo do sloupce „Žák“ napište jeho jméno a příjmení přesně jako na listu Žáci.",
		"5. Tutorskou skupinu a stav cíle vybírejte ze seznamu. Datum revize pište jako 15.1.2027.",
		"6. Smazání řádku v Excelu záznam v aplikaci NESMAŽE. Mazat lze jen v aplikaci (kvůli bezpečnosti).",
		"7. Soubor uložte a nahrajte zpět v aplikaci: Žáci a skupiny → Excel → Nahrát. Před uložením uvidíte přehled změn.",
		"",
		"Exportováno: " + time.Now().Format("2.1.2006 15:04"),
	}
	for i, l := range help {
		_ = f.SetCellValue(sheetHelp, fmt.Sprintf("A%d", i+1), l)
	}
	bold, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true, Size: 14}})
	_ = f.SetCellStyle(sheetHelp, "A1", "A1", bold)
	_ = f.SetColWidth(sheetHelp, "A", "A", 110)
	f.SetActiveSheet(0)

	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="raven-zaci-a-cile-%s.xlsx"`, time.Now().Format("2006-01-02")))
	_ = f.Write(w)
}

type importItem struct {
	Sheet   string   `json:"sheet"`
	Row     int      `json:"row"`
	Label   string   `json:"label"`
	Changes []string `json:"changes,omitempty"`
}

type importError struct {
	Sheet   string `json:"sheet"`
	Row     int    `json:"row"`
	Message string `json:"message"`
}

type studentOp struct {
	id       int64
	s        Student
	fullName string
}

type goalOp struct {
	id         int64
	g          Goal
	newStudent string // resolved after new students are created
}

func cell(row []string, i int) string {
	if i < len(row) {
		return strings.TrimSpace(row[i])
	}
	return ""
}

func normName(s string) string { return strings.ToLower(strings.Join(strings.Fields(s), " ")) }

func (a *App) handleExcelImport(w http.ResponseWriter, r *http.Request) {
	me := currentUser(r)
	apply := r.URL.Query().Get("apply") == "1"
	r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
	f, err := excelize.OpenReader(r.Body, excelize.Options{RawCellValue: true})
	if err != nil {
		writeErr(w, http.StatusBadRequest, "Soubor se nepodařilo přečíst. Nahrajte prosím .xlsx exportovaný z aplikace.")
		return
	}
	defer f.Close()

	errs := []importError{}
	creates, updates := []importItem{}, []importItem{}
	unchanged := 0

	groupByName := map[string]int64{}
	groupName := map[int64]string{}
	for _, g := range a.listGroups() {
		groupByName[normName(g.Name)] = g.ID
		groupName[g.ID] = g.Name
	}
	existing := map[int64]Student{}
	byName := map[string][]int64{}
	for _, s := range a.listStudents() {
		existing[s.ID] = s
		byName[normName(s.FirstName+" "+s.LastName)] = append(byName[normName(s.FirstName+" "+s.LastName)], s.ID)
		byName[normName(s.LastName+" "+s.FirstName)] = append(byName[normName(s.LastName+" "+s.FirstName)], s.ID)
	}
	newNames := map[string]bool{}

	stOps := []studentOp{}
	if rows, err := f.GetRows(sheetStudents); err == nil {
		for i, row := range rows {
			if i == 0 {
				continue
			}
			rn := i + 1
			idS, last, first, gradeS, grp, note := cell(row, 0), cell(row, 1), cell(row, 2), cell(row, 3), cell(row, 4), cell(row, 5)
			email := strings.ToLower(cell(row, 6))
			if idS == "" && last == "" && first == "" {
				continue
			}
			if last == "" || first == "" {
				errs = append(errs, importError{sheetStudents, rn, "Chybí jméno nebo příjmení."})
				continue
			}
			grade := 0
			if gradeS != "" {
				g, err := strconv.Atoi(strings.TrimSuffix(strings.TrimSuffix(gradeS, "."), ".0"))
				if err != nil {
					errs = append(errs, importError{sheetStudents, rn, "Ročník musí být číslo (např. 7)."})
					continue
				}
				grade = g
			}
			var gid *int64
			if grp != "" {
				id, ok := groupByName[normName(grp)]
				if !ok {
					errs = append(errs, importError{sheetStudents, rn, "Neznámá tutorská skupina „" + grp + "“. Nejprve ji založte v aplikaci."})
					continue
				}
				gid = &id
			}
			s := Student{FirstName: first, LastName: last, Grade: grade, GroupID: gid, Note: note, Email: email}
			label := first + " " + last
			if idS == "" {
				stOps = append(stOps, studentOp{0, s, normName(first + " " + last)})
				newNames[normName(first+" "+last)] = true
				newNames[normName(last+" "+first)] = true
				creates = append(creates, importItem{Sheet: sheetStudents, Row: rn, Label: label})
				continue
			}
			id, err := strconv.ParseInt(strings.TrimSuffix(idS, ".0"), 10, 64)
			cur, ok := existing[id]
			if err != nil || !ok {
				errs = append(errs, importError{sheetStudents, rn, "Žák s ID " + idS + " v aplikaci neexistuje. Pro nového žáka nechte ID prázdné."})
				continue
			}
			ch := []string{}
			if cur.FirstName != first || cur.LastName != last {
				ch = append(ch, fmt.Sprintf("jméno: %s %s → %s %s", cur.FirstName, cur.LastName, first, last))
			}
			if cur.Grade != grade {
				ch = append(ch, fmt.Sprintf("ročník: %d → %d", cur.Grade, grade))
			}
			if derefOr(cur.GroupID, 0) != derefOr(gid, 0) {
				ch = append(ch, fmt.Sprintf("skupina: %s → %s", orDash(groupName[derefOr(cur.GroupID, 0)]), orDash(groupName[derefOr(gid, 0)])))
			}
			if cur.Email != email {
				ch = append(ch, fmt.Sprintf("e-mail: %s → %s", orDash(cur.Email), orDash(email)))
			}
			if cur.Note != note {
				ch = append(ch, "poznámka")
			}
			if len(ch) == 0 {
				unchanged++
				continue
			}
			stOps = append(stOps, studentOp{id, s, ""})
			updates = append(updates, importItem{Sheet: sheetStudents, Row: rn, Label: label, Changes: ch})
		}
	} else {
		errs = append(errs, importError{sheetStudents, 0, "List „Žáci“ v souboru chybí."})
	}

	glOps := []goalOp{}
	existingGoals := map[int64]Goal{}
	if rows, err := a.db.Query(`SELECT ` + goalCols + ` FROM goals WHERE deleted_at IS NULL`); err == nil {
		for rows.Next() {
			if g, err := scanGoal(rows); err == nil {
				existingGoals[g.ID] = g
			}
		}
		rows.Close()
	}
	if rows, err := f.GetRows(sheetGoals); err == nil {
		for i, row := range rows {
			if i == 0 {
				continue
			}
			rn := i + 1
			idS, sidS, sname, title, desc, area, period, reviewS, statusS := cell(row, 0), cell(row, 1), cell(row, 2), cell(row, 3), cell(row, 4), cell(row, 5), cell(row, 6), cell(row, 7), cell(row, 8)
			if idS == "" && sidS == "" && title == "" {
				continue
			}
			if title == "" {
				errs = append(errs, importError{sheetGoals, rn, "Chybí název cíle."})
				continue
			}
			review, ok := parseCellDate(reviewS)
			if !ok {
				errs = append(errs, importError{sheetGoals, rn, "Neplatné datum revize „" + reviewS + "“ (pište např. 15.1.2027)."})
				continue
			}
			status := "active"
			if statusS != "" {
				st, ok := statusByLabel[strings.ToLower(statusS)]
				if !ok {
					errs = append(errs, importError{sheetGoals, rn, "Neznámý stav „" + statusS + "“."})
					continue
				}
				status = st
			}
			var sid int64
			pendingName := ""
			if sidS != "" {
				v, err := strconv.ParseInt(strings.TrimSuffix(sidS, ".0"), 10, 64)
				if _, ok := existing[v]; err != nil || !ok {
					errs = append(errs, importError{sheetGoals, rn, "Žák s ID " + sidS + " neexistuje."})
					continue
				}
				sid = v
			} else if ids := byName[normName(sname)]; len(ids) == 1 {
				sid = ids[0]
			} else if len(ids) > 1 {
				errs = append(errs, importError{sheetGoals, rn, "Jméno „" + sname + "“ má více žáků. Vyplňte ID žáka."})
				continue
			} else if newNames[normName(sname)] {
				pendingName = normName(sname)
			} else {
				errs = append(errs, importError{sheetGoals, rn, "Nelze určit žáka. Vyplňte ID žáka nebo přesné jméno."})
				continue
			}
			g := Goal{StudentID: sid, Title: title, Description: desc, Area: area, Period: period, ReviewDate: review, Status: status}
			who := sname
			if sid != 0 {
				who = existing[sid].FirstName + " " + existing[sid].LastName
			}
			label := who + ": " + title
			if idS == "" {
				glOps = append(glOps, goalOp{0, g, pendingName})
				creates = append(creates, importItem{Sheet: sheetGoals, Row: rn, Label: label})
				continue
			}
			id, err := strconv.ParseInt(strings.TrimSuffix(idS, ".0"), 10, 64)
			cur, ok := existingGoals[id]
			if err != nil || !ok {
				errs = append(errs, importError{sheetGoals, rn, "Cíl s ID " + idS + " neexistuje. Pro nový cíl nechte ID prázdné."})
				continue
			}
			if pendingName != "" {
				g.StudentID = cur.StudentID
			}
			ch := []string{}
			if cur.StudentID != g.StudentID {
				ch = append(ch, "žák")
			}
			if cur.Title != g.Title {
				ch = append(ch, "název")
			}
			if cur.Description != g.Description {
				ch = append(ch, "popis")
			}
			if cur.Area != g.Area {
				ch = append(ch, "oblast")
			}
			if cur.Period != g.Period {
				ch = append(ch, "období")
			}
			if cur.ReviewDate != g.ReviewDate {
				ch = append(ch, fmt.Sprintf("revize: %s → %s", orDash(czShortDate(cur.ReviewDate)), orDash(czShortDate(g.ReviewDate))))
			}
			if cur.Status != g.Status {
				ch = append(ch, fmt.Sprintf("stav: %s → %s", goalStatuses[cur.Status], goalStatuses[g.Status]))
			}
			if len(ch) == 0 {
				unchanged++
				continue
			}
			glOps = append(glOps, goalOp{id, g, ""})
			updates = append(updates, importItem{Sheet: sheetGoals, Row: rn, Label: label, Changes: ch})
		}
	} else {
		errs = append(errs, importError{sheetGoals, 0, "List „Cíle“ v souboru chybí."})
	}

	if !apply {
		writeJSON(w, map[string]any{"creates": creates, "updates": updates, "errors": errs, "unchanged": unchanged})
		return
	}

	tx, err := a.db.Begin()
	if dbErr(w, err) {
		return
	}
	defer tx.Rollback()
	created := map[string]int64{}
	for _, op := range stOps {
		s := op.s
		if op.id == 0 {
			nid, err := tx.InsertID(`INSERT INTO students(first_name,last_name,grade,group_id,note,email) VALUES(?,?,?,?,?,?)`, s.FirstName, s.LastName, s.Grade, nullInt(s.GroupID), s.Note, nullStr(s.Email))
			if dbErr(w, err) {
				return
			}
			created[op.fullName] = nid
			created[normName(s.LastName+" "+s.FirstName)] = nid
		} else if _, err := tx.Exec(`UPDATE students SET first_name=?,last_name=?,grade=?,group_id=?,note=?,email=? WHERE id=?`, s.FirstName, s.LastName, s.Grade, nullInt(s.GroupID), s.Note, nullStr(s.Email), op.id); dbErr(w, err) {
			return
		}
	}
	for _, op := range glOps {
		g := op.g
		if op.newStudent != "" {
			g.StudentID = created[op.newStudent]
			if g.StudentID == 0 {
				continue
			}
		}
		var err error
		if op.id == 0 {
			_, err = tx.Exec(`INSERT INTO goals(student_id,title,description,area,period,review_date,status,created_by) VALUES(?,?,?,?,?,?,?,?)`,
				g.StudentID, g.Title, g.Description, g.Area, g.Period, nullStr(g.ReviewDate), g.Status, me.ID)
		} else {
			_, err = tx.Exec(`UPDATE goals SET student_id=?,title=?,description=?,area=?,period=?,review_date=?,status=?,updated_at=? WHERE id=?`,
				g.StudentID, g.Title, g.Description, g.Area, g.Period, nullStr(g.ReviewDate), g.Status, nowStamp(), op.id)
		}
		if dbErr(w, err) {
			return
		}
	}
	if dbErr(w, tx.Commit()) {
		return
	}
	a.audit(me.ID, "update", "import", nil, fmt.Sprintf("Import z Excelu: %d nových, %d upravených záznamů", len(creates), len(updates)))
	writeJSON(w, map[string]any{"ok": true, "created": len(creates), "updated": len(updates), "skipped": len(errs)})
}

func orDash(s string) string {
	if s == "" {
		return "–"
	}
	return s
}

var _ = sql.ErrNoRows
