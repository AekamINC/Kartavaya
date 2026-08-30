/**
 * check-touch-targets.mjs — finds interactive controls that stay under 44px
 * once the mobile rules have had their say.
 *
 * 15-mobile-web.md §Hit targets: "44px minimum, no exceptions." The existing
 * mobile-responsive.css block is careful and measured, but it is a HAND-WRITTEN
 * list of selectors, so the only thing keeping it complete is somebody
 * remembering. This finds the ones nobody remembered.
 *
 * Method:
 *   1. Collect every rule that declares a hard size — height, min-height,
 *      width, min-width — with a px value under 44.
 *   2. Keep the ones whose selector looks INTERACTIVE: a button/a/input
 *      element, or a class whose name carries a control word (btn, icon, tab,
 *      chip, close, toggle, swatch, action, menu, x, eye, ...). A 20px avatar
 *      is not a tap target; a 20px close button is.
 *   3. Replay the mobile cascade: for each candidate, look for any rule inside a
 *      mobile-matching @media that raises the same axis to >=44 and whose
 *      selector could match the same element.
 *   4. Report what is left.
 *
 * "Could match the same element" is deliberately generous — it compares the
 * LAST class in each selector, so `.bd .bd__cx` is understood to cover `.bd__cx`.
 * Being generous means this under-reports rather than crying wolf, which is the
 * right bias for a checker somebody has to trust.
 *
 * Reports only. Padding, flex centring and pseudo-element hit expansion are all
 * legitimate ways to reach 44px that a size-only scan cannot see, so a hit here
 * is a question, not a verdict.
 *
 * Usage: node scripts/check-touch-targets.mjs      (from frontend/)
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';

const STYLE_DIR = 'src/styles';
if (!existsSync(STYLE_DIR)) {
  console.error('check-touch-targets: run from the frontend/ directory.');
  process.exit(1);
}

const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

/** Rules, carrying the @media condition stack they sit inside. */
function parseRules(css, file) {
  const out = [];
  const lineAt = (i) => css.slice(0, i).split('\n').length;
  (function walk(start, end, media) {
    let i = start;
    while (i < end) {
      const open = css.indexOf('{', i);
      if (open === -1 || open >= end) return;
      const sel = css.slice(i, open).trim().replace(/\s+/g, ' ');
      let depth = 1, j = open + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === '{') depth++;
        else if (css[j] === '}') depth--;
        j++;
      }
      if (/^@(media|supports|layer|container)/.test(sel)) {
        walk(open + 1, j - 1, sel.startsWith('@media') ? [...media, sel] : media);
      } else if (sel && !sel.startsWith('@')) {
        out.push({ sel, body: css.slice(open + 1, j - 1), file, line: lineAt(open), media });
      }
      i = j;
    }
  })(0, css.length, []);
  return out;
}

const rules = [];
for (const f of readdirSync(STYLE_DIR).filter((f) => f.endsWith('.css')).sort()) {
  rules.push(...parseRules(stripComments(readFileSync(join(STYLE_DIR, f), 'utf8')), f));
}

/** A @media stack that a phone or a coarse pointer would match. */
const isMobileMedia = (media) => media.some((m) =>
  /max-width:\s*(\d+)px/.test(m) && parseInt(/max-width:\s*(\d+)px/.exec(m)[1], 10) <= 1023
  || /pointer:\s*coarse/.test(m) || /hover:\s*none/.test(m));

/**
 * The first version of this matched any selector containing "dot", "act", "x"
 * or "item" and produced 112 findings, nearly all of them decoration: a 6px
 * `.k-statuschip__dot` is not a tap target, it is a dot INSIDE one. A checker
 * with a 90% false-positive rate is a checker nobody reads.
 *
 * So: the selector must plausibly BE the control. Either a genuinely
 * interactive element, or a class whose FINAL segment is a control noun.
 * Decorative sub-elements and pseudo-elements are excluded outright — their
 * hit area belongs to the parent, which is measured on its own.
 */
