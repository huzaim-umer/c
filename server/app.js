import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { createQueue } from './queue.js';
import { createHub } from './hub.js';
import { checkPin, createSigner, createLoginLimiter } from './auth.js';
import { STR } from './i18n.js';
import * as V from './views.js';

const ROUTE = /^\/(q|b|tv|poster|api)\/([a-z0-9-]{2,40})(?:\/([a-z]+))?\/?$/;
const YEAR = 365 * 24 * 3600;

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function readForm(req, limit = 2048) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (c) => {
      data += c;
      if (data.length > limit) { reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => resolve(new URLSearchParams(data)));
    req.on('error', reject);
  });
}

export function createApp({ db, secret, secureCookies = false, baseUrl, now = Date.now }) {
  const queue = createQueue(db, now);
  const hub = createHub();
  const signer = createSigner(secret);
  const limiter = createLoginLimiter({ now });
  const publish = (shopId) => hub.publish(shopId, queue.state(shopId));

  const cookie = (name, value, maxAge) =>
    `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secureCookies ? '; Secure' : ''}`;

  function send(req, res, status, body, type = 'text/html; charset=utf-8', headers = {}) {
    let buf = Buffer.from(body);
    const h = { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers };
    if (buf.length > 512 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      buf = gzipSync(buf);
      h['Content-Encoding'] = 'gzip';
      h.Vary = 'Accept-Encoding';
    }
    h['Content-Length'] = buf.length;
    res.writeHead(status, h);
    res.end(req.method === 'HEAD' ? undefined : buf);
  }
  const redirect = (res, to, headers = {}) => { res.writeHead(303, { Location: to, ...headers }); res.end(); };

  // Barber session cookie is tied to the PIN hash: changing the PIN logs everyone out.
  const barberSession = (shop) => `${shop.id}:${shop.pin_hash.slice(0, 12)}`;
  const isBarber = (req, shop) => signer.verify(parseCookies(req)[`b_${shop.slug}`]) === barberSession(shop);

  function customerToken(req, shop) {
    const raw = parseCookies(req)[`t_${shop.slug}`];
    if (!raw) return null;
    const [id, sec] = raw.split('.');
    return queue.token(shop.id, Number(id), sec);
  }

  function langOf(req, url) {
    const q = url.searchParams.get('l');
    if (q && STR[q]) return { lang: q, setCookie: cookie('l', q, YEAR) };
    const c = parseCookies(req).l;
    return { lang: STR[c] ? c : 'ur' };
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const base = baseUrl || `http://${req.headers.host}`;
    const get = req.method === 'GET' || req.method === 'HEAD';
    const post = req.method === 'POST';

    if (get && url.pathname === '/') return send(req, res, 200, V.homePage());
    if (get && url.pathname === '/healthz') return send(req, res, 200, 'ok', 'text/plain');

    const m = ROUTE.exec(url.pathname);
    const shop = m && queue.shopBySlug(m[2]);
    if (!shop) return send(req, res, 404, V.notFoundPage());
    const [, area, , action] = m;

    // ----- Customer -----
    if (area === 'q') {
      if (get && !action) {
        const { lang, setCookie } = langOf(req, url);
        const html = V.customerPage({ shop, st: queue.state(shop.id), tok: customerToken(req, shop), lang });
        return send(req, res, 200, html, undefined, setCookie ? { 'Set-Cookie': setCookie } : {});
      }
      if (post && action === 'join') {
        // One active number per phone: re-joining just shows the same number.
        const existing = customerToken(req, shop);
        if (existing && (existing.status === 'waiting' || existing.status === 'serving')) {
          return redirect(res, `/q/${shop.slug}`);
        }
        const t = queue.join(shop.id, 'link');
        if (!t) return redirect(res, `/q/${shop.slug}`);
        publish(shop.id);
        return redirect(res, `/q/${shop.slug}`, { 'Set-Cookie': cookie(`t_${shop.slug}`, `${t.id}.${t.secret}`, 86400) });
      }
      if (post && action === 'leave') {
        const t = customerToken(req, shop);
        if (t) { queue.leave(shop.id, t.id); publish(shop.id); }
        return redirect(res, `/q/${shop.slug}`, { 'Set-Cookie': cookie(`t_${shop.slug}`, '', 0) });
      }
    }

    // ----- Live data (public, no personal info) -----
    if (area === 'api' && get) {
      if (action === 'state') return send(req, res, 200, JSON.stringify(queue.state(shop.id)), 'application/json');
      if (action === 'events') return hub.subscribe(shop.id, req, res, queue.state(shop.id));
    }

    // ----- TV + poster -----
    if (area === 'tv' && get && !action) return send(req, res, 200, V.tvPage({ shop, st: queue.state(shop.id), base }));
    if (area === 'poster' && get && !action) return send(req, res, 200, V.posterPage({ shop, base }));

    // ----- Barber -----
    if (area === 'b') {
      if (post && action === 'login') {
        const key = `${shop.id}|${req.socket.remoteAddress}`;
        if (limiter.blocked(key)) return send(req, res, 429, V.loginPage({ shop, error: '5 منٹ بعد کوشش کریں · Try again in 5 minutes' }));
        const form = await readForm(req);
        if (!checkPin(form.get('pin') || '', shop.pin_hash)) {
          limiter.fail(key);
          return send(req, res, 401, V.loginPage({ shop, error: 'غلط پن · Wrong PIN' }));
        }
        limiter.reset(key);
        return redirect(res, `/b/${shop.slug}`, { 'Set-Cookie': cookie(`b_${shop.slug}`, signer.sign(barberSession(shop)), 30 * 86400) });
      }
      if (!isBarber(req, shop)) return get && !action ? send(req, res, 200, V.loginPage({ shop })) : redirect(res, `/b/${shop.slug}`);

      if (get && !action) {
        const walkin = url.searchParams.get('w');
        return send(req, res, 200, V.barberPage({ shop, st: queue.state(shop.id), walkin, base }));
      }
      if (post) {
        let to = `/b/${shop.slug}`;
        switch (action) {
          case 'next': queue.next(shop.id, 'done'); break;
          case 'skip': queue.next(shop.id, 'skipped'); break;
          case 'walkin': to += `?w=${queue.join(shop.id, 'walkin').number}`; break;
          case 'open': queue.setOpen(shop.id, true); break;
          case 'close': queue.setOpen(shop.id, false); break;
          case 'logout': return redirect(res, to, { 'Set-Cookie': cookie(`b_${shop.slug}`, '', 0) });
          default: return send(req, res, 404, V.notFoundPage());
        }
        publish(shop.id);
        return redirect(res, to);
      }
    }

    return send(req, res, 404, V.notFoundPage());
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) send(req, res, 500, 'Server error', 'text/plain');
      else res.end();
    });
  });
  server.on('close', () => hub.close());
  return { server, queue, hub };
}
