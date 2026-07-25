# 07 · Pahchan (attendance)

Prereq: `00-tokens.md`, `02-common-components.md`, `17-mobile-app.md`. Policy, offline rules and payroll interaction in `MESSAGING-ATTENDANCE-SPEC.md` §Pahchan.

Design source: `ScreensPahchan.jsx` (desktop), `Mobile.jsx` → `MPahchan` (phone, primary).

---

## Pahchan does not exist in the codebase

Searched both trees at `staging` for `pahchan|attend|clock|face`:

- `frontend/src/**` — **0 of 158 files**
- `mobile/src/**` — **0 of 49 files**

There is no page, no screen, no service, no table, no endpoint. **Every line of this feature is net-new**, so this file has no before/after table — it is a build spec, and the "what changes" section is about what Pahchan *adds to* existing files, not what it modifies.

That also means the design decisions in `MESSAGING-ATTENDANCE-SPEC.md` are not corrections to an existing behaviour — they are the behaviour. Two of them are load-bearing and should not be traded away in implementation:

1. **The recorded timestamp is when the punch happened, not when it synced.** A worker on a basement site clocks in at 09:02, the phone reaches signal at 13:40, and the record must say 09:02. Payroll reads this table. If it says 13:40 the worker loses four hours of pay through a network condition they cannot control.
2. **A face match failure never blocks the punch.** It flags for review. Attendance is a pay record; a false negative from a low-light selfie must not cost someone a day's wages. The reviewer resolves it.

---

## 1 · Surface split

Pahchan is **phone-first**. The camera, GPS and the person doing the punching are all on the phone; the desktop surface exists for the person *reviewing*.

| Surface | Job |
|---|---|
| Mobile app | Clock in / out, own history, own regularisation requests |
| Mobile web | Same, minus face capture (no reliable camera API parity) — GPS + selfie upload |
| Desktop | Team register, exceptions queue, regularisation approvals, payroll export, policy |

Desktop has no clock-in control. Someone sitting at a desktop in the office is not who this feature is for, and offering it there invites punching for a site you are not at.

---

## 2 · Exact CSS — mobile capture

```css
.pc{position:absolute;inset:0;display:flex;flex-direction:column;background:#0A0C0B;color:#fff}
.pc__cam{position:absolute;inset:0;background:linear-gradient(155deg,#1C2420,#0C100E 60%,#141A17)}
.pc__top{position:relative;z-index:3;display:flex;align-items:center;gap:10px;padding:calc(var(--m-safe-t,56px) + 6px) 16px 10px}
.pc__x{width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.14);backdrop-filter:blur(8px);display:grid;place-items:center;color:#fff}
.pc__ttl{font-size:14px;font-weight:600}
.pc__hi{font-family:var(--font-indic);font-size:11px;color:rgba(255,255,255,.6)}
```

The capture screen is **immersive** — it runs edge to edge under a transparent status bar with light glyphs, in both light and dark app themes. A cream status bar above a black camera view is the single most obviously-broken thing on this screen, and it is invisible in dark mode, which is where it will be tested. `barStyle="light-content"` + `translucent`, `SafeAreaView edges={[]}`, and the close button offset past the notch.

### Face frame and scan sweep

```css
.pc__frame{position:relative;z-index:2;align-self:center;margin-top:auto;width:236px;height:236px;border-radius:50%;border:2px solid rgba(255,255,255,.28);display:grid;place-items:center;overflow:hidden}
.pc__frame.on{border-color:var(--primary)}
.pc__ring{position:absolute;inset:-2px;border-radius:50%;border:2px solid transparent;border-top-color:var(--primary);animation:pcSpin 1.15s linear infinite}
.pc__sweep{position:absolute;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,var(--primary),transparent);animation:pcSweep 1.6s var(--ease-standard) infinite}
@keyframes pcSpin{to{transform:rotate(360deg)}}
@keyframes pcSweep{0%{top:12%;opacity:0}20%{opacity:1}80%{opacity:1}100%{top:88%;opacity:0}}
.pc__ok{position:absolute;inset:0;display:grid;place-items:center;background:color-mix(in srgb,var(--ok) 22%,transparent);animation:dmFade var(--dur-base)}
```

Both animations must stop under `prefers-reduced-motion` — a spinning ring with a sweeping line is exactly the pattern that triggers vestibular discomfort. Replace with a static ring and a text status.

### Status chips

