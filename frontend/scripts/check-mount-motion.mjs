/**
 * check-mount-motion.mjs — a bar that is SIZED FROM DATA must animate on
 * arrival, or the build fails.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * A CSS transition needs a previous value to interpolate FROM. On mount there
 * is none: React renders the element with `width: 62%` already applied, that is
 * its first computed style, nothing has changed, and nothing transitions. Only
 * an `animation` runs on mount.
 *
 * Twenty-two rules in this repo were written as
 *
 *     .some__fill { height: 100%; transition: width var(--dur-xslow) var(--ease-fill); }
 *
 * and every one of them painted at full size on frame one. The duration and the
 * easing were chosen, reviewed and tokenised, and had never run — for most of
 * these bars the value is written once, from the fetch that drew them, and
 * never changes again. The product looked static because it WAS static, and the
 * stylesheets read as though it were not. That is the specific way this defect
 * hides: the evidence of the feature is right there in the source.
 *
 * No existing gate could see it. check-motion cares whether a duration is
 * tokenised, not whether it ever elapses. check-orphan-keyframes catches a
 * keyframe nobody names — but these rules name no keyframe at all, which is the
 * whole problem. check-orphan-selectors catches a rule nobody renders; these
 * are rendered, they just never move.
 *
 * ── WHAT IT CHECKS ─────────────────────────────────────────────────────────
 *
 * For every rule that transitions `width` or `height`, some rule somewhere must
 * declare an `animation` for the same selector. Somewhere, not the same rule:
 * the fix for the sweep put one shared `:is(...)` block in animations.css and
 * left thirteen stylesheets untouched, and that must keep passing. `:is()`
 * lists are expanded before matching for exactly that reason.
 *
 * A transition is NOT removed by the fix and is not what this gate objects to.
 * A sidebar collapsing, a drawer resizing and a tab indicator sliding all have
 * a genuine previous value; those live in the baseline with their reason.
 *
 * ── WHAT IT DOES NOT CHECK, AND WHY THAT IS HONEST ─────────────────────────
 *
 * · `transition: all`. It would catch these too, but `all` is common on
 *   buttons and cards where no size is animated, and a gate that reports
 *   mostly noise is a gate people stop reading.
 * · Inline `style={{ transition }}` in JSX. Out of scope; check-motion already
 *   owns the JSX surface for durations.
 * · Whether the animation is the RIGHT one. It cannot know that. It checks
 *   that arrival was considered at all, which is the thing that was skipped
 *   twenty-two times.
 *
 * ── THE BASELINE ───────────────────────────────────────────────────────────
 *
 * scripts/mount-motion-baseline.json, keyed `file|selector`, each entry
 * carrying its own REASON. Two kinds live there: transitions that are correct
 * because they respond to a real change, and bar fills that are DEAD — written,
 * never rendered, and already held in orphan-selectors-baseline.json. The dead
 * ones must not be animated; the fix for them is deletion. Regenerate with
 * `node scripts/check-mount-motion.mjs --write`, but a new entry is a claim you
 * are making and it needs its reason filled in by hand.
 */

import { readFileSync, writeFileSync } from 'fs';
import { relative } from 'path';
import postcss from 'postcss';
import { stylesheets } from './check-motion.mjs';

const BASELINE = 'scripts/mount-motion-baseline.json';

/** `width`/`height` as whole properties — never `max-width`, `line-height`. */
const SIZED = /(^|[\s,])(width|height)([\s,]|$)/;

/**
 * `PREFIX:is(a, b)SUFFIX` -> [`PREFIXaSUFFIX`, `PREFIXbSUFFIX`]. Only a flat
 * `:is()` is expanded: the inner pattern excludes parentheses, so a nested
 * `:is(a, b:not(c))` simply does not expand and may report a finding that has
 * to be baselined. Preferring a false report to a missed one is the right way
 * round for a gate — a wrong pass is invisible, a wrong failure is not.
 */
