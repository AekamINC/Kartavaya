// boardEngine — the ViewGrid board's pure arithmetic (proposal 67).
//
// Everything here is a function of plain numbers and plain objects, because
// every rule the board enforces has to be provable in a unit test without a
// DOM: collision, the push-down/pull-up reflow, the legacy-layout upgrade,
// the size clamps, and — the owner's hard requirement — the anti-dead-space
// arithmetic that decides how much data a card of a given pixel height shows
// and how tall a card is allowed to grow.
//
// The one discipline that keeps cards from going hollow: fill counts and the
// grow cap are computed from the MEASURED body pixel height plus whole
// row-units, never from an estimate of card chrome. The demo estimated chrome
// first and drifted exactly one row at the cap — its final code, mirrored
// here, predicts from what is actually on screen.

export const COLS = 12;
/** One grid row in pixels — the value of `--anx-rowh` in analytics.css. */
export const ROWH = 84;
/** The board's gap in pixels — `.vg { gap }` in analytics.css. */
export const GAP = 12;
export const MAXH = 8;

export const MINW = { kpi: 3, trend: 4, bars: 3, table: 5 };
export const MINH = { kpi: 2, trend: 2, bars: 2, table: 2 };
/** Default spans for a widget that arrives with no geometry. The legacy grid
 *  was 3 columns wide, so its widths map ×4 onto the 12-column board. */
export const DEFW = { kpi: 4, trend: 8, bars: 4, table: 12 };
export const DEFH = { kpi: 2, trend: 3, bars: 3, table: 3 };

// Pixel truth for density, pinned by analytics.css — each constant restates a
// rule the stylesheet declares, and both sides say so:
//   BAR_ROW  = .vgw-hbars__r height (20) + .vgw-hbars gap (6)
//   NOTE_H   = .vgw-fitnote line (16) + its margin-top (4)
//   THEAD_H  = .tbl th height (38) + the 1px head rule
//   TR_H     = the widget table's --row-h tier (48) + the 1px row rule
export const BAR_ROW = 26;
export const BAR_GAP = 6;
export const NOTE_H = 20;
export const THEAD_H = 39;
export const TR_H = 49;

const clone = (i) => ({ ...i });
const byYX = (a, b) => a.y - b.y || a.x - b.x;

/** Two placed rectangles overlap. Same id never collides with itself. */
export function collides(a, b) {
  return a.id !== b.id
    && a.x < b.x + b.w && b.x < a.x + a.w
    && a.y < b.y + b.h && b.y < a.y + a.h;
}

/* Settle `rest` around `placed`: each item first rises while the space above
   is free, then sinks below whatever it still overlaps. Processing in (y, x)
   order is what makes a drag read as "the others make room". */
function settle(rest, placed) {
  const out = [];
  rest.map(clone).sort(byYX).forEach((it) => {
    for (;;) {
      const probe = { ...it, y: it.y - 1 };
      if (it.y > 0 && !placed.some((p) => collides(p, probe))) it.y -= 1; else break;
    }
    for (;;) {
      if (placed.some((p) => collides(p, it))) it.y += 1; else break;
    }
    placed.push(it);
    out.push(it);
  });
  return out;
}

/** Pin one card where the gesture put it; everything else makes room. */
export function reflow(list, pin) {
  const pinned = clone(pin);
  const rest = list.filter((i) => i.id !== pin.id);
  return [pinned, ...settle(rest, [pinned])];
}

/** Pull every card as high as it can go — the board never keeps a hole. */
export function pack(list) {
  const placed = [];
  list.map(clone).sort(byYX).forEach((it) => {
    for (;;) {
      const probe = { ...it, y: it.y - 1 };
      if (it.y > 0 && !placed.some((p) => collides(p, probe))) it.y -= 1; else break;
    }
    placed.push(it);
  });
  return placed;
}

