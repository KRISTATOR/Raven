package main

import (
	"bufio"
	"embed"
	"flag"
	"fmt"
	"html"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
	_ "time/tzdata"
)

//go:embed web
var webFS embed.FS

type App struct {
	db        *DB
	pg        bool   // online mode (Postgres) instead of the local SQLite file
	dataDir   string // local mode only
	dbPath    string // local mode only
	setupCode string // when set, creating the first admin requires this code
	secure    bool   // send cookies only over HTTPS (online mode)
}

func main() {
	port := flag.Int("port", 8080, "port, na kterém aplikace poběží")
	dataDir := flag.String("data", "", "složka s daty (výchozí: vedle .exe)")
	demo := flag.Bool("demo", false, "spustit s ukázkovými daty v samostatné složce")
	noBrowser := flag.Bool("no-browser", false, "neotevírat prohlížeč po spuštění")
	flag.Parse()

	tz := os.Getenv("RAVEN_TZ")
	if tz == "" {
		tz = "Europe/Prague"
	}
	if loc, err := time.LoadLocation(tz); err == nil {
		time.Local = loc
	}

	// Online mode: the hosting platform provides PORT and DATABASE_URL.
	if url := os.Getenv("DATABASE_URL"); url != "" {
		runOnline(url)
		return
	}
	if os.Getenv("VERCEL") != "" {
		runNotConfigured()
		return
	}
	if p := os.Getenv("PORT"); p != "" {
		fmt.Sscan(p, port)
		*noBrowser = true
	}

	exe, _ := os.Executable()
	baseDir := filepath.Dir(exe)
	if *dataDir == "" {
		name := "raven-data"
		if *demo {
			name = "raven-demo"
		}
		*dataDir = filepath.Join(baseDir, name)
	}
	if err := os.MkdirAll(*dataDir, 0o755); err != nil {
		fatal("Nelze vytvořit složku s daty: %v", err)
	}
	dbPath := filepath.Join(*dataDir, "raven.db")
	db, err := openSQLite(dbPath)
	if err != nil {
		fatal("Nelze otevřít databázi: %v", err)
	}
	app := &App{db: db, dataDir: *dataDir, dbPath: dbPath, setupCode: os.Getenv("SETUP_CODE")}
	if *demo && app.userCount() == 0 {
		if err := app.seedDemo(); err != nil {
			fatal("Ukázková data: %v", err)
		}
	}
	go app.backupLoop()

	ln, err := net.Listen("tcp", fmt.Sprintf(":%d", *port))
	if err != nil {
		fatal("Port %d je obsazený (běží už Raven nebo jiný program?).\nSpusťte s jiným portem, např.:  Raven.exe -port 8090\n\n%v", *port, err)
	}

	fmt.Println()
	fmt.Println("  RAVEN  ·  školní plánovač")
	fmt.Println("  ─────────────────────────────────────────────")
	fmt.Println("  Aplikace běží. Učitelé ji otevřou v prohlížeči na adrese:")
	for _, ip := range lanIPs() {
		fmt.Printf("      http://%s:%d\n", ip, *port)
	}
	fmt.Printf("  Na tomto počítači:  http://localhost:%d\n", *port)
	fmt.Printf("  Data:  %s\n", *dataDir)
	if *demo {
		fmt.Println("  REŽIM UKÁZKY – přihlášení: admin / admin123, koordinator / ucitel123, novakova / ucitel123")
	}
	fmt.Println("  Zavřením tohoto okna aplikaci ukončíte.")
	fmt.Println()

	if !*noBrowser {
		go openBrowser(fmt.Sprintf("http://localhost:%d", *port))
	}
	srv := &http.Server{Handler: app.routes(), ReadHeaderTimeout: 10 * time.Second}
	if err := srv.Serve(ln); err != nil {
		fatal("Server skončil: %v", err)
	}
}

func runOnline(url string) {
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	db, err := openPostgres(url)
	if err != nil {
		log.Printf("databáze: %v", err)
		serveConfigPage(port, "Nepodařilo se připojit k databázi. Zkontrolujte proměnnou DATABASE_URL (Session pooler, správné heslo).", err.Error())
		return
	}
	app := &App{db: db, pg: true, setupCode: os.Getenv("SETUP_CODE"), secure: true}
	if port == "" {
		port = "3000"
	}
	if app.setupCode == "" {
		app.setupCode = randToken(16) // never leave first-run setup open on the internet
		log.Printf("SETUP_CODE není nastaven – vytvoření prvního účtu je zablokováno")
	}
	log.Printf("Raven online, port %s", port)
	srv := &http.Server{Addr: ":" + port, Handler: app.routes(), ReadHeaderTimeout: 10 * time.Second}
	log.Fatal(srv.ListenAndServe())
}

