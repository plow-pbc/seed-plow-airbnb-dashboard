import { describe, it, expect } from 'vitest';
import { isFresh } from './message';

describe('isFresh', () => {
  const now = new Date('2026-05-18T08:00:00Z');

  it('returns false for null', () => {
    expect(isFresh(null, now)).toBe(false);
  });

  it('returns true when expires_at is null (no expiry)', () => {
    expect(isFresh({ text: 'hi', expires_at: null }, now)).toBe(true);
  });

  it('returns true when expires_at is in the future', () => {
    expect(isFresh({ text: 'hi', expires_at: '2026-05-18T12:00:00Z' }, now)).toBe(true);
  });

  it('returns false when expires_at is in the past', () => {
    expect(isFresh({ text: 'hi', expires_at: '2026-05-18T07:30:00Z' }, now)).toBe(false);
  });

  it('returns false when expires_at equals now (boundary)', () => {
    expect(isFresh({ text: 'hi', expires_at: '2026-05-18T08:00:00Z' }, now)).toBe(false);
  });
});
