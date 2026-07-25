# Kartavya Mobile — Implementation Handoff for Antigravity (Google AI Studio)

**Audience:** an Antigravity Manager agent (or a human pairing with one) building the production React Native (Expo) app powered by Gemini 3.
**Source of truth for design:** `Kartavya Mobile.html` in this design project — open it to see every screen rendered in light + dark for both platforms.
**Source of truth for data + APIs:** [`kevalvshah/Kartavya`](https://github.com/kevalvshah/Kartavya) on `main` — backend is FastAPI + Postgres, mobile is Expo / React Native in `mobile/`.

---

## 0. How to read this file (Antigravity-specific)

This handoff is structured for Antigravity's **Manager + Editor** workflow:

| Section | Use this when… |
|---|---|
| 1–2 | Drafting the high-level **Plan Artifact** before kicking off subagents |
| 3–9 | The Manager fans out workstreams; each section maps to a subagent's scope |
| 10–15 | Concrete inputs for the Editor: stack, env, schemas, sample payloads |
| 16–19 | Verification — feed these as **Walkthrough Artifacts** for the Manager to confirm each subagent's output |
| 20–21 | Release + parking-lot questions for the human in the loop |

**Tip for the Manager agent:** before spawning subagents, attach this file plus `Kartavya Mobile.html` to the workspace. Use Gemini 3's 1M-token context to load both — don't summarize them out.

**Recommended subagent split** (4 parallel Editor sessions):
1. **Shell** — auth, navigation, theme, bottom tabs, offline queue scaffold (§3, §8, §10)
2. **Lists** — Today, Boards (4 views), Inbox, project switcher (§3, §16)
3. **Detail** — Task detail, subtasks, comments, approval banner, file upload (§4, §16)
4. **Auxiliary** — Login, Settings, notifications prefs, permissions, icon export (§7, §9)

Re-merge under the Manager after each subagent finishes their Walkthrough Artifact.

---

## 1. Scope

The mobile app is a **work-on-the-go companion**, not a full admin/setup tool. Setup, reporting, automations, time tracking, and project/team management stay on desktop.

### Shipping in v1
- **Login** — invite-only email + password (matches `apiLogin` in `mobile/src/api.js`)
- **Today** — the signed-in user's slice of work across projects: due, mentions, approvals
- **Boards** — kanban for any visible project, in 4 view modes: **Board · List · Schedule · Tracker** (ported from existing `BoardScreen.js`)
- **Task detail** — full lifecycle: status change · comments (edit/delete own, @mentions) · subtask CRUD · file upload · approval workflow (3 POVs)
- **Project switcher** — bottom sheet from the board header
- **Inbox** — every task event in your projects (9 kinds — see §3)
- **Settings** — account · per-kind notification preferences · permissions · sync · reset · sign out
- **Offline-first** — read-anywhere cache + mutation queue with a sync banner
- **Theme** — System / Light / Dark
- **App icon** — Devanagari **क** on the brand gradient

### Explicitly NOT in v1
- ❌ Invite user · create team · create project
- ❌ Templates · automations · dashboards · reports · time reports
- ❌ Admin screens
- ❌ Multi-workspace switching

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
    ├── Inbox          (mentions / approvals / status / comments / all)
    └── Me
        └── Settings
```

Bottom nav is **identical on both platforms**: Today · Boards · + · Inbox · Me. The "+" is a gradient pill, not a tab.

Every section header carries a small **Devanagari subtitle** under the English label (e.g. "Today · आज", "Approval · अनुमोदन"). This is Kartavya's voice — preserve it.

---

## 3. Visual language

| Token | iOS 18+ | Android 14+ (M3 Expressive) |
|---|---|---|
| Background light | `#F2F2F7` | `#F2F2F7` (matches iOS — neutral gray) |
| Background dark  | `#000`    | `#0f1411` |
| Primary accent   | `#05b7aa` | `#006A60` light / `#83D5C6` dark |
| Gradient (CTAs)  | `linear-gradient(135deg, #0082c6, #05b7aa)` | same |
| Headline serif   | Newsreader | Newsreader (Roboto fallback) |
| UI font          | SF Pro (system) | Roboto / Roboto Flex |
| Devanagari       | Tiro Devanagari Hindi | same |
| Mono             | SF Mono / ui-monospace | JetBrains Mono / ui-monospace |
| Bottom nav       | translucent glass | solid M3 surface — same 5-tab layout |
| Corner radii     | 14–22 (variable) | 16–28 (M3 Expressive) |
| FAB              | none — center "+" handles new-task | same (no separate FAB) |

---

## 4. Real data wiring

The design canvas uses mock data in `mobile/mobile-shared.jsx`. Everything **except UI labels** must be replaced with live API responses. Labels (English section headers, "Approval", "Approve & advance", the Sanskrit/Devanagari subtitles) stay hardcoded.

### Auth

| UI | Endpoint |
|---|---|
| Login submit | `POST /api/auth/login` via `apiLogin(email, password)` |
| Header avatar / name | `GET /api/auth/me` (cache in `useAuth()`) |
| Settings sign out | `POST /api/auth/logout` |

### Projects

| UI | Endpoint |
|---|---|
| Project switcher list | `GET /api/teams` |
| Switch → board | `GET /api/projects/{team_id}/columns` + `GET /api/tasks?team_id=…` |

### Tasks

| UI | Endpoint |
|---|---|
| Today | `GET /api/tasks?assigned_to_me=true&due_in=7d` |
| Board cards | `GET /api/tasks?team_id=…` (group client-side by `column_id`) |
| Create | `POST /api/tasks` |
| Edit | `PATCH /api/tasks/{task_id}` |
| Move column | `PATCH /api/tasks/{task_id}/move` body `{column_id, order}` |
| Delete | `DELETE /api/tasks/{task_id}` |

### Subtasks (full CRUD)

Schema: `{ subtask_id, title, is_done, order }` — JSONB on task.

| UI | Endpoint |
|---|---|
| Add | `POST /api/tasks/{task_id}/subtasks {title}` |
| Toggle | `PATCH /api/tasks/{task_id}/subtasks/{subtask_id}` |
| Delete | `DELETE /api/tasks/{task_id}/subtasks/{subtask_id}` |

### Comments (edit / delete own)

| UI | Endpoint |
|---|---|
| Read | `GET /api/tasks/{task_id}/comments` |
| Post | `POST /api/tasks/{task_id}/comments` |
| Edit | `PUT /api/tasks/{task_id}/comments/{comment_id}` (own only) |
| Delete | `DELETE /api/tasks/{task_id}/comments/{comment_id}` (own only) |
| @mention autocomplete | `GET /api/teams/{team_id}/members` |

Show three-dot menu + Edit/Delete only when `comment.user_id === currentUser.user_id` (or current user is admin). "YOU" badge on own comments.

### File upload

| UI | Endpoint |
|---|---|
| + → Attach / Camera / Voice | `POST /api/upload` (Cloudflare R2) → `{name, url, key}` |
| Attach to task | `PATCH /api/tasks/{task_id} {attachments: [...]}` |

### Approval workflow (3 POVs)

States: `pending` (owner sign-off) · `pending_client` (external client review) · `approved` · `rejected` · `null`.

| Action | Endpoint |
|---|---|
| Member moves card → Approval | `PATCH /api/tasks/{task_id}/move {column_id: <approval>}` — backend auto-sets `approval_status='pending'` + notifies owner |
| Owner **Approve & advance** | `POST /api/approvals/task_approval::{task_id}/review {status: 'approved'}` |
| Owner **Request changes** | `POST /api/approvals/task_approval::{task_id}/review {status: 'rejected', notes}` |
| Owner **Send to client** | `POST /api/approvals/task_approval::{task_id}/review {status: 'approved', send_to_client: true, client_email}` |
| Client approves (signed in) | same `POST .../review {status: 'approved'}` — must be linked via `task_clients` |

Banner POVs:
1. **Owner viewing** a task awaiting their sign-off → show approve/reject actions
2. **Member viewing** a task they sent for approval → "Awaiting Keval's approval" (read-only)
3. **Client viewing** a `pending_client` task → show approve/changes actions

---

## 5. Notifications (full task-event taxonomy)

The app subscribes to **every task event** in projects the user is assigned to. Pushes are gated by per-kind preferences in Settings → Notifications.

| Kind | Trigger | Default push | Recipients |
|---|---|---|---|
| `mention`          | `@user` in comment | **Always** | the mentioned user |
| `approval_request` | task moves into Approval column | **Always** | project owner(s) |
| `approved`         | `/approvals/.../review {status:'approved'}` | **Always** | task creator |
| `rejected`         | `/approvals/.../review {status:'rejected'}` | **Always** | task creator |
| `assigned`         | `assignee_user_ids` change | **Always** | newly assigned user |
| `comment`          | new comment on a watched task | Mine only | creator + assignees + watchers + clients |
| `status_changed`   | `column_id` changes | Project members | all project members |
| `done`             | moves to `is_done=true` column | Project members | all project members |
| `created`          | new task in your project | In-app only | all project members |

### Endpoints

| UI | Endpoint |
|---|---|
| Inbox list | `GET /api/notifications` |
| Unread badge | `GET /api/notifications/unread_count` |
| Mark read | `POST /api/notifications/mark_read {notification_ids | mark_all}` |
| Read prefs | `GET /api/me/notification_prefs` |
| Update prefs | `PUT /api/me/notification_prefs` |
| Register push token | `POST /api/me/push_tokens {platform, token, device_id}` |
| Unregister on sign-out | `DELETE /api/me/push_tokens/{device_id}` |

### Push payload

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
  "priority": "urgent"
}
```

### Push gating (server side)

```python
def should_push(user, kind, task, actor):
    if actor == user: return False
    pref = user.notification_prefs.get(kind, 'always')
    if pref == 'off':       return False
    if pref == 'always':    return True
    if pref == 'mine_only': return user in (task.creator, *task.assignees)
    if pref == 'project':   return user in task.project.members
    return False
