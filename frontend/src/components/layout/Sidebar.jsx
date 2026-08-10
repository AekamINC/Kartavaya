/**
 * Sidebar.jsx — the ink sidebar, restyled to 01-navigation.md §1.
 *
 * Class vocabulary is `.side*`; the `.k-sidebar*` set it replaced was defined
 * twice (kartavaya-design.css and editorial.css) with the second copy
 * shadowing the first, which is how the light sidebar variant shipped without
 * an active-item override.
 *
 * English is the primary label, Devanagari the sub-label — the same hierarchy
 * staging already had, restyled rather than inverted, so DOM order matches
 * visual weight.
 */
import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { currentUser } from '../../lib/auth';
import { ICONS } from './navIcons';
import { navContext, navGroupsFor } from './navConfig';
import { useCustomize } from '../CustomizePanel';
import SideBrand from './SideBrand';
import { Secondary } from '../Bilingual';

// Keys are kept VERBATIM. Renaming either silently resets every existing
// user's sidebar to defaults, which reads as data loss rather than a restyle.
const SECTIONS_KEY = 'kartavya_sidebar_sections';
const COLLAPSED_KEY = 'kartavya_sidebar_collapsed';
const CORE_SECTION = 'workspace'; // expanded by default on first visit — everything else starts collapsed

