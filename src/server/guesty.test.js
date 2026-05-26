import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fetchGuestyCalendar, _resetGuestyState } from './guesty.js';

// HTTP-shaped helpers — fetch stubs return real Response objects so the
// production code's .ok / .status / .headers.get / .json / .text usage all
// works without per-test plumbing.
function okJson(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
function status(code, body = '', headers = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: code,
    headers,
  });
}

// Per-test fetch router. Each `route` is { method, path, handle(url, init, calls) }
// — `path` is a substring match (matches the Hostex test style). `handle`
// returns a Response or a Promise<Response>. Unmatched fetches throw, which
// the test sees as a clear failure rather than a silent zero-response.
function setupFetch(routes) {
  const calls = [];
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const u = String(url);
    const method = (init.method ?? 'GET').toUpperCase();
    calls.push({ url: u, method, body: init.body, headers: init.headers });
    for (const r of routes) {
      if (r.method === method && u.includes(r.path)) {
        return await r.handle(u, init, calls);
      }
    }
    throw new Error(`unexpected fetch: ${method} ${u}`);
  });
  return calls;
}

// Spec-compliant /oauth2/token success.
function tokenResponse({ token = 'tok-' + Math.random().toString(36).slice(2), expiresIn = 86400 } = {}) {
  return okJson({ access_token: token, token_type: 'Bearer', expires_in: expiresIn, scope: 'open-api' });
}

// Read URLSearchParams body without depending on Node's internal handling.
function readForm(init) {
  if (init.body instanceof URLSearchParams) return Object.fromEntries(init.body);
  return Object.fromEntries(new URLSearchParams(String(init.body)));
}

// One concise "happy path" route set the dedicated cases can opt into and override.
function happyRoutes({ tokenOpts, listings, reservations, calendar } = {}) {
  const defaultListings = [{ _id: 'L1', title: 'Listing One', pictures: [{ thumbnail: 't1.jpg' }] }];
  const defaultReservations = [];
  const defaultCalendar = () => [];
  return [
    { method: 'POST', path: '/oauth2/token', handle: () => tokenResponse(tokenOpts) },
    {
      method: 'GET',
      path: '/v1/listings',
      handle: () => okJson({ results: listings ?? defaultListings, count: (listings ?? defaultListings).length, limit: 50, skip: 0 }),
    },
    {
      method: 'GET',
      path: '/v1/reservations',
      handle: () => okJson({ results: reservations ?? defaultReservations, count: (reservations ?? defaultReservations).length, limit: 100, skip: 0 }),
    },
    {
      method: 'GET',
      path: '/v1/availability-pricing/api/calendar/listings/minified/',
      handle: (url) => {
        const match = /minified\/([^?]+)/.exec(url);
        const listingId = match ? decodeURIComponent(match[1]) : '';
        const fn = calendar ?? defaultCalendar;
        // Real Guesty wraps the day list in { data: { days: [...] } }.
        // Per-test calendar fns still return a bare array; the route wraps.
        return okJson({ data: { days: fn(listingId) } });
      },
    },
  ];
}

const CREDS = {
  clientId: 'cid',
  clientSecret: 'csec',
  baseUrl: 'https://api.test',
};

let tempDir;
let tokenPath;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(tmpdir(), 'guesty-test-'));
  tokenPath = path.join(tempDir, '.guesty-token.json');
  _resetGuestyState();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  _resetGuestyState();
  await fs.rm(tempDir, { recursive: true, force: true });
});

// -- happy-path assembly ----------------------------------------------------

describe('fetchGuestyCalendar — happy path', () => {
  it('assembles homes with mapped channels, nights, and reservation status', async () => {
    const listings = [
      { _id: 'L1', title: 'Mtn Home', pictures: [{ thumbnail: 'mtn.jpg' }] },
      { _id: 'L2', title: '10th Ave', pictures: [{ thumbnail: '10.jpg' }] },
    ];
    const reservations = [
      {
        _id: 'r1',
        listingId: 'L1',
        guest: { fullName: 'Emily' },
        integration: { platform: 'airbnb2' },
        checkInDateLocalized: '2026-06-01',
        checkOutDateLocalized: '2026-06-04',
        nightsCount: 3,
        status: 'confirmed',
      },
      {
        _id: 'r2',
        listingId: 'L2',
        guest: { fullName: 'Pat' },
        integration: { platform: 'bookingCom' },
        checkInDateLocalized: '2026-06-10',
        checkOutDateLocalized: '2026-06-12',
        nightsCount: 2,
        status: 'reserved',
      },
    ];
    setupFetch(happyRoutes({ listings, reservations }));

    const { homes } = await fetchGuestyCalendar({ ...CREDS, tokenCachePath: tokenPath });

    expect(homes.map((h) => h.name)).toEqual(['Mtn Home', '10th Ave']);
    expect(homes[0].reservations).toEqual([
      {
        guest: 'Emily',
        channel: 'airbnb',
        check_in: '2026-06-01',
        check_out: '2026-06-04',
        nights: 3,
        status: 'confirmed',
      },
    ]);
    expect(homes[1].reservations[0]).toMatchObject({
      channel: 'booking.com',
      status: 'reserved',
    });
  });
});

