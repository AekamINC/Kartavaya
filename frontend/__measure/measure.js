/* __measure/measure.js — the ONE measurement routine both sides run.
 * Nothing here is transcribed by hand: every number comes from
 * getComputedStyle / getBoundingClientRect on a rendered node.
 */
export function px(v) { return v; }

export function probe(doc, sel, props, label) {
  const e = doc.querySelector(sel);
  if (!e) return { label: label || sel, sel, MISSING: true };
  const cs = (doc.defaultView || window).getComputedStyle(e);
  const r = e.getBoundingClientRect();
  const o = { label: label || sel, sel, _w: +r.width.toFixed(2), _h: +r.height.toFixed(2) };
  for (const p of props) o[p] = cs.getPropertyValue(p).trim();
  return o;
}

export const P = {
  BOX: ['width', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border-radius', 'border-top-width', 'border-top-style', 'border-top-color',
    'background-color', 'box-shadow', 'gap', 'row-gap', 'column-gap', 'min-height'],
  TYPE: ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
    'text-transform', 'color', 'font-style'],
  LAYOUT: ['display', 'grid-auto-columns', 'grid-template-columns', 'gap', 'column-gap',
    'align-items', 'overflow-x', 'padding-bottom', 'flex-direction'],
  SIZE: ['width', 'height', 'border-radius', 'font-size', 'font-weight', 'background-color',
    'box-shadow', 'margin-left', 'letter-spacing'],
};

/* Two nodes reported side by side is how a ratio gets checked without anyone
 * typing one. */
export function tokens(doc, names) {
  const cs = (doc.defaultView || window).getComputedStyle(doc.documentElement);
  const o = {};
  for (const n of names) o[n] = cs.getPropertyValue(n).trim();
  return o;
}

export const TOKEN_NAMES = [
  '--row-h', '--pad-page', '--pad-card', '--gap-section', '--gap-tight',
  '--t-body', '--t-body-sm', '--t-label', '--t-title', '--t-headline', '--t-display',
  '--radius-base', '--r-xs', '--r-sm', '--r-md', '--r-lg', '--r-pill',
  '--shadow-1', '--shadow-2', '--shadow-4',
  '--font-hindi', '--font-indic', '--font-mono', '--font-display', '--font-ui',
  '--primary', '--primary-text', '--on-surface', '--on-surface-2', '--on-surface-3',
  '--on-surface-faint', '--outline', '--outline-variant', '--surface', '--s-low',
  '--s-container', '--dur-fast', '--dur-base', '--dur-slow', '--ease-emph',
];

export function rootAttrs(doc) {
  const el = doc.documentElement;
  const o = {};
  for (const n of el.getAttributeNames()) o[n] = el.getAttribute(n);
  return o;
}

/* Devanagari tracking is a recurring defect here, so it gets its own pass:
 * every node whose text contains Devanagari, with the tracking and family that
 * actually landed on it. */
export function devanagari(doc) {
  const re = /[ऀ-ॿ]/;
  const win = doc.defaultView || window;
  const out = [];
  const seen = new Set();
  doc.querySelectorAll('*').forEach((e) => {
    const own = [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('');
    if (!re.test(own)) return;
    const cs = win.getComputedStyle(e);
    const key = e.className + '|' + cs.letterSpacing + '|' + cs.fontFamily + '|' + cs.textTransform;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      cls: typeof e.className === 'string' ? e.className : '',
      text: own.trim().slice(0, 24),
      'font-family': cs.fontFamily,
      'font-size': cs.fontSize,
      'font-weight': cs.fontWeight,
      'letter-spacing': cs.letterSpacing,
      'text-transform': cs.textTransform,
    });
  });
  return out;
}

export function classInventory(doc, rootSel) {
  const root = doc.querySelector(rootSel) || doc.body;
  const s = new Set();
  root.querySelectorAll('*').forEach((e) => {
    const c = typeof e.className === 'string' ? e.className : '';
    c.split(/\s+/).forEach(x => x && s.add(x));
  });
  return [...s].sort();
}
