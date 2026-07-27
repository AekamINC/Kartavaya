/* __verify/main.jsx — mounts the REAL shipping page components inside the REAL
 * AppShell and the REAL stylesheet graph, so getComputedStyle reports what a
 * user would get. Nothing in this directory is imported by the app.
 *
 * ── Why a harness and not a login ────────────────────────────────────────────
 * Every page below sits behind <Protected>. Staging and production share one
 * Supabase project and Pahchan holds real biometric data, so signing in to look
 * at a layout is not an option. Instead:
 *
 *   1. `api.defaults.adapter` is replaced BEFORE any component mounts. Every
 *      request resolves locally from ./fixtures.js. No request leaves the page,
 *      so the shared database is never read and never written.
 *   2. Pahchan photo endpoints resolve to a flat SVG generated in-page. No face
 *      image is fetched, cached, stored or logged anywhere.
 *   3. Push and service-worker registration are stubbed out, so nothing is
 *      delivered to a real device.
 *
 * ── Query parameters ─────────────────────────────────────────────────────────
 *   ?p=<key>        which page to mount (see PAGES)
 *   ?state=ok|loading|empty|error   force one of the three non-content states
 *   ?theme=light|dark
 *   ?shell=0        mount the page bare, without AppShell
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// App.jsx's import order, verbatim (App.jsx lines 18-26). A partial stylesheet
// graph is how an earlier probe "proved" the .kv scroll bug did not exist.
import '../src/App.css';
import '../src/styles/index.css';
import '../src/styles/kartavaya-design.css';
import '../src/styles/editorial.css';
import '../src/styles/settings.css';

import { api } from '../src/lib/api';
import { ToastProvider } from '../src/components/ui/toast';
import { CustomizeProvider } from '../src/components/CustomizePanel';
import AppShell from '../src/components/layout/AppShell';
import * as F from './fixtures.js';

// A harness entry cannot be hot-swapped: re-running this module calls
// createRoot() on a container that already has one, and React then renders
// nothing at all — which reads exactly like the page under test being broken.
// Decline the update and take a full reload instead.
if (import.meta.hot) import.meta.hot.decline();

const q = new URLSearchParams(location.search);
const STATE = q.get('state') || 'ok';
const PAGE = q.get('p') || 'pahchan';

/* ── Nothing leaves the page ──────────────────────────────────────────────── */

// Push and SW: stubbed before AppShell can call them.
if (navigator.serviceWorker) {
  navigator.serviceWorker.register = () => Promise.resolve({ scope: '/' });
}
try {
  Object.defineProperty(window, 'Notification', {
    value: function Blocked() {}, writable: true, configurable: true,
  });
  window.Notification.permission = 'denied';
  window.Notification.requestPermission = () => Promise.resolve('denied');
} catch (e) { /* already non-configurable — permission is 'default', which asks nothing */ }

const NOW = new Date().toISOString().slice(0, 10);