/** Legal geometry for one widget: at least the viz's minimum, on the board. */
export function clampSize(it) {
  const minW = MINW[it.viz] ?? 3;
  const minH = MINH[it.viz] ?? 2;
  let w = Math.round(Number(it.w));
  let h = Math.round(Number(it.h));
  // Absent or nonsense spans take the viz DEFAULT, not the minimum — a
  // widget that never stated a size should look like a fresh one, not a
  // squeezed one.
  if (!Number.isFinite(w) || w <= 0) w = DEFW[it.viz] ?? minW;
  if (!Number.isFinite(h) || h <= 0) h = DEFH[it.viz] ?? minH;
  w = Math.max(minW, Math.min(COLS, w));
  h = Math.max(minH, Math.min(MAXH, h));
  let x = Math.round(Number(it.x));
  let y = Math.round(Number(it.y));
  if (!Number.isFinite(x)) x = 0;
  if (!Number.isFinite(y)) y = 0;
  x = Math.max(0, Math.min(x, COLS - w));
  y = Math.max(0, y);
  return { ...it, x, y, w, h };
}

/* First position where a w×h rectangle fits among `placed`, reading order. */
function firstFit(placed, w, h) {
  for (let y = 0; ; y += 1) {
    for (let x = 0; x <= COLS - w; x += 1) {
      const probe = { id: '__probe', x, y, w, h };
      if (!placed.some((p) => collides(p, probe))) return { x, y };
    }
  }
}

/**
 * A saved layout, upgraded to board geometry — silently, on first open.
 *
 * A widget carrying ALL of x/y/h is v2 and comes back verbatim, clamped
 * legal. Anything else keeps whatever size it DID state and gets a packed
 * position: a width of 1–3 is the legacy 3-column scale and maps ×4
 * (1→4, 2→8, 3→12), a width of 4+ is already board columns and survives,
 * and only a width never stated falls back to the viz default. Likewise a
 * stated height is kept (clamped) and a missing one takes the viz default —
 * the backend round-trips partial geometry deliberately, so nothing sent is
 * discarded. The result is settled and packed so mixed lists can never
 * overlap — and a layout that was already valid comes back exactly as it
 * went in. Output order is input order: the list IS the saved order, and
 * the phone stacks by position.
 */
export function normalizeLayout(layout) {
  const list = Array.isArray(layout) ? layout : [];
  const placed = [];
  const geo = list.map((w0, i) => {
    const full = w0.x != null && w0.y != null && w0.h != null;
    let g;
    if (!full) {
      const lw = Number(w0.w);
      const w = lw >= 1 && lw <= 3 ? lw * 4
        : (Number.isFinite(lw) && lw >= 4 ? lw : (DEFW[w0.viz] ?? 4));
      const h = w0.h == null ? (DEFH[w0.viz] ?? 2) : w0.h;
      const { w: cw, h: ch } = clampSize({ viz: w0.viz, x: 0, y: 0, w, h });
      const at = firstFit(placed, cw, ch);
      g = { id: i, viz: w0.viz, x: at.x, y: at.y, w: cw, h: ch };
    } else {
      const c = clampSize({ viz: w0.viz, x: w0.x, y: w0.y, w: w0.w, h: w0.h });
      g = { id: i, viz: w0.viz, x: c.x, y: c.y, w: c.w, h: c.h };
    }
    placed.push(g);
    return g;
  });
  // Overlaps only ever come from a hand-edited or mixed row; settling in
  // (y, x) order resolves them the same way a drag would, and packing after
  // is a no-op on anything already packed.
  const settled = pack(settle(geo, []));
  return list.map((w0, i) => {
    const g = settled.find((p) => p.id === i);
    return { ...w0, x: g.x, y: g.y, w: g.w, h: g.h };
  });
}

/** The trend width ladder: how many periods a w-column trend shows. */
export function trendLadder(w) {
  return w <= 4 ? 4 : w <= 6 ? 6 : w <= 8 ? 8 : w <= 10 ? 10 : 12;
}

/**
 * How much data actually FITS a measured card body — counts, not guesses.
 * `bodyPx` is the body's real clientHeight after layout. The note line is
 * part of the budget only when rows genuinely wait below it: a card showing
 * everything reserves nothing.
 */
