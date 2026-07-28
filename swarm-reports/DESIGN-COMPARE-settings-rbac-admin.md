# DESIGN-COMPARE — settings · customization · org · RBAC · platform admin · auth/onboarding

Branch `staging`, read-only pass, 2026-07-28.
Spec priority: `design-reference/Kartavaya Redesign/*` (JSX + CSS) **wins** over `design-handover/*.md`.

Already-verified-live items (AccentPreview, TypePreview + 4 vars, FontList own-face rows, SidebarBgCards, the 68-file SoundGrid expansion, `lib/notifSound.js`) are **excluded** and not repeated below.

---

## 1 · Full tab tree — spec vs build

### A · Customization hub `/settings/customize` — `SetCustomize.jsx:469`

| # | Tab | Spec sections (leaf controls) | Built? |
|---|---|---|---|
| 1 | Appearance रूप | Card *Theme* (Mode seg + `system` snote) · Card *Accent colour* (hex readout, 12 swatches + `--ok` new-dot, Custom conic → `.spick` panel, `.sprev` strip) · Card *Sidebar background* (3 cards) | partial — 3 cards → 3 bare `.sr` rows; no card frames, no Hindi, no snote, no hex readout, no `.spick`, no new-dot |
| 2 | Typography अक्षर | Card *Display font* (9) · Card *UI font* (6) + warn snote · Card *Size and rhythm* (slider + line-height) · `.sprevcard` (h3 + p + Approve btn + ₹ numeral + attribution footer) | partial — 4 UI fonts not 6; preview lacks numeral, button row, attribution footer |
| 3 | Layout ढाँचा | Card *Structure* (sidebar · density · radius) · Card *Motion* (animations + `.sradius` swatch preview) | partial — radius **preview swatches absent**; no card grouping |
| 4 | Language भाषा | 6 `.slang` cards + check + `--font-indic` snote | partial — 4 options (documented decision), cards hand-rolled on `.sbg__c` + inline grid, no check mark, no snote |
| 5 | Notifications सूचना | Push card (permission chip + `SSwitch` + denied note + perm state) · Sound grid · **Email notifications (6 types, `support` locked)** · Toast position (3 + art) · **DND quiet hours + chips** · Time format | partial — **EmailToggles absent**; push is 2 buttons not a switch; toast pos 4 plain options, wrong default; DND replaced by server-backed `NotifyPrefs` (9 kinds) |
| 6 | Data & privacy गोपनीयता | **Active sessions** (`.ssess`, revoke, sign-out-everywhere, warn note) · **Export my data** (async, 24h/7d) · **Danger zone** (delete account, typed-name confirm) | **none of the three**; replaced by prefs-JSON download + reset-to-defaults |

### B · Organisation hub — impl route `/settings/organisation` (spec `/settings/org`)

| # | Tab | Spec leaves | Built? |
|---|---|---|---|
| 1 | Profile | Company · Billing address · Bank · **Logo drop zone + where-it-appears toggles** · Invoice note | yes (all 6 `st__gt` sections present, `.olg__where` present) |
| 2 | Members | roster, role badge, grant chips, ⋯ menu, edit-grants sheet, invite | yes |
| 3 | Billing | Subscription + credits · billing-period seg · **Change plan cards** · **Payment method `.opay` + method chips** · Invoices | partial — **no billing-period seg, no payment-method card** |
| 4 | Modules | card grid, per-module `SSwitch`, sensitive lock, soft-flag warn note | partial — grid is **read-only/disabled** |
| 5 | Security | 2FA allow + enforce(+lockout count) · idle timeout · **one device at a time** · password policy (3 switches) · **IP ranges list + add + self-lockout warn** | **every control disabled**; "one device at a time" and the IP-range list UI absent |
| 6 | Danger zone | **TransferOwnership** (`.oxfer` admin picker) · **DeleteOrg** (retention checkbox + typed name + 7-day queue) | **no controls at all** — prose only |

