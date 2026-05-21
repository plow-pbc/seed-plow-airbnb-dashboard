import { describe, it, expect } from 'vitest';
import { nextRotation, parseRotation } from './rotation';

describe('nextRotation', () => {
  it('cycles 0 → 90 → 180 → 270 → 0', () => {
    expect(nextRotation(0)).toBe(90);
    expect(nextRotation(90)).toBe(180);
    expect(nextRotation(180)).toBe(270);
    expect(nextRotation(270)).toBe(0);
  });
});

describe('parseRotation', () => {
  it('returns the 270° default when nothing is stored', () => {
    expect(parseRotation(null)).toBe(270);
    expect(parseRotation('')).toBe(270);
  });

  it('returns a valid stored rotation', () => {
    expect(parseRotation('0')).toBe(0);
    expect(parseRotation('90')).toBe(90);
    expect(parseRotation('270')).toBe(270);
  });

  it('falls back to the default for an out-of-set or junk value', () => {
    expect(parseRotation('45')).toBe(270);
    expect(parseRotation('abc')).toBe(270);
  });
});
