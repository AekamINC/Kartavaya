/**
 * check-rendered-ids.mjs — no user, member, org or record id is ever DRAWN.
 *
 * The owner's rule, 2026-08-07: "no user id, member id or org id is ever
 * displayed, anywhere, to anyone — including Aekam's own admin and log
 * screens". A person is identified by their name.
 *
 * ── Why this is a check and not a grep ──────────────────────────────────────
 *
 * `grep -rn "user_id" src` returns hundreds of hits and every one of them is
 * legitimate: a query parameter, a comparison, a React `key`, a lookup into a
 * map, an argument to an endpoint. The id is a KEY and keys are load-bearing.
 * What is forbidden is the id appearing in a RENDERED POSITION — as the text a
 * human reads.
 *
 * So the distinction this makes is positional, which is the one thing a grep
 * cannot make:
 *
 *     key={task.task_id}                   fine — an attribute, never drawn
 *     onPress={() => open(task.task_id)}   fine — an argument
 *     {members.filter(m => m.user_id …)}   fine — the id is being compared
 *     <Text>{task.task_id.slice(0, 8)}</Text>          FAILS — this was live
 *     <span>{a.user_id}</span>                          FAILS
 *     {uid.charAt(0).toUpperCase()}                     FAILS — this was live
 *
 * Both real failures it was written against were shipped and neither was
 * visible to any existing check: `mobile/src/components/TaskCard.tsx` drew
 * `task_id.slice(0, 8)` on the top row of every card, and drew the first
 * character of an assignee's UUID as their avatar initial — so a stack of three
 * colleagues read "3", "a", "f".
 *
 * ── What counts as a rendered position ──────────────────────────────────────
 *
 * A `{…}` sitting where JSX CHILDREN go, which is the only place a value
 * becomes text. Two shapes, and nothing else:
 *
 *   · on one line, the brace is adjacent to markup — `>{expr}` or `{expr}<`
 *   · on its own line, with the previous non-blank line ending in `>` and the
 *     next non-blank line starting with `<`
 *
 * "Every brace that is not an attribute value" was the first attempt and it was
 * useless: it flagged 551 sites, nearly all of them destructured imports,
 * object literals and function parameters, because those are braces too. A
 * check with that signal-to-noise is a check somebody deletes. Anything the
 * narrow rule misses is a miss; anything it reports is real.
 *
 * ── What counts as an id being drawn ────────────────────────────────────────
 *
 * The whole expression has to READ like an id and nothing else — an id-suffixed
 * path, optionally sliced, cased, or defaulted through `||` / `??`. An
 * interpolation containing a comparison, a conditional, a `.map(`, a JSX tag or
 * a predicate is a control-flow expression that happens to mention an id, and
 * is left alone. False positives get a check switched off; this one is
 * deliberately narrow and will miss a sufficiently creative id render.
 *
 * The pairing that makes it hold anyway is the `ALLOW` list below: it is empty,
 * and an entry added to it is a decision somebody has to write down.
 *
 * Usage: node scripts/check-rendered-ids.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, extname, relative } from 'path';
import { fileURLToPath } from 'url';

// `fileURLToPath`, not `.pathname` — see check-write-gates.mjs for the Windows
// reason. Both trees are scanned by one script because the rule is one rule:
// the web audit screen and the mobile task card broke it in the same week.
const ROOTS = [
  fileURLToPath(new URL('../src', import.meta.url)),
  fileURLToPath(new URL('../../mobile/src', import.meta.url)),
].filter(existsSync);

const EXTS = new Set(['.jsx', '.tsx']);

/**
 * The identifiers that are not OURS to hide.
 *
 * The rule is about the ids this product mints — user, member, org, task, line,
 * team — which identify a person or a record and mean nothing outside the
 * database. An identifier issued by somebody ELSE and quoted back to its owner
 * is a different thing: it is the only handle they have for reconciling what
 * they see here against what they see there, and hiding it makes support harder
 * rather than easier.
 *
 * Four, each with the reason it is not a violation. Adding a fifth means
 * writing one.
 */
const ALLOW = new Set([
  // The AD NETWORK's account id, as Meta or Google shows it in their console.
  // Matching this table against that console is the entire point of the column;
  // our own row id, which it used to fall back to, is not — that fallback was
  // removed rather than allowed.
  'src/pages/prachar/AdsTab.jsx:211',
  // The Apify actor slug — `apify/gstin-scraper`. Human-readable by
  // construction, and the cost table exists to be reconciled against Apify's
  // own bill, which lists the same string.
  'src/pages/AdminCostDashboardPage.jsx:444',
  // The carrier's receipt for one message. It is what support quotes to Resend
  // or to Meta when a customer says a message never arrived; without it a
  // delivery log cannot be traced past our own edge.
  'src/pages/billing/OutboundLog.jsx:615',
  // A UPI address (`name@bank`) that the org typed in themselves and prints on
  // its own invoices. An identifier they own, not one we assigned.
  'src/pages/ganit/_shared.jsx:140',
]);

