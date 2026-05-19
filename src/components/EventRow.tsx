import type { Event } from '../types';
import { formatWhen } from '../formatWhen';

type Props = { event: Event };

export function EventRow({ event }: Props) {
  return (
    <li className="event-row">
      <div className="event-when">{formatWhen(event.start, event.end, event.isAllDay)}</div>
      <div className="event-title">{event.title}</div>
      {event.location && <div className="event-location">{event.location}</div>}
    </li>
  );
}