```

Quiet hours: 22:00–07:00 IST by default; `mention` + `approval_request` always break through.

### Suggested delivery stack (Google-native)

Because you're already in the Google ecosystem via Antigravity / AI Studio, prefer **Firebase Cloud Messaging** for both Android and iOS (yes, FCM-on-iOS works via APNs underneath):

- Add Firebase to the Expo project: `@react-native-firebase/app` + `@react-native-firebase/messaging`
- Use **FCM HTTP v1 API** from FastAPI (`pip install firebase-admin`)
- Single SDK for both platforms — keeps the server code simpler than juggling APNs + FCM separately
- Background message handling lives in `index.js` registered with `messaging().setBackgroundMessageHandler(...)`

This is the only place this handoff diverges from the Claude Code version — same UI, same UX, different delivery plumbing.

---

## 6. Offline-first

The repo's mobile app today does **not** queue offline writes. v1 must:

1. **Cache everything read** in MMKV (`react-native-mmkv`), keyed by endpoint + params
2. **Queue mutations** offline: push `{method, url, body, optimistic_id}` to a queue table
3. **Optimistic UI:** on mutation, write predicted result to cache immediately; render with a small `syncing` indicator
4. **Reconcile on reconnect:** flush queue oldest-first, replace optimistic IDs with server IDs
5. **Surface state:**
   - Banner on Today: `Offline · 3 changes queued [Retry]`
   - Per-card sync icon for records with pending mutations
   - Settings → Sync status row shows queue count + "Last synced"
6. **Reset app data** clears local cache + queue, **never** touches the server

Recommended: TanStack Query v5 with `@tanstack/react-query-persist-client` + MMKV. Add a custom mutation cache that survives reloads.

**Why this matters for the Antigravity agent:** the offline layer is the single highest-risk piece of engineering in this app. Don't let a subagent ship without showing a Walkthrough where they kill network mid-edit and reconnect.

---

## 7. Permissions

| Permission | Request when | API |
|---|---|---|
| Notifications | First sign-in, soft-ask sheet | `expo-notifications` (delegates to FCM under the hood) |
| Camera | First Camera tap | `expo-image-picker` |
| Microphone | First Voice tap | `expo-av` |
| Photos / Files | First Attach tap | `expo-image-picker` + `expo-document-picker` |

Settings → Permissions section reflects actual `getPermissionsAsync()` results on focus, not a stored flag. Tap → `Linking.openSettings()`.

---

## 8. File / folder layout

```
mobile/
├── App.tsx
├── src/
│   ├── api/                  # axios client + per-domain modules + types.ts
│   ├── hooks/                # useAuth, useTasks, useTask, useComments, useNotifications,
│   │                         # useOffline, usePermissions, useTheme, usePushPrefs
│   ├── screens/              # LoginScreen, TodayScreen, BoardScreen, TaskDetailScreen,
│   │                         # CreateTaskScreen, InboxScreen, SettingsScreen,
│   │                         # ProjectSwitcherSheet
│   ├── components/
│   │   ├── chrome/           # BottomTabs, TopHeader, OfflineBanner, ProjectChip
│   │   ├── task/             # TaskCard, BoardCard, ApprovalBanner, SubtaskList,
│   │   │                     # CommentItem, CommentComposer
│   │   ├── primitives/       # Avatar, AvatarStack, DueChip, PriorityDot, StatusChip,
│   │   │                     # Button, IconButton, ListRow, Switch
│   │   └── icons/            # KIcon (app icon component for splash + login mark)
│   ├── theme/                # tokens.ts, ThemeProvider.tsx, fonts.ts
│   ├── offline/              # queryClient.ts, mutationQueue.ts, reconcile.ts
│   ├── push/                 # firebase.ts, registerForPush.ts, handlers.ts
│   ├── nav/                  # RootStack.tsx, linking.ts (deep links)
│   └── lib/                  # formatDate, derive, permissions
└── assets/                   # icon.png, adaptive-icon-foreground.png,
                              # adaptive-icon-background.png, splash.png, fonts/