### C · Roles & access `/settings/roles` — `ScreensRBAC.jsx:73` gives 10 tabs

built: `members` · `matrix` · `invitations` (folded into one `TabMembers`, no tab bar)
**missing: `role levels` · `denied states` · `client portal` · `module rules` · `support access` · `audit log` · `projects`** (7 of 10)
missing modals: `RoleGuide`, `InviteWizard`, `RoleConfirm`, `CellEdit`, `MemberSheet`, `SupportApprove`, `SupportRequest`, `MatrixCards`

### D · Platform admin — `SETTINGS-ADMIN-SPEC.md:148`, `11-platform-admin.md:146`

| Route | Built? |
|---|---|
| `/admin/dashboard` | **missing** |
| `/admin/orgs` | yes |
| `/admin/orgs/:orgId` (Overview·Members·Modules·Invoices·Activity) | **missing** |
| `/admin/users` | yes (`/admin`) |
| `/admin/billing` | yes |
| `/admin/costs` | yes |
| `/admin/support` (Active·Queue·History) | **missing** |
| `/admin/settings` (defaults·templates·maintenance·flags) | **missing** |

### E · Auth + onboarding

`/login` · `/accept-invite` · `/forgot-password` · `/reset-password` · `/onboarding` — all routed.
Onboarding steps: profile · org · modules · invite · project (+ done / skipped summary) — present, invited users skip org+modules.
No `/signup`, no OAuth, no `.au-seg`, no `.au-chips` — **NOT A GAP**, invite-only is settled (`AUTH-SPEC.md:11`).

---

## 2 · HIGH severity

