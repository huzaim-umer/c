// Usage: npm run add-shop -- <slug> "<Name>" "<Urdu name>" <PIN>
// Example: npm run add-shop -- demo "Ustaad Hair Salon" "استاد حجام" 1234
import { openDb } from '../server/db.js';
import { createQueue } from '../server/queue.js';
import { hashPin } from '../server/auth.js';

const [slug, name, nameUr, pin] = process.argv.slice(2);
if (!slug || !name || !pin || !/^[a-z0-9-]{2,40}$/.test(slug) || !/^\d{4,8}$/.test(pin)) {
  console.error('Usage: npm run add-shop -- <slug a-z0-9-> "<Name>" "<Urdu name>" <PIN 4-8 digits>');
  process.exit(1);
}

const queue = createQueue(openDb());
if (queue.shopBySlug(slug)) {
  console.error(`Shop "${slug}" already exists.`);
  process.exit(1);
}
queue.createShop({ slug, name, nameUr: nameUr || null, pinHash: hashPin(pin) });
console.log(`Created ${slug}:
  Customer link : /q/${slug}
  Barber panel  : /b/${slug}   (PIN ${pin})
  TV screen     : /tv/${slug}
  QR poster     : /poster/${slug}`);
