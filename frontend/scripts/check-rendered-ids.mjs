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
 * The pairing that makes it hold anyway is the `ALLOW` list below: an entry
 * added to it is a decision somebody has to write down.
 *
 * ── THE SECOND PAIR IT MISSED, 2026-08-23 ───────────────────────────────────
 *
 * `graha/ApprovalsTab.jsx` drew `{r.requested_by?.slice(0, 12) || '—'}` and
 * `vikray/TargetsTab.jsx` drew `{t.salesperson_id}` in the fallback arm of a
 * `||`. Both shipped. Four independent holes, none of them the one the source
 * comments at those two sites guessed at — they say the ratchet is "positional
 * rather than textual", so twelve characters of `user_f1a0a472b98f` do not read
 * as an id shape. That is not what happened. This check NEVER inspects a value;
 * it reads NAMES, and would not know a UUID from a postcode. What it does is:
 *
 *   1. `requested_by` was not in the vocabulary. Only `_id`/`uid`/`uuid` were,
 *      and every actor column in this product is a `_by`. — `ID_PATH`
 *   2. `?.` sat in `NOT_A_RENDER`, so ANY optional chain was read as control
 *      flow. `{a?.user_id}` was invisible product-wide. — `OPTIONAL_CHAIN`
 *   3. The scanner jumped `i = end` past a matched `{…}`, so an id nested in
 *      the fallback arm's markup was never looked at. — `interpolations`
 *   4. `String(x)` hid behind the callee rule and a template literal hid behind
 *      the string-literal escape hatch. — `TRANSPARENT`, and the `${` test
 *
 * Widening cost two false positives, both `_by` columns that name no actor
 * (`generate_by` is a date, `marked_by` is provenance); both are in `ALLOW`
 * with the evidence. It found five unfixed real ones, which are in
 * `KNOWN_VIOLATIONS` and warn on every run.
 *
 * Usage: node scripts/check-rendered-ids.mjs [root]
 *        The optional root scans one directory instead of the two real trees —
 *        `src/__tests__/renderedIdsRatchet.test.jsx` uses it to prove this
 *        check fails on the four renders above, which the source no longer
 *        contains and therefore no longer demonstrates.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, extname, relative } from 'path';
import { fileURLToPath } from 'url';

// `fileURLToPath`, not `.pathname` — see check-write-gates.mjs for the Windows
// reason. Both trees are scanned by one script because the rule is one rule:
// the web audit screen and the mobile task card broke it in the same week.
// An explicit root argument exists so the check can be pointed at a fixture and
// PROVED to fail — see `src/__tests__/renderedIdsRatchet.test.jsx`, which feeds
// it the two renders that shipped past it. Without this the only way to
// demonstrate the check works was to break real source and undo it by hand,
// which proves it once and then never again.
const ARG_ROOT = process.argv[2];
const ROOTS = (ARG_ROOT ? [ARG_ROOT] : [
  fileURLToPath(new URL('../src', import.meta.url)),
  fileURLToPath(new URL('../../mobile/src', import.meta.url)),
]).filter(existsSync);

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
 */
/*
 * KEYED BY FILE AND EXPRESSION, NOT BY LINE. It used to be `path:line`, and
 * that keying failed twice: `ganit/_shared.jsx` drifted 140 -> 231 on
 * 2026-08-16 and left `npm run check` exiting 1 for days on a finding that had
 * already been reviewed and allowed; `billing/OutboundLog.jsx` drifted
 * 615 -> 642 on 2026-08-21 the moment an unrelated paragraph was inserted above
 * it. A permanently red gate is a gate nobody reads, which is the same failure
 * this ratchet exists to catch, turned on itself. The previous keying said in
 * its own comment that a third drift meant fixing the keying rather than the
 * number. This is that fix.
 *
 * An expression is a far better key than a line: it is what was actually
 * reviewed. Move the render and the entry follows it. CHANGE what is rendered
 * and the entry stops matching, which is correct — a different expression is a
 * different decision and has not been reviewed.
 *
 * Each entry carries the reason it is not a violation. Adding one means writing
 * that reason — "the check was noisy" is not one. Everything here has been read
 * against the router or the migration that produces the value, because the two
 * `_by` entries at the bottom prove the name alone cannot settle it.
 */
