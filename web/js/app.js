import { html, render, useState, useEffect, useMemo, useCallback, useRef, Ctx, api, useHash, go, Modal, Field, ErrorLine, ROLE_LABEL, atLeast } from './lib.js';
import { Dashboard } from './dashboard.js';
import { SchedulePage } from './schedule.js';
import { ConsultationsPage } from './consultations.js';
import { GoalsPage } from './goals.js';
import { PeoplePage } from './people.js';
import { AdminPage } from './admin.js';
import { MyGoalsPage } from './student.js';
import { AboutPage } from './about.js';
import { AssistantPage } from './assistant.js';
import { LoadPage } from './load.js';
import { StudentCardPage } from './card.js';
import { PhoneShell, PhoneSchedule, useIsPhone } from './phone.js';
import { Mark, ThemeToggle, NEEDS_BROWSER_LOGIN, IN_ANDROID_APP, openInBrowser } from './lib.js';

function Wordmark({ small }) {
  return html`<span class=${'wordmark' + (small ? ' wordmark-s' : '')} aria-label="Raven"><${Mark} /><span>Raven</span></span>`;
}

function AuthFrame({ school, children }) {
  return html`<div class="auth">
    <div class="auth-card">
      <div class="auth-top">
        <${Wordmark} />
        <div class="auth-tagline">Vnáší světlo do školního týdne.</div>
        <div class="auth-school">${school || 'školní plánovač'}</div>
      </div>
      ${children}
    </div>
    <div class="auth-links"><span>rozvrh · konzultace · osobní cíle</span>${!NEEDS_BROWSER_LOGIN && html`<a href="/stahnout.html">Raven do telefonu</a>`}</div>
    <${ThemeToggle} />
  </div>`;
}

function Setup({ onDone, codeRequired }) {
  const [f, setF] = useState({ setup_code: '', name: '', short: '', username: '', password: '', password2: '' });
  const [err, setErr] = useState('');
  const [restore, setRestore] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    if (f.password !== f.password2) return setErr('Hesla se neshodují.');
    try { await api('POST', '/api/setup', f); onDone(); } catch (x) { setErr(x.message); }
  };
  const restoreFile = async (file) => {
    if (!file) return;
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/import.json', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Setup-Code': f.setup_code }, body: await file.text() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Obnova se nezdařila.');
      onDone();
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  const codeField = codeRequired && html`<${Field} label="Kód pro nastavení" hint="jednorázový kód, který jste dostali spolu s adresou"><input required autocomplete="off" value=${f.setup_code} onInput=${set('setup_code')} /><//>`;
  if (restore) {
    return html`<${AuthFrame}>
      <div class="auth-form">
        <p class="auth-lead">Obnovit data ze zálohy (soubor <b>raven-data-….json</b> z jiné instalace Ravenu, online nebo místní). Účty a hesla zůstanou stejné.</p>
        ${codeField}
        <${Field} label="Soubor zálohy"><input type="file" accept=".json,application/json" disabled=${busy || (codeRequired && !f.setup_code)} onChange=${(e) => restoreFile(e.target.files[0])} /><//>
        ${busy && html`<p class="muted">Obnovuji…</p>`}
        <${ErrorLine} error=${err} />
        <button class="btn btn-block" onClick=${() => setRestore(false)}>Zpět</button>
      </div>
    <//>`;
  }
  return html`<${AuthFrame}>
    <form class="auth-form" onSubmit=${submit}>
      <p class="auth-lead">První spuštění. Vytvořte účet správce. Ostatní učitele pak přidáte v sekci Správa.</p>
      ${codeField}
      <${Field} label="Jméno a příjmení"><input required value=${f.name} onInput=${set('name')} /><//>
      <${Field} label="Zkratka" hint="např. NOV – zobrazuje se v rozvrhu"><input maxlength="5" value=${f.short} onInput=${set('short')} /><//>
      <${Field} label="Přihlašovací jméno"><input required autocomplete="username" value=${f.username} onInput=${set('username')} /><//>
      <${Field} label="Heslo" hint="alespoň 6 znaků"><input required type="password" autocomplete="new-password" value=${f.password} onInput=${set('password')} /><//>
      <${Field} label="Heslo znovu"><input required type="password" autocomplete="new-password" value=${f.password2} onInput=${set('password2')} /><//>
      <${ErrorLine} error=${err} />
      <button class="btn btn-primary btn-block">Vytvořit a pokračovat</button>
      <button type="button" class="btn btn-ghost btn-block" onClick=${() => setRestore(true)}>Mám zálohu – obnovit data</button>
    </form>
  <//>`;
}

