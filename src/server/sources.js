// Builds the calendar-source registration list from process env. Lives in its
// own module (rather than inline in server.js) so the env-driven gating is
// unit-testable without standing up an HTTP server.
//
// Each element is { kind, fetch }: `kind` is the discriminator and `fetch`
// is a thunk that returns the wire envelope the client decodes. Failures
// inside the thunk are caught and re-tagged by the caller in server.js — the
// thunk itself just throws.

import { fetchHostexCalendar } from './hostex.js';
import { fetchGuestyCalendar } from './guesty.js';

const ICAL_TIMEOUT_MS = 10_000;

export function buildSources(env) {
  const sources = [];

  if (env.ICAL_URL) {
    const url = env.ICAL_URL;
    sources.push({
      kind: 'ical',
      fetch: async () => {
        const res = await fetch(url, { signal: AbortSignal.timeout(ICAL_TIMEOUT_MS) });
        if (!res.ok) throw new Error(`ICS upstream returned HTTP ${res.status}`);
        return { source: 'ical', ics: await res.text() };
      },
    });
  }

  if (env.HOSTEX_ACCESS_TOKEN) {
    const token = env.HOSTEX_ACCESS_TOKEN;
    sources.push({
      kind: 'hostex',
      fetch: async () => {
        const data = await fetchHostexCalendar(token, new Date());
        return { source: 'hostex', ...data };
      },
    });
  }

  if (env.GUESTY_CLIENT_ID && env.GUESTY_CLIENT_SECRET) {
    const clientId = env.GUESTY_CLIENT_ID;
    const clientSecret = env.GUESTY_CLIENT_SECRET;
    // Trim a single trailing slash so `https://example.com/` doesn't produce
    // `https://example.com//v1/listings` once the fetcher concatenates paths.
    // Pass `undefined` (not a duplicated default string) when no override is
    // set, so the fetcher's own DEFAULT_BASE_URL stays the single source of
    // truth — destructuring `{ baseUrl = DEFAULT_BASE_URL }` applies the
    // default exactly when `baseUrl` is undefined.
    const baseUrl = env.GUESTY_API_BASE ? env.GUESTY_API_BASE.replace(/\/$/, '') : undefined;
    sources.push({
      kind: 'guesty',
      fetch: async () => {
        const data = await fetchGuestyCalendar(
          { clientId, clientSecret, baseUrl },
          new Date(),
        );
        return { source: 'guesty', ...data };
      },
    });
  }

  return sources;
}
