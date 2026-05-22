import { useEffect, useState } from 'react';

// A data-free view: a large wall clock and date. Always available, so the
// dashboard has something to show before the calendar loads and something
// for auto-rotate to cycle to. Ticks itself — independent of the page reload.

const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});

export function ClockView() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(tick);
  }, []);

  return (
    <div className="clock-view">
      <div className="clock-time">{timeFmt.format(now)}</div>
      <div className="clock-date">{dateFmt.format(now)}</div>
    </div>
  );
}
