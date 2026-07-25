# Client Portal

## Prerequisites
- `00-tokens.md`, `02-common-components.md`
- `08-rbac-screens.md` — the client role and what it may never see
- `13-module-pages.md` — Hub owns the share boundary

## Files to modify
- `frontend/src/pages/ClientPagesImpl.jsx` — the real implementation; restyle onto tokens
- `frontend/src/components/layout/AppShell.jsx` — must not render the module sidebar for a client
- `frontend/src/App.jsx` — retire `/client/legacy`

## Files to create
- `frontend/src/components/layout/ClientShell.jsx`
- `frontend/src/pages/client/ClientHome.jsx`, `ClientProject.jsx`, `ClientApprovals.jsx`, `ClientFiles.jsx`

## Files to delete
- `frontend/src/pages/ClientPortalPage.jsx` — `pages/README.md` marks it *"unused — safe to delete"*
- `frontend/src/pages/ClientPages.jsx` — a re-export barrel over `ClientPagesImpl.jsx`, keep only if the lazy split needs it

## Estimated scope
- 5 new files, 3 modified, 1–2 deleted.

---

## There are two client portals

```
/client/project/:projectId  → ClientBoardPage → ClientPagesImpl.ClientProjectBoardPage
/client/legacy              → ClientPortal    → ClientPagesImpl.ClientPortal
```

`ClientPagesImpl.jsx` line 582 labels the second one in its own source: **"ClientPortal (legacy dark portal)"**. So the product currently ships two different client-facing surfaces, one of which is a dark theme from an earlier design era.

That is a **fourth token vocabulary**, after the `k-*` design CSS, the Tailwind classes, and the `--ink`/`--rule` set in the drawer. `14-dark-mode.md` counts three; the legacy portal makes four.

**Retire `/client/legacy`.** Not restyle — retire. A client who lands on it sees a different product from the one their accountant is describing to them on the phone, and every hour spent restyling a surface marked legacy is an hour spent twice.

## This is the only surface a stranger uses

Everyone else in the product had onboarding, a colleague to ask, and a reason to persist. A client is a CA firm's customer who received a link, has no account expectations, and is one confusing screen away from replying "just email me the PDF instead". The portal's job is not to be feature-complete — it is to make a single decision easy.

## What a client must never see

From `08-rbac-screens.md`, enforced at the serializer and not in the component:

- Internal comments. Only comments explicitly marked client-visible.
- Time entries, hourly rates, and anything derived from them.
- Platform cost, margin, credit consumption.
- Other clients — including in an assignee picker, a mention autocomplete, or an error message.
- The module sidebar. A client has no modules.
- Team member emails and phone numbers beyond the single named contact.
- Task IDs that reveal volume. `#{task_id.slice(-6)}` is fine; a sequential integer tells them how many customers the firm has.

The failure mode is a well-meaning `GET /api/client/tasks` that returns the full task object and lets the component pick fields. Then one `{JSON.stringify(task)}` in a debug branch, or one new field rendered by a shared component, leaks it. **The endpoint returns a client shape, or this will leak eventually.**

## Shell

No sidebar. The firm's brand, not ours.

```
ClientShell
├── header  (firm logo from /v1/org/profile · project name · client name · sign out)
├── nav     (Overview · Approvals ● 2 · Files — three items, horizontal, no icons)
└── <Outlet />
```

```css
.cl-shell{min-height:100vh;background:var(--bg);display:flex;flex-direction:column}
.cl-head{display:flex;align-items:center;gap:var(--sp-4);padding:var(--sp-4) var(--pad-page);border-bottom:1px solid var(--outline-variant);background:var(--surface)}
.cl-head__logo{height:30px;width:auto}
.cl-head__firm{font-family:var(--font-display);font-size:var(--t-title);letter-spacing:-.02em}
.cl-nav{display:flex;gap:var(--sp-1);padding:0 var(--pad-page);border-bottom:1px solid var(--outline-variant);background:var(--surface)}
.cl-nav a{padding:12px 16px;font-size:var(--t-body);color:var(--on-surface-3);border-bottom:2px solid transparent;text-decoration:none}
.cl-nav a[aria-current="page"]{color:var(--on-surface);border-bottom-color:var(--primary)}
.cl-main{flex:1;padding:var(--pad-page);max-width:1040px;width:100%;margin:0 auto}
```

