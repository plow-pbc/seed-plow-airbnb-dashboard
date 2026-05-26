# Guesty Integration

**Status:** draft for review
**Date:** 2026-05-26

## Context

The dashboard already ingests calendar data from two sources: a plain ICS feed and Hostex (via its OpenAPI). The head chef wants Guesty added as a third source, sitting alongside Hostex.

The existing Hostex architecture is the template:

- **Server**: a per-provider fetcher (`src/server/hostex.js`) returns `{ homes: [{ id, name, cover, reservations, blocked }] }`. `server.js` wires the fetcher into a 60-second cached `/api/calendar` route only if the relevant env var is set; the page polls every 5 minutes.
- **Client**: `src/types.ts` defines `HostexHome`; `src/views/registry.tsx` switches on the `source` discriminator; `src/components/HostexTimeline.tsx` paints the 14-day grid; `src/App.tsx` decodes the wire envelope.
- **Provisioning**: `.env.example`, `README.md`, and `SEED.md` all reference the credential.

Guesty differs from Hostex in three ways that shape the design:

1. **OAuth2 with a hard 5-tokens-per-day cap.** Tokens last 24 h, but exceeding 5 issuances per `client_id` within 24 h locks the account out for the rest of the day. Tokens MUST be persisted across server restarts.
2. **Per-listing calendar endpoint.** Guesty has no bulk-calendar read — fetching N homes × 180 days means N HTTP calls (well under the 15 req/s rate limit).
3. **Typed block codes.** Guesty's calendar reports *why* a date is blocked (`r` reservation, `m` manual, `o` owner, `bd` blocked-by-default, `ic` iCal-import, etc.) — strictly more information than Hostex's `inventory == 0` heuristic.

The head chef has made the following decisions (recorded for traceability):

- **Separate `GuestyTimeline`** component, not a shared one with Hostex. Guesty's data is richer and may diverge from Hostex's UI over time.
- **Token cache file** at `.guesty-token.json` in the deploy directory (mode 0600). Add to `.gitignore`.
- **Single Guesty account.** No multi-tenant support.
- **Two env vars**: `GUESTY_CLIENT_ID` + `GUESTY_CLIENT_SECRET`. Mirrors how SEED collects credentials individually.
- **Filter both `confirmed` and `reserved`** reservation statuses. `reserved` is rendered with a visual distinction (hatched/striped bar, tooltip says "Reserved (pending)") so users can tell channel-pending holds apart from confirmed bookings.
- **`GUESTY_API_BASE` env var override** for the upstream base URL. Defaults to `https://open-api.guesty.com`; local dev/CI points at the `guesty-dtu` mock service (separate workstream — see `guesty-dtu/README.md`) to avoid burning real OAuth tokens during development.

## Non-goals

- Multi-account Guesty support.
- Replacing or unifying Hostex with Guesty.
- Sandbox / staging integration — Guesty's Open API has no sandbox; the integration is developed against prod with read-only credentials.
- Two-way sync (writing back to Guesty). Read-only.

## Design

### §1 Server-side Guesty fetcher

Add `src/server/guesty.js` exporting:

```
fetchGuestyCalendar({ clientId, clientSecret, baseUrl }, now) → Promise<{ homes: GuestyHome[] }>
```

`baseUrl` defaults to `https://open-api.guesty.com`; the server-wiring layer (§2) reads `GUESTY_API_BASE` to allow pointing at the guesty-dtu mock during local dev/test.

The envelope shape matches Hostex's `fetchHostexCalendar` result (so the caching/serialization layer doesn't change), but `reservations` carry an additional `status: 'confirmed' | 'reserved'` field so the client can render the two differently.

**Auth.** OAuth2 `client_credentials` against `POST https://open-api.guesty.com/oauth2/token` with form body `grant_type=client_credentials&scope=open-api&client_id=...&client_secret=...`. Bearer is sent as `Authorization: Bearer <token>` on subsequent calls. Treat 401 as a signal to refresh once and retry; treat 403 as a permanent scope error.

**Token cache.** Persist `{ access_token, expires_at }` to `.guesty-token.json` (mode 0600) in the process's working directory. On every request the fetcher checks the in-memory copy first, then the file; only re-issues a token when the cached one expires within 5 minutes. This is required by the 5-tokens-per-24h cap. The cache file must NOT enter git (see §7).

