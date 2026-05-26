// Guesty Open API reservation source. Mirrors src/server/hostex.js — returns
// the same { homes: [...] } envelope so the cached /api/calendar proxy and
// failure-tagging in server.js don't have to special-case the provider. The
// payload is richer in two ways: reservation rows carry `status` ('confirmed'
// or 'reserved') so the client can paint channel-pending holds distinctly,
// and `blocked` is built from Guesty's typed block codes (m/o/bd/ic) rather
// than Hostex's inventory==0 heuristic.
//
// Guesty enforces a hard cap of 5 OAuth tokens per client_id per 24h, so
// the bearer is persisted to .guesty-token.json (mode 0600) and re-used
// across server restarts. Concurrent callers share a single in-flight
// issuance via the inFlight Map — a cold start under load must not burn
// the daily budget.
//
// Docs: https://open-api-docs.guesty.com/docs/authentication
//       https://open-api-docs.guesty.com/reference/get_listings
//       https://open-api-docs.guesty.com/reference/get_reservations
//       https://open-api-docs.guesty.com/reference/get_availability-pricing-api-calendar-listings-minified-listingid

import { promises as fs } from 'node:fs';
import path from 'node:path';

const DEFAULT_BASE_URL = 'https://open-api.guesty.com';
const DEFAULT_TOKEN_CACHE_PATH = path.resolve(process.cwd(), '.guesty-token.json');
const TIMEOUT_MS = 15_000;
const LISTINGS_PAGE = 50;
const RESERVATIONS_PAGE = 100;
const INVENTORY_DAYS = 180;
const REFRESH_LEAD_MS = 5 * 60 * 1000;
const RETRY_AFTER_MAX_MS = 10_000;

// Maps an upstream `integration.platform` to the channel string the client's
// CHANNEL_LABELS table (src/hostex.ts) already knows how to render.
const PLATFORM_TO_CHANNEL = {
  airbnb2: 'airbnb',
  vrbo: 'vrbo',
  bookingCom: 'booking.com',
  homeaway2: 'homeaway',
  manual: 'manual',
};

const HOST_BLOCK_CODES = ['m', 'o', 'bd', 'ic'];

// Module-level shared state, keyed by token-cache file path. Two callers
// with the same path share a single token (and dedup concurrent issuances);
// independent credentials with separate paths are isolated.
const tokenState = new Map(); // path -> { access_token, expires_at }
const inFlight = new Map(); // path -> Promise<{ access_token, expires_at }>

// Test hook — wipe shared state to simulate a process restart.
export function _resetGuestyState() {
  tokenState.clear();
  inFlight.clear();
}

export async function fetchGuestyCalendar(
  {
    clientId,
    clientSecret,
    baseUrl = DEFAULT_BASE_URL,
    tokenCachePath = DEFAULT_TOKEN_CACHE_PATH,
  },
  now = new Date(),
) {
  const ctx = { clientId, clientSecret, baseUrl, tokenCachePath };

  const [listings, reservations] = await Promise.all([
    fetchListings(ctx),
    fetchReservations(ctx, now),
  ]);

  const byListing = new Map();
  for (const r of reservations) {
    const platform = r.integration?.platform ?? '';
    const channel = PLATFORM_TO_CHANNEL[platform] ?? platform;
    const list = byListing.get(r.listingId) ?? [];
    list.push({
      guest: r.guest?.fullName || 'Reserved',
      channel,
      check_in: r.checkInDateLocalized,
      check_out: r.checkOutDateLocalized,
      nights: r.nightsCount,
      status: r.status,
    });
    byListing.set(r.listingId, list);
  }

  const { start, end } = inventoryRange(now);

  const homes = await Promise.all(
    listings.map(async (l) => {
      const resv = (byListing.get(l._id) ?? []).sort((a, b) =>
        a.check_in < b.check_in ? -1 : a.check_in > b.check_in ? 1 : 0,
      );
      const calendar = await queryCalendar(ctx, l._id, start, end);
      return {
        id: l._id,
        name: l.title || l.nickname || '',
        cover: pickCover(l),
        reservations: resv,
        blocked: blockedDates(calendar, resv),
      };
    }),
  );

  return { homes };
}

