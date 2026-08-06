repo: kevalvshah/Kartavya
branch: staging

## Last sync
date: 2026-08-05T22:35:00Z
tree: a304398e64b9 — a TREE hash, not a commit. No commit sha has been recorded on either sync, so `github_compare` cannot be used; this sync diffed by reading upstream change markers (`design-handover/_IMPLEMENTATION-LEDGER.md`, `E2E-STATUS.md`). **Record a real commit sha next time one is available.**

### Updated in this project
- **Designed three new surfaces: messaging v2, Sahayak and the skills marketplace.** Read the real source first — `sanvaad/` (22 files + `varta/`), `srijan/SahayakTab.jsx`, `hub/skills/`, `brand/Lotus.jsx`, and migrations `011`/`012`/`059`. Specs are `28`–`30`.
- **The "threads are write-only" defect is structural, not visual.** `list_messages` filters `parent_message_id IS NULL`, so a reply is never in the log — it exists only in a third column that is a *sibling* of the chat pane. The redesign puts replies inline, which also lets `ChatPane`'s six-second deep-link retry loop be deleted.
- **WhatsApp is a separate tab, reversing my first pass.** I unified all four conversation kinds into one rail; the owner corrected it. They were right and the reason is a safety one: a customer thread on a metered, template-gated, 24-hour-windowed channel must not be one click from an internal channel.
- **Found an existing Sahayak build on a different palette, and it is now settled on cream.** Upstream `styles/sahayak.css` scopes `k-surface-theme` (Slate/indigo), while this prototype is on cream. Raised at the top of `29` rather than silently picking one; the owner chose cream on 2026-08-06, matching the prototype. Removing the scope is the whole change — but the contrast pass has to be re-run, because the existing measurements were taken by hand against Slate and `check-contrast.mjs` cannot see scope.
- **The skills request endpoint is confirmed in scope.** `POST /v1/hub/skills/:id/request` — free-text note, idempotent per org and skill, lands as a lead for the account contact. Specified in `30` §11.
- **Named the conversation-surface shadows.** Five literal warm `rgba(28, 24, 16, …)` shadows in `sahayak.css` and `messaging.css` could not flip with the theme — a warm shadow on `#12151A` is a smudge, and both surfaces are mostly blocks floating on a patterned ground. Now `--shadow-card` / `--shadow-block` / `--shadow-seat` / `--shadow-bubble` in both palettes, light values byte-identical. Also fixed `--shadow-4`, which was shipping the light-mode warm value inside the dark block.
- **The skills "marketplace" cannot install anything, and that is the design problem.** `assign_skill_to_org` is guarded by `OPERATIONS_CONSOLE_ROLES`, which holds no org-tier role — so no owner or org admin can add a skill. Designed the request-to-Aekam path honestly instead of a button that 403s.- **Ported the lotus loader** from `brand/Lotus.jsx` — the COURSES table and lobe geometry verbatim. It is the product's only waiting state and Sahayak uses it at 30px beside a reply. `lotus.css` is a transcription; `components.css:1380–1446` is canonical.
- **Made the conversation ground a per-user setting** (`data-conv-pattern` × `data-conv-ground`), on the same argument that put translucency and text size in Customization. Patterns come from the brand's own motif study — jaali, patola, star mandala.
- **The five ship-blockers were adjudicated against the branch: two real, two stale, one false.** Both real ones (`FocusTrap` focus-restore, `TargetsTab`) are fixed upstream. Rewrote the tables in `CLAUDE-CODE-START-HERE.md` and the README with a verdict per claim.
- **Designed the org switcher.** It shipped upstream as `165b2fd0` with no design — the resolver had been falling back to the user's oldest membership, so a member of two firms could only ever see one. Built into `Chrome.jsx` + `app.css`, specified in `01`. It also splits apart a conflation the prototype carried: one topbar chip was naming the active org *and* toggling the platform console.
- **Support sessions are a section of that switcher, in platform violet, never styled as a membership** — request id, approver, and time remaining on the row. Seat counts are on the membership rows because `max_users` is now enforced and entered by hand, so an org can sit at its ceiling with nothing on screen saying so.
- **The GST claim was wrong and `18:62` was the file that was wrong.** The customer-facing invoice has carried `place_of_supply`/`cgst`/`sgst`/`igst`/`cess` since migration `018`, wired end to end. Replaced with the two real items — derive `is_igst` from a state dropdown, and Aekam's own subscription invoices genuinely are not split.
- **Found and fixed the eighth instance of this project's signature bug.** `Kartavaya Redesign/tokens.css` shipped the type scale as fixed literals and never defined `--font-size-base`, while `00` §2 and README correction #6 had asserted for two weeks that the scale was calc-derived. Anything referencing the token was silently dropped. Implemented §2 verbatim, fixed the density block (it re-pointed `--t-body` to literals, which would have killed the derivation in two of three densities), and pointed `SetCustomize.jsx`'s Text size slider at the token instead of a raw inherited `font-size` — it also wrote `--ix` where §2 says `--ix-user`, so it was defeating OS reduced-motion.
- Corrected `27` (targets endpoint exists; crash fixed), `11` (a retired Professional plan, not a missing one; seat enforcement), `14` (mangled sentence reintroducing a dropped `--ok` caveat), `07` (`device_id` advisory only, the sixth table, three missing Expo deps), and four of the ten sub-11px literals.

## Screen map

