import { describe, it, expect } from 'vitest';
import {
  dayList,
  ymd,
  placeReservation,
  reservationPhase,
  coversNight,
  channelLabel,
} from './hostex';

// 14-day window: May 20 .. Jun 2, 2026.
const days = dayList(new Date(2026, 4, 20), 14);

describe('dayList', () => {
  it('returns consecutive days from the start', () => {
    expect(days).toHaveLength(14);
    expect(days[0]).toEqual(new Date(2026, 4, 20));
    expect(days[13]).toEqual(new Date(2026, 5, 2));
  });
});

describe('ymd', () => {
  it('formats a local date as YYYY-MM-DD', () => {
    expect(ymd(new Date(2026, 4, 20))).toBe('2026-05-20');
    expect(ymd(new Date(2026, 11, 2))).toBe('2026-12-02');
  });
});

describe('placeReservation', () => {
  it('places a stay fully inside the window', () => {
    // May 23 → May 29: 6 nights (May 23–28), starting at column 3.
    expect(placeReservation({ check_in: '2026-05-23', check_out: '2026-05-29' }, days)).toEqual({
      startCol: 3,
      span: 6,
      clipLeft: false,
      clipRight: false,
    });
  });

  it('clips a stay that began before the window', () => {
    // May 18 → May 23: nights May 18–22, only 20–22 visible.
    expect(placeReservation({ check_in: '2026-05-18', check_out: '2026-05-23' }, days)).toEqual({
      startCol: 0,
      span: 3,
      clipLeft: true,
      clipRight: false,
    });
  });

  it('clips a stay that runs past the window', () => {
    // May 30 → Jun 10: nights May 30 .. Jun 9, visible May 30 .. Jun 2.
    expect(placeReservation({ check_in: '2026-05-30', check_out: '2026-06-10' }, days)).toEqual({
      startCol: 10,
      span: 4,
      clipLeft: false,
      clipRight: true,
    });
  });

  it('returns null for a stay entirely outside the window', () => {
    expect(placeReservation({ check_in: '2026-08-01', check_out: '2026-08-05' }, days)).toBeNull();
  });
});

describe('reservationPhase', () => {
  const today = new Date(2026, 4, 20);

  it('classifies a stay in progress as current', () => {
    expect(reservationPhase({ check_in: '2026-05-18', check_out: '2026-05-23' }, today)).toBe(
      'current',
    );
  });

  it('classifies a future stay as upcoming', () => {
    expect(reservationPhase({ check_in: '2026-05-23', check_out: '2026-05-29' }, today)).toBe(
      'upcoming',
    );
  });

  it('classifies a finished stay as past, including its checkout day', () => {
    expect(reservationPhase({ check_in: '2026-05-01', check_out: '2026-05-10' }, today)).toBe(
      'past',
    );
    expect(reservationPhase({ check_in: '2026-05-15', check_out: '2026-05-20' }, today)).toBe(
      'past',
    );
  });
});

describe('coversNight', () => {
  const r = { check_in: '2026-05-23', check_out: '2026-05-29' };

  it('covers the check-in night but not the checkout day', () => {
    expect(coversNight(r, new Date(2026, 4, 23))).toBe(true);
    expect(coversNight(r, new Date(2026, 4, 28))).toBe(true);
    expect(coversNight(r, new Date(2026, 4, 29))).toBe(false);
  });

  it('does not cover a night before check-in', () => {
    expect(coversNight(r, new Date(2026, 4, 22))).toBe(false);
  });
});

describe('channelLabel', () => {
  it('maps known channels', () => {
    expect(channelLabel('airbnb')).toBe('Airbnb');
    expect(channelLabel('vrbo')).toBe('Vrbo');
    expect(channelLabel('booking_site')).toBe('Direct');
  });

  it('capitalizes unknown channels', () => {
    expect(channelLabel('houfy')).toBe('Houfy');
  });
});