// pictures[0]?.thumbnail ?? pictures[0]?.regular ?? pictures[0]?.original ?? null —
// Guesty pictures aren't guaranteed to carry every variant.
function pickCover(listing) {
  const pic = listing.pictures?.[0];
  if (!pic) return null;
  return pic.thumbnail ?? pic.regular ?? pic.original ?? null;
}

function inventoryRange(now) {
  const end = new Date(now);
  end.setDate(now.getDate() + INVENTORY_DAYS);
  return { start: ymd(now), end: ymd(end) };
}

function ymd(d) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function eachNight(checkIn, checkOut) {
  const nights = [];
  const d = new Date(`${checkIn}T00:00:00Z`);
  const end = new Date(`${checkOut}T00:00:00Z`);
  while (d < end) {
    nights.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return nights;
}

// Dates the listing is host-blocked (manual/owner/blocked-by-default/iCal
// import) AND not covered by an accepted reservation. `r` codes are already
// represented by the reservation list, so we skip them — mirrors Hostex.
function blockedDates(calendar, reservations) {
  if (!calendar) return [];
  const reserved = new Set();
  for (const r of reservations) {
    for (const night of eachNight(r.check_in, r.check_out)) reserved.add(night);
  }
  const blocked = [];
  for (const day of calendar) {
    const hostBlocked = HOST_BLOCK_CODES.some((c) => day.blocks?.[c]);
    if (hostBlocked && !reserved.has(day.date)) blocked.push(day.date);
  }
  return blocked.sort();
}

async function queryCalendar(ctx, listingId, start, end) {
  try {
    const url =
      `/v1/availability-pricing/api/calendar/listings/minified/${encodeURIComponent(listingId)}` +
      `?startDate=${start}&endDate=${end}`;
    const response = await guestyRequest(ctx, url);
    // Real Guesty wraps the day list in { data: { days: [...] } } — listings
    // and reservations use a different { results, … } envelope, so this
    // unwrapping is calendar-specific.
    const days = response?.data?.days;
    if (!Array.isArray(days)) {
      throw new Error(`Guesty calendar response missing data.days array for listing ${listingId}`);
    }
    return days;
  } catch (err) {
    console.warn(`Guesty: calendar for listing ${listingId} failed — ${err.message}`);
    return null;
  }
}

async function fetchListings(ctx) {
  const out = [];
  let skip = 0;
  for (;;) {
    const data = await guestyRequest(ctx, `/v1/listings?limit=${LISTINGS_PAGE}&skip=${skip}`);
    const batch = data?.results ?? [];
    out.push(...batch);
    skip += batch.length;
    if (batch.length < LISTINGS_PAGE) break;
  }
  return out;
}

async function fetchReservations(ctx, now) {
  // Guesty's documented operator set is {$in, $nin, $between, $gt, $lt, $eq, $ne}
  // — no $gte/$lte. For the "upcoming reservations" cut we want, the closest
  // shape is $between with a far-future upper bound. Two years out comfortably
  // covers any dashboard horizon while staying inside what Guesty will accept.
  const today = ymd(now);
  const farFutureDate = new Date(now);
  farFutureDate.setDate(now.getDate() + 730);
  const farFuture = ymd(farFutureDate);
  const filters = JSON.stringify([
    { field: 'status', operator: '$in', value: ['confirmed', 'reserved'] },
    {
      field: 'checkOutDateLocalized',
      operator: '$between',
      from: today,
      to: farFuture,
    },
  ]);
  const out = [];
  let skip = 0;
  for (;;) {
    const qs =
      `limit=${RESERVATIONS_PAGE}&skip=${skip}` +
      `&filters=${encodeURIComponent(filters)}`;
    const data = await guestyRequest(ctx, `/v1/reservations?${qs}`);
    const batch = data?.results ?? [];
    out.push(...batch);
    skip += batch.length;
    if (batch.length < RESERVATIONS_PAGE) break;
  }
  return out;
}

// One bearer-authenticated Guesty REST call.
//   429 → single retry honoring Retry-After (clamped).
//   403 + { message: "...permission..." } → token refresh + single retry. Per
//     Guesty's docs, an expired token surfaces as 403 carrying a permission
//     message in the body; raw scope-revoked / no-access cases throw on the
//     second attempt.
//   403 without a permission-shaped message → permanent scope failure; throw.
//   401 → throws via the generic non-ok branch. 401 from Guesty means the
//     Authorization header was missing or structurally malformed — refreshing
//     the token won't change either, so we don't retry.
async function guestyRequest(
  ctx,
  pathAndQuery,
  init = {},
  { retriedAuth = false, retriedRate = false } = {},
) {
  const token = await getToken(ctx, { force: retriedAuth });
  const res = await fetch(`${ctx.baseUrl}${pathAndQuery}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (res.status === 429 && !retriedRate) {
    const ra = parseInt(res.headers.get('retry-after') ?? '', 10);
    const waitMs = Math.min(Number.isFinite(ra) ? ra * 1000 : 1000, RETRY_AFTER_MAX_MS);
    await sleep(waitMs);
    return guestyRequest(ctx, pathAndQuery, init, { retriedAuth, retriedRate: true });
  }
  if (res.status === 403) {
    const bodyText = await res.text().catch(() => '');
    if (!retriedAuth) {
      let parsed = null;
      try {
        parsed = JSON.parse(bodyText);
      } catch {
        // Non-JSON body — treat as a permanent scope error below.
      }
      if (typeof parsed?.message === 'string' && /permission/i.test(parsed.message)) {
        return guestyRequest(ctx, pathAndQuery, init, { retriedAuth: true, retriedRate });
      }
    }
    throw new Error(
      `Guesty API HTTP 403 (forbidden / scope) for ${pathAndQuery}${bodyText ? ` — ${bodyText.slice(0, 200)}` : ''}`,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Guesty API HTTP ${res.status} for ${pathAndQuery}${body ? ` — ${body.slice(0, 200)}` : ''}`,
    );
  }
  return await res.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Token resolution: in-memory cache → file cache → mint new. `force: true`
// bypasses both caches (used after a 401, where the cached token is known bad).
async function getToken(ctx, { force = false } = {}) {
  if (!force) {
    const nowMs = Date.now();
    const inMem = tokenState.get(ctx.tokenCachePath);
    if (inMem && inMem.expires_at - nowMs > REFRESH_LEAD_MS) return inMem.access_token;

    const onDisk = await readTokenFile(ctx.tokenCachePath);
    if (onDisk && onDisk.expires_at - nowMs > REFRESH_LEAD_MS) {
      tokenState.set(ctx.tokenCachePath, onDisk);
      return onDisk.access_token;
    }
  }

  // Dedup concurrent issuances per cache path — exceeding 5 mints/24h locks
  // the account out for the rest of the day.
  let p = inFlight.get(ctx.tokenCachePath);
  if (!p) {
    p = issueToken(ctx).finally(() => inFlight.delete(ctx.tokenCachePath));
    inFlight.set(ctx.tokenCachePath, p);
  }
  const fresh = await p;
  return fresh.access_token;
}

async function readTokenFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed?.access_token !== 'string' || typeof parsed?.expires_at !== 'number') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function issueToken(ctx) {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'open-api',
    client_id: ctx.clientId,
    client_secret: ctx.clientSecret,
  });
  const res = await fetch(`${ctx.baseUrl}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Guesty OAuth HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ''}`);
  }
  const json = await res.json();
  const access_token = json.access_token;
  const expires_in = Number(json.expires_in);
  if (!access_token || !Number.isFinite(expires_in)) {
    throw new Error('Guesty OAuth response missing access_token or expires_in');
  }
  const record = { access_token, expires_at: Date.now() + expires_in * 1000 };
  tokenState.set(ctx.tokenCachePath, record);
  await writeTokenFile(ctx.tokenCachePath, record);
  return record;
}

async function writeTokenFile(filePath, record) {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(record), { mode: 0o600 });
    // writeFile's `mode` only applies on create — chmod covers the
    // already-existed case so a token rotation can't widen perms.
    await fs.chmod(filePath, 0o600);
  } catch (err) {
    console.warn(`Guesty: failed to persist token cache — ${err.message}`);
  }
}