```css
.pc__chips{position:relative;z-index:3;display:flex;flex-wrap:wrap;justify-content:center;gap:7px;padding:16px}
.pc__chip{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:var(--r-pill);background:rgba(255,255,255,.12);backdrop-filter:blur(10px);font-size:11.5px;color:rgba(255,255,255,.9)}
.pc__chip svg{width:13px;height:13px;flex-shrink:0}
.pc__chip--ok svg{color:#6FBF8F}
.pc__chip--warn{background:color-mix(in srgb,#E8A33D 26%,transparent)}
.pc__chip--off{background:color-mix(in srgb,#E07B5A 26%,transparent)}
```

Three facts, always visible before the punch: **GPS** (locked / weak / off, with the site name when matched), **face** (ready / no face / low light), **connection** (online / offline, and when offline that the punch is stored with its real time).

### Punch button

```css
.pc__go{position:relative;z-index:3;margin:0 16px calc(var(--m-safe-b,22px) + 8px);height:56px;border-radius:var(--r-pill);background:var(--primary);color:var(--on-primary);font-size:16px;font-weight:700;letter-spacing:-.01em;display:flex;align-items:center;justify-content:center;gap:9px}
.pc__go:disabled{background:rgba(255,255,255,.16);color:rgba(255,255,255,.5)}
.pc__go--out{background:#C4553D}
```

56px, full width less margins — this is pressed by someone standing outside a gate, possibly in gloves, possibly in sunlight. Clock-out is a distinctly different colour from clock-in; the two actions are one tap apart and mixing them up costs a corrected timesheet.

### Clocked-in state

```css
.pi{padding:18px;border-radius:var(--r-lg);background:color-mix(in srgb,var(--ok) 10%,var(--surface));border:1px solid color-mix(in srgb,var(--ok) 32%,transparent)}
.pi__t{font-family:var(--font-mono);font-size:38px;font-weight:600;letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1}
.pi__since{font-size:12px;color:var(--on-surface-3);margin-top:5px}
.pi__row{display:flex;align-items:center;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid color-mix(in srgb,var(--ok) 20%,transparent);font-size:12px;color:var(--on-surface-2)}
```

`tabular-nums` on the running total, and it recomputes from `clocked_in_at` each tick rather than incrementing a counter — same rule as the drawer's `ElapsedTimer`, so a backgrounded phone doesn't drift.

### Attendance calendar

```css
.pcal{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
.pcal__d{aspect-ratio:1;border-radius:var(--r-sm);display:grid;place-items:center;font-family:var(--font-mono);font-size:11.5px;background:var(--s-container);color:var(--on-surface-3)}
.pcal__d--full{background:color-mix(in srgb,var(--ok) 74%,transparent);color:#fff}
.pcal__d--half{background:linear-gradient(105deg,color-mix(in srgb,var(--ok) 74%,transparent) 50%,var(--s-container) 50%)}
.pcal__d--late{background:color-mix(in srgb,var(--warn) 62%,transparent);color:#3A2A08}
.pcal__d--abs{background:color-mix(in srgb,var(--danger) 20%,transparent);color:var(--danger)}
.pcal__d--leave{background:var(--primary-container);color:var(--on-primary-container)}
.pcal__d--hol{background:transparent;border:1px dashed var(--outline-variant)}
.pcal__d--future{opacity:.34}
```

Seven states, and every one needs to be distinguishable **without colour** for the ~8% of male users with a red-green deficiency — half-day is a diagonal split, holiday is a dashed outline, absent is a tint rather than a fill. A legend is mandatory, not optional.

---

## 3 · Desktop review CSS

```css
.preg{width:100%;border-collapse:collapse;font-size:13px}
.preg th{position:sticky;top:0;z-index:2;padding:9px 12px;text-align:left;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--on-surface-3);background:var(--s-low);border-bottom:1px solid var(--outline-variant)}
.preg td{padding:9px 12px;border-bottom:1px solid color-mix(in srgb,var(--outline-variant) 60%,transparent);font-variant-numeric:tabular-nums}
.preg tr.flag{background:color-mix(in srgb,var(--warn) 7%,transparent)}
.pexc{display:flex;gap:12px;padding:13px 15px;border-radius:var(--r-md);border:1px solid color-mix(in srgb,var(--warn) 34%,transparent);background:color-mix(in srgb,var(--warn) 7%,transparent)}
.pexc__ph{width:52px;height:52px;border-radius:var(--r-sm);object-fit:cover;flex-shrink:0;background:var(--s-high)}
```

The exceptions queue shows the captured selfie beside the claim, because a reviewer deciding whether a 09:02 punch from 400m off-site is legitimate needs to see the photo and the map pin together, not click through to them.

---

## 4 · Component trees

