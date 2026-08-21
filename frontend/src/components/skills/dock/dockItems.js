/**
 * dockItems.js — the four lists, computed. No JSX, no hooks, no requests.
 *
 * Everything the dock decides is here so it can be tested without a browser,
 * and so the ONE ordering rule and the ONE price rule are read from the files
 * that already own them rather than written a second time:
 *
 *   ordering   `SKILL_TYPES` from `pages/hub/skills/_shared.jsx` — check →
 *              brief → pack → content, which is what CatalogTab renders and
 *              which also puts every free skill above every priced one.
 *   type       `skillTypeOf`, same file, tolerant of a row written before
 *              migration 166.
 *   steps      `parseSteps`, same file — `steps` arrives as JSON text from
 *              some routes and as an array from others.
 *   variables  `extractVariables`, same file.
 *
 * A second copy of any of those is the drift this codebase has already paid
 * for twice (the duplicated credit table; the two catalogs quoting 5 and 99
 * credits for one template).
 */
import {
  SKILL_TYPES, skillTypeOf, parseSteps, extractVariables, stepKind,
} from '../../../pages/hub/skills/_shared';
import { matchesPage } from '../../../lib/routeModules';

/** `check → brief → pack → content`, as an index. */
const TYPE_RANK = Object.fromEntries(SKILL_TYPES.map((t, i) => [t.key, i]));

/** The two variables every run supplies itself; anything else has to be asked. */
const AMBIENT_VARS = ['brand_name', 'language'];

/**
 * What a run of this kind DOES, said before it runs.
 *
 * Proposal 71's fourth rule, and the sentence it names explicitly: "The
 * collection pack drafting a chase per overdue invoice must never read as
 * though it will send them."
 *
 * The four defaults come from `SKILL_TYPES`' own definitions. They are then
 * OVERRIDDEN by the capability list where a step can actually write — a
 * template that calls a handler in `WRITE_SKILL_FUNCTIONS` really does change
 * records, and no amount of it being filed under `brief` makes that read-only.
 * Derived, never assumed: with no capability list the answer is the honest
 * "not checked" rather than a reassuring guess.
 */
export function runIntent(type, steps, caps) {
  const writers = writingSteps(steps, caps);
  if (writers === null) return 'effect not checked — the server did not answer';
  if (writers > 0) {
    return writers === 1
      ? 'CHANGES DATA — one step writes records'
      : `CHANGES DATA — ${writers} steps write records`;
  }
  if (type === 'pack') return 'drafts, sends nothing';
  if (type === 'content') return 'writes new content into your library';
  return 'reads only';
}

/**
 * How many steps of this skill can write. `null` when the capability list has
 * not loaded, which is NOT the same as zero and must not render as "reads
 * only" — the same distinction `blockersFor` draws in `_shared.jsx`.
 */
export function writingSteps(steps, caps) {
  if (!caps) return null;
  const byName = Object.fromEntries(
    (caps.skill_functions || []).map(f => [f.name, f]));
  return steps.filter(s => stepKind(s) === 'data'
    && s.skill_function
    && (byName[s.skill_function]?.writes || s.allow_writes)).length;
}

/**
 * What a run costs, and NEVER a default.
 *
 * Migration 166 fixed thirteen cards that read "0 credits" and charged 2, so
 * the one thing this must not do is turn "nobody set a price" into "free".
 * Three answers, and they are different sentences:
 *
 *   free      every step is a data step. A data step is a scoped SQL read
 *             with no provider invoice behind it — migration 166 says so on
 *             the column — so the sum is provably 0, not defaulted to it.
 *   priced    the stored figure, as stored, unrounded.
 *   unknown   there are AI steps and no stored figure. Says so. A wrong price
 *             on a screen somebody spends from is worse than a missing one.
 *
 * IMAGES ARE NOT IN THIS NUMBER — they add 3 credits per AI step and the
 * stored column does not include them. The dock never turns them on (it always
 * posts `generate_images: false`) so the figure it shows is the figure that
 * will be charged, which is the only way it is allowed to show one.
 */
export function runCost(row, steps) {
  const ai = steps.filter(s => stepKind(s) !== 'data');
  if (!ai.length) return { credits: 0, kind: 'free' };
  const stored = Number(row?.estimated_credits);
  if (Number.isFinite(stored) && stored > 0) return { credits: stored, kind: 'priced' };
  return { credits: null, kind: 'unknown' };
}

/** The cost, as the row reads it. */
export function costLabel(cost) {
  if (cost.kind === 'free') return '0 credits';
  if (cost.kind === 'priced') {
    return `${cost.credits} ${cost.credits === 1 ? 'credit' : 'credits'}`;
  }
  return 'cost not stated';
}