```

---

## 9. Theming (token tables)

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
    primary: '#006A60',
    onPrimary: '#FFFFFF',
    primaryContainer: '#A0F0E4',
    onPrimaryContainer: '#00201C',
    tertiaryContainer: '#FFDDB6',
    onTertiaryContainer: '#2C1600',
    errorContainer: '#FFDAD6',
    onErrorContainer: '#410002',
    error: '#BA1A1A',
    brandGradient: ['#0082c6', '#03a1b6', '#05b7aa'],
  },
  dark: { /* see design canvas Android/iOS dark screens */ },
};
```

`ThemeProvider` reads Settings → Theme from MMKV, falling back to `useColorScheme()` when set to System.

---

## 10. Stack

| Concern | Pick |
|---|---|
| Framework | Expo SDK 51+ (React Native 0.74+) |
| Navigation | `expo-router` |
| Data fetching | TanStack Query v5 + persisted client |
| Local storage | MMKV (`react-native-mmkv`) |
| Forms | `react-hook-form` only on screens with >2 inputs |
| State | TanStack Query + Zustand for UI state |
| **Push** | `@react-native-firebase/messaging` (Google-native) |
| Files | `expo-image-picker` + `expo-document-picker` + `expo-av` |
| Auth | httpOnly cookie via `axios` with `withCredentials: true` |
| Date | `date-fns` + `date-fns-tz` (IST) |
| Lists | `@shopify/flash-list` for Today + Board cards |
| Error reporting | Firebase Crashlytics (matches the Google-native theme) |

