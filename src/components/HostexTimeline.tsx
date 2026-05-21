import { useState } from 'react';
import type { HostexHome } from '../types';
import {
  dayList,
  ymd,
  placeReservation,
  reservationPhase,
  coversNight,
  channelLabel,
} from '../hostex';

const TIMELINE_DAYS = 14;
const SCROLL_STEP = 7;
const COLS = { gridTemplateColumns: `repeat(${TIMELINE_DAYS}, 1fr)` };

const monthDayFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit' });
const weekdayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short' });

function startOfToday(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

// Homes that are neither reserved nor owner-blocked on `day`.
function vacantCount(homes: HostexHome[], day: Date): number {
  const ds = ymd(day);
  let free = 0;
  for (const home of homes) {
    const reserved = home.reservations.some((r) => coversNight(r, day));
    if (!reserved && !home.blocked.includes(ds)) free++;
  }
  return free;
}

export function HostexTimeline({ homes }: { homes: HostexHome[] }) {
  const [viewStart, setViewStart] = useState(startOfToday);

  if (homes.length === 0) {
    return <p className="empty-state">No homes on this Hostex account.</p>;
  }

  const days = dayList(viewStart, TIMELINE_DAYS);
  const today = startOfToday();

  const shift = (delta: number) =>
    setViewStart((s) => {
      const d = new Date(s);
      d.setDate(s.getDate() + delta);
      return d;
    });

  return (
    <div className="timeline">
      <div className="tl-toolbar">
        <button
          type="button"
          className="tl-nav"
          onClick={() => shift(-SCROLL_STEP)}
          aria-label="Scroll earlier"
        >
          ‹
        </button>
        <button type="button" className="tl-nav" onClick={() => setViewStart(startOfToday)}>
          Today
        </button>
        <button
          type="button"
          className="tl-nav"
          onClick={() => shift(SCROLL_STEP)}
          aria-label="Scroll later"
        >
          ›
        </button>
        <span className="tl-range">
          {monthDayFmt.format(days[0])} – {monthDayFmt.format(days[days.length - 1])}
        </span>
      </div>

      <div className="tl-grid">
        {/* Day-header row */}
        <div className="tl-row tl-headrow">
          <div className="tl-label" />
          <div className="tl-track tl-cells" style={COLS}>
            {days.map((d) => {
              const isToday = d.getTime() === today.getTime();
              const weekend = d.getDay() === 5 || d.getDay() === 6;
              return (
                <div
                  key={d.toISOString()}
                  className={'tl-daycol' + (isToday ? ' today' : '') + (weekend ? ' weekend' : '')}
                >
                  <span className="tl-date">{monthDayFmt.format(d)}</span>
                  <span className="tl-weekday">{isToday ? 'Today' : weekdayFmt.format(d)}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Vacant-homes summary */}
        <div className="tl-row tl-vacrow">
          <div className="tl-label">Vacant</div>
          <div className="tl-track tl-cells" style={COLS}>
            {days.map((d) => (
              <div key={d.toISOString()} className="tl-vac">
                {vacantCount(homes, d)}
              </div>
            ))}
          </div>
        </div>

        {/* One row per home */}
        {homes.map((home) => {
          const blocked = new Set(home.blocked);
          return (
            <div key={home.id} className="tl-row tl-home">
              <div className="tl-label tl-homelabel">
                {home.cover && <img className="tl-thumb" src={home.cover} alt="" />}
                <span className="tl-homename">{home.name}</span>
              </div>
              <div className="tl-track">
                <div className="tl-bg" style={COLS}>
                  {days.map((d) => (
                    <div
                      key={d.toISOString()}
                      className={'tl-cell' + (blocked.has(ymd(d)) ? ' blocked' : '')}
                    />
                  ))}
                </div>
                <div className="tl-bars" style={COLS}>
                  {home.reservations.map((r, i) => {
                    const pos = placeReservation(r, days);
                    if (!pos) return null;
                    const phase = reservationPhase(r, today);
                    return (
                      <div
                        key={`${r.check_in}-${i}`}
                        className={
                          'tl-resv ' +
                          phase +
                          (pos.clipLeft ? ' clip-left' : '') +
                          (pos.clipRight ? ' clip-right' : '')
                        }
                        style={{ gridColumn: `${pos.startCol + 1} / span ${pos.span}` }}
                      >
                        <span className="tl-guest">{r.guest}</span>
                        <span className="tl-meta">
                          {channelLabel(r.channel)} {r.nights} {r.nights === 1 ? 'night' : 'nights'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
