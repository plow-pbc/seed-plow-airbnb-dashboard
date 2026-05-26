# guesty-dtu

**Guesty Digital Twin Unit** — an in-memory Node service that mimics the four Guesty Open API
endpoints the integration uses, so we can develop and run tests without burning OAuth tokens
(Guesty caps real client_ids at 5 tokens / 24h) or hitting production data.

This is a sibling to the main app, not a submodule. It has its own dependency tree.

## Install / run

```bash
cd guesty-dtu
npm install
npm test          # full HTTP-level suite via supertest
npm start         # starts on http://localhost:8787
```

## Environment variables

| Var                  | Default            | Purpose                                                |
| -------------------- | ------------------ | ------------------------------------------------------ |
| `DTU_PORT`           | `8787`             | Port the HTTP server binds to.                         |
| `DTU_CLIENT_ID`      | `dtu-test-id`      | The only `client_id` value the OAuth endpoint accepts. |
| `DTU_CLIENT_SECRET`  | `dtu-test-secret`  | The matching `client_secret`.                          |

Paste the configured `DTU_CLIENT_ID` / `DTU_CLIENT_SECRET` values into the integration's
`GUESTY_CLIENT_ID` / `GUESTY_CLIENT_SECRET` env vars, and point the integration's base-URL
override at `http://localhost:8787`.

The DTU does **not** enforce Guesty's 5-tokens-per-24h cap — that's the friction we're escaping.

## Endpoints

All endpoints below mirror Guesty's request/response shapes. The three GETs require a Bearer
token issued by `POST /oauth2/token`; missing/invalid tokens return a Guesty-shaped 401.

### 1. `POST /oauth2/token`

```bash
curl -sX POST http://localhost:8787/oauth2/token \
  -d 'grant_type=client_credentials' \
  -d 'scope=open-api' \
  -d 'client_id=dtu-test-id' \
  -d 'client_secret=dtu-test-secret'
```

Returns:
```json
{
  "access_token": "<64-hex-chars>",
  "token_type": "Bearer",
  "expires_in": 86400,
  "scope": "open-api"
}
```

Invalid creds return `401 { "error": "invalid_client", "error_description": "..." }`.

### 2. `GET /v1/listings?limit=&skip=`

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  'http://localhost:8787/v1/listings?limit=25&skip=0'
```

Returns `{ results, count, limit, skip }` — each result has `_id`, `title`, `nickname`,
`pictures[0].thumbnail`.

### 3. `GET /v1/reservations?limit=&skip=&filters=<json>`

`filters` is a URL-encoded JSON array of filter objects. Most operators use
`{ field, operator, value }`; `$between` uses `{ field, operator, from, to }` (matching
real Guesty's docs).

Supported operators: `$in`, `$eq`, `$ne`, `$not`, `$gt`, `$lt`, `$between`, `$contains`,
`$notcontains`. Unsupported operators and malformed `filters` JSON both return `400`.

```bash
FILTERS='[
  {"field":"status","operator":"$in","value":["confirmed","reserved"]},
  {"field":"checkInDateLocalized","operator":"$between","from":"2026-01-01","to":"2026-12-31"}
]'
curl -sG -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "filters=$FILTERS" \
  'http://localhost:8787/v1/reservations'
```

Each result has `_id`, `listingId`, `guest.fullName`, `integration.platform`, `checkIn`,
`checkOut`, `checkInDateLocalized`, `checkOutDateLocalized`, `nightsCount`, `status`.

### 4. `GET /v1/availability-pricing/api/calendar/listings/minified/{listingId}?startDate=&endDate=`

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  'http://localhost:8787/v1/availability-pricing/api/calendar/listings/minified/67000000000000000000000a?startDate=2026-05-01&endDate=2026-05-07'
```

Returns `{ "data": { "days": [ { date, status, blocks }, ... ] } }` (matching real
Guesty's docs: "Returns only the data object containing the days information").
`blocks` is a map of block-code → boolean covering `r` (reservation), `b` (booking),
`m` (manual), `o` (owner), `bd` (blocked dates), `ic` (imported calendar). `status` is
`booked` if any code is true, else `available`.

## Fixture data

In-memory, deterministic, regenerated on each process start:

- **3 listings** with stable `_id`s (`67000000000000000000000a/b/c`).
- **10 reservations** spread across the listings, with a mix of `confirmed` / `reserved`
  statuses and `airbnb2` / `vrbo` / `bookingCom` / `manual` platforms. Check-in dates are
  computed as offsets from "today" (the moment the process boots) so the data always
  straddles today, last month, and next month.
- A **calendar generator** that marks reservation nights as `r`, then sprinkles
  occasional `m` / `o` / `bd` blocks deterministically from `hash(listingId|date)`.

Fixtures live under `fixtures/`. Restart the server to refresh the relative dates.

## Out of scope (by design)

- Rate-limit simulation (zero friction is the point).
- Persistence across restarts.
- Writes / two-way sync.
- Any Guesty endpoint not listed above.
