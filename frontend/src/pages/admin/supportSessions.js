/**
 * supportSessions.js — the client half of customer-granted support access.
 *
 * ── What a support session is, in one sentence ──────────────────────────────
 * A time-boxed, module-scoped, below-admin grant that ONE Aekam account holds
 * inside ONE customer organisation, which the customer approved and can pull
 * back at any moment.
 *
 * ── THE RULE THAT OUTRANKS EVERYTHING ELSE HERE ─────────────────────────────
 * SUPPORT ACCESS IS NEVER SILENT. `08-rbac-screens.md` §"One rule worth
 * restating": it appears in the CUSTOMER's own audit log with the operator's
 * name and stated reason, it emails the owner, and the violet chrome sits in
 * the customer's window for the whole session. There is no quiet mode and no
 * flag that suppresses any of it. Nothing in this file may be written in a way
 * that makes an approved session easier to hide than to show.
 *
 * ── STATE IS DERIVED, AND THIS COPY IS FOR DISPLAY ONLY ─────────────────────
 * `migrations/111_platform_support_sessions.sql` refuses a `status` column, at
 * length, and it is right: a stored status is a cache of a clock, and a stale
 * authorisation cache is somebody holding access nobody can see they hold. The
 * ONE authoritative predicate is `staging.v_active_support_sessions`.
 *
 * `sessionState` below re-derives that predicate in JavaScript, which is
 * exactly what 111 warns against — so it is fenced by two rules:
 *
 *   1. It decides what a SCREEN SAYS. It never decides what a request may do.
 *      The server resolves every request against the view; a browser that
 *      believes a session is live gets 403s and nothing else.
 *   2. It is written so that every clause it could forget makes it show LESS.
 *      `revoked` and `denied` are tested FIRST and return terminal states, so
 *      a row that lost a clause falls out of `active` rather than into it.
 *
 * ── THE TABLE DOES NOT EXIST ────────────────────────────────────────────────
 * `SELECT to_regclass('staging.platform_support_sessions')` returned NULL on
 * the live database on 6 August 2026, and 111 is deliberately unapplied — one
 * `staging` schema, production writes to it, so applying it is the owner's
 * call. The endpoints this file calls therefore 404 today, and that is not an
 * error: it is "there are no support sessions", which is the true answer and
 * will be for weeks. `listSessions` returns `{ dormant: true, data: [] }` and
 * every surface renders NOTHING for it — no error, no empty state, no console
 * noise. See `DORMANT` below.
 */

/**
 * The nine modules a session may be requested for.
 *
 * `vetana` (payroll), `manav` (HR records) and `pahchan` (biometric
 * attendance) are ABSENT and their absence is the point: salary, statutory
 * identifiers and face templates are the three sets of records in this product
 * that a support ticket never needs and that a customer cannot un-see once an
 * outsider has read them. A session cannot ask for them, so no customer is
 * ever put in the position of refusing.
 *
 * Kept in step with `middleware/org_resolver.SUPPORT_MODULE_PREFIXES`. If the
 * two ever disagree the server wins — it is the one holding the request — and
 * the visible symptom is a module offered here that 403s, which is why
 * `requestable()` filters against what the server told us it will accept.
 */
export const SUPPORT_MODULES = [
  { code: 'graha',   label: 'Graha · CRM' },
  { code: 'vikray',  label: 'Vikray · Sales' },
  { code: 'prachar', label: 'Prachar · Marketing' },
  { code: 'dristi',  label: 'Dristi · Analytics' },
  { code: 'sanvaad', label: 'Sanvaad · Messaging' },
  { code: 'esign',   label: 'e-Sign' },
  { code: 'varta',   label: 'Varta · WhatsApp' },
  { code: 'ganit',   label: 'Ganit · Accounts' },
  { code: 'sahayak', label: 'Sahayak · Hub' },
];

