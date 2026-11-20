# Raven

Školní plánovač pro učitele: rozvrh (paralelní hodiny, výjezdové dny, volné dny), konzultace, osobní cíle žáků, tutorské skupiny, tři úrovně oprávnění (učitel, koordinátor, správce), historie změn s obnovou a import/export žáků a cílů v Excelu.

Jeden program v Go, dva režimy:

| Režim | Jak spustit | Data |
| --- | --- | --- |
| **Online** (Vercel) | proměnné `DATABASE_URL` (Supabase → Connect → Session pooler) a `SETUP_CODE` | Postgres, schéma `raven` |
| **Místně** (školní PC) | `Raven.exe` (dvojklik), učitelé otevřou `http://<ip-počítače>:8080` | soubor `raven-data/raven.db` |

Přesun dat mezi režimy: *Správa → Zálohy → Stáhnout všechna data (.json)* a v nové, prázdné instalaci Ravenu na úvodní obrazovce *Mám zálohu – obnovit data*.

## Vývoj

```bash
go run . -demo -port 8091                                              # místně s ukázkovými daty
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -o Raven.exe .   # Windows .exe
```

Ukázkové účty (`-demo`): `admin / admin123`, `koordinator / ucitel123`, `novakova / ucitel123`.