**Concurrency:** when no valid token is cached and multiple requests arrive simultaneously, only one `POST /oauth2/token` may fire — hold an in-flight promise and have subsequent callers await it. Burning extra issuances on dev startup easily exhausts the daily budget.

**Cache failure modes:** if `.guesty-token.json` is missing, unreadable, malformed JSON, or has `expires_at` ≤ now, treat the cache as absent and issue a fresh token (no hard error).

**Listings.** `GET /v1/listings` with offset pagination (`limit=50`, `skip=N`). Map each result to `{ id: _id, name: title || nickname, cover: pictures[0]?.thumbnail ?? pictures[0]?.regular ?? pictures[0]?.original ?? null }` (fallback chain — Guesty pictures don't always have a `thumbnail`).

**Reservations.** `GET /v1/reservations` with filter JSON encoding `status $in [confirmed, reserved]` AND `checkOutDateLocalized $gte today`, where `today` is the server-local `YYYY-MM-DD` (matching `ymd(now)` in `src/server/hostex.js`). Listings in different timezones may briefly include/exclude the edge day — acceptable. Paginate with `limit=100` (Guesty's cap). Map each to a `GuestyReservation` matching the existing `Reservation` shape plus `status`, with `channel` derived from `integration.platform` and mapped to the labels in `src/hostex.ts` `CHANNEL_LABELS`: `airbnb2` → `airbnb`, `vrbo` → `vrbo`, `bookingCom` → `booking.com` (NOT `booking_site` — that's the "Direct" channel), `homeaway2` → `homeaway`, `manual` → `manual`; pass through unknowns.

**Per-listing calendar.** For each listing, `GET /v1/availability-pricing/api/calendar/listings/minified/{id}?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` for a 180-day window starting at `now`. **Implementer:** confirm the exact URL shape against current Guesty docs (or the guesty-dtu mock, which mirrors it) before stubbing tests — the path here was sourced from research, and a 404 in prod would pass URL-fragment-matched stubs while silently failing. Build `blocked` as the list of `YYYY-MM-DD` dates whose `blocks` codes contain any of `m`, `o`, `bd`, `ic` AND for which no reservation covers that night. (Days blocked purely by `r` are already represented by a reservation and should not appear in `blocked` — same semantic as Hostex.)

**Rate limits.** Single-request retry on 429, honoring the `Retry-After` header (clamped to a sane max, e.g. 10s). Calendar fetches run in parallel across listings.

**Errors.** If listings or reservations fail entirely, the fetcher throws (so `server.js` tags the source as errored). If calendar fetches fail for a subset of listings, treat them like Hostex treats failed inventory: return that home with `blocked: []`.

### §2 Server wiring

In `server.js`:

- Read `GUESTY_CLIENT_ID`, `GUESTY_CLIENT_SECRET`, and (optional) `GUESTY_API_BASE` near the existing `HOSTEX_ACCESS_TOKEN` read.
- If `GUESTY_CLIENT_ID` and `GUESTY_CLIENT_SECRET` are both set, push `{ kind: 'guesty', fetch: () => fetchGuestyCalendar({ clientId, clientSecret, baseUrl: process.env.GUESTY_API_BASE || 'https://open-api.guesty.com' }, new Date()).then(d => ({ source: 'guesty', ...d })) }` into the sources array, after the Hostex block.
- Update the fatal-exit message at line 34 to list Guesty in the "at least one of" hint.

No changes to `src/server/app.js` — the route/caching layer is provider-agnostic.

### §3 Client types

In `src/types.ts`:

- Add `export interface GuestyReservation extends Reservation { status: 'confirmed' | 'reserved' }`.
- Add `export interface GuestyHome { id: string; name: string; cover: string | null; reservations: GuestyReservation[]; blocked: string[] }` (mirrors Hostex's `cover: string | null` — see `src/types.ts`).

Do NOT modify or rename `HostexHome` / `Reservation` (head chef's decision).

### §4 Client envelope decoding

In `src/App.tsx`:

- Extend BOTH arms of the `RawSource` discriminated union: add a `{ source: 'guesty', homes: GuestyHome[] }` success variant, AND extend the existing error arm's `source` literal to include `'guesty'`.
- Add a decode branch returning `{ source: 'guesty', homes }`.

### §5 View registry

In `src/views/registry.tsx`:

- Extend `CalendarSource`: add a `{ source: 'guesty', homes: GuestyHome[] }` success variant AND extend the existing error arm's `source` literal to include `'guesty'` (same pattern as §4).
- Extend `CALENDAR_META` with `guesty: { id: 'guesty-reservations', title: 'Guesty Reservations', minSize: { width: 640, height: 360 } }` (mirror Hostex's `minSize`).
- Add a branch in `buildViews` that renders `<GuestyReservationsView homes={src.homes} />`.

### §6 Guesty timeline UI

Add `src/views/GuestyReservationsView.tsx`: a thin wrapper that takes `homes: GuestyHome[]` and renders `<GuestyTimeline homes={homes} />`. Mirror `ReservationsView`'s structure.

Add `src/components/GuestyTimeline.tsx`. Visual structure mirrors `HostexTimeline`:

- Top row: vacant-count summary across all homes for the next N days.
- One row per home: 14-day grid starting at today (default window `[today, today+13]` mirroring `HostexTimeline`), arrows to scroll ±7 days; weekend + today highlighting; reservation bars positioned via the same kind of placement logic as `placeReservation`.

Status-specific rendering:

- `confirmed`: solid channel-colored bar, identical to Hostex's treatment.
- `reserved`: **striped/hatched** version of the same channel color; on hover/tooltip, append "(pending)" to the label. Use a CSS pattern (e.g. `repeating-linear-gradient`) for the stripes. Mark the DOM with `data-status="reserved"` so tests can assert.

Helpers (`dayList`, `ymd`, `placeReservation`, `reservationPhase`, `coversNight`, `channelLabel`) can be reused from `src/hostex.ts` by importing; do NOT duplicate. If a helper needs a tweak for Guesty's status field, prefer extending it (or accepting an optional arg) over forking — but ONLY if the change is small and doesn't ripple into Hostex's tests. If the diff would be invasive, a small Guesty-local helper module (`src/guesty.ts`) is acceptable.

### §7 Provisioning & docs

- `.env.example`: add `GUESTY_CLIENT_ID=` and `GUESTY_CLIENT_SECRET=` with secret-treatment comments. Update the leading "one of" note (lines 1-3) to include Guesty.
- `.gitignore`: add `.guesty-token.json`.
- `README.md`: add a row to the config table (around line 67) and update the Architecture section (around line 78-83) to mention the Guesty source.
- `SEED.md`: extend every Hostex spot to collect Guesty creds. The known spots from research are lines 18, 32-35, 49 (Step-1 table), 220-235 (Step-4 `.env` writer), 380, 399-402, 428, and the verify grep at 474. Treat `GUESTY_CLIENT_ID` and `GUESTY_CLIENT_SECRET` as two independent secrets in the Step-1 collection table (matches the SEED's per-secret prompt pattern).

### §8 Tests

- `src/server/guesty.test.js`: mirror `src/server/hostex.test.js` style — stub `fetch` per URL fragment. Cover:
  - Token issued, cached in memory, reused.
  - Token persisted to `.guesty-token.json` (mode 0600).
  - Token loaded from file on a fresh fetcher instance (simulates server restart).
  - Token refresh triggered within 5 min of expiry.
  - `confirmed`+`reserved` status filter sent in the request.
  - `blocked` correctly excludes dates covered by a reservation.
  - `blocked` correctly includes manual/owner/bd/ic codes.
  - 429 with `Retry-After` is honored once.
  - 401 triggers exactly one token refresh + retry; second 401 throws.
  - 403 throws immediately without retry (permanent scope error).
  - Concurrent calls: when no valid token is cached, two parallel `fetchGuestyCalendar` invocations issue exactly one `POST /oauth2/token` (in-flight promise dedup).
  - Channel mapping: `airbnb2 → 'airbnb'`, `vrbo → 'vrbo'`, `bookingCom → 'booking.com'`, `homeaway2 → 'homeaway'`, `manual → 'manual'`, and pass-through for unknown platforms.
  - Pagination boundary: a `/v1/reservations` page returning exactly `limit=100` items triggers a `skip=100` follow-up; the loop stops on a partial page.
  - Cover normalization: a listing with empty `pictures` produces `cover: null`; fallback chain `thumbnail ?? regular ?? original ?? null` is exercised.
- `src/views/registry.test.ts`: add `guesty` source cases paralleling the existing `hostex` ones.
- `src/components/GuestyTimeline.test.tsx`: render fixtures with one `confirmed` and one `reserved` reservation; assert the `reserved` bar has `data-status="reserved"` and the `confirmed` bar does not.
- A manual smoke section in `README.md` (extend the existing README structure rather than adding a new top-level doc) walking through: set env vars (pointed at `guesty-dtu` for risk-free testing) → boot server → confirm "Guesty Reservations" panel appears → confirm `reserved` and `confirmed` reservations render with distinct visual treatment.

## Chunks

### Chunk 1: Guesty server fetcher with token caching

Implements: §1 of this spec

Done when: `src/server/guesty.test.js` exists with stub-`fetch` unit tests covering all bullets in §8 for the server fetcher (token cache memory + disk + refresh, status filter, blocked-vs-reserved discrimination, 429 Retry-After honoring, 401 single-retry semantics). Tests pass with `npm test` (or the project's equivalent). No real network calls.

### Chunk 2: Server wiring, env example, gitignore

Implements: §2 and the `.env.example` + `.gitignore` portions of §7

Done when:
- With the `guesty-dtu` mock service running on `localhost:8787`, env vars set to `GUESTY_CLIENT_ID=dtu-test-id`, `GUESTY_CLIENT_SECRET=dtu-test-secret`, `GUESTY_API_BASE=http://localhost:8787`, `curl localhost:<port>/api/calendar` returns a JSON envelope containing a `{ source: 'guesty', ... }` entry with non-empty `homes`.
- With either of the credential vars unset, no `guesty` entry appears in the response.
- `grep '^GUESTY_' .env.example` shows `GUESTY_CLIENT_ID`, `GUESTY_CLIENT_SECRET`, and `GUESTY_API_BASE` (the last with a comment explaining the default + DTU override use case).
- `grep '.guesty-token.json' .gitignore` matches.

### Chunk 3: Client types, decoding, and view registry

Implements: §3, §4, §5

Done when:
- `tsc --noEmit` (or the project's typecheck) passes.
- `src/views/registry.test.ts` includes a `guesty` source case (success + error) paralleling Hostex; tests pass.
- With a hand-crafted `/api/calendar` response that includes a `guesty` source (e.g. via mock or a one-off dev server tweak), the dashboard loads without runtime errors and shows a "Guesty Reservations" panel (visually empty/placeholder is fine; the actual rendering is Chunk 4's responsibility).

### Chunk 4: GuestyTimeline component and view

Implements: §6 and the `GuestyTimeline.test.tsx` portion of §8

Done when:
- `src/components/GuestyTimeline.test.tsx` renders a fixture with one `confirmed` and one `reserved` reservation; asserts `data-status="reserved"` is present on the reserved bar and absent on the confirmed bar; asserts the rendered tooltip/aria-label for the reserved bar includes the word "pending".
- A manual repro in `TESTING.md` walks the head chef through visually verifying both bar styles render distinctly in a real browser.
- Existing Hostex tests still pass (no regression from any shared-helper edits).

### Chunk 5: Docs and SEED

Implements: the `README.md` and `SEED.md` portions of §7

Done when:
- `grep -ci guesty README.md` returns non-zero matches in both the config table and the architecture section (reviewer eyeballs placement).
- For every line in `SEED.md` that references `HOSTEX_ACCESS_TOKEN`, a corresponding Guesty-creds reference exists. The implementer reports back with a list of `(SEED.md old line → SEED.md new line/block)` pairs showing what was added/extended at each location; the reviewer spot-checks by diffing the listed pairs.
- A read-through of `SEED.md` Step-1 prompts (no actual deploy) shows `GUESTY_CLIENT_ID` and `GUESTY_CLIENT_SECRET` are collected as two distinct secrets in the per-secret prompt table.