function expandIs(sel) {
  const m = sel.match(/^(.*?):is\(([^()]*)\)(.*)$/);
  if (!m) return [sel.replace(/\s+/g, ' ').trim()];
  const [, pre, inner, post] = m;
  return inner.split(',').flatMap((part) => expandIs(`${pre}${part.trim()}${post}`));
}

const selectorsOf = (rule) => rule.selectors.flatMap(expandIs);

export function scan(root = '.') {
  const animated = new Set();
  const transitions = [];

  for (const file of stylesheets(root)) {
    const rel = relative(root, file).replace(/\\/g, '/');
    let css;
    try {
      css = postcss.parse(readFileSync(file, 'utf8'), { from: file });
    } catch {
      continue; // check-css-parses owns unparseable stylesheets, not this gate.
    }
    css.walkRules((rule) => {
      // A `from`/`to`/`50%` inside @keyframes is not a selector.
      if (rule.parent && rule.parent.type === 'atrule' && /keyframes/i.test(rule.parent.name)) return;

      let hasAnim = false;
      let sizedTransition = null;
      rule.walkDecls((d) => {
        const prop = d.prop.toLowerCase();
        const val = d.value.toLowerCase();
        if ((prop === 'animation' || prop === 'animation-name') && !/^\s*none\s*$/.test(val)) {
          hasAnim = true;
        }
        if ((prop === 'transition' || prop === 'transition-property') && SIZED.test(val)) {
          sizedTransition = d;
        }
      });

      if (hasAnim) for (const s of selectorsOf(rule)) animated.add(s);
      if (sizedTransition) {
        const line = (sizedTransition.source && sizedTransition.source.start)
          ? sizedTransition.source.start.line : 0;
        for (const s of selectorsOf(rule)) transitions.push({ file: rel, selector: s, line });
      }
    });
  }
  return { animated, transitions };
}

export function findFaults(root = '.') {
  const { animated, transitions } = scan(root);
  return transitions
    .filter((t) => !animated.has(t.selector))
    .map((t) => ({ ...t, key: `${t.file}|${t.selector}` }));
}

function loadBaseline() {
  try { return JSON.parse(readFileSync(BASELINE, 'utf8')); }
  catch { return { note: '', held: {} }; }
}

if (process.argv[1] && process.argv[1].endsWith('check-mount-motion.mjs')) {
  const faults = findFaults('.');
  const base = loadBaseline();
  const held = base.held || {};

  if (process.argv.includes('--write')) {
    const next = {
      note: base.note || 'Rules that transition width/height with no mount animation, accepted deliberately. Each entry needs a REASON. Shrink this file; do not grow it.',
      generated: base.generated || 'unknown',
      held: Object.fromEntries(faults.map((f) => [f.key, held[f.key] || { reason: 'TODO' }])),
    };
    writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`check-mount-motion: baseline rewritten with ${faults.length} entr(ies).`);
    process.exit(0);
  }

  const fresh = faults.filter((f) => !held[f.key]);
  const stale = Object.keys(held).filter((k) => !faults.some((f) => f.key === k));

  if (stale.length) {
    console.log(`check-mount-motion: ${stale.length} baseline entr(ies) no longer apply — remove from ${BASELINE}:`);
    for (const k of stale) console.log(`  ${k}`);
  }

  if (fresh.length) {
    console.error('\ncheck-mount-motion: a bar sized from data that never animates on arrival:\n');
    for (const f of fresh) console.error(`  ${f.file}:${f.line}  ${f.selector}`);
    console.error(`
A transition needs a PREVIOUS value. On mount there is none, so the
duration above never elapses and the bar paints full-size on frame one.
Give the selector an animation — animations.css declares ixGrowX and
ixGrowY for exactly this — or, if the transition really does respond to a
later change, add it to ${BASELINE} WITH THE REASON.`);
    process.exit(1);
  }

  console.log(`check-mount-motion: ${faults.length} sized transition(s) without a mount animation (${faults.length} held, 0 new).`);
}