The firm's logo comes from `/v1/org/profile`. When it is unset the portal shows the firm's **name in `--font-display`**, never a Kartavaya mark — the client's relationship is with their accountant, and `18-documents.md` uses the same rule for the same reason.

## Approvals — the one screen that matters

Everything else is reference. This is the screen the portal exists for.

```
ClientApprovals
├── ApprovalCard  (one per pending item)
│   ├── what is being approved   — task title, --t-title-lg, --font-display
│   ├── who asked and when       — "Aanya Mehta · 2 days ago"
│   ├── what to look at          — attachments, inline preview for images and PDFs
│   ├── the ask                  — the requester's note, verbatim, in a quote block
│   └── actions: Approve · Request changes
└── EmptyState  ("Nothing needs your approval" — a real answer, not a blank panel)
```

**Approve is one click with no confirm.** The client already read the thing. A confirm dialog on a positive action teaches them to click through dialogs, which is exactly the habit you do not want when a destructive one appears.

**Request changes requires a note.** Submit stays disabled until there is text, and the disabled button says why. A bare rejection sends the firm back to a client conversation to ask what was wrong — which is the work the portal was supposed to remove.

```css
.cl-appr{padding:var(--pad-card);border:1px solid var(--outline-variant);border-radius:var(--r-lg);background:var(--surface);box-shadow:var(--shadow-1)}
.cl-appr__ask{margin:var(--sp-4) 0;padding:var(--sp-3) var(--sp-4);border-left:2px solid var(--outline);background:var(--s-low);border-radius:0 var(--r-sm) var(--r-sm) 0;font-size:var(--t-body);line-height:var(--line-height-base);color:var(--on-surface-2)}
.cl-appr__act{display:flex;gap:var(--sp-3);margin-top:var(--sp-5)}
```

Both actions produce a **written record with a timestamp** in the client's own view, not just a toast. Six weeks later the question is "did I approve that?", and the answer needs to be on screen — `aria-live="polite"` on the outcome region so it is also announced.

## Overview

Three things, in this order: what needs you (count, linking to Approvals), what is in progress (title, status, expected date), what is done (collapsed by default).

**No kanban, no assignees, no internal status vocabulary.** `in_review` means nothing to a client. Map the six statuses to three: *With us* · *With you* · *Done*. The mapping lives in the serializer, so the portal cannot drift from it.

## Files

Only attachments marked client-visible. `13-module-pages.md` records Hub's rule — task boards and time entries are **off by default** and the never-shared list is enforced in the API, not the UI. Same list applies here.

Each file shows name, size, who shared it, when. Download, no delete. A client deleting the firm's working file is not a feature.

## Endpoints

```
GET  /api/client/tasks           exists — must return a CLIENT SHAPE, not the full task
GET  /api/client/approvals       exists
POST /api/client/approvals/:id/approve         { note? }
POST /api/client/approvals/:id/request-changes { note }   note REQUIRED, 400 without
GET  /api/client/files
GET  /api/client/files/:id/download
GET  /v1/org/profile             already exists — logo, firm name, contact
```

The two `POST`s are new. Both write to the audit log and notify the requester — `21-notifications-inbox.md` carries the notification kinds.

## Mobile

The portal is more likely to be opened on a phone than any other surface in the product — a client taps a link in an email. Single column throughout, actions full-width and stacked, `44px` minimum targets, and the approval note field at `16px` so iOS Safari does not zoom the viewport on focus (`15-mobile-web.md`).