function GoogleButton({ clientId, onCredential }) {
  const ref = useRef(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const init = () => {
      try {
        window.google.accounts.id.initialize({ client_id: clientId, callback: (r) => onCredential(r.credential), ux_mode: 'popup' });
        window.google.accounts.id.renderButton(ref.current, { theme: 'filled_black', size: 'large', shape: 'rectangular', text: 'signin_with', locale: 'cs', width: Math.min(360, ref.current.offsetWidth || 320) });
      } catch { setFailed(true); }
    };
    if (window.google && window.google.accounts && window.google.accounts.id) { init(); return; }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = init;
    s.onerror = () => setFailed(true);
    document.head.appendChild(s);
  }, [clientId]);
  return failed ? html`<p class="error-line">Přihlašovací tlačítko Google se nepodařilo načíst. Zkontrolujte připojení k internetu.</p>` : html`<div class="gbtn" ref=${ref}></div>`;
}

function Login({ school, googleClientId, onDone }) {
  const [f, setF] = useState({ username: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [gate, setGate] = useState(null);
  const [gatePw, setGatePw] = useState('');
  const [showPw, setShowPw] = useState(!googleClientId);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await api('POST', '/api/login', f, { quiet: true }); onDone(); } catch (x) { setErr(x.message); setBusy(false); }
  };
  const onGoogle = async (credential) => {
    setErr(''); setBusy(true);
    try {
      const r = await api('POST', '/api/auth/google', { credential }, { quiet: true });
      if (r.need_gate) { setGate(r); setBusy(false); return; }
      onDone();
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  const submitGate = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await api('POST', '/api/auth/gate', { ticket: gate.ticket, password: gatePw }, { quiet: true }); onDone(); } catch (x) { setErr(x.message); setBusy(false); }
  };
  if (gate) {
    return html`<${AuthFrame} school=${school}>
      <form class="auth-form" onSubmit=${submitGate}>
        <p class="auth-lead"><b>${gate.email}</b> není školní adresa. Pro pokračování zadejte doplňkové heslo.</p>
        <${Field} label="Doplňkové heslo"><input required type="password" autocomplete="off" value=${gatePw} onInput=${(e) => setGatePw(e.target.value)} /><//>
        <${ErrorLine} error=${err} />
        <button class="btn btn-primary btn-block" disabled=${busy}>${busy ? 'Ověřuji…' : 'Pokračovat'}</button>
        <button type="button" class="btn btn-ghost btn-block" onClick=${() => { setGate(null); setErr(''); setGatePw(''); }}>Zpět</button>
      </form>
    <//>`;
  }
  if (googleClientId && NEEDS_BROWSER_LOGIN && !showPw) {
    return html`<${AuthFrame} school=${school}><${AppLogin} onDone=${onDone} onPassword=${() => setShowPw(true)} /><//>`;
  }
  return html`<${AuthFrame} school=${school}>
    ${googleClientId && !NEEDS_BROWSER_LOGIN && html`<div class="auth-form auth-google">
      <p class="auth-lead">Přihlaste se školním účtem Google.</p>
      <${GoogleButton} clientId=${googleClientId} onCredential=${onGoogle} />
      ${!showPw && html`<${ErrorLine} error=${err} />`}
      ${!showPw && html`<button type="button" class="btn btn-ghost btn-block" onClick=${() => setShowPw(true)}>Přihlásit se jménem a heslem</button>`}
    </div>`}
    ${showPw && html`<form class="auth-form" onSubmit=${submit}>
      <${Field} label="Přihlašovací jméno"><input required autocomplete="username" value=${f.username} onInput=${(e) => setF({ ...f, username: e.target.value })} /><//>
      <${Field} label="Heslo"><input required type="password" autocomplete="current-password" value=${f.password} onInput=${(e) => setF({ ...f, password: e.target.value })} /><//>
      <${ErrorLine} error=${err} />
      <button class="btn btn-primary btn-block" disabled=${busy}>${busy ? 'Přihlašuji…' : 'Přihlásit se'}</button>
      <p class="auth-note">Zapomenuté heslo obnoví správce v sekci Správa → Uživatelé.</p>
    </form>`}
  <//>`;
}