// -- token cache ------------------------------------------------------------

describe('fetchGuestyCalendar — token cache', () => {
  it('issues a token once and reuses it from in-memory cache across calls', async () => {
    const calls = setupFetch(happyRoutes());
    await fetchGuestyCalendar({ ...CREDS, tokenCachePath: tokenPath });
    await fetchGuestyCalendar({ ...CREDS, tokenCachePath: tokenPath });

    const tokenPosts = calls.filter((c) => c.method === 'POST' && c.url.includes('/oauth2/token'));
    expect(tokenPosts).toHaveLength(1);

    // Sanity: the OAuth body is the spec-mandated form encoding.
    const form = readForm({ body: tokenPosts[0].body });
    expect(form.grant_type).toBe('client_credentials');
    expect(form.scope).toBe('open-api');
    expect(form.client_id).toBe('cid');
    expect(form.client_secret).toBe('csec');
  });

  it('persists the token to .guesty-token.json with mode 0600', async () => {
    setupFetch(happyRoutes({ tokenOpts: { token: 'persist-me', expiresIn: 86400 } }));
    await fetchGuestyCalendar({ ...CREDS, tokenCachePath: tokenPath });

    const raw = await fs.readFile(tokenPath, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.access_token).toBe('persist-me');
    expect(typeof parsed.expires_at).toBe('number');
    expect(parsed.expires_at).toBeGreaterThan(Date.now());

    const st = await fs.stat(tokenPath);
    // Mask the file-type bits; only the permission bits should be 0o600.
    expect(st.mode & 0o777).toBe(0o600);
  });

  it('loads a still-valid token from disk on a fresh instance (server restart)', async () => {
    // Pre-seed disk as if a previous process had cached a token.
    await fs.writeFile(
      tokenPath,
      JSON.stringify({ access_token: 'from-disk', expires_at: Date.now() + 86_400_000 }),
      { mode: 0o600 },
    );
    _resetGuestyState();

    const calls = setupFetch(happyRoutes());
    await fetchGuestyCalendar({ ...CREDS, tokenCachePath: tokenPath });

    const tokenPosts = calls.filter((c) => c.method === 'POST' && c.url.includes('/oauth2/token'));
    expect(tokenPosts).toHaveLength(0);

    // And the bearer used downstream comes from the on-disk record.
    const listingsCall = calls.find((c) => c.url.includes('/v1/listings'));
    const auth =
      listingsCall.headers?.Authorization ?? listingsCall.headers?.authorization ?? '';
    expect(auth).toBe('Bearer from-disk');
  });

  it('refreshes the cached token when it expires within 5 minutes', async () => {
    // 4 minutes from expiry — inside the REFRESH_LEAD_MS window.
    await fs.writeFile(
      tokenPath,
      JSON.stringify({ access_token: 'about-to-expire', expires_at: Date.now() + 4 * 60_000 }),
      { mode: 0o600 },
    );
    _resetGuestyState();

    const calls = setupFetch(
      happyRoutes({ tokenOpts: { token: 'fresh-after-refresh' } }),
    );
    await fetchGuestyCalendar({ ...CREDS, tokenCachePath: tokenPath });

    const tokenPosts = calls.filter((c) => c.method === 'POST' && c.url.includes('/oauth2/token'));
    expect(tokenPosts).toHaveLength(1);

    const listingsCall = calls.find((c) => c.url.includes('/v1/listings'));
    const auth =
      listingsCall.headers?.Authorization ?? listingsCall.headers?.authorization ?? '';
    expect(auth).toBe('Bearer fresh-after-refresh');
  });

  it('dedups concurrent first-time calls into a single token issuance', async () => {
    // Two parallel fetchGuestyCalendar invocations with a cold cache MUST
    // share the same in-flight OAuth POST — otherwise a server boot under
    // load eats multiple of the 5-per-day budget.
    let tokenPostCount = 0;
    const routes = [
      {
        method: 'POST',
        path: '/oauth2/token',
        handle: async () => {
          tokenPostCount++;
          // Force a real await boundary so any racing caller has a chance to
          // step in if dedup were broken.
          await new Promise((r) => setTimeout(r, 5));
          return tokenResponse({ token: 'shared' });
        },
      },
      ...happyRoutes().slice(1),
    ];
    setupFetch(routes);

    await Promise.all([
      fetchGuestyCalendar({ ...CREDS, tokenCachePath: tokenPath }),
      fetchGuestyCalendar({ ...CREDS, tokenCachePath: tokenPath }),
    ]);

    expect(tokenPostCount).toBe(1);
  });
});

