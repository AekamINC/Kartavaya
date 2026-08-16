# Kartavya Mobile — Implementation Handoff for Claude Code

**Audience:** the next AI/human engineer building the production React Native (Expo) app.
**Source of truth for design:** `Kartavya Mobile.html` in this design project — open it to see every screen rendered in light + dark for both platforms.
**Source of truth for data + APIs:** [`kevalvshah/Kartavya`](https://github.com/kevalvshah/Kartavya) on `main` — backend is FastAPI + Postgres, mobile is Expo / React Native in `mobile/`.

---

## 1. Scope

The mobile app is a **work-on-the-go companion**, not a full admin/setup tool. Setup, reporting, automations, time tracking, and project/team management stay on desktop.

### Shipping in v1 (mobile)
- **Login** — invite-only email + password (matches `apiLogin` in `mobile/src/api.js`)
- **Today** — list of tasks the signed-in user owns, is assigned to, or has been mentioned in
- **Boards** — kanban view of any project they have access to, with 4 view modes: **Board · List · Schedule · Tracker** (these already exist in `mobile/src/screens/BoardScreen.js`)
- **Task detail** — full lifecycle: status change, comments (with edit/delete own, @mentions), subtask CRUD, file upload, approval workflow
- **Project switcher** — one-tap from the board header → bottom sheet of all visible projects
- **Inbox** — mentions, comments, approval requests + outcomes
- **Settings** — account, permissions, offline sync, reset cache, sign out
- **Offline-first** — read everything cached; mutations queue and sync with a banner showing count + retry
- **Theme** — System / Light / Dark
- **App icon** — Devanagari **क** on the brand gradient (see `mobile/app-icon.jsx` for construction spec)

### Explicitly NOT in mobile v1
- ❌ Invite user / create team / create project
- ❌ Templates, automations, dashboards, reports, time reports
- ❌ Admin screens (manage members, columns, custom fields)
- ❌ Multi-workspace switching (single org per install — workspace context comes from `/api/auth/me`)

---

## 2. Information architecture

```
LoginScreen                              ← unauthenticated entry
└── App (5-tab bottom nav, unified iOS + Android)
    ├── Today          (default tab)
    ├── Boards         (project switcher in header)
    │   ├── Board view
    │   ├── List view
    │   ├── Schedule view
    │   └── Tracker view
    ├── + (Create task, center button — full-screen sheet)
    ├── Inbox          (mentions / comments / approvals / all)
    └── Me
        └── Settings
```

**Task detail** opens as a full-screen route from any tab — back navigates to wherever the user came from.

**Project switcher** is a bottom sheet, not a route. Opens from the project chip in the board header.

---

## 3. Visual language

| Token | iOS 18+ | Android 14+ (M3 Expressive) |
|---|---|---|
| Background light | `#F2F2F7` | `#F2F2F7` (matches iOS — neutral gray) |
| Background dark  | `#000`    | `#0f1411` |
| Primary accent   | `#05b7aa` (teal) | `#006A60` light / `#83D5C6` dark |
| Gradient (CTAs)  | `linear-gradient(135deg, #0082c6, #05b7aa)` | same |
| Headline serif   | Newsreader (system serif fallback) | Newsreader (Roboto fallback) |
| UI font          | SF Pro (system) | Roboto / Roboto Flex |
| Devanagari       | Tiro Devanagari Hindi (for project subtitles + section labels) | same |
| Mono             | SF Mono / ui-monospace | JetBrains Mono / ui-monospace |
| Bottom nav       | translucent, 5 tabs with center gradient "+" | matches iOS structure — solid M3 surface, same 5-tab layout |
| Corner radii     | 14–22 (variable) | 16–28 (M3 Expressive — varied) |
| FAB              | none — center "+" handles new-task | same (no separate FAB on Android) |

Bottom nav structure is **identical on both platforms**: Today · Boards · + · Inbox · Me. The "+" is a gradient pill, not a tab.

Brand element: every section header has a small **Devanagari subtitle** under the English label — e.g. "Today · आज", "Approval · अनुमोदन". This is Kartavya's voice and must be preserved.

---

## 4. Real data wiring

The design canvas uses mock data in `mobile/mobile-shared.jsx`. Everything **except UI labels** must be replaced with live API responses. Labels (e.g. "Approval", "Approve & advance", section headers, the Sanskrit/Devanagari subtitles) stay hardcoded.

### Auth

| UI | Endpoint | Notes |
|---|---|---|
| `LoginScreen` submit | `POST /api/auth/login` via `apiLogin(email, password)` in `mobile/src/api.js` | Sets httpOnly JWT cookie + persists user in `AsyncStorage`. |
| Header avatar/name everywhere | `GET /api/auth/me` | Cache in a `useAuth()` hook context. |
| Settings sign out | `POST /api/auth/logout` via `apiLogout()` | Then clear AsyncStorage + navigation reset to LoginScreen. |

### Projects

| UI | Endpoint | Notes |
|---|---|---|
| Project switcher list | `GET /api/teams` | Returns `{team_id, name, task_count, done_count}` per project. Sort by `updated_at DESC`. |
| Project switcher → board | `GET /api/projects/{team_id}/columns` + `GET /api/tasks?team_id=...` | Fetched in parallel. |
| Project chip in board header | `team` object from `/api/teams` | Show `team.name` + a colour dot — colour is derived from `team_id` hash for now (the schema doesn't store a project colour). |

### Tasks

| UI | Endpoint | Notes |
|---|---|---|
| Today list | `GET /api/tasks?assigned_to_me=true&due_in=7d` (or compose client-side from `GET /api/tasks`) | Group by Due today / This week / Mentions. |
| Board cards in a column | `GET /api/tasks?team_id=...` | Group by `task.column_id` client-side. |
| Create task | `POST /api/tasks` | Body shape matches `TaskCreate` in `backend/server.py`. |
| Edit task | `PATCH /api/tasks/{task_id}` | Use for any field change. |
| Move task between columns | `PATCH /api/tasks/{task_id}/move` body `{column_id, order}` | Same endpoint `BoardScreen.js` already uses. |
| Delete task | `DELETE /api/tasks/{task_id}` | |

### Subtasks (full CRUD)

Schema: `{ subtask_id, title, is_done, order }` — stored as JSONB on the task.

| UI | Endpoint |
|---|---|
| Add subtask row | `POST /api/tasks/{task_id}/subtasks` body `{title}` |
| Toggle checkbox | `PATCH /api/tasks/{task_id}/subtasks/{subtask_id}` |
| Three-dot delete | `DELETE /api/tasks/{task_id}/subtasks/{subtask_id}` |
| Progress bar | derived: `subtasks.filter(s => s.is_done).length / subtasks.length` |

### Comments (with edit / delete own)

| UI | Endpoint | Notes |
|---|---|---|
| Comments tab | `GET /api/tasks/{task_id}/comments` | Returns `{comment_id, user_id, user_name, body, created_at}`. |
| Send composer | `POST /api/tasks/{task_id}/comments` | Backend handles @mention parsing + notifications. |
| Edit (own only) | `PUT /api/tasks/{task_id}/comments/{comment_id}` | 403 if not own (admins can edit any). |
| Delete (own only) | `DELETE /api/tasks/{task_id}/comments/{comment_id}` | Same auth rule. |
| @mention autocomplete | `GET /api/teams/{team_id}/members` | Trigger on `@`. |

**UI rule:** show the three-dot menu and the Edit / Delete inline actions **only when `comment.user_id === currentUser.user_id`** (or current user has `role === 'admin'`). Otherwise the comment is read-only. The "YOU" badge appears on your own comments.

### File upload

| UI | Endpoint | Notes |
|---|---|---|
| + button → Attach / Camera / Voice | `POST /api/upload` (Cloudflare R2) → returns `{name, url, key}` | Use `expo-image-picker` for Camera / Photos, `expo-document-picker` for Files, `expo-av` for Voice. |
| Attach to task | `PATCH /api/tasks/{task_id}` body `{attachments: [...existing, newAttachment]}` | |

### Approval workflow

Three states: `pending` (awaiting owner), `pending_client` (awaiting external client), `approved`, `rejected`, or `null`.

| Action | Endpoint | Trigger |
|---|---|---|
| Member moves card to "Approval" column | `PATCH /api/tasks/{task_id}/move {column_id: <approval_column>}` | Backend automatically sets `approval_status='pending'` + notifies owner. |
| Owner taps **Approve & advance** | `POST /api/approvals/task_approval::{task_id}/review {status: 'approved'}` | Moves task to first `is_done=true` column. |
| Owner taps **⋯ → Request changes** | `POST /api/approvals/task_approval::{task_id}/review {status: 'rejected', notes}` | Notes required. |
| Owner taps **Or send to client** | `POST /api/approvals/task_approval::{task_id}/review {status: 'approved', send_to_client: true, client_email}` | Sets `approval_status='pending_client'`, sends magic-link email to client. |
| Client approves (via app) | `POST /api/approvals/task_approval::{task_id}/review {status: 'approved'}` while signed in as client | Client must be linked to task via `task_clients` table. |

Approval banner on task detail must distinguish the three POVs:
1. **Owner viewing** a task where someone requested their approval → show approve/reject actions.
2. **Member viewing** a task they sent for approval → show "Awaiting Keval's approval — sent 1h ago" (read-only).
3. **Client viewing** a task in `pending_client` → show approve/request-changes actions.

Pull `currentUser.user_id`, `task.approval.decisionBy`, `task.approval.requestedBy` + `task.approval_status` to switch.

### Inbox / notifications

The mobile app subscribes to **every task event** in projects the user is assigned to. Pushes are gated by **per-kind preferences** the user controls in Settings → Notifications.

#### Event taxonomy

| Kind | Trigger (backend) | Default push | Recipients |
|---|---|---|---|
| `mention`          | `@user` parsed from comment body in `services/mentions.py` | **Always** | the mentioned user |
| `approval_request` | task moves into Approval column → `approval_status='pending'` | **Always** | project owner(s) |
| `approved`         | `POST /api/approvals/.../review {status: 'approved'}` | **Always** | task creator |
| `rejected`         | `POST /api/approvals/.../review {status: 'rejected'}` | **Always** | task creator |
| `assigned`         | `assignee_user_ids` change includes a new user | **Always** | the newly assigned user |
| `comment`          | new `task_comments` row | Push only if you're the creator, an assignee, or a watcher | creator + assignees + watchers + clients on task |
| `status_changed`   | `column_id` changes (any task in your project) | Push for any task in your project | project members |
| `done`             | `column_id` moves to an `is_done=true` column | Push for any task in your project | project members |
| `created`          | new `tasks` row in a project you're assigned to | **In-app only** by default — opt in to push | project members |

Backend implementation lives in `backend/services/activity_logger.py` (writes `activity_events` rows) and `backend/services/mentions.py` (handles @ parsing). Add an emitter to each mutation route in `backend/server.py` and `backend/approvals_router.py` — most of these already write notifications via `create_notification(...)`; extend that helper to also push to APNs/FCM when the recipient has push enabled for that kind.

#### Endpoints

| UI | Endpoint |
|---|---|
| Inbox list | `GET /api/notifications` — return last 100, paginate older. |
| Filter chips (All / Mentions / Approvals / Status / Comments) | client-side filter on `kind` field, or `GET /api/notifications?kind=...` |
| Unread badge | `GET /api/notifications/unread_count` |
| Mark read on tap | `POST /api/notifications/mark_read {notification_ids}` |
| Mark all read | `POST /api/notifications/mark_read {mark_all: true}` |
| Read per-kind push prefs | `GET /api/me/notification_prefs` → `{[kind]: 'always' | 'mine_only' | 'project' | 'off'}` |
| Update prefs | `PUT /api/me/notification_prefs` |
| Register push token | `POST /api/me/push_tokens` body `{platform, token, device_id}` |
| Unregister on sign-out | `DELETE /api/me/push_tokens/{device_id}` |

#### Push delivery rules (server side)

Before fanning out, gate every push through this matrix:

```python
def should_push(user, kind, task, actor):
    if actor == user: return False                  # never notify yourself
    pref = user.notification_prefs.get(kind, 'always')
    if pref == 'off':       return False
    if pref == 'always':    return True
    if pref == 'mine_only':
        return user in (task.creator, *task.assignees)
    if pref == 'project':
        return user in task.project.members
    return False
```

#### Push payload

```json
{
  "notification_id": "notif_…",
  "kind": "approval_request",
  "title": "Vikram requested your approval",
  "body": "Electrical contractor — site visit",
  "task_id": "KAR-301",
  "team_id": "team_…",
  "actor_id": "u5",
  "deep_link": "kartavya://task/KAR-301",
  "priority": "urgent"     // 'urgent' raises iOS interruption level + Android importance
}
```

On tap → deep link to TaskDetailScreen with the right `task_id`. Use `expo-notifications` `addNotificationResponseReceivedListener` + `Linking.openURL`.

#### Quiet hours + batching (recommended)

- Default quiet hours: 22:00–07:00 IST. Pushes inside that window queue + batch into a single "X updates while you were away" digest at the next wake.
- Batch low-urgency kinds (`status_changed`, `created`, `done`) into rolling 10-minute windows per project to avoid floods.
- `mention` and `approval_request` always break through quiet hours + batching.

---

## 5. Offline-first

The repo's mobile app today does **not** queue offline writes. v1 must:

1. **Cache everything read** in MMKV (or AsyncStorage) keyed by endpoint + params.
2. **Queue mutations** when offline: push `{method, url, body, optimistic_id}` to a queue table.
3. **Optimistic UI:** on every mutation, write the predicted result to the cache immediately, render with a small `syncing` indicator.
4. **Reconcile on reconnect:** flush queue oldest-first, replace optimistic IDs with server IDs.
5. **Surface state in the UI:**
   - Banner on Today: `Offline · 3 changes queued [Retry]`
   - Per-card sync icon when that record has a pending mutation
   - Settings → Sync status row shows queue count + "Last synced" timestamp
6. **Settings → Reset app data** clears the cache + queue but **does not touch the server** — the copy in the UI already says so.

**Recommended:** TanStack Query with a persisted client (`@tanstack/react-query-persist-client` + MMKV). Add a custom mutation cache that survives reloads.

---

## 6. Permissions

| Permission | When to request | API |
|---|---|---|
| Notifications | After first sign-in, with a soft-ask sheet ("Stay in the loop — we'll only push the urgent stuff.") | `expo-notifications` |
| Camera | First tap on Camera in the create-task sheet | `expo-image-picker` |
| Microphone | First tap on Voice | `expo-av` |
| Photos / Files | First tap on Attach | `expo-image-picker` / `expo-document-picker` |

Settings → Permissions section shows current state per permission and, on tap, deep-links to OS Settings (`Linking.openSettings()`). Status text must reflect actual `getPermissionsAsync()` results, not a stored flag.

---

## 7. File / folder layout (proposed)

```
mobile/
├── App.tsx                              # auth gate + nav root
├── src/
│   ├── api/
│   │   ├── client.ts                    # axios instance + interceptors
│   │   ├── auth.ts, tasks.ts, projects.ts, comments.ts,
│   │   ├── subtasks.ts, approvals.ts, notifications.ts, uploads.ts
│   │   └── types.ts                     # shared TS types matching backend models
│   ├── hooks/
│   │   ├── useAuth.ts, useTasks.ts, useTask.ts,
│   │   ├── useProjects.ts, useComments.ts, useNotifications.ts,
│   │   ├── useOffline.ts, usePermissions.ts, useTheme.ts
│   ├── screens/
│   │   ├── LoginScreen.tsx
│   │   ├── TodayScreen.tsx
│   │   ├── BoardScreen.tsx              # ports 4 views from existing
│   │   ├── TaskDetailScreen.tsx
│   │   ├── CreateTaskScreen.tsx
│   │   ├── InboxScreen.tsx
│   │   ├── SettingsScreen.tsx
│   │   └── ProjectSwitcherSheet.tsx
│   ├── components/
│   │   ├── chrome/
│   │   │   ├── BottomTabs.tsx           # unified 5-tab nav
│   │   │   ├── TopHeader.tsx            # serif title + Devanagari kicker
│   │   │   ├── OfflineBanner.tsx
│   │   │   └── ProjectChip.tsx
│   │   ├── task/
│   │   │   ├── TaskCard.tsx, BoardCard.tsx
│   │   │   ├── ApprovalBanner.tsx       # 3 POVs
│   │   │   ├── SubtaskList.tsx          # toggle + add + delete
│   │   │   ├── CommentItem.tsx          # YOU badge + edit/delete inline
│   │   │   └── CommentComposer.tsx      # @ autocomplete
│   │   ├── primitives/
│   │   │   ├── Avatar.tsx, AvatarStack.tsx
│   │   │   ├── DueChip.tsx, PriorityDot.tsx, StatusChip.tsx
│   │   │   └── Button.tsx, IconButton.tsx, ListRow.tsx
│   │   └── icons/
│   │       └── KIcon.tsx                # the app-icon component (for splash, login mark, etc.)
│   ├── theme/
│   │   ├── tokens.ts                    # token tables for light + dark
│   │   ├── ThemeProvider.tsx            # System / Light / Dark
│   │   └── fonts.ts                     # Newsreader + Tiro Devanagari + Inter loading
│   ├── offline/
│   │   ├── queryClient.ts               # TanStack Query + persistence
│   │   ├── mutationQueue.ts             # offline-safe mutations
│   │   └── reconcile.ts
│   ├── nav/
│   │   ├── RootStack.tsx
│   │   └── linking.ts                   # deep links from notifications
│   └── lib/
│       ├── formatDate.ts                # IST timezone aware
│       ├── derive.ts                    # colour from id, etc.
│       └── permissions.ts
└── assets/
    ├── icon.png                         # 1024×1024 exported from KIcon
    ├── adaptive-icon.png
    ├── splash.png                       # KIcon centered on bg
    └── fonts/
```

---

## 8. Theming

Token files mirror the design canvas:

```ts
// tokens.ts
export const tokens = {
  light: {
    bg: '#F2F2F7',
    surface: '#FFFFFF',
    surfaceLow: '#ECECF1',
    onSurface: '#1A1A1F',
    onSurfaceVar: '#3F4042',
    onSurfaceVar2: '#73757A',
    outlineVar: '#C6C6CB',
    primary: '#006A60',           // iOS uses #05b7aa as accent; M3 uses #006A60. Use platform-specific primary.
    onPrimary: '#FFFFFF',
    primaryContainer: '#A0F0E4',
    onPrimaryContainer: '#00201C',
    tertiaryContainer: '#FFDDB6', // approval amber
    onTertiaryContainer: '#2C1600',
    errorContainer: '#FFDAD6',
    onErrorContainer: '#410002',
    error: '#BA1A1A',
    // brand gradient — used identically on both platforms for CTAs + app icon + login mark
    brandGradient: ['#0082c6', '#03a1b6', '#05b7aa'],
  },
  dark: { /* corresponding dark values — see design canvas Android/iOS dark screens */ },
};
```

`ThemeProvider` reads `Settings → Theme` from MMKV (or falls back to `useColorScheme()` when set to System).

---

## 9. App icon

Source: `mobile/app-icon.jsx` in this design project — open the "App icon" section of the canvas to see the spec at every size and on the home screen of both platforms.

Recipe:
- Background: 135° linear gradient `#0082c6 → #03a1b6 → #05b7aa`
- Mark: Tiro Devanagari Hindi **क** in pure white, font-size ~62% of icon height
- Inner shine: 18% white linear gradient from top, fading by 35%
- Accent: bottom-left radial orb (18% white, 2px blur, ~55% icon width)
- iOS variants: gradient (default), dark, monochrome, tinted (iOS 18+)
- Android adaptive: foreground sits inside the 108dp safe area; system applies the mask

Export from the canvas at 1024×1024 → `assets/icon.png`. For Android adaptive, export foreground (centered mark + shine) and background (just the gradient + orb) separately to `assets/adaptive-icon-foreground.png` and `assets/adaptive-icon-background.png`.

---

## 10. Stack

| Concern | Pick |
|---|---|
| Framework | Expo SDK 51+ (React Native 0.74+) |
| Navigation | `expo-router` (or `@react-navigation/native` v7) |
| Data fetching | TanStack Query v5 + persisted client |
| Local storage | MMKV (`react-native-mmkv`) |
| Forms | RHF (`react-hook-form`) only on screens with >2 inputs |
| State | TanStack Query + Zustand for UI state (theme, drawer open, etc.) |
| Notifications | `expo-notifications` (local + remote) |
| Files | `expo-image-picker` + `expo-document-picker` + `expo-av` |
| Auth | httpOnly cookie via `axios` with `withCredentials: true` (matches existing `api.js`) |
| Date | `date-fns` + `date-fns-tz` (IST) |

---

## 11. Build order (suggested)

1. Auth + LoginScreen + tokens + ThemeProvider + bottom tabs shell
2. Today screen (read-only) wired to `GET /api/tasks`
3. Boards screen + project switcher sheet
4. Task detail (read-only)
5. Comments (read + post + edit/delete own)
6. Subtasks (full CRUD)
7. Create task screen
8. Approval banner (all 3 POVs) + approve/reject/send-to-client
9. File upload (camera + files)
10. Inbox + unread badge
11. Settings + permissions + sign out
12. **Offline queue + reconciliation** ← largest engineering risk; pick the persistence library first and prototype before week 2
13. App icon + splash + production builds

Ship 1–6 as an internal beta. 7–13 polish into the public release.

---

## 12. References

- Design canvas (this project): `Kartavya Mobile.html` — every screen in light + dark for both platforms
- Mock data shape: `mobile/mobile-shared.jsx`
- Real backend models: `backend/server.py` (Pydantic models)
- Existing mobile app: `mobile/src/screens/*.js` in [`kevalvshah/Kartavya`](https://github.com/kevalvshah/Kartavya) — port BoardScreen's 4 views directly
- Approval logic source of truth: `backend/approvals_router.py` + `IMPLEMENTATION_PLAN.md`
- Brand notes: `README.md` (mobile section). (`V2_PLAN.md` § 2 was cited here for the
  UI quality bar and **was never committed**. The bar that actually exists is the
  `frontend/scripts/check-*` gate suite — tokens, motion, contrast, row height —
  which is enforced rather than described.)

---

## 13. Quickstart

```bash
# clone
git clone git@github.com:kevalvshah/Kartavya.git
cd Kartavya/mobile

# install
npm install
npx expo install   # ensures native module versions match SDK

# env
cp .env.example .env
# fill in EXPO_PUBLIC_API_URL (e.g. https://kartavya-api.up.railway.app)

# run
npx expo start
#   press i → iOS Simulator
#   press a → Android emulator
#   scan QR → Expo Go on device

# native build (when you need camera/notifications)
npx expo prebuild           # generates ios/ + android/ dirs
npx expo run:ios            # build + run on simulator
npx expo run:android        # build + run on emulator

# production builds
eas build --profile preview  --platform ios       # TestFlight internal
eas build --profile preview  --platform android   # Play Internal Testing
eas build --profile production --platform all     # store builds
```

---

## 14. Environment variables

```bash
# mobile/.env  — all reads use EXPO_PUBLIC_* prefix so they're embedded in the bundle
EXPO_PUBLIC_API_URL=https://kartavya-api.up.railway.app
EXPO_PUBLIC_SENTRY_DSN=                              # optional, leave blank for dev
EXPO_PUBLIC_POSTHOG_KEY=                             # optional analytics
EXPO_PUBLIC_DEEP_LINK_SCHEME=kartavya               # matches app.json scheme

# native push (set in EAS Secrets, not .env)
APNS_KEY_ID=…
APNS_TEAM_ID=…
APNS_AUTH_KEY=…           # .p8 file contents
FCM_SERVER_KEY=…
```

App config (`app.json` / `app.config.ts`):

```json
{
  "expo": {
    "name": "Kartavya",
    "slug": "kartavya",
    "scheme": "kartavya",
    "version": "2.0.1",
    "ios": {
      "bundleIdentifier": "com.aekaminc.kartavya",
      "supportsTablet": true,
      "infoPlist": {
        "NSCameraUsageDescription": "Capture site photos and receipts to attach to tasks.",
        "NSMicrophoneUsageDescription": "Record voice notes that turn into comments.",
        "NSPhotoLibraryUsageDescription": "Attach photos from your library to tasks."
      }
    },
    "android": {
      "package": "com.aekaminc.kartavya",
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon-foreground.png",
        "backgroundImage": "./assets/adaptive-icon-background.png"
      },
      "permissions": ["CAMERA", "RECORD_AUDIO", "READ_MEDIA_IMAGES", "POST_NOTIFICATIONS"]
    }
  }
}
```

---

## 15. Data model reference (TS interfaces)

These mirror the Pydantic models in `backend/server.py`. Generate from OpenAPI if you prefer (`openapi-typescript`).

```ts
export type Role = 'admin' | 'owner' | 'member' | 'client';
export type Priority = 'urgent' | 'high' | 'medium' | 'low';
export type ApprovalStatus = 'pending' | 'pending_client' | 'approved' | 'rejected' | null;

export interface User {
  user_id: string;
  email: string;
  full_name: string;
  role: Role;
  picture?: string;
  position?: string;
  company_name?: string;
}

export interface Project {
  team_id: string;
  name: string;
  created_by: string;
  created_at: string;       // ISO
  task_count: number;
  done_count: number;
}

export interface ProjectColumn {
  column_id: string;
  team_id: string;
  name: string;             // "To do" / "In progress" / "Approval" / "Done" / custom
  color: string;            // hex
  sort_order: number;
  is_done: boolean;         // true for the column where approved tasks land
}

export interface Subtask {
  subtask_id: string;
  title: string;
  is_done: boolean;
  order: number;
}

export interface Attachment {
  name: string;
  url: string;
  key?: string;             // R2 object key for delete
}

export interface Task {
  task_id: string;
  team_id: string;
  column_id: string;
  created_by_user_id: string;
  created_by_name?: string;
  assigned_by_user_id?: string;
  title: string;
  description?: string;
  status: 'todo' | 'in_progress' | 'in_review' | 'done' | 'requested';
  priority: Priority;
  tags: string[];
  assignee_user_ids: string[];
  due_at?: string;
  estimated_minutes?: number;
  attachments: Attachment[];
  subtasks: Subtask[];
  order: number;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  approval_status: ApprovalStatus;
  approval_notes?: string;
  approved_by?: string;
  approval_requested_at?: string;
  approval_decided_at?: string;
}

export interface Comment {
  comment_id: string;
  task_id: string;
  user_id: string;
  user_name: string;
  body: string;
  created_at: string;
}

export type NotifKind =
  | 'mention' | 'approval_request' | 'approved' | 'rejected'
  | 'assigned' | 'comment' | 'status_changed' | 'done' | 'created';

export interface Notification {
  notification_id: string;
  user_id: string;
  team_id?: string;
  task_id?: string;
  type: NotifKind;
  title: string;
  message: string;
  url?: string;
  created_at: string;
  read_at?: string;
}

export type PushMode = 'always' | 'mine_only' | 'project' | 'off';
export type NotifPrefs = Partial<Record<NotifKind, PushMode>>;
```

---

## 16. Sample API exchanges

### Login

```http
POST /api/auth/login
Content-Type: application/json

{ "email": "keval@aekaminc.com", "password": "•••" }
```
```json
HTTP/1.1 200 OK
Set-Cookie: kt_session=…; HttpOnly; Secure; SameSite=Lax

{ "user": { "user_id": "u1", "email": "keval@aekaminc.com", "full_name": "Keval Shah", "role": "owner" } }
```

### Move a card into the Approval column

```http
PATCH /api/tasks/KAR-301/move
{ "column_id": "col_approval_p3", "order": 0 }
```
Backend side effects:
- task `column_id` updated, `approval_status` set to `'pending'`
- `approval_requested_at = NOW()`
- `notifications` row created for every owner of the project (`type='approval_request'`)
- activity event written

### Owner approves & advances

```http
POST /api/approvals/task_approval::KAR-301/review
{ "status": "approved" }
```
```json
{ "ok": true, "status": "approved", "new_column_id": "col_done_p3" }
```

### Owner sends to client instead

```http
POST /api/approvals/task_approval::KAR-301/review
{ "status": "approved", "send_to_client": true, "client_email": "arjun@tatasteel.com" }
```
```json
{ "ok": true, "status": "pending_client" }
```

### Comment with @mention

```http
POST /api/tasks/KAR-301/comments
{ "body": "@Devika please join — we need you for the AV closet review." }
```
- Backend parses `@Devika` → user `u6` → writes `notifications` row of `type='mention'` + (if push enabled) APNs/FCM push.

### Subtask CRUD

```http
POST   /api/tasks/KAR-301/subtasks      { "title": "Sign BOQ" }
PATCH  /api/tasks/KAR-301/subtasks/sub_c    # toggles is_done
DELETE /api/tasks/KAR-301/subtasks/sub_c
```
All three return the **full updated task** so you can replace it in the TanStack cache.

---

## 17. Screen-level acceptance criteria

Use these as the final QA pass per screen.

### Login
- [ ] Server-side validation errors surface as toast under the password field
- [ ] Loading state on submit disables both fields + shows spinner inside button
- [ ] Successful login persists session and routes to Today (no flash of login screen on relaunch while session is valid)
- [ ] "Invite-only" note is visible without scroll

### Today
- [ ] Pull-to-refresh refetches `GET /api/tasks` and the section headers update
- [ ] "Due today" section only includes tasks whose `due_at` falls on the local day
- [ ] Tapping a task opens TaskDetailScreen with the same `task_id`
- [ ] Offline banner appears whenever `NetInfo.isConnected === false` and shows queue count

### Board
- [ ] Project switcher chip shows the active project's name + open-task count
- [ ] View switcher (Board / List / Schedule / Tracker) preserves scroll position when toggling
- [ ] Column tabs show counts that match the visible cards
- [ ] Moving a card into the **Approval** column triggers the approval workflow (verify a notification appears in the owner's inbox)
- [ ] Cards show sync indicator when a pending mutation exists

### Task detail
- [ ] Status chip in the header is interactive — opens an inline column picker
- [ ] Approval banner adapts to viewer's POV (owner / requester / client)
- [ ] Subtask checkboxes optimistically update; progress bar reflects state immediately
- [ ] **Edit / Delete** appear only on the current user's own comments (or for admins)
- [ ] File attach sheet shows Files / Camera / Voice and uploads to R2 before patching the task
- [ ] @mention autocomplete fires on `@` and shows team members
- [ ] Back button returns to wherever the user came from (Today, Board, or Inbox)

### Create task
- [ ] Title field is auto-focused; create button stays disabled until title is non-empty
- [ ] Project picker defaults to the currently active project
- [ ] Tapping Create dismisses the sheet and the new task appears at the top of the target column
- [ ] Cancel preserves draft for the session (in-memory) but discards on second cancel
- [ ] Voice attachment captures audio and uploads as a `.m4a` attachment

### Inbox
- [ ] Filter chips update the visible list without a network round-trip (client-side filter)
- [ ] Tapping a notification marks it read and deep-links to the target task
- [ ] Unread count badge on the tab updates instantly on read
- [ ] Pull-to-refresh refetches notifications

### Settings
- [ ] Account row shows real name + email from `/api/auth/me`
- [ ] Notification toggle changes are persisted via `PUT /api/me/notification_prefs` (debounced 500ms)
- [ ] Permission rows reflect actual OS status (re-query on screen focus)
- [ ] Tapping a permission row opens system Settings via `Linking.openSettings()`
- [ ] **Sync now** triggers the offline queue flush and shows progress
- [ ] **Reset app data** prompts a confirm dialog and clears MMKV + TanStack cache, **does not** call the API
- [ ] **Sign out** calls `/api/auth/logout` then `navigation.reset()` to the LoginScreen

---

## 18. Accessibility checklist

- [ ] Every touchable element has `accessibilityLabel` matching its visible text
- [ ] Hit targets ≥ 44×44 (iOS) / 48×48 (Android) — set `hitSlop` if visual size is smaller
- [ ] Dynamic Type / font scaling respected — never lock font sizes; use `allowFontScaling` and test at 200%
- [ ] Color contrast ≥ 4.5:1 for body text, 3:1 for large text — verify both light and dark
- [ ] Approval banner reads as a single button when assistive tech focuses it; describe the action ("Approve and advance task")
- [ ] Avatar groups expose member names to screen readers, not just initials
- [ ] Inline status changes announce via `AccessibilityInfo.announceForAccessibility`
- [ ] Devanagari subtitles have `accessibilityLabel` set to their English equivalent ("Today, in Devanagari")
- [ ] Reduce-motion respected — opt-out of slide transitions when the user has it enabled

---

## 19. Performance budgets

| Metric | Target |
|---|---|
| Cold start to Today screen interactive | ≤ 1.5s on mid-range Android (Pixel 6a) |
| Bundle size (download) | ≤ 12 MB |
| Today list render | 60 fps scroll with 100 items — virtualize with `FlashList` |
| Board view switch | < 100ms perceived (preload data for all 4 views on first project mount) |
| Image attachments | resize to max 2048px on the long edge before upload |
| Memory | stay below 200 MB resident on iPhone 13 mini during a typical session |
| Network | bundle related fetches; never wait on auth/me serially before showing data |

---

## 20. Release checklist

### Internal alpha (TestFlight + Play Internal)
- [ ] All Section 17 acceptance criteria pass on at least one device per platform
- [ ] Sentry hooked up; verify a deliberate crash reaches the dashboard
- [ ] Offline mode tested with airplane mode for ≥ 5 minutes of edits
- [ ] App icon, splash, and launch screen verified on light and dark wallpapers
- [ ] All `EXPO_PUBLIC_*` env vars set in EAS preview profile

### Public production
- [ ] App Store screenshots (5 sizes) and Play Store screenshots (phone + 7" + 10") generated from the design canvas
- [ ] Privacy nutrition labels + Data Safety form filled in (we collect: email, name, task content, file attachments; we do **not** track location, contacts, or browse history)
- [ ] Privacy policy + Terms URLs added to Store listings
- [ ] Push entitlements + APNs key uploaded to EAS
- [ ] FCM service account JSON uploaded to EAS
- [ ] Force-update mechanism wired up (read minimum-supported version from `/api/me`)
- [ ] Crash-free session rate ≥ 99.5% across the last 7-day alpha cohort

---

## 21. Open questions for the team

These didn't get resolved in design — list them so they get answered before implementation:

1. **Project colours.** The schema doesn't store a project colour. Mobile derives one from `team_id` hash today. Should we add a `color` column to `teams`?
2. **Push during quiet hours.** Section 12 picks 22:00–07:00 IST as default. Owners on call may want to override per project — defer or ship now?
3. **"Mine only" definition for comments.** Today: creator + assignees + watchers. Should mentions of you also count as "mine" even if you're not assigned?
4. **Attachment thumbnails.** Backend returns the raw URL — generate thumbnails server-side, or download + resize client-side on first view?
5. **Voice-to-comment.** Just upload the `.m4a` and let the recipient play it, or transcribe via Whisper API before posting? Transcription cost / latency is real.
6. **Resetting app data while offline.** If the user resets while queued mutations exist, do we drop them silently or confirm with "3 unsynced edits will be lost"?
7. **Multiple devices.** A push goes to every registered device. Add a "Pause notifications on this device" toggle in Settings?

---

*Kartavya (कर्तव्य) — Sanskrit for "duty" or "that which must be done"*
*Designed for Aekam Inc · 2026*