const ALLOW = new Set([
  // The AD NETWORK's account id, as Meta or Google shows it in their console.
  // Matching this table against that console is the entire point of the column;
  // our own row id, which it used to fall back to, is not — that fallback was
  // removed rather than allowed.
  "src/pages/prachar/AdsTab.jsx::a.account_id || 'Not linked'",
  // The Apify actor slug — `apify/gstin-scraper`. Human-readable by
  // construction, and the cost table exists to be reconciled against Apify's
  // own bill, which lists the same string.
  'src/pages/AdminCostDashboardPage.jsx::r.scraper_id',
  // The carrier's receipt for one message. It is what support quotes to Resend
  // or to Meta when a customer says a message never arrived; without it a
  // delivery log cannot be traced past our own edge.
  'src/pages/billing/OutboundLog.jsx::r.provider_message_id',
  // A UPI address (`name@bank`) that the org typed in themselves and prints on
  // its own invoices. An identifier they own, not one we assigned.
  'src/pages/ganit/_shared.jsx::upiId',

  // ── `#<last 6 of task_id>`, THE TASK'S HUMAN HANDLE ──────────────────────
  // Four surfaces, one deliberate decision, argued at length in
  // `TasksListPage.jsx` around line 590: a task has no per-org sequence
  // because `tasks` has no `task_number` column, and inventing a plausible
  // one is worse than none — "a fabricated identifier that looks real is the
  // one thing a person quotes". The owner's rule names a PERSON's identity:
  // user, member, org. A task is a record, not a person, and `#a1f0c2` is how
  // two people refer to the same task out loud.
  //
  // These four are not new. They predate this entry and were invisible until
  // `?.` stopped being read as control flow (see `OPTIONAL_CHAIN`) — the same
  // blindness that hid `ApprovalsTab.jsx`. Reviewed together, allowed
  // together. The mobile precedent in this file's header is NOT contradicted:
  // that bug drew an ASSIGNEE's UUID as an avatar initial, a person rendered
  // as a hex digit, which is a different thing entirely and is still caught.
  "src/components/drawer/DrawerTitle.jsx::task.task_id?.slice(-6)",
  "src/components/views/TaskCard.jsx::task.task_id?.slice(-6) || '—'",
  "src/pages/TasksListPage.jsx::t.task_id?.slice(-6) || '—'",
  "src/pages/today/TaskListCard.jsx::t.task_id?.slice(-6) || '—'",

  // The PRICED ITEM's slug, not a row id: `credits.price_of` keys on
  // `ref_id` and the values are `chatbot_message`, `ad_analysis`, `image`,
  // an `agent_type` — see `routers/billing.py` and the `ref_id=` call sites
  // in `routers/hub.py`. Written by us, but as a word, and it is what a
  // customer disputing a line on their bill points at. Same reasoning as
  // `scraper_id` above.
  'src/pages/billing/BillingUsageSection.jsx::t.ref_id',
  'src/pages/billing/UsageBySource.jsx::it.ref_id',

  // ── THE TWO `_by` COLUMNS THAT NAME NO ACTOR ─────────────────────────────
  // Adding `_by` to `ID_PATH` buys `requested_by`/`approved_by`/`decided_by`
  // and costs exactly these two, because English lets "by" be a preposition
  // and not an agent. Both are worth the price and neither is fixable by a
  // cleverer regex — the name is genuinely ambiguous and only the column's
  // contents settle it.
  //
  // `generate_by` is a DEADLINE DATE — "generate by 2026-09-29", the close of
  // the 48-hour UDIN window. The column beside it reads `signed_on`.
  'src/pages/manav/UdinTab.jsx::r.generate_by',
  // `marked_by` is PROVENANCE, not a person: `routers/manav.py` writes the
  // literal `'manual'`, and `routers/pahchan_attendance.py` writes the
  // biometric source. It says HOW the row got there.
  'src/pages/manav/AttendanceTab.jsx::r.marked_by',
]);

