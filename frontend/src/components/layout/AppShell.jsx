/**
 * AppShell.jsx — the staff layout shell. `01-navigation.md` §2.
 *
 *   AppShell
 *   ├── Sidebar        rail | wide            layout/Sidebar.jsx
 *   ├── MobileDrawer   ≤1023px overlay        layout/MobileDrawer.jsx
 *   ├── main
 *   │   ├── mobbar     ≤1023px  burger · brand · bell
 *   │   ├── Topbar     crumb · palette · bell · new task
 *   │   ├── <Outlet/>
 *   │   └── MobileNav  ≤767px 5-slot bottom bar
 *   └── overlays       palette · shortcuts · toasts · permission ask
 *
 * A CLIENT NEVER REACHES THIS FILE. `App.jsx` routes `/client/*` through
 * `pages/client/ClientShell.jsx` outside this shell and `Protected` bounces a
 * client off every staff path, because `19-client-portal.md`'s never-see list
 * opens with "The module sidebar. A client has no modules."
 *
 * ── Notifications (21-notifications-inbox.md defects 1 and 4)
 *
 * This file used to be one of three components that independently owned the
 * notification list: it polled `/notifications/poll` into its own `unread`
 * integer and its own toast array, while `NotificationsModal` fetched
 * `/notifications` into a second array and `InboxPage` fetched it into a third.
 * Marking something read in the bell and then opening the Inbox showed it
 * unread again, and the bell badge kept a stale count until the next tick.
 *
 * The poll now lives in `NotificationProvider` and the count comes from
 * `useNotifications()`, which is the same store the Inbox and the bell panel
 * read. There is one array and one definition of unread.
 *
 * What is still owned here is the TOAST QUEUE, and deliberately: the store
 * holds notifications, not the transient stack of cards showing them, and the
 * provider hands this shell exactly the fresh rows to toast through `onFresh`.
 *
 * ── The permission prompt no longer runs on a stopwatch
 *
 * It used to be a `setTimeout(…, 4000)` on the first authenticated load — four
 * seconds into a user's first ever session, before they had created anything,
 * about notifications they had not yet been given a reason to want. Deny once
 * and the browser records it permanently; no code can ask again. The ask is now
 * gated on `askAfterAction()`, fired after an action that actually produces a
 * notification, so the prompt explains itself.
 *
 * FIX #3 (2026-05-14) is unchanged: teamId is null (not "") until the /teams
 * fetch resolves, so child pages can guard on null instead of firing requests
 * with an empty team_id.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { NotificationsModal } from '../NotificationsModal';
import NewTaskModal from '../NewTaskModal';
import Sidebar from './Sidebar';
import Topbar  from './Topbar';
import { NotifToastContainer, NotifPermissionPrompt } from './NotifToast';
import CommandPalette from '../CommandPalette';
import KeyboardShortcuts from '../KeyboardShortcuts';
import OnboardingChecklist from '../OnboardingChecklist';
import SkipLink from '../ui/SkipLink';
import MobileDrawer from './MobileDrawer';
import MobileNav from './MobileNav';
import { ICONS } from './navIcons';
import { resolveRouteMeta } from './navConfig';
import { useCustomize } from '../CustomizePanel';
import { urlBase64ToUint8Array } from '../../lib/push';
import { playNotifSound } from '../../lib/notifSound';
import ErrorBoundary from '../ErrorBoundary';
import ModuleAccess from '../module/ModuleAccess';
import {
  NotificationProvider, askAfterAction, clearAskReason,
  notifPermission, readNotifPrefs, shouldDeliver, useNotifications,
} from '../../context/NotificationContext';

// `data-platform` is written by the blocking script in index.html, beside
// data-theme and for the same reason: both must be on <html> before the
// stylesheet paints. Setting it here, after mount, would show one frame of a
// blurred sidebar on Windows before it snapped solid — and would leave the
// admin and auth surfaces without it entirely. See 01-navigation.md §1.

async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing) return; // already subscribed
    const keyRes = await api.get('/push/vapid-public-key');
    const pubKey = keyRes.data?.public_key;
    if (!pubKey || pubKey === 'not-configured') return;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(pubKey),
    });
    await api.post('/push/subscribe', sub.toJSON());
  } catch (_) {}
}

// Every read of `Notification` goes through `notifPermission()`, which returns
// the string 'unsupported' rather than throwing. The API is absent in iOS
// Safari before 16.4, in embedded webviews, and outside a secure context, and
// an unguarded read at any of those is a blank screen rather than a missing
// bell.
function requestBrowserPermission() {
  const perm = notifPermission();
  if (perm === 'default') {
    Notification.requestPermission().then(p => { if (p === 'granted') subscribeToPush(); });
  } else if (perm === 'granted') {
    subscribeToPush();
  }
}

function fireBrowserNotif(title, body) {
  if (notifPermission() !== 'granted') return;
  try {
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.ready.then(reg =>
        reg.showNotification(title, { body, icon: '/logo192.png', badge: '/logo192.png' })
      );
    } else {
      new Notification(title, { body, icon: '/icon-192.png' });
    }
  } catch (_) {}
}

/**
 * The compact bar's page label — the mobile counterpart of `Topbar`'s crumb.
 *
 * Split out rather than inlined because it needs `useLocation` and
 * `useCustomize`, and AppShell already reads both for other reasons; a separate
 * component keeps the language branch in ONE place instead of a second copy of
 * the `showGu` ternary that Topbar owns.
 *
 * The Devanagari carries `lang` for the same reason it does in the crumb:
 * `--font-indic` is repointed to Noto Sans Gujarati under an EN+GU preference,
 * which has no Devanagari coverage, so a span whose script varies per row must
 * declare which script it actually holds.
 */
