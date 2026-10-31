import { randomBytes } from 'node:crypto';
import { openDb } from './db.js';
import { createApp } from './app.js';

const port = Number(process.env.PORT || 3000);
let secret = process.env.SESSION_SECRET;
if (!secret) {
  secret = randomBytes(32).toString('hex');
  console.warn('SESSION_SECRET not set: barbers will be logged out on every restart.');
}

const { server } = createApp({
  db: openDb(),
  secret,
  secureCookies: process.env.COOKIE_SECURE === '1',
  baseUrl: process.env.BASE_URL, // e.g. https://ustaad.pk (used in QR codes)
});

server.listen(port, () => console.log(`USTAAD running on http://localhost:${port}`));
