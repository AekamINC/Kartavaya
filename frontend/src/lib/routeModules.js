/**
 * routeModules.js — what a page IS, in the four vocabularies the corner dock
 * has to speak. Proposal 71 ("one map, beside moduleColors.MODULES, not inside
 * the component") and proposal 72 (four sections, four sources).
 *
 * ── Why this file exists at all ──────────────────────────────────────────────
 *
 * The dock asks one question — "what applies to THIS page?" — and the product
 * answers it in four different alphabets:
 *
 *   skills      `hub_skill_templates.module`   13 codes, incl. `srijan`,
 *                                              `kartavya` and `varta`, which
 *                                              are NOT routes.
 *   metrics     `analytics/registry.module`    12 codes, and core PM is
 *                                              spelled `core`, not `kartavya`.
 *   automations `niyam/registry.EVENT_META`    keyed on `event_type`, grouped
 *                                              into a `family` — `invoice`,
 *                                              `crm`, `hr` … — which is what
 *                                              the API already ships on every
 *                                              rule and template.
 *   due dates   `staging.statute_calendar`     keyed on `authority` (gst, epfo,
 *                                              esic, income_tax). Four values,
 *                                              spelled exactly as the column
 *                                              holds them — see `authorities`
 *                                              below, where a one-token
 *                                              mis-spelling cost 22 rows.
 *
 * No two of those agree, and none of them is a route. `navConfig.ROUTE_META`
 * carries `module` for the nine gated module pages and nothing for core PM,
 * which is exactly the half the dock most needs (kartavya has skills of its
 * own). So the translation lives here, once, and the dock reads it.
 *
 * ── The rule that decides the shape ─────────────────────────────────────────
 *
 * A page maps to a LIST in each vocabulary, never a single value:
 *
 *   · `/hub/org` is one page over two skill modules — `sahayak` (1 template)
 *     and `srijan` (6). One value would hide six.
 *   · `/pahchan` and `/manav` both want the attendance-correction events; the
 *     niyam registry files them under family `hr`, which is Manav's. Listing
 *     the event on both pages is true — an attendance correction genuinely is
 *     both an HR fact and an attendance fact — where picking one is a lie on
 *     the other page.
 *   · `/vetana` wants the `pay` metrics, which the registry declares under
 *     module `ganit` because they read Ganit's tables.
 *
 * ── WHAT THIS FILE IS NOT ───────────────────────────────────────────────────
 *
 * IT IS NOT AN ACCESS DECISION, and it must never become one. Migration 166
 * says so on the column itself: "`module` is … a LABEL, one value, chosen for
 * the shelf. It is NOT an access decision and must never become one: what a
 * skill may read is a SET per handler in services/skills/modules.py, because
 * handlers straddle and one column cannot say so." Entitlement is answered by
 * `lib/moduleAccess.js` against `/auth/me`'s `module_levels`, and by the
 * capability list; this file only decides what is worth SHOWING.
 *
 * IT IS NOT A CURATED PAGE → SKILL MAP. Proposal 71 cuts those explicitly —
 * "the module column already is one, and a second copy goes stale the way the
 * duplicated price list did". Nothing below names a skill, a metric or a rule.
 * It names vocabularies.
 */

/**
 * Skill module codes that have no route of their own.
 *
 * `srijan` is the content module — its six packs are reached through Sahayak,
 * which is `/hub/org`. `varta` is meetings, and `App.jsx` has no `/varta`
 * route at all today, so its eight templates are unreachable from any page.
 * That is a real gap and it is recorded here rather than quietly folded into
 * a neighbouring page, because folding it in would make the dock claim a
 * meetings skill belongs to a page that is not about meetings.
 */
export const ROUTELESS_SKILL_MODULES = ['varta'];

