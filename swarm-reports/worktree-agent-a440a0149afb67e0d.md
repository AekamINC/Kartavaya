# Pahchan — STRUCTURE lens

Branch: `worktree-agent-a440a0149afb67e0d`, cut from `staging` (`e9134b2`).

**The worktree was created from the wrong base.** HEAD was `1aa4985` — 507 commits
behind `staging` and 13 commits ahead on an abandoned lineage (R2 signed-URL fixes
that staging already carries functional equivalents of, per `_COORDINATION.md` §3).
`frontend/src/pages/pahchan/` and `backend/routers/pahchan.py` did not exist on it.
Reset to `staging` before any work. **If your surface "does not exist", check your
base before concluding the brief is stale** — this is `_COORDINATION.md` §1 with a
different lineage.

Reference rendered, not read: `frontend/public/__ref/Pahchan v1.html` on the
`kartavya-frontend` preview. Nine sections confirmed live, `.rv__r` renders 15 rows,
`.rv__hd` reads `['', Person, Punch · reference pair, Time, Where, Verdict]`.

---

## 1 · Every screen, enumerated

Sources: `Pahchan v1.html` §01–§09 (driven by `PahchanClock.jsx`, `PahchanAdmin.jsx`,
`PahchanReview.jsx`, `PahchanData.jsx`), `ScreensPahchan.jsx` (the earlier full-module
mockup inside `Kartavaya Redesign.html`), `design-handover/07-pahchan.md`, and
`17-mobile-app.md`'s screen table.

| # | Screen | Reference | In the build | Endpoint |
|---|---|---|---|---|
| 1 | Clock in / out — immersive camera | §01 `PhClock` | `mobile/…/pahchan/ClockScreen.tsx` ✅ | `POST /punch`, `/punch/photo` |
| 2 | Degraded punch states (GPS off, weak, offline, no refs) | §02 `PhClock` variants | mobile ✅ | same |
| 3 | **The register** | §03 `PhRegister` | `pages/pahchan/Register.jsx` ✅ | `GET /register`, `PATCH /punches/{id}/review` |
| 3b | **Register inline detail** — three photos full size, map, metadata | §03 `.rv-det` | ❌ **`openId` is written and never read** | `/punches/{id}/photo` |
| 4 | Enrollment capture, two slots | §04 `PhEnroll` | `mobile/…/pahchan/EnrollScreen.tsx` ✅ | `POST /enrollment` |
| 5 | Enrollment approval queue | §04 `PhQueue` | `pages/pahchan/EnrollQueue.jsx` ✅ | `GET /enrollment/queue/pending`, `POST /enrollment/{id}/approve` |
| 6 | Two-tab shell — Clock · Me | §05 `PhMini` | `mobile/…/MeScreen.tsx` + `MyBiometrics.tsx` ~partial | `GET /me` |
| 7 | Privacy notice, six lines | §05 `PhNotice` | mobile — not audited here | none |
| 8 | Policy — geofence, flags, retention, reports | §06 `PhPolicy` | `pages/pahchan/PahchanPolicy.jsx` ✅ | `GET`/`PATCH /policy` |
| 8b | **Shift definition and overtime** (migration 082) | not in the v1 harness; `ScreensPahchan.jsx` `shifts` tab | ❌ **nine columns, no UI** | `PATCH /policy` |
| 9 | Monthly register + the photo-free email | §07 `PhReport` | ❌ none | `GET /me` |
| 10 | **History — month calendar, states, legend** | `17-mobile-app.md:129`, `ScreensPahchan.jsx` `my attendance` | ❌ **none, anywhere** | `GET /me` |
| 11 | **Corrections / regularisation** | `ScreensPahchan.jsx` `regularization` tab | ❌ **none** | `POST`/`GET`/`PATCH /regularisations` |
| 12 | **Push attendance to payroll** | new — no reference | ❌ **none** | `POST /attendance/publish` |
| 13 | Sites / geofence locations | `ScreensPahchan.jsx` `geo-fence` tab | ❌ none | `GET`/`POST /sites` |
| 14 | Platform console — one count | §08 | `AdminOrgsPage.jsx:572` renders it when the payload carries it ✅ | platform |

Web tabs today: **register · enrollment · policy**. Three.

---

## 2 · Verified: the register can verify again

The finding from the last pass — `Triple` initialised `urls.refs = []` and never wrote
to it, so reviewers approved against two boxes showing a loading ellipsis forever —
**has stayed fixed.**

- `GET /register` returns `reference_ids` (`pahchan.py:552-556`, `array_agg(r.id ORDER BY r.slot)`).
- `GET /enrollment/photos/{photo_id}/url` exists (`pahchan.py:741`), signs by row id,
  audits at `severity=warn`, and admits self **or** `_may_view_others_biometrics`.
- `Register.jsx:117` fetches it per reference id; `Triple` keeps a per-slot state
  machine (`load` | `ok` | `gone` | `err`) so a retention-deleted photo does not read
  as a permanent spinner.
- `EnrollQueue.jsx:46` uses the same endpoint, so HR now sees the face it is vouching for.

No regression. The effect-dependency `[(referenceIds || []).join(',')]` is also still
in place, which is what stops 36 signed-URL requests per keystroke on a 12-row day.
