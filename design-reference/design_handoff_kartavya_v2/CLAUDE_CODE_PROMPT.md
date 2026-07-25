# Claude Code kickoff prompt

Open Claude Code in your local clone of `github.com/kevalvshah/Kartavya` on
`main`. Paste the prompt below.

---

```
You're going to port an editorial-typographic redesign of Kartavya into this
repo, page by page, on the `main` branch.

The full spec lives in `design_handoff_kartavya_v2/`. Start by reading these
seven files, in order:

  1. design_handoff_kartavya_v2/README.md
  2. design_handoff_kartavya_v2/SCREEN_MAP.md
  3. design_handoff_kartavya_v2/DESIGN_TOKENS.md
  4. design_handoff_kartavya_v2/CLIENT_PORTAL_NOTES.md
  5. design_handoff_kartavya_v2/ATTACHMENTS_AND_STORAGE.md
  6. design_handoff_kartavya_v2/prototype/emails/README.md
  7. (open in browser) design_handoff_kartavya_v2/prototype/emails/Email System.html

The HTML prototype that defines the visual target lives in
`design_handoff_kartavya_v2/prototype/`. Treat it as a design reference —
NOT as code to copy into the live app. The live app is React + craco +
Tailwind, and every screen already exists as a page in
`frontend/src/pages/`. Your job is to replace the JSX of each page with the
editorial layout from the prototype while keeping every existing data hook,
API call, route, and permission gate exactly as it is.

Implementation plan — follow this commit order:

  1. feat(styles): add editorial design tokens
       - New: frontend/src/styles/editorial.css (port styles.css +
         styles-2.css + styles-modals.css from prototype/src/)
       - Edit: frontend/src/styles/index.css (add the import)
       - Edit: frontend/public/index.html (add Google Fonts <link>)
       - Edit: frontend/src/components/CustomizePanel.jsx (rewire to new
         tokens — theme, accent, density, font)
       - Run `npm start`, verify no visual change yet (tokens only).

  2. feat(components): editorial primitives
       - New dir: frontend/src/components/editorial/
       - Build: Hero, PageHeader, Card, StatTile, DueChip, StatusChip,
         PriorityDot, ProjectTag, AvatarStack, WeekStrip, Citation
       - Add a barrel: frontend/src/components/editorial/index.js
       - No pages import these yet — no regression risk.

  3. feat(layout): editorial Sidebar + Topbar
       - Edit: frontend/src/components/layout/Sidebar.jsx
       - Edit: frontend/src/components/layout/Topbar.jsx
       - Edit: frontend/src/components/layout/AppShell.jsx (className updates)
       - Run `npm start`, check every route — the chrome should update
         everywhere simultaneously.

  4. feat(dashboard): editorial Today page
       - Edit: frontend/src/pages/DashboardPage.jsx
       - Reference: design_handoff_kartavya_v2/prototype/src/screens.jsx
         (ScreenToday function)
       - Keep all existing hooks (useDashboard, useTasks). Just rewrite JSX.

  5. feat(tasks): editorial Tasks + Boards + Projects
       - Edit: pages/TasksListPage.jsx, ProjectBoardPage.jsx, ProjectsPage.jsx
       - Edit: components/views/TableView.jsx, KanbanView.jsx, KanbanCard.jsx
       - Edit: components/TaskDrawer.jsx, NewTaskModal.jsx, TaskEditor.jsx
       - Edit: components/fields/FilesField.jsx (restyle to editorial paper canvas)
       - Reference: prototype/src/screens.jsx, task-drawer.jsx, modals.jsx
       - IMPORTANT — ATTACHMENT AUDIT (see ATTACHMENTS_AND_STORAGE.md §1):
         · TaskDrawer Files tab → add "Attach file" button + per-file
           download icon
         · TaskDrawer Comments compose → add paperclip icon
         · NewTaskModal → add Attachments field under Description
         · Verify TaskEditor has paperclip; add if missing
       - IMPORTANT: Verify components/views/KanbanView.jsx honors the
         `readOnly` prop. If not, fix it here so commit 8 inherits it.

  5b. feat(backend): Bhagavad Gita verse-of-the-day endpoint
       - New: backend/services/gita.py (see ATTACHMENTS_AND_STORAGE.md §4
         for the full implementation — vedicscriptures.github.io is the
         free, no-auth source; fallback to hardcoded 2.47 on network error)
       - Edit: backend/server.py — mount GET /api/verse-of-the-day
       - Cache one verse per calendar day (every workspace sees the same
         verse — feels like a shared opening shloka)
       - Rotation: 7 curated "duty" verses from chapters 2, 3, 4, 6, 18
       - Wire into DashboardPage Citation card AND the welcome email
         template (#2) so both pull the same daily verse

  6. feat(team+inbox+activity+approvals): editorial pages
       - Edit: pages/TeamsPage.js, InboxPage.jsx, ActivityFeedPage.jsx,
         ApprovalsPage.jsx
       - Reference: prototype/src/screens.jsx (ScreenTeam),
         prototype/src/app.jsx (ScreenInbox), prototype/src/screens-2.jsx
         (ScreenActivity, ScreenApprovals)

  7. feat(reports+templates+automations+categories+admin): editorial pages
       - Edit: pages/TimeReportPage.jsx, TemplatesPage.jsx,
         AutomationsPage.jsx, CategoriesPage.jsx, AdminPage.jsx,
         NotificationsSettingsPage.js
       - Reference: prototype/src/screens-2.jsx

  8. feat(client-portal): collaborative client surface + request workflow
       - Edit: pages/ClientProjectsPage.jsx, ClientBoardPage.jsx,
         ClientPagesImpl.jsx, ApprovalsPage.jsx
       - Edit: components/views/KanbanView.jsx (add `requested` column
         for admins/owners)
       - READ design_handoff_kartavya_v2/CLIENT_PORTAL_NOTES.md FIRST.
       - Clients become FULL collaborators (can comment, attach files,
         create task requests). Their new tasks land in `requested`
         status until approved by admin/owner.
       - Coordinate with backend on the STATUS enum addition and the
         `POST /api/tasks` role gate (see CLIENT_PORTAL_NOTES.md §3).

  9. feat(emails): 5 transactional templates
       - HANDOFF: backend/email_service.py
       - READ design_handoff_kartavya_v2/prototype/emails/README.md
       - Open Email System.html for the visual reference
       - Convert each email to table-based HTML with premailer for
         Outlook compatibility, register with AWS SES
       - Templates: invite, welcome, approval-request, approved, task-done

 10. feat(approve): public magic-link approval landing page
       - New: frontend/src/pages/ApprovePage.jsx
       - Edit: App.js (add `/approve` route as PUBLIC — no <Protected>)
       - Reference: prototype/emails/Email System.html → ApproveScreen
       - Validates JWT via GET /api/approvals/by-token/:token, renders
         the editorial approval card, two big buttons
       - Coordinate with backend on token endpoints (verify, approve, reject)

After all 10 commits land — run a FULL END-TO-END TEST with REAL DATA:

  11. Seed Supabase with realistic Indian-context data
       - Use backend/seed.py as the starting point. If it points at
         Railway Postgres, swap the DATABASE_URL to the Supabase project
         (env var only — do not commit secrets).
       - Seed at minimum:
           - 1 workspace ("Aekam Inc")
           - 5 real users: 1 admin (Keval), 2 members (Aanya, Vikram),
             2 clients (Arjun @ Tata Steel, Priya @ Saraswati Co.)
           - 5 projects matching prototype/src/data.jsx (Quarterly GST
             filing, Diwali campaign, Bengaluru office fit-out, Vendor
             onboarding v2, Mumbai client review)
           - 13 tasks across the 5 projects, distributed across all 5
             status columns (requested / todo / in_progress / in_review / done)
           - 2 pending approvals (1 task-request from Arjun, 1 work
             approval from Vikram)
           - 6 activity events
           - 4 notifications in the inbox (1 mention, 1 assign, 1 approval, 1 done)
       - Use REAL email addresses for the 5 users so AWS SES actually
         delivers — own all five or use plus-addressing
         (you+admin@yourdomain.com, you+aanya@yourdomain.com, etc.).
       - Verify the SES domain is verified and out of the sandbox before
         seeding.

  12. Smoke test the full flow with the seeded data
       - Sign in as admin → /dashboard renders all 4 stat tiles with
         real numbers; "My tasks today" lists 2+ tasks; recent activity
         shows 6 events; project status stack bar adds to 100%.
       - Click into a task → drawer opens with real comments, files,
         activity. Add a comment → toast → comment appears in thread.
       - /tasks → table view groups by priority, all 13 tasks visible.
       - /projects/:id → kanban shows 4 columns (5 for admin: requested
         visible). Drag a card → backend confirms update. Cards show real
         avatars, due chips with correct urgency colors, project tags.
       - /approvals → 2 tabs (Task requests, Work approvals), each with
         the right count. Click Approve on a task-request → task moves
         to To do AND the seeded client receives email #4 (Approved) in
         their real inbox.
       - Sign out, sign in as Arjun (client) → /client → "+ New request"
         button visible. Submit a new request → toast → request appears
         in "My requests" with status Requested.
       - Switch to admin's email inbox → email #3 (Approval request)
         actually arrived. Click "Approve & queue" link → /approve page
         opens in browser → click big Approve button → success state →
         seeded client receives email #4 in their real inbox.
       - Switch to a member account → mark a task done → seeded client
         receives email #5 (Task done) in their real inbox.
       - Invite a brand-new email address → email #1 (Invite) actually
         arrives → click Accept → land on /accept-invite → set password
         → /dashboard renders → email #2 (Welcome) actually arrives.
       - All five emails render correctly on Gmail Android, Gmail iOS,
         iOS Mail (iOS 17), and Outlook mobile per the mobile-compat
         matrix in design_handoff_kartavya_v2/prototype/emails/README.md.
       - ATTACHMENT + R2 TEST (see ATTACHMENTS_AND_STORAGE.md §2):
         · Flip STORAGE_BACKEND from inline to s3 with R2 endpoint vars
         · Verify is_object_storage() returns True at startup
         · Run the full U1–U10 upload test matrix (drawer Files tab,
           comments paperclip, new-task modal, client request modal,
           >5MB rejection, signed URL download, Devanagari filename,
           CORS, delete-after-removed)
         · Confirm attachment names show up in emails #3 and #5 (listed,
           never embedded — open task to download)
       - VERSE-OF-THE-DAY TEST:
         · GET /api/verse-of-the-day returns Sanskrit + Hindi + English
           + ref; same value all calendar day
         · Dashboard Citation card shows today's verse
         · Welcome email shows the same verse on the same day

  Document every issue found during the smoke test in a single PR
  comment or follow-up issue. Do not ship to production until every
  email rendered correctly on at least 3 of the 5 target clients AND
  the full create-request → approve → done loop worked with real
  Supabase data and real SES delivery.

Rules for every commit:

  - One PR per commit. Commit message format is in the README.
  - Do NOT change anything in backend/ or mobile/.
  - Do NOT add new API endpoints. Use the ones in pages/README.md.
  - Do NOT delete LoginPage.js, ClientPortal.jsx, ClientPortalPage.jsx,
    LoginPageStandalone.js — they're marked safe-to-delete but in a
    separate PR, not this one.
  - After each commit, run `npm start`, screenshot the changed routes,
    and diff against the matching prototype screen. ±4px is fine. Bigger
    diffs need fixing before the next commit.
  - Run `npm run build` after every commit. No new warnings.

Start with commit 1. After it lands and `npm start` works, screenshot
/dashboard and confirm nothing has visually changed yet (tokens are
present but unused). Then continue to commit 2.

If anything in the design spec is ambiguous, ask before guessing.
```

---

## Follow-up: Reports system

After all commits above are merged and the smoke test passes, continue
with `design_handoff_kartavya_v2/REPORTS_ADDENDUM.md` — adds 3 automated
email reports (daily/weekly/monthly), an in-app Generate Report page,
and a 5-page editorial PDF export. It's an additive set of 7 commits
(R1–R7) and depends on the attachments + email infra from the main
commits being live.

## After Claude Code finishes

1. Run all E2E tests: `npm test` and `pytest` for backend (sanity — backend
   shouldn't be touched).
2. Lighthouse audit on `/dashboard` and `/tasks` — accessibility ≥ 92.
3. Manual smoke test as **admin**, **member**, and **client** roles — but
   this is covered by the seeded-data smoke test in step 12 of the prompt.
   The seeded test is the real acceptance gate; just verify it passed.
4. Vercel preview deploy from the PR before merging to `main`.
5. SES sender domain — verify `kartavya.app` (or the chosen sender domain)
   is out of the SES sandbox before step 12. Domain stays sandboxed by
   default and won't deliver to non-verified addresses.