| Prototype file | Built from (staging) |
|---|---|
| `tokens.css` | `styles/kartavaya-design.css`, `styles/dark-theme.css` — now an alias layer upstream, not a wholesale replacement (~2,957 legacy references) |
| `app.css` | `styles/editorial.css` |
| `Chrome.jsx` | `layout/AppShell.jsx`, `Sidebar.jsx`, `Topbar.jsx`, `CustomizePanel.jsx`, **org switcher `165b2fd0`** |
| `ScreensCore.jsx` | `pages/DashboardPage.jsx`, `GrahaPage.jsx` |
| `ScreensBiz.jsx` | `pages/GanitPage.jsx`, `VikrayPage.jsx` |
| `ScreensMore.jsx` | `SanvaadPage.jsx`, `DristiPage.jsx`, `ManavPage.jsx`, `VetanaPage.jsx`, `PracharPage.jsx`, `OrgSrijanPage.jsx`, `HubDashboardPage.jsx`, `EsignPage.jsx` |
| `ScreensThin.jsx` | second screens for the 7 thin modules |
| `ScreensWork.jsx` | `BoardsPage.jsx`, `TasksListPage.jsx`, `ApprovalsPage.jsx`, `TaskDrawer.jsx`, `NewTaskModal.jsx`, `KanbanView.jsx` |
| `ScreensSanvaad.jsx`, `ScreensVarta.jsx` | `pages/SanvaadPage.jsx` |
| `ScreensRBAC.jsx`, `ScreensRBAC2.jsx` | `PLAN_RBAC.md`, `PLAN_ROLES.md`, `middleware/roles.py`, `OrgSettingsPage.jsx`, `migrations/016_*.sql` |
| `ScreensPlatform.jsx`, `SetAdmin.jsx` | `AdminPage.jsx`, `AdminOrgsPage.jsx`, `AdminBillingPage.jsx`, `AdminCostDashboardPage.jsx`, `staging.plans`, `staging.hub_tiers` |
| `SetCustomize.jsx`, `SetOrg.jsx` | `CustomizeSettingsPage.jsx`, `NotificationsSettingsPage.jsx`, `CustomizePanel.jsx`, `OrgSettingsPage.jsx`, `BillingPage.jsx` |
| `Messaging v2.html` + `Msg2*.jsx`, `messaging.css` | `pages/sanvaad/*` (22 files), `sanvaad/varta/*`, `styles/sanvaad.css`, `useChannelMessages.js`, `useStickyScroll.js`, `channelTone.js` |
| `Sahayak.html` + `Sahayak*.jsx`, `sahayak.css` | `pages/srijan/SahayakTab.jsx`, `srijan/sahayak/*`, `styles/sahayak.css`, `migrations/017_srijan_p3_p4_chatbot_publishing.sql` |
| `Skills Marketplace.html` + `Mkt*.jsx`, `marketplace.css` | `HubSkillsPage.jsx`, `hub/skills/*`, `srijan/SkillsTab.jsx`, `services/skill_dispatcher.py`, `migrations/012_hub_skill_packs.sql`, `059_skills_integration.sql` |
| `Lotus.jsx`, `lotus.css` | `components/brand/Lotus.jsx`, `layout/BrandLoader.jsx`, `styles/components.css:1380–1446` |
| `Interaction Catalogue.html` + `Ix*.jsx`, `motion.css` | `components/ui/*`, `components/drawer/*`, `TaskDrawer.jsx`, `MentionTextarea.jsx`, `ReminderPicker.jsx` |
| `Auth Screens.html`, `Auth.jsx`, `AuthForms.jsx` | `layout/AuthShell.jsx`, `pages/LoginPage.jsx` |
| `Onboarding.html`, `Auth Emails.html` | new — no onboarding or email templates on staging |
| `Landing Page.html` | new — no public marketing page on staging |
| `Pahchan v1.html` + `Pahchan*.jsx`, `pahchan.css` | `routers/manav.py`, `services/storage.py`, `mobile/package.json`, `staging.manav_employees` |
| `Mobile App.html` + `Mobile*.jsx`, `mobile.css` | `mobile/src/screens/*`, `screens/taskdetail/*`, `BoardScreen.tsx`, `InboxScreen.tsx`, `SettingsScreen.tsx`, `MeScreen.tsx`, `nav/RootStack.tsx`, `theme/tokens.ts`, `components/{TaskCard,NewTaskSheet}.tsx` |
| `System Blueprint.html` + `Blueprint*.jsx` | whole-repo synthesis — state machines, entities, real-time channels, offline replay |
| `docs/*` (8 documents) | `pages/OrgSettingsPage.jsx` (`/v1/org/profile` shape), `public/favicon.png`, `services/invoice_pdf.py` |
| `design-handover/*` (31 files) | whole-repo synthesis; per-file sources listed in each |
| `Start Here.html`, `Component Inventory.html` | project index · self-enumerating from the stylesheet — no staging counterpart |

## Sync history

### 2026-07-26T12:18Z — Pahchan register, component inventory
Read the real component library before writing the Pahchan reuse map. Two plausible paths did not exist — no `components/navigation/`, no `components/data-display/`; `Seg` lives in `components/customize/`, `StatusChip` in `components/editorial/`. Found a live shipped defect: `ModuleUI.Badge` does `background: \`${c}18\`` and `statusColors.js` now returns `var(--st-done)`, so it evaluates to `"var(--st-done)18"` and is dropped — every status badge renders with no background, including all six order states in Vikray. `mixAlpha` already exists for exactly this. `Seg` takes `{value,label}` with no count prop. No attendance states in `statusColors.js`, so `PUNCH_COLORS` was specified as a sixth shared map. Two empty-state components exist. Added loading / empty / finished / error to the register, with the filtered-empty designed as a finished queue rather than an absence.

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
