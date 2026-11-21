package main

import (
	"fmt"
	"log"
	"strings"
	"unicode"
)

// Names from school e-mail addresses. School addresses are always
// jmeno.prijmeni@domena, so the address – not the name someone typed into their
// Google profile – decides who they are in Raven. The address carries no
// diacritics, so they are borrowed from a trusted spelling (the pupil's record,
// or the Google name) only when its letters match the address exactly.

var foldMap = map[rune]rune{
	'á': 'a', 'ä': 'a', 'č': 'c', 'ď': 'd', 'é': 'e', 'ě': 'e', 'ë': 'e', 'í': 'i', 'ĺ': 'l', 'ľ': 'l',
	'ň': 'n', 'ó': 'o', 'ô': 'o', 'ö': 'o', 'ř': 'r', 'ŕ': 'r', 'š': 's', 'ť': 't', 'ú': 'u', 'ů': 'u',
	'ü': 'u', 'ý': 'y', 'ž': 'z', 'ł': 'l', 'ß': 's',
}

func foldRune(r rune) rune {
	r = unicode.ToLower(r)
	if f, ok := foldMap[r]; ok {
		return f
	}
	return r
}

// emailNameParts reads "jan.novak" → ["jan" "novak"]; hyphens stay inside a part
// ("anna-marie"), digits are dropped. ok is false for addresses without a dot.
func emailNameParts(email string) ([]string, bool) {
	at := strings.LastIndex(email, "@")
	if at <= 0 {
		return nil, false
	}
	var parts []string
	for _, p := range strings.Split(strings.ToLower(email[:at]), ".") {
		p = strings.Map(func(r rune) rune {
			if (r >= 'a' && r <= 'z') || r == '-' {
				return r
			}
			return -1
		}, p)
		p = strings.Trim(p, "-")
		if p != "" {
			parts = append(parts, p)
		}
	}
	return parts, len(parts) >= 2
}

func titleWord(s string) string {
	segs := strings.Split(s, "-")
	for i, g := range segs {
		r := []rune(g)
		if len(r) > 0 {
			r[0] = unicode.ToUpper(r[0])
			segs[i] = string(r)
		}
	}
	return strings.Join(segs, "-")
}

// borrowSpelling finds the address's letters inside a trusted name, ignoring case,
// diacritics, spaces and hyphens, and returns those parts in the original spelling.
// "eIndex VojtaŠtrobl" + [vojta strobl] → [Vojta Štrobl].
func borrowSpelling(src string, parts []string) ([]string, bool) {
	var folded []rune
	var orig []rune
	for _, r := range src {
		if unicode.IsLetter(r) {
			folded = append(folded, foldRune(r))
			orig = append(orig, r)
		}
	}
	want := []rune(strings.ReplaceAll(strings.Join(parts, ""), "-", ""))
	try := func(order []string) ([]string, bool) {
		w := []rune(strings.ReplaceAll(strings.Join(order, ""), "-", ""))
		idx := strings.Index(string(folded), string(w))
		if idx < 0 || len(w) == 0 {
			return nil, false
		}
		start := len([]rune(string(folded)[:idx]))
		out := map[string]string{}
		pos := start
		for _, p := range order {
			n := len([]rune(strings.ReplaceAll(p, "-", "")))
			piece := []rune{}
			k := 0
			for _, c := range p { // re-insert the hyphens the address had
				if c == '-' {
					piece = append(piece, '-')
					continue
				}
				piece = append(piece, orig[pos+k])
				k++
			}
			pos += n
			s := strings.ToLower(string(piece))
			out[p] = titleWord(s)
		}
		res := make([]string, len(parts))
		for i, p := range parts {
			res[i] = out[p]
		}
		return res, true
	}
	if len(want) == 0 {
		return nil, false
	}
	if r, ok := try(parts); ok {
		return r, true
	}
	// "Novák Jan" – surname first
	rev := append(append([]string{}, parts[1:]...), parts[0])
	return try(rev)
}

