/**
 * commands.js — the ONE command registry. `20-search-palette.md` §5,
 * `02-common-components.md` §4.
 *
 * There were three lists. `components/CommandPalette.jsx` held 30 entries;
 * `ui/CommandPalette.jsx` held 15 in a different shape; `layout/Topbar.jsx`
 * held four in a fifth shape with a `shortcut` field the others did not have.
 * The first two were both mounted and both bound Cmd/Ctrl+K, so the shortcut
 * opened two stacked palettes — fixed in 9f43c4a, which deleted the duplicate
 * component and Topbar's list. This file is where the survivor lives, so the
 * next surface that needs a command list imports it rather than starting a
 * fourth.
 *
 * `02` §5 asks for this at `ui/commands.js`. It is here instead: `ui/` is the
 * barrel of presentational primitives and this is data with no JSX in it.
 * Import from `lib/commands`.
 *
 * ── Shape ────────────────────────────────────────────────────────────────
 *   id        stable, used as the React key, the ARIA option id and the
 *             recents key. Never reuse one for a different destination.
 *   label     English. What the user reads and what ranking matches first.
 *   hi        Devanagari apposition. Matched too — people type both scripts.
 *   section   'Actions' | 'Navigate'. Renders as the group header.
 *   route     react-router path. Mutually exclusive with `action`.
 *   action    a name the host component handles. Only 'newTask' today.
 *   keywords  space-separated alternates. Ranked BELOW any label hit, so
 *             stuffing them is cheap and cannot drown out a real match.
 */

/**
 * Actions perform something. `20` §4: three of the four "Actions" were
 * navigations — New Invoice dropped you on the invoice list to hunt for the
 * create button, under a header that said Actions. A section that promises a
 * verb and delivers a page move is a small lie the user notices the first time.
 *
 * Two of them are gone rather than relabelled. `/ganit` and `/graha` already
 * have Navigate entries, so a second row pointing at the same page was
 * duplication as well as a lie; their discovery keywords ("new invoice",
 * "new contact") moved onto those entries, so typing the intent still finds the
 * module — it just no longer claims to create anything.
 *
 * `new-project` survives because `ProjectsPage` genuinely accepts `?new=1` and
 * opens the create prompt. Restore New Invoice and New Contact here the day
 * `GanitPage` and `GrahaPage` accept the same parameter.
 */
export const ACTION_ITEMS = [
  { id: 'new-task', label: 'New Task', hi: 'नया कार्य', section: 'Actions', action: 'newTask', keywords: 'create new task add' },
  { id: 'new-project', label: 'New Project', hi: 'नई योजना', section: 'Actions', route: '/projects?new=1', keywords: 'create new project' },
];

export const NAV_ITEMS = [
  { id: 'dashboard', label: 'Today', hi: 'आज', section: 'Navigate', route: '/dashboard', keywords: 'dashboard home today' },
  { id: 'tasks', label: 'Tasks', hi: 'कर्तव्य', section: 'Navigate', route: '/tasks', keywords: 'tasks todo' },
  { id: 'boards', label: 'Boards', hi: 'फ़लक', section: 'Navigate', route: '/boards', keywords: 'boards kanban' },
  { id: 'projects', label: 'Projects', hi: 'योजना', section: 'Navigate', route: '/projects', keywords: 'projects' },
  { id: 'approvals', label: 'Approvals', hi: 'सम्मति', section: 'Navigate', route: '/approvals', keywords: 'approvals pending' },
  { id: 'activity', label: 'Activity', hi: 'क्रिया', section: 'Navigate', route: '/activity', keywords: 'activity feed log' },
  { id: 'time', label: 'Time Report', hi: 'काल', section: 'Navigate', route: '/time', keywords: 'time tracking report hours' },
  { id: 'reports', label: 'Reports', hi: 'प्रतिवेदन', section: 'Navigate', route: '/reports', keywords: 'reports analytics' },
  { id: 'templates', label: 'Templates', hi: 'साँचा', section: 'Navigate', route: '/templates', keywords: 'templates' },
  { id: 'teams', label: 'Team', hi: 'सहयोगी', section: 'Navigate', route: '/teams', keywords: 'team members people' },
  { id: 'inbox', label: 'Inbox', hi: 'सन्देश', section: 'Navigate', route: '/inbox', keywords: 'inbox messages chat' },
  { id: 'sanvaad', label: 'Sanvaad', hi: 'संवाद', section: 'Navigate', route: '/sanvaad', keywords: 'sanvaad chat channels messages varta' },
  // Labels match the sidebar (navConfig.js) — a command palette that calls the
  // module something the nav does not is a second name for one thing. The old
  // labels stay in `keywords` so anyone who learned "invoicing" still finds it.
  { id: 'graha', label: 'CRM', hi: 'ग्रह', section: 'Navigate', route: '/graha', keywords: 'crm contacts leads graha customers grahak new contact create client' },
  { id: 'ganit', label: 'Finance', hi: 'गणित', section: 'Navigate', route: '/ganit', keywords: 'finance invoicing billing gst ganit invoices expenses payables bank new invoice create bill' },
  { id: 'manav', label: 'HRMS', hi: 'मानव', section: 'Navigate', route: '/manav', keywords: 'hrms hr employees manav' },
  { id: 'vikray', label: 'Sales', hi: 'विक्रय', section: 'Navigate', route: '/vikray', keywords: 'sales pipeline vikray deals orders' },
  { id: 'vetana', label: 'Payroll', hi: 'वेतन', section: 'Navigate', route: '/vetana', keywords: 'payroll salary vetana' },
  { id: 'pahchan', label: 'Attendance', hi: 'पहचान', section: 'Navigate', route: '/pahchan', keywords: 'attendance punch pahchan shift' },
  { id: 'dristi', label: 'Analytics', hi: 'दृष्टि', section: 'Navigate', route: '/dristi', keywords: 'analytics dashboard dristi charts' },
  { id: 'prachar', label: 'Marketing', hi: 'प्रचार', section: 'Navigate', route: '/prachar', keywords: 'marketing campaigns prachar' },
  { id: 'esign', label: 'E-Sign', hi: 'प्रमाण', section: 'Navigate', route: '/esign', keywords: 'esign documents signatures' },
  { id: 'sahayak', label: 'Sahayak', hi: 'सहायक', section: 'Navigate', route: '/hub/org', keywords: 'sahayak sahayak content ai generate assistant' },
  // Was also '/hub/org', identical to Sahayak above — picking "Data Tools" and
  // landing on Sahayak is the kind of thing that stops a user trusting the
  // palette. Data Tools live as tabs inside Sahayak, so it deep-links there.
  { id: 'scrapers', label: 'Data Tools', hi: 'डेटा टूल्स', section: 'Navigate', route: '/hub/org?tab=scrapers', keywords: 'scrapers data tools leads' },
  { id: 'categories', label: 'Categories', hi: 'वर्ग', section: 'Navigate', route: '/settings/categories', keywords: 'settings categories tags' },
  { id: 'notifications', label: 'Notifications', hi: 'सूचना', section: 'Navigate', route: '/settings/customize?tab=notifications', keywords: 'settings notifications' },
  { id: 'customize', label: 'Customize', hi: 'सजावट', section: 'Navigate', route: '/settings/customize', keywords: 'settings customize theme' },
  { id: 'organisation', label: 'Organisation', hi: 'संस्था', section: 'Navigate', route: '/settings/organisation', keywords: 'settings organisation org profile members' },
  { id: 'billing', label: 'Billing', hi: 'बिलिंग', section: 'Navigate', route: '/billing', keywords: 'billing subscription plan' },
];

