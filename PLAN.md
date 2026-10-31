# USTAAD — Zero-SMS Live Queue for Barbers (Pindi)

Copying the QLess / Waitwise model: no SMS or WhatsApp. The customer keeps a **live link** open and the phone beeps and vibrates when their turn is near.

## 1. How it works

```
 Customer scans QR at shop ──► ustaad.pk/q/shop12 ──► "Join" ──► gets Token #12
                                                                  │
 Barber tablet: [Next ▶] ──► server: now_serving = 9 ─────────────┤ (push update)
                                                                  ▼
 Shop TV:  "ABHI NUMBER 9"                Customer phone (live page):
                                          "Aapka Number 12 — 3 log aage — ~15 min"
                                          ≤ 2 ahead → beep + vibrate + notification
```

**Three screens, one shop state:**

| Screen | Who | Does |
|---|---|---|
| **Live page** `/q/{shop}` | Customer | Join → token. Shows token, people ahead, ETA. Beeps when near. |
| **Barber panel** `/b/{shop}` | Barber (tablet/phone) | `Next`, `Skip`, `Add walk-in`, pause/open queue. |
| **TV display** `/tv/{shop}` | Shop TV / old tablet | Big "Abhi Number 9" + the next 3 tokens + QR to join. |

**ETA** = people ahead × the shop's rolling average service time (the median of the last 10 haircuts, measured from "Next" taps).

**Alerts without SMS (free):**
1. While the page is open: Server-Sent Events (SSE) update the page, with `navigator.vibrate()` and a short beep from Web Audio. No audio file is needed.
2. With the page closed: Web Push (VAPID). This works on Android Chrome, which is most Pindi phones. Free.
3. Fallback: the page polls every 20 s if SSE drops on 2G.
4. If the customer misses the turn, the token stays "skipped" for 10 min and the barber can recall it.

## 2. The 2G / cheap Android constraint (<50 KB)

- One server-rendered HTML page with inline CSS and about 3 KB of vanilla JS. No framework, no web fonts, no images except an inline SVG logo.
- Urdu uses the system font (`Noto Nastaliq` / Android default). Toggle with `?l=ur|en`. Default is Urdu.
- Live updates send only tiny JSON: `{"n":9,"ahead":3,"eta":15}` (about 30 bytes).
- The page works even if JS fails: it uses `<meta refresh>` as the last fallback.
- Target: **<15 KB gzipped** first load. The budget is checked in CI.

## 3. Tech stack (cheap, simple)

- **Backend:** Node.js + Hono (or Fastify), one process.
- **DB:** SQLite (`better-sqlite3`). Plenty for hundreds of shops. Move to Postgres later.
- **Realtime:** SSE (lighter than WebSockets and works through proxies).
- **Push:** `web-push` library with VAPID keys.
- **Hosting:** one Rs. ~1500/month VPS (Hetzner/DO) + Cloudflare in front (free CDN, TLS, cheap in PK).
- **Auth:** the barber logs in with phone + PIN. Customers need no login: the token is stored in a cookie or localStorage.

**Data model:**
```
shops(id, slug, name, name_ur, pin_hash, avg_service_sec, is_open)
tokens(id, shop_id, number, status[waiting|serving|done|skipped], joined_at, called_at, done_at, push_sub)
```
Token numbers reset daily.

## 4. Build phases

| Phase | Scope | Outcome |
|---|---|---|
| **P0 – MVP** (1 wk) | Live page + barber panel + TV view, SSE, Urdu/English, SQLite | One real barber can run a day on it |
| **P1 – Alerts** (3–4 days) | Web Push, vibrate/beep, "turn near" at ≤2 ahead, missed-turn recall | Customers can leave the shop |
| **P2 – Onboarding** (3–4 days) | Shop signup, printable QR poster (A4, Urdu), per-shop settings | A new shop goes live in 5 min |
| **P3 – Billing & admin** (1 wk) | Rs. 999/month flat, JazzCash/Easypaisa, admin dashboard, daily stats | Revenue |
| **P4 – Polish** | Offline-tolerant barber panel, PWA install, multiple barbers per shop, analytics (peak hours) | Retention |

## 5. Repo layout (proposed)

```
/server     Hono app, routes, SSE hub, push sender
/views      HTML templates (live, barber, tv) – inline CSS/JS
/db         schema.sql, migrations
/scripts    size-budget check, seed demo shop
PLAN.md
```

## 6. Risks and answers

- **Customer's data runs out or the browser kills the tab:** Web Push still reaches them, and the TV in the shop is the backup.
- **iPhone push needs PWA install:** a small share of users in Pindi. Show an "Add to Home Screen" hint.
- **The barber forgets to tap Next:** the ETA goes wrong. Make the button huge and add a TV nudge after 25 min with no change.
- **No-shows:** auto-skip after the recall window. Shops can cap tokens per phone.

## 7. Economics

Rs. 0 per message. Running cost is about Rs. 1500/month for the server across all shops, against Rs. 999/month per shop in revenue. Break-even is 2 shops.
