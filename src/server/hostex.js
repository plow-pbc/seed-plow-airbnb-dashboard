// Hostex OpenAPI reservation source. Pulls the account's properties (the
// "homes"), their reservations, and per-day inventory — assembled into the
// timeline App.tsx renders. The token is read here and never reaches the
// browser; server.js wraps this behind the cached /api/calendar proxy.
//
// Docs: https://hostex-openapi.readme.io/reference/query-properties
//       https://hostex-openapi.readme.io/reference/query-reservations
//       https://hostex-openapi.readme.io/reference/query-listing-calendars

const API_BASE = 'https://api.hostex.io/v3';
const TIMEOUT_MS = 15_000;
const PAGE = 100;
const INVENTORY_DAYS = 180;

// Returns { homes: [{ id, name, cover, reservations, blocked }] }.
export async function fetchHostexCalendar(token, now = new Date()) {
  const [properties, reservations] = await Promise.all([
    queryAll(token, '/properties'),
    // No date filter — the API defaults to checkouts within the next 180
    // days, i.e. every current and upcoming stay.
    queryAll(token, '/reservations'),
  ]);

  // Accepted reservations only (drop cancelled / denied / pending), grouped
  // by the property they belong to.
  const byProperty = new Map();
  for (const r of reservations) {
    if (r.status !== 'accepted') continue;
    const list = byProperty.get(r.property_id) ?? [];
    list.push({
      guest: r.guest_name || 'Reserved',
      channel: r.channel_type,
      check_in: r.check_in_date,
      check_out: r.check_out_date,
      nights: eachNight(r.check_in_date, r.check_out_date).length,
    });
    byProperty.set(r.property_id, list);
  }

  const { start, end } = inventoryRange(now);

  const homes = await Promise.all(
    properties.map(async (p) => {
      const resv = (byProperty.get(p.id) ?? []).sort((a, b) =>
        a.check_in < b.check_in ? -1 : a.check_in > b.check_in ? 1 : 0,
      );
      const inventory = await queryInventory(token, p, start, end);
      return {
        id: p.id,
        name: p.title,
        cover: p.cover?.small_url ?? null,
        reservations: resv,
        blocked: blockedDates(inventory, resv),
      };
    }),
  );

  return { homes };
}

// Dates the property is unavailable (inventory 0) but carries no accepted
// reservation — i.e. owner-blocked. Empty when inventory couldn't be read.
function blockedDates(inventory, reservations) {
  if (!inventory) return [];
  const reserved = new Set();
  for (const r of reservations) {
    for (const night of eachNight(r.check_in, r.check_out)) reserved.add(night);
  }
  const blocked = [];
  for (const [date, count] of inventory) {
    if (count === 0 && !reserved.has(date)) blocked.push(date);
  }
  return blocked.sort();
}

// Per-day inventory (date -> count) for a property, read from the first
// channel the token can access. null when every channel is unreachable.
async function queryInventory(token, property, start, end) {
  for (const ch of property.channels ?? []) {
    try {
      const { data } = await hostexRequest(token, '/listings/calendar', {
        method: 'POST',
        body: JSON.stringify({
          start_date: start,
          end_date: end,
          listings: [{ channel_type: ch.channel_type, listing_id: ch.listing_id }],
        }),
      });
      const calendar = data?.listings?.[0]?.calendar ?? [];
      const inventory = new Map();
      for (const day of calendar) inventory.set(day.date, day.inventory ?? 0);
      return inventory;
    } catch (err) {
      console.warn(
        `Hostex: inventory for "${property.title}" via ${ch.channel_type} failed — ${err.message}`,
      );
    }
  }
  return null;
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

// The night date-strings a stay occupies: check-in through check-out
// exclusive. UTC math keeps it independent of the server's time zone.
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

// Walk every page of a list endpoint.
async function queryAll(token, path) {
  const out = [];
  let offset = 0;
  for (;;) {
    const { data } = await hostexRequest(token, `${path}?limit=${PAGE}&offset=${offset}`);
    const batch = data?.properties ?? data?.reservations ?? [];
    out.push(...batch);
    offset += batch.length;
    if (batch.length < PAGE) break;
  }
  return out;
}

async function hostexRequest(token, path, init = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Hostex-Access-Token': token,
      'Content-Type': 'application/json',
      ...init.headers,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Hostex API HTTP ${res.status} for ${path}`);
  const json = await res.json();
  // Hostex echoes an HTTP-style status in error_code — 200 (any 2xx) means OK;
  // anything else is a failure carried inside an HTTP 200 response.
  const code = json.error_code;
  const ok = code === 0 || (code >= 200 && code < 300);
  if (!ok) throw new Error(`Hostex API error ${code}: ${json.error_msg} (${path})`);
  return json;
}