func runNotConfigured() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	serveConfigPage(port, "Raven je nasazený, ale ještě není připojený k databázi.", "")
}

// serveConfigPage shows setup instructions until the database is configured.
func serveConfigPage(port, headline, detail string) {
	page := `<!doctype html><html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Raven – nastavení</title>
<style>body{font:16px/1.5 Arial,sans-serif;background:#F4F1E8;color:#16140F;margin:0;padding:24px 16px}main{max-width:640px;margin:6vh auto;border:3px solid #16140F;padding:24px 26px;background:#FBF9F3}
h1{font-size:30px;margin:0 0 6px;letter-spacing:-.01em}ol{padding-left:20px}li{margin:8px 0}code{background:#EBE7DB;padding:1px 5px;font-size:14px}.d{color:#85806F;font-size:13px;word-break:break-all}</style>
<main><h1>RAVEN</h1><p><b>` + html.EscapeString(headline) + `</b></p>
<ol>
<li>V Supabase otevřete projekt <b>sborovna</b> → tlačítko <b>Connect</b> → záložka <b>Session pooler</b> a zkopírujte adresu (začíná <code>postgresql://postgres.</code>).</li>
<li>Místo <code>[YOUR-PASSWORD]</code> doplňte heslo databáze. Pokud ho neznáte: <i>Project Settings → Database → Reset database password</i>.</li>
<li>Ve Vercelu otevřete projekt <b>raven</b> → <i>Settings → Environment Variables</i> a přidejte proměnnou <code>DATABASE_URL</code> s touto adresou.</li>
<li>Zkontrolujte, že existuje i proměnná <code>SETUP_CODE</code> (kód pro vytvoření prvního účtu).</li>
<li>V záložce <i>Deployments</i> dejte u posledního nasazení <b>Redeploy</b>. Po minutě obnovte tuto stránku.</li>
</ol>` + func() string {
		if detail == "" {
			return ""
		}
		return `<p class="d">` + html.EscapeString(detail) + `</p>`
	}() + `</main></html>`
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		if strings.HasPrefix(r.URL.Path, "/api/") {
			writeErr(w, http.StatusServiceUnavailable, headline)
			return
		}
		_, _ = w.Write([]byte(page))
	})
	log.Fatal(http.ListenAndServe(":"+port, h))
}

func fatal(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "\n  CHYBA: "+format+"\n", args...)
	if runtime.GOOS == "windows" {
		fmt.Fprintln(os.Stderr, "\n  Stiskněte Enter pro zavření okna…")
		_, _ = bufio.NewReader(os.Stdin).ReadString('\n')
	}
	os.Exit(1)
}

func lanIPs() []string {
	var out []string
	ifaces, _ := net.Interfaces()
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := ifc.Addrs()
		for _, a := range addrs {
			if ipn, ok := a.(*net.IPNet); ok && ipn.IP.To4() != nil && ipn.IP.IsPrivate() {
				out = append(out, ipn.IP.String())
			}
		}
	}
	sort.Strings(out)
	return out
}

func openBrowser(url string) {
	time.Sleep(700 * time.Millisecond)
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
}