| # | Spec | Impl | Spec says | Code does | Sev |
|---|---|---|---|---|---|
| H1 | `SetCustomize.jsx:404-429`; `settings.css:138-143` `.ssess`/`.ssess__ic` | `pages/customize/TabData.jsx:33-56` | Active-sessions card: device icon, location, last-seen, `This device` tag, per-row **Sign out**, header **Sign out everywhere**, `.snote--warn` about an unrecognised session | Two read-only `.sr` rows: "Export preferences" (downloads `k_prefs` JSON) and "Storage". No session list, no revoke. | HIGH |
| H2 | `SetCustomize.jsx:432-440` "Export my data … tasks, comments, time entries, files, attendance … 24 hours, link valid 7 days" | `TabData.jsx:23-31` | Async full-account export | `new Blob([JSON.stringify(prefs)])` — **preferences only**, mislabelled as the export the spec names | HIGH |
| H3 | `SetCustomize.jsx:441-460`; `settings.css:144-146` `.sdanger` | `TabData.jsx:58-87` | **Delete my account**, owner-transfer precondition, typed-name confirm, `disabled={typed !== name}` | `.dz` exists but the action is **"Reset all preferences"**. Account deletion absent. | HIGH |
| H4 | `SetCustomize.jsx:69-76, 352-366`; `SETTINGS-ADMIN-SPEC.md:120-122` | `pages/customize/TabNotifications.jsx` (whole file) | Email notification types `assigned·mention·approval·due·digest` togglable and **`support_access_request` locked on** — "a customer cannot switch off the email that tells them somebody wants into their data" | No email-type list at all. `NotifyPrefs` covers **push** kinds only (`/me/notification_prefs`). The locked-on support-access mail has no surface. | HIGH |
| H5 | `08-rbac-screens.md:124-132` `.sab`/`.sab__dot`/`.sab__t` + `:212`; `RBAC-SPEC.md:110-112`; `11-platform-admin.md:221` | nowhere (`grep sab__\|SupportBanner` → 0 hits) | Violet, non-dismissible support-access banner in the **customer's** chrome, live countdown + revoke, for the whole session | Not built. `platform_support` currently reaches nothing, but the customer-side banner is the design's one non-negotiable and there is no placeholder for it. | HIGH |
| H6 | `08-rbac-screens.md:160-176` — "`lib/grants.js` matters more than the rest combined: **one** `can()` predicate, imported everywhere" | `lib/` listing — no `grants.js`, no `roles.js`, no `rbac.css`, no `components/rbac/` | one predicate, 15 modules × 5 levels | Absent. Level logic lives in `pages/org/levels.js`; module gating is re-derived per page (e.g. `pages/sanvaad/useSanvaadAccess.js`). Fifteen-modules-per-page is the exact failure mode named. | HIGH |
| H7 | reference `auth.css:4-8` — `.auwrap`/`.auhost{padding:22px}`/`.au{grid 44%/56%; border 1px --outline-variant; border-radius:var(--r-xl); box-shadow:var(--shadow-2); min-height:620px}` | `styles/settings.css:314-318` `.au{min-height:100vh; grid-template-columns:minmax(0,1.06fr) minmax(0,.94fr)}` | Auth is a **framed card floating on `--bg`**, 44/56 | Full-bleed edge-to-edge split, no frame, no radius, no shadow, different ratio. Impl follows `12-auth-onboarding.md:26`, which the reference **overrides**. | HIGH |
| H8 | reference `auth.css:170-183` — "Narrow viewports **stack** the panel above the form — **it never disappears**"; only `.au--m` (the phone *surface*) hides it. `.au-brandm:44-47` is the compact replacement | `styles/settings.css:415-419` `@media (max-width:900px){ .au__brand{display:none} }` | stack at ≤1023px; compact brand strip on phone | Brand panel **deleted** below 900px with no replacement. `.au-brandm` never ported. Same "hide a thing without shipping its replacement" pattern the specs flag three times. | HIGH |
| H9 | `SetOrg.jsx:300-341`; `SETTINGS-ADMIN-SPEC.md:140` | `pages/org/TabDanger.jsx:23-70` | Transfer ownership (`.oxfer` picker over org_admins, password + 2FA) and Delete organisation (retention checkbox, typed org name, **7-day queue**) | Two prose blocks, **zero controls**. Justified by the 2026-07-26 tier-2 decision, but the spec'd screen has no built equivalent anywhere. | HIGH |
| H10 | `SetOrg.jsx:249-298`; `SETTINGS-ADMIN-SPEC.md:138` | `pages/org/TabSecurity.jsx:49-124` | 2FA allow/enforce (enforce disabled until allow is on, **names how many members lock out**), idle timeout `15/30/60/never`, **one device at a time**, password policy (3 switches), **IP range list + add + self-lockout check** | Every control `disabled`. Timeout options are `never/30/120/480` (wrong set). "One device at a time" and the `.oiplist`/`.oip`/`.oip--add` range editor are absent entirely. | HIGH |
| H11 | `SETTINGS-ADMIN-SPEC.md:177`; `11-platform-admin.md:92-103`; ref `settings.css:280,297` `.adm__exit`/`.adm__backpill` | `components/admin/AdminShell.jsx:113-129` | Below 1024px: drawer **and** a second `← App` pill **in the bar**, "so leaving admin mode never depends on opening the drawer… that shipped twice in this project and both times left a surface with no way out" | Bar renders `.adm__burger` + crumb + audited chip only. **No exit pill.** Leaving admin on a phone requires discovering the drawer. | HIGH |
| H12 | `SETTINGS-ADMIN-SPEC.md:148-157`; `11-platform-admin.md:146-155` | `components/admin/adminNav.js:69-74` | 7 console rows + `/admin/orgs/:orgId` detail with 5 tabs | 4 rows. **Dashboard, Support sessions, System settings** and the whole org-detail screen are missing (documented as endpoint-blocked). | HIGH |

---

## 3 · MED severity