---

## 11. Quickstart

```bash
# clone
git clone git@github.com:kevalvshah/Kartavya.git
cd Kartavya/mobile

# install
npm install
npx expo install

# env
cp .env.example .env
# fill EXPO_PUBLIC_API_URL + Firebase config (see §12)

# Firebase native files
# place ios/GoogleService-Info.plist  and  android/app/google-services.json
# (download from Firebase Console → Project Settings → Your Apps)

# run dev
npx expo start

# generate native dirs (needed for FCM)
npx expo prebuild
npx expo run:ios
npx expo run:android

# production
eas build --profile preview --platform ios
eas build --profile preview --platform android
eas build --profile production --platform all
```

---

## 12. Environment variables

```bash
# mobile/.env
EXPO_PUBLIC_API_URL=https://kartavya-api.up.railway.app
EXPO_PUBLIC_DEEP_LINK_SCHEME=kartavya
EXPO_PUBLIC_FIREBASE_PROJECT_ID=kartavya-mobile

# Native Firebase config lives in:
#   ios/GoogleService-Info.plist
#   android/app/google-services.json
# Do NOT put these values in .env — they ship as part of the native binary.

# EAS Secrets (server-side push)
FIREBASE_ADMIN_CREDENTIALS_JSON=…   # base64-encoded service account JSON
```

