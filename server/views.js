// Server-rendered HTML. Inline CSS + a few KB of ES5 JS, no framework, no web fonts:
// must load fast on 2G and cheap Android phones.
import { STR, fill } from './i18n.js';
import { position, etaMin } from './queue.js';
import { createRequire } from 'node:module';

// QR drawn on the server as plain SVG: no CDN, no extra script, works on any TV browser.
const qrcode = createRequire(import.meta.url)('./vendor/qrcode.cjs'); // MIT, Kazuhiko Arase
const qrCache = new Map();
export function qrSvg(text) {
  if (!qrCache.has(text)) {
    const q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    qrCache.set(text, q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }));
  }
  return qrCache.get(text);
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
// JSON safe to embed inside <script>
const js = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
const shopName = (shop, lang) => (lang === 'ur' && shop.name_ur ? shop.name_ur : shop.name);

const CSS = `*{box-sizing:border-box}
body{margin:0;font-family:system-ui,"Noto Nastaliq Urdu","Jameel Noori Nastaleeq",sans-serif;background:#f5f3ee;color:#1c1c1a;line-height:1.7}
main{max-width:460px;margin:0 auto;padding:16px}
h1{font-size:20px;margin:4px 0 0;text-align:center}
.card{background:#fff;border-radius:14px;padding:18px;margin:12px 0;text-align:center;box-shadow:0 1px 3px #0002}
.big{font-size:84px;font-weight:800;line-height:1.1;font-family:system-ui,sans-serif}
.mid{font-size:44px;font-weight:700;line-height:1.2;font-family:system-ui,sans-serif}
.msg{font-size:20px;font-weight:700}
.muted{color:#5f5f5a;font-size:15px}
.c{text-align:center}
.btn{display:block;width:100%;padding:16px;margin:8px 0;font:inherit;font-size:20px;font-weight:700;border:0;border-radius:12px;background:#0b7a4b;color:#fff;cursor:pointer}
.btn:disabled{opacity:.5}
.ghost{background:#fff;color:#a32020;border:2px solid #e3c9c9;font-size:16px}
.alt{background:#1f4e8c}
.note{background:#fff6d6;border-radius:10px;padding:10px;text-align:center}
.turn .card:first-of-type{background:#0b7a4b;color:#fff}
.turn .card:first-of-type .muted{color:#d9f2e6}
a{color:#1f4e8c}
input{font:inherit;font-size:28px;width:100%;padding:12px;text-align:center;border:2px solid #ccc;border-radius:12px;letter-spacing:8px}`;

function page({ title, lang = 'ur', body, script = '', css = '', live = false }) {
  const dir = STR[lang]?.dir ?? 'ltr';
  return `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#0b7a4b"><title>${esc(title)}</title>
${live ? '<noscript><meta http-equiv="refresh" content="30"></noscript>' : ''}
<style>${CSS}${css}</style></head><body>${body}${script ? `<script>${script}</script>` : ''}</body></html>`;
}

// Live connection: SSE first, polling every 20s if SSE drops (2G), refresh on return to tab.
const LIVE_JS = `function live(s,cb){var p=0;
function get(){var x=new XMLHttpRequest();x.open('GET','/api/'+s+'/state');x.onload=function(){try{cb(JSON.parse(x.responseText))}catch(e){}};x.send()}
function poll(){if(!p)p=setInterval(get,20000)}
if(window.EventSource){var e=new EventSource('/api/'+s+'/events');e.onmessage=function(m){cb(JSON.parse(m.data))};e.onerror=poll;e.onopen=function(){if(p){clearInterval(p);p=0}}}else poll();
document.addEventListener('visibilitychange',function(){if(!document.hidden)get()})}
function $(i){return document.getElementById(i)}
function f(s,o){return s.replace(/\\{(\\w+)\\}/g,function(_,k){return o[k]})}`;

// ---------- Customer: /q/<slug> ----------

