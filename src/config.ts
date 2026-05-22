// Per-device dashboard configuration: which views to show, how densely to
// tile them, and whether to auto-rotate. Persisted to localStorage so each
// kiosk screen keeps its own layout — a portrait Pi and a wide monitor want
// different settings. Mirrors rotation.ts in shape; both are pure + tested.

export type Density = 'auto' | 1 | 2 | 3;

export type DashboardConfig = {
  // Views explicitly turned off in settings. Storing the *disabled* set (not
  // the enabled one) means a view added in a future build is shown by default
  // rather than silently hidden because it post-dates a saved config.
  disabledViewIds: string[];
  // Panels tiled per page. 'auto' lets the layout fitter choose from the
  // viewport size; a number pins it (and forces overflow into tabs).
  density: Density;
  // Cycle through tab pages on a timer. Off by default — opt-in per screen.
  autoRotate: boolean;
  // Seconds each page is shown when autoRotate is on.
  rotateSeconds: number;
};

const STORAGE_KEY = 'dashboard-config';
const DENSITIES: Density[] = ['auto', 1, 2, 3];
export const MIN_ROTATE_SECONDS = 3;
export const MAX_ROTATE_SECONDS = 120;

export const DEFAULT_CONFIG: DashboardConfig = {
  disabledViewIds: [],
  density: 'auto',
  autoRotate: false,
  rotateSeconds: 10,
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

// Validate a stored JSON blob into a DashboardConfig. Every field falls back
// independently, so one corrupt key never discards the rest of a good config.
export function parseConfig(raw: string | null): DashboardConfig {
  if (!raw) return DEFAULT_CONFIG;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return DEFAULT_CONFIG;
  }
  if (typeof obj !== 'object' || obj === null) return DEFAULT_CONFIG;
  const o = obj as Record<string, unknown>;

  const disabledViewIds = Array.isArray(o.disabledViewIds)
    ? o.disabledViewIds.filter((v): v is string => typeof v === 'string')
    : DEFAULT_CONFIG.disabledViewIds;

  const density = DENSITIES.includes(o.density as Density)
    ? (o.density as Density)
    : DEFAULT_CONFIG.density;

  const autoRotate =
    typeof o.autoRotate === 'boolean' ? o.autoRotate : DEFAULT_CONFIG.autoRotate;

  const rotateSeconds =
    typeof o.rotateSeconds === 'number' && Number.isFinite(o.rotateSeconds)
      ? clamp(Math.round(o.rotateSeconds), MIN_ROTATE_SECONDS, MAX_ROTATE_SECONDS)
      : DEFAULT_CONFIG.rotateSeconds;

  return { disabledViewIds, density, autoRotate, rotateSeconds };
}

export function loadConfig(): DashboardConfig {
  try {
    return parseConfig(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: DashboardConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Storage disabled (private mode etc.) — config just won't persist.
  }
}