`app.json` additions for FCM:

```json
{
  "expo": {
    "plugins": [
      "@react-native-firebase/app",
      "@react-native-firebase/messaging",
      ["expo-build-properties", { "ios": { "useFrameworks": "static" } }]
    ],
    "android": {
      "googleServicesFile": "./google-services.json",
      "permissions": ["CAMERA", "RECORD_AUDIO", "READ_MEDIA_IMAGES", "POST_NOTIFICATIONS"]
    },
    "ios": {
      "googleServicesFile": "./GoogleService-Info.plist"
    }
  }
}
```

---

## 13. Data model reference

(Identical to the Claude Code version — generated from `backend/server.py` Pydantic models. Use `openapi-typescript` against the running API to auto-sync.)

```ts
export type Role = 'admin' | 'owner' | 'member' | 'client';
export type Priority = 'urgent' | 'high' | 'medium' | 'low';
export type ApprovalStatus = 'pending' | 'pending_client' | 'approved' | 'rejected' | null;
export type NotifKind =
  | 'mention' | 'approval_request' | 'approved' | 'rejected'
  | 'assigned' | 'comment' | 'status_changed' | 'done' | 'created';
export type PushMode = 'always' | 'mine_only' | 'project' | 'off';
// User, Project, ProjectColumn, Subtask, Attachment, Task, Comment, Notification
// — see CLAUDE_CODE_HANDOFF.md §15 for the full interface bodies.
```

---

## 14. Sample API exchanges

