import { describe, it, expect } from 'vitest';
import { isFresh, pickLatest, type Message } from './message';

const NOW = new Date('2026-05-18T08:00:00Z');

function msg(overrides: Partial<Message> = {}): Message {
  return {
    type: 'affirmation',
    text: 'hi',
    expires_at: null,
    ...overrides,
  };
}

describe('isFresh', () => {
  it('returns false for null', () => {
    expect(isFresh(null, NOW)).toBe(false);
  });

  it('returns true when expires_at is null (no expiry)', () => {
    expect(isFresh(msg({ expires_at: null }), NOW)).toBe(true);
  });

  it('returns true when expires_at is in the future', () => {
    expect(isFresh(msg({ expires_at: '2026-05-18T12:00:00Z' }), NOW)).toBe(true);
  });

  it('returns false when expires_at is in the past', () => {
    expect(isFresh(msg({ expires_at: '2026-05-18T07:30:00Z' }), NOW)).toBe(false);
  });

  it('returns false when expires_at equals now (boundary)', () => {
    expect(isFresh(msg({ expires_at: '2026-05-18T08:00:00Z' }), NOW)).toBe(false);
  });
});

describe('pickLatest', () => {
  it('returns null for an empty list', () => {
    expect(pickLatest([], {}, NOW)).toBeNull();
  });

  it('returns the first message when newest is fresh, no filter', () => {
    const newest = msg({ text: 'new' });
    const older = msg({ text: 'old' });
    expect(pickLatest([newest, older], {}, NOW)).toBe(newest);
  });

  it('skips expired messages and returns the next fresh one', () => {
    const expired = msg({ text: 'gone', expires_at: '2026-05-18T07:30:00Z' });
    const fresh = msg({ text: 'still here' });
    expect(pickLatest([expired, fresh], {}, NOW)).toBe(fresh);
  });

  it('filters by type when provided', () => {
    const alert = msg({ type: 'alert', text: 'a' });
    const affirmation = msg({ type: 'affirmation', text: 'b' });
    expect(pickLatest([alert, affirmation], { type: 'affirmation' }, NOW)).toBe(affirmation);
  });

  it('returns null when type filter excludes everything', () => {
    const alert = msg({ type: 'alert' });
    expect(pickLatest([alert], { type: 'affirmation' }, NOW)).toBeNull();
  });

  it('returns null when only matching-type messages are expired', () => {
    const expiredAffirmation = msg({ type: 'affirmation', expires_at: '2026-05-18T07:00:00Z' });
    const freshAlert = msg({ type: 'alert' });
    expect(pickLatest([expiredAffirmation, freshAlert], { type: 'affirmation' }, NOW)).toBeNull();
  });

  it('returns an older fresh message when the newest of the same type has expired', () => {
    const newerExpired = msg({
      type: 'affirmation',
      text: 'newer-gone',
      expires_at: '2026-05-18T07:55:00Z',
    });
    const olderFresh = msg({
      type: 'affirmation',
      text: 'older-still',
      expires_at: null,
    });
    expect(pickLatest([newerExpired, olderFresh], { type: 'affirmation' }, NOW)).toBe(olderFresh);
  });
});
