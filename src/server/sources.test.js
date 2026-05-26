import { describe, it, expect } from 'vitest';
import { buildSources } from './sources.js';

// Source registration is env-driven; these tests pin the gating without
// booting the HTTP server, so a future env-handling refactor can't silently
// drop a source.

describe('buildSources', () => {
  it('registers an ical source when ICAL_URL is set', () => {
    const kinds = buildSources({ ICAL_URL: 'http://example.com/cal.ics' }).map((s) => s.kind);
    expect(kinds).toEqual(['ical']);
  });

  it('registers a hostex source when HOSTEX_ACCESS_TOKEN is set', () => {
    const kinds = buildSources({ HOSTEX_ACCESS_TOKEN: 'tok' }).map((s) => s.kind);
    expect(kinds).toEqual(['hostex']);
  });

  it('registers a guesty source when both GUESTY_CLIENT_ID and GUESTY_CLIENT_SECRET are set', () => {
    const kinds = buildSources({
      GUESTY_CLIENT_ID: 'cid',
      GUESTY_CLIENT_SECRET: 'csec',
    }).map((s) => s.kind);
    expect(kinds).toEqual(['guesty']);
  });

  it('does NOT register a guesty source when only GUESTY_CLIENT_ID is set', () => {
    const kinds = buildSources({ GUESTY_CLIENT_ID: 'cid' }).map((s) => s.kind);
    expect(kinds).toEqual([]);
  });

  it('does NOT register a guesty source when only GUESTY_CLIENT_SECRET is set', () => {
    const kinds = buildSources({ GUESTY_CLIENT_SECRET: 'csec' }).map((s) => s.kind);
    expect(kinds).toEqual([]);
  });

  it('returns an empty array when no credentials are set', () => {
    expect(buildSources({})).toEqual([]);
  });

  it('registers all three sources when all credentials are set, in ICAL → Hostex → Guesty order', () => {
    const kinds = buildSources({
      ICAL_URL: 'http://example.com/cal.ics',
      HOSTEX_ACCESS_TOKEN: 'tok',
      GUESTY_CLIENT_ID: 'cid',
      GUESTY_CLIENT_SECRET: 'csec',
    }).map((s) => s.kind);
    expect(kinds).toEqual(['ical', 'hostex', 'guesty']);
  });

  it('treats empty-string env values as unset (does not register the source)', () => {
    // `--env-file=.env` leaves an unset KEY= as an empty string, which is
    // falsy — the gating MUST treat that identically to a fully unset var so
    // the .env.example placeholders don't accidentally register dead sources.
    expect(buildSources({ ICAL_URL: '', HOSTEX_ACCESS_TOKEN: '' })).toEqual([]);
    expect(
      buildSources({ GUESTY_CLIENT_ID: 'cid', GUESTY_CLIENT_SECRET: '' }).map((s) => s.kind),
    ).toEqual([]);
  });
});
