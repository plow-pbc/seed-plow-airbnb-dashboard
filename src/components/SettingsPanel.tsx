import type { DashboardConfig, Density } from '../config';
import { MAX_ROTATE_SECONDS, MIN_ROTATE_SECONDS } from '../config';
import type { ViewDef } from '../views/registry';

type Props = {
  views: ViewDef[];
  config: DashboardConfig;
  onChange: (next: DashboardConfig) => void;
  onClose: () => void;
};

const ROTATE_STEP = 1; // seconds per +/- tap

// The ⚙ overlay. Every control writes straight through onChange; App persists
// the result to localStorage. Controls are all taps — no keyboard needed on a
// kiosk screen.
export function SettingsPanel({ views, config, onChange, onClose }: Props) {
  const enabledCount = views.filter((v) => !config.disabledViewIds.includes(v.id)).length;
  // Numeric density caps at the number of enabled views — pinning more panels
  // than there are views to fill them would just leave empty cells.
  const densities: Density[] = ['auto', ...Array.from({ length: enabledCount }, (_, i) => i + 1)];

  const toggleView = (id: string) => {
    const disabled = config.disabledViewIds.includes(id);
    // Refuse to turn off the last enabled view — an empty dashboard is useless.
    if (!disabled && enabledCount <= 1) return;
    onChange({
      ...config,
      disabledViewIds: disabled
        ? config.disabledViewIds.filter((v) => v !== id)
        : [...config.disabledViewIds, id],
    });
  };

  const stepRotate = (delta: number) => {
    const next = Math.min(
      MAX_ROTATE_SECONDS,
      Math.max(MIN_ROTATE_SECONDS, config.rotateSeconds + delta),
    );
    onChange({ ...config, rotateSeconds: next });
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className="settings-panel"
        role="dialog"
        aria-label="Dashboard settings"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-head">
          <h2>Settings</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close settings">
            ×
          </button>
        </div>

        <section className="settings-section">
          <h3>Views</h3>
          <div className="settings-row">
            {views.map((view) => {
              const on = !config.disabledViewIds.includes(view.id);
              return (
                <button
                  key={view.id}
                  type="button"
                  className={'chip' + (on ? ' on' : '')}
                  onClick={() => toggleView(view.id)}
                >
                  {on ? '☑' : '☐'} {view.title}
                </button>
              );
            })}
          </div>
        </section>

        <section className="settings-section">
          <h3>Panels per page</h3>
          <div className="settings-row">
            {densities.map((d) => (
              <button
                key={String(d)}
                type="button"
                className={'chip' + (config.density === d ? ' on' : '')}
                onClick={() => onChange({ ...config, density: d })}
              >
                {d === 'auto' ? 'Auto' : d}
              </button>
            ))}
          </div>
          <p className="settings-hint">Auto fits as many as the screen allows.</p>
        </section>

        <section className="settings-section">
          <h3>Auto-rotate</h3>
          <div className="settings-row">
            <button
              type="button"
              className={'chip' + (config.autoRotate ? ' on' : '')}
              onClick={() => onChange({ ...config, autoRotate: !config.autoRotate })}
            >
              {config.autoRotate ? '☑' : '☐'} Cycle pages
            </button>
            <div className={'stepper' + (config.autoRotate ? '' : ' disabled')}>
              <button
                type="button"
                onClick={() => stepRotate(-ROTATE_STEP)}
                disabled={!config.autoRotate}
                aria-label="Less time per page"
              >
                −
              </button>
              <span>{config.rotateSeconds}s</span>
              <button
                type="button"
                onClick={() => stepRotate(ROTATE_STEP)}
                disabled={!config.autoRotate}
                aria-label="More time per page"
              >
                +
              </button>
            </div>
          </div>
          <p className="settings-hint">Cycles through tab pages when more than one exists.</p>
        </section>
      </div>
    </div>
  );
}