// Phone app: sign in with Google in the phone's browser, confirmed by a short code.
function AppLogin({ onDone, onPassword }) {
  const [req, setReq] = useState(null);
  const [err, setErr] = useState('');
  const start = async () => {
    setErr('');
    try {
      const r = await api('POST', '/api/auth/app/start', {}, { quiet: true });
      setReq(r);
      openInBrowser(`${location.origin}/#/aplikace?id=${r.id}`);
    } catch (x) { setErr(x.message); }
  };
  useEffect(() => {
    if (!req) return;
    let stop = false;
    const poll = async () => {
      if (stop) return;
      try {
        const r = await api('POST', '/api/auth/app/poll', { id: req.id, secret: req.secret }, { quiet: true });
        if (r.state === 'approved') { stop = true; onDone(); }
      } catch (x) { stop = true; setReq(null); setErr(x.message + ' Zkus to prosím znovu.'); }
    };
    const t = setInterval(poll, 2500);
    const wake = () => { if (!document.hidden) poll(); };
    addEventListener('raven:resume', poll); document.addEventListener('visibilitychange', wake);
    return () => { stop = true; clearInterval(t); removeEventListener('raven:resume', poll); document.removeEventListener('visibilitychange', wake); };
  }, [req]);
  if (!req) return html`<div class="auth-form app-login">
    <p class="auth-lead">Přihlas se svým školním účtem Google. Otevře se prohlížeč v telefonu a pak se vrátíš sem.</p>
    <button class="btn btn-primary btn-block btn-big" onClick=${start}>Přihlásit se přes Google</button>
    <${ErrorLine} error=${err} />
    <button type="button" class="btn btn-ghost btn-block" onClick=${onPassword}>Přihlásit se jménem a heslem</button>
  </div>`;
  return html`<div class="auth-form app-login">
    <p class="auth-lead">V prohlížeči se přihlas přes Google a opiš tam tento kód:</p>
    <div class="app-code" aria-label=${'Kód ' + req.code.split('').join(' ')}>${req.code.split('').map((c) => html`<span>${c}</span>`)}</div>
    <p class="app-wait"><span class="spinner" aria-hidden="true"></span> Čekám na potvrzení z prohlížeče…</p>
    <button class="btn btn-block" onClick=${() => openInBrowser(`${location.origin}/#/aplikace?id=${req.id}`)}>Otevřít prohlížeč znovu</button>
    <button type="button" class="btn btn-ghost btn-block" onClick=${() => setReq(null)}>Zrušit</button>
  </div>`;
}

// Browser side: the signed-in pupil confirms the app on their phone by typing its code.
function AppApprovePage({ params }) {
  const { me } = useAppCtx();
  const [code, setCode] = useState('');
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('GET', `/api/auth/app/info?id=${encodeURIComponent(params.id || '')}`, undefined, { quiet: true }).then(setInfo).catch(() => setInfo({ state: 'expired' })); }, [params.id]);
  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await api('POST', '/api/auth/app/approve', { id: params.id, code }, { quiet: true }); setDone(true); } catch (x) { setErr(x.message); }
    setBusy(false);
  };
  let body;
  if (!info) body = html`<p>Načítám…</p>`;
  else if (done || info.state === 'approved') body = html`<p class="approve-ok"><span aria-hidden="true">✓</span> Hotovo – aplikace Raven je přihlášená jako <b>${me.name}</b>.</p>
      <p>Teď se vrať do aplikace Raven – přihlásí se sama. Tuto stránku můžeš zavřít.</p>
      ${/Android/i.test(navigator.userAgent) && html`<a class="btn btn-primary btn-block btn-big" href="raven://open">Zpět do aplikace</a>`}`;
  else if (info.state === 'expired') body = html`<p class="bad">Tato žádost o přihlášení vypršela nebo už byla použita. V aplikaci klepni znovu na „Přihlásit se přes Google“.</p>`;
  else body = html`<form onSubmit=${submit}>
      <p>Přihlašuješ aplikaci Raven na telefonu jako <b>${me.name}</b>. Opiš kód, který teď ukazuje aplikace:</p>
      <input class="app-code-input" required autofocus maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text" value=${code} onInput=${(e) => setCode(e.target.value.toUpperCase())} placeholder="KÓD" aria-label="Kód z aplikace" />
      <${ErrorLine} error=${err} />
      <button class="btn btn-primary btn-block btn-big" disabled=${busy || code.trim().length < 4}>Přihlásit aplikaci</button>
      <p class="muted small">Kód opisuj jen z vlastního telefonu. Pokud jsi o přihlášení nežádal(a), stránku zavři.</p>
    </form>`;
  return html`<div class="page approve-page"><div class="approve-card"><div class="week-no">Přihlášení aplikace</div>${body}</div></div>`;
}

function PasswordDialog({ onClose, toast }) {
  const [f, setF] = useState({ old: '', new: '', again: '' });
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    if (f.new !== f.again) return setErr('Nová hesla se neshodují.');
    try { await api('POST', '/api/me/password', { old: f.old, new: f.new }); toast('Heslo změněno.'); onClose(); } catch (x) { setErr(x.message); }
  };
  return html`<${Modal} title="Změna hesla" onClose=${onClose}>
    <form class="form-grid" onSubmit=${submit} id="pwform">
      <${Field} label="Současné heslo" wide><input type="password" required value=${f.old} onInput=${(e) => setF({ ...f, old: e.target.value })} /><//>
      <${Field} label="Nové heslo" half><input type="password" required value=${f.new} onInput=${(e) => setF({ ...f, new: e.target.value })} /><//>
      <${Field} label="Nové heslo znovu" half><input type="password" required value=${f.again} onInput=${(e) => setF({ ...f, again: e.target.value })} /><//>
      <${ErrorLine} error=${err} />
      <div class="form-actions"><button type="button" class="btn" onClick=${onClose}>Zrušit</button><button class="btn btn-primary">Uložit heslo</button></div>
    </form>
  <//>`;
}