function myStatusText(pos, avg, L) {
  if (pos.turn) return [L.yourTurn, ''];
  if (pos.ahead === 0) return [L.youNext, ''];
  return [fill(L.ahead, { n: pos.ahead }), fill(L.comeIn, { m: etaMin(pos.ahead, avg) })];
}

function newJoinerWait(st, L) {
  const ahead = st.w.length + (st.n != null ? 1 : 0);
  return ahead === 0 ? L.noWait : fill(L.waitTime, { m: etaMin(ahead, st.a) });
}

export function customerPage({ shop, st, tok, lang }) {
  const L = STR[lang];
  const name = shopName(shop, lang);
  const langLink = `<p class="c muted"><a href="?l=${L.otherCode}">${L.other}</a></p>`;
  const active = tok && (tok.status === 'waiting' || tok.status === 'serving');

  if (active) {
    const pos = position(st, tok.number) ?? { turn: tok.status === 'serving', ahead: 0 };
    const [msg, sub] = myStatusText(pos, st.a, L);
    const body = `<main class="${pos.turn ? 'turn' : ''}" id="m"><h1>${esc(name)}</h1>
<div class="card"><div class="muted">${L.yourNo}</div><div class="big">${tok.number}</div>
<div class="msg" id="msg">${msg}</div><div class="muted" id="sub">${sub}</div></div>
<div class="card"><div class="muted">${L.nowServing}</div><div class="mid" id="n">${st.n ?? '—'}</div></div>
<p class="note">${L.keepOpen}</p>
<form method="post" action="/q/${shop.slug}/leave"><button class="btn ghost">${L.leave}</button></form>
${langLink}</main>`;
    const D = { s: shop.slug, me: tok.number, L: { yourTurn: L.yourTurn, youNext: L.youNext, ahead: L.ahead, comeIn: L.comeIn } };
    const script = `${LIVE_JS}
var D=${js(D)};
live(D.s,function(st){$('n').textContent=st.n==null?'—':st.n;
var turn=st.n===D.me,i=st.w.indexOf(D.me);if(!turn&&i<0){location.reload();return}
var a=turn?0:i+(st.n!=null?1:0);
$('msg').textContent=turn?D.L.yourTurn:a===0?D.L.youNext:f(D.L.ahead,{n:a});
$('sub').textContent=turn||a===0?'':f(D.L.comeIn,{m:Math.max(1,Math.round(a*st.a/60))});
$('m').className=turn?'turn':'';document.title=(turn?'\\u2705 ':'')+D.me+' \\u00b7 '+(st.n==null?'-':st.n)})`;
    return page({ title: `${tok.number} · ${name}`, lang, body, script, live: true });
  }

  const gone = tok ? `<p class="note">${L.gone} (${tok.number})</p>` : '';
  const action = st.o
    ? `<form method="post" action="/q/${shop.slug}/join"><button class="btn">${L.join}</button></form>`
    : `<p class="note">${L.closed}</p>`;
  const body = `<main><h1>${esc(name)}</h1>${gone}
<div class="card"><div class="muted">${L.nowServing}</div><div class="big" id="n">${st.n ?? '—'}</div>
<div class="msg" id="wc">${fill(L.waiting, { n: st.w.length })}</div><div class="muted" id="wt">${newJoinerWait(st, L)}</div></div>
${action}${langLink}</main>`;
  const D = { s: shop.slug, L: { waiting: L.waiting, waitTime: L.waitTime, noWait: L.noWait } };
  const script = `${LIVE_JS}
var D=${js(D)},O=${st.o};
live(D.s,function(st){if(st.o!==O){location.reload();return}
$('n').textContent=st.n==null?'—':st.n;$('wc').textContent=f(D.L.waiting,{n:st.w.length});
var a=st.w.length+(st.n!=null?1:0);$('wt').textContent=a===0?D.L.noWait:f(D.L.waitTime,{m:Math.max(1,Math.round(a*st.a/60))})})`;
  return page({ title: name, lang, body, script, live: true });
}

// ---------- Barber: /b/<slug> ----------