// -- reservations filter & blocked-date math --------------------------------

describe('fetchGuestyCalendar — reservations & calendar logic', () => {
  it('filters reservations: status $in [confirmed,reserved] AND checkOutDateLocalized $between today and ~2y out', async () => {
    const calls = setupFetch(happyRoutes());
    const now = new Date('2026-05-26T12:00:00');
    await fetchGuestyCalendar({ ...CREDS, tokenCachePath: tokenPath }, now);

    const resCall = calls.find((c) => c.url.includes('/v1/reservations'));
    const url = new URL(resCall.url);
    const filtersRaw = url.searchParams.get('filters');
    const filters = JSON.parse(filtersRaw);

    expect(filters).toContainEqual({
      field: 'status',
      operator: '$in',
      value: ['confirmed', 'reserved'],
    });

    // Per Guesty docs, $between uses from/to (NOT value). Compute the
    // expected upper bound the same way the implementation does, so a
    // future tweak to the horizon stays in sync without re-computing leap
    // years by hand. TZ pinned to America/Los_Angeles in package.json.
    const localYmd = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const today = localYmd(now);
    const farFutureDate = new Date(now);
    farFutureDate.setDate(now.getDate() + 730);
    const farFuture = localYmd(farFutureDate);

    expect(filters).toContainEqual({
      field: 'checkOutDateLocalized',
      operator: '$between',
      from: today,
      to: farFuture,
    });

    // Affirmatively guard against regressing to the old $gte+value shape —
    // Guesty rejects $gte/$lte as unknown operators.
    const dateFilter = filters.find((f) => f.field === 'checkOutDateLocalized');
    expect(dateFilter.operator).toBe('$between');
    expect(dateFilter).not.toHaveProperty('value');
  });

  it('excludes reservation-covered dates from blocked even if blocks.r is set', async () => {
    const listings = [{ _id: 'L1', title: 'Home', pictures: [] }];
    const reservations = [
      {
        _id: 'r1',
        listingId: 'L1',
        guest: { fullName: 'X' },
        integration: { platform: 'airbnb2' },
        checkInDateLocalized: '2026-06-01',
        checkOutDateLocalized: '2026-06-03',
        nightsCount: 2,
        status: 'confirmed',
      },
    ];
    const calendar = () => [
      // Within the reservation: r flag set. Must NOT appear in blocked.
      { date: '2026-06-01', status: 'booked', blocks: { r: true, m: false, o: false, bd: false, ic: false } },
      { date: '2026-06-02', status: 'booked', blocks: { r: true, m: false, o: false, bd: false, ic: false } },
      // Outside the reservation, host-blocked: SHOULD appear in blocked.
      { date: '2026-06-05', status: 'booked', blocks: { r: false, m: true, o: false, bd: false, ic: false } },
    ];
    setupFetch(happyRoutes({ listings, reservations, calendar }));

    const { homes } = await fetchGuestyCalendar({ ...CREDS, tokenCachePath: tokenPath });
    expect(homes[0].blocked).toEqual(['2026-06-05']);
  });

  it('treats m / o / bd / ic block codes as host-blocked', async () => {
    const listings = [{ _id: 'L1', title: 'Home', pictures: [] }];
    const calendar = () => [
      { date: '2026-06-01', status: 'booked', blocks: { m: true } },
      { date: '2026-06-02', status: 'booked', blocks: { o: true } },
      { date: '2026-06-03', status: 'booked', blocks: { bd: true } },
      { date: '2026-06-04', status: 'booked', blocks: { ic: true } },
      // r alone, no reservation in scope, should NOT count as host-blocked
      // (a stray `r` without a backing reservation is a stale artifact; we
      // mirror Hostex and only treat host-codes as blocked).
      { date: '2026-06-05', status: 'booked', blocks: { r: true } },
      { date: '2026-06-06', status: 'available', blocks: {} },
    ];
    setupFetch(happyRoutes({ listings, calendar }));

    const { homes } = await fetchGuestyCalendar({ ...CREDS, tokenCachePath: tokenPath });
    expect(homes[0].blocked).toEqual(['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04']);
  });
});

