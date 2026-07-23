/**
 * AppShell.jsx — main layout shell.
 * Week 3: Templates added to sidebar nav.
 *
 * Bug fix (2026-05-14):
 * FIX #3: teamId is now null (not "") until the /teams fetch completes.
 *   Previously it resolved to "" immediately, and that empty string was
 *   passed to ActivityFeedPage / AutomationsPage / TimeReportPage via
 *   outlet context, causing those pages to fire requests with no team_id.
 *   Child pages should render a loading state while teamId === null.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { NotificationsModal } from '../NotificationsModal';
import TaskEditor from '../TaskEditor';
import Sidebar from './Sidebar';
import Topbar  from './Topbar';
import { NotifToastContainer, NotifPermissionPrompt } from './NotifToast';
import CommandPalette from '../CommandPalette';
import KeyboardShortcuts from '../KeyboardShortcuts';
import { urlBase64ToUint8Array } from '../../lib/push';
import { playNotifSound } from '../../lib/notifSound';
import { Bell, Menu, X } from 'lucide-react';

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

function requestBrowserPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    Notification.requestPermission().then(perm => { if (perm === 'granted') subscribeToPush(); });
  } else if (Notification.permission === 'granted') {
    subscribeToPush();
  }
}

function fireBrowserNotif(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
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

export default function AppShell() {
  const [notifOpen,    setNotifOpen]    = useState(false);
  const [newTaskOpen,  setNewTaskOpen]  = useState(false);
  const [cmdkOpen,     setCmdkOpen]     = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [unread,       setUnread]       = useState(0);
  const [sidebarOpen,  setSidebarOpen]  = useState(false);
  const [teams,        setTeams]        = useState([]);
  const [teamsLoaded,  setTeamsLoaded]  = useState(false);
  const [notifPrompt,  setNotifPrompt]  = useState(false);
  const [toasts,       setToasts]       = useState([]);
  const prevUnread = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => { window.__kartavya_navigate = navigate; return () => { delete window.__kartavya_navigate; }; }, [navigate]);

  // Register SW and ask for browser notification permission after 4 s
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});

      // When a new service worker takes control after a deploy, notify user
      // instead of force-reloading — auto-reload resets all React state
      // (open forms, active tabs) causing data loss mid-workflow.
      let notifiedForNewSW = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (notifiedForNewSW) return;
        notifiedForNewSW = true;
        setToasts(prev => [...prev, { notification_id: `sw-${Date.now()}`, title: 'App updated — refresh when ready', message: 'A new version is available.', url: null }]);
      });
    }
    const t = setTimeout(() => {
      if (!('Notification' in window)) return;
      if (Notification.permission === 'default') setNotifPrompt(true);
      else if (Notification.permission === 'granted') requestBrowserPermission();
    }, 4000);
    return () => clearTimeout(t);
  }, []);

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

  useEffect(() => {
    let live = true;
    const tick = async () => {
      try {
        const r = await api.get('/notifications/poll');
        const count = r.data.unread ?? 0;
        const fresh = r.data.fresh ?? [];
        if (live) {
          if (prevUnread.current !== null && count > prevUnread.current) {
            if (document.visibilityState === 'visible') {
              // Show custom in-app toasts for each fresh notification
              if (fresh.length > 0) {
                setToasts(prev => [...prev, ...fresh.filter(n => !prev.find(p => p.notification_id === n.notification_id))]);
              } else {
                // Fallback synthetic toast if fresh list is empty
                setToasts(prev => [...prev, { notification_id: `synth-${Date.now()}`, title: 'New notification', message: 'Open notifications to view', url: null }]);
              }
              playNotifSound();
            } else if (Notification.permission === 'granted') {
              fireBrowserNotif(
                fresh[0]?.title ?? 'New notification',
                fresh[0]?.message ?? 'Open Kartavaya to view'
              );
            }
          }
          prevUnread.current = count;
          setUnread(count);
        }
      } catch (_) {}
    };
    tick();
    let id = setInterval(tick, 60_000);
    const onVis = () => {
      clearInterval(id);
      id = setInterval(tick, document.hidden ? 300_000 : 60_000);
      if (!document.hidden) tick();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => { live = false; clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);

  const gPending = useRef(false);
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

  // FIX #3: null until loaded — child pages guard on null to avoid empty requests.
  const teamIdFromPath = location.pathname.match(/\/projects\/([^/]+)/)?.[1];
  const teamId = teamIdFromPath || (teamsLoaded ? (teams[0]?.team_id || '') : null);

  return (
    <div data-testid="app-shell" className="k-app">
      {/* Sidebar — hidden on mobile via CSS */}
      <div className="k-app__sidebar">
        <Sidebar inboxCount={unread} />
      </div>

      {/* Mobile overlay drawer */}
      {sidebarOpen && (
        <div className="k-app__mob-overlay" onClick={() => setSidebarOpen(false)}>
          <div className="k-app__mob-drawer" onClick={e => e.stopPropagation()}>
            <Sidebar inboxCount={unread} />
          </div>
        </div>
      )}

      {/* Main column */}
      <div className="k-main">
        {/* Mobile topbar */}
        <div className="k-app__mob-bar">
          <button className="k-iconbtn" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
            <Menu size={18} />
          </button>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--ink)', fontWeight: 500 }}>Kartavaya</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button className="k-iconbtn" style={{ position: 'relative' }} onClick={() => setNotifOpen(true)} aria-label="Notifications">
              <Bell size={18} />
              {unread > 0 && (
                <span style={{ position: 'absolute', top: -4, right: -4, height: 16, minWidth: 16, padding: '0 4px', borderRadius: 99, fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#dc2626', color: '#fff', fontWeight: 700 }}>
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>
            <button className="k-btn k-btn--primary k-btn--sm" onClick={() => setNewTaskOpen(true)} style={{ padding: '6px 12px', fontSize: 12 }}>
              + New task
            </button>
          </div>
        </div>

        {/* Desktop topbar */}
        <div className="k-app__topbar">
          <Topbar unread={unread} onOpenNotifications={() => setNotifOpen(true)} onNewTask={() => setNewTaskOpen(true)} onOpenCmdk={() => setCmdkOpen(true)} />
        </div>


        {/* Page content */}
        <main className="k-content">
          <Outlet context={{ teamId, teams }} />
        </main>
      </div>

      <NotificationsModal open={notifOpen} onOpenChange={setNotifOpen} />
      <TaskEditor open={newTaskOpen} onOpenChange={setNewTaskOpen} teams={teams} defaultTeamId={teamId ?? undefined} onSaved={() => setNewTaskOpen(false)} />
      <CommandPalette open={cmdkOpen} onClose={() => setCmdkOpen(false)} onNewTask={() => { setCmdkOpen(false); setNewTaskOpen(true); }} />
      <KeyboardShortcuts open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      {/* Corner notification permission prompt */}
      {notifPrompt && (
        <div style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 9998, pointerEvents: 'all' }}>
          <NotifPermissionPrompt
            onAllow={() => { setNotifPrompt(false); requestBrowserPermission(); }}
            onDismiss={() => setNotifPrompt(false)}
          />
        </div>
      )}

      {/* In-app toast stack */}
      <NotifToastContainer
        toasts={toasts}
        onDismiss={(id) => setToasts(prev => prev.filter(t => t.notification_id !== id))}
      />
    </div>
  );
}

// re-export Protected so App.js can import from one place
export { default as Protected } from './Protected';
