repo: kevalvshah/Kartavya
branch: staging

## Last sync
date: 2026-07-25T17:56:00Z

### Updated in this project
- Wrote the seven remaining handover files. **25 of 26 done**; `25-qa-acceptance.md` is deliberately last. Empty/loading/error folded into `02` rather than becoming its own file.
- Resolved seven conflicts against `00-tokens.md`: **status colours now flip with the theme** (three of six just reuse `--ok`/`--warn`/`--danger`), the retired `#0082c6` removed from the three tokens it had crept back into, read tick fixed at `#4FC3F7`, `--shadow-4` defined, type scale `calc()`-derived with `max()` floors, radius default 12 → 10, and `applyPrefs` now writes `--ix-user` so the OS reduced-motion setting wins.
- **No focus trap exists anywhere in `frontend/src`** — 0 matches for focusTrap/focusLock across 158 files.
- **`ConfirmDialog.jsx` sets `aria-modal` with no `role`**, so the destructive-action guard never announces itself; `NotifToast` has no live region, so every toast is silent to a screen reader.
- **`CommandPalette.jsx` searches nothing** — placeholder promises search, `ALL_ITEMS` is 30 hardcoded nav/action entries.
- **No translation layer exists**, but the language selector offers हिन्दी and ગુજરાતી as interface languages. Four incompatible bilingual label shapes across Sidebar/Topbar/CommandPalette/InboxPage, Gujarati in only one.
- **Two client portals ship**; `ClientPagesImpl.jsx` calls one "legacy dark portal" in its own source — a fourth token vocabulary.
- **Vikray (Sales) has a page, route and palette entry and is in no handover file.**

## Previous sync
date: 2026-07-25T17:23:35Z

### Updated in this project
- Wrote all 19 `design-handover/` files (`00-tokens` through `18-documents`), each grounded in the actual staging source rather than the prototype. They reference the six spec documents instead of restating them and carry only CSS, component trees, endpoints and a before/after per changed file.
- **`addToast` does not exist.** `components/ui/toast.jsx` returns `{pushToast, error, success, warning, info}`; `SanvaadPage.jsx` destructures `addToast` in three places, so creating a channel succeeds server-side then throws in the UI, and every send failure throws instead of reporting.
- **Sanvaad scrollback is unreadable** — a 5s poll replaces the message array and an unconditional `scrollIntoView` effect yanks the view to the bottom on every change.
- **`/admin/billing` has no `org_id` on any call** — every endpoint is `/v1/subscription/*`, so "Billing Administration" administers the operator's own org. Only the overdue list is cross-org.
- **Pahchan does not exist** — 0 matches for pahchan/attendance/clock/face across all 158 `frontend/src` and 49 `mobile/src` files. Entirely net-new.
- **Threads are write-only** — replies post with `parent_message_id`, `thread_count` increments, and there is no thread view, so the replies are unreachable.
- **Three module pages are unmaintainable**: `GrahaPage.jsx` 150 KB, `ManavPage.jsx` 133 KB, `GanitPage.jsx` 125 KB. Splitting is a prerequisite to restyling; `ClientBoardPage.jsx` (138 bytes over `ClientPagesImpl.jsx`) is the existing pattern.
- **`PageHeader` is called with four different prop signatures** (`sanskrit`/`lede`, `sans`/`subtitle`, `subtitle`, `kicker`+`sanskrit`+`lede`+`right`), so at least one page silently drops its subtitle and Devanagari.
- **`var(--k-danger)` and `var(--danger)` appear in the same file** in `ApprovalsPage.jsx`, so one of the two reject buttons is not red.
- **GST is a single 18% column** — cannot represent a compliant intra-state CGST+SGST invoice. Recording a payment has no date or amount, so partials are impossible.
- Eight independent status-colour maps, all light-only. Three token systems ship: web (warm-earthy), auth (cold blue), mobile app (iOS grey + M3 teal).
- Corrected an earlier note: the plan catalogue does carry `price_monthly` and `price_per_user_monthly`, so plan pricing is likely list-price-with-override rather than fully negotiated. Needs verification before the landing page goes public.

### Read this sync
`pages/SanvaadPage.jsx` · `ApprovalsPage.jsx` · `AdminBillingPage.jsx` · `BillingPage.jsx` · `CustomizeSettingsPage.jsx` · `components/ui/toast.jsx` · trees of `frontend/src/pages` and `mobile/src`

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
