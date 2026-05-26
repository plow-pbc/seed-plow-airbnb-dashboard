import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GuestyTimeline } from './GuestyTimeline';
import type { GuestyHome, GuestyReservation } from '../types';

// Local YYYY-MM-DD matching the timeline's day-axis math (it uses the local
// TZ — same convention as src/hostex.ts ymd).
function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function offsetYmd(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return ymd(d);
}

function resv(overrides: Partial<GuestyReservation>): GuestyReservation {
  return {
    guest: 'Guest',
    channel: 'airbnb',
    check_in: offsetYmd(1),
    check_out: offsetYmd(3),
    nights: 2,
    status: 'confirmed',
    ...overrides,
  };
}

describe('GuestyTimeline', () => {
  // One home, one confirmed booking + one reserved (pending) booking, both
  // placed inside the default 14-day window so both render as bars.
  const homes: GuestyHome[] = [
    {
      id: 'H1',
      name: 'Sample Home',
      cover: null,
      reservations: [
        resv({
          guest: 'Alice',
          channel: 'airbnb',
          check_in: offsetYmd(2),
          check_out: offsetYmd(5),
          nights: 3,
          status: 'confirmed',
        }),
        resv({
          guest: 'Bob',
          channel: 'vrbo',
          check_in: offsetYmd(7),
          check_out: offsetYmd(10),
          nights: 3,
          status: 'reserved',
        }),
      ],
      blocked: [],
    },
  ];

  const html = renderToStaticMarkup(<GuestyTimeline homes={homes} />);

  it('tags the reserved bar with data-status="reserved" exactly once', () => {
    const reservedHits = html.match(/data-status="reserved"/g) ?? [];
    expect(reservedHits).toHaveLength(1);
  });

  it('does NOT tag the confirmed bar with data-status', () => {
    // No confirmed-status attribute (we mark only the pending case) and no
    // stray data-status="…" on anything besides the one reserved bar.
    expect(html).not.toContain('data-status="confirmed"');
    const allHits = html.match(/data-status="[^"]+"/g) ?? [];
    expect(allHits).toEqual(['data-status="reserved"']);
  });

  it('puts "pending" in the reserved bar\'s tooltip and aria-label', () => {
    // The reserved bar's title= and aria-label= both end in "(pending)".
    // We locate the single reserved bar's surrounding <div…> opening tag
    // and inspect it.
    const reservedTag = html.match(/<div[^>]*data-status="reserved"[^>]*>/);
    expect(reservedTag).not.toBeNull();
    expect(reservedTag![0]).toMatch(/title="[^"]*\(pending\)"/);
    expect(reservedTag![0]).toMatch(/aria-label="[^"]*\(pending\)"/);
  });

  it('does NOT put "pending" in the confirmed bar\'s tooltip', () => {
    // Confirmed bars carry title= but the text must not include "pending".
    // We extract title attributes from every <div tl-resv …> bar.
    const barTags = html.match(/<div class="tl-resv[^"]*"[^>]*>/g) ?? [];
    // Two bars: one with data-status, one without. The one without is the
    // confirmed bar — assert its title contains the guest but not "pending".
    const confirmed = barTags.find((t) => !t.includes('data-status='));
    expect(confirmed).toBeTruthy();
    expect(confirmed!).toMatch(/title="Alice [^"]*"/);
    expect(confirmed!).not.toContain('pending');
  });

  it('renders the empty-state message when no homes are provided', () => {
    const empty = renderToStaticMarkup(<GuestyTimeline homes={[]} />);
    expect(empty).toContain('No homes on this Guesty account');
  });
});