// -- retry / error semantics ------------------------------------------------

describe('fetchGuestyCalendar — retry & error semantics', () => {
  it('honors Retry-After on a 429 and retries exactly once', async () => {
    let listingsCallCount = 0;
    setupFetch([
      { method: 'POST', path: '/oauth2/token', handle: () => tokenResponse() },
      {
        method: 'GET',
        path: '/v1/listings',
        handle: () => {
          listingsCallCount++;
          if (listingsCallCount === 1) return status(429, '', { 'retry-after': '0' });
          return okJson({ results: [], count: 0, limit: 50, skip: 0 });
        },
      },
      { method: 'GET', path: '/v1/reservations', handle: () => okJson({ results: [] }) },
    ]);

    const { homes } = await fetchGuestyCalendar({ ...CREDS, tokenCachePath: tokenPath });
    expect(homes).toEqual([]);
    expect(listingsCallCount).toBe(2);
  });

  it('throws immediately on 401 without attempting a token refresh', async () => {
    // Per Guesty docs, 401 means the Authorization header is missing or
    // structurally malformed — a fresh token won't change either, so we
    // must NOT consume one of the 5-per-24h issuances on retry.
    let listingsCallCount = 0;
    let tokenIssued = 0;
    setupFetch([
      {
        method: 'POST',
        path: '/oauth2/token',
        handle: () => {
          tokenIssued++;
          return tokenResponse();
        },
      },
      {
        method: 'GET',
        path: '/v1/listings',
        handle: () => {
          listingsCallCount++;
          return status(401, '');
        },
      },
      { method: 'GET', path: '/v1/reservations', handle: () => okJson({ results: [] }) },
    ]);

    await expect(
      fetchGuestyCalendar({ ...CREDS, tokenCachePath: tokenPath }),
    ).rejects.toThrow(/HTTP 401/);

    expect(listingsCallCount).toBe(1);
    // Exactly one token issued — the initial one. No refresh attempt.
    expect(tokenIssued).toBe(1);
  });

  it('throws immediately on a 403 without a permission-shaped message body', async () => {
    // A permanent scope failure — empty body, no { message: "...permission..." }
    // signal — must not trigger a refresh. (A "wrong scope" 403 won't be
    // fixed by a fresh token; retrying just burns a token.)
    let listingsCallCount = 0;
    let tokenIssued = 0;
    setupFetch([
      {
        method: 'POST',
        path: '/oauth2/token',
        handle: () => {
          tokenIssued++;
          return tokenResponse();
        },
      },
      {
        method: 'GET',
        path: '/v1/listings',
        handle: () => {
          listingsCallCount++;
          return status(403, '');
        },
      },
      { method: 'GET', path: '/v1/reservations', handle: () => okJson({ results: [] }) },
    ]);

    await expect(
      fetchGuestyCalendar({ ...CREDS, tokenCachePath: tokenPath }),
    ).rejects.toThrow(/HTTP 403/);

    expect(listingsCallCount).toBe(1);
    expect(tokenIssued).toBe(1);
  });

  it('on 403 with a permission message: refreshes the token once and retries; a second 403 throws', async () => {
    // Per Guesty docs, an expired token surfaces as 403 carrying a body of
    // shape { message: "...permission..." }. This is the (only) refresh
    // case — replacing the previous 401-retry behaviour.
    let listingsCallCount = 0;
    let tokenIssued = 0;
    setupFetch([
      {
        method: 'POST',
        path: '/oauth2/token',
        handle: () => {
          tokenIssued++;
          return tokenResponse({ token: `tok-${tokenIssued}` });
        },
      },
      {
        method: 'GET',
        path: '/v1/listings',
        handle: () => {
          listingsCallCount++;
          return status(
            403,
            JSON.stringify({ message: 'You do not have permission to access this resource' }),
            { 'content-type': 'application/json' },
          );
        },
      },
      { method: 'GET', path: '/v1/reservations', handle: () => okJson({ results: [] }) },
    ]);

    await expect(
      fetchGuestyCalendar({ ...CREDS, tokenCachePath: tokenPath }),
    ).rejects.toThrow(/HTTP 403/);

    expect(listingsCallCount).toBe(2);
    expect(tokenIssued).toBe(2);
  });
});

