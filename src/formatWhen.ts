const dateFmt = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

const timeFmt = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
});

export function formatWhen(start: Date, end: Date, isAllDay: boolean): string {
  const datePart = dateFmt.format(start);
  if (isAllDay) {
    // ICS DTEND for DATE values is exclusive — last visible day is end - 1.
    // Use local-date arithmetic (not ms math) so a DST spring-forward inside
    // the range doesn't shift the last calendar day by one.
    const lastDay = new Date(end);
    lastDay.setDate(lastDay.getDate() - 1);
    if (lastDay.toDateString() === start.toDateString()) return `${datePart} · all day`;
    return `${datePart} – ${dateFmt.format(lastDay)} · all day`;
  }
  return `${datePart} · ${timeFmt.format(start)}`;
}
