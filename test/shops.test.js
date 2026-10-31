import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { createQueue } from '../server/queue.js';
import { checkPin } from '../server/auth.js';
import { parseShops, syncShops } from '../server/shops.js';

test('SHOPS env creates shops, then updates name/PIN on next start', () => {
  const q = createQueue(openDb(':memory:'));
  const spec = 'demo | Ustaad Salon | استاد سیلون | 1234\nshah-g|Shah G||4821';
  assert.deepEqual(syncShops(q, spec), ['demo (created)', 'shah-g (created)']);
  assert.equal(q.shopBySlug('demo').name_ur, 'استاد سیلون');
  assert.equal(q.shopBySlug('shah-g').name_ur, null);

  syncShops(q, 'demo | Ustaad Salon 2 | استاد | 9999');
  const d = q.shopBySlug('demo');
  assert.equal(d.name, 'Ustaad Salon 2');
  assert.ok(checkPin('9999', d.pin_hash));
  assert.ok(!checkPin('1234', d.pin_hash));
});

test('SHOPS rejects bad entries with a clear message', () => {
  assert.throws(() => parseShops('Demo Shop | x | | 1234'), /bad entry/);
  assert.throws(() => parseShops('demo | x | | 12'), /bad entry/);
  assert.deepEqual(parseShops(' ; '), []);
});
