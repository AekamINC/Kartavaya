# Client Portal — Collaboration + Request/Approval Flow

**Replaces the earlier "read-only" version of this doc.** The client portal
is a **full collaborator surface** with one extra constraint: any *new* task
created by a client lands in a **Requested** state and must be approved by a
project owner or workspace admin before the team starts work.

---

## Mental model

A client is a **member with a flag**. They can:

- View the projects they're tagged into
- Open tasks, read everything, comment, attach files
- **Create new task requests** (these enter `status = requested`, not `todo`)
- See the status of their own requests
- Approve completed work (existing approval flow)
- Get email notifications: invited, welcomed, request submitted, request
  approved/rejected, task done

A client **cannot**:

- Move someone else's task across columns (no drag on tasks they don't own)
- Delete tasks
- Edit task assignees (still admin/owner only)
- See internal projects (the team-only projects that don't have a client tag)

The line between "member" and "client" is now thin and explicit — it's
**one boolean field on the user row** plus **one extra column value
(`requested`) on the task status enum**.

---

## What changes vs. internal app

| Concern | Internal user (admin/member) | Client |
|---|---|---|
| Can create tasks | Yes → lands in `todo` | Yes → lands in `requested` |
| Drag own tasks across columns | Yes | Yes (their own only) |
| Drag any task | Yes (admin) / project tasks (member) | No (unless they created it AND it's not yet `in_progress`) |
| Approve requests | Yes (admin + project owners) | No |
| View internal-only projects | Yes | No |
| Edit assignees | Admin only | No |
| Comment, attach files, @mention | Yes | Yes |
| Receive email: invited / welcome | When invited | When invited |
| Receive email: request submitted ack | — | When they create a request |
| Receive email: approved / rejected | — | Yes |
| Receive email: task done | When task they own is closed | When task they requested is closed |

---

## Status enum change

```python
# backend — was:
STATUS = ["todo", "in_progress", "in_review", "done"]

# becomes:
STATUS = ["requested", "todo", "in_progress", "in_review", "done"]
#         ^ NEW — only enterable when created by a client OR
#                 forced by an admin during triage
```

`requested` is its own Kanban column. Visual: dashed border, slate color
(`#94a3b8`), label "Requested" with Devanagari "अनुरोध". Admins see it as
the leftmost column on the board; clients see it as a row in their own
"My requests" list.

**On the live API** — no new endpoints, but `POST /api/tasks` now sets
`status = "requested"` when the caller's role is `client`. Admin actions:

```
POST /api/tasks/:id/approve      → status: requested → todo, emails client
POST /api/tasks/:id/reject       → status: requested → rejected (soft delete), emails client
POST /api/tasks/:id/complete     → status: in_review|todo → done, emails client (if requested by one)
```

The approval flow uses **the same `approvals_router.py`** that already
handles work approvals — extend it to handle "task-request approvals"
with a `kind = "task_request"` discriminator.

---

## Client UI — what the pages render

### `/client` and `/client/projects` → `ClientProjectsPage.jsx`

```
<PageHeader kicker="WORK" title="Projects" sanskrit="परियोजनाएँ"
            lede="Projects you're collaborating on with the team."
            right={<Button primary onClick={openNewRequest}>+ New request</Button>}/>

<StatRow>
  <StatTile variant="blue"  label="OPEN REQUESTS"  value={openRequests.length}
            sub="awaiting team approval"/>
  <StatTile variant="teal"  label="IN PROGRESS"    value={activeTasks.length}
            sub="across all projects"/>
  <StatTile variant="amber" label="AWAITING YOUR APPROVAL"
            value={pendingClientApprovals.length} sub="work to review"/>
  <StatTile variant="ok"    label="DONE THIS WEEK" value={doneThisWeek.length}
            sub="completed for you"/>
</StatRow>

<Card title="My requests" sanskrit="मेरे अनुरोध">
  <RequestList rows={myRequests}/>
  {/* each row: title, project, status badge (requested/approved/rejected),
      created at, last activity. Click → opens task drawer. */}
</Card>

<div className="k-pgrid">{clientProjects.map(p => <PCard …/>)}</div>
```

### `/client/project/:projectId` → `ClientBoardPage.jsx`

Same Kanban layout as the admin/member board (`ProjectBoardPage`), with:

- A **Requested** column on the far left (only visible to clients on this
  project view + to admins/owners)
- "+ Add task" button under the Requested column for the client
- Cards in the Requested column show a small "AWAITING APPROVAL" pill in
  the top-right
- Clients can drag **their own** Requested-state cards (e.g. to clarify
  before approval) but **cannot** drag any card out of Requested — only an
  admin's Approve action can do that
- All other columns: same as internal (read, comment, attach), but drag
  permission tied to `task.created_by === currentUser.id`

### Task drawer — client-side

All four tabs visible: **Details · Comments · Files · Activity.** Activity
shows only events the client is allowed to see (their own actions, status
changes on tasks they requested, comments on tasks they can read). The
backend already does this filtering — surface it as-is.

---

## Admin/owner UI — the approval surface

### `/approvals` → `ApprovalsPage.jsx` (already exists; extend, don't replace)

The existing approvals page now has **two filter tabs** at the top:

```
[ Task requests (5) ] [ Work approvals (3) ]
```

Both tabs use the same `<ApprovalRow>` editorial component. **Task request**
rows show the requester's avatar, the project tag, the proposed task title,
the requester's notes (if any), and two buttons: **Approve** (moves the task
to `todo`, emails the client) and **Decline** (asks for a reason in a small
dialog, emails the client with the reason).

```
<PageHeader kicker="REVIEW" title="Approvals" sanskrit="अनुमोदन"
            lede="Client requests and finished-work sign-offs waiting on you."/>

<Tabs active={tab} onChange={setTab}>
  <Tab id="requests" count={requests.length}>Task requests <Sans>अनुरोध</Sans></Tab>
  <Tab id="work"     count={work.length}>Work approvals <Sans>कार्य</Sans></Tab>
</Tabs>

<Card title={tab === 'requests' ? 'Pending requests' : 'Pending work approvals'}>
  {(tab === 'requests' ? requests : work).map(a => (
    <ApprovalRow item={a} kind={tab}
                 onApprove={handleApprove}
                 onReject={handleReject}/>
  ))}
</Card>
```

Existing `approvals_router.py` already supports the `kind` discriminator;
the only frontend change is the tab UI and the row variant.

---

## Email approval (out-of-band)

Every approval email contains a magic link:

```
https://kartavya.app/approve?token={signed_jwt}
```

The token is a **single-use JWT** signed by the backend, embeds the
approval ID + the approver's user ID + a 7-day expiry. Clicking the link
opens a **dedicated approval landing page** at `/approve` (public route, no
shell, no sidebar). The page:

- Validates the token (server-side via `GET /api/approvals/by-token/:token`)
- Renders the editorial approval card with the request details
- Shows two big buttons: **Approve** and **Decline**
- On Approve → `POST /api/approvals/by-token/:token/approve` → success state
- On Decline → reveals a reason textarea → `POST /api/approvals/by-token/:token/reject`
- If token is invalid / expired / already used → friendly error state
  with a "Sign in to Kartavya" CTA

**Why magic links instead of forcing login:** admins approve from their
phone email app constantly. Forcing login adds friction. The token is
single-use, signed, expiring — same security profile as a password reset
link, which the app already implements.

The full design for `/approve` is in `prototype/email-approval-screen.html`.

---

## Backend touch points (out of scope but listed for awareness)

These are the backend changes that this redesign assumes. They are NOT
part of the frontend handoff but the frontend will not function without
them — flag this to the backend owner before commit 8 starts.

| File | Change |
|---|---|
| `backend/server.py` | Add `requested` to STATUS enum; gate `POST /api/tasks` to set status from role |
| `backend/approvals_router.py` | Add `kind = "task_request"` rows; magic-link token gen + verify endpoints |
| `backend/email_service.py` | Add the 5 new email templates (see `prototype/emails/`) |
| `backend/migrations/` | New migration: `add_requested_status_and_token_approvals.sql` |

---

## Acceptance for commit 8

1. Sign in as **client** → hit `/client` → editorial layout, stat tiles,
   "My requests" card, project grid.
2. Click "+ New request" → modal opens (same NewTaskModal chrome, just
   labeled "New request") → submit → toast confirms → request appears in
   "My requests" with status "Requested" → email arrives in inbox.
3. Sign in as **admin** in another tab → `/approvals` → "Task requests" tab
   shows the new request → click Approve → toast → request moves to `todo`
   on the project board → client receives "Approved" email.
4. Click the **Approve** link in the email (admin's inbox) → lands on
   `/approve?token=...` → editorial landing page → big Approve button works
   without a separate login.
5. Mark a task done that was created by a client → client gets "Task done"
   email.
6. All existing internal-app E2E tests still pass.
7. Lighthouse on `/approve` (the public landing) ≥ 95 — it's a single,
   server-rendered card; should score near-perfect.
