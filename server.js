import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './src/server/app.js';

const ICAL_URL = process.env.ICAL_URL;
if (!ICAL_URL) {
  console.error('FATAL: ICAL_URL is required (set it in .env)');
  process.exit(1);
}

const MESSAGE_API_URL = process.env.MESSAGE_API_URL;
const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN;
const messagesEnabled = Boolean(MESSAGE_API_URL && DASHBOARD_TOKEN);
if (!messagesEnabled) {
  console.warn('Messages disabled (set MESSAGE_API_URL + DASHBOARD_TOKEN to enable).');
}

const PORT = Number(process.env.PORT) || 5174;

const app = createApp({
  fetchUpstream: async () => {
    const res = await fetch(ICAL_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Upstream returned HTTP ${res.status}`);
    return await res.text();
  },
  fetchMessage: messagesEnabled
    ? async () => {
        const res = await fetch(MESSAGE_API_URL, {
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
  console.log(`family-dashboard listening on http://localhost:${info.port}`);
});
