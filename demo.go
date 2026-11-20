package main

import (
	"encoding/json"
	"fmt"
	"time"
)

// seedDemo fills an empty database with a plausible school so the app can be tried out.
func (a *App) seedDemo() (err error) {
	tx, err := a.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	must := func(err error) {
		if err != nil {
			panic(err)
		}
	}
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("%v", r)
		}
	}()

	s := defaultSettings()
	s.SchoolName = "ZŠ Ukázková"
	sb, _ := json.Marshal(s)
	_, err = tx.Exec(`INSERT INTO settings(key,value) VALUES('app',?)`, string(sb))
	must(err)

	adminHash, _ := hashPassword("admin123")
	teachHash, _ := hashPassword("ucitel123")
	type u struct{ user, name, short, role string }
	users := []u{
		{"admin", "Petr Horák", "HOR", "admin"},
		{"koordinator", "Jana Veselá", "VES", "coordinator"},
		{"novakova", "Eva Nováková", "NOV", "teacher"},
		{"dvorak", "Tomáš Dvořák", "DVO", "teacher"},
		{"prochazkova", "Lucie Procházková", "PRO", "teacher"},
		{"cerny", "Martin Černý", "CER", "teacher"},
		{"kralova", "Tereza Králová", "KRA", "teacher"},
		{"benes", "Ondřej Beneš", "BEN", "teacher"},
	}
	uid := map[string]int64{}
	for _, x := range users {
		h := teachHash
		if x.role == "admin" {
			h = adminHash
		}
		newID, err := tx.InsertID(`INSERT INTO users(username,name,short,role,password_hash) VALUES(?,?,?,?,?)`, x.user, x.name, x.short, x.role, h)
		must(err)
		uid[x.user] = newID
	}

	type subj struct{ name, short, color string }
	subjects := []subj{
		{"Čeština", "ČJ", "#FF48B0"}, {"Matematika", "M", "#FFE800"}, {"Chemie", "CH", "#00A95C"},
		{"Angličtina", "AJ", "#5EC8E5"}, {"Dějepis", "D", "#FF6C2F"}, {"Přírodopis", "PŘ", "#67B346"},
		{"Výtvarná výchova", "VV", "#F15060"}, {"Tělesná výchova", "TV", "#0078BF"}, {"Fyzika", "F", "#FFB511"},
		{"Zeměpis", "Z", "#82D8D5"},
	}
	sid := map[string]int64{}
	for _, x := range subjects {
		newID, err := tx.InsertID(`INSERT INTO subjects(name,short,color) VALUES(?,?,?)`, x.name, x.short, x.color)
		must(err)
		sid[x.name] = newID
	}
	rid := map[string]int64{}
	for _, r := range []string{"Velká třída", "Malá třída", "Laboratoř", "Jazyková učebna", "Ateliér", "Tělocvična", "Knihovna"} {
		newID, err := tx.InsertID(`INSERT INTO rooms(name) VALUES(?)`, r)
		must(err)
		rid[r] = newID
	}

	type grp struct{ name, tutor, color string }
	groups := []grp{
		{"Lišky", "novakova", "#FF6C2F"}, {"Sovy", "dvorak", "#0078BF"}, {"Vydry", "prochazkova", "#00A95C"},
		{"Rysi", "cerny", "#FFB511"}, {"Jeřábi", "kralova", "#FF48B0"},
	}
	gid := []int64{}
	for _, g := range groups {
		newID, err := tx.InsertID(`INSERT INTO tutor_groups(name,tutor_id,color) VALUES(?,?,?)`, g.name, uid[g.tutor], g.color)
		must(err)
		id := newID
		gid = append(gid, id)
	}

	first := []string{"Adam", "Barbora", "Daniel", "Ema", "Filip", "Gabriela", "Jakub", "Kateřina", "Lukáš", "Marie", "Matěj", "Natálie", "Ondřej", "Viktorie", "Šimon", "Anna", "Vojtěch", "Tereza", "David", "Klára", "Jan", "Eliška", "Tobiáš", "Nela", "Štěpán"}
	lastM := []string{"Svoboda", "Novotný", "Kučera", "Pokorný", "Marek", "Hájek", "Jelínek", "Růžička", "Fiala", "Sedláček", "Doležal", "Zeman", "Kolář", "Navrátil", "Čermák"}
	lastF := []string{"Svobodová", "Novotná", "Kučerová", "Pokorná", "Marková", "Hájková", "Jelínková", "Růžičková", "Fialová", "Sedláčková", "Doležalová", "Zemanová", "Kolářová", "Navrátilová", "Čermáková"}
	female := map[string]bool{"Barbora": true, "Ema": true, "Gabriela": true, "Kateřina": true, "Marie": true, "Natálie": true, "Viktorie": true, "Anna": true, "Tereza": true, "Klára": true, "Eliška": true, "Nela": true}
	studentIDs := []int64{}
	for i := 0; i < 50; i++ {
		fn := first[(i*7)%len(first)]
		ln := lastM[(i*5+i/3)%len(lastM)]
		if female[fn] {
			ln = lastF[(i*5+i/3)%len(lastF)]
		}
		grade := []int{7, 8, 9}[i%3]
		newID, err := tx.InsertID(`INSERT INTO students(first_name,last_name,grade,group_id) VALUES(?,?,?,?)`, fn, ln, grade, gid[i%len(gid)])
		must(err)
		id := newID
		studentIDs = append(studentIDs, id)
	}

	now := time.Now()
	monday := now.AddDate(0, 0, -((int(now.Weekday()) + 6) % 7))
	year := now.Year()
	if now.Month() < 9 {
		year--
	}
	hol := []struct{ from, to, name string }{
		{fmt.Sprintf("%d-09-28", year), fmt.Sprintf("%d-09-28", year), "Den české státnosti"},
		{fmt.Sprintf("%d-10-28", year), fmt.Sprintf("%d-10-28", year), "Vznik Československa"},
		{fmt.Sprintf("%d-10-29", year), fmt.Sprintf("%d-10-30", year), "Podzimní prázdniny"},
		{fmt.Sprintf("%d-11-17", year), fmt.Sprintf("%d-11-17", year), "Den boje za svobodu a demokracii"},
		{fmt.Sprintf("%d-12-23", year), fmt.Sprintf("%d-01-03", year+1), "Vánoční prázdniny"},
	}
	for _, h := range hol {
		_, err := tx.Exec(`INSERT INTO holidays(date_from,date_to,name) VALUES(?,?,?)`, h.from, h.to, h.name)
		must(err)
	}
	isHol := func(d string) bool {
		for _, h := range hol {
			if d >= h.from && d <= h.to {
				return true
			}
		}
		return false
	}

	type les struct {
		day          int
		start, len   int
		subj, room   string
		teacher, ttl string
	}
	t := func(h, m int) int { return h*60 + m }
	week := []les{
		{0, t(8, 20), 110, "Čeština", "Velká třída", "novakova", "Sloh: popis děje"},
		{0, t(8, 20), 40, "Matematika", "Malá třída", "dvorak", "Lineární rovnice"},
		{0, t(9, 30), 40, "Chemie", "Laboratoř", "prochazkova", ""},
		{0, t(10, 30), 55, "Angličtina", "Jazyková učebna", "kralova", ""},
		{0, t(10, 30), 90, "Dějepis", "Knihovna", "cerny", "Národní obrození"},
		{0, t(13, 0), 90, "Výtvarná výchova", "Ateliér", "benes", "Linoryt"},
		{1, t(8, 20), 55, "Matematika", "Malá třída", "dvorak", ""},
		{1, t(8, 20), 110, "Přírodopis", "Laboratoř", "prochazkova", "Botanika v terénu"},
		{1, t(9, 25), 45, "Fyzika", "Malá třída", "benes", ""},
		{1, t(10, 30), 55, "Čeština", "Velká třída", "novakova", "Mluvnice"},
		{1, t(13, 0), 60, "Tělesná výchova", "Tělocvična", "cerny", ""},
		{2, t(8, 20), 110, "Matematika", "Velká třída", "dvorak", "Projekt: rozpočet třídy"},
		{2, t(8, 20), 40, "Angličtina", "Jazyková učebna", "kralova", ""},
		{2, t(9, 30), 40, "Zeměpis", "Knihovna", "cerny", ""},
		{2, t(10, 30), 90, "Čeština", "Velká třída", "novakova", "Čtenářská dílna"},
		{2, t(13, 0), 55, "Chemie", "Laboratoř", "prochazkova", "Pokusy"},
		{3, t(8, 20), 55, "Dějepis", "Knihovna", "cerny", ""},
		{3, t(8, 20), 110, "Angličtina", "Jazyková učebna", "kralova", "Konverzace"},
		{3, t(9, 25), 45, "Matematika", "Malá třída", "dvorak", ""},
		{3, t(10, 30), 55, "Fyzika", "Laboratoř", "benes", ""},
		{3, t(13, 0), 90, "Tělesná výchova", "Tělocvična", "cerny", "Florbal"},
	}
	ins := func(kind, date string, start, end int, subj *int64, title string, room *int64, owner int64, extra []int64, groups []int64, note string, series string) {
		var ser any
		if series != "" {
			ser = series
		}
		newID, err := tx.InsertID(`INSERT INTO events(kind,date,start_min,end_min,subject_id,title,room_id,owner_id,note,series_id,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
			kind, date, start, end, nullInt(subj), title, nullInt(room), owner, note, ser, owner)
		must(err)
		id := newID
		for _, x := range extra {
			_, err := tx.Exec(`INSERT INTO event_teachers(event_id,user_id) VALUES(?,?) ON CONFLICT DO NOTHING`, id, x)
			must(err)
		}
		for _, g := range groups {
			_, err := tx.Exec(`INSERT INTO event_groups(event_id,group_id) VALUES(?,?)`, id, g)
			must(err)
		}
	}
	series := map[int]string{}
	for i := range week {
		series[i] = randToken(8)
	}
	for w := -1; w <= 3; w++ {
		base := monday.AddDate(0, 0, 7*w)
		for i, l := range week {
			d := fmtDate(base.AddDate(0, 0, l.day))
			if isHol(d) {
				continue
			}
			sj, rm := sid[l.subj], rid[l.room]
			ins("lesson", d, l.start, l.start+l.len, &sj, l.ttl, &rm, uid[l.teacher], nil, nil, "", series[i])
		}
		fri := fmtDate(base.AddDate(0, 0, 4))
		if isHol(fri) {
			continue
		}
		ins("trip", fri, t(8, 20), t(12, 0), nil, "Národní galerie – Veletržní palác", nil, uid["benes"], []int64{uid["kralova"]}, []int64{gid[0], gid[1]}, "Sraz 8:10 před školou, jízdenky zajištěny.", "")
		ins("trip", fri, t(8, 20), t(15, 0), nil, "Školní farma", nil, uid["prochazkova"], []int64{uid["cerny"]}, []int64{gid[2], gid[3]}, "Pracovní oblečení a holínky. Oběd na farmě.", "")
		ins("trip", fri, t(8, 30), t(12, 0), nil, "Procházka centrem: Staré Město", nil, uid["novakova"], nil, []int64{gid[4]}, "Pracovní listy s sebou.", "")
		sj, rm := sid["Matematika"], rid["Malá třída"]
		ins("lesson", fri, t(13, 0), t(14, 30), &sj, "Doučování", &rm, uid["dvorak"], nil, nil, "Pro ty, kdo se vrátí v poledne.", "")
		sj2, rm2 := sid["Čeština"], rid["Knihovna"]
		ins("lesson", fri, t(13, 0), t(14, 30), &sj2, "Čtenářská dílna", &rm2, uid["novakova"], nil, nil, "", "")
	}
	_, err = tx.Exec(`INSERT INTO day_notes(date,text,updated_by) VALUES(?,?,?)`, fmtDate(monday.AddDate(0, 0, 9)), "Focení tříd 10:30–11:30 v knihovně", uid["koordinator"])
	must(err)

	day := func(off int) string {
		d := now.AddDate(0, 0, off)
		for d.Weekday() == time.Saturday || d.Weekday() == time.Sunday {
			d = d.AddDate(0, 0, 1)
		}
		return fmtDate(d)
	}
	cons := []struct {
		off     int
		start   int
		st      int
		teacher string
		kind    string
		who     string
		topic   string
		notes   string
		agree   string
		follow  int
		status  string
		conf    int
	}{
		{-12, t(15, 30), 0, "novakova", "parents", "matka, tutor", "Domácí příprava a zapomínání úkolů", "Rodiče potvrzují, že doma chybí pevný režim. Žák souhlasí s plánovačem.", "Týdenní plánovač, kontrola každý pátek tutorem.", 9, "done", 0},
		{-5, t(14, 0), 3, "dvorak", "student", "žák, tutor", "Osobní cíl – matematika", "Rozebrali jsme poslední test, slabé místo jsou zlomky.", "2× týdně doučování v pátek odpoledne.", 16, "done", 0},
		{-2, t(16, 0), 7, "kralova", "parents", "otec, tutor, výchovná poradkyně", "Vztahy ve skupině", "Citlivá situace ve skupině, podrobnosti u výchovné poradkyně.", "Sledovat, další schůzka za 3 týdny.", 21, "done", 1},
		{2, t(15, 0), 12, "prochazkova", "parents", "matka, tutor", "Volba střední školy", "", "", 0, "planned", 0},
		{4, t(14, 30), 18, "cerny", "team", "tutor, koordinátor, AJ", "Podpora při výuce angličtiny", "", "", 0, "planned", 0},
		{8, t(15, 30), 24, "novakova", "parents", "rodiče", "Pololetní hodnocení cílů", "", "", 0, "planned", 0},
		{-20, t(15, 0), 30, "benes", "student", "žák", "Portfolio z výtvarné výchovy", "Portfolio je téměř hotové, chybí reflexe.", "Dopsat reflexi do konce měsíce.", -3, "done", 0},
	}
	for _, c := range cons {
		var follow any
		if c.follow != 0 {
			follow = day(c.follow)
		}
		_, err := tx.Exec(`INSERT INTO consultations(date,start_min,student_id,teacher_id,kind,participants,topic,notes,agreements,follow_up,status,confidential) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
			day(c.off), c.start, studentIDs[c.st], uid[c.teacher], c.kind, c.who, c.topic, c.notes, c.agree, follow, c.status, c.conf)
		must(err)
	}

	period := fmt.Sprintf("1. pololetí %d/%02d", year, (year+1)%100)
	goals := []struct {
		st                int
		title, desc, area string
		review            int
		status            string
		by                string
		notes             []string
	}{
		{0, "Odevzdávat úkoly včas", "Používám týdenní plánovač a každý pátek ho ukážu tutorce.", "Organizace a samostatnost", 9, "active", "novakova", []string{"Tento týden vše odevzdáno.", "Plánovač založen, první týden zatím s připomínáním."}},
		{0, "Přečíst dvě knihy za pololetí", "Vybírám si sám, o každé krátce povím ve skupině.", "Čtení", 40, "active", "novakova", []string{"První kniha rozečtená (Hobit)."}},
		{5, "Zvládnout zlomky", "Umím sčítat a odčítat zlomky s různým jmenovatelem.", "Matematika", 16, "active", "novakova", nil},
		{3, "Zapojovat se v ranním kruhu", "Aspoň jednou týdně něco řeknu nebo navrhnu.", "Komunikace", 5, "active", "dvorak", []string{"Ve středu sama navrhla téma kruhu."}},
		{8, "Připravit prezentaci o farmě", "Fotky a krátké povídání z pátečních výjezdů.", "Projekt", -2, "achieved", "dvorak", []string{"Prezentováno celé škole, výborné."}},
		{2, "Lépe zvládat konflikty", "Když se rozčílím, odejdu na chvíli a pak to vyřeším slovy.", "Vztahy", 21, "partial", "prochazkova", []string{"Dvě situace zvládnuté, jedna ne."}},
		{12, "Zlepšit se v angličtině – mluvení", "Každý týden 10 minut konverzace s vyučující.", "Angličtina", 30, "active", "prochazkova", nil},
		{9, "Dokončit portfolio", "Portfolio z VV včetně reflexe.", "Výtvarná výchova", -3, "active", "cerny", nil},
	}
	for _, g := range goals {
		newID, err := tx.InsertID(`INSERT INTO goals(student_id,title,description,area,period,review_date,status,created_by) VALUES(?,?,?,?,?,?,?,?)`,
			studentIDs[g.st], g.title, g.desc, g.area, period, day(g.review), g.status, uid[g.by])
		must(err)
		gidn := newID
		for i, n := range g.notes {
			_, err := tx.Exec(`INSERT INTO goal_notes(goal_id,author_id,date,text) VALUES(?,?,?,?)`, gidn, uid[g.by], day(-2-7*i), n)
			must(err)
		}
	}
	if err != nil {
		return err
	}
	return tx.Commit()
}
