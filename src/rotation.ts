// Kiosk display rotation in degrees. Cycled by the in-app rotate button and
// persisted to localStorage so the orientation survives the periodic reload.
// index.html re-applies the saved value before first paint — keep STORAGE_KEY
// in sync with the inline script there.

export type Rotation = 0 | 90 | 180 | 270;

const ROTATIONS: Rotation[] = [0, 90, 180, 270];
const STORAGE_KEY = 'dashboard-rotation';
const DEFAULT: Rotation = 270; // the original portrait kiosk mounting

export function nextRotation(current: Rotation): Rotation {
  return ROTATIONS[(ROTATIONS.indexOf(current) + 1) % ROTATIONS.length];
}

// Validate a stored value into a Rotation. A missing key reads back as null;
// guard that explicitly — Number(null) is 0, itself a valid rotation, which
// would otherwise mask the 270° default.
export function parseRotation(raw: string | null): Rotation {
  if (!raw) return DEFAULT;
  const n = Number(raw);
  return ROTATIONS.includes(n as Rotation) ? (n as Rotation) : DEFAULT;
}

export function loadRotation(): Rotation {
  try {
    return parseRotation(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT;
  }
}

export function saveRotation(rotation: Rotation): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(rotation));
  } catch {
    // Storage disabled (private mode etc.) — rotation just won't persist.
  }
}
