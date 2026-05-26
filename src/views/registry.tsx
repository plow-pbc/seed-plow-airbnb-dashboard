import type { ReactNode } from 'react';
import type { Size } from '../layout';
import type { Event, HostexHome, GuestyHome } from '../types';
import { CalendarView } from './CalendarView';
import { ReservationsView } from './ReservationsView';
import { GuestyReservationsView } from './GuestyReservationsView';
import { ClockView } from './ClockView';

// A view is one panel the dashboard can tile. New views are added by writing a
// component and appending a ViewDef here — the layout, tabs, settings toggle,
// and rotation pick it up automatically.

export type ViewDef = {
  // Stable id — persisted in settings (disabledViewIds) and used as a React
  // key. Don't rename one in place or saved configs lose track of it.
  id: string;
  // Human label shown on tabs, panel headers, and the settings toggles.
  title: string;
  // Smallest size at which the view stays comfortable. The layout fitter uses
  // the largest minSize among enabled views to decide how many panels tile.
  minSize: Size;
  render: () => ReactNode;
};

// One configured calendar source, parsed from /api/calendar. ICAL_URL,
// HOSTEX_ACCESS_TOKEN, and the Guesty credential pair are independent —
// zero, one, two, or all three may be present. `error` marks a source that
// failed to load this cycle; its panel still shows (with a retry notice)
// so the layout stays put.
export type CalendarSource =
  | { source: 'ical'; events: Event[] }
  | { source: 'hostex'; homes: HostexHome[] }
  | { source: 'guesty'; homes: GuestyHome[] }
  | { source: 'ical' | 'hostex' | 'guesty'; error: true };

// Panel identity per source kind — kept constant whether the source loaded or
// errored, so settings toggles and grid placement survive an error cycle.
const CALENDAR_META = {
  ical: { id: 'calendar', title: 'Calendar', minSize: { width: 360, height: 320 } },
  // The 14-day timeline needs real width before it stops feeling cramped.
  hostex: { id: 'reservations', title: 'Hostex Reservations', minSize: { width: 640, height: 360 } },
  guesty: {
    id: 'guesty-reservations',
    title: 'Guesty Reservations',
    minSize: { width: 640, height: 360 },
  },
} as const;

const CLOCK_VIEW: ViewDef = {
  id: 'clock',
  title: 'Clock',
  minSize: { width: 260, height: 200 },
  render: () => <ClockView />,
};

// Build the available views from the loaded calendar sources — one panel per
// configured source, in order, then the always-present data-free clock.
export function buildViews(sources: CalendarSource[]): ViewDef[] {
  const views: ViewDef[] = sources.map((src) => {
    const meta = CALENDAR_META[src.source];
    if ('error' in src) {
      return {
        ...meta,
        render: () => (
          <p className="view-error">Can’t reach {meta.title.toLowerCase()} — retrying soon.</p>
        ),
      };
    }
    if (src.source === 'ical') {
      return { ...meta, render: () => <CalendarView events={src.events} /> };
    }
    if (src.source === 'hostex') {
      return { ...meta, render: () => <ReservationsView homes={src.homes} /> };
    }
    if (src.source === 'guesty') {
      return { ...meta, render: () => <GuestyReservationsView homes={src.homes} /> };
    }
    // Exhaustiveness guard: TS narrows `src` to `never`. Throw protects
    // against a wire envelope sprouting a new source the client doesn't
    // know how to render yet — better a loud failure than a blank panel.
    const _exhaustive: never = src;
    throw new Error(`Unknown calendar source: ${JSON.stringify(_exhaustive)}`);
  });

  views.push(CLOCK_VIEW);
  return views;
}
