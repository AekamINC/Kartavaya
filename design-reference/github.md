repo: kevalvshah/Kartavya
branch: staging

## Last sync
date: 2026-07-26T12:18:11Z

### Updated in this project
- Read the real component library before writing the Pahchan reuse map. Two plausible paths do not exist — there is no components/navigation/ and no components/data-display/. Seg lives in components/customize/, StatusChip in components/editorial/.
- Found a live shipped defect: ModuleUI.Badge does background: `${c}18`, and statusColors.js now returns var(--st-done), so it evaluates to "var(--st-done)18" and is dropped. Every status badge renders with no background, including all six order states in VikrayPage. mixAlpha already exists for exactly this. Logged in 02 and the README ledger.
- Seg takes {value,label} with no count prop, so the register's "All 12 / Needs a look 6" needs one added rather than assumed.
- No attendance states in statusColors.js — specified PUNCH_COLORS as a sixth shared map rather than a tenth private one.
- Two empty-state components exist: ModuleUI.Empty (emoji default) and ui/EmptyState.jsx (real SVGs, bilingual, but still on Tailwind classes).
- Added loading / empty / finished / error to the Pahchan register, with the filtered-empty designed as a finished queue rather than an absence.

## Screen map

| Prototype file | Built from (staging) |
|---|---|
| `tokens.css` | `styles/kartavaya-design.css`, `styles/dark-theme.css` |
| `app.css` | `styles/editorial.css` |
| `Chrome.jsx` | `layout/AppShell.jsx`, `Sidebar.jsx`, `Topbar.jsx`, `CustomizePanel.jsx` |
| `ScreensCore.jsx` | `pages/DashboardPage.jsx`, `GrahaPage.jsx` |
| `ScreensBiz.jsx` | `pages/GanitPage.jsx`, `VikrayPage.jsx` |
| `ScreensMore.jsx` | `SanvaadPage.jsx`, `DristiPage.jsx`, `ManavPage.jsx`, `VetanaPage.jsx`, `PracharPage.jsx`, `OrgSrijanPage.jsx`, `HubDashboardPage.jsx`, `EsignPage.jsx` |
| `ScreensThin.jsx` | second screens for the 7 thin modules |
| `ScreensWork.jsx` | `BoardsPage.jsx`, `TasksListPage.jsx`, `ApprovalsPage.jsx`, `TaskDrawer.jsx`, `NewTaskModal.jsx` |
| `ScreensSanvaad.jsx`, `ScreensVarta.jsx` | `pages/SanvaadPage.jsx` |
| `ScreensRBAC.jsx`, `ScreensRBAC2.jsx` | `PLAN_RBAC.md`, `PLAN_ROLES.md`, `middleware/roles.py`, `OrgSettingsPage.jsx`, `migrations/016_*.sql` |
| `ScreensPlatform.jsx`, `SetAdmin.jsx` | `AdminPage.jsx`, `AdminOrgsPage.jsx`, `AdminBillingPage.jsx`, `AdminCostDashboardPage.jsx` |
| `SetCustomize.jsx`, `SetOrg.jsx` | `CustomizeSettingsPage.jsx`, `NotificationsSettingsPage.jsx`, `CustomizePanel.jsx`, `OrgSettingsPage.jsx`, `BillingPage.jsx` |
| `Interaction Catalogue.html` + `Ix*.jsx`, `motion.css` | `components/ui/*`, `components/drawer/*`, `TaskDrawer.jsx`, `MentionTextarea.jsx`, `ReminderPicker.jsx` |
| `Auth Screens.html`, `Auth.jsx`, `AuthForms.jsx` | `layout/AuthShell.jsx`, `pages/LoginPage.jsx` |
| `Onboarding.html`, `Auth Emails.html` | new — no onboarding or email templates on staging |
| `Landing Page.html` | new — no public marketing page on staging |
| `Mobile App.html` + `Mobile*.jsx`, `mobile.css` | `mobile/src/screens/*`, `screens/taskdetail/*`, `BoardScreen.tsx`, `InboxScreen.tsx`, `SettingsScreen.tsx`, `MeScreen.tsx`, `nav/RootStack.tsx`, `theme/tokens.ts`, `components/{TaskCard,NewTaskSheet}.tsx` |
| `docs/*` (8 documents) | `pages/OrgSettingsPage.jsx` (`/v1/org/profile` shape), `public/favicon.png` |
| `design-handover/*` (19 files) | whole-repo synthesis; per-file sources listed in each |
| `Start Here.html` | project index — no staging counterpart |

## Sync history

### 2026-07-25T15:22Z — mobile app
Completed 19 mobile screens. Task detail grounded in `screens/taskdetail/` (11 components + `styles.ts`); board detail in `BoardScreen.tsx`. Found `mobile/src/theme/tokens.ts` on a different palette from the web, and that `--info` is not a token (any `color-mix()` referencing it voids the declaration silently).

### 2026-07-25T14:48Z — mobile prototype, documents, catalogue
Read `mobile/src/` (Expo 51 + TypeScript) and built the mobile prototype. Built the four remaining documents and the `docs/` phone reading layer. Completed the interaction catalogue (42 interactions) and `MOTION-SPEC.md`.

### 2026-07-25T13:27Z — auth, landing, settings
Built the auth suite and `AUTH-SPEC.md`; found the staging auth flow is cold-blue, invite-only, and reports errors only via toast. Built the landing page and the three settings hubs; recorded `SETTINGS-ADMIN-SPEC.md` including the `--font-ui` bug.

### 2026-07-25T10:19Z — shell and modules
Read the staging design system and built the shell plus 15 module screens as a clickable prototype. Wrote `RESEARCH.md` (competitor study → 18 binding design rules), `RBAC-SPEC.md` and `MESSAGING-ATTENDANCE-SPEC.md`. Replaced the invented brand glyph with the real `favicon.png` mark.

### 2026-07-25 — main branch
Extracted the `main` branch editorial system into `Kartavya Design System` at the project root (`tokens/`, `guidelines/`, `components/`, `ui_kits/app/`).
