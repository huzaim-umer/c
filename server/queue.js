// All queue business rules live here. No HTTP, no HTML.
import { randomBytes } from 'node:crypto';

const PK_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit',
});
/** Token numbers restart every day, Pakistan time. */
export const dayKey = (ms) => PK_DAY.format(ms);

export const RULES = {
  MIN_SERVICE_SEC: 60,     // a "haircut" under 1 min is a mis-tap -> ignored for average
  MAX_SERVICE_SEC: 3600,   // over 1 hour -> barber forgot to tap -> ignored
  SAMPLES: 10,             // average = median of last 10 haircuts
  MIN_SAMPLES: 3,          // until then, keep the shop's default
  DOUBLE_TAP_MS: 3000,     // "Next" twice within 3s = accidental double tap -> ignored
};

export function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/**
 * Where is `number` in the queue?
 * st = { n: serving number|null, w: [waiting numbers in order] }
 * -> { turn: true } | { turn: false, ahead } | null (not in queue any more)
 */
export function position(st, number) {
  if (st.n === number) return { turn: true, ahead: 0 };
  const i = st.w.indexOf(number);
  if (i < 0) return null;
  return { turn: false, ahead: i + (st.n != null ? 1 : 0) };
}

/** Minutes until it's your turn: people ahead x average haircut time. */
export const etaMin = (ahead, avgSec) => Math.max(1, Math.round((ahead * avgSec) / 60));

export function createQueue(db, now = Date.now) {
  const q = (sql) => db.prepare(sql);
  const S = {
    shopBySlug: q('SELECT * FROM shops WHERE slug = ?'),
    shopById: q('SELECT * FROM shops WHERE id = ?'),
    createShop: q('INSERT INTO shops (slug, name, name_ur, pin_hash, created_at) VALUES (?, ?, ?, ?, ?)'),
    setOpen: q('UPDATE shops SET is_open = ? WHERE id = ?'),
    setAvg: q('UPDATE shops SET avg_service_sec = ? WHERE id = ?'),
    serving: q("SELECT * FROM tokens WHERE shop_id = ? AND day = ? AND status = 'serving'"),
    waiting: q("SELECT number FROM tokens WHERE shop_id = ? AND day = ? AND status = 'waiting' ORDER BY number"),
    firstWaiting: q("SELECT id FROM tokens WHERE shop_id = ? AND day = ? AND status = 'waiting' ORDER BY number LIMIT 1"),
    maxNumber: q('SELECT COALESCE(MAX(number), 0) AS m FROM tokens WHERE shop_id = ? AND day = ?'),
    insert: q('INSERT INTO tokens (shop_id, day, number, source, secret, joined_at) VALUES (?, ?, ?, ?, ?, ?)'),
    token: q('SELECT * FROM tokens WHERE id = ? AND shop_id = ?'),
    finish: q('UPDATE tokens SET status = ?, done_at = ? WHERE id = ?'),
    call: q("UPDATE tokens SET status = 'serving', called_at = ? WHERE id = ?"),
    leave: q("UPDATE tokens SET status = 'left', done_at = ? WHERE id = ? AND status = 'waiting'"),
    durations: q(`SELECT done_at - called_at AS ms FROM tokens
                  WHERE shop_id = ? AND status = 'done' AND called_at IS NOT NULL
                  ORDER BY done_at DESC LIMIT ?`),
  };

  const tx = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); db.exec('COMMIT'); return r; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  const today = () => dayKey(now());

  /** Re-learn the shop's speed from its most recent real haircuts. */
  function relearnAverage(shopId) {
    const secs = S.durations.all(shopId, RULES.SAMPLES * 2)
      .map((r) => Math.round(r.ms / 1000))
      .filter((s) => s >= RULES.MIN_SERVICE_SEC && s <= RULES.MAX_SERVICE_SEC)
      .slice(0, RULES.SAMPLES);
    if (secs.length >= RULES.MIN_SAMPLES) S.setAvg.run(median(secs), shopId);
  }

  return {
    shopBySlug: (slug) => S.shopBySlug.get(slug),

    createShop({ slug, name, nameUr = null, pinHash }) {
      return Number(S.createShop.run(slug, name, nameUr, pinHash, now()).lastInsertRowid);
    },

    /** Public state, broadcast to every screen. Tiny on purpose (~30-200 bytes). */
    state(shopId) {
      const shop = S.shopById.get(shopId);
      const d = today();
      const cur = S.serving.get(shopId, d);
      return {
        o: shop.is_open ? 1 : 0,                         // open?
        n: cur ? cur.number : null,                      // now serving
        w: S.waiting.all(shopId, d).map((r) => r.number),// waiting, in order
        a: shop.avg_service_sec,                         // avg seconds per customer
      };
    },

    /** Customer joins (source 'link') or barber adds a walk-in. Returns null if shop closed. */
    join(shopId, source = 'link') {
      return tx(() => {
        const shop = S.shopById.get(shopId);
        if (!shop.is_open && source === 'link') return null;
        const d = today();
        const number = S.maxNumber.get(shopId, d).m + 1;
        const secret = randomBytes(9).toString('base64url');
        const id = Number(S.insert.run(shopId, d, number, source, secret, now()).lastInsertRowid);
        return { id, number, secret };
      });
    },

    /** Token owned by a phone, only if it's from today and the secret matches. */
    token(shopId, id, secret) {
      const t = S.token.get(id, shopId);
      if (!t || t.secret !== secret || t.day !== today()) return null;
      return t;
    },

    leave(shopId, id) { S.leave.run(now(), id); },

    /**
     * Barber taps NEXT (outcome 'done') or NO-SHOW (outcome 'skipped'):
     * finish current customer, call the next waiting number.
     */
    next(shopId, outcome = 'done') {
      return tx(() => {
        const d = today();
        const t = now();
        const cur = S.serving.get(shopId, d);
        if (cur && cur.called_at && t - cur.called_at < RULES.DOUBLE_TAP_MS) return false;
        if (cur) {
          S.finish.run(outcome, t, cur.id);
          if (outcome === 'done') relearnAverage(shopId);
        }
        const nxt = S.firstWaiting.get(shopId, d);
        if (nxt) S.call.run(t, nxt.id);
        return Boolean(cur || nxt);
      });
    },

    setOpen(shopId, open) { S.setOpen.run(open ? 1 : 0, shopId); },
  };
}