/**
 * VIOLATIONS THAT ARE REAL AND ARE NOT FIXED YET.
 *
 * Not `ALLOW`, and deliberately a second set rather than four more lines in
 * the first one: everything in `ALLOW` is a decision that this is not a
 * violation, and putting an unfixed defect in there would launder it into a
 * ruling. These are rendered ids. Each one prints a warning on every run and
 * the fix is the same in all four cases — resolve the name in the router, the
 * way `hub.py:list_skill_requests` already resolves `requester_name` and, one
 * field later, does not resolve `decided_by`.
 *
 * The gate stays green because a permanently red gate is a gate nobody reads —
 * that is this file's own finding, recorded above about line-keyed allows, and
 * it applies with more force here. What the ratchet actually protects is the
 * NEXT one: any new `_by` render fails the build outright.
 *
 * An entry here that no longer matches anything FAILS. Without that a baseline
 * silently becomes a lie the moment somebody fixes a line, and the set grows a
 * tail of entries nobody can prove are still needed.
 */
const KNOWN_VIOLATIONS = new Set([
  // EMPTY, AND IT GOT THERE THE RIGHT WAY.
  //
  // When `_by` and the nested-interpolation fix landed on 2026-08-23 this check
  // found five renders it had been walking past: `requested_by`/`approved_by`
  // fallback arms on `admin/SupportSessionsPage.jsx` and
  // `org/TabSupportAccess.jsx`, and a bare `r.decided_by` on
  // `hub/skills/RequestsTab.jsx` reading "granted 3 Aug by user_f1a0a472b98f".
  // They were parked here — visible, warned on every run, and failing the build
  // once stale — rather than being laundered into `ALLOW`, which is a ruling
  // and not a to-do list.
  //
  // All five are fixed. Four were dead fallback arms whose routers already
  // resolve a name and end at a stated sentence, so the arm could only ever
  // fire by drawing an id; the fifth needed the router to resolve it, and
  // `routers/hub.py` now joins `users` for the decider with the same ladder and
  // the same 'Name not on file' wording it already used for the requester eight
  // lines above.
  //
  // KEEP IT EMPTY IF YOU CAN. An entry here is a defect the product is shipping
  // on purpose; the staleness check below means the set can only shrink, which
  // is the only reason it is safe to have at all.
]);

/**
 * A path that ends in an id. `_id`, `_ids`, and the camel forms — plus bare
 * `uid`/`uuid`, which is what the avatar stack was iterating.
 *
 * `_by` was added 2026-08-23 after `graha/ApprovalsTab.jsx` shipped
 * `{r.requested_by?.slice(0, 12) || '—'}` — a truncated `users.user_id`
 * (`user_f1a0a472b98f`) in a table cell — and this check said nothing. The
 * reason it said nothing was NOT that twelve characters fail to look like a
 * UUID: this ratchet never inspects a VALUE, only a NAME. `requested_by`
 * simply was not in the vocabulary. Every actor column in this product is a
 * `_by` — `requested_by`, `approved_by`, `created_by`, `updated_by` — and each
 * one holds a `users.user_id`.
 *
 * The trap, and the reason `_by` is spelled with a trailing `\b`: the RESOLVED
 * forms are `created_by_name` / `updated_by_name` / `approved_by_name`, and
 * those hold names and are drawn on nearly every table in the product. `_` is
 * a word character, so `_by\b` cannot match inside `created_by_name` — the
 * word boundary does the exclusion for free, with no negative lookahead to get
 * wrong later.
 *
 * Only the snake form. `By\b` would have caught a hypothetical `createdBy`,
 * and would also have caught `sortBy`, `groupBy` and `orderBy`, which are
 * table state and are rendered as column labels. The API speaks snake_case;
 * paying for a camel form nobody sends was not worth the noise.
 */
/*
 * `assigned_to` is named EXPLICITLY, not bought with a generic `_to` suffix.
 * The suffix would drag in `due_to`, `sent_to`, `replied_to` and every other
 * preposition-shaped field in the product, and a vocabulary that fires on
 * prose is a vocabulary people add exemptions to.
 *
 * It is here because the SAME class of miss shipped twice. Note 1 above
 * records `requested_by` being invisible for want of a `_by`; on 2026-08-27
 * two live renders of `assigned_to` were found for want of this — a truncated
 * `substring(0, 8)` on the Graha contact detail, and a `slice(0, 12)` on the
 * rep-performance report, which is the one report whose whole point is that
 * the figures sit against a person. Both were drawing a `users.user_id`.
 */
