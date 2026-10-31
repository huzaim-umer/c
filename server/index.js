import { randomBytes } from 'node:crypto';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { syncShops } from './shops.js';

const env = process.env;
const port = Number(env.PORT || 3000);
let secret = env.SESSION_SECRET;
if (!secret) {
  secret = randomBytes(32).toString('hex');
  console.warn('SESSION_SECRET not set: barbers will be logged out on every restart.');
}

const { server, queue } = createApp({
  db: openDb(),
  secret,
  secureCookies: env.COOKIE_SECURE === '1',
  // Used in QR codes. Render sets RENDER_EXTERNAL_URL (https://<name>.onrender.com) automatically.
  baseUrl: env.BASE_URL || env.RENDER_EXTERNAL_URL,
  trustProxy: env.TRUST_PROXY === '1' || Boolean(env.RENDER),
});

if (env.SHOPS) {
  for (const line of syncShops(queue, env.SHOPS)) console.log(`Shop ${line}`);
}

server.listen(port, () => console.log(`USTAAD running on port ${port}`));

// Render sends SIGTERM on deploy/restart: finish cleanly.
process.on('SIGTERM', () => {
  server.closeAllConnections();
  server.close(() => process.exit(0));
});