/**
 * A path that ends in an id. `_id`, `_ids`, and the camel forms — plus bare
 * `uid`/`uuid`, which is what the avatar stack was iterating.
 */
const ID_PATH = /\b[\w.?\[\]]*(?:_ids?|Id|Ids|uid|uuid|Uuid|UUID)\b/;

/**
 * Things that make an interpolation control flow rather than a render. If any
 * appears, the id inside it is being USED, not drawn.
 */
const NOT_A_RENDER = /(===|!==|==|!=|&&|\|\||\?\.|=>|<|>|;|\?|\.map\(|\.filter\(|\.includes\(|\.find\(|\.some\(|\.indexOf\(|\.length)/;

/**
 * `||` and `??` are fallbacks and DO render — `{a.actor_name || a.user_id}`
 * draws the id whenever the name is missing, which is exactly the bug in the
 * audit trail. So they are checked for separately, after `NOT_A_RENDER` has
 * excluded `||` used as a boolean.
 */
const FALLBACK = /(\|\||\?\?)/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__' || name === '__mocks__') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXTS.has(extname(p))) out.push(p);
  }
  return out;
}

/**
 * The `{…}` interpolations in a line that sit in a JSX CHILD position.
 *
 * Brace-balanced rather than regex-matched, so a nested object or a template
 * literal inside the interpolation does not end it early.
 *
 * `prevEnds` / `nextStarts` carry the neighbouring non-blank lines, which is
 * what recognises a child spread over three lines.
 */
function interpolations(line, prevLine, nextLine) {
  const out = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== '{') continue;
    const end = skip(line, i);
    if (end == null) break;

    const before = line.slice(0, i).trimEnd();
    const after = line.slice(end + 1).trimStart();
    // `=>` also ends in `>`, and an arrow's BODY is a block, not a child. Left
    // in, every `onSelect={id => { setId(id); }}` reported itself.
    const adjacent = (before.endsWith('>') && !before.endsWith('=>'))
      || after.startsWith('<');
    const ownLine = before === '' && after === ''
      && prevLine.trimEnd().endsWith('>')
      && nextLine.trimStart().startsWith('<');

    if (adjacent || ownLine) out.push(line.slice(i + 1, end).trim());
    i = end;
  }
  return out;
}

/** Index of the `}` closing the `{` at `from`, or null if the line ends first. */
function skip(line, from) {
  let depth = 0;
  for (let i = from; i < line.length; i++) {
    if (line[i] === '{') depth++;
    else if (line[i] === '}' && --depth === 0) return i;
  }
  return null;
}

function offends(expr) {
  if (!expr || !ID_PATH.test(expr)) return false;
  // `{assignedLabel(c.assigned_to, meId)}` draws whatever the function returns,
  // and that function's whole job is to turn an id into a label. A call whose
  // CALLEE is not itself id-shaped is judged by its name, not by its arguments.
  const call = expr.match(/^([\w.]+)\(/);
  if (call && !ID_PATH.test(call[1])) return false;
  const withoutFallback = expr.replace(FALLBACK, ' ');
  if (NOT_A_RENDER.test(withoutFallback)) return false;
  // A bare `{'}'}`-style string, or a comment, is not a read.
  if (/^["'`]/.test(expr) || expr.startsWith('/*') || expr.startsWith('//')) return false;
  return true;
}

const failures = [];
let scanned = 0;

for (const root of ROOTS) {
  for (const file of walk(root)) {
    scanned++;
    const rel = relative(process.cwd(), file).replace(/\\/g, '/');
    const lines = readFileSync(file, 'utf8').split('\n');
    const nonBlankBefore = (n) => {
      for (let i = n - 1; i >= 0; i--) if (lines[i].trim()) return lines[i];
      return '';
    };
    const nonBlankAfter = (n) => {
      for (let i = n + 1; i < lines.length; i++) if (lines[i].trim()) return lines[i];
      return '';
    };
    lines.forEach((line, n) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('*') || trimmed.startsWith('//')) return;
      for (const expr of interpolations(line, nonBlankBefore(n), nonBlankAfter(n))) {
        if (!offends(expr)) continue;
        const at = `${rel}:${n + 1}`;
        if (ALLOW.has(at)) continue;
        failures.push(`${at} — renders \`${expr}\``);
      }
    });
  }
}

if (failures.length) {
  console.error(`check-rendered-ids: ${failures.length} id(s) drawn on screen\n`);
  for (const f of failures) console.error(`   ${f}`);
  console.error(
    '\n   A person is identified by their NAME. If the API does not return one, '
    + '\n   fix the API — routers/audit.py selected user_id with no join to users, '
    + '\n   which is why no screen could show a name at all.',
  );
  process.exit(1);
}

console.log(`check-rendered-ids: ${scanned} components, no id drawn on screen.`);