function MobileCrumb() {
  const location = useLocation();
  const meta = resolveRouteMeta(location.pathname);
  const { prefs } = useCustomize();
  const showGu = prefs.language === 'gu' || prefs.language === 'en+gu';
  const indic = (showGu && meta.gu) ? meta.gu : meta.hi;
  return (
    <div className="kv__mobbar-crumb">
      <div className="kv__mobbar-hi" lang={(showGu && meta.gu) ? 'gu' : 'hi'} aria-hidden="true">{indic}</div>
      <div className="kv__mobbar-en">{meta.en}</div>
    </div>
  );
}

export default function AppShell() {
  const [notifOpen,     setNotifOpen]     = useState(false);
  const [newTaskOpen,   setNewTaskOpen]   = useState(false);
  const [cmdkOpen,      setCmdkOpen]      = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [approvals,     setApprovals]     = useState(0);
  const [sidebarOpen,   setSidebarOpen]   = useState(false);
  const [teams,         setTeams]         = useState([]);
  const [teamsLoaded,   setTeamsLoaded]   = useState(false);
  const [toasts,        setToasts]        = useState([]);
  const location = useLocation();
  const navigate = useNavigate();

  // One array, one definition of unread — the same store the bell panel and
  // the Inbox read. This replaces the local `unread` integer that a second
  // poll used to maintain.
  const { unread, askReason } = useNotifications({ autoLoad: false });

  useEffect(() => { window.__kartavya_navigate = navigate; return () => { delete window.__kartavya_navigate; }; }, [navigate]);

  const dropToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.notification_id !== id));
  }, []);

  /**
   * What the provider's poll hands us. STABLE identity is not cosmetic here:
   * `NotificationProvider` lists `onFresh` in its effect dependencies, so an
   * inline arrow would tear down and rebuild the 60-second interval on every
   * render of this shell — which is every navigation.
   *
   * The delivery gate is `shouldDeliver`, not a bare `if`. Quiet hours mute the
   * toast, the sound and the push; they never mute the notification, which has
   * already been ingested into the store above and arrives in the Inbox with
   * its real timestamp.
   *
   * Gated PER ROW, not on `fresh[0]`. A poll can return a mixed batch, and
   * `support` is the one kind that ignores DND outright — a customer asked to
   * grant access to their own data is told immediately, at 3am, whatever their
   * settings say (11-platform-admin.md: support access is never silent).
   * Deciding the whole batch from its first row silences that.
   *
   * The row field is `type`; the backend writes `assigned`, `mention`,
   * `approval_request`, `reminder` and so on (`server.py` · create_notification).
   */
  const onFresh = useCallback((fresh) => {
    if (!fresh?.length) return;
    // `shouldDeliver(type, OPTIONS)` — the second argument is an options bag,
    // not the prefs object. This passed `prefs` bare, which happened to behave
    // because `k_prefs` contains no key named `quiet`, `prefs`, `now` or
    // `isMine`, so every destructured default still applied. It was one
    // CustomizePanel default away from silently disabling the quiet-hours gate:
    // add a `quiet` key to `k_prefs` for any unrelated reason and `quiet` would
    // have destructured to it instead of the server's window, and `inQuietHours`
    // would have read `undefined.start`.
    //
    // Read once, outside the map, so a batch of ten is one localStorage read.
    const prefs = readNotifPrefs();
    const gates = fresh.map(n => shouldDeliver(n?.type, { prefs }));

    if (document.visibilityState === 'visible') {
      const showable = fresh.filter((_, i) => gates[i].toast);
      if (!showable.length) return;
      setToasts(prev => [
        ...prev,
        ...showable.filter(n => !prev.some(p => p.notification_id === n.notification_id)),
      ]);
      if (gates.some(g => g.sound)) playNotifSound();
      return;
    }
    // Hidden tab. A synthetic "New notification / Open notifications to view"
    // fallback used to fire here with no url and nothing to say; a notification
    // that interrupts and then declines to explain itself costs a decision and
    // returns nothing. With no content, the badge moves silently.
    const pushable = fresh.find((n, i) => gates[i].push && n?.title);
    if (pushable) fireBrowserNotif(pushable.title, pushable.message ?? '');
  }, []);

  // Service worker only. The 4-second permission timer that used to live in
  // this effect is gone — see the file header.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {});

    // When a new service worker takes control after a deploy, notify instead of
    // force-reloading — auto-reload resets all React state (open forms, active
    // tabs), losing work mid-flow.
    let notified = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (notified) return;
      notified = true;
      setToasts(prev => [...prev, {
        notification_id: `sw-${Date.now()}`,
        title: 'App updated — refresh when ready',
        message: 'A new version is available.',
        url: null,
      }]);
    });
  }, []);

  // Already granted from a previous session — re-subscribe silently. This asks
  // nothing and shows nothing; it only reconnects a push subscription the
  // browser dropped.
  useEffect(() => { if (notifPermission() === 'granted') subscribeToPush(); }, []);

  useEffect(() => {
    // Stale-while-revalidate: show cached teams instantly, then refresh in background.
    const cached = localStorage.getItem('kv_teams_cache');
    if (cached) {
      try { setTeams(JSON.parse(cached)); setTeamsLoaded(true); } catch (_) {}
    }
    api.get('/teams')
      .then(r => {
        setTeams(r.data);
        try { localStorage.setItem('kv_teams_cache', JSON.stringify(r.data)); } catch (_) {}
      })
      .catch(() => {})
      .finally(() => setTeamsLoaded(true));
  }, []);

  /**
   * The approvals badge — the ONE integer the provider does not carry.
   *
   * This used to be a SECOND `/notifications/poll` timer, on its own five-minute
   * interval, existing solely to read `r.data.approvals` because there was no
   * way to reach the payload the provider was already fetching. Two timers on
   * one endpoint — and that endpoint is not a read: `poll_notifications`
   * processes due reminders and INSERTS notification rows as a side effect, so
   * the second timer was running that sweep at a cadence nobody chose.
   *
   * `onPoll` now hands over the whole `{ unread, fresh, approvals }` body from
   * the poll the provider already runs. One call, both numbers — which is what
   * `01-navigation.md` §4 asked for.
   *
   * Stable identity, like `onFresh`: the provider lists it in the effect deps,
   * so an inline arrow would tear down and rebuild the interval on every
   * navigation.
   */
  const onPoll = useCallback((payload) => {
    setApprovals(payload?.approvals ?? 0);
  }, []);

  useEffect(() => { setSidebarOpen(false); setNotifOpen(false); }, [location.pathname]);

  const gPending = React.useRef(false);
  useEffect(() => {
    const isInput = () => {
      const tag = document.activeElement?.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable;
    };
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCmdkOpen(prev => !prev);
        return;
      }
      if (isInput() || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key;
      if (key === '?') { e.preventDefault(); setShortcutsOpen(prev => !prev); return; }
      if (key === 'Escape') { setShortcutsOpen(false); return; }
      if (gPending.current) {
        gPending.current = false;
        const routes = { d: '/dashboard', t: '/tasks', c: '/graha', i: '/ganit', h: '/manav' };
        if (routes[key]) { e.preventDefault(); window.__kartavya_navigate?.(routes[key]); }
        return;
      }
      if (key === 'g') { gPending.current = true; setTimeout(() => { gPending.current = false; }, 800); return; }
      if (key === 'n' || key === 'N') { e.preventDefault(); setNewTaskOpen(true); return; }
      if (key === 'i' || key === 'I') { e.preventDefault(); window.__kartavya_navigate?.('/ganit'); return; }
      if (key === 'c' || key === 'C') { e.preventDefault(); window.__kartavya_navigate?.('/graha'); return; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  /**
   * The ask, attached to an action rather than a clock.
   *
   * Creating a task from the shell is the first thing most users do that
   * produces a notification for somebody — an assignee is told, and if it is
   * routed for approval an approver is too. `askAfterAction` records the reason
   * and the prompt below renders it as "You just created a task", so the
   * request arrives with its own justification instead of four seconds after a
   * cold start.
   */
  const onTaskCreated = useCallback(() => {
    setNewTaskOpen(false);
    askAfterAction('created a task');
  }, []);

  // FIX #3: null until loaded — child pages guard on null to avoid empty requests.
  const teamIdFromPath = location.pathname.match(/\/projects\/([^/]+)/)?.[1];
  const teamId = teamIdFromPath || (teamsLoaded ? (teams[0]?.team_id || '') : null);

  // The Inbox renders `NotificationBanner`, which carries the same ask in the
  // page body. Showing the corner card there too would ask the same question
  // twice on one screen.
  const showAsk = Boolean(askReason) && notifPermission() === 'default' && location.pathname !== '/inbox';

  return (
    <NotificationProvider onFresh={onFresh} onPoll={onPoll}>
      <div data-testid="app-shell" className="kv">
        {/* First tab stop. Must stay first in DOM order — the sidebar below is
            15 module links plus a settings group. */}
        <SkipLink />

        {/* Sidebar slot. The ≤1023px media query hides THIS, not `.side`, so the
            second copy rendered inside MobileDrawer survives — hiding `.side`
            directly is what makes a burger open an empty scrim. */}
        <div className="kv__side">
          <Sidebar inboxCount={unread} approvalsCount={approvals} />
        </div>

        {/* The replacement that ships with that media query, in the same change. */}
        <MobileDrawer
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          inboxCount={unread}
          approvalsCount={approvals}
        />

        {/* Main column */}
        <div className="kv__main">
          {/* Compact bar — burger, brand, actions. Shown ≤1023px. */}
          <div className="kv__mobbar">
            <button type="button" className="k-iconbtn" onClick={() => setSidebarOpen(true)} aria-label="Open menu" aria-expanded={sidebarOpen}>
              {ICONS.burger}
            </button>
            {/* The bar names the PAGE, not the product.
                It read "Kartavaya" on all thirty screens — the one fact a
                phone user already knows, in the one slot they have. The
                desktop breadcrumb is `display:none` at this width
                (`editorial.css` · the 1023px block), so below it there was no
                page identity anywhere on screen.
                `Chrome.jsx:288-291`'s MobileTop is the shape: the module's own
                Devanagari over its English. Same `resolveRouteMeta` the
                breadcrumb uses, so the two cannot disagree. */}
            <MobileCrumb />
            <div className="kv__mobbar-actions">
              {/* Its own anchor. The panel hangs off whichever bell was
                  pressed; anchoring both to the desktop topbar would open it
                  off-screen on a phone, where that bar is display:none. */}
              <div className="k-notif-anchor">
                <button
                  type="button"
                  className="k-iconbtn"
                  data-notif-trigger=""
                  aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
                  aria-expanded={notifOpen}
                  aria-haspopup="dialog"
                  onClick={() => setNotifOpen(o => !o)}
                >
                  {ICONS.bell}
                  {unread > 0 && <span className="k-iconbtn__dot" />}
                </button>
                <NotificationsModal open={notifOpen} onOpenChange={setNotifOpen} />
              </div>
            </div>
          </div>

          {/* Desktop topbar */}
          <div className="kv__top">
            <Topbar
              unread={unread}
              notifOpen={notifOpen}
              onNotifOpenChange={setNotifOpen}
              onNewTask={() => setNewTaskOpen(true)}
              onOpenCmdk={() => setCmdkOpen(true)}
              onOpenShortcuts={() => setShortcutsOpen(true)}
            />
          </div>

          {/* Page content. tabIndex={-1} is required by the skip link — without
              it the jump moves the scroll position but not focus, so the next Tab
              continues from the sidebar. */}
          <main className="kv__content" id="main" tabIndex={-1}>
            {/* A SECOND boundary, inside the shell.
                The only other one wraps the whole app in `App.jsx:296`, so a
                throw anywhere in any tab replaced the sidebar, the nav and the
                whole product with "Something went wrong / Reload page" — one
                bad panel took down everything, and the sole way out was a
                reload. Scoped here, the shell survives: the failure is confined
                to the page, and the user can navigate to a working module
                instead of losing the session's context.
                `key={pathname}` clears it on navigation — a boundary latches on
                error, so without it the first throw would poison every
                subsequent route for the rest of the session. */}
            <ErrorBoundary key={location.pathname} scope="page">
              {/* F32 — every module page renders under here, so the module code
                  is published once, from the route, rather than threaded
                  through nine page files and every tab beneath them.
                  `resolveRouteMeta` is the same longest-prefix match the topbar
                  title uses, and `ROUTE_META` has carried `module` since the
                  nav needed it. A non-module route (Today, Settings, the admin
                  consoles) resolves to undefined, which `useModuleWrite` reads
                  as "no opinion" and gates nothing.

                  Deliberately HERE and not in the pages: reading the route in
                  a leaf would put `useLocation` in every gated component, and
                  `useLocation` throws outside a Router — which broke eleven
                  existing tests that render a tab standalone. The provider is
                  route-derived; its consumers only ever read context. */}
              <ModuleAccess module={resolveRouteMeta(location.pathname)?.module}>
                <Outlet context={{ teamId, teams }} />
              </ModuleAccess>
            </ErrorBoundary>
          </main>

          {/* Bottom bar, ≤767px. The compact bar above carries no "New task"
              because the FAB here is that action, at 44px, within thumb reach. */}
          <MobileNav
            unread={unread}
            onNewTask={() => setNewTaskOpen(true)}
            onOpenMore={() => setSidebarOpen(true)}
          />
        </div>

        {/* The global "New task" surface. This slot rendered `TaskEditor`, a
            595-line second editor for the same entity that `TaskDrawer` and
            this modal already cover — `03-task-drawer.md` marks it "Audit for
            deletion … two 32 KB components editing the same entity is how the
            status-colour drift happened". `NewTaskModal`'s own header names
            this exact call site as its purpose, and it was already the surface
            `BoardsPage` used, so the two create paths now agree. The audit is
            closed: `TaskEditor.jsx` had no importer left once this slot moved,
            so it was deleted rather than converged. */}
        <NewTaskModal
          open={newTaskOpen}
          onClose={() => setNewTaskOpen(false)}
          onCreated={onTaskCreated}
          defaultProjectId={teamId ?? ''}
        />

        <CommandPalette open={cmdkOpen} onClose={() => setCmdkOpen(false)} onNewTask={() => { setCmdkOpen(false); setNewTaskOpen(true); }} />
        <KeyboardShortcuts open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

        {/* Corner permission prompt. Was an inline zIndex: 9998, which sat above
            the command palette's ladder-correct 620 and above every modal — a
            corner card rendered on top of the dialog the user was reading.
            `.kv__ask` puts it on 26 §4's toast rung. */}
        {showAsk && (
          <div className="kv__ask">
            <NotifPermissionPrompt
              onAllow={() => { clearAskReason(); requestBrowserPermission(); }}
              onDismiss={clearAskReason}
            />
          </div>
        )}

        {/* First-run setup checklist — floating, bottom-right, always skippable */}
        <OnboardingChecklist onNewTask={() => setNewTaskOpen(true)} />

        {/* In-app toast stack */}
        <NotifToastContainer toasts={toasts} onDismiss={dropToast} />
      </div>
    </NotificationProvider>
  );
}

// re-export Protected so App.jsx can import from one place
export { default as Protected } from './Protected';