// -- channel mapping --------------------------------------------------------

describe('fetchGuestyCalendar — channel mapping', () => {
  it('maps known integration.platform values; passes through unknowns', async () => {
    const listings = [{ _id: 'L1', title: 'Home', pictures: [] }];
    const mkRes = (id, platform) => ({
      _id: id,
      listingId: 'L1',
      guest: { fullName: id },
      integration: { platform },
      checkInDateLocalized: '2026-06-01',
      checkOutDateLocalized: '2026-06-02',
      nightsCount: 1,
      status: 'confirmed',
    });
    const reservations = [
      mkRes('a', 'airbnb2'),
      mkRes('b', 'vrbo'),
      mkRes('c', 'bookingCom'),
      mkRes('d', 'homeaway2'),
      mkRes('e', 'manual'),
      mkRes('f', 'something_new'),
    ];
    setupFetch(happyRoutes({ listings, reservations }));

    const { homes } = await fetchGuestyCalendar({ ...CREDS, tokenCachePath: tokenPath });
    const byGuest = Object.fromEntries(homes[0].reservations.map((r) => [r.guest, r.channel]));
    expect(byGuest).toEqual({
      a: 'airbnb',
      b: 'vrbo',
      c: 'booking.com',
      d: 'homeaway',
      e: 'manual',
      f: 'something_new',
    });
  });
});

// -- pagination -------------------------------------------------------------

describe('fetchGuestyCalendar — pagination', () => {
  it('pages /v1/reservations: a full page (100) triggers skip=100; a short page stops', async () => {
    const reservationCalls = [];
    const mkRes = (i) => ({
      _id: `r${i}`,
      listingId: 'L1',
      guest: { fullName: `g${i}` },
      integration: { platform: 'airbnb2' },
      checkInDateLocalized: '2026-06-01',
      checkOutDateLocalized: '2026-06-02',
      nightsCount: 1,
      status: 'confirmed',
    });
    setupFetch([
      { method: 'POST', path: '/oauth2/token', handle: () => tokenResponse() },
      {
        method: 'GET',
        path: '/v1/listings',
        handle: () => okJson({ results: [{ _id: 'L1', title: 'Home', pictures: [] }], count: 1, limit: 50, skip: 0 }),
      },
      {
        method: 'GET',
        path: '/v1/reservations',
        handle: (url) => {
          reservationCalls.push(new URL(url).searchParams.get('skip'));
          if (reservationCalls.length === 1) {
            // Exactly limit=100 — loop must continue.
            return okJson({ results: Array.from({ length: 100 }, (_, i) => mkRes(i)), count: 150, limit: 100, skip: 0 });
          }
          // Partial page — loop must stop.
          return okJson({ results: [mkRes(100), mkRes(101)], count: 102, limit: 100, skip: 100 });
        },
      },
      {
        method: 'GET',
        path: '/v1/availability-pricing/api/calendar/listings/minified/',
        handle: () => okJson({ data: { days: [] } }),
      },
    ]);

    const { homes } = await fetchGuestyCalendar({ ...CREDS, tokenCachePath: tokenPath });
    expect(homes[0].reservations).toHaveLength(102);
    expect(reservationCalls).toEqual(['0', '100']);
  });
});

// -- cover normalization ----------------------------------------------------

describe('fetchGuestyCalendar — cover normalization', () => {
  it('exercises the thumbnail/regular/original/null fallback chain', async () => {
    const listings = [
      { _id: 'A', title: 'A', pictures: [{ thumbnail: 'thumb-A.jpg', regular: 'reg-A.jpg' }] },
      { _id: 'B', title: 'B', pictures: [{ regular: 'reg-B.jpg', original: 'orig-B.jpg' }] },
      { _id: 'C', title: 'C', pictures: [{ original: 'orig-C.jpg' }] },
      { _id: 'D', title: 'D', pictures: [] },
      { _id: 'E', title: 'E' /* pictures missing */ },
    ];
    setupFetch(happyRoutes({ listings }));

    const { homes } = await fetchGuestyCalendar({ ...CREDS, tokenCachePath: tokenPath });
    const byId = Object.fromEntries(homes.map((h) => [h.id, h.cover]));
    expect(byId).toEqual({
      A: 'thumb-A.jpg',
      B: 'reg-B.jpg',
      C: 'orig-C.jpg',
      D: null,
      E: null,
    });
  });
});