// schoolName returns "Jméno Příjmení" for a school address, using the first
// trusted spelling that matches the address, else the address itself.
func schoolName(email string, trusted ...string) (first, last string, ok bool) {
	parts, ok := emailNameParts(email)
	if !ok {
		return "", "", false
	}
	for _, t := range trusted {
		if t == "" {
			continue
		}
		if p, ok := borrowSpelling(t, parts); ok {
			return p[0], strings.Join(p[1:], " "), true
		}
	}
	for i := range parts {
		parts[i] = titleWord(parts[i])
	}
	return parts[0], strings.Join(parts[1:], " "), true
}

func (a *App) isSchoolAddress(s Settings, email string) bool {
	return email != "" && (domainIn(email, s.TeacherDomains) || domainIn(email, s.StudentDomains))
}

// trustedSpellings: the pupil record with this address (typed by staff) first,
// then any extra names (e.g. from Google), which only count if they match.
func (a *App) trustedSpellings(email string, extra ...string) []string {
	out := []string{}
	for _, s := range a.listStudents() {
		if s.Email != "" && strings.EqualFold(s.Email, email) {
			out = append(out, s.FirstName+" "+s.LastName)
		}
	}
	return append(out, extra...)
}

// uniqueShort makes a three-letter shortcut from the surname (NOVák → NOV); for staff
// it avoids clashing with other active staff: NOV, then NOJ (two of the surname +
// first-name initial), then NO2, NO3…
func (a *App) uniqueShort(first, last, role string, selfID int64) string {
	up := func(s string) []rune {
		return []rune(strings.ToUpper(strings.Map(func(r rune) rune {
			r = foldRune(r)
			if r >= 'a' && r <= 'z' {
				return r
			}
			return -1
		}, s)))
	}
	l, f := up(last), up(first)
	for len(l) < 3 {
		l = append(l, 'X')
	}
	cands := []string{string(l[:3])}
	if len(f) > 0 {
		cands = append(cands, string(l[:2])+string(f[0]))
	}
	for i := 2; i <= 9; i++ {
		cands = append(cands, fmt.Sprintf("%s%d", string(l[:2]), i))
	}
	if role == "student" {
		return cands[0]
	}
	taken := map[string]bool{}
	for _, u := range a.listUsers(false) {
		if u.ID != selfID && u.Role != "student" && u.Short != "" {
			taken[strings.ToUpper(u.Short)] = true
		}
	}
	for _, c := range cands {
		if !taken[c] {
			return c
		}
	}
	return cands[0]
}

// applySchoolName sets name (and the shortcut, when the name changed or none is set)
// of one account from its school address. Returns true when something changed.
func (a *App) applySchoolName(id int64, email, curName, curShort, role string, extra ...string) bool {
	first, last, ok := schoolName(email, a.trustedSpellings(email, append(extra, curName)...)...)
	if !ok {
		return false
	}
	name := strings.TrimSpace(first + " " + last)
	short := curShort
	if name != curName || short == "" {
		short = a.uniqueShort(first, last, role, id)
	}
	if name == curName && short == curShort {
		return false
	}
	if _, err := a.db.Exec(`UPDATE users SET name=?, short=? WHERE id=?`, name, short, id); err != nil {
		log.Printf("names: %v", err)
		return false
	}
	a.audit(id, "update", "user", []int64{id}, fmt.Sprintf("Jméno podle školního e-mailu: %s → %s (%s)", curName, name, short))
	return true
}

// syncSchoolNames corrects every account with a school address (run at start-up
// and when the setting is switched on).
func (a *App) syncSchoolNames() int {
	s := a.loadSettings()
	if !s.NamesFromEmail {
		return 0
	}
	n := 0
	for _, u := range a.listUsers(true) {
		if a.isSchoolAddress(s, u.Email) && a.applySchoolName(u.ID, strings.ToLower(u.Email), u.Name, u.Short, u.Role) {
			n++
		}
	}
	return n
}
