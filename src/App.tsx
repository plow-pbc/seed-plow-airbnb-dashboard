import { useEffect, useState } from 'react';
import { parseICS } from './ical';
import type { Event, HostexHome } from './types';
import { EventRow } from './components/EventRow';
import { HostexTimeline } from './components/HostexTimeline';
import { Message } from './components/Message';
import { isFresh, type Message as MessageType } from './message';
import { loadRotation, saveRotation, nextRotation } from './rotation';

const NEXT_N = Number(__NEXT_N__);
const REFRESH_MS = Number(__REFRESH_MS__);

const timeFmt = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
});

// The /api/calendar envelope — the server tags it with the source it was
// configured for, so the same build renders either view at runtime.
type CalendarResponse = { source: 'ical'; ics: string } | { source: 'hostex'; homes: HostexHome[] };

type State =
  | { kind: 'loading' }
  | { kind: 'ical'; events: Event[]; fetchedAt: Date }
  | { kind: 'hostex'; homes: HostexHome[]; fetchedAt: Date }
  | { kind: 'error' };

export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [message, setMessage] = useState<MessageType | null>(null);
  const [rotation, setRotation] = useState(loadRotation);

  // Apply and persist the kiosk rotation. index.html re-applies it before
  // first paint so the periodic reload doesn't flash the default orientation.
  useEffect(() => {
    document.documentElement.dataset.rotation = String(rotation);
    saveRotation(rotation);
  }, [rotation]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/calendar');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as CalendarResponse;
        if (cancelled) return;
        if (body.source === 'hostex') {
          setState({ kind: 'hostex', homes: body.homes, fetchedAt: new Date() });
        } else {
          const events = parseICS(body.ics, new Date(), NEXT_N);
          setState({ kind: 'ical', events, fetchedAt: new Date() });
        }
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

  const fetchedAt = state.kind === 'ical' || state.kind === 'hostex' ? state.fetchedAt : null;
  const showMessage = isFresh(message, new Date());

  return (
    <main className="app">
      {showMessage && message && <Message message={message} />}
      <header className="header">
        <h1>Plow Airbnb Calendar</h1>
        <div className="header-right">
          {fetchedAt && <span className="as-of">as of {timeFmt.format(fetchedAt)}</span>}
          <button
            type="button"
            className="rotate-btn"
            onClick={() => setRotation(nextRotation)}
            aria-label="Rotate display"
            title="Rotate display"
          >
            ⟳ {rotation}°
          </button>
        </div>
      </header>
      {state.kind === 'error' && (
        <p className="error-state">Can't reach calendar — retrying soon.</p>
      )}
      {state.kind === 'ical' &&
        (state.events.length === 0 ? (
          <p className="empty-state">No upcoming events.</p>
        ) : (
          <ul className="event-list">
            {state.events.map((event) => (
              <EventRow key={event.uid} event={event} />
            ))}
          </ul>
        ))}
      {state.kind === 'hostex' && <HostexTimeline homes={state.homes} />}
    </main>
  );
}