function mockData(url = '', method = 'get') {
  const u = String(url);

  /* Pahchan ─────────────────────────────────────────────────────────────── */
  // Signed-URL endpoints. A locally generated placeholder, never a real face.
  if (/\/pahchan\/punches\/[^/]+\/photo/.test(u))            return { url: F.FACE('punch') };
  if (/\/pahchan\/enrollment\/photos\/[^/]+\/url/.test(u))   return { url: F.FACE('ref') };
  if (/\/pahchan\/register/.test(u))    return { punches: STATE === 'empty' ? [] : F.PUNCHES, on: NOW };
  if (/\/pahchan\/policy/.test(u))      return F.POLICY;
  if (/\/pahchan\/sites/.test(u))       return STATE === 'empty' ? [] : F.SITES;
  if (/\/pahchan\/enrollment\/queue/.test(u)) return STATE === 'empty' ? { pending_approval: [], incomplete: [] } : F.ENROLL_QUEUE;
  if (/\/pahchan\/regularisations/.test(u))   return STATE === 'empty' ? [] : F.REGULARISATIONS;
  if (/\/pahchan\/me\b/.test(u))        return STATE === 'empty' ? { employee: F.MY_ATTENDANCE.employee, punches: [], retention: F.MY_ATTENDANCE.retention } : F.MY_ATTENDANCE;
  if (/\/pahchan\/attendance/.test(u))  return STATE === 'empty' ? { days: [], rows: [] } : F.MY_ATTENDANCE;

  /* Sanvaad ─────────────────────────────────────────────────────────────── */
  // The real router answers `{level, can_post, can_manage}` (messaging.py:152-154).
  if (/\/messaging\/me\b/.test(u)) {
    const lvl = q.get('access') || 'editor';
    return { level: lvl, can_post: lvl !== 'viewer', can_manage: lvl === 'admin' };
  }
  if (/\/messaging\/channels\/[^/]+\/members/.test(u)) return F.DIRECTORY;
  // `list_messages` answers a bare array, newest-first (useChannelMessages.js).
  if (/\/messaging\/channels\/[^/]+\/messages/.test(u)) return STATE === 'empty' ? [] : [...F.MESSAGES].reverse();
  if (/\/messaging\/channels/.test(u))   return STATE === 'empty' ? [] : F.CHANNELS;
  if (/\/messaging\/messages\/[^/]+\/thread/.test(u)) return { messages: F.THREAD, root: F.MESSAGES[0] };
  if (/\/messaging\/directory/.test(u))  return F.DIRECTORY;
  if (/\/whatsapp\/templates/.test(u))   return F.WA_TEMPLATES;
  if (/\/whatsapp\/conversations\/[^/]+\/messages/.test(u)) return STATE === 'empty' ? [] : F.WA_MESSAGES;
  if (/\/whatsapp\/conversations/.test(u)) return STATE === 'empty' ? [] : F.WA_CONVERSATIONS;
  if (/\/whatsapp/.test(u))              return { connected: true, phone_number: '+91 22 0000 0000' };

  /* eSign ───────────────────────────────────────────────────────────────── */
  // The detail answers `{document, signers, audit_trail}` (DetailTab.jsx:48-51).
  if (/\/esign\/documents\/[^/?]+(\?|$)/.test(u)) {
    return { document: F.ESIGN_DOCS[0], signers: F.ESIGN_DOCS[0].signers, audit_trail: F.ESIGN_AUDIT };
  }
  // The list is enveloped: DocumentsTab reads `r.data.data`.
  if (/\/esign\/documents/.test(u))      return { data: STATE === 'empty' ? [] : F.ESIGN_DOCS };

  /* Org / settings ──────────────────────────────────────────────────────── */
  if (/\/org(anization)?s?\/[^/]*\/?members|\/members\b/.test(u)) return STATE === 'empty' ? [] : F.MEMBERS;
  if (/\/modules/.test(u))               return F.MODULES;
  if (/\/subscription|\/billing|\/plan\b/.test(u)) return { plan: 'growth', seats_used: 14, seats_total: 25, status: 'active', renews_at: '2026-09-01T00:00:00Z', invoices: [] };
  if (/\/role_tiers|\/roles\b/.test(u))  return [{ key: 'org_owner', label: 'Owner', tier: 'org' }, { key: 'member', label: 'Member', tier: 'org' }];
  if (/\/invites/.test(u))               return [];
  if (/\/audit/.test(u))                 return [];
  if (/\/org\b|\/organization\b/.test(u)) return F.ORG;

  /* Shell / dashboard / inbox / client ──────────────────────────────────── */
  if (/\/notifications\/unread_count/.test(u)) return { count: 2 };
  if (/\/notifications/.test(u))         return STATE === 'empty' ? [] : F.NOTIFICATIONS;
  if (/\/teams\b/.test(u))               return [{ team_id: 't1', name: 'Statutory audit 2026' }, { team_id: 't2', name: 'Monthly GST compliance' }];
  if (/\/approvals/.test(u))             return STATE === 'empty' ? [] : [];
  if (/\/tasks/.test(u))                 return STATE === 'empty' ? [] : F.TASKS;
  if (/\/client\/projects|\/client\/work/.test(u)) return STATE === 'empty' ? [] : F.CLIENT_PROJECTS;
  if (/\/client\//.test(u))              return STATE === 'empty' ? [] : [];
  if (/\/invoices|\/receivab/.test(u))   return [];

  return [];
}

api.defaults.adapter = (config) => {
  const u = config.url || '';
  // `?state=error` makes every DATA read fail, so the error branch of each page
  // is the one that renders. Photo/signed-URL reads keep succeeding — a broken
  // page and a broken photo are different bugs and must be measurable apart.
  if (STATE === 'error' && !/\/photo|\/url$/.test(u)) {
    const err = new Error('Request failed with status code 500');
    err.response = { status: 500, data: { detail: 'Harness-forced failure' }, config };
    err.config = config;
    return Promise.reject(err);
  }
  // `?state=loading` never settles, so the skeleton is what is on screen.
  if (STATE === 'loading') return new Promise(() => {});
  return Promise.resolve({
    data: mockData(u, config.method), status: 200, statusText: 'OK', headers: {}, config,
  });
};

// currentUser() reads localStorage. A local, invented staff user — no session,
// no cookie, no token.
// `?role=member` drops the org grant so the denied branch can be measured too.
localStorage.setItem('Kartavaya_user', JSON.stringify({
  user_id: 'u3', name: 'Keval Shah', full_name: 'Keval Shah', email: 'keval@example.test',
  role: 'owner', platform_role: 'org_owner', org_id: 'org1',
  // `OrgSettingsPage.jsx:52` gates on `org_roles[].role_code`, not on `role`.
  org_roles: q.get('role') === 'member'
    ? [{ org_id: 'org1', role_code: 'org_member' }]
    : [{ org_id: 'org1', role_code: 'org_owner' }],
  module_grants: ['pahchan', 'sanvaad', 'esign', 'ganit', 'manav', 'vetana'],
}));

if (q.get('theme')) document.documentElement.setAttribute('data-theme', q.get('theme'));

/* ── Error capture ────────────────────────────────────────────────────────── */

const ERRORS = [];
window.addEventListener('error', e => ERRORS.push(String(e.message)));
window.addEventListener('unhandledrejection', e =>
  ERRORS.push('rej: ' + String((e.reason && e.reason.message) || e.reason)));
window.__VERIFY_ERRORS = ERRORS;

class Guard extends React.Component {
  constructor(p) { super(p); this.state = { e: null }; }
  static getDerivedStateFromError(e) { return { e }; }
  componentDidCatch(e, info) {
    ERRORS.push(this.props.name + ': ' + String(e && e.message)
      + ' | comp: ' + String((info && info.componentStack) || '').split('\n').slice(0, 5).join(' >> '));
  }
  render() {
    return this.state.e
      ? <pre className="verify-crash" style={{ color: 'red', padding: 16, whiteSpace: 'pre-wrap' }}>
          CRASH in {this.props.name}: {String(this.state.e.message)}
        </pre>
      : this.props.children;
  }
}

/* ── The pages under verification ─────────────────────────────────────────── */

const lazy = (fn, name) => {
  const C = React.lazy(fn);
  return () => (
    <Guard name={name}>
      <React.Suspense fallback={<div className="verify-suspense">loading module…</div>}>
        <C />
      </React.Suspense>
    </Guard>
  );
};

const PAGES = {
  pahchan:   lazy(() => import('../src/pages/PahchanPage'),          'PahchanPage'),
  sanvaad:   lazy(() => import('../src/pages/SanvaadPage'),          'SanvaadPage'),
  esign:     lazy(() => import('../src/pages/EsignPage'),            'EsignPage'),
  org:       lazy(() => import('../src/pages/OrgSettingsPage'),      'OrgSettingsPage'),
  customize: lazy(() => import('../src/pages/CustomizeSettingsPage'), 'CustomizeSettingsPage'),
  today:     lazy(() => import('../src/pages/DashboardPage'),        'DashboardPage'),
  inbox:     lazy(() => import('../src/pages/InboxPage'),            'InboxPage'),
  // The portal is deliberately NOT inside AppShell — it has its own chrome
  // (ClientShell.jsx). Mount it with ?shell=0.
  client:    lazy(() => import('../src/pages/ClientPages').then(m => ({ default: m.ClientProjectsPage })), 'ClientProjectsPage'),
  clientboard: lazy(() => import('../src/pages/ClientPages').then(m => ({ default: m.ClientProjectBoardPage })), 'ClientProjectBoardPage'),
};

const Page = PAGES[PAGE] || PAGES.pahchan;

// The client portal brings its own shell; everything else lives inside AppShell.
const withShell = q.get('shell') !== '0' && !PAGE.startsWith('client');
const entry = q.get('path') || (PAGE.startsWith('client') ? '/client' : `/${PAGE}`);

const tree = withShell
  ? (
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/*" element={<Page />} />
        </Route>
      </Routes>
    </MemoryRouter>
  )
  : (
    <MemoryRouter initialEntries={[entry]}>
      <Routes><Route path="/*" element={<Page />} /></Routes>
    </MemoryRouter>
  );

ReactDOM.createRoot(document.getElementById('root')).render(
  <CustomizeProvider><ToastProvider>{tree}</ToastProvider></CustomizeProvider>,
);

/* ── Measurement helpers, called from the browser tool ────────────────────── */

const num = v => (v == null ? null : v);
window.__probe = (sel, props) => {
  const el = document.querySelector(sel);
  if (!el) return { sel, found: false };
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const out = { sel, found: true, w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
  (props || []).forEach(p => { out[p] = num(cs.getPropertyValue(p)); });
  return out;
};
window.__scroll = (sel) => {
  const el = document.querySelector(sel);
  if (!el) return { sel, found: false };
  const cs = getComputedStyle(el);
  return {
    sel, found: true,
    clientH: el.clientHeight, scrollH: el.scrollHeight,
    scrollable: el.scrollHeight > el.clientHeight + 1,
    overflowY: cs.overflowY, minHeight: cs.minHeight,
  };
};
window.__text = (sel) => [...document.querySelectorAll(sel)].map(e => e.textContent.trim());
window.__tokens = (names) => {
  const cs = getComputedStyle(document.documentElement);
  const o = {};
  names.forEach(n => { o[n] = cs.getPropertyValue(n).trim() || 'UNRESOLVED'; });
  return o;
};
window.__overflowX = () => ({
  docScrollW: document.documentElement.scrollWidth,
  docClientW: document.documentElement.clientWidth,
  bodyScrollW: document.body.scrollWidth,
  overflows: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  widest: [...document.querySelectorAll('body *')]
    .filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
    .slice(0, 8)
    .map(e => ({ cls: String(e.className).slice(0, 60), right: +e.getBoundingClientRect().right.toFixed(0) })),
});
window.__ready = () => ({ errors: ERRORS, page: PAGE, state: STATE, href: location.href });