export function loginPage({ shop, error }) {
  const body = `<main><h1>${esc(shop.name)}</h1>
<form method="post" action="/b/${shop.slug}/login" class="card">
<p class="msg">پن کوڈ · PIN</p>
<input name="pin" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="current-password" required autofocus>
${error ? `<p class="note">${esc(error)}</p>` : ''}
<button class="btn">داخل ہوں · Login</button></form></main>`;
  return page({ title: `Login · ${shop.name}`, lang: 'ur', body });
}

export function barberPage({ shop, st, walkin, base }) {
  const s = shop.slug;
  const btn = (action, label, cls = '') =>
    `<form method="post" action="/b/${s}/${action}"><button class="btn ${cls}">${label}</button></form>`;
  const css = `.huge{font-size:34px;padding:30px 16px;border-radius:18px}
.row{display:flex;gap:10px}.row form{flex:1}.row .btn{height:100%;line-height:1.4;white-space:nowrap}
.top{display:flex;justify-content:space-between;align-items:center;gap:8px}
.top form{margin:0}.top .btn{padding:6px 12px;font-size:14px;margin:0;width:auto}
.wl{font-family:system-ui,sans-serif;font-size:22px;word-spacing:10px}
.off{background:#a32020}`;
  const body = `<main>
<div class="top"><strong>${esc(shop.name)}</strong>
${st.o ? btn('close', 'کھلی · OPEN') : btn('open', 'بند · CLOSED', 'off')}
${btn('logout', '⎋', 'ghost')}</div>
${walkin ? `<p class="note msg">واک اِن نمبر · Walk-in number: <span class="mid">${Number(walkin)}</span></p>` : ''}
<div class="card"><div class="muted">ابھی نمبر · Now serving</div><div class="big" id="n">${st.n ?? '—'}</div></div>
${btn('next', 'اگلا ▶ NEXT', 'huge')}
<div class="row">${btn('skip', 'نہیں آیا<br>No-show', 'ghost')}${btn('walkin', '+ واک اِن<br>Walk-in', 'alt')}</div>
<div class="card"><div class="muted">انتظار میں · Waiting</div><div class="mid" id="wc">${st.w.length}</div>
<div class="wl" id="wl">${st.w.slice(0, 12).join(' ')}</div>
<div class="muted">اوسط وقت · Avg time: <b id="avg">${Math.round(st.a / 60)}</b> min</div></div>
<p class="c muted">
<a href="/tv/${s}" target="_blank">TV</a> ·
<a href="/poster/${s}" target="_blank">QR Poster</a> ·
<a href="/q/${s}" target="_blank">${esc(base)}/q/${s}</a></p></main>`;
  const script = `${LIVE_JS}
document.addEventListener('submit',function(e){var b=e.target.querySelector('button');setTimeout(function(){b.disabled=true},0)});
var O=${st.o};
live(${js(s)},function(st){if(st.o!==O){location.reload();return}
$('n').textContent=st.n==null?'—':st.n;$('wc').textContent=st.w.length;
$('wl').textContent=st.w.slice(0,12).join(' ');$('avg').textContent=Math.round(st.a/60)})`;
  return page({ title: `Barber · ${shop.name}`, lang: 'ur', body, script, css });
}

// ---------- TV: /tv/<slug> ----------

