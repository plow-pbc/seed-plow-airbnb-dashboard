# family-dashboard

Tiny React app that shows the next 12 events from a shared Google Calendar, served by a Node proxy on the kiosk box.

## Local dev

```sh
cp .env.example .env
# Fill in ICAL_URL with the calendar's private ICS URL.

npm install
just dev    # starts Vite (5173) + API server (5174), Vite proxies /api → 5174
```

Open http://localhost:5173.

## Tests

```sh
just test
```

## Kiosk deploy (Raspberry Pi)

Assumes Node ≥ 20.6 installed at `/usr/bin/node` and the repo cloned to `/home/odio/services/family-dashboard`.

```sh
cd /home/odio/services/family-dashboard
git pull
npm ci
npm run build

cp .env.example .env
# Fill in ICAL_URL.
chmod 600 .env

sudo cp family-dashboard.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now family-dashboard.service
sudo systemctl status family-dashboard.service   # should be "active (running)"
curl -s http://localhost:5174/healthz            # should print "ok"
```

### Pointing the kiosk at the dashboard

The repo ships two Chromium-launcher units: `yodeck-kiosk.service` (points at Yodeck) and `family-kiosk.service` (points at `http://localhost:5174`). Only one runs at a time — both want the display. Install both and swap between them as needed:

```sh
sudo cp yodeck-kiosk.service family-kiosk.service /etc/systemd/system/
sudo systemctl daemon-reload

# Activate the family dashboard (and disable Yodeck):
sudo systemctl disable --now yodeck-kiosk.service
sudo systemctl enable --now family-kiosk.service

# Or flip back to Yodeck:
sudo systemctl disable --now family-kiosk.service
sudo systemctl enable --now yodeck-kiosk.service
```

`family-kiosk.service` orders itself `After=family-dashboard.service` so the proxy is up by the time Chromium opens the URL.

## Configuration

| Variable | Required | Default | Notes |
|---|---|---|---|
| `ICAL_URL` | yes | — | Full private ICS URL. Secret. |
| `PORT` | no | `5174` | Server listen port. |
| `NEXT_N` | no | `12` | Max events displayed. **Baked at build time** — rebuild to change. |
| `REFRESH_MS` | no | `300000` | Page reload interval (5 min). **Baked at build time**. |
| `MESSAGE_API_URL` | no | — | Vercel function URL for the message store. Enables `/api/message`. |
| `DASHBOARD_TOKEN` | no | — | Shared bearer token for the message API. Secret. |

## Architecture

One Node process serves the Vite-built React SPA AND proxies the secret ICS URL at `/api/ical` with a 60-second in-memory cache and stale-on-failure fallback. The React app fetches that same-origin endpoint, parses with `ical.js` (recurrence-aware, drops `STATUS:CANCELLED`), and renders a list of the next `NEXT_N` events. The page calls `location.reload()` every `REFRESH_MS` (5 min default) — that, not in-app polling, is the freshness + state-recovery mechanism. Server binds loopback only; a Host-header allowlist on `/api/*` defends against DNS rebinding.

## Messages (optional)

Plow posts short messages (morning affirmations etc.) to a tiny Vercel function under `api/` backed by Vercel KV. The Pi polls that function through its existing proxy pattern, so the bearer token never reaches the browser. Messages render above the calendar; `expires_at` is respected client-side and hides stale messages without a write.

To enable:

1. **Deploy the Vercel project.** From the repo root: `vercel link` then `vercel deploy --prod`. `vercel.json` already disables the Vite build — only the `api/` functions ship.
2. **Generate a token:** `openssl rand -hex 32`. Set it on Vercel as `DASHBOARD_TOKEN`.
3. **Add a Vercel KV (Upstash) integration** to the project — `KV_REST_API_URL` and `KV_REST_API_TOKEN` are populated automatically.
4. **On the Pi**, set `MESSAGE_API_URL=https://<project>.vercel.app/api/message` and `DASHBOARD_TOKEN=<same-token>` in `.env`, then restart `family-dashboard.service`.

If either env var is missing, the message route is not registered and the dashboard renders the calendar only — the feature is opt-in.

Plow posts messages via the `family-dashboard-poster` team-skill (separate PR in `~/Hacking/Plow`).