func (a *App) routes() http.Handler {
	mux := http.NewServeMux()
	S, T, C, A := "student", "teacher", "coordinator", "admin"

	mux.HandleFunc("GET /api/state", a.handleState)
	mux.HandleFunc("POST /api/setup", a.handleSetup)
	mux.HandleFunc("POST /api/login", a.handleLogin)
	mux.HandleFunc("POST /api/logout", a.handleLogout)
	mux.HandleFunc("POST /api/auth/google", a.handleGoogleLogin)
	mux.HandleFunc("POST /api/auth/gate", a.handleGate)
	mux.HandleFunc("POST /api/me/password", a.auth(S, a.handleChangePassword))
	mux.HandleFunc("GET /api/bootstrap", a.auth(S, a.handleBootstrap))
	mux.HandleFunc("GET /api/student/goals", a.auth(S, a.handleStudentGoals))
	mux.HandleFunc("PUT /api/settings/gate", a.auth(A, a.handleSaveGate))

	mux.HandleFunc("PUT /api/settings", a.auth(A, a.handleSaveSettings))
	mux.HandleFunc("GET /api/users", a.auth(A, a.handleListUsers))
	mux.HandleFunc("POST /api/users", a.auth(A, a.handleSaveUser))
	mux.HandleFunc("PUT /api/users/{id}", a.auth(A, a.handleSaveUser))

	mux.HandleFunc("POST /api/subjects", a.auth(C, a.handleSaveSubject))
	mux.HandleFunc("PUT /api/subjects/{id}", a.auth(C, a.handleSaveSubject))
	mux.HandleFunc("DELETE /api/subjects/{id}", a.auth(C, a.handleDeleteSubject))
	mux.HandleFunc("POST /api/rooms", a.auth(C, a.handleSaveRoom))
	mux.HandleFunc("PUT /api/rooms/{id}", a.auth(C, a.handleSaveRoom))
	mux.HandleFunc("DELETE /api/rooms/{id}", a.auth(C, a.handleDeleteRoom))

	mux.HandleFunc("POST /api/groups", a.auth(C, a.handleSaveGroup))
	mux.HandleFunc("PUT /api/groups/{id}", a.auth(C, a.handleSaveGroup))
	mux.HandleFunc("DELETE /api/groups/{id}", a.auth(C, a.handleDeleteGroup))
	mux.HandleFunc("POST /api/students", a.auth(C, a.handleSaveStudent))
	mux.HandleFunc("POST /api/students/bulk", a.auth(C, a.handleBulkStudents))
	mux.HandleFunc("PUT /api/students/{id}", a.auth(C, a.handleSaveStudent))
	mux.HandleFunc("DELETE /api/students/{id}", a.auth(C, a.handleDeleteStudent))

	mux.HandleFunc("POST /api/holidays", a.auth(A, a.handleSaveHoliday))
	mux.HandleFunc("PUT /api/holidays/{id}", a.auth(A, a.handleSaveHoliday))
	mux.HandleFunc("DELETE /api/holidays/{id}", a.auth(A, a.handleDeleteHoliday))
	mux.HandleFunc("PUT /api/daynotes/{date}", a.auth(C, a.handleSaveDayNote))

	mux.HandleFunc("GET /api/events", a.auth(S, a.handleListEvents))
	mux.HandleFunc("POST /api/events", a.auth(T, a.handleCreateEvent))
	mux.HandleFunc("PUT /api/events/{id}", a.auth(T, a.handleUpdateEvent))
	mux.HandleFunc("DELETE /api/events/{id}", a.auth(T, a.handleDeleteEvent))
	mux.HandleFunc("POST /api/events/copy-week", a.auth(T, a.handleCopyWeek))

	mux.HandleFunc("GET /api/consultations", a.auth(T, a.handleListConsultations))
	mux.HandleFunc("POST /api/consultations", a.auth(T, a.handleSaveConsultation))
	mux.HandleFunc("PUT /api/consultations/{id}", a.auth(T, a.handleSaveConsultation))
	mux.HandleFunc("DELETE /api/consultations/{id}", a.auth(T, a.handleDeleteConsultation))

	mux.HandleFunc("GET /api/goals", a.auth(T, a.handleListGoals))
	mux.HandleFunc("POST /api/goals", a.auth(T, a.handleSaveGoal))
	mux.HandleFunc("PUT /api/goals/{id}", a.auth(T, a.handleSaveGoal))
	mux.HandleFunc("DELETE /api/goals/{id}", a.auth(T, a.handleDeleteGoal))
	mux.HandleFunc("POST /api/goals/{id}/notes", a.auth(T, a.handleAddGoalNote))
	mux.HandleFunc("DELETE /api/goal-notes/{id}", a.auth(T, a.handleDeleteGoalNote))

	mux.HandleFunc("GET /api/audit", a.auth(C, a.handleListAudit))
	mux.HandleFunc("POST /api/audit/{id}/restore", a.auth(C, a.handleRestore))
	mux.HandleFunc("GET /api/backup", a.auth(A, a.handleBackup))
	mux.HandleFunc("GET /api/export.json", a.auth(A, a.handleExportJSON))
	mux.HandleFunc("POST /api/import.json", a.handleImportJSON)
	mux.HandleFunc("GET /api/excel/export", a.auth(C, a.handleExcelExport))
	mux.HandleFunc("POST /api/excel/import", a.auth(C, a.handleExcelImport))

	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeErr(w, http.StatusNotFound, "Neznámá adresa API.")
	})

	sub, _ := fs.Sub(webFS, "web")
	files := http.FileServer(http.FS(sub))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" || strings.HasSuffix(r.URL.Path, ".html") || strings.HasSuffix(r.URL.Path, ".js") || strings.HasSuffix(r.URL.Path, ".css") {
			w.Header().Set("Cache-Control", "no-cache")
		} else if strings.HasPrefix(r.URL.Path, "/fonts/") || strings.HasPrefix(r.URL.Path, "/vendor/") {
			w.Header().Set("Cache-Control", "public, max-age=604800")
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("X-Frame-Options", "DENY")
		files.ServeHTTP(w, r)
	})
	return logRequests(mux)
}

func logRequests(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("PANIC %s %s: %v", r.Method, r.URL.Path, rec)
				writeErr(w, http.StatusInternalServerError, "Vnitřní chyba serveru.")
			}
		}()
		h.ServeHTTP(w, r)
	})
}