export function fitCounts(viz, bodyPx, dataLen, w, h) {
  const len = Number(dataLen) || 0;
  if (viz === 'kpi') return { spark: w >= 6 || h >= 3 };
  if (viz === 'trend') return { n: Math.min(trendLadder(w), len) };
  if (viz === 'bars') {
    let n = Math.max(1, Math.floor((bodyPx + BAR_GAP) / BAR_ROW));
    if (n < len) n = Math.max(1, Math.floor((bodyPx - NOTE_H + BAR_GAP) / BAR_ROW));
    return { n: Math.min(len, n) };
  }
  // table
  const avail = bodyPx - THEAD_H;
  let n = Math.floor(avail / TR_H);
  if (n < len) n = Math.floor((avail - NOTE_H) / TR_H);
  return { n: Math.max(1, Math.min(len, n)) };
}

/**
 * The tallest h a card may grow to — the anti-dead-space cap. A kpi stops at
 * 3; a trend stretches without going hollow, so it takes the board maximum;
 * bars and tables stop at the smallest h whose PREDICTED body — the measured
 * body now, plus whole row-units for each grid row added — fits every row
 * they have. While the data is still loading (dataLen == null) nothing is
 * known, so growth WAITS: the cap is the current h (shrinking stays open) —
 * an open cap here let a loading card be grown hollow to 8 and committed
 * with nothing revisiting it.
 */
export function maxHFromMeasured(viz, dataLen, bodyPxNow, hNow, rowUnitPx) {
  if (viz === 'kpi') return 3;
  if (viz === 'trend') return MAXH;
  if (dataLen == null) return hNow;
  if (!(bodyPxNow > 0) || !(rowUnitPx > 0)) return MAXH;
  const need = viz === 'bars'
    ? dataLen * BAR_ROW - BAR_GAP
    : THEAD_H + dataLen * TR_H;
  for (let h = MINH[viz] ?? 2; h < MAXH; h += 1) {
    if (bodyPxNow + (h - hNow) * rowUnitPx >= need) return h;
  }
  return MAXH;
}

/**
 * Geometry for a widget joining the board: full default size, at the bottom.
 * Deliberately NOT first-fit — a new card tucked into a hole mid-board is a
 * card the user has to hunt for; the bottom is where "Add" visibly lands.
 */
export function placeAtBottom(list, widget) {
  const g = clampSize({
    viz: widget.viz,
    x: 0,
    y: 0,
    w: widget.w ?? DEFW[widget.viz],
    h: widget.h ?? DEFH[widget.viz],
  });
  const bottom = list.reduce((m, i) => Math.max(m, (Number(i.y) || 0) + (Number(i.h) || 0)), 0);
  return { ...widget, x: 0, y: bottom, w: g.w, h: g.h };
}

/**
 * The phone's reorder: swap a card with its neighbour in the stacked (y, x)
 * reading order, then settle and pack so unequal sizes cannot overlap.
 * Returns the SAME array reference when the move is off either end — the
 * caller can cheaply tell a no-op from a change.
 */
export function stackMove(list, id, dir) {
  const sorted = list.map(clone).sort(byYX);
  const i = sorted.findIndex((p) => p.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sorted.length) return list;
  const a = sorted[i];
  const b = sorted[j];
  [a.x, b.x] = [b.x, a.x];
  [a.y, b.y] = [b.y, a.y];
  // Unequal widths can hand the wider card an x past the right edge — a w-12
  // card given x 8 drafts x+w 20, and the backend's x+w<=COLS gate 422s the
  // save. Settle and pack only ever move y, so x is re-clamped here.
  a.x = Math.max(0, Math.min(a.x, COLS - a.w));
  b.x = Math.max(0, Math.min(b.x, COLS - b.w));
  return pack(settle(sorted, []));
}

/** The table's column cut: the chooser's pick, capped at 3 when narrow. */
export function capColumns(cols, w) {
  return w < 8 ? cols.slice(0, 3) : cols;
}
