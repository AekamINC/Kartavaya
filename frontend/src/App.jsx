/**
 * App.js — Kartavaya route tree.
 *
 * Rules for this file:
 *   - Route declarations only. No business logic.
 *   - Every page is lazy — auth pages included.
 *   - All CSS imports come from one barrel: styles/index.css
 *   - Outlet context wrappers use the shared `withContext` helper below.
 *     Add a new one by adding a line to CONTEXT_ROUTES, not a new function.
 *
 * To add a new page:
 *   1. const MyPage = lazy(() => import('./pages/MyPage'))
 *   2. Add a <Route> in the correct position below
 *   3. If the page needs teamId/teams from context, add it to CONTEXT_ROUTES
 */
import React, { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useOutletContext } from 'react-router-dom';
import './App.css';
import './styles/index.css';
import './styles/kartavaya-design.css';
import './styles/editorial.css';
// Global, not imported from CustomizeSettingsPage: it carries the
// [data-sidebar-bg] and [data-toast-pos] rules, which apply app-wide. Behind
// the lazy-loaded page they would not exist until you first opened Customize,
// so a saved sidebar preference would silently not apply on boot.
import './styles/settings.css';

import { ToastProvider }               from './components/ui/toast';
import AppShell, { Protected }         from './components/layout/AppShell';
import AdminShell                      from './components/admin/AdminShell';
import { currentUser }                 from './lib/auth';
import { navContext }                  from './components/layout/navConfig';
import PageLoader                      from './components/layout/PageLoader';
import { CustomizeProvider } from './components/CustomizePanel';
import ErrorBoundary from './components/ErrorBoundary';
import { isInstalledApp } from './lib/platform';