| # | Spec | Impl | Divergence | Sev |
|---|---|---|---|---|
| M1 | `SetCustomize.jsx:311-328` — `<SSwitch on={p.push && perm!=='denied'} …>` + permission chip + `.snote--err` | `TabNotifications.jsx:106-112` | Spec: one permission-aware **switch**. Build: `<Tag>` + two buttons `Enable`/`Disable`, each with its own disabled logic. The specced `PushToggle` control does not exist. | MED |
| M2 | `SetCustomize.jsx:368-378`; `settings.css:127-135` `.spos`/`.spos__art`/`.spos__t--tr|br|bc` | `TabNotifications.jsx:130-148`; `settings.css:297-302` | Spec: **3** options `tr · br · bc`, each a mini-viewport art preview, default `br`. Build: **4** plain `Seg` options `tl · tr · bl · br`, default `tr` (`CustomizePanel.jsx:95`). Neither the art preview nor `bc` exists; `br` — the specced default and reasoned about at `SetCustomize.jsx:377` — is not the default. | MED |
| M3 | `SetCustomize.jsx:279-284`; ref `settings.css:91-93` `.sradius`/`.sradius__d` | `pages/customize/TabLayout.jsx:53-67` | Radius preview swatches (`4/10/20`px boxes that round with the choice) absent. The only feedback for a corner-radius setting is the rest of the page. Impl values `8/12/20` are a documented reconcile against `Chrome.jsx:190` — that part is **NOT A GAP**. | MED |
| M4 | `SetCustomize.jsx:146-155`; ref `settings.css:42-43` `.spick` | `components/customize/AccentGrid.jsx:45-54` | Spec: picking Custom opens a `.spick` panel — 46×46 colour input, "Mid and deep are derived — `L−10`/`L−20`", and a **Clear** button. Build: bare `<input type="color">` inside the 13th cell, no explanation, **no way to clear back to a preset** except picking one. | MED |
| M5 | `SetCustomize.jsx:138`; ref `settings.css:41` `.sacc__new` | `AccentGrid.jsx:19-39` | 6px `--ok` dot marking the 8 newly-added presets, `box-shadow: 0 0 0 2px var(--surface)`. Not rendered. | MED |
| M6 | `SetCustomize.jsx:56` `PageHeader (Reset to defaults · Done)`; `:494` | `pages/CustomizeSettingsPage.jsx:56-71` | Header carries no `right` actions. "Reset to defaults" is buried at the bottom of tab 6; there is no `Done`. Same on `OrgSettingsPage.jsx:130-139` vs `SetOrg.jsx:350` (`All changes saved` tag + `Done`). | MED |
| M7 | ref `settings.css:96-103` `.slangs`/`.slang`/`.slang__l`/`.slang__d`/`.slang__ck` | `pages/customize/TabLanguage.jsx:37-61` | Hand-rolled: borrows `.sbg__c` (the *sidebar-background* card) and adds four inline style objects — `gridTemplateColumns`, `gap`, `padding`, `textAlign`, `fontSize`, conditional `fontWeight`, `color`. Exactly the TeamsPage situation: the fix is a `.slang` component class, not inline overrides on a foreign class. | MED |
| M8 | `SetOrg.jsx:198-207` `.opay`/`.opay__ic` + method chips; `:154-156` billing-period `SSeg` | `pages/org/TabBilling.jsx` | No payment-method card (card on file, auto-debit mandate, expiry, Change) and no Monthly/Annual segmented control. | MED |
| M9 | `SetOrg.jsx:234` per-module `SSwitch`; `SETTINGS-ADMIN-SPEC.md:136` | `pages/org/TabModules.jsx:98` `<ModuleCard … disabled />` | The org-side module on/off control is inert. Reasoned (`PATCH /v1/org/modules` unbuilt) and the soft-flag rule is preserved as a comment — but the tab the spec calls a control surface is a read-out. | MED |
| M10 | `12-auth-onboarding.md:131-146` — `pages/auth/LoginForm.jsx`, `AcceptInviteForm.jsx`, `ForgotForm.jsx`, `ResetForm.jsx`, `components/auth/Field.jsx`, `StrengthMeter.jsx`, `lib/passwordRules.js` | `pages/LoginPage.jsx` (44 KB, one file) | All seven live inside one module. `scorePassword` is exported from a page; `AuField`/`AuPassword`/`StrengthMeter` are page-locals, so nothing else in the product can reuse the tonal field or the meter. Functionally complete — structurally the opposite of the spec. | MED |
| M11 | ref `auth.css:156-161` `.au-sent`/`.au-sent__ic`/`.au-sent__p`/`.au-sent__hint` + `@keyframes sentPop` | `pages/LoginPage.jsx:865-885` | Forgot-password success is a `<Banner kind="info">`. The specced confirmation — centred 52px `--primary-container` icon with a spring pop, `.au-sent__p` at 34ch, `.au-sent__hint` — is not built. The 60s resend countdown **is** built (`LoginPage.jsx:814-819`) — NOT A GAP. | MED |
| M12 | `AUTH-SPEC.md:76` — "invalid-credentials banner + form shake … **with attempts remaining**" | `LoginPage.jsx:236, 249-270` | Shake is built and motion-scaled. The **attempts-remaining** count is not surfaced; only a generic 429 string. | MED |
| M13 | `08-rbac-screens.md:79-85` `.rb`/`.rb__dot` — "`--c` per role from `lib/roles.js`" | `styles/org.css:145-152` `.rb` **and** `styles/editorial.css:2250-2263` `.k-rolebadge--{admin,owner,member,client}` used by `pages/TeamsPage.jsx:193` | Two role-badge components with different colour models (token `--c` vs four fixed containers) and no shared `lib/roles.js`. Org tier and project tier render role identity differently on adjacent screens. | MED |
| M14 | ref `settings.css:24-30` `.snote` / `--warn` / `--err` — used 11× across the three hubs | not in `settings.css`, `org.css`, `admin.css` | The inline-callout primitive is absent. Its jobs are done by `.opend` (org), `.sr__d` with an inline `color: var(--danger)` (`TabNotifications.jsx:94`, `NotifyPrefs.jsx:197`), and prose paragraphs. Three vocabularies for one component. | MED |
| M15 | `SetCustomize.jsx:242-251` `.sprevcard__n` (₹5,01,500 in display face) + `.sprevcard__f` attribution + Approve button row | `components/customize/TypePreview.jsx:30-38` | Preview has h4 + p + button. Missing the **numeral specimen** — the one thing that shows what the display face does to money on every table in the product — and the "Heading in X · body in Y" footer. | MED |
| M16 | `SetCustomize.jsx:128` — `mode === 'system'` renders a live snote naming the current resolution | `pages/customize/TabAppearance.jsx:13-36` | Picking System gives no confirmation of which way it currently resolves. The subscription itself is correct (`CustomizePanel.jsx:325-331`) — NOT A GAP; the feedback line is. | MED |
| M17 | `SetCustomize.jsx:131` `right={<span className="mute mono">{acc.color}</span>}` | `TabAppearance.jsx:38-54` | The active accent's hex is never shown, including after a custom pick — so a user cannot read back the colour they set. | MED |
| M18 | `SetCustomize.jsx:119-186` — three `<Card title hi>` wrappers per tab, bilingual (रंगरूप · वर्ण · पार्श्व · माप · ढाँचा · गति · ध्वनि · ईमेल · स्थान · शांत · समय · सत्र · निर्यात · संकट) | `pages/customize/*` — flat `.sr` rows inside one `.st__group` | Every card frame and every section-level Devanagari pair inside the customize hub is dropped. Only the six **tab** labels keep theirs. `settings.css` has no card rule at all for this hub. | MED |
| M19 | ref `settings.css:206-207` `.adm__badge{box-shadow: inset 3px 0 0 #7c5cbf}`; `11-platform-admin.md:77` | `editorial.css:780-786` | The violet keyline moved from the badge to `.adm__side` as a whole. `.adm__warn` is specced as a `--primary-container` **pill** (`ref settings.css:230`) and renders as plain `--on-surface-3` text (`editorial.css:862-865`). | MED |
| M20 | `11-platform-admin.md:108-115` `.aot`/`.aot__num`/`.aot__sus` cross-org table | `styles/admin.css` — `.adm-rows`/`.adm-sus`/`.adm-name` | Renamed, and `.aot__num` (tabular-nums + mono, right-aligned) has no equivalent in `admin.css`. Suspended-row treatment **is** ported (`admin.css:84-85`) — NOT A GAP. | MED |

