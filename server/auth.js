import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';

export function hashPin(pin) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(String(pin), salt, 32).toString('hex')}`;
}

export function checkPin(pin, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const a = scryptSync(String(pin), salt, 32);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Signed cookie values so a barber session can't be forged. */
export function createSigner(secret) {
  const mac = (v) => createHmac('sha256', secret).update(v).digest('base64url');
  return {
    sign: (v) => `${v}.${mac(v)}`,
    verify(s) {
      if (typeof s !== 'string') return null;
      const i = s.lastIndexOf('.');
      if (i < 1) return null;
      const v = s.slice(0, i);
      const got = Buffer.from(s.slice(i + 1));
      const want = Buffer.from(mac(v));
      return got.length === want.length && timingSafeEqual(got, want) ? v : null;
    },
  };
}

/** 5 wrong PINs -> locked for 5 minutes (per shop + IP). */
export function createLoginLimiter({ max = 5, windowMs = 5 * 60_000, now = Date.now } = {}) {
  const fails = new Map();
  return {
    blocked(key) {
      const e = fails.get(key);
      return Boolean(e) && e.count >= max && now() - e.t < windowMs;
    },
    fail(key) {
      const e = fails.get(key);
      if (!e || now() - e.t >= windowMs) fails.set(key, { count: 1, t: now() });
      else e.count++;
    },
    reset: (key) => fails.delete(key),
  };
}