/**
 * Capped at VIEWER whatever the customer approves.
 *
 * An `editor` on these three does not change a record — it SENDS, in the
 * customer's name, to the customer's contacts. A marketing blast or a WhatsApp
 * message from a support session is not a support action, and no customer
 * approving "editor on marketing so you can fix my template" is agreeing to
 * one going out. The server enforces this; the form says so before the ask.
 */
export const SUPPORT_READ_ONLY = new Set(['prachar', 'varta', 'sanvaad']);

/**
 * The four durations, and 0 is one of them.
 *
 * A free-text number lets somebody request 8760 hours and have it read as
 * reasonable in a list of numbers. A fixed vocabulary makes "until revoked" a
 * deliberate choice that LOOKS like one — which is the only reason it is
 * offered at all. It is last, and it is the only entry whose label is a
 * sentence rather than a duration.
 */
export const TTL_CHOICES = [
  { hours: 2,   label: '2 hours' },
  { hours: 24,  label: '24 hours' },
  { hours: 168, label: '7 days' },
  { hours: 0,   label: 'Until revoked — no clock' },
];

/** `pss_reason_is_substantive`: `length(btrim(reason)) >= 12`, as DDL. */
export const REASON_MIN = 12;

export const MODULE_LABEL = Object.fromEntries(
  SUPPORT_MODULES.map(m => [m.code, m.label]),
);

/**
 * The five states, derived. Names for shapes of timestamps — there is no
 * `status` column and there must never be one.
 *
 *   revoked    terminal, by any of the three parties        grants nothing
 *   denied     terminal                                     grants nothing
 *   requested  no decision yet                              grants nothing
 *   expired    approved, clock passed                       grants nothing
 *   active     approved, not denied, not revoked, clock live   THE ONLY GRANT
 *
 * ORDER IS LOAD-BEARING. The two terminal states are tested first, so a row
 * that is both approved and revoked reads `revoked`. Test `approved_at` first
 * and the same row reads live — which is the permissive drift 111 describes,
 * arriving through a reordering nobody would flag in review.
 */
export function sessionState(s, now = Date.now()) {
  if (!s) return null;
  if (s.revoked_at) return 'revoked';
  if (s.denied_at) return 'denied';
  if (!s.approved_at) return 'requested';
  // NULL expiry is UNTIL REVOKED, which is LIVE. A bare `> now` drops exactly
  // the open-ended sessions — the ones most worth showing to the customer who
  // granted them.
  if (s.expires_at && new Date(s.expires_at).getTime() <= now) return 'expired';
  return 'active';
}

/** Only one of the five is a grant. Written once so no caller re-spells it. */
export function isLive(s, now = Date.now()) {
  return sessionState(s, now) === 'active';
}

/**
 * How long is left, as a person would say it, or null.
 *
 * `null` for an open-ended session AND for one that has run out; the two are
 * told apart by `sessionState`, never by this. A caller that treats a missing
 * countdown as "expired" would drop the until-revoked sessions, and a caller
 * that treats it as "fine" would keep the dead ones — so this function
 * deliberately refuses to answer that question at all.
 */
