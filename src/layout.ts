// Pure layout maths for the dashboard grid. Given a viewport and the views to
// show, decide how many panels tile comfortably on one page ("the optimal
// configuration"), how to arrange that page into a grid, and how to chunk the
// rest into overflow pages. Kept DOM-free so it's unit-testable.

import type { Density } from './config';

export type Size = { width: number; height: number };
export type Grid = { cols: number; rows: number };

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

// How many panels to place on one page. In 'auto' mode, count how many cells
// of at least `cellMin` fit in the viewport; a numeric density pins it. Never
// exceeds the number of views actually available, and never drops below 1
// when there is at least one view.
export function panelsPerPage(
  viewport: Size,
  cellMin: Size,
  density: Density,
  viewCount: number,
): number {
  if (viewCount <= 0) return 0;
  if (density !== 'auto') return clamp(density, 1, viewCount);
  const cols = Math.max(1, Math.floor(viewport.width / cellMin.width));
  const rows = Math.max(1, Math.floor(viewport.height / cellMin.height));
  return clamp(cols * rows, 1, viewCount);
}

// Arrange `count` panels into a grid whose cells echo the viewport's aspect
// ratio — the standard sqrt heuristic for packing equal rectangles. A wide
// screen gets more columns, a tall one more rows.
export function gridDimensions(count: number, viewport: Size): Grid {
  if (count <= 1) return { cols: 1, rows: 1 };
  const aspect = viewport.height > 0 ? viewport.width / viewport.height : 1;
  const cols = clamp(Math.round(Math.sqrt(count * aspect)), 1, count);
  const rows = Math.ceil(count / cols);
  return { cols, rows };
}

// Chunk views into pages of `perPage`. Page 0 tiles in the main area; any
// further pages are the overflow reached through tabs.
export function paginate<T>(items: T[], perPage: number): T[][] {
  if (items.length === 0) return [];
  if (perPage <= 0) return [items];
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += perPage) {
    pages.push(items.slice(i, i + perPage));
  }
  return pages;
}