---

## 4 · LOW severity

| # | Where | Divergence | Sev |
|---|---|---|---|
| L1 | `styles/settings.css:116-118` `.acc__cust .acc__sw` | Conic gradient uses the **retired** brand hexes `#E4572E,#F2A65A,#04837A,#3E5C8A,#7C5CBF`. Spec (`ref settings.css:38`) builds it from the live accent set `#05b7aa,#3b82f6,#7c3aed,#e11d63,#f59e0b`. Conic stops must be literals, but these are the wrong literals — the "any colour" swatch advertises a palette the product no longer has. | LOW |
| L2 | `styles/settings.css:7` `.st { max-width: 920px }` | Reference `.setwrap` (ref `settings.css:3`) has no max-width. Documented reasoning, and it is left-aligned not centred, so it does not break the fluid-layout rule — but it is a fixed cap the spec does not have. | LOW |
| L3 | `CustomizePanel.jsx:53-58` | 4 UI fonts vs the spec's 6 (`SetCustomize.jsx:48-55`). Reasoned: `index.html` loads only these four, and a row in a font the page has not loaded is the exact failure the specimen rows exist to fix. Closing it is an `index.html` change, not a JSX one. | LOW |
| L4 | `styles/settings.css:151, 175, 217`; `org.css:294` | `border-color: var(--primary)` where the reference uses `var(--primary-text)` on the same selectors (`ref settings.css:52, 76, 111`). Borders, not text, so no contrast failure — but the two files disagree on which token owns a selected outline. | LOW |
| L5 | `AdminSidebar.jsx:70` `.adm__foot` | Spec (`SETTINGS-ADMIN-SPEC.md:175`) puts the **operator** in the footer — violet avatar + their platform role. Build renders the string "Everything here is audited." (already duplicated in the bar). Who is signed in is not on the console. | LOW |
| L6 | `adminNav.js:70-73` | Nav count badges: only `orgs` carries one. `SETTINGS-ADMIN-SPEC.md:173` gives every row a count in `color-mix(in srgb,#7c5cbf 34%,transparent)`. | LOW |
| L7 | `pages/customize/TabTypography.jsx:47-57` | Slider styled with an inline object (`flex`, `accentColor`, `cursor`, `fontFamily`, `minWidth`) instead of `.sld` (`ref SetCustomize.jsx:233`). Not per-instance/computed — this is a component class the build is missing. | LOW |
| L8 | `components/customize/SoundGrid.jsx:22-28, 48` | Five inline objects: the flex-column wrapper, `.st__gt` colour/margin overrides, the `lang="hi"` span's `opacity/marginLeft`. The group-heading pair already has a class (`.st__gt` + `.st__gh`); overriding it inline at the call site puts the same decision in two places. | LOW |
| L9 | `App.jsx:221` | Route is `/settings/organisation`; spec says `/settings/org` (`SETTINGS-ADMIN-SPEC.md:126`). Cosmetic, but any spec'd deep link is wrong. | LOW |
| L10 | `styles/auth.css:29-32` `.au__wm{letter-spacing:-.03em}` | Negative tracking declared on `--font-hindi`. Safe **only** because `AuthShell.jsx:152` sets `lang="hi"` and `editorial.css` zeroes tracking for that selector — the comment at `AuthShell.jsx:147-151` documents this. Fragile: the reference has the same shape (`ref auth.css:13`), so **NOT A GAP**, but it is one missing attribute away from smeared conjuncts. | LOW |