export function remaining(expiresAt, now = Date.now()) {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const mins = Math.floor(ms / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  // A seven-day grant printed as "167h 12m" is a number nobody reads. Days
  // first, and the minutes drop off once there are days, because a figure that
  // precise is false comfort at that range.
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** The one word each state is called on screen, and its tone. */
export const STATE_LABEL = {
  requested: 'Awaiting the customer',
  active:    'Active',
  denied:    'Declined',
  expired:   'Ended — time ran out',
  revoked:   'Revoked',
};

export const STATE_TONE = {
  // Live access into somebody else's data is the platform violet everywhere in
  // this product, and never the tenant's accent — an operator must never see a
  // support session tinted with the colour of the company they are inside.
  active:    'var(--pf-primary)',
  requested: 'var(--warn)',
  denied:    'var(--on-surface-3)',
  expired:   'var(--on-surface-3)',
  revoked:   'var(--danger)',
};

/**
 * DORMANT — the endpoints are not there yet.
 *
 * 404 is the router being absent. 501 is a router that exists and says the
 * migration has not run. Both mean "no support sessions exist", which is TRUE
 * and is what every surface must render as silence.
 *
 * 403 is deliberately here too, and it is the subtlest of the three: a caller
 * who may not see sessions has none to see. Rendering a denial would advertise
 * a surface they cannot use, which is RBAC-SPEC's first denied-state rule —
 * no access means ABSENT, never a greyed-out row.
 *
 * A 500 and a dropped connection are NOT dormant. Those are failures, and a
 * screen that swallowed them would tell a customer "nobody is in your data"
 * on the strength of a request that never answered. That is the one lie this
 * feature cannot tell.
 */
const DORMANT = new Set([403, 404, 501]);

export function isDormant(err) {
  const code = err?.response?.status;
  return typeof code === 'number' && DORMANT.has(code);
}

/**
 * Sessions this caller can see, with dormancy separated from failure.
 *
 *   { data, dormant: true,  error: null }  nothing exists / not our surface
 *   { data: [], dormant: false, error }    something broke; SAY SO
 *   { data, dormant: false, error: null }  real rows
 *
 * `scope` is the audience, not a filter the client applies:
 *   'mine'     sessions I requested, in customers' organisations
 *   'customer' sessions into MY organisation, whoever asked
 *   'all'      every live session, god-mode only
 *
 * The server decides what each scope may return. Asking for `customer` as a
 * platform operator answers what an operator is allowed to see and not what
 * the word implies — the string names an intent, never an authority.
 */
export async function listSessions(api, scope = 'mine', orgId = null) {
  try {
    const params = orgId ? { scope, org_id: orgId } : { scope };
    const r = await api.get('/v1/support-sessions', { params });
    const rows = Array.isArray(r?.data?.data) ? r.data.data : [];
    return { data: rows, dormant: false, error: null };
  } catch (err) {
    if (isDormant(err)) return { data: [], dormant: true, error: null };
    return { data: [], dormant: false, error: err };
  }
}

/**
 * Newest decision first, then newest request. An operator's list and a
 * customer's list sort the same way, so a session read out over the phone is
 * in the same position on both screens.
 */
export function byRecency(a, b) {
  const at = new Date(a.approved_at || a.denied_at || a.requested_at || 0).getTime();
  const bt = new Date(b.approved_at || b.denied_at || b.requested_at || 0).getTime();
  return bt - at;
}

/**
 * Is this a module the server will accept? Falls back to the local list only
 * when the server offered no opinion — an ABSENT list is "no opinion", an
 * EMPTY one is "nothing", and collapsing the two would offer every module on a
 * deployment that permits none.
 */
export function requestable(serverModules) {
  if (!Array.isArray(serverModules)) return SUPPORT_MODULES;
  return SUPPORT_MODULES.filter(m => serverModules.includes(m.code));
}

/**
 * Can this request be sent? The three refusals, in the order the form shows
 * them, each phrased as what is MISSING rather than as what is wrong.
 *
 * `pss_reason_is_substantive` is a database CHECK, so a short reason is a 500
 * from the far side of the stack if it is not caught here. The floor is not
 * arbitrary tidiness: the owner is deciding whether to let a stranger into
 * their books, and "test" is the same non-answer as "" — a notice that says
 * nothing is worse than no notice, because it looks like process.
 */
export function requestBlockers({ orgId, reason, modules }) {
  const out = [];
  if (!orgId) out.push('Choose the organisation.');
  if (String(reason || '').trim().length < REASON_MIN) {
    out.push(`Give the customer a reason — at least ${REASON_MIN} characters. They read this before they decide.`);
  }
  if (!modules || modules.length === 0) {
    out.push('Name at least one module. A session with no modules reaches nothing.');
  }
  return out;
}
