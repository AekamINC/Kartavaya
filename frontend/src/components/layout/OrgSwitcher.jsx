import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { getActiveOrg, setActiveOrg } from '../../lib/orgContext';
import { currentUser } from '../../lib/auth';
import { navContext } from './navConfig';
import { avatarBg } from '../ui/Avatar';
import FocusTrap from '../ui/FocusTrap';
import useDismiss from '../../hooks/useDismiss';
import { ICONS } from './navIcons';

/**
 * Which organisation this session is acting as — 01-navigation.md
 * §"Organisation switcher", DOM from `Chrome.jsx:281-336`.
 *
 * ── What it fixes ───────────────────────────────────────────────────────────
 * `165b2fd0` added org switching because the resolver fell back to the user's
 * OLDEST membership — `ORDER BY granted_at LIMIT 1` — so a person who belonged
 * to two firms could only ever see one of them. The MECHANISM shipped; the
 * surface did not. What shipped was a native `<select>` in the sidebar footer,
 * 81 lines, and `grep -rn "orgsw" frontend/src` returned zero. This is that
 * surface.
 *
 * ── It moved to the topbar, and that is not a preference ────────────────────
 * The prototype renders `<OrgSwitcher>` as the FIRST CHILD of `.bar__crumb`
 * (`Chrome.jsx:347`), before the `/` and the module name. The build had the
 * org as a plain `.crumb__org` span there AND a select in the sidebar — the
 * same question answered in two places, neither of them actionable. A person
 * about to raise an invoice looks at the top of the page to see whose invoice
 * it is; that is where the control belongs.
 *
 * `Topbar.jsx` previously declined the prototype's chip on the grounds that
 * "a second, unguarded way in does not belong in a breadcrumb". That reasoning
 * was right about the PROTOTYPE'S chip, which conflated two unrelated jobs —
 * naming the active org and toggling the platform console — into one control
 * that could show the state of neither. 01 splits the conflation: the console
 * is one row inside the menu, below a rule, and it is still gated on
 * `navContext().canOpenAdmin`, the same predicate `Protected` uses. It is not
 * a second door; it is the same door, named.
 *
 * ── Three sections, and one of them is usually absent ───────────────────────
 *   1. Your organisations — memberships only. NEVER the platform-wide org
 *      list: that is a different surface, in the console, and it must not be
 *      reachable from here.
 *   2. Support access · approved — omitted ENTIRELY when there are none.
 *      Never an empty state, because "you have no access to other companies"
 *      is the default condition and does not need saying. The table it reads
 *      does not exist on the live database at all — `to_regclass` returns
 *      NULL, and `111_platform_support_sessions.sql` is unapplied — so
 *      absent is the state this section will be in for weeks and it has to be
 *      silent: no error, no placeholder, no console noise.
 *   3. Aekam platform console — the surface switch, below a rule.
 *
 * ── Seat counts, and the number that is not there ───────────────────────────
 * `organisations.max_users` is enforced and typed in by hand per org, so an org
 * can sit at its ceiling with nothing saying so until someone fails to add an
 * employee. The row reads `Owner · 18 of 25 seats`, and at the cap
 * `at seat limit — 45 of 45` in `--warn`.
 *
 * There is a THIRD shape the prototype never faced, because `SW_ORGS` hardcodes
 * a `cap` on every row. Measured on the live database: two of the three orgs
 * have no cap at all, and six of seven rows in `staging.plans` have
 * `max_users` NULL. `seats_limit: null` means UNLIMITED, and the row renders
 * the ROLE ALONE — a denominator that does not exist must never be invented,
 * and "9 of 0 seats" is what collapsing NULL to zero would print.
 *
 * ── Switching is a hard boundary ────────────────────────────────────────────
 * `setActiveOrg` reloads the document rather than re-rendering under a new
 * header. Every module page holds fetched rows in component state, and swapping
 * the header without a reload would leave one tenant's invoices on screen while
 * the next request returns another's.
 *
 * The reload is not sufficient on its own, which is the bug `clearOrgCaches`
 * closes. `AppShell.jsx:258` reads `kv_teams_cache` from localStorage
 * SYNCHRONOUSLY and renders it before its own fetch returns, and `setActiveOrg`
 * never removed it — so for the first paint after a switch the sidebar listed
 * the PREVIOUS org's projects. Only the 401 handler and sign-out cleared that
 * key. (The server's module-gate cache is not the hazard the handover claims:
 * `middleware/subscription.py:425` keys it `f"{org_id}:{module_code}"`, so it
 * is already org-scoped and can only ever be stale for the SAME org.)
 *
 * ── One key was excused on a circular argument ──────────────────────────────
 * This docblock used to end by excusing `Kartavaya_user`, on the grounds that
 * it holds the client's copy of the gates and that "`Protected` overwrites [it]
 * from `/auth/me` on every mount, including the one after this reload". The
 * refetch is real. The conclusion did not follow: `/auth/me` answered the SAME
 * `module_grants`, `module_levels` and `org_roles` whichever org the header
 * named, so the overwrite replaced a stale wrong verdict with a fresh wrong one
 * and no test could tell the two apart.
 *
 * So the key is in `ORG_SCOPED_KEYS` below, and the case for removing it does
 * not rest on the refetch at all: `Sidebar.jsx:62` reads it SYNCHRONOUSLY
 * through `currentUser()`, so an entitlement verdict left in place is what the
 * next org's first frame is drawn from. Removing it makes that frame draw from
 * nothing — which is the honest answer to a question the server has not been
 * asked yet.
 *
 * Removing it WHOLESALE is safe, and that was checked rather than assumed:
 *   · `Protected.jsx:140` gates on `auth_token`, not on this record, so the
 *     hole does not read as a sign-out;
 *   · `Protected` renders the boot loader while `ready === null` and `null`
 *     while `!ready`, so AppShell, Sidebar, Topbar, ModuleHeader and every
 *     other `currentUser()` caller inside the shell mount only AFTER
 *     `/auth/me` has resolved and rewritten the record at `Protected.jsx:147`;
 *   · the one `currentUser()` outside the gate is `RootGate` (`App.jsx:122`),
 *     which serves `/` alone, and a switch lands on `/today`.
 * The only frame that sees the hole is this component's own last one, where
 * `navContext(null)` is already a supported input — every field is read through
 * `user?.` — so it degrades to "no console row, no fallback name" for the few
 * milliseconds before the document is thrown away.
 *
 * AND CORRECTNESS NOW DEPENDS ON THE BACKEND, which is worth saying plainly.
 * Clearing the key removes a wrong answer; it does not produce a right one.
 * Only the server resolving the ACTIVE org — rather than the caller's oldest
 * membership — does that. If `/auth/me` ever goes back to answering per-user
 * instead of per-active-org, this list stops being a fix and becomes a blank
 * first frame followed by the same wrong verdict as before.
 */