/**
 * Why this skill cannot be run FROM THE DOCK, in order of how early the user
 * would otherwise hit it. `[]` means run it.
 *
 * Four reasons, and each is shown rather than hidden — proposal 71: "say WHY a
 * skill is greyed rather than hiding it silently."
 *
 *  1. not on the organisation. There is no self-serve install; `assign_skill_
 *     to_org` is platform-tier. The row says who turns it on.
 *  2. the server cannot run it — a handler that is unimplemented, unknown or
 *     cannot be scoped to one org. `blockersFor`'s job, reused verbatim below
 *     by the caller.
 *  3. a module the caller does not hold. See `moduleGate` — inert today.
 *  4. it asks a question first. A skill whose prompts carry `{topic}` needs a
 *     form, and a form does not belong in a corner popover; it opens in
 *     Sahayak instead, where the form already exists.
 */
export function askedVariables(steps) {
  return extractVariables(steps).filter(v => !AMBIENT_VARS.includes(v));
}

/**
 * The modules a skill's steps actually READ, if the server says so.
 *
 * `services/skills/modules.py` refuses a caller who does not hold EVERY module
 * a handler touches, and `describe_skill_functions()` does not currently put
 * that set on the wire — it ships `name`, `available`, `kind`, `writes`,
 * `needs`, `runtime_eligible` and `defaults`, and no `modules`. So this returns
 * an empty set today and the gate below is inert.
 *
 * It is written anyway, and reads `f.modules` by name, because the fix is one
 * line in `describe_skill_functions` — `"modules": sorted(FUNCTION_MODULES.get
 * (name, ()))` — and on the day that lands the dock starts greying the
 * cross-module skills correctly with no further change here.
 *
 * IT DOES NOT USE `template.module`. Migration 166 is explicit that the column
 * is a shelf LABEL and "is NOT an access decision and must never become one:
 * what a skill may read is a SET per handler … because handlers straddle and
 * one column cannot say so". Gating on it would refuse `Monday Morning Brief`
 * to everyone but core PM, and admit `aggregate_kpis` to someone holding only
 * Ganit — wrong in both directions.
 */
export function neededModules(steps, caps) {
  if (!caps) return [];
  const byName = Object.fromEntries(
    (caps.skill_functions || []).map(f => [f.name, f]));
  const out = new Set();
  for (const s of steps) {
    for (const m of byName[s.skill_function]?.modules || []) out.add(m);
  }
  return [...out].sort();
}

/**
 * Modules this skill needs that the caller does not hold.
 *
 * `module_levels` absent or not an object is the server expressing NO OPINION
 * — an org_owner, an org_admin, or platform staff — and every module is
 * reachable. That is `moduleAccess.js`'s third state and treating it as "holds
 * nothing" would grey out every skill in the product for administrators.
 */
export function moduleGate(needed, user) {
  const levels = user?.module_levels;
  if (!levels || typeof levels !== 'object') return [];
  return needed.filter(m => !levels[m]);
}

/**
 * One skill row, ready to render. `active` rows carry the ORG SKILL id, which
 * is what `POST /v1/hub/org/skills/{id}/run` takes — never the template id.
 */
function skillRow(source, template, caps, user) {
  const active = !!source.template_id;          // an org grant, not a template
  const t = template || source;
  const steps = parseSteps(source.steps ?? t.steps)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  const type = skillTypeOf(
    // `skill_type` is on `/v1/hub/skills/templates` today and is being added
    // to `/v1/hub/org/skills`. Until it lands there, the joined template row
    // supplies it; `skillTypeOf` handles a row that has neither.
    source.skill_type ? source : t);
  const cost = runCost(source, steps);
  const asks = askedVariables(steps);
  const needs = neededModules(steps, caps);

  return {
    key: source.id,
    runId: active ? source.id : null,
    name: source.template_name || source.name || t.name,
    description: source.description || source.template_description || t.description || '',
    icon: source.icon || t.icon,
    type,
    steps,
    cost,
    intent: runIntent(type, steps, caps),
    active,
    asks,
    missingModules: moduleGate(needs, user),
  };
}

/**
 * The skills that belong on this page: the org's active grants first, then the
 * catalogue templates it has not been given, both filtered to the page's
 * module codes and ordered by type.
 *
 * BOTH are listed, because a shelf that hides what the firm has not been given
 * cannot be the discovery surface the dock exists to be — and because the
 * un-granted rows carry the one sentence that turns a dead end into a request:
 * who turns it on.
 */
