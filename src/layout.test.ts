import { describe, it, expect } from 'vitest';
import { panelsPerPage, gridDimensions, paginate } from './layout';

const cellMin = { width: 400, height: 300 };

describe('panelsPerPage', () => {
  it('fits more panels into a larger viewport in auto mode', () => {
    expect(panelsPerPage({ width: 380, height: 280 }, cellMin, 'auto', 5)).toBe(1);
    expect(panelsPerPage({ width: 900, height: 320 }, cellMin, 'auto', 5)).toBe(2);
    expect(panelsPerPage({ width: 900, height: 650 }, cellMin, 'auto', 5)).toBe(4);
  });

  it('never returns more than the number of views available', () => {
    expect(panelsPerPage({ width: 4000, height: 4000 }, cellMin, 'auto', 2)).toBe(2);
  });

  it('always keeps at least one panel when a view exists', () => {
    expect(panelsPerPage({ width: 10, height: 10 }, cellMin, 'auto', 3)).toBe(1);
  });

  it('returns 0 when there are no views', () => {
    expect(panelsPerPage({ width: 900, height: 900 }, cellMin, 'auto', 0)).toBe(0);
  });

  it('pins the count to a numeric density, clamped to the view count', () => {
    expect(panelsPerPage({ width: 4000, height: 4000 }, cellMin, 1, 5)).toBe(1);
    expect(panelsPerPage({ width: 10, height: 10 }, cellMin, 3, 5)).toBe(3);
    expect(panelsPerPage({ width: 4000, height: 4000 }, cellMin, 3, 2)).toBe(2);
  });
});

describe('gridDimensions', () => {
  it('uses a single cell for one panel', () => {
    expect(gridDimensions(1, { width: 1920, height: 1080 })).toEqual({ cols: 1, rows: 1 });
  });

  it('lays two panels side by side on a landscape screen', () => {
    expect(gridDimensions(2, { width: 1920, height: 1080 })).toEqual({ cols: 2, rows: 1 });
  });

  it('stacks two panels on a portrait screen', () => {
    expect(gridDimensions(2, { width: 1080, height: 1920 })).toEqual({ cols: 1, rows: 2 });
  });

  it('covers every panel for larger counts', () => {
    for (let n = 1; n <= 8; n++) {
      const { cols, rows } = gridDimensions(n, { width: 1920, height: 1080 });
      expect(cols * rows).toBeGreaterThanOrEqual(n);
    }
  });
});

describe('paginate', () => {
  it('chunks items into pages of perPage', () => {
    expect(paginate([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns a single page when everything fits', () => {
    expect(paginate([1, 2], 4)).toEqual([[1, 2]]);
  });

  it('returns no pages for an empty list', () => {
    expect(paginate([], 3)).toEqual([]);
  });
});
