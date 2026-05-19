import { useEffect, useState } from 'react';
import { parseICS } from './ical';
import type { Event } from './types';
import { EventRow } from './components/EventRow';
import { Message } from './components/Message';
import { isFresh, type Message as MessageType } from './message';

const NEXT_N = Number(__NEXT_N__);
const REFRESH_MS = Number(__REFRESH_MS__);

const timeFmt = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
});

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; events: Event[]; fetchedAt: Date }
  | { kind: 'error' };

export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [message, setMessage] = useState<MessageType | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/ical');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const events = parseICS(text, new Date(), NEXT_N);
        if (!cancelled) setState({ kind: 'ready', events, fetchedAt: new Date() });
      } catch {
        if (!cancelled) setState({ kind: 'error' });
      }
    })();

    (async () => {
      try {
        const res = await fetch('/api/message');
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

  const fetchedAt = state.kind === 'ready' ? state.fetchedAt : null;
  const showMessage = isFresh(message, new Date());

  return (
    <main className="app">
      {showMessage && message && <Message message={message} />}
      <header className="header">
        <h1>Family Calendar</h1>
        {fetchedAt && <span className="as-of">as of {timeFmt.format(fetchedAt)}</span>}
      </header>
      {state.kind === 'error' && (
        <p className="error-state">Can't reach calendar — retrying soon.</p>
      )}
      {state.kind === 'ready' &&
        (state.events.length === 0 ? (
          <p className="empty-state">No upcoming events.</p>
        ) : (
          <ul className="event-list">
            {state.events.map((event) => (
              <EventRow key={event.uid} event={event} />
            ))}
          </ul>
        ))}
    </main>
  );
}