export function skillsForPage(page, { orgSkills, templates, caps }, user) {
  if (!page.skills.length) return [];
  const byId = new Map((templates || []).map(t => [t.id, t]));
  const active = [];
  const activeTemplateIds = new Set();

  for (const s of orgSkills || []) {
    const t = byId.get(s.template_id);
    // `module` is being added to the org-skills SELECT. Until it is there, the
    // template joined by `template_id` answers — which is also the fallback if
    // it is ever dropped again.
    const module = s.module || t?.module;
    if (!page.skills.includes(module)) continue;
    activeTemplateIds.add(s.template_id);
    active.push(skillRow(s, t, caps, user));
  }

  const rest = (templates || [])
    .filter(t => page.skills.includes(t.module) && !activeTemplateIds.has(t.id))
    .map(t => skillRow(t, t, caps, user));

  return [...order(active), ...order(rest)];
}

/** Type order, then name. Never alphabetical alone — see `SKILL_TYPES`. */
function order(list) {
  return [...list].sort((a, b) =>
    (TYPE_RANK[a.type] ?? 99) - (TYPE_RANK[b.type] ?? 99)
    || String(a.name).localeCompare(String(b.name)));
}

/**
 * The metrics declared for this page.
 *
 * `/v1/analytics/catalogue` is already narrowed to what the caller may READ —
 * `_reachable()` walks `held_level` per registry module — so there is nothing
 * to gate here. A metric the caller cannot see never arrives.
 *
 * A DECLARED-ABSENT metric is kept and marked. `catalogue_for` ships those on
 * purpose: "the module's owner should see what the product cannot yet answer
 * and why, rather than a silent gap that reads as an oversight."
 */
