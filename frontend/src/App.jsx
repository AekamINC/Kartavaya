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
import React, { Suspense, lazy } from 'react';
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
import PageLoader                      from './components/layout/PageLoader';
import { CustomizeProvider } from './components/CustomizePanel';
import ErrorBoundary from './components/ErrorBoundary';

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
const BillingPage           = lazy(() => import('./pages/BillingPage'));
const AdminBillingPage      = lazy(() => import('./pages/AdminBillingPage'));
const AdminOrgsPage         = lazy(() => import('./pages/AdminOrgsPage'));
const AdminCostDashboardPage = lazy(() => import('./pages/AdminCostDashboardPage'));
const OrgSettingsPage       = lazy(() => import('./pages/OrgSettingsPage'));
const HubDashboardPage      = lazy(() => import('./pages/HubDashboardPage'));
const HubClientsPage        = lazy(() => import('./pages/HubClientsPage'));
const HubClientDetailPage   = lazy(() => import('./pages/HubClientDetailPage'));
const HubSkillsPage         = lazy(() => import('./pages/HubSkillsPage'));
const OrgSrijanPage         = lazy(() => import('./pages/OrgSrijanPage'));

const GrahaPage             = lazy(() => import('./pages/GrahaPage'));
const GanitPage             = lazy(() => import('./pages/GanitPage'));
const ManavPage             = lazy(() => import('./pages/ManavPage'));
const VikrayPage            = lazy(() => import('./pages/VikrayPage'));
const VetanaPage            = lazy(() => import('./pages/VetanaPage'));
const DristiPage            = lazy(() => import('./pages/DristiPage'));
const PracharPage           = lazy(() => import('./pages/PracharPage'));
const EsignPage             = lazy(() => import('./pages/EsignPage'));
const SanvaadPage           = lazy(() => import('./pages/SanvaadPage'));
const SigningPage           = lazy(() => import('./pages/SigningPage'));
const CustomizeSettingsPage = lazy(() => import('./pages/CustomizeSettingsPage'));

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

        {/* Protected shell — all child routes inherit auth + layout */}
        <Route path="/" element={<Protected><AppShell /></Protected>}>
          <Route index element={<Navigate to="/dashboard" replace />} />

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

          {/* Admin */}
          <Route path="admin"                  element={<AdminPage />} />
          <Route path="admin/billing"          element={<AdminBillingPage />} />
          <Route path="admin/orgs"             element={<AdminOrgsPage />} />
          <Route path="admin/costs"            element={<AdminCostDashboardPage />} />

          {/* Billing */}
          <Route path="billing"                element={<BillingPage />} />

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
          <Route path="vetana"                 element={<VetanaPage />} />
          <Route path="dristi"                 element={<DristiPage />} />
          <Route path="prachar"                element={<PracharPage />} />
          <Route path="esign"                  element={<EsignPage />} />
          <Route path="sanvaad"                element={<SanvaadPage />} />

          {/* Client portal */}
          <Route path="client"                          element={<ClientProjectsPage />} />
          <Route path="client/projects"                 element={<ClientProjectsPage />} />
          <Route path="client/project/:projectId"       element={<ClientBoardPage />} />
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
  if (import.meta.env.VITE_ENVIRONMENT !== 'staging') return null;
  return (
    <div style={{
      background: '#f59e0b', color: '#000', textAlign: 'center',
      padding: '4px 0', fontSize: '12px', fontWeight: 600,
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
    }}>
      STAGING ENVIRONMENT
    </div>
  );
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
