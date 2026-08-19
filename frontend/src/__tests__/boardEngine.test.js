/**
 * boardEngine (proposal 67) — the ViewGrid board's pure arithmetic, pinned.
 *
 * Everything the board promises is provable here without a DOM:
 *
 * · collision and the pinned reflow (push down what you land on, pull up
 *   what you leave behind), and pack's no-holes rule;
 * · the silent legacy upgrade — a saved view of {metric, viz, w:1–3} maps
 *   its widths ×4, takes viz-default heights and packs in list order;
 * · the clamps: per-viz minimums, x+w ≤ 12, h ≤ 8;
 * · the anti-dead-space arithmetic — fill counts from measured body pixels
 *   (fitCounts) and the grow cap predicted from the MEASURED body plus whole
 *   row-units (maxHFromMeasured). The prediction style is the point: the
 *   demo estimated card chrome first and drifted exactly one row at the cap,
 *   so the boundary cases here are exact-fit cases.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  COLS, ROWH, GAP, MAXH, MINW, MINH, DEFW, DEFH,
  BAR_ROW, BAR_GAP, NOTE_H, THEAD_H, TR_H,
  collides, reflow, pack, clampSize, normalizeLayout,
  trendLadder, fitCounts, maxHFromMeasured,
  placeAtBottom, stackMove, capColumns,
} from '../pages/dristi/boardEngine';

/** True when any two distinct rectangles in the list overlap. */
const anyOverlap = (list) => list.some(
  (a) => list.some((b) => a.id !== b.id && collides(a, b)),
);
/** Every rectangle sits on the board. */
const allInBounds = (list) => list.every(
  (i) => i.x >= 0 && i.y >= 0 && i.x + i.w <= COLS && i.w >= 1 && i.h >= 1,
);
const byId = (list, id) => list.find((p) => p.id === id);

// ── the contract constants the CSS restates ─────────────────────────────────
// Each constant is compared against the value parsed OUT OF the stylesheet
// that declares the rule it restates — never against a copied literal, so
// drift on either side (a CSS tweak or an engine edit) turns this red.

const readCss = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const cssEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The declaration text of the FIRST `selector { … }` whose selector list is
 *  exactly `selector`, anchored to a line start so `.vg` never matches
 *  `.vg--edit` and `.tbl th` never matches `.tbl th, .tbl td`. */