export const COMMANDS = [...ACTION_ITEMS, ...NAV_ITEMS];

/**
 * Scope chips. `id` is sent to the endpoint as `scope`; for everything except
 * `all` it is also the key the results arrive under, which is why the two are
 * one field rather than two that can drift.
 */
export const SCOPES = [
  { id: 'all', label: 'All', hi: 'सब' },
  { id: 'tasks', label: 'Tasks', hi: 'कर्तव्य' },
  { id: 'clients', label: 'Clients', hi: 'ग्राहक' },
  { id: 'invoices', label: 'Invoices', hi: 'चालान' },
  { id: 'messages', label: 'Messages', hi: 'सन्देश' },
  { id: 'files', label: 'Files', hi: 'संचिका' },
];

/**
 * How each entity group renders, and where a hit goes when the server does not
 * hand back a `route`.
 *
 * The fallback is a MODULE page, not a fabricated deep link. There is no
 * `/tasks?task=<id>` route in `App.jsx` — inventing one would navigate to the
 * catch-all and redirect to the dashboard, which is worse than landing on the
 * right list. The endpoint should return `route` per hit; until it does, the
 * row's meta names the module so the destination is not a surprise.
 */
export const ENTITIES = [
  { key: 'tasks', label: 'Tasks', route: '/tasks', title: (r) => r.title, meta: (r) => [r.project, r.status].filter(Boolean).join(' · ') },
  { key: 'clients', label: 'Clients', route: '/graha', title: (r) => r.name, meta: (r) => r.gstin || '' },
  { key: 'invoices', label: 'Invoices', route: '/ganit', title: (r) => [r.number, r.client].filter(Boolean).join(' · '), meta: (r) => r.status || '' },
  { key: 'messages', label: 'Messages', route: '/sanvaad', title: (r) => r.snippet, meta: (r) => [r.author, r.channel].filter(Boolean).join(' · ') },
  { key: 'files', label: 'Files', route: '/tasks', title: (r) => r.name, meta: (r) => r.task || '' },
];

/**
 * Rank the static commands. Instant and local — `20` §Structure: never make the
 * command list wait on the network, because `⌘K → "new task" → Enter` is a
 * muscle-memory path.
 *
 * `fuzzyMatch` is imported by the caller rather than here so this module stays
 * data-only and testable without pulling the scorer in.
 */
export function rankCommands(query, score) {
  if (!query.trim()) return COMMANDS;
  return COMMANDS
    .map((item) => ({ item, s: score(query, item) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((r) => r.item);
}

/* ── Recents ──────────────────────────────────────────────────────────────
 *
 * COMMAND IDS ONLY, never record hits. A command id is a static string from
 * this file; a record hit carries a client's name or a message snippet, and
 * writing org data into localStorage puts it on a shared machine where the
 * next person to sign in can read it. The labels below are resolved from the
 * registry at render, so nothing tenant-scoped is ever persisted.
 */
const RECENT_KEY = 'kartavaya.cmdk.recent';
const RECENT_MAX = 5;

export function loadRecent() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    // Resolve through the registry, which also drops ids that no longer exist.
    return raw.map((id) => COMMANDS.find((c) => c.id === id)).filter(Boolean).slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

export function pushRecent(id) {
  if (!COMMANDS.some((c) => c.id === id)) return;
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    const next = [id, ...(Array.isArray(raw) ? raw : []).filter((x) => x !== id)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* Private mode, quota, or a disabled store. Recents are a convenience —
       never let them take the palette down with them. */
  }
}
