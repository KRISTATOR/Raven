// Raven's service worker: makes the site installable as an app. It never caches
// pages or data (timetables must always be current); when the phone is offline it
// shows a short notice instead of the browser's error page.
const OFFLINE = `<!doctype html><html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Raven</title><body style="margin:0;background:#121316;color:#E9E6DD;font:17px/1.5 sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px;box-sizing:border-box">
<div><h1 style="letter-spacing:.12em;font-size:26px;margin:0 0 12px">RAVEN</h1><p>Raven se teď nemůže spojit se serverem.<br>Zkontroluj připojení k internetu.</p>
<a href="/" style="display:inline-block;margin-top:14px;padding:12px 22px;background:#F2B632;color:#121316;text-decoration:none;font-weight:700">Zkusit znovu</a></div></body></html>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return; // everything else goes straight to the network
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