export function metricsForPage(page, metrics) {
  if (!page.metrics.length) return [];
  return (metrics || [])
    .filter(m => page.metrics.includes(m.module))
    .map(m => ({
      key: m.key,
      name: m.label || m.key,
      description: m.description || '',
      unit: m.unit,
      grain: m.grain,
      absent: m.absent || '',
    }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/**
 * The automations that belong on this page: the org's LIVE rules first, then
 * the starter templates it has not used.
 *
 * `effective_mode` and not `is_armed` — `list_rules` computes it precisely
 * because "a UI that shows only `is_armed` tells somebody their rule is live
 * when the engine is not". The dock shows what would actually happen.
 *
 * ARMING IS NOT OFFERED, and neither is cloning. Proposal 72 settles it:
 * "arming from a corner popover is how a firm ends up emailing its customers
 * by accident." Every row's action opens the builder.
 */
export function automationsForPage(page, { rules, ruleTemplates }) {
  const live = (rules || [])
    .filter(r => matchesPage(page, r))
    .map(r => ({
      key: `rule:${r.rule_id}`,
      name: r.name,
      trigger: r.label || r.event_type,
      mode: r.effective_mode || (r.is_armed ? 'armed' : 'idle'),
      live: true,
    }));

  const starters = (ruleTemplates || [])
    .filter(t => matchesPage(page, t))
    .map(t => ({
      key: `tpl:${t.id}`,
      name: t.name,
      trigger: t.label || t.event_type,
      why: t.why || '',
      mode: null,
      live: false,
    }));

  return [...live, ...starters];
}

/**
 * THE COUNT ON THE PILL.
 *
 * The sum of the four tabs, and nothing cleverer. That is deliberate: whatever
 * the pill says, the user can open the dock, add up the four tab counts and
 * get the same number. A pill that counted three of the four sections — which
 * is what the interactive demo did, leaving metrics out — would disagree with
 * the dock's own display the moment anyone checked, and a number nobody can
 * check is a number nobody should trust.
 *
 * It counts ROWS THAT ARE SHOWN. Not "new", not "unseen", not "since last
 * time" — those words appear nowhere in this directory. It is the size of what
 * is on this page, recomputed from the lists that are about to be rendered, so
 * it cannot drift from them.
 */
export function dockCount(lists) {
  return lists.skills.length + lists.metrics.length
       + lists.automations.length + lists.due.length;
}

/** Everything, for one page, in one pass. */
export function buildLists(page, data, user) {
  return {
    skills: skillsForPage(page, data, user),
    metrics: metricsForPage(page, data.metrics),
    automations: automationsForPage(page, data),
    // The statute calendar has no HTTP surface. `routeModules.DUE_SOURCE`
    // carries the whole explanation and the pane says it out loud.
    due: [],
  };
}

/* ── What a finished run says, without saying an id ────────────────────────── */

/** A UUID in any casing. The one shape that must never reach the DOM. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A key that names an identifier rather than a fact. */
const ID_KEY = /(^|_)(id|ids|uuid|key)$/i;

/**
 * `snake_case_key` → `Snake case key`. The same shape `pages/hub/_shared.words`
 * produces; not imported because that module pulls the whole hub barrel in for
 * one string transform.
 */
function humanKey(k) {
  const s = String(k).replace(/_/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * Turn one data step's `outputs[]` entry into at most six readable lines.
 *
 * ── NAMES, NOT IDS, ENFORCED HERE AND NOT ASSUMED ───────────────────────────
 *
 * `check-rendered-ids.mjs` is a POSITIONAL check over JSX source: it can see
 * `<span>{row.user_id}</span>` and it cannot see a loop over keys of a JSON
 * blob the server assembled. This is that blind spot, so the guarantee is made
 * in code instead: a pair is dropped if its KEY reads like an identifier or
 * its VALUE is a UUID. Both halves, because a handler can return `{"client":
 * "8f3c…"}` — the right-looking key over the wrong value — and the owner's
 * rule is about what a human reads, not about what it was called.
 *
 * Nested objects and arrays are reduced to a count. The dock is 360px wide and
 * a skill's full finding belongs in Sahayak, which is one row away.
 */
const ROW_CAP = 6;

/** The words for one finding: what it is, who holds it, how late.
 *
 *  Field names differ per skill — a follow-up has `entity.label`, a bill has
 *  `bill`, a person-shaped finding has `employee` — so this reads the shapes
 *  the handlers actually return rather than insisting on one. An unknown shape
 *  falls back to the first printable string on the row, which is still a
 *  sentence and still better than a number.
 *
 *  NEVER AN ID. `owner` is a user id and is deliberately not read; handlers
 *  carry `owner_name` beside it for exactly this. `check-rendered-ids` would
 *  catch a slip, but the rule is here so a reader knows it was a decision.
 */
export function describeRow(row) {
  if (row == null) return ['', ''];
  if (typeof row !== 'object') return ['', String(row)];

  const what =
    row.entity?.label ?? row.label ?? row.what ?? row.title ??
    row.bill ?? row.invoice_no ?? row.employee ?? row.name ?? null;

  const who = row.owner_name ?? row.vendor ?? row.client ?? row.assignee ?? null;

  const late =
    row.days_past != null ? `${row.days_past}d late`
      : row.days_past_due != null ? `${row.days_past_due}d late`
        : row.due_date ? `due ${row.due_date}`
          : row.due_on ? `due ${row.due_on}` : null;

  if (what) {
    const tail = [who, late].filter(Boolean).join(' · ');
    return [String(what), tail || '—'];
  }

  // Unknown shape: the first printable, non-id string on the row.
  const fallback = Object.entries(row).find(([k, v]) =>
    !ID_KEY.test(k) && typeof v === 'string' && v && !UUID_RE.test(v.trim()));
  return fallback ? [humanKey(fallback[0]), fallback[1]] : ['', 'a finding'];
}


export function summariseOutput(out) {
  const label = out?.label || 'Result';
  const data = out?.data;
  const lines = [];

  const push = (k, v) => {
    if (lines.length >= 6) return;
    if (ID_KEY.test(k)) return;
    if (typeof v === 'string' && UUID_RE.test(v.trim())) return;
    if (v == null || v === '') return;
    if (Array.isArray(v)) { lines.push([humanKey(k), `${v.length}`]); return; }
    if (typeof v === 'object') { lines.push([humanKey(k), `${Object.keys(v).length} fields`]); return; }
    if (typeof v === 'boolean') { lines.push([humanKey(k), v ? 'yes' : 'no']); return; }
    lines.push([humanKey(k), String(v)]);
  };

  // A LIST IS THE ANSWER, NOT ITS LENGTH.
  //
  // This used to push `['Rows', '2']` and stop. The owner ran "Overdue
  // follow-up chase", got "Result: 2", and said the only true thing about it:
  // "not giving the data is useless". A read-only check that reports a COUNT
  // has told the reader there is work and withheld the work.
  //
  // The findings were there — `routers/hub.py` persists them and the response
  // carries them — and this function threw them away one line from the screen.
  //
  // Rows are rendered, capped, and the cap SAYS SO. Six is the same ceiling
  // `push` already uses for a dict's fields; a dock panel is a glance, and
  // "and 14 more" plus the Sahayak link is honest where a silent slice is not.
  if (Array.isArray(data)) {
    if (!data.length) {
      lines.push(['Nothing found', 'nothing is overdue']);
    } else {
      for (const row of data.slice(0, ROW_CAP)) lines.push(describeRow(row));
      if (data.length > ROW_CAP) {
        lines.push(['', `and ${data.length - ROW_CAP} more — open it in Sahayak`]);
      }
    }
  } else if (data && typeof data === 'object') {
    for (const [k, v] of Object.entries(data)) push(k, v);
  }

  return {
    label,
    lines,
    // `truncated` is the server's own word for "the finding was too long to
    // carry" and it says so rather than showing a short list as if it were the
    // whole one — the comment on that field in `routers/hub.py` asks for
    // exactly this.
    truncated: !!out?.truncated,
  };
}
