const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const createApp = require('../app');
const { resetTokens } = require('../auth');
const reservationsFixture = require('../fixtures/reservations');
const listingsFixture = require('../fixtures/listings');

let app;
beforeEach(() => {
  resetTokens();
  app = createApp();
});

async function getToken() {
  const res = await request(app)
    .post('/oauth2/token')
    .type('form')
    .send({
      grant_type: 'client_credentials',
      scope: 'open-api',
      client_id: 'dtu-test-id',
      client_secret: 'dtu-test-secret',
    });
  if (!res.body.access_token) {
    throw new Error(`token request failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.access_token;
}

const CALENDAR_BASE = '/v1/availability-pricing/api/calendar/listings/minified';

// ---------- /oauth2/token ----------

test('POST /oauth2/token issues a Bearer token for valid client credentials', async () => {
  const res = await request(app)
    .post('/oauth2/token')
    .type('form')
    .send({
      grant_type: 'client_credentials',
      scope: 'open-api',
      client_id: 'dtu-test-id',
      client_secret: 'dtu-test-secret',
    });
  assert.equal(res.status, 200);
  assert.equal(res.body.token_type, 'Bearer');
  assert.equal(res.body.expires_in, 86400);
  assert.equal(res.body.scope, 'open-api');
  assert.match(res.body.access_token, /^[0-9a-f]{64}$/);
});

test('POST /oauth2/token returns 401 for wrong client_secret', async () => {
  const res = await request(app)
    .post('/oauth2/token')
    .type('form')
    .send({
      grant_type: 'client_credentials',
      scope: 'open-api',
      client_id: 'dtu-test-id',
      client_secret: 'WRONG',
    });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'invalid_client');
});

test('POST /oauth2/token returns 401 for wrong grant_type', async () => {
  const res = await request(app)
    .post('/oauth2/token')
    .type('form')
    .send({
      grant_type: 'password',
      scope: 'open-api',
      client_id: 'dtu-test-id',
      client_secret: 'dtu-test-secret',
    });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'invalid_client');
});

// ---------- Bearer validation (401 missing header vs 403 unknown token) ----------

test('missing Authorization header => 401 + Hapi-shape body', async () => {
  for (const url of [
    '/v1/listings',
    '/v1/reservations',
    `${CALENDAR_BASE}/${listingsFixture[0]._id}?startDate=2026-01-01&endDate=2026-01-02`,
  ]) {
    const res = await request(app).get(url);
    assert.equal(res.status, 401, `expected 401 for ${url}`);
    assert.equal(res.body.statusCode, 401);
    assert.equal(res.body.error, 'Unauthorized');
    assert.ok(res.body.message);
  }
});

test('malformed Authorization header (no Bearer prefix) => 401', async () => {
  const res = await request(app)
    .get('/v1/listings')
    .set('Authorization', 'Token abc');
  assert.equal(res.status, 401);
  assert.equal(res.body.statusCode, 401);
});

test('valid Bearer prefix but unknown token => 403 + Guesty permission message', async () => {
  const res = await request(app)
    .get('/v1/listings')
    .set('Authorization', 'Bearer not-a-real-token');
  assert.equal(res.status, 403);
  assert.equal(
    res.body.message,
    "You don't have permission to access, please contact Guesty support.",
  );
  // Ensure we did NOT return the 401 Hapi shape
  assert.equal(res.body.statusCode, undefined);
  assert.equal(res.body.error, undefined);
});

test('Bearer scheme is case-insensitive', async () => {
  const token = await getToken();
  for (const scheme of ['bearer', 'BEARER', 'BeArEr']) {
    const res = await request(app)
      .get('/v1/listings')
      .set('Authorization', `${scheme} ${token}`);
    assert.equal(res.status, 200, `expected 200 for scheme=${scheme}`);
  }
});

test('Bearer regex captures only the token, ignoring trailing whitespace', async () => {
  const token = await getToken();
  const res = await request(app)
    .get('/v1/listings')
    .set('Authorization', `Bearer  ${token}  `);
  // Express normalizes some whitespace, but the \S+ capture ensures any trailing
  // characters in the captured group would have invalidated the lookup. 200 means
  // the captured token equals the issued token.
  assert.equal(res.status, 200);
});

// ---------- /v1/listings ----------

test('GET /v1/listings returns paginated listings with required fields', async () => {
  const token = await getToken();
  const res = await request(app)
    .get('/v1/listings')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.count, listingsFixture.length);
  assert.equal(res.body.skip, 0);
  assert.ok(Array.isArray(res.body.results));
  const first = res.body.results[0];
  assert.ok(first._id);
  assert.ok(first.title);
  assert.ok(first.nickname);
  assert.ok(first.pictures[0].thumbnail);
});

test('GET /v1/listings honors limit and skip across page boundaries', async () => {
  const token = await getToken();
  const page1 = await request(app)
    .get('/v1/listings?limit=2&skip=0')
    .set('Authorization', `Bearer ${token}`);
  const page2 = await request(app)
    .get('/v1/listings?limit=2&skip=2')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(page1.body.results.length, 2);
  assert.equal(page2.body.results.length, listingsFixture.length - 2);
  assert.equal(page1.body.results[0]._id, listingsFixture[0]._id);
  assert.equal(page2.body.results[0]._id, listingsFixture[2]._id);
});

// ---------- /v1/reservations ----------

test('GET /v1/reservations returns all reservations with the required fields', async () => {
  const token = await getToken();
  const res = await request(app)
    .get('/v1/reservations?limit=100')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.count, reservationsFixture.length);
  const r = res.body.results[0];
  assert.ok(r._id);
  assert.ok(r.listingId);
  assert.ok(r.guest && r.guest.fullName);
  assert.ok(r.integration && r.integration.platform);
  assert.ok(r.checkIn);
  assert.ok(r.checkOut);
  assert.equal(typeof r.nightsCount, 'number');
  assert.ok(r.status);
});

test('GET /v1/reservations filters by status $in', async () => {
  const token = await getToken();
  const filters = JSON.stringify([
    { field: 'status', operator: '$in', value: ['reserved'] },
  ]);
  const res = await request(app)
    .get(`/v1/reservations?filters=${encodeURIComponent(filters)}&limit=100`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.count > 0, 'expected at least one reserved reservation');
  for (const r of res.body.results) {
    assert.equal(r.status, 'reserved');
  }
});

test('GET /v1/reservations $between uses from/to (real Guesty shape)', async () => {
  const token = await getToken();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const fromStr = today.toISOString().slice(0, 10);
  const toDate = new Date(today);
  toDate.setUTCDate(toDate.getUTCDate() + 30);
  const toStr = toDate.toISOString().slice(0, 10);

  const filters = JSON.stringify([
    { field: 'checkInDateLocalized', operator: '$between', from: fromStr, to: toStr },
  ]);
  const res = await request(app)
    .get(`/v1/reservations?filters=${encodeURIComponent(filters)}&limit=100`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.count > 0, 'expected reservations in the next 30 days');
  for (const r of res.body.results) {
    assert.ok(r.checkInDateLocalized >= fromStr);
    assert.ok(r.checkInDateLocalized <= toStr);
  }
});

test('GET /v1/reservations $between without from/to => 400', async () => {
  const token = await getToken();
  const filters = JSON.stringify([
    { field: 'checkInDateLocalized', operator: '$between', value: ['2026-01-01', '2026-12-31'] },
  ]);
  const res = await request(app)
    .get(`/v1/reservations?filters=${encodeURIComponent(filters)}`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 400);
  assert.equal(res.body.statusCode, 400);
  assert.match(res.body.message, /\$between/);
});

test('GET /v1/reservations combined filters ($in + $gt on date)', async () => {
  const token = await getToken();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const cutoff = yesterday.toISOString().slice(0, 10);

  const filters = JSON.stringify([
    { field: 'status', operator: '$in', value: ['confirmed'] },
    { field: 'checkOutDateLocalized', operator: '$gt', value: cutoff },
  ]);
  const res = await request(app)
    .get(`/v1/reservations?filters=${encodeURIComponent(filters)}&limit=100`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  for (const r of res.body.results) {
    assert.equal(r.status, 'confirmed');
    assert.ok(r.checkOutDateLocalized > cutoff);
  }
});

test('GET /v1/reservations $contains substring on guest.fullName-adjacent field', async () => {
  // $contains works on flat fields only; use `status` which is a plain string.
  const token = await getToken();
  const filters = JSON.stringify([
    { field: 'status', operator: '$contains', value: 'conf' },
  ]);
  const res = await request(app)
    .get(`/v1/reservations?filters=${encodeURIComponent(filters)}&limit=100`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.count > 0);
  for (const r of res.body.results) {
    assert.match(r.status, /conf/);
  }
});

test('GET /v1/reservations $contains negative case (no match) returns empty', async () => {
  const token = await getToken();
  const filters = JSON.stringify([
    { field: 'status', operator: '$contains', value: 'zzz-no-match' },
  ]);
  const res = await request(app)
    .get(`/v1/reservations?filters=${encodeURIComponent(filters)}`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.count, 0);
});

test('GET /v1/reservations $notcontains excludes substring matches', async () => {
  const token = await getToken();
  const filters = JSON.stringify([
    { field: 'status', operator: '$notcontains', value: 'reserv' },
  ]);
  const res = await request(app)
    .get(`/v1/reservations?filters=${encodeURIComponent(filters)}&limit=100`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  for (const r of res.body.results) {
    assert.doesNotMatch(r.status, /reserv/);
  }
});

test('GET /v1/reservations $not negates equality on status', async () => {
  const token = await getToken();
  const filters = JSON.stringify([
    { field: 'status', operator: '$not', value: 'confirmed' },
  ]);
  const res = await request(app)
    .get(`/v1/reservations?filters=${encodeURIComponent(filters)}&limit=100`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.count > 0);
  for (const r of res.body.results) {
    assert.notEqual(r.status, 'confirmed');
  }
});

test('GET /v1/reservations $not positive (returns nothing matching)', async () => {
  const token = await getToken();
  // Combine $not 'confirmed' with $in ['confirmed'] — should be empty.
  const filters = JSON.stringify([
    { field: 'status', operator: '$not', value: 'confirmed' },
    { field: 'status', operator: '$in', value: ['confirmed'] },
  ]);
  const res = await request(app)
    .get(`/v1/reservations?filters=${encodeURIComponent(filters)}`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.count, 0);
});

for (const dropped of ['$nin', '$gte', '$lte']) {
  test(`GET /v1/reservations dropped operator ${dropped} => 400`, async () => {
    const token = await getToken();
    const filters = JSON.stringify([
      { field: 'status', operator: dropped, value: ['confirmed'] },
    ]);
    const res = await request(app)
      .get(`/v1/reservations?filters=${encodeURIComponent(filters)}`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 400);
    assert.equal(res.body.statusCode, 400);
    assert.match(res.body.message, new RegExp(`\\${dropped}`));
  });
}

test('GET /v1/reservations unknown operator => 400 (not silent-true)', async () => {
  const token = await getToken();
  const filters = JSON.stringify([
    { field: 'status', operator: '$bogus', value: 'x' },
  ]);
  const res = await request(app)
    .get(`/v1/reservations?filters=${encodeURIComponent(filters)}`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 400);
  assert.equal(res.body.statusCode, 400);
  assert.match(res.body.message, /\$bogus/);
});

test('GET /v1/reservations malformed filters JSON => 400 (not silent empty)', async () => {
  const token = await getToken();
  const res = await request(app)
    .get('/v1/reservations?filters=%7Bnot-json')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 400);
  assert.equal(res.body.statusCode, 400);
  assert.match(res.body.message, /Invalid filters JSON/);
});

test('GET /v1/reservations with NO filters param returns everything', async () => {
  const token = await getToken();
  const res = await request(app)
    .get('/v1/reservations?limit=100')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.count, reservationsFixture.length);
});

test('GET /v1/reservations pagination respects limit/skip', async () => {
  const token = await getToken();
  const page1 = await request(app)
    .get('/v1/reservations?limit=3&skip=0')
    .set('Authorization', `Bearer ${token}`);
  const page2 = await request(app)
    .get('/v1/reservations?limit=3&skip=3')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(page1.body.results.length, 3);
  assert.equal(page2.body.results.length, 3);
  const ids = new Set([
    ...page1.body.results.map((r) => r._id),
    ...page2.body.results.map((r) => r._id),
  ]);
  assert.equal(ids.size, 6, 'pages should not overlap');
});

// ---------- /v1/availability-pricing calendar (wrapped in {data:{days:[...]}}) ----------

test('GET calendar returns {data:{days:[...]}} wrapper with minified per-day shape', async () => {
  const token = await getToken();
  const listingId = listingsFixture[0]._id;
  const res = await request(app)
    .get(`${CALENDAR_BASE}/${listingId}?startDate=2030-01-01&endDate=2030-01-05`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.data, 'expected top-level data wrapper');
  assert.ok(Array.isArray(res.body.data.days), 'expected data.days array');
  assert.equal(res.body.data.days.length, 5);
  for (const day of res.body.data.days) {
    assert.match(day.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(day.status === 'available' || day.status === 'booked');
    for (const code of ['r', 'b', 'm', 'o', 'bd', 'ic']) {
      assert.equal(typeof day.blocks[code], 'boolean', `expected ${code} boolean`);
    }
  }
});

test('GET calendar shows r=true and status=booked for reservation nights', async () => {
  const token = await getToken();
  const sample = reservationsFixture.find((r) => r.status === 'confirmed');
  const date = sample.checkInDateLocalized;
  const res = await request(app)
    .get(`${CALENDAR_BASE}/${sample.listingId}?startDate=${date}&endDate=${date}`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.days.length, 1);
  assert.equal(res.body.data.days[0].date, date);
  assert.equal(res.body.data.days[0].blocks.r, true);
  assert.equal(res.body.data.days[0].status, 'booked');
});

test('GET calendar does NOT mark the checkout day as r', async () => {
  const token = await getToken();
  const sample = reservationsFixture.find((r) => r.status === 'confirmed');
  const checkoutDay = sample.checkOutDateLocalized;
  const res = await request(app)
    .get(`${CALENDAR_BASE}/${sample.listingId}?startDate=${checkoutDay}&endDate=${checkoutDay}`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.days[0].blocks.r, false);
});

test('GET calendar 400s without startDate/endDate', async () => {
  const token = await getToken();
  const res = await request(app)
    .get(`${CALENDAR_BASE}/${listingsFixture[0]._id}`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 400);
});

test('GET calendar 404s for an unknown listing', async () => {
  const token = await getToken();
  const res = await request(app)
    .get(`${CALENDAR_BASE}/000000000000000000000000?startDate=2030-01-01&endDate=2030-01-02`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 404);
});