const cssBlock = (src, selector) => {
  const m = src.match(new RegExp(`(?:^|\\n)${cssEsc(selector)}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`rule not found in stylesheet: ${selector}`);
  return m[1];
};
/** The px number a property declares — `height:` must not match `line-height:`. */
const pxOf = (src, prop) => {
  const m = src.match(new RegExp(`(?:^|[\\s{;])${cssEsc(prop)}:\\s*([\\d.]+)px`));
  if (!m) throw new Error(`no ${prop}: <n>px declaration found`);
  return Number(m[1]);
};

describe('the pinned constants (read back from the stylesheets)', () => {
  const analytics = readCss('../styles/analytics.css');
  const components = readCss('../styles/components.css');

  it('board geometry matches analytics.css (.vg columns and gap, --anx-rowh)', () => {
    const vg = cssBlock(analytics, '.vg');
    expect(COLS).toBe(Number(vg.match(/repeat\((\d+),/)[1]));
    expect(GAP).toBe(pxOf(vg, 'gap'));
    expect(ROWH).toBe(pxOf(analytics, '--anx-rowh'));
  });
  it('bars density matches .vgw-hbars: row height + list gap', () => {
    const gap = pxOf(cssBlock(analytics, '.vgw-hbars'), 'gap');
    const row = pxOf(cssBlock(analytics, '.vgw-hbars__r'), 'height');
    expect(BAR_GAP).toBe(gap);
    expect(BAR_ROW).toBe(row + gap);
  });
  it('the note budget matches .vgw-fitnote: line height + top margin', () => {
    const note = cssBlock(analytics, '.vgw-fitnote');
    expect(NOTE_H).toBe(pxOf(note, 'height') + pxOf(note, 'margin-top'));
  });
  it('table density matches .tbl th + head rule and the .vgw --row-h tier + row rule', () => {
    const th = pxOf(cssBlock(components, '.tbl th'), 'height');
    const tier = pxOf(cssBlock(analytics, '.vgw'), '--row-h');
    expect(THEAD_H).toBe(th + pxOf(components, '--tbl-head-rule'));
    expect(TR_H).toBe(tier + pxOf(components, '--tbl-rule'));
  });
  it('the grow ceiling is board policy — no stylesheet restates it', () => {
    expect(MAXH).toBe(8);
  });
});

// ── collides ────────────────────────────────────────────────────────────────

describe('collides', () => {
  const at = (id, x, y, w, h) => ({ id, x, y, w, h });
  it('overlapping rectangles collide', () => {
    expect(collides(at('a', 0, 0, 4, 2), at('b', 2, 1, 4, 2))).toBe(true);
  });
  it('containment collides', () => {
    expect(collides(at('a', 0, 0, 12, 8), at('b', 4, 2, 2, 2))).toBe(true);
  });
  it('edge-adjacent columns do NOT collide', () => {
    expect(collides(at('a', 0, 0, 4, 2), at('b', 4, 0, 4, 2))).toBe(false);
  });
  it('edge-adjacent rows do NOT collide', () => {
    expect(collides(at('a', 0, 0, 4, 2), at('b', 0, 2, 4, 2))).toBe(false);
  });
  it('a rectangle never collides with itself, whatever the geometry says', () => {
    expect(collides(at('a', 0, 0, 4, 2), at('a', 0, 0, 4, 2))).toBe(false);
  });
});

// ── reflow: pin one, the others make room ───────────────────────────────────

describe('reflow', () => {
  it('keeps the pin exactly where the gesture put it', () => {
    const list = [
      { id: 0, x: 0, y: 0, w: 4, h: 2 },
      { id: 1, x: 4, y: 0, w: 4, h: 2 },
    ];
    const out = reflow(list, { id: 0, x: 4, y: 1, w: 4, h: 2 });
    expect(byId(out, 0)).toMatchObject({ x: 4, y: 1, w: 4, h: 2 });
  });

  it('pushes what the pin lands on below it', () => {
    const list = [
      { id: 0, x: 0, y: 3, w: 4, h: 2 },
      { id: 1, x: 0, y: 0, w: 4, h: 2 },
    ];
    const out = reflow(list, { id: 0, x: 0, y: 0, w: 4, h: 2 });
    expect(byId(out, 1).y).toBe(2); // pushed under the pin
    expect(anyOverlap(out)).toBe(false);
  });

  it('pushes a whole chain down, one under the other', () => {
    const list = [
      { id: 0, x: 0, y: 4, w: 4, h: 2 },
      { id: 1, x: 0, y: 0, w: 4, h: 2 },
      { id: 2, x: 0, y: 2, w: 4, h: 2 },
    ];
    const out = reflow(list, { id: 0, x: 0, y: 0, w: 4, h: 4 });
    expect(byId(out, 1).y).toBe(4);
    expect(byId(out, 2).y).toBe(6);
    expect(anyOverlap(out)).toBe(false);
  });

  it('pulls the others up into the space the pin left behind', () => {
    const list = [
      { id: 0, x: 0, y: 0, w: 4, h: 2 },
      { id: 1, x: 0, y: 2, w: 4, h: 2 },
    ];
    const out = reflow(list, { id: 0, x: 0, y: 4, w: 4, h: 2 });
    expect(byId(out, 1).y).toBe(0);   // rose into the vacated rows
    expect(byId(out, 0).y).toBe(4);   // the pin itself stays pinned — pack is a separate step
  });

  it('leaves a non-colliding column alone horizontally', () => {
    const list = [
      { id: 0, x: 0, y: 0, w: 4, h: 2 },
      { id: 1, x: 8, y: 0, w: 4, h: 3 },
    ];
    const out = reflow(list, { id: 0, x: 0, y: 1, w: 4, h: 2 });
    expect(byId(out, 1)).toMatchObject({ x: 8, y: 0 });
  });

  it('does not mutate its input', () => {
    const list = [
      { id: 0, x: 0, y: 0, w: 4, h: 2 },
      { id: 1, x: 0, y: 2, w: 4, h: 2 },
    ];
    const snapshot = JSON.parse(JSON.stringify(list));
    reflow(list, { id: 0, x: 0, y: 5, w: 4, h: 2 });
    expect(list).toEqual(snapshot);
  });
});

// ── pack: the board never keeps a hole ──────────────────────────────────────

describe('pack', () => {
  it('pulls a floating card to the top', () => {
    const out = pack([{ id: 0, x: 0, y: 5, w: 4, h: 2 }]);
    expect(byId(out, 0).y).toBe(0);
  });

  it('closes a vertical gap while preserving the stack order', () => {
    const out = pack([
      { id: 0, x: 0, y: 0, w: 4, h: 2 },
      { id: 1, x: 0, y: 6, w: 4, h: 2 },
    ]);
    expect(byId(out, 1).y).toBe(2);
    expect(anyOverlap(out)).toBe(false);
  });

  it('is a no-op on an already-packed board', () => {
    const list = [
      { id: 0, x: 0, y: 0, w: 8, h: 3 },
      { id: 1, x: 8, y: 0, w: 4, h: 2 },
      { id: 2, x: 0, y: 3, w: 12, h: 3 },
    ];
    const out = pack(list);
    list.forEach((it) => expect(byId(out, it.id)).toMatchObject(it));
  });

  it('never moves a card sideways', () => {
    const out = pack([
      { id: 0, x: 8, y: 4, w: 4, h: 2 },
      { id: 1, x: 0, y: 2, w: 4, h: 2 },
    ]);
    expect(byId(out, 0).x).toBe(8);
    expect(byId(out, 1).x).toBe(0);
    // both float to the top of their own columns
    expect(byId(out, 0).y).toBe(0);
    expect(byId(out, 1).y).toBe(0);
  });

  it('does not mutate its input', () => {
    const list = [{ id: 0, x: 0, y: 5, w: 4, h: 2 }];
    pack(list);
    expect(list[0].y).toBe(5);
  });
});

// ── clampSize ───────────────────────────────────────────────────────────────

describe('clampSize', () => {
  it('enforces each viz minimum width', () => {
    expect(clampSize({ viz: 'kpi', x: 0, y: 0, w: 1, h: 2 }).w).toBe(MINW.kpi);
    expect(clampSize({ viz: 'trend', x: 0, y: 0, w: 1, h: 2 }).w).toBe(MINW.trend);
    expect(clampSize({ viz: 'bars', x: 0, y: 0, w: 1, h: 2 }).w).toBe(MINW.bars);
    expect(clampSize({ viz: 'table', x: 0, y: 0, w: 1, h: 2 }).w).toBe(MINW.table);
  });
  it('enforces the minimum height and the board maximum', () => {
    expect(clampSize({ viz: 'kpi', x: 0, y: 0, w: 4, h: 1 }).h).toBe(MINH.kpi);
    expect(clampSize({ viz: 'table', x: 0, y: 0, w: 12, h: 40 }).h).toBe(MAXH);
  });
  it('keeps x + w on the board by moving x, not shrinking w', () => {
    const c = clampSize({ viz: 'kpi', x: 10, y: 0, w: 4, h: 2 });
    expect(c.w).toBe(4);
    expect(c.x).toBe(8);
  });
  it('a full-width widget lands at x 0', () => {
    const c = clampSize({ viz: 'table', x: 7, y: 0, w: 12, h: 3 });
    expect(c).toMatchObject({ x: 0, w: 12 });
  });
  it('negative positions come back onto the board', () => {
    const c = clampSize({ viz: 'kpi', x: -3, y: -2, w: 4, h: 2 });
    expect(c).toMatchObject({ x: 0, y: 0 });
  });
  it('non-numeric geometry falls back to viz defaults at the origin', () => {
    const c = clampSize({ viz: 'trend', x: 'x', y: undefined, w: null, h: NaN });
    expect(c).toMatchObject({ x: 0, y: 0, w: DEFW.trend, h: DEFH.trend });
  });
});

// ── normalizeLayout: the silent legacy upgrade ──────────────────────────────

describe('normalizeLayout', () => {
  it('maps legacy widths ×4: 1→4, 2→8, 3→12', () => {
    const out = normalizeLayout([
      { metric: 'a', viz: 'kpi', w: 1 },
      { metric: 'b', viz: 'trend', w: 2 },
      { metric: 'c', viz: 'table', w: 3 },
    ]);
    expect(out[0].w).toBe(4);
    expect(out[1].w).toBe(8);
    expect(out[2].w).toBe(12);
  });

  it('gives each viz its default height: kpi 2, trend 3, bars 3, table 3', () => {
    const out = normalizeLayout([
      { metric: 'a', viz: 'kpi', w: 1 },
      { metric: 'b', viz: 'trend', w: 2 },
      { metric: 'c', viz: 'bars', w: 1 },
      { metric: 'd', viz: 'table', w: 3 },
    ]);
    expect(out.map((w) => w.h)).toEqual([DEFH.kpi, DEFH.trend, DEFH.bars, DEFH.table]);
  });

  it('packs legacy positions in list order, reading left to right', () => {
    const out = normalizeLayout([
      { metric: 'a', viz: 'kpi', w: 1 },
      { metric: 'b', viz: 'kpi', w: 1 },
      { metric: 'c', viz: 'kpi', w: 1 },
      { metric: 'd', viz: 'kpi', w: 1 },
    ]);
    expect(out[0]).toMatchObject({ x: 0, y: 0 });
    expect(out[1]).toMatchObject({ x: 4, y: 0 });
    expect(out[2]).toMatchObject({ x: 8, y: 0 });
    expect(out[3]).toMatchObject({ x: 0, y: 2 }); // the row is full — wraps below
  });

  it('wraps mixed sizes without overlap — the ganit-shaped upgrade', () => {
    const out = normalizeLayout([
      { metric: 'trend', viz: 'trend', w: 2 },
      { metric: 'k1', viz: 'kpi', w: 1 },
      { metric: 'k2', viz: 'kpi', w: 1 },
    ]);
    expect(out[0]).toMatchObject({ x: 0, y: 0, w: 8, h: 3 });
    expect(out[1]).toMatchObject({ x: 8, y: 0, w: 4, h: 2 });
    // the second kpi slots UNDER the first, beside the trend — packed, no hole
    expect(out[2]).toMatchObject({ x: 8, y: 2, w: 4, h: 2 });
    const geo = out.map((w, i) => ({ id: i, ...w }));
    expect(anyOverlap(geo)).toBe(false);
    expect(allInBounds(geo)).toBe(true);
  });

  it('a legacy widget with NO width takes the viz default', () => {
    const out = normalizeLayout([{ metric: 'a', viz: 'bars' }]);
    expect(out[0]).toMatchObject({ x: 0, y: 0, w: DEFW.bars, h: DEFH.bars });
  });

  it('a board-scale width (4..12) with no position KEEPS its width', () => {
    // The backend round-trips {w} without x/y/h deliberately: only w ≤ 3 is
    // the legacy 3-column scale. w 6 must come back 6 — not DEFW — with a
    // packed position and the viz-default height.
    const out = normalizeLayout([
      { metric: 'a', viz: 'bars', w: 6 },
      { metric: 'b', viz: 'kpi', w: 5 },
    ]);
    expect(out[0]).toMatchObject({ x: 0, y: 0, w: 6, h: DEFH.bars });
    expect(out[1]).toMatchObject({ x: 6, y: 0, w: 5, h: DEFH.kpi });
    // and the upgrade round-trips: normalizing the result changes nothing
    expect(normalizeLayout(out)).toEqual(out);
  });

  it('partial geometry keeps the sent spans and packs the position', () => {
    // h with no x/y: the height survives (clamped), the position is packed
    const tall = normalizeLayout([{ metric: 'a', viz: 'table', w: 12, h: 6 }]);
    expect(tall[0]).toMatchObject({ x: 0, y: 0, w: 12, h: 6 });
    expect(normalizeLayout(tall)).toEqual(tall);
    // x/y with no h: the position is repacked, the height is the viz default
    const posOnly = normalizeLayout([{ metric: 'b', viz: 'kpi', x: 8, y: 4, w: 4 }]);
    expect(posOnly[0]).toMatchObject({ x: 0, y: 0, w: 4, h: DEFH.kpi });
  });

  it('only ALL of x/y/h makes a widget v2 verbatim', () => {
    const v2 = { metric: 'a', viz: 'trend', x: 4, y: 0, w: 8, h: 4 };
    expect(normalizeLayout([v2])[0]).toMatchObject({ x: 4, y: 0, w: 8, h: 4 });
  });

  it('keeps valid saved geometry exactly as it went in', () => {
    const saved = [
      { metric: 'a', viz: 'trend', x: 0, y: 0, w: 8, h: 3 },
      { metric: 'b', viz: 'kpi', x: 8, y: 0, w: 4, h: 2 },
      { metric: 'c', viz: 'table', x: 0, y: 3, w: 12, h: 4 },
    ];
    const out = normalizeLayout(saved);
    saved.forEach((w, i) => expect(out[i]).toMatchObject(w));
  });

  it('is idempotent — upgrading an upgraded layout changes nothing', () => {
    const once = normalizeLayout([
      { metric: 'a', viz: 'trend', w: 2 },
      { metric: 'b', viz: 'kpi', w: 1 },
      { metric: 'c', viz: 'table', w: 3 },
    ]);
    expect(normalizeLayout(once)).toEqual(once);
  });

  it('clamps saved geometry that has drifted off the board', () => {
    const out = normalizeLayout([
      { metric: 'a', viz: 'kpi', x: 10, y: 0, w: 4, h: 2 },   // x+w > 12
      { metric: 'b', viz: 'table', x: 0, y: 2, w: 12, h: 40 }, // h > 8
    ]);
    expect(out[0].x + out[0].w).toBeLessThanOrEqual(COLS);
    expect(out[1].h).toBe(MAXH);
  });

  it('resolves overlapping saved rows instead of drawing them on top of each other', () => {
    const out = normalizeLayout([
      { metric: 'a', viz: 'kpi', x: 0, y: 0, w: 4, h: 2 },
      { metric: 'b', viz: 'kpi', x: 0, y: 0, w: 4, h: 2 },
    ]);
    const geo = out.map((w, i) => ({ id: i, ...w }));
    expect(anyOverlap(geo)).toBe(false);
  });

  it('packs a floating saved layout upward', () => {
    const out = normalizeLayout([
      { metric: 'a', viz: 'kpi', x: 0, y: 5, w: 4, h: 2 },
    ]);
    expect(out[0].y).toBe(0);
  });

  it('preserves list order and every non-geometry field', () => {
    const out = normalizeLayout([
      { metric: 'x.y', viz: 'trend', w: 2, group_by: 'source' },
      { metric: 'z.t', viz: 'table', w: 3, columns: ['client', 'value'] },
    ]);
    expect(out[0].metric).toBe('x.y');
    expect(out[0].group_by).toBe('source');
    expect(out[1].columns).toEqual(['client', 'value']);
  });

  it('places a legacy widget AROUND existing saved geometry', () => {
    const out = normalizeLayout([
      { metric: 'a', viz: 'kpi', x: 0, y: 0, w: 4, h: 2 },
      { metric: 'b', viz: 'kpi', w: 1 },
    ]);
    expect(out[1]).toMatchObject({ x: 4, y: 0 });
    const geo = out.map((w, i) => ({ id: i, ...w }));
    expect(anyOverlap(geo)).toBe(false);
  });

  it('handles an empty or missing layout', () => {
    expect(normalizeLayout([])).toEqual([]);
    expect(normalizeLayout(undefined)).toEqual([]);
  });
});

// ── the trend width ladder ──────────────────────────────────────────────────

describe('trendLadder', () => {
  it('4/6/8/10/12 periods at w ≤ 4/6/8/10/12', () => {
    expect(trendLadder(4)).toBe(4);
    expect(trendLadder(5)).toBe(6);
    expect(trendLadder(6)).toBe(6);
    expect(trendLadder(7)).toBe(8);
    expect(trendLadder(8)).toBe(8);
    expect(trendLadder(9)).toBe(10);
    expect(trendLadder(10)).toBe(10);
    expect(trendLadder(11)).toBe(12);
    expect(trendLadder(12)).toBe(12);
  });
});

// ── fitCounts: counts from measured pixels, not guesses ─────────────────────

describe('fitCounts · kpi', () => {
  it('earns its sparkline at w ≥ 6 or h ≥ 3, not before', () => {
    expect(fitCounts('kpi', 0, 12, 6, 2).spark).toBe(true);
    expect(fitCounts('kpi', 0, 12, 4, 3).spark).toBe(true);
    expect(fitCounts('kpi', 0, 12, 4, 2).spark).toBe(false);
  });
});

describe('fitCounts · trend', () => {
  it('cuts to the width ladder', () => {
    expect(fitCounts('trend', 0, 12, 4, 3).n).toBe(4);
    expect(fitCounts('trend', 0, 12, 8, 3).n).toBe(8);
    expect(fitCounts('trend', 0, 12, 12, 3).n).toBe(12);
  });
  it('never asks for more periods than the run returned', () => {
    expect(fitCounts('trend', 0, 5, 12, 3).n).toBe(5);
  });
});

describe('fitCounts · bars', () => {
  // A bars row advances BAR_ROW (26px); n rows occupy n·26 − 6.
  it('shows every row when they all fit — and reserves NO note line', () => {
    // 4 rows need 4·26 − 6 = 98px
    expect(fitCounts('bars', 98, 4, 4, 3).n).toBe(4);
  });
  it('one pixel short of the last row cuts it AND budgets the note', () => {
    // 97px: floor((97+6)/26) = 3 < 4 → with the note, floor((97−20+6)/26) = 3
    expect(fitCounts('bars', 97, 4, 4, 3).n).toBe(3);
  });
  it('reserving the note can itself cost a row — the drift case, pinned', () => {
    // 8 rows need 202px. At 200px: floor(206/26)=7 < 8, so the note is
    // reserved and the count is floor((200−20+6)/26) = 7 — not 7.9 “almost 8”.
    expect(fitCounts('bars', 200, 8, 4, 3).n).toBe(7);
  });
  it('the note reservation CHANGES the count — the naive floor would lie', () => {
    // 124px, 6 rows: naive floor((124+6)/26) = 5 < 6, and paying the note
    // crosses a row boundary — floor((124−20+6)/26) = 4. A count of 5 here
    // means the reservation branch is gone and the note paints over row 5.
    expect(fitCounts('bars', 124, 6, 4, 3).n).toBe(4);
  });
  it('never shows fewer than one row, whatever the pixels say', () => {
    expect(fitCounts('bars', 0, 9, 4, 2).n).toBe(1);
  });
});

describe('fitCounts · table', () => {
  it('floors on (body − thead) / row when everything fits', () => {
    // 3 rows: 39 + 3·49 = 186
    expect(fitCounts('table', 186, 3, 12, 3).n).toBe(3);
  });
  it('reserves the note only when rows genuinely wait below', () => {
    // 185px: avail 146 → floor 2 < 3 → with note floor((146−20)/49) = 2
    expect(fitCounts('table', 185, 3, 12, 3).n).toBe(2);
  });
  it('the note reservation CHANGES the count — the naive floor would lie', () => {
    // 189px, 4 rows: avail 150 → naive floor(150/49) = 3 < 4, and paying the
    // note crosses a row boundary — floor((150−20)/49) = 2. A count of 3 here
    // means the reservation branch is gone and the note paints over row 3.
    expect(fitCounts('table', 189, 4, 12, 3).n).toBe(2);
  });
  it('a card too short for even the header still shows one row', () => {
    expect(fitCounts('table', 10, 5, 12, 2).n).toBe(1);
  });
  it('caps at the data — a tall card of three rows shows three rows', () => {
    expect(fitCounts('table', 2000, 3, 12, 8).n).toBe(3);
  });
});

// ── maxHFromMeasured: the grow cap, from the measured body ─────────────────

describe('maxHFromMeasured', () => {
  const UNIT = ROWH + GAP; // 96 — one grid row of prediction

  it('a kpi stops at 3 — a number can only stretch so far', () => {
    expect(maxHFromMeasured('kpi', 1, 400, 2, UNIT)).toBe(3);
  });
  it('a trend takes the board maximum — it stretches without going hollow', () => {
    expect(maxHFromMeasured('trend', 24, 100, 3, UNIT)).toBe(MAXH);
  });
  it('while the run is loading, growth WAITS — the cap is the current h', () => {
    // An open cap here let a loading bars/table card be grown to 8 and the
    // hollow height committed with nothing revisiting it.
    expect(maxHFromMeasured('bars', null, 150, 2, UNIT)).toBe(2);
    expect(maxHFromMeasured('table', undefined, 150, 2, UNIT)).toBe(2);
    // the cap sits AT the current h, never below it — shrinking stays open
    expect(maxHFromMeasured('bars', null, 500, 5, UNIT)).toBe(5);
  });
  it('answers 8 before the body has been measured', () => {
    expect(maxHFromMeasured('bars', 9, 0, 2, UNIT)).toBe(MAXH);
  });

  it('bars: the smallest h whose predicted body fits every row', () => {
    // 8 rows need 8·26 − 6 = 202. Measured 150 at h2:
    // h2 → 150, h3 → 246 ≥ 202 → 3.
    expect(maxHFromMeasured('bars', 8, 150, 2, UNIT)).toBe(3);
  });
  it('bars: an exact fit at the boundary is enough — no drift row', () => {
    // need 202; measured 106 at h2 → h3 predicts 106 + 96 = 202 exactly.
    expect(maxHFromMeasured('bars', 8, 106, 2, UNIT)).toBe(3);
  });
  it('bars: one pixel under the exact fit costs a full row-unit', () => {
    expect(maxHFromMeasured('bars', 8, 105, 2, UNIT)).toBe(4);
  });

  it('table: predicts thead + rows against the measured body', () => {
    // 10 rows need 39 + 490 = 529. Measured 150 at h2:
    // h5 → 150+288=438 < 529; h6 → 534 ≥ 529 → 6.
    expect(maxHFromMeasured('table', 10, 150, 2, UNIT)).toBe(6);
  });
  it('table: prediction works from ANY current h, not just the minimum', () => {
    // same card measured at h4 (body 342): h6 → 342 + 2·96 = 534 ≥ 529 → 6.
    expect(maxHFromMeasured('table', 10, 342, 4, UNIT)).toBe(6);
  });
  it('caps at 8 when the data can never fit', () => {
    expect(maxHFromMeasured('table', 100, 150, 2, UNIT)).toBe(MAXH);
  });
  it('an empty result stops at the viz minimum — nothing to grow for', () => {
    expect(maxHFromMeasured('bars', 0, 150, 2, UNIT)).toBe(MINH.bars);
    expect(maxHFromMeasured('table', 0, 150, 2, UNIT)).toBe(MINH.table);
  });
});

// ── placeAtBottom: where “Add” lands ────────────────────────────────────────

describe('placeAtBottom', () => {
  it('an empty board takes the widget at the origin, at viz-default size', () => {
    expect(placeAtBottom([], { metric: 'a', viz: 'kpi' }))
      .toMatchObject({ x: 0, y: 0, w: DEFW.kpi, h: DEFH.kpi });
    expect(placeAtBottom([], { metric: 'a', viz: 'table' }))
      .toMatchObject({ x: 0, y: 0, w: DEFW.table, h: DEFH.table });
  });
  it('lands below the lowest card — never tucked into a hole', () => {
    const board = [
      { x: 0, y: 0, w: 4, h: 2 },   // leaves x 4–12 free on rows 0–1
      { x: 0, y: 2, w: 12, h: 3 },
    ];
    expect(placeAtBottom(board, { metric: 'a', viz: 'kpi' }).y).toBe(5);
  });
  it('respects explicit size but clamps it legal', () => {
    const out = placeAtBottom([], { metric: 'a', viz: 'table', w: 2, h: 99 });
    expect(out.w).toBe(MINW.table);
    expect(out.h).toBe(MAXH);
  });
  it('keeps every non-geometry field', () => {
    expect(placeAtBottom([], { metric: 'a.b', viz: 'bars', group_by: 'g' }).group_by).toBe('g');
  });
});

// ── stackMove: the phone's ↑/↓ ─────────────────────────────────────────────

describe('stackMove', () => {
  const stacked = (list) => list.slice().sort((a, b) => a.y - b.y || a.x - b.x).map((p) => p.id);

  it('swaps a card with the one above it in reading order', () => {
    const list = [
      { id: 0, x: 0, y: 0, w: 12, h: 2 },
      { id: 1, x: 0, y: 2, w: 12, h: 2 },
    ];
    expect(stacked(stackMove(list, 1, -1))).toEqual([1, 0]);
  });
  it('swaps a card with the one below it', () => {
    const list = [
      { id: 0, x: 0, y: 0, w: 12, h: 2 },
      { id: 1, x: 0, y: 2, w: 12, h: 2 },
    ];
    expect(stacked(stackMove(list, 0, 1))).toEqual([1, 0]);
  });
  it('side-by-side cards swap reading order too', () => {
    const list = [
      { id: 0, x: 0, y: 0, w: 6, h: 2 },
      { id: 1, x: 6, y: 0, w: 6, h: 2 },
    ];
    expect(stacked(stackMove(list, 1, -1))).toEqual([1, 0]);
  });
  it('unequal sizes swap without overlap and without a hole', () => {
    const list = [
      { id: 0, x: 0, y: 0, w: 12, h: 2 },
      { id: 1, x: 0, y: 2, w: 4, h: 3 },
    ];
    const out = stackMove(list, 1, -1);
    expect(stacked(out)).toEqual([1, 0]);
    expect(anyOverlap(out)).toBe(false);
    expect(out.some((p) => p.y === 0)).toBe(true); // still packed to the top
  });
  it('unequal WIDTHS re-clamp x — a swap never writes x+w past the board', () => {
    // A w-4 card at x 8 swapping with a w-12 card at x 0 hands the wide card
    // x 8: x+w 20 in the draft, and every Save 422s on the x+w<=12 gate.
    const list = [
      { id: 0, x: 0, y: 0, w: 12, h: 2 },
      { id: 1, x: 8, y: 2, w: 4, h: 2 },
    ];
    const out = stackMove(list, 1, -1);
    expect(allInBounds(out)).toBe(true);
    expect(byId(out, 0)).toMatchObject({ x: 0, w: 12 }); // clamped to COLS − w
    expect(stacked(out)).toEqual([1, 0]);
    expect(anyOverlap(out)).toBe(false);
  });
  it('moving off either end is a no-op and returns the SAME array', () => {
    const list = [
      { id: 0, x: 0, y: 0, w: 12, h: 2 },
      { id: 1, x: 0, y: 2, w: 12, h: 2 },
    ];
    expect(stackMove(list, 0, -1)).toBe(list);
    expect(stackMove(list, 1, 1)).toBe(list);
  });
  it('an unknown id is a no-op', () => {
    const list = [{ id: 0, x: 0, y: 0, w: 12, h: 2 }];
    expect(stackMove(list, 99, 1)).toBe(list);
  });
  it('does not mutate its input on a real move', () => {
    const list = [
      { id: 0, x: 0, y: 0, w: 12, h: 2 },
      { id: 1, x: 0, y: 2, w: 12, h: 2 },
    ];
    stackMove(list, 1, -1);
    expect(list[0].y).toBe(0);
    expect(list[1].y).toBe(2);
  });
});

// ── capColumns: the table cut on a narrow card ──────────────────────────────

describe('capColumns', () => {
  const cols = ['client', 'invoice', 'amount', 'due', 'status'];
  it('caps at 3 columns when the card is narrower than 8', () => {
    expect(capColumns(cols, 7)).toEqual(['client', 'invoice', 'amount']);
    expect(capColumns(cols, 5)).toEqual(['client', 'invoice', 'amount']);
  });
  it('keeps the chooser\'s full pick at w ≥ 8', () => {
    expect(capColumns(cols, 8)).toEqual(cols);
    expect(capColumns(cols, 12)).toEqual(cols);
  });
  it('a pick already under the cap passes through untouched', () => {
    expect(capColumns(['client'], 4)).toEqual(['client']);
  });
});
