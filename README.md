# plow-airbnb-dashboard

## Purpose

Tiny React app served by a Node proxy on the kiosk box. It renders a configurable dashboard of views — an upcoming-events list from a shared Google Calendar, a Hostex availability timeline, a Guesty availability timeline, a wall clock — auto-fitting as many as the screen holds and moving the rest to tabs. On a Raspberry Pi it runs as a systemd service behind a companion Chromium kiosk unit that displays it full-screen.

## Install

This repo is a [SEED](https://github.com/plow-pbc/seed) — `SEED.md` describes a one-time, agent-driven install of the dashboard + kiosk onto a Raspberry Pi, either locally or remotely over SSH. The equivalent manual steps are under [Kiosk deploy](#kiosk-deploy-raspberry-pi) below.

## Local dev

```sh
cp .env.example .env
# Fill in at least one source: ICAL_URL (private ICS URL), HOSTEX_ACCESS_TOKEN,
# or both GUESTY_CLIENT_ID and GUESTY_CLIENT_SECRET.

npm install
just dev    # starts Vite (5173) + API server (5174), Vite proxies /api → 5174
```

Open http://localhost:5173.

## Tests

```sh
just test
```

### Manual / visual checks

Some behaviors aren't covered by `just test` and need a browser. Run only the section that matches what you changed.

#### Guesty reservations panel — confirmed vs. pending bar styling

Confirms that `confirmed` bookings render as a solid bar and `reserved` (channel-pending) holds render with diagonal stripes plus a `(pending)` tooltip. The fastest setup uses the `guesty-dtu` mock — no real OAuth tokens are burned (Guesty caps `client_id`s at 5 issuances / 24 h).

1. **Start the Guesty mock** in one terminal:

   ```sh
   cd guesty-dtu
   npm install   # one-time
   npm start     # listens on http://localhost:8787
   ```

2. **Boot the dashboard** in another terminal, pointed at the mock:

   ```sh
   GUESTY_CLIENT_ID=dtu-test-id \
   GUESTY_CLIENT_SECRET=dtu-test-secret \
   GUESTY_API_BASE=http://localhost:8787 \
   just dev
   ```

3. Open http://localhost:5173 in a browser.

What to verify:

- The **"Guesty Reservations"** panel appears alongside any other configured panels.
- Each home's row shows a mix of solid (confirmed) and diagonally striped (pending) bars. Both share the same in-progress / upcoming / past colour palette as the Hostex panel.
- Hovering a pending bar shows a tooltip ending in `(pending)`; confirmed bars don't.
- In DevTools, pending bars carry `data-status="reserved"`; confirmed bars carry no `data-status` attribute.

The DTU's fixture data (`guesty-dtu/fixtures/reservations.js`) deliberately mixes statuses across `airbnb2` / `vrbo` / `bookingCom` / `manual` platforms so all variants render in one screenshot.

#### Hostex reservations panel

If you change `src/components/HostexTimeline.tsx` or the shared helpers in `src/hostex.ts`, also load a Hostex-tokened dashboard and confirm the existing panel still renders cleanly (no console errors, bars in the right columns, weekend shading visible).

## Kiosk deploy (Raspberry Pi)

Assumes Node ≥ 20.6 installed at `/usr/bin/node` and the repo cloned to `/home/odio/services/plow-airbnb-dashboard`.

```sh
cd /home/odio/services/plow-airbnb-dashboard
git pull
npm ci
npm run build

cp .env.example .env
# Fill in at least one source: ICAL_URL, HOSTEX_ACCESS_TOKEN, or both
# GUESTY_CLIENT_ID and GUESTY_CLIENT_SECRET.
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
| `ICAL_URL` | one of¹ | — | Full private ICS URL — adds an event-list panel. Secret. |
| `HOSTEX_ACCESS_TOKEN` | one of¹ | — | Hostex OpenAPI token — adds an availability-timeline panel. Secret. |
| `GUESTY_CLIENT_ID` | one of¹ | — | Guesty Open API client id. Pair with `GUESTY_CLIENT_SECRET` to add a Guesty availability-timeline panel. Secret. |
| `GUESTY_CLIENT_SECRET` | one of¹ | — | Guesty Open API client secret. Required alongside `GUESTY_CLIENT_ID`. Secret. |
| `GUESTY_API_BASE` | no | `https://open-api.guesty.com` | Override the Guesty Open API base URL. Point at `http://localhost:8787` (or wherever `guesty-dtu` is running) for local dev / CI to avoid burning real OAuth tokens. |
| `PORT` | no | `5174` | Server listen port. |
| `NEXT_N` | no | `12` | Max events displayed (ICS view only). **Baked at build time** — rebuild to change. |
| `REFRESH_MS` | no | `300000` | Page reload interval (5 min). **Baked at build time**. |
| `MESSAGE_API_URL` | no | — | Vercel function URL for the message store. Enables `/api/message`. |
| `DASHBOARD_TOKEN` | no | — | Shared bearer token for the message API. Secret. |

¹ At least one source must be configured: `ICAL_URL`, `HOSTEX_ACCESS_TOKEN`, or **both** `GUESTY_CLIENT_ID` and `GUESTY_CLIENT_SECRET`. Any combination is allowed — each adds its own panel.

## Architecture

One Node process serves the Vite-built React SPA AND proxies the calendar sources at `/api/calendar` with a 60-second in-memory cache and stale-on-failure fallback. The proxy keeps the secret credentials server-side and returns `{ sources: [...] }` — one entry per configured source, each tagged with its `source`. Each source is fetched independently, so one failing source still leaves the other's panel working; a source that fails is tagged `error` and its panel shows a retry notice. The configured sources:

- **ICS** (`ICAL_URL`) — the entry carries the raw ICS; the React app parses it with `ical.js` (recurrence-aware, drops `STATUS:CANCELLED`) and renders a list of the next `NEXT_N` events.
- **Hostex** (`HOSTEX_ACCESS_TOKEN`) — the proxy calls the Hostex OpenAPI (`GET /v3/properties`, `GET /v3/reservations`, and `POST /v3/listings/calendar`) and the app renders a scrollable reservation timeline: one row per home, with reservation bars labelled by guest, channel, and nights, and owner-blocked dates (inventory 0, no reservation) hatched.
- **Guesty** (`GUESTY_CLIENT_ID` + `GUESTY_CLIENT_SECRET`) — the proxy does an OAuth2 `client_credentials` exchange against `POST /oauth2/token` and caches the bearer to `.guesty-token.json` (mode 0600) across server restarts, because Guesty hard-caps issuance at 5 tokens / 24 h per `client_id`. It then calls `GET /v1/listings`, `GET /v1/reservations` (filtered to `status $in [confirmed, reserved]`), and `GET /v1/availability-pricing/api/calendar/listings/minified/{id}` per home for the next 180 days. The app renders the same 14-day timeline as Hostex, with `confirmed` bookings drawn as solid bars and `reserved` (channel-pending) holds drawn with diagonal stripes plus a `(pending)` tooltip. `GUESTY_API_BASE` swaps the upstream — point at [`guesty-dtu`](guesty-dtu/README.md) during dev so the daily token budget isn't burned.

The page calls `location.reload()` every `REFRESH_MS` (5 min default) — that, not in-app polling, is the freshness + state-recovery mechanism. Server binds loopback only; a Host-header allowlist on `/api/*` defends against DNS rebinding.

## Views & layout

Each configured calendar source above is a *view*. The dashboard also ships a data-free **Clock** view, and the registry in `src/views/registry.tsx` is built so more can be added later by writing a component and appending a `ViewDef` — the layout, tabs, settings toggle, and rotation pick it up automatically.

On load the dashboard measures the screen and tiles as many views as fit comfortably (`src/layout.ts`); any that overflow move to **tabs** along the bottom. The ⚙ button opens a settings overlay:

- **Views** — turn individual views on or off.
- **Panels per page** — `Auto` fits as many as the screen allows, or pin it to 1/2/3.
- **Auto-rotate** — cycle the tab pages on a timer. Off by default; 10 s when enabled, adjustable.

Settings persist to `localStorage` *per device*, so a portrait Pi and a wide monitor each keep their own layout — there are no env vars or rebuilds for layout. The ⟳ button still cycles kiosk rotation, also per device.

## Messages (optional)

Plow posts typed messages (`affirmation`, `alert`, `reminder`, ...) to a tiny Vercel function under `api/` backed by Vercel KV. Storage is a Redis list — each POST `LPUSH`es a record and `LTRIM`s to the most recent 50. The Pi polls the function through its existing proxy pattern (so the bearer token never reaches the browser) and requests `?type=affirmation` for the top slot, which renders the latest unexpired affirmation above the calendar. `expires_at` is respected client-side and hides stale messages without a write.

To enable:

1. **Deploy the Vercel project.** From the repo root: `vercel link` then `vercel deploy --prod`. `vercel.json` already disables the Vite build — only the `api/` functions ship.
2. **Generate a token:** `openssl rand -hex 32`. Set it on Vercel as `DASHBOARD_TOKEN`.
3. **Add a Vercel KV (Upstash) integration** to the project — `KV_REST_API_URL` and `KV_REST_API_TOKEN` are populated automatically.
4. **On the Pi**, set `MESSAGE_API_URL=https://<project>.vercel.app/api/message` and `DASHBOARD_TOKEN=<same-token>` in `.env`, then restart `plow-airbnb-dashboard.service`.

If either env var is missing, the message route is not registered and the dashboard renders the calendar only — the feature is opt-in.

Plow posts messages via the `plow-airbnb-dashboard-poster` team-skill (separate PR in `~/Hacking/Plow`).
