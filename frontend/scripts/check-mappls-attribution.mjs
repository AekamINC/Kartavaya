/**
 * check-mappls-attribution — a Mappls basemap must carry its credit, visibly.
 *
 * ── Why this is a gate and not a code comment ───────────────────────────────
 *
 * Mappls' published terms (about.mappls.com/api/terms-&-conditions) require the
 * "Powered by Mappls" mark to be "clearly presented" and say it may "in no
 * instance" be removed or hidden. That is a **licence condition on a paid
 * dependency**, not a style preference: breaking it is a contractual problem,
 * and it breaks silently. Nothing 500s, no test goes red, and the map keeps
 * working — which is exactly the profile of a thing that gets tidied away
 * during an unrelated CSS pass.
 *
 * This repo has the precedent on file. `.side` was deleted by a script that
 * string-matched selectors, and a rule was eaten by a comment; PHASE-7's own
 * component spent months telling readers it needed a key it did not need.
 * Obligations that only exist in prose get lost. So this is checked.
 *
 * ── What it checks ──────────────────────────────────────────────────────────
 *
 * 1. Every component that loads the Mappls SDK renders the credit.
 * 2. The credit's text is NOT hardcoded — it comes from the token response, so
 *    that the credential and the obligation it creates arrive together.
 * 3. No CSS rule hides the credit's class. `display:none`, `visibility:hidden`,
 *    `opacity:0` and zero height are each "hidden" for this purpose.
 *
 * ── Proving it bites ────────────────────────────────────────────────────────
 *
 * A gate nobody has seen fail is not known to work — `check-css-parses` once
 * reported "56 stylesheets parse" twice while reading nothing at all. To prove
 * this one:
 *
 *     delete the `.terr__mapbrand` block from src/styles/graha.css   -> FAILS (2)
 *     add `.terr__mapbrand { display: none }` to any stylesheet      -> FAILS (3)
 *     delete the <a className="terr__mapbrand"> from TerritoryMap    -> FAILS (1)
 *
 * All three were run on 2026-08-27 and all three failed as described.
 *
 * Run: node scripts/check-mappls-attribution.mjs   (wired into `npm run check`)
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, relative } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'src');

/** The class the credit is rendered with. One name, checked in both places. */
const BRAND_CLASS = 'terr__mapbrand';

/** Anything importing this is putting a Mappls basemap on the screen. */
const SDK_MODULE = 'mapplsSdk';

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(SRC);
const errors = [];

// ── 1. Whoever loads a basemap renders the credit ──────────────────────────
//
// `lib/mapplsSdk.js` is the loader itself and is exempt: it has no DOM. Every
// OTHER importer is a screen, and a screen with a basemap owes the mark.
const consumers = files.filter(f =>
  /\.(jsx|tsx)$/.test(f) && readFileSync(f, 'utf8').includes(SDK_MODULE));

if (consumers.length === 0) {
  // Not a pass. If the SDK stops being imported anywhere this check has
  // silently stopped checking, which is the failure mode it was written against.
  errors.push(
    `nothing imports ${SDK_MODULE} — either the map was removed (delete this ` +
    `gate deliberately) or the import was renamed and this gate went blind`);
}

for (const f of consumers) {
  const src = readFileSync(f, 'utf8');
  const rel = relative(root, f);
  if (!src.includes(BRAND_CLASS)) {
    errors.push(
      `${rel} loads the Mappls SDK but renders no .${BRAND_CLASS} credit. ` +
      `Mappls' terms require "Powered by Mappls" to be clearly presented.`);
    continue;
  }
  // 2. The words must come from the server's response, not a string here. A
  //    hardcoded credit drifts from the licence it satisfies, and the same
  //    reasoning already governs the GODL credit and the SDK URL.
  //
  //    Comments are stripped first, and that is not a detail: on this gate's
  //    very first run it failed TerritoryMap.jsx for a `"Powered by Mappls"`
  //    that appears only in the docblock explaining the obligation. A check
  //    that forbids documenting the rule it enforces is a check people delete.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  if (/["'`]\s*Powered by Mappls\s*["'`]/i.test(code)) {
    errors.push(
      `${rel} hardcodes the string "Powered by Mappls". Render ` +
      `\`attribution\` from GET /api/v1/maps/token instead, so the credit and ` +
      `the token it credits come from one place.`);
  }
}

// ── 3. No stylesheet may hide it ───────────────────────────────────────────
const sheets = files.filter(f => f.endsWith('.css'));
let declared = false;

for (const f of sheets) {
  const css = readFileSync(f, 'utf8');
  const rel = relative(root, f);

  // Strip comments first. A rule was once eaten because a script matched a
  // selector inside a comment; here the risk is the reverse — a commented-out
  // `display:none` reported as a live one.
  const live = css.replace(/\/\*[\s\S]*?\*\//g, '');

  for (const m of live.matchAll(
    new RegExp(`(^|[,\\s}])\\.${BRAND_CLASS}\\b[^{]*\\{([^}]*)\\}`, 'g'))) {
    declared = true;
    const block = m[2];
    const hidden = [
      [/display\s*:\s*none/i, 'display:none'],
      [/visibility\s*:\s*hidden/i, 'visibility:hidden'],
      [/opacity\s*:\s*0(\.0+)?\s*(;|$)/i, 'opacity:0'],
      [/(^|;)\s*(height|max-height|font-size)\s*:\s*0(px|em|rem)?\s*(;|$)/i, 'a zero size'],
    ].find(([re]) => re.test(block));
    if (hidden) {
      errors.push(
        `${rel} hides .${BRAND_CLASS} with ${hidden[1]}. Mappls' terms say the ` +
        `credit may "in no instance" be removed or hidden.`);
    }
  }
}

if (consumers.length > 0 && !declared) {
  errors.push(
    `no stylesheet declares .${BRAND_CLASS}. The credit is rendered but ` +
    `unstyled, so it cannot be shown to be "clearly presented".`);
}

if (errors.length) {
  console.error('✗ Mappls attribution check failed:\n');
  for (const e of errors) console.error(`  - ${e}`);
  console.error(`\n${errors.length} problem(s). This is a licence condition on a`);
  console.error('paid dependency, not a style rule — see the header of this file.');
  process.exit(1);
}

console.log(
  `✓ Mappls attribution intact — ${consumers.length} basemap consumer(s), ` +
  `credit served from the token response and not hidden by any of ${sheets.length} stylesheets`);