function ConfirmDialog({ c, onDone }) {
  return html`<${Modal} title=${c.title} onClose=${() => onDone(null)}>
    ${c.text && html`<p class="confirm-text">${c.text}</p>`}
    <div class="form-actions">
      <button class="btn" onClick=${() => onDone(null)}>${c.cancel || 'Zrušit'}</button>
      ${(c.choices || [{ value: true, label: c.confirm || 'Potvrdit', danger: c.danger }]).map((ch) =>
        html`<button class=${'btn ' + (ch.danger ? 'btn-danger' : 'btn-primary')} onClick=${() => onDone(ch.value)}>${ch.label}</button>`)}
    </div>
  <//>`;
}

const NAV = [
  ['prehled', 'Přehled'],
  ['rozvrh', 'Rozvrh'],
  ['konzultace', 'Konzultace'],
  ['cile', 'Osobní cíle'],
  ['zaci', 'Žáci a skupiny'],
  ['asistent', 'Asistent'],
  ['sprava', 'Správa', 'coordinator'],
];

function Shell() {
  const app = useAppCtx();
  const { me, boot } = app;
  const route = useHash();
  const [menu, setMenu] = useState(false);
  const [pw, setPw] = useState(false);
  useEffect(() => { window.scrollTo(0, 0); setMenu(false); }, [route.path]);
  useEffect(() => {
    const el = document.querySelector('.top');
    if (!el || !window.ResizeObserver) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--top-h', el.offsetHeight + 'px'));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const isStudent = me.role === 'student';
  const isPhone = useIsPhone();
  const phone = isStudent && isPhone;
  // Staff accounts are for computers (for now). On a phone they see a notice; if they
  // choose to continue anyway, they get the computer layout zoomed out.
  const onPhoneDevice = /Android.*Mobile|iPhone|iPod|Windows Phone/i.test(navigator.userAgent) || Math.min(screen.width, screen.height) <= 760;
  const [staffAnyway, setStaffAnyway] = useState(() => sessionStorage.getItem('raven.staffOnPhone') === '1');
  useEffect(() => {
    if (isStudent || !onPhoneDevice || !staffAnyway) return;
    const vp = document.querySelector('meta[name=viewport]');
    const prev = vp.content;
    vp.content = 'width=1280';
    return () => { vp.content = prev; };
  }, [isStudent, staffAnyway]);
  const nav = isStudent ? [['rozvrh', 'Rozvrh'], ['rozlozeni', 'Rozložení hodin'], ['moje-cile', 'Moje cíle'], ['asistent', 'Asistent']] : NAV.filter(([, , role]) => !role || atLeast(me, role));
  let page;
  if (route.path === 'aplikace') {
    page = html`<${AppApprovePage} params=${route.params} />`;
  } else if (route.path === 'o-nazvu') {
    page = html`<${AboutPage} />`;
  } else if (route.path === 'asistent') {
    page = html`<${AssistantPage} />`;
  } else if (isStudent) {
    page = route.path === 'moje-cile' ? html`<${MyGoalsPage} />` : route.path === 'rozlozeni' ? html`<${LoadPage} params=${route.params} />`
      : phone ? html`<${PhoneSchedule} params=${route.params} />` : html`<${SchedulePage} params=${route.params} />`;
  } else switch (route.path) {
    case 'rozvrh': page = html`<${SchedulePage} params=${route.params} />`; break;
    case 'konzultace': page = html`<${ConsultationsPage} params=${route.params} />`; break;
    case 'cile': page = html`<${GoalsPage} params=${route.params} />`; break;
    case 'zaci': page = html`<${PeoplePage} params=${route.params} />`; break;
    case 'zak': page = html`<${StudentCardPage} params=${route.params} />`; break;
    case 'sprava': page = atLeast(me, 'coordinator') ? html`<${AdminPage} params=${route.params} />` : html`<${Dashboard} />`; break;
    default: page = html`<${Dashboard} />`;
  }
  if (!isStudent && onPhoneDevice && !staffAnyway) {
    return html`<div class="auth pc-only">
      <div class="auth-card">
        <div class="auth-top"><${Wordmark} /><div class="auth-school">${boot.settings.school_name}</div></div>
        <div class="auth-form">
          <svg class="pc-only-icon" viewBox="0 0 48 48" aria-hidden="true"><rect x="5" y="8" width="38" height="25" rx="2"/><path d="M17 40h14M24 33v7"/></svg>
          <h2 class="pc-only-title">Otevři Raven na počítači</h2>
          <p class="auth-lead">Účet <b>${me.name}</b> (${ROLE_LABEL[me.role].toLowerCase()}) je zatím určený pro počítač. Verze pro telefon je jen pro žáky.</p>
          <p class="auth-note">Adresa: ${location.host}</p>
          <button class="btn btn-primary btn-block btn-big" onClick=${app.logout}>Odhlásit se</button>
          <button class="btn btn-ghost btn-block" onClick=${() => { sessionStorage.setItem('raven.staffOnPhone', '1'); setStaffAnyway(true); }}>Přesto zobrazit počítačovou verzi</button>
        </div>
      </div>
    </div>`;
  }
  if (phone) {
    return html`<${PhoneShell} route=${route} page=${page} menu=${menu} onMenu=${() => setMenu(!menu)} />
      ${menu && html`<${Modal} title=${me.name} kicker=${ROLE_LABEL[me.role]} onClose=${() => setMenu(false)}>
        <div class="psheet-menu">
          ${me.email && html`<p class="muted small">${me.email}</p>`}
          <div class="psheet-row"><span>Vzhled</span><${ThemeToggle} /></div>
          ${me.has_password && html`<button class="btn btn-block" onClick=${() => { setMenu(false); setPw(true); }}>Změnit heslo</button>`}
          <button class="btn btn-block" onClick=${() => { setMenu(false); go('o-nazvu'); }}>O názvu Raven</button>
          <button class="btn btn-block btn-danger-ghost" onClick=${app.logout}>Odhlásit se</button>
        </div>
      <//>`}
      ${pw && html`<${PasswordDialog} onClose=${() => setPw(false)} toast=${app.toast} />`}`;
  }
  return html`<div class="shell">
    <header class="top">
      <a class="brand" href=${isStudent ? '#/rozvrh' : '#/prehled'}>
        <${Wordmark} small />
        <span class="brand-school">${boot.settings.school_name}</span>
      </a>
      <nav class="nav">
        ${nav.map(([p, label]) =>
          html`<a href=${'#/' + p} class=${'nav-link' + (route.path === p || (p === 'zaci' && route.path === 'zak') || (isStudent && p === 'rozvrh' && !['moje-cile', 'rozlozeni', 'asistent', 'o-nazvu'].includes(route.path)) ? ' on' : '')}>${label}</a>`)}
      </nav>
      <div class="me">
        <${ThemeToggle} />
        <button class="me-btn" onClick=${() => setMenu(!menu)} aria-expanded=${menu}>
          <span class="me-short">${me.short || me.name.slice(0, 2).toUpperCase()}</span>
          <span class="me-name">${me.name}</span>
        </button>
        ${menu && html`<div class="me-menu" onMouseLeave=${() => setMenu(false)}>
          <div class="me-role">${ROLE_LABEL[me.role]}</div>
          ${me.email && html`<div class="me-role me-email">${me.email}</div>`}
          ${me.has_password && html`<button onClick=${() => { setMenu(false); setPw(true); }}>Změnit heslo</button>`}
          <button onClick=${() => { setMenu(false); go('o-nazvu'); }}>O názvu Raven</button>
          <button onClick=${app.logout}>Odhlásit se</button>
        </div>`}
      </div>
    </header>
    <main class="main">${page}</main>
    ${pw && html`<${PasswordDialog} onClose=${() => setPw(false)} toast=${app.toast} />`}
  </div>`;
}

import { useContext } from './lib.js';
const useAppCtx = () => useContext(Ctx);

function App() {
  const [state, setState] = useState(null);
  const [boot, setBoot] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [confirmReq, setConfirmReq] = useState(null);
  const [fatal, setFatal] = useState('');

  const loadBoot = useCallback(async () => { setBoot(await api('GET', '/api/bootstrap')); }, []);
  const loadState = useCallback(async () => {
    try {
      const s = await api('GET', '/api/state', undefined, { quiet: true });
      setState(s);
      if (s.user) await loadBoot(); else setBoot(null);
      setFatal('');
    } catch (e) { setFatal(e.message); }
  }, []);

  useEffect(() => {
    loadState();
    const onLogout = () => { setBoot(null); setState((s) => ({ ...(s || {}), user: null })); };
    addEventListener('raven:logout', onLogout);
    return () => removeEventListener('raven:logout', onLogout);
  }, []);

  const toast = useCallback((msg, kind = 'ok') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 6000 : 3200);
  }, []);
  const confirm = useCallback((c) => new Promise((resolve) => setConfirmReq({ c, resolve })), []);
  const logout = useCallback(async () => { try { await api('POST', '/api/logout'); } catch { /* ignore */ } setBoot(null); setState((s) => ({ ...s, user: null })); }, []);

  const ctx = useMemo(() => {
    if (!boot) return null;
    const by = (arr) => Object.fromEntries(arr.map((x) => [x.id, x]));
    const users = by(boot.users), subjects = by(boot.subjects), rooms = by(boot.rooms), groups = by(boot.groups), students = by(boot.students);
    const myGroups = boot.groups.filter((g) => g.tutor_id === boot.user.id);
    const tutorOf = (sid) => { const s = students[sid]; const g = s && s.group_id ? groups[s.group_id] : null; return g ? g.tutor_id : null; };
    return {
      boot, me: boot.user, settings: boot.settings,
      maps: { users, subjects, rooms, groups, students },
      activeUsers: boot.users.filter((u) => u.active && u.role !== 'student'), // staff only: pupils never teach
      myGroups, tutorOf,
      canManageGoals: (sid) => atLeast(boot.user, 'coordinator') || tutorOf(sid) === boot.user.id,
      reloadBoot: loadBoot, toast, confirm, logout,
    };
  }, [boot, toast, confirm, logout]);

  const overlays = html`
    <div class="toasts" aria-live="polite">${toasts.map((t) => html`<div class=${'toast toast-' + t.kind}>${t.msg}</div>`)}</div>
    ${confirmReq && html`<${ConfirmDialog} c=${confirmReq.c} onDone=${(v) => { confirmReq.resolve(v); setConfirmReq(null); }} />`}`;

  if (fatal) return html`<${AuthFrame}><div class="auth-form"><p class="error-line">${fatal}</p><button class="btn btn-primary btn-block" onClick=${loadState}>Zkusit znovu</button></div><//>`;
  if (!state) return html`<div class="loading">Načítám…</div>`;
  if (state.needs_setup) return html`<${Setup} codeRequired=${state.setup_code_required} onDone=${loadState} />`;
  if (!state.user && !boot) return html`<${Login} school=${state.school_name} googleClientId=${state.google_client_id} onDone=${loadState} />`;
  if (!ctx) return html`<div class="loading">Načítám…</div>`;
  return html`<${Ctx.Provider} value=${ctx}><${Shell} />${overlays}<//>`;
}

render(html`<${App} />`, document.getElementById('app'));

// installable as an app on phones (the worker caches nothing, see sw.js)
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