```
mobile
PahchanScreen                            mobile/src/screens/PahchanScreen.tsx
├── CameraView       expo-camera, immersive
├── FaceFrame        ring · sweep · match result
├── StatusChips      GPS · face · connection
├── PunchButton      in / out, distinct colours
└── PostPunch        running total · site · offline note

PahchanHistoryScreen
├── MonthCalendar    7 states + legend
├── DayDetail        in/out, hours, flags, photo
└── RegulariseSheet  reason, evidence, submit

desktop
PahchanPage                              frontend/src/pages/PahchanPage.jsx
├── Tabs  Register · Exceptions · Regularisations · Policy
├── RegisterTab   date · team filter · export
├── ExceptionsTab photo + map + resolve
├── RegularisationsTab  approve / decline with reason
└── PolicyTab     sites, geofence radius, grace, shifts
```

---

## 5 · New files

```
mobile/src/screens/PahchanScreen.tsx
mobile/src/screens/PahchanHistoryScreen.tsx
mobile/src/components/pahchan/FaceFrame.tsx
mobile/src/components/pahchan/StatusChips.tsx
mobile/src/components/pahchan/MonthCalendar.tsx
mobile/src/services/pahchan.ts
mobile/src/offline/punchQueue.ts            builds on offline/mutationQueue.ts
frontend/src/pages/PahchanPage.jsx
frontend/src/pages/pahchan/RegisterTab.jsx
frontend/src/pages/pahchan/ExceptionsTab.jsx
frontend/src/pages/pahchan/RegularisationsTab.jsx
frontend/src/pages/pahchan/PolicyTab.jsx
frontend/src/styles/pahchan.css
```

---

## 6 · Endpoints — all new

| Endpoint | Notes |
|---|---|
| `POST /v1/pahchan/punch` | `{type: in\|out, occurred_at, lat, lng, accuracy_m, site_id?, selfie_key?, face_score?, device_id, client_punch_id}` |
| | **`occurred_at` is client-supplied and authoritative** for the pay record. `received_at` is stamped server-side. Both are stored; the delta drives the "synced late" flag |
| | `client_punch_id` is a client-generated UUID — the idempotency key that makes a retried offline punch safe |
| `GET /v1/pahchan/today` | current state: clocked in since, site, today's total |
| `GET /v1/pahchan/me?month=` | own history for the calendar |
| `POST /v1/pahchan/regularise` | `{date, requested_in, requested_out, reason}` |
| `GET /v1/pahchan/register?date=&team_id=` | team register — needs a Manav grant |
| `GET /v1/pahchan/exceptions?state=open` | flagged punches with selfie URL + distance |
| `POST /v1/pahchan/exceptions/:id/resolve` | `{decision, note}` — always audited |
| `GET/PATCH /v1/pahchan/policy` | sites, geofence radius, grace minutes, shift windows |
| `GET /v1/pahchan/export?month=&format=csv` | payroll hand-off; must state which punches are still unresolved |

New tables: `pahchan_punches`, `pahchan_sites`, `pahchan_exceptions`, `pahchan_regularisations`, `pahchan_policy`.

**Selfies are private-bucket only, with signed short-lived URLs.** They are biometric-adjacent personal data of employees; a public R2 URL for a face photo is a serious exposure. Retention should be a policy field (default 90 days), and the punch record must survive the photo's deletion.

---

## 7 · What Pahchan adds to existing files

| File | Change |
|---|---|
| `mobile/src/nav/RootStack.tsx` | Pahchan route; the More grid entry; deep link from the Today clock-in card |
| `mobile/src/screens/TodayScreen.tsx` | The clock-in card, which becomes a running-hours card once clocked in |
| `mobile/src/offline/mutationQueue.ts` | Punches join the existing queue. They need a **72-hour** retention (a weekend site with no signal) rather than the default, and must never be dropped on failure — a discarded punch is an unpaid day |
| `mobile/src/theme/tokens.ts` | Needs the warm-earthy palette first (`17-mobile-app.md`) — Pahchan is the most colour-dependent screen in the app |
| `frontend/src/App.jsx` | `/pahchan` route |
| `frontend/src/components/layout/Sidebar.jsx` | Pahchan nav item, gated on the Manav module + grant |
| `RBAC-SPEC.md` grants | `pahchan.self` (everyone), `pahchan.team` (viewer/editor), `pahchan.review` (admin) — reviewing your own exception is a conflict and must be blocked |

---

## 8 · Two things to settle before building

**Face matching needs a provider decision.** On-device (fast, private, no per-call cost, weaker) versus a cloud vision API (stronger, per-call cost, sends employee faces to a third party). This is a privacy and cost decision, not a design one, and it changes the consent copy on first run.

**Geofence radius is a policy trap.** Too tight and legitimate punches from a gate 60m from the pin get flagged; too loose and the geofence means nothing. Default 150m, configurable per site, and the exceptions queue should surface the distance so an admin can tune from real data rather than guessing.
