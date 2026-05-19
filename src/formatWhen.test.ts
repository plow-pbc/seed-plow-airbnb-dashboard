import { describe, it, expect } from 'vitest';
import { formatWhen } from './formatWhen';

describe('formatWhen', () => {
  it('formats a single-day all-day event with weekday, month, day, and "all day"', () => {
    // Local time, no Z — interpreted in the host timezone.
    const start = new Date(2026, 4, 23); // May 23 2026 (month is 0-indexed)
    const end = new Date(2026, 4, 24); // exclusive — same calendar day
    expect(formatWhen(start, end, true)).toBe('Sat, May 23 · all day');
  });

  it('formats a multi-day all-day event as a date range (inclusive last day)', () => {
    // "Family vacation Jun 1–7" — DTEND is exclusive (Jun 8), so last visible day is Jun 7.
    const start = new Date(2026, 5, 1); // Mon Jun 1 2026
    const end = new Date(2026, 5, 8); // exclusive — last day is Jun 7
    expect(formatWhen(start, end, true)).toBe('Mon, Jun 1 – Sun, Jun 7 · all day');
  });

  it('handles all-day ranges that cross a DST boundary', () => {
    // US spring-forward 2026 is Sun Mar 8 02:00 → 03:00. A trip Mar 7–8 has
    // DTSTART Mar 7, DTEND Mar 9 (exclusive). The last visible day must be Mar 8.
    // A naive end - 86_400_000 ms would land at Mar 7 23:00 EST and format as Mar 7.
    const start = new Date(2026, 2, 7); // Sat Mar 7 2026
    const end = new Date(2026, 2, 9); // exclusive — last day must be Mar 8
    expect(formatWhen(start, end, true)).toBe('Sat, Mar 7 – Sun, Mar 8 · all day');
  });

  it('formats a timed event with weekday, month, day, and time', () => {
    const start = new Date(2026, 4, 23, 15, 0); // May 23 2026, 3:00 PM local
    const end = new Date(2026, 4, 23, 16, 0);
    // Time format depends on locale; assert structure not exact string.
    const result = formatWhen(start, end, false);
    expect(result).toMatch(/^Sat, May 23 · \d{1,2}:\d{2}\s?(AM|PM)$/);
  });

  it('uses two-digit minutes', () => {
    const start = new Date(2026, 4, 23, 9, 5); // 9:05 AM
    const end = new Date(2026, 4, 23, 10, 5);
    expect(formatWhen(start, end, false)).toMatch(/9:05/);
  });
});
