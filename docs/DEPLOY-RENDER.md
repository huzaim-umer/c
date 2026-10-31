# Deploy USTAAD on Render (free)

You'll get a link like `https://ustaad.onrender.com/q/demo` in about 10 minutes. No domain needed.

## Steps

1. **Sign up** at [render.com](https://render.com) using **"Sign in with GitHub"**.
2. **Give access to the repo:** when Render asks, allow it to see `huzaim-umer/c`.
3. **Create the service:** Dashboard → **New +** → **Blueprint** → choose `huzaim-umer/c`, branch **`Barber`**.
   Render reads `render.yaml` and fills in almost everything for you.
4. **Fill in `SHOPS`** when it asks (one shop per line: `slug | Name | Urdu name | PIN`):
   ```
   demo | Ustaad Hair Salon | استاد ہیئر سیلون | 1234
   ```
   Choose your own PIN. The barber logs in with it.
5. Click **Apply** and wait about 2–3 minutes. The build runs the tests first; if any fail, it won't deploy.
6. **Open your links** (replace `ustaad` with the service name Render shows):

   | Who | Link |
   |---|---|
   | Customer | `https://ustaad.onrender.com/q/demo` |
   | Barber | `https://ustaad.onrender.com/b/demo` |
   | TV | `https://ustaad.onrender.com/tv/demo` |
   | QR poster (print it) | `https://ustaad.onrender.com/poster/demo` |

The QR code automatically uses your Render link.

## Adding a shop later
Render dashboard → **ustaad** → **Environment** → edit `SHOPS` → add a line → **Save**. The app restarts with the new shop.

## Free tier: what to know

| Free-tier behaviour | Effect on a shop | What to do |
|---|---|---|
| Sleeps after **15 min with no visitors** | The first person to open the link waits about 30–60 s | Open the barber page and TV **before** opening the shop |
| **Disk wiped on restart / redeploy** | Shops come back (from `SHOPS`), but **today's queue is lost** | Don't change settings or push code **during shop hours** |
| Barber login lost on restart | Barber types the PIN again | — |

This is fine for a **1-week trial**. When a shop starts paying, switch to **Starter ($7/month) + a 1 GB disk** (set `DB_FILE=/var/data/ustaad.db`) so it never sleeps and the queue survives restarts.

## Later: your own domain
Render → **ustaad** → **Settings → Custom Domains** → add `ustaad.pk`, then set `BASE_URL=https://ustaad.pk` and reprint the QR poster.
