import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './src/server/app.js';
import { buildSources } from './src/server/sources.js';

// Calendar sources: ICAL_URL, HOSTEX_ACCESS_TOKEN, and/or a Guesty
// (GUESTY_CLIENT_ID + GUESTY_CLIENT_SECRET) pair. Any combination may be
// set — each configured source becomes its own dashboard panel.
// /api/calendar resolves to { sources: [...] }, one entry per source, each
// tagged with its `source` so the client knows which view to render.
const sources = buildSources(process.env);
if (sources.length === 0) {
  console.error(
    'FATAL: set at least one of: ICAL_URL; HOSTEX_ACCESS_TOKEN; or both GUESTY_CLIENT_ID and GUESTY_CLIENT_SECRET',
  );
  process.exit(1);
}
console.log(`Calendar sources: ${sources.map((s) => s.kind).join(', ')}`);

// Fetch every source independently — one failing source must not blank out a
// working one; its entry is tagged `error` and the client shows a retry
// notice in that panel. Throw only when they all fail, so the cached route
// can still fall back to the last good payload.
const fetchCalendar = async () => {
  const results = await Promise.all(
    sources.map(async (s) => {
      try {
        return await s.fetch();
      } catch (err) {
        console.error(`Calendar source "${s.kind}" failed — ${err.message}`);
        return { source: s.kind, error: true };
      }
    }),
  );
  if (results.every((r) => r.error)) {
    throw new Error('all calendar sources unreachable');
  }
  return JSON.stringify({ sources: results });
};

const MESSAGE_API_URL = process.env.MESSAGE_API_URL;
const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN;
const messagesEnabled = Boolean(MESSAGE_API_URL && DASHBOARD_TOKEN);
if (!messagesEnabled) {
  console.warn('Messages disabled (set MESSAGE_API_URL + DASHBOARD_TOKEN to enable).');
}

const PORT = Number(process.env.PORT) || 5174;

const app = createApp({
  fetchCalendar,
  fetchMessage: messagesEnabled
    ? async (qs = '') => {
        const res = await fetch(`${MESSAGE_API_URL}${qs}`, {
          headers: { Authorization: `Bearer ${DASHBOARD_TOKEN}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`Message API returned HTTP ${res.status}`);
        return await res.text();
      }
    : undefined,
});

// SPA static + fallback. Order matters: API routes registered first inside createApp.
app.use('/*', serveStatic({ root: './dist' }));
app.get('*', serveStatic({ path: './dist/index.html' }));

serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, (info) => {
  console.log(`plow-airbnb-dashboard listening on http://localhost:${info.port}`);
});
