import type { Event } from '../types';
import { EventRow } from '../components/EventRow';

// The ICS event-list view: the next N upcoming events. Parsing stays in
// App.tsx (it needs the build-time NEXT_N); this just renders the result.

export function CalendarView({ events }: { events: Event[] }) {
  if (events.length === 0) {
    return <p className="empty-state">No upcoming events.</p>;
  }
  return (
    <ul className="event-list">
      {events.map((event) => (
        <EventRow key={event.uid} event={event} />
      ))}
    </ul>
  );
}
