import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './src/server/app.js';
import { fetchHostexCalendar } from './src/server/hostex.js';

// Calendar source: exactly one of HOSTEX_ACCESS_TOKEN or ICAL_URL. When both
// are set the Hostex token wins. Either way fetchCalendar resolves to a JSON
// envelope tagged with `source` so the client knows which view to render.
const ICAL_URL = process.env.ICAL_URL;
const HOSTEX_ACCESS_TOKEN = process.env.HOSTEX_ACCESS_TOKEN;

let fetchCalendar;
if (HOSTEX_ACCESS_TOKEN) {
  console.log('Calendar source: Hostex API');
  fetchCalendar = async () => {
    const data = await fetchHostexCalendar(HOSTEX_ACCESS_TOKEN, new Date());
    return JSON.stringify({ source: 'hostex', ...data });
  };
} else if (ICAL_URL) {
  console.log('Calendar source: ICS URL');
  fetchCalendar = async () => {
    const res = await fetch(ICAL_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Upstream returned HTTP ${res.status}`);
    return JSON.stringify({ source: 'ical', ics: await res.text() });
  };
} else {
  console.error('FATAL: set HOSTEX_ACCESS_TOKEN or ICAL_URL in .env');
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
