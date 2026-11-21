package main

import "testing"

func TestSchoolName(t *testing.T) {
	cases := []struct {
		email   string
		trusted []string
		want    string
	}{
		{"jan.novak@zsarcha.cz", nil, "Jan Novak"},
		{"jan.novak@zsarcha.cz", []string{"Jan Novák"}, "Jan Novák"},
		{"jan.novak@zsarcha.cz", []string{"Novák Jan"}, "Jan Novák"},              // surname first
		{"vojta.strobl@zsarcha.cz", []string{"eIndex VojtaŠtrobl"}, "Vojta Štrobl"}, // junk around, no space
		{"jan.novak@zsarcha.cz", []string{"Pepa Zdepa"}, "Jan Novak"},             // a made-up name is ignored
		{"jan.novak@zsarcha.cz", []string{"Jana Nováková"}, "Jan Novak"},          // close is not enough
		{"anna-marie.dvorakova@montetrida.cz", []string{"Anna-Marie Dvořáková"}, "Anna-Marie Dvořáková"},
		{"borivoj.libal2@montetrida.cz", []string{"Bořivoj Líbal"}, "Bořivoj Líbal"}, // digits dropped
		{"petr.van.der.berg@zsarcha.cz", nil, "Petr Van Der Berg"},
	}
	for _, c := range cases {
		f, l, ok := schoolName(c.email, c.trusted...)
		if got := f + " " + l; !ok || got != c.want {
			t.Errorf("%s %v: got %q, want %q", c.email, c.trusted, got, c.want)
		}
	}
	if _, _, ok := schoolName("novak@zsarcha.cz"); ok {
		t.Error("an address without a dot must not produce a name")
	}
}
