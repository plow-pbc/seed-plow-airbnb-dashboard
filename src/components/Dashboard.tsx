import { useEffect, useRef, useState } from 'react';
import type { DashboardConfig } from '../config';
import { gridDimensions, panelsPerPage, paginate, type Size } from '../layout';
import type { ViewDef } from '../views/registry';

type Props = {
  views: ViewDef[];
  config: DashboardConfig;
};

// Largest minSize across the views — the cell the fitter must satisfy so
// every view on a page has room.
function cellMinSize(views: ViewDef[]): Size {
  return {
    width: Math.max(1, ...views.map((v) => v.minSize.width)),
    height: Math.max(1, ...views.map((v) => v.minSize.height)),
  };
}

// Tiles the enabled views into an auto-fitted grid, pushes whatever doesn't
// fit onto tabbed overflow pages, and optionally auto-rotates through them.
export function Dashboard({ views, config }: Props) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [activePage, setActivePage] = useState(0);

  // Measure the grid area and follow resizes — a rotation toggle or a
  // different kiosk screen changes it, and the fit must track it.
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ width: r.width, height: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Enabled views, in registry order. Fall back to all views if a hand-edited
  // config somehow disabled every one (the settings UI won't).
  const enabled = views.filter((v) => !config.disabledViewIds.includes(v.id));
  const shown = enabled.length > 0 ? enabled : views;

  // Before the first measurement, keep everything on one page so the tab bar
  // doesn't flash in and out as the real size arrives.
  const perPage =
    size.width > 0
      ? panelsPerPage(size, cellMinSize(shown), config.density, shown.length)
      : shown.length;
  const pages = paginate(shown, perPage);

  // Keep activePage in range when the page count shrinks (resize, density
  // change, a view disabled).
  useEffect(() => {
    setActivePage((p) => (p < pages.length ? p : 0));
  }, [pages.length]);

  // Auto-rotate through pages. Re-armed whenever activePage changes — a manual
  // tab tap included — so a tap always buys a full interval on that page.
  useEffect(() => {
    if (!config.autoRotate || pages.length < 2) return;
    const timer = setInterval(
      () => setActivePage((p) => (p + 1) % pages.length),
      config.rotateSeconds * 1000,
    );
    return () => clearInterval(timer);
  }, [config.autoRotate, config.rotateSeconds, pages.length, activePage]);

  const pageIndex = Math.min(activePage, Math.max(0, pages.length - 1));
  const pageViews = pages[pageIndex] ?? [];
  const grid = gridDimensions(pageViews.length, size);
  // A per-panel title only earns its space when a page holds more than one.
  const framed = pageViews.length > 1;

  return (
    <div className="dashboard">
      <div
        ref={gridRef}
        className="dashboard-grid"
        style={{
          gridTemplateColumns: `repeat(${grid.cols}, 1fr)`,
          gridTemplateRows: `repeat(${grid.rows}, 1fr)`,
        }}
      >
        {pageViews.map((view) => (
          <section key={view.id} className={'panel' + (framed ? ' framed' : '')}>
            {framed && <div className="panel-title">{view.title}</div>}
            <div className="panel-body">{view.render()}</div>
          </section>
        ))}
      </div>

      {pages.length > 1 && (
        <nav className="tabbar" aria-label="Dashboard pages">
          {pages.map((page, i) => (
            <button
              key={i}
              type="button"
              className={'tab' + (i === pageIndex ? ' active' : '')}
              onClick={() => setActivePage(i)}
            >
              {page.map((v) => v.title).join(' + ')}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
