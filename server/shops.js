// Shops can be defined in the SHOPS environment variable, so they come back automatically
// on hosts whose disk is wiped on restart (e.g. Render free tier).
//
// Format: one shop per line (or separated by ";"):  slug | Name | Urdu name | PIN
//   demo | Ustaad Hair Salon | استاد ہیئر سیلون | 1234
import { hashPin, checkPin } from './auth.js';

export function parseShops(spec = '') {
  return spec
    .split(/[;\n]/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [slug, name, nameUr, pin] = line.split('|').map((s) => s.trim());
      if (!/^[a-z0-9-]{2,40}$/.test(slug || '') || !name || !/^\d{4,8}$/.test(pin || '')) {
        throw new Error(`SHOPS: bad entry "${slug || line}". Use: slug | Name | Urdu name | PIN(4-8 digits)`);
      }
      return { slug, name, nameUr: nameUr || null, pin };
    });
}

/** Create missing shops; update name/PIN of existing ones. Returns slugs touched. */
export function syncShops(queue, spec) {
  const out = [];
  for (const s of parseShops(spec)) {
    const existing = queue.shopBySlug(s.slug);
    if (!existing) {
      queue.createShop({ slug: s.slug, name: s.name, nameUr: s.nameUr, pinHash: hashPin(s.pin) });
      out.push(`${s.slug} (created)`);
    } else {
      const pinHash = checkPin(s.pin, existing.pin_hash) ? existing.pin_hash : hashPin(s.pin);
      queue.updateShop(existing.id, { name: s.name, nameUr: s.nameUr, pinHash });
      out.push(`${s.slug} (updated)`);
    }
  }
  return out;
}
