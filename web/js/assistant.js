import { html, useState, useEffect, useRef, useApp, api, Mark, PageHead } from './lib.js';

// Minimal, safe Markdown: escape everything first, then allow **bold**, lists and line breaks.
function renderMd(text) {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = esc.split('\n');
  let out = '', list = null;
  const close = () => { if (list) { out += `</${list}>`; list = null; } };
  for (const raw of lines) {
    const l = raw.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    let m;
    if ((m = l.match(/^\s*[-*•]\s+(.*)$/))) { if (list !== 'ul') { close(); out += '<ul>'; list = 'ul'; } out += `<li>${m[1]}</li>`; continue; }
    if ((m = l.match(/^\s*\d+[.)]\s+(.*)$/))) { if (list !== 'ol') { close(); out += '<ol>'; list = 'ol'; } out += `<li>${m[1]}</li>`; continue; }
    close();
    if ((m = l.match(/^#{1,4}\s+(.*)$/))) { out += `<p><b>${m[1]}</b></p>`; continue; }
    if (l.trim() === '') continue;
    out += `<p>${l}</p>`;
  }
  close();
  return out;
}

const SUGGEST_STUDENT = ['Co mám dnes a zítra?', 'Jaké mám osobní cíle?', 'Kam jede moje skupina v pátek?', 'Kdy jsou nejbližší prázdniny?'];
const SUGGEST_STAFF = ['Co učím tento týden?', 'Které konzultace mě čekají?', 'Kterým žákům se blíží revize cíle?', 'Jak zkopíruji rozvrh na další týden?'];

export function AssistantPage() {
  const { me, confirm } = useApp();
  const [state, setState] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const student = me.role === 'student';

  useEffect(() => {
    api('GET', '/api/assistant').then((s) => { setState(s); setMsgs(s.messages || []); }).catch((e) => setErr(e.message));
  }, []);
  useEffect(() => { endRef.current && endRef.current.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [msgs, busy]);

  const send = async (q) => {
    const question = (q ?? text).trim();
    if (!question || busy) return;
    setErr(''); setText(''); setBusy(true);
    setMsgs((m) => [...m, { role: 'user', content: question }]);
    try {
      const r = await api('POST', '/api/assistant', { message: question });
      setMsgs((m) => [...m, { role: 'assistant', content: r.reply }]);
      setState((s) => ({ ...s, left_today: r.left_today }));
    } catch (e) {
      setErr(e.message);
      setMsgs((m) => m.slice(0, -1));
      setText(question);
    }
    setBusy(false);
    setTimeout(() => inputRef.current && inputRef.current.focus(), 30);
  };
  const clear = async () => {
    if (!await confirm({ title: 'Začít novou konverzaci?', text: 'Dosavadní zprávy se smažou.', confirm: 'Smazat konverzaci', danger: true })) return;
    try { await api('DELETE', '/api/assistant'); setMsgs([]); } catch (e) { setErr(e.message); }
  };
  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };

  if (!state && !err) return html`<div class="loading">Načítám…</div>`;
  const suggestions = student ? SUGGEST_STUDENT : SUGGEST_STAFF;

  return html`<div class="page assistant">
    <${PageHead} title="Osobní asistent" sub=${state ? `${state.model} · odpovídá jen z údajů v Ravenu` : ''}>
      ${msgs.length > 0 && html`<button class="btn" onClick=${clear}>Nová konverzace</button>`}
    <//>
    ${state && !state.available ? html`<div class="empty">${state.reason}</div>` : html`
      <div class="chat">
        <div class="chat-log" aria-live="polite">
          ${msgs.length === 0 && html`<div class="chat-intro">
            <${Mark} />
            <p>${student ? 'Ahoj! Zeptej se mě na rozvrh, výjezdy, prázdniny nebo své osobní cíle.' : 'Dobrý den. Zeptejte se na rozvrh, konzultace, osobní cíle žáků nebo na to, jak v Ravenu něco udělat.'}</p>
            <div class="chat-suggest">${suggestions.map((s) => html`<button class="chip" onClick=${() => send(s)}>${s}</button>`)}</div>
          </div>`}
          ${msgs.map((m) => m.role === 'user'
            ? html`<div class="msg msg-user"><div class="bubble">${m.content}</div></div>`
            : html`<div class="msg msg-ai"><span class="msg-avatar"><${Mark} /></span><div class="bubble" dangerouslySetInnerHTML=${{ __html: renderMd(m.content) }}></div></div>`)}
          ${busy && html`<div class="msg msg-ai"><span class="msg-avatar"><${Mark} /></span><div class="bubble typing"><span></span><span></span><span></span></div></div>`}
          <div ref=${endRef}></div>
        </div>
        ${err && html`<div class="error-line">${err}</div>`}
        <form class="chat-input" onSubmit=${(e) => { e.preventDefault(); send(); }}>
          <textarea ref=${inputRef} rows="2" maxlength="1500" placeholder=${student ? 'Napiš otázku…' : 'Napište otázku…'} value=${text} onInput=${(e) => setText(e.target.value)} onKeyDown=${onKey} disabled=${busy}></textarea>
          <button class="btn btn-primary" disabled=${busy || !text.trim()}>Odeslat</button>
        </form>
        <p class="chat-foot">${student ? 'Asistent vidí jen údaje, ke kterým máš přístup, a může se mýlit – důležité věci si ověř v rozvrhu.' : 'Asistent vidí jen údaje, ke kterým máte přístup, a může se mýlit – důležité věci si ověřte v Ravenu.'}${state ? ` Dnes zbývá otázek: ${state.left_today}.` : ''}</p>
      </div>`}
  </div>`;
}