(Same as the Claude Code handoff §16 — won't repeat. Key flows: login, move card to Approval, approve & advance, send to client, @-mention comment, subtask CRUD.)

---

## 15. App icon

Source: `mobile/app-icon.jsx` in this design project. Construction recipe:

- Background: 135° gradient `#0082c6 → #03a1b6 → #05b7aa`
- Mark: Tiro Devanagari Hindi **क** in white at ~62% icon height
- Inner shine: 18% white from top, fading by 35%
- Bottom-left accent orb: 18% white, 2px blur, ~55% icon width
- Variants: gradient (default), dark, monochrome, tinted (iOS 18+)
- Android adaptive: 108dp safe-area foreground, separate gradient background

Export from the canvas at 1024×1024 → `assets/icon.png`. Adaptive foreground + background separately.

---

## 16. Walkthrough Artifacts (for the Manager to verify)

After each subagent finishes, ask them to produce a **Walkthrough Artifact** demonstrating these screen flows end-to-end. Each Walkthrough should be a screen recording + a checklist.

### Shell subagent
- Cold start → Login → Today
- Theme switch (System/Light/Dark) reflects immediately on every visible surface
- Bottom tab switch keeps each tab's scroll position
- Airplane mode → offline banner appears with queue count

### Lists subagent
- Project switcher: open from header → tap a different project → board updates without a full reload
- Board view switch (Board/List/Schedule/Tracker) preserves project + filter context
- Today pull-to-refresh triggers refetch, then sticky section headers update
- Inbox filter chips update list client-side; tap notification → deep-link to TaskDetail

### Detail subagent
- Subtask: add → toggle → delete, all optimistic, progress bar reflects in real time
- Comment: post → edit own → delete own, with `@`-mention autocomplete
- Approval banner: cycle a card through Member POV → Owner POV → Client POV
- File: pick from Photos, then capture with Camera, both upload to R2 and appear in the Files tab

### Auxiliary subagent
- Login: bad password → toast; good password → routes to Today
- Settings → Notifications: toggle each of 9 kinds → `PUT /api/me/notification_prefs` fires (debounced)
- Settings → Permissions: status text matches actual OS state; tap → opens system Settings
- Settings → Sync now → flushes queue; Reset app data → confirm dialog → cache cleared
- App icon: renders on home screen in light + dark wallpaper context

---

## 17. Screen-level acceptance criteria

(Identical to the Claude Code handoff §17 — won't repeat. Run these per screen before declaring the subagent's task complete.)

---

## 18. Accessibility checklist

- [ ] Every touchable has `accessibilityLabel`
- [ ] Hit targets ≥ 44×44 iOS / 48×48 Android (`hitSlop` if visual size is smaller)
- [ ] Dynamic Type / font scaling respected; test at 200%
- [ ] Contrast ≥ 4.5:1 body, 3:1 large — verify light + dark
- [ ] Approval banner reads as a single button to assistive tech
- [ ] Devanagari subtitles labeled with English equivalent
- [ ] `prefers-reduced-motion` respected — skip slide transitions

---

## 19. Performance budgets

| Metric | Target |
|---|---|
| Cold start → Today interactive | ≤ 1.5s on Pixel 6a |
| Bundle size | ≤ 12 MB |
| Today scroll | 60 fps with 100 items (`FlashList`) |
| Board view switch | < 100ms perceived |
| Image attachment | resize to max 2048px before upload |
| Memory | < 200 MB resident on iPhone 13 mini |

---

## 20. Release checklist

### Internal alpha (TestFlight + Play Internal)
- [ ] §17 acceptance pass on at least one device per platform
- [ ] Firebase Crashlytics live; verify a deliberate crash reaches the dashboard
- [ ] Offline mode tested with airplane mode for ≥ 5 minutes of edits
- [ ] All EAS preview env vars set
- [ ] `GoogleService-Info.plist` + `google-services.json` baked into the build

### Public production
- [ ] App Store + Play Store screenshots (5 + 3 sizes) generated from the design canvas
- [ ] Privacy nutrition labels + Data Safety filled in
- [ ] Privacy policy + ToS URLs added to store listings
- [ ] FCM service account JSON uploaded to EAS Secrets
- [ ] Force-update mechanism wired (read min-supported version from `/api/me`)
- [ ] Crash-free session rate ≥ 99.5% across 7-day alpha cohort

---

## 21. Open questions

These need human input — the Manager should park them as TODOs, not let a subagent guess:

1. **Project colours** — schema has no colour column; derive from hash, or add a column?
2. **Quiet hours per project** — owners on call may want override; defer or ship?
3. **"Mine only" comment definition** — does a mention of you count even when not assigned?
4. **Attachment thumbnails** — server-side, or client-resize on first view?
5. **Voice-to-comment** — raw `.m4a` playback, or Whisper-transcribe first?
6. **Reset app data while offline** — drop queued mutations silently, or confirm?
7. **Multi-device push** — add "Pause notifications on this device" toggle?

---

## 22. Antigravity-specific tips

These don't apply to other coding agents — they're Antigravity / Gemini 3 idioms worth using:

1. **Lean on Gemini's 1M context.** Don't summarize this file or the design canvas before feeding them to the Editor. Attach the whole `Kartavya Mobile.html` + this MD + `backend/server.py` + the existing `mobile/src/screens/*` to the workspace and let Gemini see them in one shot.
2. **Use the browser tool for native module spelunking.** When a subagent hits a native-build issue, let it open the Expo or RN docs directly rather than guessing — Antigravity's browser is faster than a `web_search` round-trip.
3. **Plan Artifacts first, code after.** For each subagent, have the Manager produce a Plan Artifact that references this file's sections by number, then approve before any code is written. This prevents the "Editor wanders off into refactoring" failure mode.
4. **Walkthrough Artifacts as PR review.** Treat §16 Walkthroughs as the deliverable that gates merge — not the code itself. A subagent that can't produce a clean Walkthrough hasn't finished, no matter how green the diff looks.
5. **Multimodal QA.** Gemini 3 can compare a screenshot from the running app against an artboard image in the design canvas. Use it as the first pass on visual regressions before a human sees a build.

---

## 23. References

- Design canvas: `Kartavya Mobile.html`
- Mock data: `mobile/mobile-shared.jsx`
- Backend models: `backend/server.py` (Pydantic) + `backend/approvals_router.py`
- Existing mobile app: `mobile/src/screens/*.js` in [`kevalvshah/Kartavya`](https://github.com/kevalvshah/Kartavya)
- Brand: `README.md` + `V2_PLAN.md` § 2
- Claude Code variant of this handoff: `CLAUDE_CODE_HANDOFF.md` — same scope, APNs+FCM split instead of FCM-only

---

*Kartavya (कर्तव्य) — Sanskrit for "duty" or "that which must be done"*
*Designed for Aekam Inc · 2026*
