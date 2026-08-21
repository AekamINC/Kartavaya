/**
 * SkillDock.jsx — the corner dock. Proposals 71 and 72, built.
 *
 *   SkillDock                       ← mounted ONCE, in AppShell
 *   ├── pill                        "Quick actions · 9"
 *   └── panel  role="dialog"
 *       ├── head    page name · esc
 *       ├── tabs    Skills · Numbers · Automations · Due   role="tablist"
 *       ├── pane    SkillsPane | MetricsPane | AutomationsPane | DuePane
 *       └── foot    the whole shelf → · Ask Sahayak instead
 *
 * ── Why a dock and not a chat ───────────────────────────────────────────────
 *
 * The instinct was "small chatbot in the bottom right", and proposal 71 keeps
 * the placement and rejects the shape for three reasons that still hold: there
 * is already a chat and it is not finished; a blinking cursor asks the user to
 * guess the vocabulary, which is the exact defect being fixed (nobody knows a
 * skill called "Input tax credit about to lapse" exists); and a chat reply
 * cannot show "0 credits · reads only" in a way anyone trusts. Four named rows
 * can. Chat is the escape hatch in the footer, not the front door.
 *
 * ── Why FOUR sections ───────────────────────────────────────────────────────
 *
 * Skills cover ten module codes, Niyam automations eleven, analytics metrics
 * fourteen. A skills-only dock is empty on eSign, on Attendance, on Analytics
 * and on Messages — four of the pages a firm opens most. With four sections
 * the empty tab is never the same tab twice, and there is no page in the shell
 * where the corner has nothing true to say. That is the promise a
 * single-purpose dock could not make, and it is the whole reason for the tabs.
 *
 * ── THE COUNT ───────────────────────────────────────────────────────────────
 *
 * The pill carries a number, chosen by the owner against advice. It is the sum
 * of the four tabs' rows for the CURRENT page, recomputed from the lists that
 * are about to be rendered, and refetched every time the dock is opened.
 *
 * IT IS STORED NOWHERE. No localStorage, no sessionStorage, no server counter,
 * no "seen", no "unread", no dismissed set — grep this component and
 * `dock/useDockData.js` and there is nothing to find. A count with no memory
 * cannot become a second inbox, because it has nothing to nag you about; it
 * says "there are nine things on this page" and it says the same nine until
 * the catalogue itself changes. That is the condition the badge was accepted
 * on and it is enforced by there being no code capable of breaking it.
 *
 * ── The corner is not empty ─────────────────────────────────────────────────
 *
 * `.k-onboard` — the first-run setup checklist — is `fixed; right:20; bottom:20;
 * z-index:400`, real, and mounted in this same shell. It WINS the corner while
 * it is up; this dock lifts above it by measuring it. See `useCornerLift`.
 *
 * `.k-cust-launch` sits on the same coordinates at `z-index:90` with no JSX in
 * the repository rendering it — dead CSS from the Customize panel. It is
 * REPORTED, not deleted, and not inherited: this dock brings its own classes so
 * that removing that block later is a decision somebody makes on purpose.
 *
 * Mobile: the bottom bar owns that corner below 768px and the dock is
 * `display:none` there, which also takes it out of the accessibility tree
 * rather than leaving an invisible tab stop. eSign already established that not
 * every surface is a mobile destination.
 *
 * ── ⌘K ─────────────────────────────────────────────────────────────────────
 *
 * `lib/commands.js` is the ONE command registry, and it is one because there
 * were once three lists and two palettes both bound to ⌘K. This dock starts no
 * fourth list: it holds no static catalogue of any kind, only what the four
 * endpoints answered. Putting skill NAMES into that registry so ⌘K finds them
 * needs `commands.js` and `CommandPalette.jsx`, and both are outside this
 * change — see the report.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { currentUser } from '../../lib/auth';
import { pageModules } from '../../lib/routeModules';
import { Secondary } from '../Bilingual';
import useExitAnimation from '../../hooks/useExitAnimation';
import useDockData from './dock/useDockData';
import { buildLists, dockCount } from './dock/dockItems';
import { DockShim } from './dock/DockRow';
import SkillsPane from './dock/SkillsPane';
import MetricsPane from './dock/MetricsPane';
import AutomationsPane from './dock/AutomationsPane';
import DuePane from './dock/DuePane';
import '../../styles/dock.css';

/**
 * The four sections. `Numbers` and not `Metrics` because that is the word the
 * demo settled on and the word a firm uses; `Due` and not `Compliance` for the
 * same reason.
 */
const TABS = [
  { k: 'skills', label: 'Skills', hi: 'कौशल' },
  { k: 'metrics', label: 'Numbers', hi: 'अंक' },
  { k: 'automations', label: 'Automate', hi: 'नियम' },
  { k: 'due', label: 'Due', hi: 'देय' },
];

