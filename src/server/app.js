import { Hono } from 'hono';

export function createApp({ fetchUpstream, fetchMessage, ttlMs = 60_000, now = Date.now }) {
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

  registerCachedRoute(app, {
    path: '/api/ical',
    fetcher: fetchUpstream,
    contentType: 'text/calendar; charset=utf-8',
    onMissAndError: (c) => c.text('Upstream unreachable', 502),
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
      ttlMs,
      now,
    });
  }

  return app;
}

function registerCachedRoute(app, { path, fetcher, contentType, onMissAndError, ttlMs, now }) {
  let cache = null;
  app.get(path, async (c) => {
    const t = now();
    if (cache && t - cache.fetchedAt < ttlMs) {
      return c.body(cache.body, 200, { 'content-type': contentType });
    }
    try {
      const body = await fetcher();
      cache = { body, fetchedAt: t };
      return c.body(body, 200, { 'content-type': contentType });
    } catch {
      if (cache) return c.body(cache.body, 200, { 'content-type': contentType });
      return onMissAndError(c);
    }
  });
}