/** `org_owner` is not a label. */
const ROLE_LABEL = {
  org_owner: 'Owner',
  org_admin: 'Admin',
  org_member: 'Member',
};

/**
 * `Chrome.jsx:257`. Latin letters only, then the first letter of up to two
 * words.
 *
 * NOT `userInitials` from lib/utils: it does not strip Devanagari, so an org
 * registered as "मेहता एंड असोसिएट्स" would render a bare matra — a vowel sign
 * with nothing to attach to, which is a broken glyph rather than an initial.
 * A name with no Latin at all falls back to a bullet rather than to empty.
 */
export function swInitials(name) {
  const out = String(name || '')
    .replace(/[^A-Za-z ]/g, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return out || '•';
}

/**
 * The mark.
 *
 * The prototype gives every org a hand-picked hex. There is no column behind
 * it: `staging.organisations.brand_accent` exists and is NULL for all three
 * live orgs, and `logo_url`/`logo_key` are empty for all three. `avatarBg` is
 * the vetted substitute already in the repo — six hues its docblock measures at
 * 5.87–7.73:1 behind white initials, deterministic from the name, so one org is
 * one colour on every screen without anything being stored.
 */
function SwOrgMark({ name, size = 24 }) {
  return (
    <span
      className="orgsw__mark"
      aria-hidden="true"
      style={{ background: avatarBg(name), width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      {swInitials(name)}
    </span>
  );
}

function SwTick() {
  return (
    <svg className="orgsw__tick" width="13" height="13" viewBox="0 0 13 13" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 7l3 3 5-6.5" />
    </svg>
  );
}

/**
 * How long a support session has left, and whether it has any left at all.
 *
 *   { live: true,  remaining: '2h 14m' }   a clock is running
 *   { live: true,  remaining: null }       granted "until revoked" — migration
 *                                          111's `granted_ttl_hours = 0`, the
 *                                          only value that leaves an approved
 *                                          row with a NULL expiry. Open-ended
 *                                          is not the same as absent, and it is
 *                                          the case most worth showing.
 *   { live: false, remaining: null }       run out. The row DISAPPEARS: 01 is
 *                                          explicit that an expired session
 *                                          "must not silently keep working".
 */
export function sessionClock(expiresAt, now = Date.now()) {
  if (!expiresAt) return { live: true, remaining: null };
  const ms = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return { live: false, remaining: null };
  const mins = Math.floor(ms / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  // `168` is one of migration 111's four durations, so a seven-day grant is an
  // ordinary case rather than an edge one — and "167h 12m" in a topbar tag is a
  // number nobody reads. Days first, and the minutes drop once there are days,
  // because a figure that precise is false comfort at that range.
  if (d > 0) return { live: true, remaining: `${d}d ${h}h` };
  return { live: true, remaining: h > 0 ? `${h}h ${m}m` : `${m}m` };
}

/**
 * The explanation an expired session leaves behind.
 *
 * 01-navigation.md: an expired session "disappears from the list and, if it is
 * the active org, drops the user back to their default membership WITH AN
 * EXPLANATION. It must not silently keep working."
 *
 * The drop-back goes through `setActiveOrg`, which RELOADS the document — that
 * reload is the whole point of the switch and cannot be skipped, because every
 * module page holds the previous tenant's rows in component state. So the
 * explanation has to outlive a navigation, and `sessionStorage` is the only
 * store that does that and still dies with the tab. A toast would be raised on
 * the frame before the document is thrown away and nobody would ever see it.
 *
 * `takeSupportEndedNotice` is a READ-AND-CLEAR: the explanation is shown once,
 * on the page the user lands on, and does not follow them around the app.
 */
const SUPPORT_ENDED_KEY = 'kv_support_ended';

export function takeSupportEndedNotice() {
  try {
    const raw = sessionStorage.getItem(SUPPORT_ENDED_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(SUPPORT_ENDED_KEY);
    const v = JSON.parse(raw);
    return v && v.ref ? v : null;
  } catch {
    // Private mode, or somebody put a non-JSON value under our key. An
    // explanation we cannot read is one we do not show; it is never a throw on
    // the first paint of every page in the product.
    return null;
  }
}

function leaveSupportEndedNotice(v) {
  try { sessionStorage.setItem(SUPPORT_ENDED_KEY, JSON.stringify(v)); } catch { /* no store */ }
}

/** The sub-line's seat half — or nothing at all, which is a real answer. */
export function seatPhrase(org) {
  const limit = org?.seats_limit;
  const used = org?.seats_used;
  if (limit == null || used == null) return null;
  if (used >= limit) return { text: `at seat limit — ${used} of ${limit}`, full: true };
  return { text: `${used} of ${limit} seats`, full: false };
}

/**
 * Everything the previous org left in localStorage that the reload alone would
 * not clear. See the header for why `Kartavaya_user` is on it.
 *
 *   kv_teams_cache            `AppShell.jsx:259` — the previous org's projects,
 *                             read synchronously and rendered before its own
 *                             fetch returns.
 *   Kartavaya_user            `Sidebar.jsx:62` via `currentUser()` —
 *                             `module_grants`, `module_levels`, `org_roles` and
 *                             the org itself. The entitlement verdict.
 *   Kartavaya_report_history  `ReportsPage.jsx:33` — eight export rows whose
 *                             `name` is built at `:516` as
 *                             `Kartavaya-{project-name}-{from}-{to}`, so this is
 *                             the previous org's PROJECT NAMES in the clear.
 *   kv_onboarding             `OnboardingPage.jsx:70` — the setup wizard's
 *                             resume state: the org NAME, the invited EMAIL
 *                             ADDRESSES and the first project's name. Not
 *                             cosmetic and not merely a leak: switching into an
 *                             org whose `onboarding_complete` is false reopens
 *                             the wizard (`Protected.jsx:292`) prefilled from
 *                             the org it was abandoned in, and Continue then
 *                             PATCHes that name onto THIS org.
 *
 * Exported so the test sweeps THIS list rather than a copy of it that can drift.
 */
export const ORG_SCOPED_KEYS = [
  'kv_teams_cache',
  'Kartavaya_user',
  'Kartavaya_report_history',
  'kv_onboarding',
];

/**
 * One `try` per key rather than one around the loop: a store that throws on the
 * first removal — private mode, a blocked third-party context — would otherwise
 * abandon the rest of the list at the first failure, and the keys that matter
 * most are not the ones at the front.
 */
function clearOrgCaches() {
  for (const key of ORG_SCOPED_KEYS) {
    try { localStorage.removeItem(key); } catch { /* private mode */ }
  }
}

/**
 * `withSeparator` — the breadcrumb's leading `/`, rendered by the switcher and
 * not by the bar.
 *
 * `Chrome.jsx:345-347` has the two as siblings, and in the prototype that is
 * safe because its switcher always renders. This one does not: a client-portal
 * user with no organisation and no console gets nothing, and a `.crumb__sep`
 * sitting alone at the head of the trail is a breadcrumb that begins with a
 * slash. Only this component knows whether it drew anything, so it owns the
 * separator that depends on the answer. The mobile sheet passes nothing —
 * there is no trail there for a slash to be part of.
 */
export default function OrgSwitcher({ withSeparator = false }) {
  const [orgs, setOrgs] = useState([]);
  const [support, setSupport] = useState([]);
  const [active, setActive] = useState(getActiveOrg());
  const [defaultId, setDefaultId] = useState(null);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [ended, setEnded] = useState(null);
  const dropped = useRef(false);
  const wrap = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();

  const ctx = navContext(currentUser());
  // `/admin` is a real, separately-guarded route, so "am I an operator right
  // now" is a question about the URL rather than about a flag we hold.
  const plat = location.pathname === '/admin' || location.pathname.startsWith('/admin/');

  useEffect(() => {
    let alive = true;
    api.get('/v1/org/memberships')
      .then((r) => {
        if (!alive) return;
        setOrgs(r.data?.data || []);
        // A 404 and an empty list are the same fact — no approved sessions —
        // and neither is an error. The table does not exist yet.
        setSupport(Array.isArray(r.data?.support) ? r.data.support : []);
        setDefaultId(r.data?.default_id || null);
        if (!getActiveOrg() && r.data?.default_id) setActive(r.data.default_id);
      })
      // A switcher that cannot list is simply absent. It is a convenience, and
      // failing loudly here would put an error on every page of the app.
      .catch(() => { if (alive) { setOrgs([]); setSupport([]); } });
    return () => { alive = false; };
  }, []);

  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, wrap, close);

  // Live sessions only, recomputed as the clock moves. An expired one drops out
  // of the list on its own rather than waiting for a reload.
  const liveSupport = support
    .map((s) => ({ ...s, ...sessionClock(s.expires_at, now) }))
    .filter((s) => s.live);
  const activeSupport = liveSupport.find((s) => s.org_id === active) || null;

  // The session standing behind the ACTIVE org, live or not. `activeSupport`
  // above is already filtered to the live ones, so it cannot answer "did the
  // org I am sitting in just stop being reachable" — by the time it could, the
  // row is gone and the fact is lost. This is the row the expiry watches.
  const activeRow = useMemo(
    () => support.find((s) => s.org_id === active) || null,
    [support, active],
  );

  /**
   * THE COUNTDOWN IS A REAL CLOCK.
   *
   * A second while the operator is INSIDE a support session, thirty while the
   * menu is merely open. The fast tick is not for the label — that reads in
   * minutes — it is so that the drop-back below fires when the clock passes
   * rather than up to half a minute later. Half a minute of a session that has
   * ended is half a minute of requests the customer did not authorise, and the
   * only thing standing between them and the data is the server refusing each
   * one. It should not have to.
   */
  useEffect(() => {
    if (!open && !activeRow) return undefined;
    const t = setInterval(() => setNow(Date.now()), activeRow ? 1000 : 30000);
    return () => clearInterval(t);
  }, [open, activeRow]);

  /**
   * At zero, the row disappears AND the user is dropped back — with an
   * explanation, and never silently.
   *
   * The switcher is the only component in the product that knows a support
   * session was the active org, so it is the one that has to act. Left alone,
   * the operator sits on a screen that has started 403ing every request with no
   * statement anywhere about why, and 01-navigation.md is explicit that an
   * expired session "must not silently keep working".
   *
   * Three details worth defending:
   *
   *   · `plat` short-circuits. Under `/admin` the operator is on the platform
   *     surface, not in a tenant view, and `setActiveOrg` navigates to `/today`
   *     — dropping them back would eject them from the console they are working
   *     in over a header the server is already refusing.
   *   · `dropped` is a ref, not state. The drop reloads the document, but the
   *     interval above can fire again before the navigation commits, and two
   *     `location.assign` calls is a race over which org the user lands in.
   *   · With no membership to fall back to — a pure Aekam account whose only
   *     reach was the session — the answer is `null`, which CLEARS the header.
   *     The server then resolves nothing rather than one org too many.
   */
  useEffect(() => {
    if (plat || dropped.current || !activeRow) return;
    if (sessionClock(activeRow.expires_at, now).live) return;
    dropped.current = true;
    const back = orgs.find((o) => o.id === defaultId) || orgs[0] || null;
    leaveSupportEndedNotice({ ref: activeRow.ref, name: activeRow.name, back: back?.name || null });
    clearOrgCaches();
    setActiveOrg(back?.id || null);
  }, [plat, activeRow, now, orgs, defaultId]);

  // The explanation the drop-back left behind, read once on the page the user
  // lands on. An effect rather than a lazy initialiser: StrictMode invokes an
  // initialiser twice, and this one CLEARS what it reads, so the second call
  // would find nothing and the explanation would be lost in development only.
  useEffect(() => {
    const notice = takeSupportEndedNotice();
    if (notice) setEnded(notice);
  }, []);

  const current = orgs.find((o) => o.id === active) || orgs[0] || null;
  // `/auth/me` has carried `org_roles[].org_name` all along. It is the fallback
  // for the moment before the fetch lands and for the case where it fails —
  // without it, the breadcrumb's first segment would blink out on every load.
  const name = current?.name || ctx.orgName;

  const choose = (orgId) => {
    setOpen(false);
    if (!plat && orgId === (active || current?.id)) return;   // no reload for a no-op
    clearOrgCaches();
    setActiveOrg(orgId);
  };

  const toggleConsole = () => {
    setOpen(false);
    navigate(plat ? '/today' : '/admin');
  };

  // Nothing to choose between. One membership, no approved session, no console
  // to open — a picker with a single entry is furniture that implies a decision
  // exists. The NAME still renders: it is the breadcrumb's first segment and
  // the only place in the product that says whose data this is.
  const hasChoice = orgs.length > 1 || liveSupport.length > 0 || ctx.canOpenAdmin;
  const sep = withSeparator
    ? <span className="crumb__sep" aria-hidden="true">/</span>
    : null;

  /**
   * The explanation, on the page the drop-back landed on.
   *
   * `role="status"` rather than `alert`: nothing is wrong. A session finished
   * on the schedule the customer set, which is the feature working. It is
   * dismissible because it is a statement of fact and not a decision — the
   * thing it describes has already happened and there is nothing to confirm.
   *
   * It renders in BOTH branches below and in the one-membership case, because
   * the person most likely to see it is a support account whose only reach was
   * the session that just ended: after the drop-back they may have no choice
   * left to make at all, and that is exactly when they most need telling why.
   */
  const notice = ended ? (
    <div className="orgsw__ended" role="status">
      <span className="orgsw__ended-c">
        <span className="orgsw__ended-t">{ended.ref} ended</span>
        <span className="orgsw__ended-p">
          {`Your support session on ${ended.name} reached its time limit. `}
          {ended.back
            ? `You are back in ${ended.back}.`
            : 'You are no longer inside a customer organisation.'}
        </span>
      </span>
      <button
        type="button"
        className="orgsw__ended-x"
        aria-label="Dismiss"
        onClick={() => setEnded(null)}
      >
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor"
          strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M2.2 2.2l6.6 6.6M8.8 2.2l-6.6 6.6" />
        </svg>
      </button>
    </div>
  ) : null;

  if (!hasChoice) {
    if (!name && !notice) return null;
    return (
      <>
        <div className="orgsw">
          {name && <span className="orgsw__t-n" title={name}>{name}</span>}
          {notice}
        </div>
        {sep}
      </>
    );
  }

  const triggerName = plat ? 'Aekam platform' : (activeSupport?.name || name || 'Organisation');
  const triggerTitle = plat
    ? 'Aekam platform console — cross-org'
    : activeSupport
      ? 'Support session — every action is written to their audit log'
      : 'Switch organisation';

  return (
    <>
    <div className="orgsw" ref={wrap}>
      <button
        type="button"
        className={`orgsw__t${open ? ' on' : ''}${plat ? ' orgsw__t--plat' : activeSupport ? ' orgsw__t--sup' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={triggerTitle}
        onClick={() => setOpen((v) => !v)}
      >
        {plat
          ? <span className="orgsw__mark orgsw__mark--plat" aria-hidden="true">{ICONS.hub}</span>
          : <SwOrgMark name={triggerName} size={20} />}
        <span className="orgsw__t-n">{triggerName}</span>
        {/* The tag is why an operator with two tabs open is never unsure which
            one they are typing into. */}
        {activeSupport && !plat && (
          <span className="orgsw__t-tag">
            support · {activeSupport.remaining || 'until revoked'}
          </span>
        )}
        <svg className="orgsw__chev" width="10" height="10" viewBox="0 0 10 10" fill="none"
          stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2.6 4L5 6.4 7.4 4" />
        </svg>
      </button>

      {open && (
        <FocusTrap>
          <div className="pop orgsw__pop" role="menu" aria-label="Organisation">
            <div className="pop__head">Your organisations</div>
            {orgs.map((o) => {
              const on = !activeSupport && !plat && (active ? o.id === active : o.id === current?.id);
              const seats = seatPhrase(o);
              const role = ROLE_LABEL[o.role] || o.role;
              return (
                <button
                  key={o.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={on}
                  className={`orgsw__row${on ? ' on' : ''}`}
                  onClick={() => choose(o.id)}
                >
                  <SwOrgMark name={o.name} />
                  <span className="orgsw__col">
                    <span className="orgsw__n">{o.name}</span>
                    {/* No seat clause at all when the org is uncapped. The role
                        alone is the honest line; a number we did not receive is
                        not available to be shown. */}
                    <span className={`orgsw__m${seats?.full ? ' orgsw__m--full' : ''}`}>
                      {seats ? `${role} · ${seats.text}` : role}
                    </span>
                  </span>
                  {on && <SwTick />}
                </button>
              );
            })}

            {liveSupport.length > 0 && (
              <>
                <div className="pop__head orgsw__head--sup">Support access · approved</div>
                {liveSupport.map((s) => {
                  const on = activeSupport?.id === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={on}
                      className={`orgsw__row orgsw__row--sup${on ? ' on' : ''}`}
                      onClick={() => choose(s.org_id)}
                    >
                      <SwOrgMark name={s.name} />
                      <span className="orgsw__col">
                        <span className="orgsw__n">{s.name}</span>
                        <span className="orgsw__m">
                          {s.ref} · approved by {s.approved_by}
                          {s.remaining ? ` · ends in ${s.remaining}` : ' · until revoked'}
                        </span>
                      </span>
                      {on && <SwTick />}
                    </button>
                  );
                })}
                {/* Not reassurance for the operator. It is `11`'s rule —
                    support access is never silent — put where the operator
                    reads it at the moment they use it. */}
                <p className="orgsw__note">
                  Not a membership. Time-boxed, written to their audit log, and their owner
                  was emailed when it opened.
                </p>
              </>
            )}

            {ctx.canOpenAdmin && (
              <>
                <div className="orgsw__sep" />
                {/* `menuitem`, not `menuitemradio`. Opening the console is a
                    command; the radios above are one single choice. */}
                <button
                  type="button"
                  role="menuitem"
                  className={`orgsw__row orgsw__row--plat${plat ? ' on' : ''}`}
                  onClick={toggleConsole}
                >
                  <span className="orgsw__mark orgsw__mark--plat" aria-hidden="true">{ICONS.hub}</span>
                  <span className="orgsw__col">
                    <span className="orgsw__n">Aekam platform console</span>
                    <span className="orgsw__m">Cross-org operations · not a tenant view</span>
                  </span>
                  {plat && <SwTick />}
                </button>
              </>
            )}
          </div>
        </FocusTrap>
      )}

      {notice}
    </div>
    {sep}
    </>
  );
}