const CONTROL_TAIL = /(btn|button|iconbtn|close|dismiss|toggle|tgl|cbx|rdo|swatch|eye|fab|kebab|more|cx|send|mic|trigger|handle|stepper|chev)$/i;
const ELEMENT_INTERACTIVE = /(^|[\s,>+~])(button|a|input|select|textarea|summary)(\[|[:.\s,]|$)/i;
const DECORATIVE = /(__|--)?(dot|sep|bar|mark|line|rule|ring|ind|track|fill|glow|halo|shadow|grab|caret|tail|arrow)$/i;

function looksInteractive(sel) {
  const first = sel.split(',')[0].trim();
  if (/::(before|after|marker|placeholder|selection|backdrop)/.test(first)) return false;
  const k = key(first).replace(/^\./, '');
  if (DECORATIVE.test(k)) return false;
  if (ELEMENT_INTERACTIVE.test(first)) return true;
  // Final BEM segment, e.g. `.dr__lb-x` -> `x`, `.k-iconbtn` -> `k-iconbtn`.
  const tail = k.split(/__|-(?=[a-z])/).pop();
  return CONTROL_TAIL.test(k) || CONTROL_TAIL.test(tail);
}

/** Last class token of ONE selector — the thing the element is most likely named. */
function keyOf(one) {
  const parts = one.trim().split(/[\s>+~]+/);
  const last = parts[parts.length - 1] || '';
  const m = last.match(/\.([\w-]+)/g);
  return m ? m[m.length - 1] : last.replace(/[:[(].*$/, '');
}
const key = (sel) => keyOf(sel.split(',')[0]);
/**
 * EVERY selector in a list, not just the first. Registering only the first is
 * why `.svbtn.svbtn, .k-file__more.k-file__more, .k-onboard__iconbtn…` credited
 * one control and left the other two reported as unfixed.
 */
const keysOf = (sel) => sel.split(',').map(keyOf).filter(Boolean);

function decls(body) {
  const out = {};
  for (const chunk of body.split(';')) {
    const c = chunk.indexOf(':');
    if (c > 0) out[chunk.slice(0, c).trim()] = chunk.slice(c + 1).trim();
  }
  return out;
}

const AXES = { height: 'v', 'min-height': 'v', width: 'h', 'min-width': 'h' };
const px = (v) => { const m = /^(-?[\d.]+)px$/.exec((v || '').trim()); return m ? parseFloat(m[1]) : null; };

/** Everything the mobile cascade raises to >=44, keyed by element name + axis. */
const raised = new Set();
/**
 * Hit area expanded by an absolutely-positioned pseudo-element, which is what
 * 15 §Hit targets prescribes when the control must stay visually small. There
 * is no size declaration on the control itself, so a size-only scan calls a
 * correctly-fixed checkbox broken. `inset: -13.5px` on a 17px box IS 44px.
 */
for (const r of rules) {
  if (!isMobileMedia(r.media)) continue;
  const d = decls(r.body);

  const insetM = /^(-[\d.]+)px(?:\s+(-?[\d.]+)px)?/.exec(d.inset || '');
  if (insetM && /absolute|fixed/.test(d.position || '') && /::(before|after)/.test(r.sel)) {
    const v = Math.abs(parseFloat(insetM[1]));
    const h = insetM[2] != null ? Math.abs(parseFloat(insetM[2])) : v;
    for (const k of keysOf(r.sel)) {
      const base = k.replace(/::(before|after)$/, '');
      // Reach on each side, doubled, plus the control's own size — recorded as
      // "expanded"; the size check below adds the control's declared size.
      raised.add(`${base}|expand-v|${v}`);
      raised.add(`${base}|expand-h|${h}`);
    }
  }

  for (const [prop, axis] of Object.entries(AXES)) {
    const n = px(d[prop]);
    if (n !== null && n >= 44) for (const k of keysOf(r.sel)) raised.add(`${k}|${axis}`);
  }
}
/** Does a pseudo-element overlay carry `size` up to 44 on this axis? */
function expandedTo44(k, axis, size) {
  const tag = axis === 'v' ? 'expand-v' : 'expand-h';
  for (const entry of raised) {
    const [ek, etag, evRaw] = entry.split('|');
    if (ek !== k || etag !== tag) continue;
    if (size + 2 * parseFloat(evRaw) >= 44) return true;
  }
  return false;
}

/**
 * Verified unreachable at mobile widths, with the rule that makes it so.
 * Recorded rather than silently filtered: the next person to read this should
 * get the reason, not just the absence.
 */
const UNREACHABLE_ON_MOBILE = [
  // editorial.css `@media (max-width: 1023px) { .kv__side { display: none } }`
  // hides the entire sidebar and swaps in .kv__mobbar + MobileDrawer, so the
  // rail-mode collapse toggle cannot be tapped on a phone or tablet at all.
  [/\.side--rail\b/, '.kv__side is display:none below 1024px'],
];

const findings = [];
for (const r of rules) {
  if (isMobileMedia(r.media)) continue;          // already a mobile rule
  if (!looksInteractive(r.sel)) continue;
  if (UNREACHABLE_ON_MOBILE.some(([re]) => re.test(r.sel))) continue;
  const d = decls(r.body);
  for (const [prop, axis] of Object.entries(AXES)) {
    const n = px(d[prop]);
    if (n === null || n >= 44) continue;
    const k = key(r.sel);
    if (raised.has(`${k}|${axis}`)) continue;
    if (expandedTo44(k, axis, n)) continue;
    findings.push({ sel: r.sel, at: `${r.file}:${r.line}`, prop, value: n, axis });
  }
}

// One row per element+axis; the smallest declaration is the one that matters.
const seen = new Map();
for (const f of findings) {
  const k = `${key(f.sel)}|${f.axis}`;
  if (!seen.has(k) || seen.get(k).value > f.value) seen.set(k, f);
}
const rows = [...seen.values()].sort((a, b) => a.value - b.value);

console.log(`check-touch-targets: ${rules.length} rules · ${raised.size} element/axis pairs raised to >=44px by a mobile rule\n`);

if (rows.length) {
  console.log(`${rows.length} interactive control(s) under 44px with no mobile rule raising that axis:\n`);
  for (const f of rows) {
    console.log(`  ${String(f.value).padStart(5)}px  ${f.prop.padEnd(10)}  ${f.sel}`);
    console.log(`           ${f.at}`);
  }
  console.log('\nA size-only scan cannot see padding or flex centring reaching 44px, so\n' +
    'verify before changing anything — but a NEW one still fails, see below.');
} else {
  console.log('no interactive control declared under 44px without a mobile rule raising it');
}

/* ── RATCHET, added 2026-08-30 ──────────────────────────────────────────────
 *
 * THIS GATE WAS REPORT-ONLY AND RAN IN NEITHER `npm run check` NOR CI. Those
 * two facts together are the exact condition the contrast gate's comment warns
 * about — a check whose presence reads as coverage while it can never fail. It
 * has been finding these controls for weeks with nobody being told.
 *
 * It stays advisory ABOUT ITS BASELINE, because its own header is honest that a
 * size-only scan cannot see padding, flex centring or a pseudo-element overlay
 * reaching 44px. So what it finds today is recorded BY NAME and the next one
 * fails the build. The list may shrink; it may never grow.
 *
 * The rendered counterpart — measuring the box a finger actually hits, at a
 * real phone viewport, where none of that inference is needed — is
 * `e2e-real/xbrowser-smoke.spec.ts`. Two checks of one rule from opposite ends;
 * when they disagree, this one was guessing.
 *
 * Re-record after a genuine fix:  node scripts/check-touch-targets.mjs --write
 */
const BASELINE_URL = new URL('touch-targets-baseline.json', import.meta.url);
const idOf = (f) => `${f.sel} | ${f.prop}`;
const current = rows.map(idOf).sort();

if (process.argv.includes('--write')) {
  writeFileSync(BASELINE_URL, `${JSON.stringify({
    _comment: 'Interactive controls declared under 44px. SHRINK ONLY — see check-touch-targets.mjs.',
    _recorded: new Date().toISOString().slice(0, 10),
    under44: current,
  }, null, 2)}\n`);
  console.log(`\nrecorded ${current.length} known finding(s) to scripts/touch-targets-baseline.json`);
  process.exit(0);
}

if (!existsSync(BASELINE_URL)) {
  console.error('\ncheck-touch-targets: no baseline file. Create it with --write.');
  process.exit(1);
}

const baseline = new Set(JSON.parse(readFileSync(BASELINE_URL, 'utf8')).under44);
const fresh = current.filter((k) => !baseline.has(k));
const fixed = [...baseline].filter((k) => !current.includes(k)).sort();

if (fixed.length) {
  console.log(`\n✓ ${fixed.length} baselined finding(s) are gone. Shrink the baseline (--write):`);
  for (const k of fixed) console.log(`    ${k}`);
}
if (fresh.length) {
  console.error(`\n✘ ${fresh.length} NEW control(s) under 44px, not in the baseline:`);
  for (const k of fresh) console.error(`    ${k}`);
  console.error('\n  design-handover/15-mobile-web.md §Hit targets: "44px minimum, no exceptions."');
  console.error('  Reach 44 with padding if the visual size must stay small — that is what the');
  console.error('  baselined ones are assumed to do. Do NOT add a line to the baseline to go green.');
  process.exit(1);
}
console.log(`\ncheck-touch-targets: no new findings; ${baseline.size} held at baseline.`);