// ── Auth pages (lazy — no reason to block the bundle for these) ────────────────
const LoginPage           = lazy(() => import('./pages/LoginPage').then(m => ({ default: m.LoginPage })));
const AcceptInvitePage    = lazy(() => import('./pages/LoginPage').then(m => ({ default: m.AcceptInvitePage })));
const ForgotPasswordPage  = lazy(() => import('./pages/LoginPage').then(m => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage   = lazy(() => import('./pages/LoginPage').then(m => ({ default: m.ResetPasswordPage })));
const ApprovePage         = lazy(() => import('./pages/ApprovePage'));

// ── App pages ─────────────────────────────────────────────────────────────────
const DashboardPage         = lazy(() => import('./pages/DashboardPage'));
const ProjectsPage          = lazy(() => import('./pages/ProjectsPage'));
const BoardsPage            = lazy(() => import('./pages/BoardsPage'));
const ProjectBoardPage      = lazy(() => import('./pages/ProjectBoardPage'));
const TasksListPage         = lazy(() => import('./pages/TasksListPage'));
const TeamsPage             = lazy(() => import('./pages/TeamsPage'));
const ActivityFeedPage      = lazy(() => import('./pages/ActivityFeedPage'));
const AutomationsPage       = lazy(() => import('./pages/AutomationsPage'));
const TimeReportPage        = lazy(() => import('./pages/TimeReportPage'));
const ReportsPage           = lazy(() => import('./pages/ReportsPage'));
const ApprovalsPage         = lazy(() => import('./pages/ApprovalsPage'));
const TemplatesPage         = lazy(() => import('./pages/TemplatesPage'));
const CategoriesPage        = lazy(() => import('./pages/CategoriesPage'));
const AdminPage             = lazy(() => import('./pages/AdminPage'));
const ClientProjectsPage    = lazy(() => import('./pages/ClientProjectsPage'));
const ClientBoardPage       = lazy(() => import('./pages/ClientBoardPage'));
const InboxPage             = lazy(() => import('./pages/InboxPage'));
// BillingPage is no longer routed. `10-org-settings.md` folded it into
// `pages/org/TabBilling.jsx`; `/billing` redirects to that tab below so
// bookmarks and emailed links still land somewhere real.
const OnboardingPage        = lazy(() => import('./pages/onboarding/OnboardingPage'));
const AdminBillingPage      = lazy(() => import('./pages/AdminBillingPage'));
const AdminOrgsPage         = lazy(() => import('./pages/AdminOrgsPage'));
const AdminCostDashboardPage = lazy(() => import('./pages/AdminCostDashboardPage'));
const OrgSettingsPage       = lazy(() => import('./pages/OrgSettingsPage'));
const RolesAccessPage       = lazy(() => import('./pages/RolesAccessPage'));
const HubDashboardPage      = lazy(() => import('./pages/HubDashboardPage'));
const HubClientsPage        = lazy(() => import('./pages/HubClientsPage'));
const HubClientDetailPage   = lazy(() => import('./pages/HubClientDetailPage'));
const HubSkillsPage         = lazy(() => import('./pages/HubSkillsPage'));
const OrgSrijanPage         = lazy(() => import('./pages/OrgSrijanPage'));

const GrahaPage             = lazy(() => import('./pages/GrahaPage'));
const GanitPage             = lazy(() => import('./pages/GanitPage'));
const ManavPage             = lazy(() => import('./pages/ManavPage'));
const VikrayPage            = lazy(() => import('./pages/VikrayPage'));
const PahchanPage           = lazy(() => import('./pages/PahchanPage'));
const VetanaPage            = lazy(() => import('./pages/VetanaPage'));
const DristiPage            = lazy(() => import('./pages/DristiPage'));
const PracharPage           = lazy(() => import('./pages/PracharPage'));
const EsignPage             = lazy(() => import('./pages/EsignPage'));
const SanvaadPage           = lazy(() => import('./pages/SanvaadPage'));
const SigningPage           = lazy(() => import('./pages/SigningPage'));
const CustomizeSettingsPage = lazy(() => import('./pages/CustomizeSettingsPage'));
const LandingPage           = lazy(() => import('./pages/marketing/LandingPage'));

// ── Outlet context wrappers ────────────────────────────────────────────────────
// Pages that need teamId or teams from AppShell's outlet context.
// Pattern: withContext(Page, contextKey) — avoids a boilerplate function per page.
function withContext(Page, pick) {
  return function ContextWrapper() {
    const ctx = useOutletContext();
    const props = typeof pick === 'function' ? pick(ctx) : { [pick]: ctx[pick] };
    return <Page {...props} />;
  };
}

const DashboardWithContext    = withContext(DashboardPage,    ctx => ({ teams: ctx.teams }));
const ActivityWithContext     = withContext(ActivityFeedPage, 'teamId');
const AutomationsWithContext  = withContext(AutomationsPage,  'teamId');
const TimeWithContext         = withContext(TimeReportPage,   'teamId');
const ReportsWithContext      = withContext(ReportsPage,      ctx => ({ teams: ctx.teams }));

/**
 * `/` serves two audiences. An anonymous visitor gets the public landing page;
 * someone already signed in gets their dashboard, because a logged-in user
 * landing on marketing copy has to click again to reach the product they were
 * going to.
 *
 * This sits OUTSIDE <Protected> deliberately — inside it, an anonymous visitor
 * would be bounced to /login and never see the page at all, which is the whole
 * problem the landing page exists to solve.
 */
function RootGate() {
  const user = currentUser();
  // The INSTALLED app never shows marketing. Someone who downloaded an APK was
  // given an account by their firm's admin before they were given the app —
  // there is no public sign-up — so the landing page's whole job, explaining
  // the product to a stranger, is already done. It opens on the sign-in form,
  // which is the only thing they came here to use.
  if (!user) return isInstalledApp() ? <Navigate to="/login" replace /> : <LandingPage />;
  // A client's product is the portal. Sending them to /dashboard first only for
  // `Protected` to bounce them back costs a render of a shell they may not see.
  return <Navigate to={navContext(user).isClient ? '/client' : '/dashboard'} replace />;
}

// ── Route tree ─────────────────────────────────────────────────────────────────
function AppRouter() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Public */}
        <Route path="/login"            element={<LoginPage />} />
        <Route path="/accept-invite"    element={<AcceptInvitePage />} />
        <Route path="/forgot-password"  element={<ForgotPasswordPage />} />
        <Route path="/reset-password"   element={<ResetPasswordPage />} />
        <Route path="/approve"          element={<ApprovePage />} />
        <Route path="/sign/:token"      element={<SigningPage />} />

        {/* Public landing at `/` — see RootGate. Declared before the protected
            shell so the exact-match wins for an anonymous visitor. */}
        <Route path="/" element={<RootGate />} />

        {/* Onboarding — authenticated, and deliberately OUTSIDE AppShell.
            12-auth-onboarding.md §5 asks for this route and for a redirect into
            it when `org.onboarding_complete` is false; the redirect lives in
            `Protected` beside the other role gates.

            No sidebar and no topbar: the wizard's own step rail is the
            navigation, and a user who has not finished setting up their
            organisation has nothing to reach through a module rail. It was
            fully built at `pages/onboarding/` — six steps, resume state, real
            POSTs for invites and the first project — and had no route at all,
            so none of it could be opened. */}
        <Route path="/onboarding" element={<Protected><OnboardingPage /></Protected>} />

        {/* ── Client portal ────────────────────────────────────────────────
            Its OWN routes, outside AppShell. `19-client-portal.md` · Shell:
            "No sidebar. The firm's brand, not ours." Every one of these pages
            renders `pages/client/ClientShell.jsx`, which draws the firm's logo
            and a three-item horizontal nav.

            While these sat inside AppShell, the portal was painted inside the
            staff chrome: the module sidebar — first entry on 19's never-see
            list, since a client has no modules and every link on it leads
            somewhere they cannot go — plus the staff topbar, the notification
            bell and the "New task" button, all wrapped around a surface whose
            entire design brief is that it belongs to the accountant's brand
            rather than ours. */}
        <Route path="/client"                    element={<Protected><ClientProjectsPage /></Protected>} />
        <Route path="/client/projects"           element={<Protected><ClientProjectsPage /></Protected>} />
        <Route path="/client/project/:projectId" element={<Protected><ClientBoardPage /></Protected>} />

        {/* 19 · Shell names these two as routes, and they are routes now.

            They were `<Navigate>` redirects to `/client?view=…` on the theory
            that making them real "needs a `view` prop on
            `ClientProjectsPage`". It does not: `viewFromLocation`
            (`ClientPages.jsx:64`) already resolves the view from the PATHNAME
            first and falls back to `?view=` only when the path carries none —
            it was built for exactly this. `client/__tests__/smoke.test.jsx:122`
            already mounts all three paths on the same element and asserts each
            renders its own view.

            The redirect also cost the thing 19 cares about: the canonical URL.
            A client who bookmarked `/client/approvals` — the link in their
            email — landed on `/client?view=approvals`, so the address bar no
            longer matched what they saved, and the nav's `aria-current` had to
            be derived from a query string. Both spellings still work; the path
            form is now the one that survives. */}
        <Route path="/client/approvals" element={<Protected><ClientProjectsPage /></Protected>} />
        <Route path="/client/files"     element={<Protected><ClientProjectsPage /></Protected>} />

        {/* Protected shell — all child routes inherit auth + layout */}
        <Route path="/" element={<Protected><AppShell /></Protected>}>

          {/* Core */}
          <Route path="dashboard"              element={<DashboardWithContext />} />
          <Route path="boards"                 element={<BoardsPage />} />
          <Route path="projects"               element={<ProjectsPage />} />
          <Route path="projects/:projectId"    element={<ProjectBoardPage />} />
          <Route path="tasks"                  element={<TasksListPage />} />
          <Route path="teams"                  element={<TeamsPage />} />
          <Route path="inbox"                  element={<InboxPage />} />
          <Route path="approvals"              element={<ApprovalsPage />} />
          <Route path="templates"              element={<TemplatesPage />} />

          {/* Context-dependent */}
          <Route path="activity"               element={<ActivityWithContext />} />
          <Route path="automations"            element={<AutomationsWithContext />} />
          <Route path="time"                   element={<TimeWithContext />} />
          <Route path="reports"               element={<ReportsWithContext />} />

          {/* Settings */}
          <Route path="settings/categories"    element={<CategoriesPage />} />
          {/* Notification settings folded into the customize hub — they are
              preferences, and having them on their own route meant "where do I
              turn that off" had two answers. Redirect, so existing links and
              bookmarks land on the right tab instead of 404ing. */}
          <Route path="settings/notifications" element={<Navigate to="/settings/customize?tab=notifications" replace />} />
          <Route path="settings/customize"     element={<CustomizeSettingsPage />} />
          <Route path="settings/organisation" element={<OrgSettingsPage />} />
          {/* `Roles & access` · अधिकार — a Settings destination in the design
              (`Chrome.jsx:36`) that the build only had as a tab of the row next
              to it. Same wired component behind both, opened on its grid half. */}
          <Route path="settings/roles"        element={<RolesAccessPage />} />

          {/* Billing lives in Organisation settings now — `10-org-settings.md`
              folded `BillingPage.jsx` into `org/TabBilling.jsx`. The route
              survives as a redirect: invoices and renewal emails carry
              /billing links that would otherwise land on the fallback. */}
          <Route path="billing"                element={<Navigate to="/settings/organisation?tab=billing" replace />} />

          {/* Srijan */}
          <Route path="hub"                    element={<HubDashboardPage />} />
          <Route path="hub/clients"            element={<HubClientsPage />} />
          <Route path="hub/clients/:clientId"  element={<HubClientDetailPage />} />
          <Route path="hub/clients/:clientId/skills" element={<HubSkillsPage />} />
          <Route path="hub/org"                 element={<OrgSrijanPage />} />


          {/* Add-on modules */}
          <Route path="graha"                  element={<GrahaPage />} />
          <Route path="ganit"                  element={<GanitPage />} />
          <Route path="manav"                  element={<ManavPage />} />
          <Route path="vikray"                 element={<VikrayPage />} />
          <Route path="pahchan"                element={<PahchanPage />} />
          <Route path="vetana"                 element={<VetanaPage />} />
          <Route path="dristi"                 element={<DristiPage />} />
          <Route path="prachar"                element={<PracharPage />} />
          <Route path="esign"                  element={<EsignPage />} />
          <Route path="sanvaad"                element={<SanvaadPage />} />

          {/* /client/* is NOT here any more — see the standalone ClientShell
              routes above. A client must never be handed the staff sidebar. */}
        </Route>

        {/* Aekam platform console — its OWN shell, not a page inside the app
            one. 01-navigation.md §1: admin replaces the sidebar and owns the
            window. While these four rendered inside AppShell, an operator kept
            their own tenant chrome — their accent, their org's breadcrumb —
            while looking at another company's data. AdminShell also refuses to
            render for a user with no platform role. */}
        <Route path="/admin" element={<Protected><AdminShell /></Protected>}>
          <Route index                element={<AdminPage />} />
          <Route path="billing"       element={<AdminBillingPage />} />
          <Route path="orgs"          element={<AdminOrgsPage />} />
          <Route path="costs"         element={<AdminCostDashboardPage />} />
        </Route>

        {/* Legacy client portal (direct access, own Protected wrapper) */}
        {/* /client/legacy retired. It rendered a dark portal from an earlier
            design era — hardcoded K.dark surfaces and #8aa5be copy, a fourth
            token vocabulary alongside the k-* CSS, Tailwind and the drawer's
            --ink set — so a client landing there saw a different product from
            the one their accountant was describing on the phone. Redirected
            rather than removed, so an emailed link still arrives somewhere. */}
        <Route path="/client/legacy" element={<Navigate to="/client" replace />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}

function StagingBanner() {
  const on = import.meta.env.VITE_ENVIRONMENT === 'staging';
  /*
   * The banner is `position: fixed`, so it reserves NO space — it sits on top
   * of whatever is beneath it. On the web and on a tablet there was enough
   * slack that nobody noticed. On a 427dp phone it clipped the top off the क
   * in the sign-in crown, caught on a booted Pixel.
   *
   * Rather than padding the crown by a magic number, the banner declares its
   * own height on the root and any layout that needs to clear it reads
   * `--staging-h`. A fixed element that overlays content should be the thing
   * that says how much room it takes.
   */
  useEffect(() => {
    if (!on) return undefined;
    document.documentElement.classList.add('kv-staging');
    return () => document.documentElement.classList.remove('kv-staging');
  }, [on]);
  if (!on) return null;
  // Was `#f59e0b` on `#000` at `zIndex: 9999`. Both colours are now the warning
  // pair, so it follows the theme, and 620 is the top rung of 26 §4's ladder —
  // an environment warning a mobile sheet can cover is not doing its job.
  return <div className="kv__staging">STAGING ENVIRONMENT</div>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <CustomizeProvider>
        <ToastProvider>
          <BrowserRouter>
            <StagingBanner />
            <AppRouter />
          </BrowserRouter>
        </ToastProvider>
      </CustomizeProvider>
    </ErrorBoundary>
  );
}
