import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { createQueue, position, etaMin, median, dayKey } from '../server/queue.js';

function setup(start = Date.parse('2026-11-02T10:00:00+05:00')) {
  const clock = { t: start };
  const q = createQueue(openDb(':memory:'), () => clock.t);
  const shop = q.createShop({ slug: 'demo', name: 'Demo', pinHash: 'x:y' });
  const tick = (min) => { clock.t += min * 60_000; };
  return { q, shop, clock, tick };
}

test('numbers go 1,2,3 and the first NEXT calls #1', () => {
  const { q, shop } = setup();
  assert.equal(q.join(shop).number, 1);
  assert.equal(q.join(shop).number, 2);
  assert.equal(q.join(shop, 'walkin').number, 3);
  assert.deepEqual(q.state(shop), { o: 1, n: null, w: [1, 2, 3], a: 900 });
  q.next(shop);
  assert.deepEqual(q.state(shop).n, 1);
  assert.deepEqual(q.state(shop).w, [2, 3]);
});

test('position and ETA: people ahead x average', () => {
  const st = { n: 9, w: [10, 11, 12], a: 300 };
  assert.deepEqual(position(st, 9), { turn: true, ahead: 0 });
  assert.deepEqual(position(st, 12), { turn: false, ahead: 3 }); // 9 (in chair), 10, 11
  assert.equal(position(st, 5), null);
  assert.equal(etaMin(3, 300), 15);
  assert.equal(etaMin(0, 300), 1);
  assert.deepEqual(position({ n: null, w: [4] }, 4), { turn: false, ahead: 0 });
});

test('double tap on NEXT within 3s is ignored (no customer lost)', () => {
  const { q, shop, clock } = setup();
  q.join(shop); q.join(shop); q.join(shop);
  q.next(shop);
  clock.t += 1000;
  assert.equal(q.next(shop), false);
  assert.equal(q.state(shop).n, 1);
  clock.t += 5000;
  q.next(shop);
  assert.equal(q.state(shop).n, 2);
});

test('average learns from real haircuts, ignores mis-taps and forgotten taps', () => {
  const { q, shop, tick } = setup();
  for (let i = 0; i < 8; i++) q.join(shop);
  q.next(shop);                 // call #1
  tick(10); q.next(shop);       // #1 took 10 min
  tick(12); q.next(shop);       // #2 took 12 min
  tick(0.5); q.next(shop);      // #3 "30s" = mis-tap, ignored
  assert.equal(q.state(shop).a, 900, 'needs 3 real samples before changing');
  tick(14); q.next(shop);       // #4 took 14 min
  assert.equal(q.state(shop).a, 12 * 60);
  tick(120); q.next(shop);      // #5 "2 hours" = forgot to tap, ignored
  assert.equal(q.state(shop).a, 12 * 60);
});

test('no-show (skip) does not affect the average', () => {
  const { q, shop, tick } = setup();
  for (let i = 0; i < 5; i++) q.join(shop);
  q.next(shop);
  for (let i = 0; i < 3; i++) { tick(20); q.next(shop, 'skipped'); }
  assert.equal(q.state(shop).a, 900);
  assert.equal(q.state(shop).n, 4);
});

test('closed shop rejects phone joins but barber can still add walk-ins', () => {
  const { q, shop } = setup();
  q.setOpen(shop, false);
  assert.equal(q.join(shop, 'link'), null);
  assert.equal(q.join(shop, 'walkin').number, 1);
});

test('numbers restart every day (Pakistan time) and old tokens expire', () => {
  const { q, shop, clock } = setup(Date.parse('2026-11-02T23:50:00+05:00'));
  const t = q.join(shop);
  q.join(shop);
  assert.ok(q.token(shop, t.id, t.secret));
  assert.equal(q.token(shop, t.id, 'wrong'), null);
  clock.t = Date.parse('2026-11-03T00:05:00+05:00');
  assert.equal(dayKey(clock.t), '2026-11-03');
  assert.deepEqual(q.state(shop).w, []);
  assert.equal(q.token(shop, t.id, t.secret), null);
  assert.equal(q.join(shop).number, 1);
});

test('leaving the queue removes you; others move up', () => {
  const { q, shop } = setup();
  q.join(shop); const me = q.join(shop); q.join(shop);
  q.leave(shop, me.id);
  assert.deepEqual(q.state(shop).w, [1, 3]);
});

test('median', () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([1, 2, 3, 4]), 3);
});