export function tvPage({ shop, st, base }) {
  const url = `${base}/q/${shop.slug}`;
  const css = `body{background:#0d1512;color:#fff;overflow:hidden}
.tv{display:flex;height:100vh;align-items:center;justify-content:space-around;padding:3vw;gap:3vw}
.lbl{font-size:4vw;color:#9fd8bd}.num{font-size:26vw;font-weight:800;line-height:1;font-family:system-ui,sans-serif}
.nx{font-size:4vw;font-family:system-ui,sans-serif;color:#cfe}
.side{text-align:center;width:30vw}#qr{background:#fff;padding:1vw;border-radius:1vw}#qr svg{width:100%;height:auto;display:block}
.url{font-size:1.8vw;direction:ltr;word-break:break-all}.cl{color:#ff8a8a;font-size:4vw}
.flash .num{animation:f 1s 3}@keyframes f{50%{color:#ffd54a}}`;
  const body = `<div class="tv" id="tv"><div class="c">
<div class="lbl">ابھی نمبر · NOW SERVING</div><div class="num" id="n">${st.n ?? '—'}</div>
<div class="nx">اگلے · Next: <span id="nx">${st.w.slice(0, 3).join('  ') || '—'}</span></div>
<div class="lbl" id="wc">${st.w.length} انتظار میں · waiting</div>
<div class="cl" id="cl"${st.o ? ' hidden' : ''}>دکان بند ہے · CLOSED</div></div>
<div class="side"><div id="qr">${qrSvg(url)}</div><div class="lbl">QR اسکین کریں<br>Scan to join</div><div class="url">${esc(url)}</div></div></div>`;
  const script = `${LIVE_JS}
var last=${js(st.n)},ac;
function ding(){try{ac=ac||new (window.AudioContext||window.webkitAudioContext)();var o=ac.createOscillator(),g=ac.createGain();o.frequency.value=880;g.gain.setValueAtTime(.3,ac.currentTime);g.gain.exponentialRampToValueAtTime(.001,ac.currentTime+.8);o.connect(g);g.connect(ac.destination);o.start();o.stop(ac.currentTime+.8)}catch(e){}}
document.addEventListener('click',function(){ding()});
try{navigator.wakeLock&&navigator.wakeLock.request('screen')}catch(e){}
live(${js(shop.slug)},function(st){$('n').textContent=st.n==null?'—':st.n;
$('nx').textContent=st.w.slice(0,3).join('  ')||'—';$('wc').textContent=st.w.length+' انتظار میں · waiting';
$('cl').hidden=!!st.o;
if(st.n!==last&&st.n!=null){var t=$('tv');t.className='tv';void t.offsetWidth;t.className='tv flash';ding()}last=st.n});`;
  return page({ title: `TV · ${shop.name}`, lang: 'ur', body, script, css });
}

// ---------- Printable poster: /poster/<slug> ----------

export function posterPage({ shop, base }) {
  const url = `${base}/q/${shop.slug}`;
  const css = `body{background:#fff}main{max-width:700px;text-align:center}
.t{font-size:40px;font-weight:800;margin:10px 0}#qr{width:70%;margin:20px auto}#qr svg{width:100%;height:auto}
ol{text-align:start;font-size:22px}.url{direction:ltr;font-size:20px;font-family:monospace}
@media print{.np{display:none}}`;
  const body = `<main><div class="t">${esc(shop.name_ur || shop.name)}</div>
<div class="t" style="font-size:28px">QR اسکین کریں — لائن میں لگیں<br><small>Scan to join the queue</small></div>
<div id="qr">${qrSvg(url)}</div><div class="url">${esc(url)}</div>
<ol><li>کیمرہ سے QR اسکین کریں</li><li>"لائن میں لگیں" دبائیں — اپنا نمبر لیں</li>
<li>چائے پئیں، کام کریں — فون پر نمبر دیکھتے رہیں</li></ol>
<p class="muted">کوئی ایپ نہیں · کوئی SMS نہیں · بالکل مفت</p>
<button class="btn np" onclick="print()">Print</button></main>`;
  return page({ title: `Poster · ${shop.name}`, lang: 'ur', body, css });
}

export function homePage() {
  return page({
    title: 'USTAAD',
    lang: 'ur',
    body: `<main class="c"><h1>USTAAD</h1><p>لائن کا انتظار — اب فون پر</p>
<p class="muted">No app · No SMS · Live queue for barbers</p><p><a href="/q/demo">Demo</a></p></main>`,
  });
}

export function notFoundPage() {
  return page({ title: '404', lang: 'ur', body: '<main class="c"><h1>دکان نہیں ملی · Shop not found</h1></main>' });
}