/**
 * How far to lift the dock so it never lands on the setup checklist.
 *
 * `OnboardingChecklist` decides for itself whether to render — it reads
 * localStorage for `dismissed`, derives completion from three API calls, and
 * returns null when everything is done — and it is a sibling of this component
 * inside `.kv`, not an ancestor. There is no prop and no context to consult,
 * and adding one would mean editing a file this change does not own.
 *
 * So the corner is arbitrated by MEASURING it. The checklist and its minimised
 * pill are both direct children of `.kv`, so a `childList` observer on that one
 * node (NOT `subtree`, which would fire on every keystroke in the product)
 * catches mount, unmount and the minimise swap between them, and nothing else.
 *
 * Cheap, exact, and it degrades to zero — no checklist, no lift.
 */
function useCornerLift() {
  const [lift, setLift] = useState(0);

  useEffect(() => {
    const shell = document.querySelector('.kv');
    if (!shell) return undefined;

    const measure = () => {
      const card = document.querySelector('.k-onboard, .k-onboard-pill');
      // 12px of air between the two surfaces, so they read as two things.
      setLift(card ? Math.round(card.getBoundingClientRect().height) + 12 : 0);
    };

    measure();
    const mo = new MutationObserver(measure);
    mo.observe(shell, { childList: true });
    window.addEventListener('resize', measure);
    return () => { mo.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  return lift;
}

export default function SkillDock() {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('skills');
  const [cursor, setCursor] = useState(0);

  const rootRef = useRef(null);
  const pillRef = useRef(null);
  const panelRef = useRef(null);

  const data = useDockData();
  const { refresh } = data;
  const lift = useCornerLift();
  const { alive, closing, onAnimationEnd } = useExitAnimation(open);

  // `currentUser()` re-parses localStorage on every call and returns a NEW
  // object each time — the unbounded-fetch bug documented at length in
  // `OnboardingChecklist`. Nothing here lists it in a dependency array; it is
  // read once per render and handed straight to a pure function.
  const user = currentUser();

  const page = useMemo(() => pageModules(location.pathname), [location.pathname]);

  /**
   * The four lists, recomputed whenever the page or the catalogue changes.
   * Pure — `buildLists` makes no request and holds no state, so navigating
   * costs a filter and not a fetch.
   */
  const lists = useMemo(() => buildLists(page, data, user),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page, data.orgSkills, data.templates, data.caps, data.metrics,
     data.rules, data.ruleTemplates]);

  const counts = {
    skills: lists.skills.length,
    metrics: lists.metrics.length,
    automations: lists.automations.length,
    due: lists.due.length,
  };
  const total = dockCount(lists);

  // A new page is a new set of four lists; the cursor from the old one points
  // at a row that no longer exists.
  useEffect(() => { setCursor(0); }, [location.pathname, tab]);

  const close = useCallback(() => {
    setOpen(false);
    // Focus goes back to the pill NOW rather than when the exit finishes —
    // `ui/Picker.jsx` documents why: deferring leaves focus inside a panel that
    // is already leaving, and on nothing at all once it unmounts.
    pillRef.current?.focus();
  }, []);

  const go = useCallback((route) => { close(); navigate(route); }, [close, navigate]);

  /**
   * OPENING REFETCHES. That is what "computed fresh on open" means here: the
   * rows you are looking at were fetched because you opened the dock. The
   * cached copy renders underneath in the meantime so the panel never opens on
   * a spinner.
   */
  const toggle = useCallback(() => {
    setOpen((was) => {
      if (!was) refresh();
      return !was;
    });
  }, [refresh]);

  /**
   * Escape, the focus trap, and the arrow keys. Hand-rolled, as `ui/Picker.jsx`
   * is — React Aria was evaluated for this codebase and rejected.
   *
   * `keydown` in the CAPTURE phase and `stopPropagation` on Escape, so closing
   * the dock does not also close whatever is behind it. AppShell binds Escape
   * for the shortcuts sheet on the window, and it must not see this one.
   */
  useEffect(() => {
    if (!open) return undefined;

    const rows = () => [...(panelRef.current?.querySelectorAll('[data-dockrow]') || [])];
    const focusables = () => [...(panelRef.current?.querySelectorAll(
      'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ) || [])];

    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); return; }

      if (e.key === 'Tab') {
        // The trap. Not `inert` on the rest of the page — this is a popover
        // over a live page, and the user may legitimately want to leave it —
        // but while it is open Tab stays inside, which is what makes it
        // dismissible with one key rather than twelve.
        const list = focusables();
        if (!list.length) return;
        const first = list[0];
        const last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault(); last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first.focus();
        }
        return;
      }

      // Left/Right walk the tabs. The WAI-ARIA tablist pattern, and the reason
      // the tab strip is a real `role="tablist"` rather than four buttons.
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const at = TABS.findIndex(t => t.k === tab);
        const next = (at + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
        e.preventDefault();
        setTab(TABS[next].k);
        panelRef.current?.querySelector(`[data-docktab="${TABS[next].k}"]`)?.focus();
        return;
      }

      // Up/Down walk the rows of the current tab, moving REAL focus rather
      // than a painted highlight — so Enter activates the row the browser
      // agrees is focused, and a screen reader reads it on arrival.
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const list = rows();
        if (!list.length) return;
        e.preventDefault();
        const at = list.indexOf(document.activeElement);
        const next = e.key === 'ArrowDown'
          ? Math.min(list.length - 1, at + 1)
          : Math.max(0, at < 0 ? 0 : at - 1);
        setCursor(next);
        list[next]?.focus();
        return;
      }

      if (e.key === 'Home' || e.key === 'End') {
        const list = rows();
        if (!list.length) return;
        e.preventDefault();
        const at = e.key === 'Home' ? 0 : list.length - 1;
        setCursor(at);
        list[at]?.focus();
      }
    };

    // Outside click. `mousedown` and not `click`, for the reason
    // `hooks/useDismiss.js` records: a `click` listener fires after the target
    // has handled its own mousedown, so a control that re-renders on press can
    // swallow the dismissal. The root wraps the pill as well as the panel, so
    // pressing the pill to close is a toggle rather than a close-then-reopen.
    const onPointer = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };

    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open, tab, close]);

  // Focus the panel on open so the trap has something to trap, and so a
  // keyboard user is inside the thing they just summoned.
  useEffect(() => { if (open) panelRef.current?.focus(); }, [open]);

  const listId = `k-dock-list-${tab}`;
  const paneProps = {
    page, listId, cursor, onCursor: setCursor, onGo: go,
  };

  return (
    <div className="k-dock__root" ref={rootRef}
      style={{ '--k-dock-lift': `${lift}px` }}>

      {alive && (
        <div
          className="k-dock"
          ref={panelRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="false"
          aria-label={`Quick actions for ${page.label}`}
          data-closing={closing ? '' : undefined}
          onAnimationEnd={onAnimationEnd}
        >
          <div className="k-dock__head">
            <div className="k-dock__titles">
              <div className="k-dock__title">{page.label}</div>
              {page.hi && <Secondary className="k-dock__hi" as="div" value={page.hi} />}
            </div>
            <button type="button" className="k-dock__esc" onClick={close}>esc</button>
          </div>

          <div className="k-dock__tabs" role="tablist" aria-label="Dock sections">
            {TABS.map(t => (
              <button
                key={t.k}
                type="button"
                role="tab"
                data-docktab={t.k}
                className="k-dock__tab"
                aria-selected={tab === t.k}
                aria-controls={`k-dock-list-${t.k}`}
                // Roving tabindex: one stop for the whole strip, arrows within.
                tabIndex={tab === t.k ? 0 : -1}
                onClick={() => setTab(t.k)}
              >
                {t.label}
                <span className="k-dock__tab-n">{counts[t.k]}</span>
              </button>
            ))}
          </div>

          <div className="k-dock__body">
            {data.loading ? <DockShim /> : (
              <>
                {tab === 'skills' && (
                  <SkillsPane {...paneProps} skills={lists.skills}
                    caps={data.caps} restricted={data.skillsRestricted} />
                )}
                {tab === 'metrics' && (
                  <MetricsPane {...paneProps} metrics={lists.metrics} />
                )}
                {tab === 'automations' && (
                  <AutomationsPane {...paneProps} automations={lists.automations}
                    restricted={data.niyamRestricted} />
                )}
                {tab === 'due' && <DuePane {...paneProps} due={lists.due} />}
              </>
            )}
          </div>

          {data.failed && <p className="k-dock__err" role="status">{data.failed}</p>}

          <div className="k-dock__foot">
            <button type="button" className="k-dock__footlink"
              onClick={() => go('/hub/org?tab=skills')}>
              The whole shelf →
            </button>
            <button type="button" className="k-dock__footlink"
              onClick={() => go('/hub/org?tab=sahayak')}>
              Ask Sahayak instead
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        ref={pillRef}
        className="k-dock__pill"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={toggle}
      >
        {open ? 'Close' : 'Quick actions'}
        {/* The count. Rendered only once something has been fetched — a zero
            drawn before the first read would claim the page has nothing when
            the truth is that nobody has looked yet. */}
        {!data.loading && (
          <span className="k-dock__pill-n" data-none={total === 0 ? '' : undefined}>
            {total}
          </span>
        )}
      </button>
    </div>
  );
}