---

## 5 · Explicitly NOT A GAP

| Thing | Why |
|---|---|
| `.sacc`→`.acc`, `.sfont`→`.fnt`, `.ssound`→`.snd`, `.sside`→`.sbg`, `.srow`→`.sr`, `.sseg`→`.seg`, `.sprevcard`→`.tpv`, `.sprev`→`.accpv`, `.sgroup`→`.st__gt`, `.sdanger`→`.dz`, `.fld__*`→`.aufld__*` | Systematic rename, complete on both sides |
| `.rb`, `.gc`, `.amx` not in `styles/rbac.css` | Ported verbatim into `styles/org.css:145-152` and the `.amx*` block — file location differs, CSS matches `08 §1` |
| `.adm`, `.adm__side`, `.adm__bar`, `.adm__body` not in `admin.css` | In `editorial.css:749-880`, with the ≤1023px drawer, scrim and `--pf-*` violet re-point all present |
| `DeniedPanel` | `components/ui/ErrorState.jsx` `kind="denied"` — neutral, names the grant, offers Request access (08 §1 satisfied) |
| Separated duty on Vetana/Ganit | Correct and thorough: `pages/org/levels.js:78-84` `levelSatisfies` short-circuits `required === APPROVER` to `held === APPROVER`; `AccessMatrix.jsx:86` marks the columns `· sep`; `:122-128` explains it in the footnote; `TabModules.jsx:108-112` restates it. Mirrors `role_tiers.py`. **Admin does not imply approver — verified.** |
| `NO_APPROVER_MODULES` | `levels.js:31` = kartavya, dristi, srijan, sanvaad, esign — matches `RBAC-SPEC.md:51-63` and `ScreensRBAC.jsx:9-19` exactly |
| No `/signup`, no OAuth, no `.au-seg`/`.au-or`/`.au-social`/`.au-chips`/`.au-steps` | Invite-only settled 25 Jul 2026 (`AUTH-SPEC.md:11`) |
| `DEFAULT_GRANT_LEVEL = viewer` vs spec's `admin` | `levels.js:41` deliberately safer than `RBAC-SPEC.md:73`; a default of admin means the four levels never get used |
| No Tailwind anywhere in scope | verified by grep across `pages/customize`, `pages/org`, `pages/admin`, `pages/onboarding`, `components/customize`, `components/admin` |
| Raw hex in `CustomizePanel.jsx:10-24` | The 12 accent base colours — data, not styling; every derived value goes through `deriveAccentColors` |
| `#fff` in `settings.css:362`, `auth.css:124`, `editorial.css` `.adm__*` | All on `rgb(var(--side-ink))` / violet chrome, i.e. surfaces that are dark in both themes. Matches the reference's own usage |
| `TeamsPage.jsx` | Fully class-driven; the single inline style (`:187`, `--av-c` avatar colour) is genuinely per-instance and computed |
| 60s resend countdown, decline-invitation, existing-user invite branch, expired-invite screen, expired-session banner | All built (`LoginPage.jsx:814, 596, 678, 620, 292`) |
| `dnd`/`dndFrom`/`dndTo` absent from `DEFAULTS` | `CustomizePanel.jsx:96-101` — quiet hours are server-enforced on `notification_prefs`; a localStorage mirror no sender reads would make the schedule appear set and silence nothing |
| `MarginCell` containment | `pages/admin/MarginCell.jsx:26-49` implements the `[data-surface="platform"]` tripwire and correctly states it is not the enforcement |
| Dark mode | Zero `[data-theme="dark"]` blocks in `settings.css`/`org.css`/`admin.css`/`auth.css` is **correct** — the whole scope is token-driven and flips with `[data-theme]` on `<html>` |