const ID_PATH = /\b[\w.?\[\]]*(?:_ids?|_by|assigned_to|Id|Ids|uid|uuid|Uuid|UUID)\b/;

/**
 * Things that make an interpolation control flow rather than a render. If any
 * appears, the id inside it is being USED, not drawn.
 */
const NOT_A_RENDER = /(===|!==|==|!=|&&|\|\||=>|<|>|;|\?|\.map\(|\.filter\(|\.includes\(|\.find\(|\.some\(|\.indexOf\(|\.length)/;

/**
 * Optional chaining is a RENDER, not control flow. `?.` used to sit in
 * `NOT_A_RENDER` above, which meant `{r.requested_by?.slice(0, 12) || '—'}`
 * was waved through twice over — see `graha/ApprovalsTab.jsx`. Deleting the
 * `\?\.` alternative alone changes nothing, because the bare `\?` alternative
 * (a ternary, which IS control flow) matches the same two characters. So `?.`
 * is erased from the expression before the test, the same trick `FALLBACK`
 * already uses, and what survives to meet `\?` is a real ternary.
 *
 * `?.[` and `?.(` collapse to `.[` and `.(`, neither of which any rule reads.
 */
const OPTIONAL_CHAIN = /\?\./g;

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
    // NO `i = end` — the scan continues INSIDE what it just matched.
    //
    // Skipping to the closing brace is what let `vikray/TargetsTab.jsx` ship
    // `{t.salesperson_name || <span className="vk-tg__unknown">{t.salesperson_id}</span>}`.
    // The outer interpolation is correctly ignored: it contains a JSX tag, so
    // `NOT_A_RENDER` reads it as control flow, which it is. But the id is not
    // in the outer expression — it is in the CHILD of the span inside it, and
    // `i = end` jumped the cursor clean over that child. The fallback arm of a
    // `||` is the single most likely place for an id to be drawn, because it is
    // where somebody puts what to show when the name did not resolve.
    //
    // The alternative was to recurse only when the outer expression contains
    // markup. Same result, one more branch to be wrong about: an inner `{` is
    // only ever reported if it independently passes the same adjacency test,
    // and `<div style={{ padding: 4 }}>` fails it at both levels — the outer
    // brace is preceded by `style=`, the inner by `{`.
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

// Wrappers that are TRANSPARENT: they change the type of a value, never its
// meaning, so `{String(r.created_by)}` draws exactly the id that
// `{r.created_by}` would. Without this they hid behind the callee rule below —
// `String` is not id-shaped, so the whole expression was dismissed on the name
// of its wrapper. Truncation (`.slice`, `.substring`, `.charAt`) needs no entry
// here: those are METHODS, so the id path is the callee and is already read.
const TRANSPARENT = /^(?:String|Number)\(/;

/**
 * A ternary is a RENDER whose CONDITION is not drawn.
 *
 * `{c.assigned_to ? `${c.assigned_to.substring(0, 8)}…` : '—'}` shipped past
 * this check on 2026-08-27 and drew eight characters of a `users.user_id` on
 * the Graha contact detail. Three separate coats hid it: the column name was
 * not in `ID_PATH`, the truncation sat inside a template literal, and the `?`
 * put the whole expression in `NOT_A_RENDER`.
 *
 * The third is the interesting one, because both obvious fixes are wrong.
 * Leaving `?` in `NOT_A_RENDER` means every ternary is invisible. Taking it
 * out means 15 findings across the app, and MEASURED — every one of them a
 * false positive of one shape: `{editId ? 'Edit' : 'New'}`, where the id is
 * the CONDITION and both arms are string literals. `check-rendered-ids` fires
 * on names rather than values, so a vocabulary that cannot tell a condition
 * from an arm is a vocabulary people write exemptions against.
 *
 * So: split, and judge the two ARMS. `?.` is skipped — it is optional
 * chaining, not a ternary — and so is a `?` inside a string, a template, or
 * any bracket, which is what the depth counter is for. Nested ternaries fall
 * out of the recursion in `offends`.
 *
 * Returns `[consequent, alternate]`, or `null` when there is no top-level
 * ternary to split.
 */
function splitTernary(expr) {
  let depth = 0, quote = null, q = -1;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') { depth++; continue; }
    if (ch === ')' || ch === ']' || ch === '}') { depth--; continue; }
    if (depth !== 0) continue;
    if (ch === '?') {
      if (expr[i + 1] === '.' || expr[i + 1] === '?') { i++; continue; }
      if (q === -1) q = i;
      continue;
    }
    // The first top-level `:` after the `?` closes it. Any `:` BEFORE the `?`
    // belongs to something else — an object literal or a label — and this
    // expression is not a ternary we can read.
    if (ch === ':' && q !== -1) {
      return [expr.slice(q + 1, i).trim(), expr.slice(i + 1).trim()];
    }
  }
  return null;
}

function offends(expr) {
  if (!expr) return false;
  const arms = splitTernary(expr);
  if (arms) return offends(arms[0]) || offends(arms[1]);
  // Optional chaining first, and on the ID test too: `r.requested_by?.slice`
  // only reads as an id path once the `?.` is gone.
  expr = expr.replace(OPTIONAL_CHAIN, '.');
  if (!ID_PATH.test(expr)) return false;
  // `{assignedLabel(c.assigned_to, meId)}` draws whatever the function returns,
  // and that function's whole job is to turn an id into a label. A call whose
  // CALLEE is not itself id-shaped is judged by its name, not by its arguments.
  const call = expr.match(/^([\w.]+)\(/);
  if (call && !ID_PATH.test(call[1]) && !TRANSPARENT.test(expr)) return false;
  const withoutFallback = expr.replace(FALLBACK, ' ');
  if (NOT_A_RENDER.test(withoutFallback)) return false;
  // A bare `{'}'}`-style string, or a comment, is not a read.
  //
  // A BACKTICK is only inert while it holds no `${`. The guard used to lump
  // template literals in with quoted strings, so `` {`${r.created_by}`} ``
  // — an id wrapped in two characters — walked out through the escape hatch
  // meant for punctuation. `${` is what separates a constant from a read.
  if (/^["']/.test(expr)) return false;
  if (expr.startsWith('`') && !expr.includes('${')) return false;
  if (expr.startsWith('/*') || expr.startsWith('//')) return false;
  return true;
}

const failures = [];
const known = [];
const seenKnown = new Set();
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
        // The allow key is file + expression; the REPORT still carries the
        // line, because a person chasing a failure needs somewhere to look.
        const key = `${rel}::${expr}`;
        if (ALLOW.has(key)) continue;
        if (KNOWN_VIOLATIONS.has(key)) {
          seenKnown.add(key);
          known.push(`${rel}:${n + 1} — renders \`${expr}\``);
          continue;
        }
        failures.push(`${rel}:${n + 1} — renders \`${expr}\``);
      }
    });
  }
}

// A baseline entry that matches nothing is a claim nobody can check. Fail, so
// that fixing a render forces deleting the line that excused it — the set can
// only ever shrink.
// Only over the real tree: a fixture run sees none of these paths, and would
// otherwise report every baseline entry as stale instead of reporting the
// fixture's own failures, which is the one thing the fixture run is for.
const stale = ARG_ROOT ? [] : [...KNOWN_VIOLATIONS].filter((k) => !seenKnown.has(k));
if (stale.length) {
  console.error('check-rendered-ids: KNOWN_VIOLATIONS entries match nothing\n');
  for (const s of stale) console.error(`   ${s}`);
  console.error('\n   If the render is gone, delete the entry. The list only shrinks.');
  process.exit(1);
}

if (known.length) {
  console.warn(`check-rendered-ids: ${known.length} KNOWN id render(s), not yet fixed\n`);
  for (const k of known) console.warn(`   ${k}`);
  console.warn('\n   Resolve the name in the router, not on the screen.\n');
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