/**
 * One entry per page identity, matched by LONGEST PREFIX — the same rule
 * `navConfig.resolveRouteMeta` uses, and for the same reason: object order
 * must not decide whether `/hub/clients` resolves to `/hub`.
 *
 *   prefix     pathname prefix this entry claims
 *   label/hi   what the dock calls the page. Taken from `moduleColors.MODULES`
 *              where a module owns the page, so the dock cannot call a module
 *              something the sidebar does not.
 *   skills     `hub_skill_templates.module` values to show here
 *   metrics    `analytics` registry module values to show here
 *   families   niyam `family` values to show here
 *   events     extra niyam `event_type` values, for the handful the family
 *              grouping puts on the wrong page (see `/pahchan`)
 *   authorities  `statute_calendar.authority` values (see DUE_SOURCE below).
 *              THE COLUMN'S OWN SPELLING, never a tidied one: the four live
 *              values are `gst`, `income_tax`, `epfo` and `esic`. This list
 *              read `incometax` for six months, which is not a value that
 *              table has ever held — 22 of the 45 rows are income-tax rows and
 *              every one of them was dropped by that missing underscore.
 *              `routers/statute.py` allowlists the same four, so the
 *              mis-spelling would now be refused with a 422 rather than
 *              quietly answering with a short list.
 *   note       an extra sentence for the empty state, where the page itself
 *              is the reason the tab is empty
 */
