import { describe, it, expect } from 'vitest';
import { buildViews, type CalendarSource } from './registry';

describe('buildViews', () => {
  it('shows only the clock when no calendar sources are configured', () => {
    expect(buildViews([]).map((v) => v.id)).toEqual(['clock']);
  });

  it('adds a calendar panel for an ICS source', () => {
    const sources: CalendarSource[] = [{ source: 'ical', events: [] }];
    expect(buildViews(sources).map((v) => v.id)).toEqual(['calendar', 'clock']);
  });

  it('adds a reservations panel for a Hostex source', () => {
    const sources: CalendarSource[] = [{ source: 'hostex', homes: [] }];
    expect(buildViews(sources).map((v) => v.id)).toEqual(['reservations', 'clock']);
  });

  it('shows both calendar panels when both sources are configured', () => {
    const sources: CalendarSource[] = [
      { source: 'ical', events: [] },
      { source: 'hostex', homes: [] },
    ];
    expect(buildViews(sources).map((v) => v.id)).toEqual(['calendar', 'reservations', 'clock']);
  });

  it('still shows the panel for a source that failed to load', () => {
    const views = buildViews([{ source: 'hostex', error: true }]);
    // Same stable id/title as a healthy Hostex source, so settings toggles and
    // grid placement survive the error cycle.
    expect(views.map((v) => v.id)).toEqual(['reservations', 'clock']);
    expect(views[0].title).toBe('Reservations');
  });
});
