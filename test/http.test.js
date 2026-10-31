import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { hashPin } from '../server/auth.js';

let app, base;
const clock = { t: Date.parse('2026-11-02T10:00:00+05:00') };

before(async () => {
  app = createApp({ db: openDb(':memory:'), secret: 'test', now: () => clock.t });
  app.queue.createShop({ slug: 'demo', name: 'Ustaad Salon', nameUr: 'استاد سیلون', pinHash: hashPin('1234') });
  await new Promise((r) => app.server.listen(0, r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(() => { app.server.closeAllConnections(); app.server.close(); });

const req = (path, { method = 'GET', body, cookie } = {}) =>
  fetch(base + path, {
    method, redirect: 'manual', body,
    headers: { ...(cookie && { cookie }), ...(body && { 'content-type': 'application/x-www-form-urlencoded' }) },
  });
const cookieOf = (res) => res.headers.get('set-cookie')?.split(';')[0];

test('full day: customer joins, barber calls, customer sees turn', async () => {
  // Customer opens link (Urdu by default)
  let r = await req('/q/demo');
  let html = await r.text();
  assert.equal(r.status, 200);
  assert.match(html, /dir="rtl"/);
  assert.match(html, /لائن میں لگیں/);

  // Two customers join
  r = await req('/q/demo/join', { method: 'POST' });
  assert.equal(r.status, 303);
  const c1 = cookieOf(r);
  const c2 = cookieOf(await req('/q/demo/join', { method: 'POST' }));

  // Joining twice from same phone keeps the same number
  r = await req('/q/demo/join', { method: 'POST', cookie: c1 });
  assert.equal(r.headers.get('set-cookie'), null);

  html = await (await req('/q/demo', { cookie: c2 })).text();
  assert.match(html, /class="big">2</);
  assert.match(html, /1 لوگ آپ سے آگے ہیں/);

  // Barber: wrong PIN, then right PIN
  assert.equal((await req('/b/demo/login', { method: 'POST', body: 'pin=0000' })).status, 401);
  assert.equal((await req('/b/demo/next', { method: 'POST' })).headers.get('location'), '/b/demo'); // not logged in -> no-op
  assert.deepEqual(await (await req('/api/demo/state')).json(), { o: 1, n: null, w: [1, 2], a: 900 });
  r = await req('/b/demo/login', { method: 'POST', body: 'pin=1234' });
  const barber = cookieOf(r);
  assert.match(await (await req('/b/demo', { cookie: barber })).text(), /NEXT/);

  // NEXT -> #1 in chair; customer 2 is next
  await req('/b/demo/next', { method: 'POST', cookie: barber });
  html = await (await req('/q/demo', { cookie: c2 })).text();
  assert.match(html, /آپ اگلے ہیں/);

  clock.t += 10 * 60_000;
  await req('/b/demo/next', { method: 'POST', cookie: barber });
  html = await (await req('/q/demo?l=en', { cookie: c2 })).text();
  assert.match(html, /It's your turn/);
  assert.match(html, /dir="ltr"/);

  // Walk-in gets a number shown to barber
  r = await req('/b/demo/walkin', { method: 'POST', cookie: barber });
  assert.equal(r.headers.get('location'), '/b/demo?w=3');
});

test('live updates arrive over SSE when barber taps', async () => {
  const st = await new Promise((resolve, reject) => {
    http.get(`${base}/api/demo/events`, (res) => {
      assert.equal(res.headers['content-type'], 'text/event-stream; charset=utf-8');
      let buf = '', n = 0;
      res.setEncoding('utf8');
      res.on('data', (c) => {
        buf += c;
        const msgs = buf.split('\n\n').filter((m) => m.startsWith('data: '));
        if (msgs.length > n) {
          n = msgs.length;
          if (n === 1) req('/q/demo/join', { method: 'POST' }); // trigger a change
          else { res.destroy(); resolve(JSON.parse(msgs[1].slice(6))); }
        }
      });
    }).on('error', reject);
  });
  assert.ok(st.w.includes(4));
});

test('closing the shop blocks new joins', async () => {
  const barber = cookieOf(await req('/b/demo/login', { method: 'POST', body: 'pin=1234' }));
  await req('/b/demo/close', { method: 'POST', cookie: barber });
  const html = await (await req('/q/demo')).text();
  assert.match(html, /دکان ابھی بند ہے/);
  assert.doesNotMatch(html, /\/join"/);
  await req('/b/demo/open', { method: 'POST', cookie: barber });
});

test('customer page is tiny: under 15 KB gzipped (2G budget)', async () => {
  const c = cookieOf(await req('/q/demo/join', { method: 'POST' }));
  for (const [path, cookie] of [['/q/demo'], ['/q/demo', c]]) {
    const raw = await (await req(path, { cookie })).text();
    const gz = gzipSync(raw).length;
    assert.ok(gz < 15_000, `${path} is ${gz} bytes gzipped`);
  }
});

test('unknown shop -> 404, TV and poster render', async () => {
  assert.equal((await req('/q/nope')).status, 404);
  assert.match(await (await req('/tv/demo')).text(), /NOW SERVING/);
  assert.match(await (await req('/poster/demo')).text(), /QR/);
});
