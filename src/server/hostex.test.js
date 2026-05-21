import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchHostexCalendar } from './hostex.js';

// Dispatch a stubbed fetch by URL substring. A route value is either a static
// response body or a function of the request init (to vary by POST body).
function mockFetch(byPath) {
  return vi.fn(async (url, init) => {
    const u = String(url);
    for (const [frag, resolver] of Object.entries(byPath)) {
      if (u.includes(frag)) {
        const body = typeof resolver === 'function' ? resolver(init) : resolver;
        return { ok: true, json: async () => body };
      }
    }
    throw new Error(`unexpected fetch: ${u}`);
  });
}

afterEach(() => vi.unstubAllGlobals());

// Hostex signals success with error_code 200 (not 0) — see hostexRequest.
const OK = 200;

const properties = {
  error_code: OK,
  data: {
    properties: [
      {
        id: 1,
        title: 'Mtn Home',
        cover: { small_url: 'mtn.jpg' },
        channels: [{ channel_type: 'airbnb', listing_id: 'A1' }],
      },
      {
        id: 2,
        title: '10th Ave',
        cover: null,
        channels: [{ channel_type: 'airbnb', listing_id: 'B1' }],
      },
    ],
  },
};

const reservations = {
  error_code: OK,
  data: {
    reservations: [
      {
        property_id: 1,
        status: 'accepted',
        guest_name: 'Emily Ratzmann',
        channel_type: 'airbnb',
        check_in_date: '2026-05-23',
        check_out_date: '2026-05-25',
      },
      {
        property_id: 1,
        status: 'cancelled',
        guest_name: 'Cancelled Carl',
        channel_type: 'airbnb',
        check_in_date: '2026-06-01',
        check_out_date: '2026-06-03',
      },
    ],
  },
};

// /listings/calendar response varied by the requested listing_id.
function calendarRoute(byListing) {
  return (init) => {
    const id = JSON.parse(init.body).listings[0].listing_id;
    return {
      error_code: OK,
      data: { listings: [{ listing_id: id, calendar: byListing[id] ?? [] }] },
    };
  };
}

const calendar = calendarRoute({
  A1: [
    { date: '2026-05-23', inventory: 0 },
    { date: '2026-05-24', inventory: 0 },
    { date: '2026-05-25', inventory: 0 },
    { date: '2026-05-26', inventory: 1 },
  ],
  B1: [
    { date: '2026-05-23', inventory: 1 },
    { date: '2026-05-24', inventory: 0 },
  ],
});

describe('fetchHostexCalendar', () => {
  it('assembles homes with accepted reservations and computed nights', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/properties': properties,
        '/reservations': reservations,
        '/listings/calendar': calendar,
      }),
    );
    const { homes } = await fetchHostexCalendar('tok');
    expect(homes.map((h) => h.name)).toEqual(['Mtn Home', '10th Ave']);
    const mtn = homes.find((h) => h.id === 1);
    expect(mtn.cover).toBe('mtn.jpg');
    expect(mtn.reservations).toEqual([
      {
        guest: 'Emily Ratzmann',
        channel: 'airbnb',
        check_in: '2026-05-23',
        check_out: '2026-05-25',
        nights: 2,
      },
    ]);
  });

  it('drops cancelled reservations', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/properties': properties,
        '/reservations': reservations,
        '/listings/calendar': calendar,
      }),
    );
    const { homes } = await fetchHostexCalendar('tok');
    const guests = homes.flatMap((h) => h.reservations.map((r) => r.guest));
    expect(guests).not.toContain('Cancelled Carl');
  });

  it('flags inventory-0 dates with no reservation as blocked', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/properties': properties,
        '/reservations': reservations,
        '/listings/calendar': calendar,
      }),
    );
    const { homes } = await fetchHostexCalendar('tok');
    // A1: 23/24/25 are inventory 0; Emily reserves 23–24, so only 25 is blocked.
    expect(homes.find((h) => h.id === 1).blocked).toEqual(['2026-05-25']);
    // B1: 24 is inventory 0 with no reservation.
    expect(homes.find((h) => h.id === 2).blocked).toEqual(['2026-05-24']);
  });

  it('leaves blocked empty when the calendar endpoint is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/properties': properties,
        '/reservations': reservations,
        '/listings/calendar': { error_code: 403, error_msg: 'No permission on access' },
      }),
    );
    const { homes } = await fetchHostexCalendar('tok');
    expect(homes.every((h) => h.blocked.length === 0)).toBe(true);
  });

  it('throws on a non-2xx error_code', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/properties': { error_code: 401, error_msg: 'bad token' },
        '/reservations': reservations,
        '/listings/calendar': calendar,
      }),
    );
    await expect(fetchHostexCalendar('tok')).rejects.toThrow('bad token');
  });
});