function loadSectionState() {
  try {
    const raw = localStorage.getItem(SECTIONS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) { /* ignore */ }
  return null; // signals "no saved prefs yet" so callers can apply defaults per-section
}

/**
 * `true` | `false` | `null`, where NULL means "follow the Customize preference".
 *
 * The key keeps its exact name and its exact `'1'` / `'0'` values — 01 §5 says
 * keep both localStorage keys verbatim, and every stored value still parses to
 * what it always parsed to. What changes is that ABSENT is no longer folded
 * into `'0'`: `getItem` returning null used to become `false`, which read as
 * "the user chose wide" for someone who had never touched the control at all.
 * That is what made the rail preference and the toggle fight each other.
 */
function loadCollapsed() {
  try {
    const v = localStorage.getItem(COLLAPSED_KEY);
    return v === null ? null : v === '1';
  } catch (_) { return null; }
}

/**
 * @param {boolean} forceWide  MobileDrawer renders the sidebar at full width
 *   regardless of the rail preference — a rail inside a 280px overlay is a
 *   column of unlabelled icons with no reason to be narrow.
 */
export default function Sidebar({ inboxCount = 0, approvalsCount = 0, forceWide = false, onNavigate }) {
  const navigate  = useNavigate();
  const location  = useLocation();
  const user      = currentUser();

  const { prefs } = useCustomize();
  const lang  = prefs.language || 'en+sa';
  const showGu = lang === 'gu' || lang === 'en+gu';

  const [sectionState, setSectionState] = React.useState(loadSectionState);
  const [collapsed, setCollapsed] = React.useState(loadCollapsed);

  const navRef = React.useRef(null);
  const lozRef = React.useRef(null);

  const isSectionExpanded = (section) => {
    if (sectionState && Object.prototype.hasOwnProperty.call(sectionState, section)) return sectionState[section];
    return section === CORE_SECTION; // default: only Core expanded on first visit
  };

  const toggleSection = (section) => {
    setSectionState(prev => {
      const base = prev || {};
      const next = { ...base, [section]: !isSectionExpanded(section) };
      try { localStorage.setItem(SECTIONS_KEY, JSON.stringify(next)); } catch (_) { /* ignore */ }
      return next;
    });
  };

  // `prefs.sidebar` seeds the width; the toggle overrides it until the
  // preference itself changes. One boolean drives the rail, which is what
  // `Chrome.jsx:124` does with `setRail(!rail)` — there is no second, parallel
  // notion of collapsed in the reference implementation either.
  // THE RAIL IS A PREFERENCE AGAIN, NOT A WIDTH.
  //
  // This used to read `useMediaQuery(TABLET_BAND) || prefs.sidebar === 'rail'`,
  // forcing the rail across 768–1023 to match a block in `editorial.css`. Both
  // are gone, per 31-tablet.md §8 Finding 3 and the owner's decision of
  // 2026-08-07: the web app keeps the sidebar it has — in flow at ≥1024, an
  // overlay with a burger below that — and does not grow a second navigation
  // that only the native app is supposed to have.
  //
  // What survives is the CHOICE. Someone who prefers the rail still gets it at
  // any width; what went is inferring it from the viewport on their behalf.
  const isRail = prefs.sidebar === 'rail';
  const rail = !forceWide && (collapsed === null ? isRail : collapsed);

  const toggleCollapsed = () => {
    const next = !rail;
    setCollapsed(next);
    try { localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0'); } catch (_) { /* ignore */ }
  };

  /**
   * Changing Sidebar in Customize clears the override.
   *
   * Without this the two controls deadlock in the other direction: someone who
   * had ever pressed Collapse carries a stored `'0'`, and switching the
   * preference to Rail would then do nothing at all, so the Customize control
   * reads as broken. The preference sets the default, the toggle overrides it,
   * and a NEW preference wins back.
   *
   * The ref is what keeps this off the mount pass — a bare effect on
   * `prefs.sidebar` would wipe the stored override on every page load, which is
   * the same bug wearing different clothes.
   */
  const seededFrom = React.useRef(prefs.sidebar);
  React.useEffect(() => {
    if (seededFrom.current === prefs.sidebar) return;
    seededFrom.current = prefs.sidebar;
    setCollapsed(null);
    try { localStorage.removeItem(COLLAPSED_KEY); } catch (_) { /* ignore */ }
  }, [prefs.sidebar]);

  // Role predicates moved to navConfig.js and expressed against org_roles.
  // The old `isMember` boolean folded platform roles into the owner test, so
  // Reports was visible to any platform user regardless of org membership.
  const groups = React.useMemo(() => navGroupsFor(user), [user]);

  // An entry may carry a query string (the client nav points at a specific tab
  // of the customize hub). Entries without one match on path alone, so
  // Customize stays lit on every tab; entries with one must also match the
  // param, so a tab-specific link doesn't light up on its siblings.
  const isActive = (to) => {
    const [path, query] = to.split('?');
    if (location.pathname !== path && !location.pathname.startsWith(path + '/')) return false;
    if (!query) return true;
    const want = new URLSearchParams(query);
    const have = new URLSearchParams(location.search);
    return [...want].every(([k, v]) => have.get(k) === v);
  };

  const go = (to) => { navigate(to); onNavigate?.(); };

  const initials = ((user?.full_name || user?.name || 'U')
    .split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase());

  /**
   * "Owner · Aekam Inc", not "owner".
   *
   * `Chrome.jsx:133` puts the role AND the organisation on this line, and the
   * build printed the role alone. On its own the word is close to no
   * information — every user is one of four words, and the one thing that
   * differs between two sessions of the same person (which company am I signed
   * into) was the part left out. The org name comes from the same
   * `navContext()` the breadcrumb reads.
   *
   * Falls back to the bare role when there is no org: a platform operator and a
   * legacy account both land here, and a trailing separator with nothing after
   * it is worse than the short line.
   */
  const orgName = navContext(user).orgName;
  const roleWord = user?.role || 'member';
  const meLine = orgName ? `${roleWord} · ${orgName}` : roleWord;

  /**
   * Put the lozenge on the active item.
   *
   * The lozenge lives on `.side`, not inside `.side__nav`. The first version
   * put it in the nav and gave that box `position: relative` so it would be the
   * offsetParent — and the nav is the sidebar's SCROLL CONTAINER, which stopped
   * scrolling. Nothing about the scroller is touched now.
   *
   * So the row's position has to be converted into the rail's coordinates:
   * `offsetTop` within the nav, minus how far the nav has scrolled, plus where
   * the nav itself starts inside the rail. Hence the scroll listener — the
   * lozenge has to keep up as its row moves under it, and it is clipped by the
   * rail's own `overflow: hidden` when the row scrolls out of sight.
   *
   * `useLayoutEffect` and not `useEffect`: a section collapsing changes every
   * offset below it, and measuring after paint shows the lozenge one frame
   * behind.
   *
   * The active item can legitimately be absent — a route outside the rail, or a
   * collapsed section holding it — in which case the lozenge fades out rather
   * than sitting on a row that is not the one you are on.
   */
  React.useLayoutEffect(() => {
    const nav = navRef.current;
    const loz = lozRef.current;
    if (!nav || !loz) return undefined;

    const place = () => {
      const on = nav.querySelector('.side__item.on');
      /* A COLLAPSED SECTION STILL HOLDS ITS ROWS, AND THAT IS THE WHOLE BUG.
       *
       * The docblock above says the lozenge "fades out rather than sitting on a
       * row that is not the one you are on", and names a collapsed section as
       * one of the two cases. It never did. `.side__sec-items` closes by going
       * `grid-template-rows: 1fr → 0fr` and CLIPPING its child — the row is not
       * `display: none`, so `querySelector` finds it and `offsetHeight` still
       * answers 53. Measured on staging with Approvals open and its own section
       * closed: active row found, height 53, lozenge left at opacity 1 and 53px
       * tall, 40px under the OPERATIONS header — a gold block on a header with
       * nothing behind it, which is the screenshot that was reported.
       *
       * `data-open` is the honest test and it is already on the element for
       * exactly this state, written by the same render. Geometry is not: the
       * clipped row keeps its own box and reports its full height from inside a
       * container of zero. */
      const box = on?.closest('.side__sec-items');
      if (!on || (box && box.dataset.open === '0')) { loz.style.opacity = '0'; return; }
      loz.style.opacity = '1';
      loz.style.height = `${on.offsetHeight}px`;
      loz.style.transform = `translateY(${on.offsetTop - nav.scrollTop + nav.offsetTop}px)`;
    };
    place();

    // `passive`: this only reads and writes style, it never preventDefault()s,
    // and a non-passive scroll listener on the nav would make its own scrolling
    // worse — which is the bug this rewrite exists to fix.
    nav.addEventListener('scroll', place, { passive: true });

    /* Measure AGAIN while the layout is still moving.
     *
     * Collapsing the rail and opening/closing a section are both ANIMATED —
     * `.side` transitions its width, `.side__sec-items` its
     * `grid-template-rows: 0fr → 1fr`. This effect runs the instant the DOM
     * changes, i.e. on the FIRST frame of that animation, so `offsetTop` is
     * still the old geometry and the lozenge parks wherever the active row
     * used to be: the gold block left behind on a section header. Nothing
     * re-measured after the transition landed.
     *
     * A ResizeObserver on the animating boxes fires on every frame the height
     * actually changes, so the lozenge travels with its row instead of jumping
     * to a stale offset. The rail itself is observed too, because the width
     * change alters the section padding and therefore every offset below it. */
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    if (ro) {
      ro.observe(nav);
      if (nav.parentElement) ro.observe(nav.parentElement);
      /* The wrapper, not its child: it is the GRID whose row animates
         0fr → 1fr, so it is the box whose height actually changes. The inner
         div keeps its full height throughout and would never fire. */
      nav.querySelectorAll('.side__sec-items').forEach((el) => ro.observe(el));
    }

    /* AND the landing, as an event rather than as a frame.
     *
     * The observer above tracks the motion, but its callbacks are delivered per
     * FRAME — and a tab that is not being painted (backgrounded, occluded,
     * throttled) delivers none at all, while the transition still finishes and
     * the geometry still changes. Measured on the deployed build with the window
     * in the background: zero observer callbacks across a full section toggle
     * whose box went 0 → 218px. Coming back to that tab would have shown the
     * lozenge exactly where the bug leaves it.
     *
     * `transitionend` fires on the element that finished and BUBBLES, so one
     * listener on the sidebar catches the section grid, the rail width and
     * anything either grows later. It is the last word on where the row ended
     * up, whatever happened to the frames in between. */
    const side = nav.parentElement;
    side?.addEventListener('transitionend', place);

    /* AND a plain timer ladder, which is the one that actually always runs.
     *
     * Both mechanisms above are conditional on the browser PAINTING. Measured
     * on the deployed build, in a tab Chrome had backgrounded: a section toggle
     * moved the box from 0 to 218px — the layout changed, the row moved — and
     * delivered ZERO observer callbacks and ZERO transitionend events. The
     * geometry advances; the notifications do not. So the lozenge stayed 218px
     * from its row, which is exactly the report this is the second attempt at.
     *
     * Timers are not frame-bound. Four re-measures across ~600ms cover
     * `--dur-base` (300ms) and its slow twin with room to spare, at a cost of
     * four reads of one offsetTop. The last one is the one that matters; the
     * earlier three only make the settle look continuous when frames ARE being
     * painted and the observer is already doing the work.
     *
     * This is deliberately belt-and-braces. A navigation rail that ends up
     * highlighting the wrong row is the kind of fault that makes the whole app
     * feel broken, and the cheap fix has no downside worth naming. */
    const ladder = [60, 160, 320, 600].map((ms) => setTimeout(place, ms));

    return () => {
      nav.removeEventListener('scroll', place);
      side?.removeEventListener('transitionend', place);
      ro?.disconnect();
      ladder.forEach(clearTimeout);
    };
  });

  return (
    <aside className={'side' + (rail ? ' side--rail' : '')}>
      <SideBrand rail={rail} />

      {/* The lozenge. ONE element for the whole rail, moved to whichever item
          is active — so travelling between two modules is a slide. A per-item
          highlight cannot do it: two boxes can only cross-fade, and a fade in
          place reads as a flicker rather than as movement.

          A sibling of the nav, never a child of it: the nav is the scroll
          container and must be left exactly as it was. Hidden until measured,
          so it never appears at 0,0 for a frame on first paint. */}
      <span className="side__loz" ref={lozRef} aria-hidden="true" />

      <nav className="side__nav" ref={navRef}>
        {groups.map(({ section, sans, gu: guSec, items }) => {
          const expanded = rail ? true : isSectionExpanded(section);
          return (
            <div key={section}>
              {!rail && (
                <button
                  type="button"
                  className="side__sec"
                  aria-expanded={expanded}
                  onClick={() => toggleSection(section)}
                >
                  <span className="side__sec-chev" aria-hidden="true">{ICONS.chevR}</span>
                  <span className="side__sec-name">{section}</span>
                  <Secondary className="side__sec-hi" value={showGu ? guSec : sans} />
                </button>
              )}
              {rail && <div className="side__sec" aria-hidden="true" />}

              {/* grid-template-rows 0fr → 1fr, not a maxHeight computed from
                  items.length * 44. The literal broke the moment density or
                  font size changed, and 09-customization.md makes both
                  user-settable. The duration is a token, so Animations =
                  Reduced/None reaches it. */}
              <div className="side__sec-items" data-open={expanded ? '1' : '0'}>
                <div>
                  {items.map(({ to, icon, en, hi, gu: guLabel, adminOnly, badge }) => {
                    const badgeCount = badge === 'unread' ? inboxCount
                                     : badge === 'approvals' ? approvalsCount
                                     : 0;
                    const secondaryLabel = showGu ? guLabel : hi;
                    return (
                      <button
                        key={en}
                        type="button"
                        className={'side__item' + (isActive(to) ? ' on' : '')}
                        onClick={() => go(to)}
                        title={rail ? en : undefined}
                        aria-current={isActive(to) ? 'page' : undefined}
                      >
                        <span className="side__ic" aria-hidden="true">{ICONS[icon]}</span>
                        {!rail && (
                          <span className="side__label">
                            <span className="side__en">{en}</span>
                            {/* lang so a screen reader that does read this uses
                                the right voice. aria-hidden because this is the
                                SAME label in a second script, not additional
                                information: announcing both gives
                                "Tasks कर्तव्य Tasks कर्तव्य" as focus moves. */}
                            <Secondary className="side__hi" value={secondaryLabel} />
                          </span>
                        )}
                        {!rail && adminOnly && (
                          <span className="side__badge side__badge--admin">ADMIN</span>
                        )}
                        {!rail && badgeCount > 0 && (
                          <span className="side__badge side__badge--count">
                            {badgeCount > 9 ? '9+' : badgeCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </nav>

      {/* Rendered in RAIL TOO. It used to be hidden whenever the rail was the
          stored preference, on the reasoning that there was nothing to toggle
          back to — which was only true because the toggle wrote to a second
          boolean the preference already overrode. The result was that anyone
          who chose Sidebar = Rail in Customize had no way to widen it again
          without going back into Customize.

          `editorial.css:324-326` had already been written for this: it sizes
          `.side--rail .side__toggle` to 32px and rotates `.side__toggle-chev`
          180°, turning the left chevron into a right one. Both rules were dead
          because the element never mounted in that state. Rotating one glyph is
          also how `Chrome.jsx:125` spells it — `rail ? I.chevR : I.chevL`.

          `forceWide` still suppresses it: MobileDrawer pins the sidebar wide,
          and a collapse control inside a 280px overlay has nothing to do. */}
      {!forceWide && (
        <button
          type="button"
          className="side__toggle"
          aria-expanded={!rail}
          aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'}
          title={rail ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={toggleCollapsed}
        >
          <span className="side__toggle-chev" aria-hidden="true">{ICONS.chevL}</span>
          {!rail && <span>Collapse</span>}
        </button>
      )}

      {/* The organisation switcher used to sit here, as a native <select>.
          It is in the TOPBAR now — `Chrome.jsx:347` renders it as the first
          child of `.bar__crumb` — and on a phone, where the topbar is hidden,
          `MobileDrawer` renders it at the top of the sheet. It cannot live
          inside `.side`: the sidebar is `overflow: hidden`, which would clip
          the popover it opens. */}

      <div className="side__foot">
        <div className="k-avatar k-avatar--me">{initials}</div>
        {!rail && (
          <>
            <div className="side__me">
              <div className="side__me-n">{user?.full_name || user?.name || 'User'}</div>
              <div className="side__me-r" title={meLine}>{meLine}</div>
            </div>
            <button
              type="button"
              className="side__foot-btn"
              title="Sign out"
              aria-label="Sign out"
              onClick={async () => {
                const { apiLogout } = await import('../../lib/auth');
                await apiLogout();
                window.location.href = '/login';
              }}
            >
              {ICONS.logout}
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
