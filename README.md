# plow-airbnb-dashboard

## Purpose

Tiny React app served by a Node proxy on the kiosk box. With a shared Google Calendar it shows the next 12 events; with a Hostex OpenAPI token it shows a two-month availability calendar for every listing the token covers. On a Raspberry Pi it runs as a systemd service behind a companion Chromium kiosk unit that displays it full-screen.

## Install

This repo is a [SEED](https://github.com/plow-pbc/seed) — `SEED.md` describes a one-time, agent-driven install of the dashboard + kiosk onto a Raspberry Pi, either locally or remotely over SSH. The equivalent manual steps are under [Kiosk deploy](#kiosk-deploy-raspberry-pi) below.

## Local dev

```sh
cp .env.example .env
# Fill in ICAL_URL (private ICS URL) or HOSTEX_ACCESS_TOKEN — exactly one.

npm install
just dev    # starts Vite (5173) + API server (5174), Vite proxies /api → 5174
```

Open http://localhost:5173.

## Tests

```sh
just test
```

## Kiosk deploy (Raspberry Pi)

Assumes Node ≥ 20.6 installed at `/usr/bin/node` and the repo cloned to `/home/odio/services/plow-airbnb-dashboard`.

```sh
cd /home/odio/services/plow-airbnb-dashboard
git pull
npm ci
npm run build

cp .env.example .env
# Fill in ICAL_URL or HOSTEX_ACCESS_TOKEN — exactly one.
chmod 600 .env

sudo cp plow-airbnb-dashboard.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now plow-airbnb-dashboard.service
sudo systemctl status plow-airbnb-dashboard.service   # should be "active (running)"
curl -s http://localhost:5174/healthz            # should print "ok"
```

### Pointing the kiosk at the dashboard

The repo ships `plow-airbnb-kiosk.service`, a Chromium-launcher unit pointed at `http://localhost:5174`. Install and enable it:

```sh
sudo cp plow-airbnb-kiosk.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now plow-airbnb-kiosk.service
```

`plow-airbnb-kiosk.service` orders itself `After=plow-airbnb-dashboard.service` so the proxy is up by the time Chromium opens the URL.

## Configuration

| Variable | Required | Default | Notes |
|---|---|---|---|
| `ICAL_URL` | one of¹ | — | Full private ICS URL — drives the event-list view. Secret. |
| `HOSTEX_ACCESS_TOKEN` | one of¹ | — | Hostex OpenAPI token — drives the availability-calendar view. Wins if both are set. Secret. |
| `PORT` | no | `5174` | Server listen port. |
| `NEXT_N` | no | `12` | Max events displayed (ICS view only). **Baked at build time** — rebuild to change. |
| `REFRESH_MS` | no | `300000` | Page reload interval (5 min). **Baked at build time**. |
| `MESSAGE_API_URL` | no | — | Vercel function URL for the message store. Enables `/api/message`. |
| `DASHBOARD_TOKEN` | no | — | Shared bearer token for the message API. Secret. |

¹ Exactly one of `ICAL_URL` / `HOSTEX_ACCESS_TOKEN` must be set.

## Architecture

One Node process serves the Vite-built React SPA AND proxies the calendar source at `/api/calendar` with a 60-second in-memory cache and stale-on-failure fallback. The proxy keeps the secret credential server-side and returns a JSON envelope tagged with its `source`, so the same build picks its view at runtime:

- **ICS mode** (`ICAL_URL`) — the envelope carries the raw ICS; the React app parses it with `ical.js` (recurrence-aware, drops `STATUS:CANCELLED`) and renders a list of the next `NEXT_N` events.
- **Hostex mode** (`HOSTEX_ACCESS_TOKEN`) — the proxy calls the Hostex OpenAPI (`GET /v3/properties`, `GET /v3/reservations`, and `POST /v3/listings/calendar`) and the app renders a scrollable reservation timeline: one row per home, with reservation bars labelled by guest, channel, and nights, and owner-blocked dates (inventory 0, no reservation) hatched.

The page calls `location.reload()` every `REFRESH_MS` (5 min default) — that, not in-app polling, is the freshness + state-recovery mechanism. Server binds loopback only; a Host-header allowlist on `/api/*` defends against DNS rebinding.

## Messages (optional)

Plow posts typed messages (`affirmation`, `alert`, `reminder`, ...) to a tiny Vercel function under `api/` backed by Vercel KV. Storage is a Redis list — each POST `LPUSH`es a record and `LTRIM`s to the most recent 50. The Pi polls the function through its existing proxy pattern (so the bearer token never reaches the browser) and requests `?type=affirmation` for the top slot, which renders the latest unexpired affirmation above the calendar. `expires_at` is respected client-side and hides stale messages without a write.

To enable:

1. **Deploy the Vercel project.** From the repo root: `vercel link` then `vercel deploy --prod`. `vercel.json` already disables the Vite build — only the `api/` functions ship.
2. **Generate a token:** `openssl rand -hex 32`. Set it on Vercel as `DASHBOARD_TOKEN`.
3. **Add a Vercel KV (Upstash) integration** to the project — `KV_REST_API_URL` and `KV_REST_API_TOKEN` are populated automatically.
4. **On the Pi**, set `MESSAGE_API_URL=https://<project>.vercel.app/api/message` and `DASHBOARD_TOKEN=<same-token>` in `.env`, then restart `plow-airbnb-dashboard.service`.

If either env var is missing, the message route is not registered and the dashboard renders the calendar only — the feature is opt-in.

Plow posts messages via the `plow-airbnb-dashboard-poster` team-skill (separate PR in `~/Hacking/Plow`).