export const PAGE_MODULES = [
  // ── core PM ───────────────────────────────────────────────────────────────
  // `kartavya` is the skill code; the analytics registry spells the same thing
  // `core` (analytics/metrics/core.py and niyam.py both declare module="core").
  { prefix: '/dashboard', label: 'Today', hi: 'आज',
    skills: ['kartavya'], metrics: ['core'], families: ['task', 'approval'] },
  { prefix: '/tasks', label: 'Tasks', hi: 'कर्तव्य',
    skills: ['kartavya'], metrics: ['core'], families: ['task'] },
  { prefix: '/boards', label: 'Boards', hi: 'फ़लक',
    skills: ['kartavya'], metrics: ['core'], families: ['task'] },
  { prefix: '/projects', label: 'Projects', hi: 'योजना',
    skills: ['kartavya'], metrics: ['core'], families: ['task'] },
  { prefix: '/teams', label: 'Team', hi: 'सहयोगी',
    skills: ['kartavya'], metrics: ['core'], families: ['task'] },
  { prefix: '/approvals', label: 'Approvals', hi: 'सम्मति',
    skills: ['kartavya'], metrics: ['core'], families: ['approval'] },
  { prefix: '/activity', label: 'Activity', hi: 'क्रिया',
    skills: ['kartavya'], metrics: ['core'], families: ['task'] },
  { prefix: '/time', label: 'Time', hi: 'काल',
    skills: ['kartavya'], metrics: ['core'], families: ['task'] },
  { prefix: '/templates', label: 'Templates', hi: 'साँचा',
    skills: ['kartavya'], metrics: ['core'], families: [] },
  { prefix: '/inbox', label: 'Inbox', hi: 'सन्देश',
    skills: ['kartavya'], metrics: ['core'], families: ['approval'] },
  { prefix: '/reports', label: 'Reports', hi: 'प्रतिवेदन',
    skills: ['kartavya'], metrics: ['core'], families: ['analytics'] },

  // ── gated module pages ────────────────────────────────────────────────────
  { prefix: '/ganit', label: 'Finance', hi: 'गणित',
    skills: ['ganit'], metrics: ['ganit'], families: ['invoice'],
    authorities: ['gst', 'income_tax'] },
  { prefix: '/graha', label: 'CRM', hi: 'ग्रह',
    skills: ['graha'], metrics: ['graha'], families: ['crm'] },
  { prefix: '/vikray', label: 'Sales', hi: 'विक्रय',
    skills: ['vikray'], metrics: ['vikray'], families: ['sales'] },
  { prefix: '/manav', label: 'HRMS', hi: 'मानव',
    skills: ['manav'], metrics: ['manav'], families: ['hr'] },
  { prefix: '/vetana', label: 'Payroll', hi: 'वेतन',
    // `analytics/metrics/pay.py` declares module="ganit" — the payroll cost
    // metrics read Ganit's tables — so the Payroll page asks for both or its
    // Numbers tab is missing the numbers it is most about.
    skills: ['vetana'], metrics: ['vetana', 'ganit'], families: ['payroll'],
    authorities: ['epfo', 'esic'] },
  { prefix: '/pahchan', label: 'Attendance', hi: 'पहचान',
    // The niyam registry files every attendance event under family `hr`. The
    // four below are named here so the attendance page shows the automations
    // that are ABOUT attendance, without taking them off Manav, where they
    // are also true.
    skills: ['pahchan'], metrics: ['pahchan'], families: [],
    events: ['attendance.summary', 'correction.requested',
             'correction.decided', 'enroll.requested'] },
  { prefix: '/prachar', label: 'Marketing', hi: 'प्रचार',
    skills: ['prachar'], metrics: ['prachar'], families: ['marketing'] },
  { prefix: '/esign', label: 'E-Sign', hi: 'प्रमाण',
    skills: ['esign'], metrics: ['esign'], families: ['esign'] },
  { prefix: '/sanvaad', label: 'Messages', hi: 'संवाद',
    skills: ['sanvaad'], metrics: ['sanvaad'], families: ['whatsapp'] },
  { prefix: '/dristi', label: 'Analytics', hi: 'दृष्टि',
    // Deliberately no metrics. This page IS the metric catalogue; a Numbers
    // tab listing fourteen metrics in the corner of the screen that already
    // lists them is the dock repeating the page back at itself.
    skills: ['dristi'], metrics: [], families: ['analytics'],
    note: 'Every metric in the product is on this page already.' },

  // ── Sahayak ───────────────────────────────────────────────────────────────
  // Two skill modules, one page. `srijan` owns the six content packs and is
  // the only module whose skills cost credits.
  { prefix: '/hub/clients', label: 'Sahayak Clients', hi: 'सहायक ग्राहक',
    skills: ['sahayak', 'srijan'], metrics: ['sahayak'], families: [] },
  { prefix: '/hub/org', label: 'Sahayak', hi: 'सहायक',
    skills: ['sahayak', 'srijan'], metrics: ['sahayak'], families: [] },
  { prefix: '/hub', label: 'Sahayak Admin', hi: 'सहायक व्यवस्था',
    skills: ['sahayak', 'srijan'], metrics: ['sahayak'], families: [] },

  // ── settings ──────────────────────────────────────────────────────────────
  // The automations page gets no automations tab content on purpose: the same
  // reason Dristi gets no metrics. Everything the tab would list is the page.
  { prefix: '/settings/automations', label: 'Automations', hi: 'नियम',
    skills: [], metrics: [], families: [],
    note: 'Every rule and template is on this page already.' },
  { prefix: '/settings', label: 'Settings', hi: 'व्यवस्था',
    skills: [], metrics: [], families: [],
    note: 'Settings pages carry no work of their own.' },
  { prefix: '/billing', label: 'Billing', hi: 'बिलिंग',
    skills: [], metrics: [], families: [],
    note: 'Settings pages carry no work of their own.' },
  { prefix: '/onboarding', label: 'Set up', hi: 'आरम्भ',
    skills: [], metrics: [], families: [],
    note: 'Settings pages carry no work of their own.' },
];

/**
 * The page the dock falls back to. NOT a hidden dock and not a guess — an
 * unrecognised route inside the shell gets an honest empty dock, because the
 * empty state is the signal proposal 71 §"The empty state is the most valuable
 * thing here" is asking for.
 */
const UNKNOWN_PAGE = {
  prefix: '', label: 'This page', hi: '',
  skills: [], metrics: [], families: [], events: [], authorities: [],
};

