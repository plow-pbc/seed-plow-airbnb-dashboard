import { Hono } from 'hono';

export function createApp({ fetchCalendar, fetchMessage, ttlMs = 60_000, now = Date.now }) {
  const app = new Hono();

  app.get('/healthz', (c) => c.text('ok'));

  // DNS-rebinding guard for /api/*: even with the loopback bind, a browser tab
  // on this box loading an attacker site that rebinds DNS to 127.0.0.1 would
  // reach us with a non-loopback Host header. Reject those before the proxy
  // runs. (Use the URL hostname, not the raw Host header — Node's Request
  // doesn't auto-populate Host in tests, but @hono/node-server synthesizes the
  // URL from the Host header on the wire, so this reads the same source either
  // way.)
  app.use('/api/*', async (c, next) => {
    const host = new URL(c.req.url).hostname;
    if (host !== 'localhost' && host !== '127.0.0.1') {
      return c.text('forbidden', 403);
    }
    await next();
  });

  // Returns a discriminated JSON envelope — { source: 'ical', ics } or
  // { source: 'hostex', listings } — so the client picks its view at runtime
  // without the build needing to know which source this Pi was configured for.
  registerCachedRoute(app, {
    path: '/api/calendar',
    fetcher: fetchCalendar,
    contentType: 'application/json; charset=utf-8',
    onMissAndError: (c) => c.json({ error: 'Upstream unreachable' }, 502),
    ttlMs,
    now,
  });

  if (fetchMessage) {
    registerCachedRoute(app, {
      path: '/api/message',
      fetcher: fetchMessage,
      contentType: 'application/json; charset=utf-8',
      // Fail open: when the message API is unreachable and we have no cache,
      // return an empty envelope so the dashboard keeps rendering the calendar.
      onMissAndError: (c) => c.json({ message: null }),
      // Normalize: only `?type=<value>` matters upstream. Drop any other params
      // so unknown/hostile query strings collapse to the no-filter slot instead
      // of spawning their own cache entry and bearer-authenticated upstream call.
      cacheKey: (url) => {
        const type = url.searchParams.get('type');
        return type ? `?type=${encodeURIComponent(type)}` : '';
      },
      ttlMs,
      now,
    });
  }

  return app;
}

function registerCachedRoute(
  app,
  { path, fetcher, contentType, onMissAndError, ttlMs, now, cacheKey = () => '' },
) {
  // One cache slot per cacheKey(url). Default is single-slot; routes that
  // need to shard upstream by query (like /api/message's ?type=) pass their
  // own cacheKey.
  const cacheByQs = new Map();
  app.get(path, async (c) => {
    const url = new URL(c.req.url);
    const qs = cacheKey(url);
    const t = now();
    const cached = cacheByQs.get(qs);
    if (cached && t - cached.fetchedAt < ttlMs) {
      return c.body(cached.body, 200, { 'content-type': contentType });
    }
    try {
      const body = await fetcher(qs);
      cacheByQs.set(qs, { body, fetchedAt: t });
      return c.body(body, 200, { 'content-type': contentType });
    } catch (err) {
      // Surface upstream failures — otherwise a bad token or unreachable API
      // is invisible behind the generic client-side error message.
      console.error(`${path}: upstream fetch failed — ${err.message}`);
      if (cached) return c.body(cached.body, 200, { 'content-type': contentType });
      return onMissAndError(c);
    }
  });
}
