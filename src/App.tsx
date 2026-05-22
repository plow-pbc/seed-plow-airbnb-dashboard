import { useEffect, useMemo, useState } from 'react';
import { parseICS } from './ical';
import type { HostexHome } from './types';
import { Message } from './components/Message';
import { Dashboard } from './components/Dashboard';
import { SettingsPanel } from './components/SettingsPanel';
import { buildViews, type CalendarSource } from './views/registry';
import { isFresh, type Message as MessageType } from './message';
import { loadRotation, saveRotation, nextRotation } from './rotation';
import { loadConfig, saveConfig } from './config';

const NEXT_N = Number(__NEXT_N__);
const REFRESH_MS = Number(__REFRESH_MS__);

const timeFmt = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
});

// The /api/calendar envelope — one entry per configured source (ICAL_URL
// and/or HOSTEX_ACCESS_TOKEN), each tagged with its `source`. `error` marks a
// source that failed to load this cycle.
type RawSource =
  | { source: 'ical'; ics: string }
  | { source: 'hostex'; homes: HostexHome[] }
  | { source: 'ical' | 'hostex'; error: true };
type CalendarResponse = { sources: RawSource[] };

type State =
  | { kind: 'loading' }
  | { kind: 'loaded'; sources: CalendarSource[]; fetchedAt: Date }
  | { kind: 'error' };

export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [message, setMessage] = useState<MessageType | null>(null);
  const [rotation, setRotation] = useState(loadRotation);
  const [config, setConfig] = useState(loadConfig);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Apply and persist the kiosk rotation. index.html re-applies it before
  // first paint so the periodic reload doesn't flash the default orientation.
  useEffect(() => {
    document.documentElement.dataset.rotation = String(rotation);
    saveRotation(rotation);
  }, [rotation]);

  // Persist layout config — every screen keeps its own in localStorage.
  useEffect(() => {
    saveConfig(config);
  }, [config]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/calendar');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as CalendarResponse;
        if (cancelled) return;
        const now = new Date();
        const sources: CalendarSource[] = body.sources.map((s) => {
          if ('error' in s) return { source: s.source, error: true };
          if (s.source === 'ical') return { source: 'ical', events: parseICS(s.ics, now, NEXT_N) };
          return { source: 'hostex', homes: s.homes };
        });
        setState({ kind: 'loaded', sources, fetchedAt: now });
      } catch {
        if (!cancelled) setState({ kind: 'error' });
      }
    })();

    (async () => {
      try {
        const res = await fetch('/api/message?type=affirmation');
        if (!res.ok) return;
        const body = (await res.json()) as { message: MessageType | null };
        if (!cancelled) setMessage(body.message);
      } catch {
        // Non-critical: leave message null on failure.
      }
    })();

    const reloadTimer = setTimeout(() => location.reload(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearTimeout(reloadTimer);
    };
  }, []);

  // Hide the message the moment expires_at passes so we don't show stale text
  // until the next REFRESH_MS reload. No-op when expires_at is null.
  useEffect(() => {
    if (!message?.expires_at) return;
    const delay = new Date(message.expires_at).getTime() - Date.now();
    if (delay <= 0) return;
    const timer = setTimeout(() => setMessage(null), delay);
    return () => clearTimeout(timer);
  }, [message]);

  const fetchedAt = state.kind === 'loaded' ? state.fetchedAt : null;
  const showMessage = isFresh(message, new Date());

  // The loaded calendar sources drive the view registry; empty while loading
  // or on total failure, when only the data-free clock is available.
  const sources = useMemo<CalendarSource[]>(
    () => (state.kind === 'loaded' ? state.sources : []),
    [state],
  );
  const views = useMemo(() => buildViews(sources), [sources]);

  return (
    <main className="app">
      {showMessage && message && <Message message={message} />}
      <header className="header">
        <h1>Plow Airbnb Dashboard</h1>
        <div className="header-right">
          {fetchedAt && <span className="as-of">as of {timeFmt.format(fetchedAt)}</span>}
          <button
            type="button"
            className="icon-btn"
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
            title="Settings"
          >
            ⚙
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setRotation(nextRotation)}
            aria-label="Rotate display"
            title="Rotate display"
          >
            ⟳ {rotation}°
          </button>
        </div>
      </header>
      {state.kind === 'error' && (
        <p className="error-banner">Can't reach calendar — retrying soon.</p>
      )}
      <Dashboard views={views} config={config} />
      {settingsOpen && (
        <SettingsPanel
          views={views}
          config={config}
          onChange={setConfig}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </main>
  );
}