/**
 * Longest-prefix match, order-independent.
 *
 * Copied in shape from `navConfig.resolveRouteMeta` rather than imported: that
 * function answers a different question (breadcrumb identity) against a map
 * built from the sidebar, and core PM routes resolve there with no `module` at
 * all — which is the gap this file exists to fill.
 */
export function pageModules(pathname) {
  if (!pathname) return UNKNOWN_PAGE;
  let best = null;
  for (const entry of PAGE_MODULES) {
    if (pathname === entry.prefix || pathname.startsWith(entry.prefix + '/')) {
      if (!best || entry.prefix.length > best.prefix.length) best = entry;
    }
  }
  if (!best) return UNKNOWN_PAGE;
  return {
    events: [], authorities: [], note: '',
    ...best,
  };
}

/**
 * Does this niyam rule/template belong on this page?
 *
 * `family` arrives on every row already — `meta_for()` decorates both
 * `/v1/niyam/rules` and `/v1/niyam/templates` with it, "done here rather than
 * in the frontend … so the picker and the builder cannot disagree". Matching
 * on it rather than on `event_type` means an event added to an existing family
 * lands on the right page with no edit here; `events` above covers the few
 * that need naming individually.
 */
export function matchesPage(page, row) {
  if (!row) return false;
  if (page.families.includes(row.family)) return true;
  return page.events.includes(row.event_type);
}

/**
 * WHERE DUE DATES COME FROM. One route, and the browser computes none of it.
 *
 * `staging.statute_calendar` (migrations 158 / 170 / 172, 45 rows) used to be
 * read ONLY by `backend/services/statute.py`, imported by nine skill handlers
 * and by nothing else. No HTTP route served it, so this constant was `null`
 * and the pane said so — for months, correctly.
 *
 * `backend/routers/statute.py` now serves it, and `/v1/statute/due` is the
 * projection this tab wants: every obligation IN FORCE on a date, with its
 * next occurrence already computed from the row's own `due_day`,
 * `due_month` and `due_month_offset`.
 *
 * THE ARITHMETIC IS DELIBERATELY NOT HERE. A due day looks like a constant and
 * is not — every row carries `effective_from`/`effective_to`, and proposal 72
 * states the failure exactly: "the statute table is dated law and a date read
 * without its window is how you print last year's rule". The TDS forms were
 * renumbered on 1 April 2026. A due day hard-coded in this file the week
 * before would still be printing the old schedule, and it would have no window
 * to check itself against. So the server resolves the version, projects the
 * date, and this file holds a path.
 *
 * The server also refuses to project what it cannot: an obligation whose
 * `due_day` is NULL arrives with `due_on: null` and the reason, and the pane
 * renders it as an obligation without a date rather than dropping it or
 * guessing one.
 */
export const DUE_SOURCE = '/v1/statute/due';

/**
 * The shape the Due pane renders.
 *
 *   { key, title, authority, cadence, due_on, days_away, as_of, basis }
 *
 * `as_of` is echoed back per row deliberately: a countdown whose reference
 * date is invisible is a countdown nobody can check, and this list is read one
 * row at a time in a 360px panel where an envelope field is off screen.
 *
 * `due_on` and `days_away` are NULLABLE and that is a real answer, not a gap —
 * see `basis`, which says why. `form_number`, `notes` and `state_code` ride
 * along on the wire as well; the pane shows the first two and the row shape
 * above is what it is written against.
 */
export const DUE_ROW_KEYS = ['key', 'title', 'authority', 'cadence',
                             'due_on', 'days_away', 'as_of', 'basis'];

/**
 * The four `authority` values the live table holds, for a caller that wants to
 * ask for everything without naming them. Kept beside the page map so the two
 * cannot drift: an entry above naming a value that is not in here is a filter
 * that matches nothing, which is how `incometax` went unnoticed.
 */
export const DUE_AUTHORITIES = ['gst', 'income_tax', 'epfo', 'esic'];
