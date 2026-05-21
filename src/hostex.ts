import type { Reservation } from './types';

// Timeline helpers: the day axis, and where each reservation bar sits on it.
// Pure and deterministic, so they're unit-tested.

function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Whole days from `a` to `b`; round() absorbs DST's 23/25-hour days.
function dayDiff(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

// The `count` consecutive day columns starting at `viewStart`.
export function dayList(viewStart: Date, count: number): Date[] {
  const out: Date[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(viewStart);
    d.setDate(viewStart.getDate() + i);
    out.push(d);
  }
  return out;
}

// Local YYYY-MM-DD — matches the date strings the Hostex API returns.
export function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export type Placement = {
  startCol: number; // 0-based column of the first visible night
  span: number; // number of day columns the bar covers
  clipLeft: boolean; // the stay began before the visible window
  clipRight: boolean; // the stay ends after the visible window
};

// Where a reservation's bar sits in a `days`-wide track, or null when its
// nights fall entirely outside the window. A stay occupies one column per
// night: the check-in day through the check-out day minus one.
export function placeReservation(
  resv: Pick<Reservation, 'check_in' | 'check_out'>,
  days: Date[],
): Placement | null {
  if (days.length === 0) return null;
  const firstNight = parseYmd(resv.check_in);
  const lastNight = parseYmd(resv.check_out);
  lastNight.setDate(lastNight.getDate() - 1);
  if (lastNight < firstNight) return null; // zero-night / malformed

  const startIdx = dayDiff(days[0], firstNight);
  const endIdx = dayDiff(days[0], lastNight);
  if (endIdx < 0 || startIdx > days.length - 1) return null;

  const startCol = Math.max(0, startIdx);
  const endCol = Math.min(days.length - 1, endIdx);
  return {
    startCol,
    span: endCol - startCol + 1,
    clipLeft: startIdx < 0,
    clipRight: endIdx > days.length - 1,
  };
}

export type Phase = 'past' | 'current' | 'upcoming';

// 'current' means the guest is in the home today.
export function reservationPhase(
  resv: Pick<Reservation, 'check_in' | 'check_out'>,
  today: Date,
): Phase {
  const t = startOfDay(today).getTime();
  if (t >= parseYmd(resv.check_out).getTime()) return 'past';
  if (t >= parseYmd(resv.check_in).getTime()) return 'current';
  return 'upcoming';
}

// True when `day` is one of the nights the reservation occupies.
export function coversNight(resv: Pick<Reservation, 'check_in' | 'check_out'>, day: Date): boolean {
  const d = startOfDay(day).getTime();
  return parseYmd(resv.check_in).getTime() <= d && d < parseYmd(resv.check_out).getTime();
}

const CHANNEL_LABELS: Record<string, string> = {
  airbnb: 'Airbnb',
  vrbo: 'Vrbo',
  'booking.com': 'Booking.com',
  booking_site: 'Direct',
  agoda: 'Agoda',
  expedia: 'Expedia',
  'trip.com': 'Trip.com',
};

export function channelLabel(channel: string): string {
  return CHANNEL_LABELS[channel] ?? channel.charAt(0).toUpperCase() + channel.slice(1);
}
