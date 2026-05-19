import { Hono } from 'hono';

export function createApp({ fetchUpstream, ttlMs = 60_000, now = Date.now }) {
  let cache = null; // { body: string, fetchedAt: number }
  const app = new Hono();

  app.get('/healthz', (c) => c.text('ok'));

  // DNS-rebinding guard for /api/ical: even with the loopback bind, a browser
  // tab on this box loading an attacker site that rebinds DNS to 127.0.0.1 would
  // reach us with a non-loopback Host header. Reject those before the proxy runs.
  // (Use the URL hostname, not the raw Host header — Node's Request doesn't
  // auto-populate Host in tests, but @hono/node-server synthesizes the URL from
  // the Host header on the wire, so this reads the same source either way.)
  app.use('/api/*', async (c, next) => {
    const host = new URL(c.req.url).hostname;
    if (host !== 'localhost' && host !== '127.0.0.1') {
      return c.text('forbidden', 403);
    }
    await next();
  });

  const calendarResponse = (c, body) =>
    c.body(body, 200, { 'content-type': 'text/calendar; charset=utf-8' });

  app.get('/api/ical', async (c) => {
    const t = now();

    if (cache && t - cache.fetchedAt < ttlMs) return calendarResponse(c, cache.body);

    try {
      const body = await fetchUpstream();
      cache = { body, fetchedAt: t };
      return calendarResponse(c, body);
    } catch {
      if (cache) return calendarResponse(c, cache.body);
      return c.text('Upstream unreachable', 502);
    }
  });

  return app;
}
