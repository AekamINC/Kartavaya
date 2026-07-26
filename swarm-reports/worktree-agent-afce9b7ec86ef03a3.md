# Pahchan — biometric duty of care, module completion

Branch: `worktree-agent-afce9b7ec86ef03a3`
Base: `staging` (worktree was created from a stale 2026-07-24 commit, 272 behind
`origin/staging`; reset to `origin/staging` before any work — the 13 commits it
carried were an abandoned line, unpushed, and are still reachable from other refs).

Spec: `design-handover/07-pahchan.md`. Reference: `design-reference/Kartavaya Redesign/`
(`PahchanClock.jsx`, `PahchanAdmin.jsx`, `PahchanReview.jsx`, `PahchanData.jsx`,
`pahchan.css`, `Pahchan v1.html`, `MESSAGING-ATTENDANCE-SPEC.md`).

**Status: IN PROGRESS — this file is written as I go, per the swarm rules.**

---

## 1 · Architecture claims, verified

Each claim from the task brief, re-read against the branch rather than trusted.

| Claim | Verdict | Evidence |
|---|---|---|
| Offline-first face recognition using face-api.js | **STALE — and correctly so** | `face-api.js` appears nowhere in `mobile/` or `frontend/`. This is not a gap: `07-pahchan.md` §0 says "Face matching is parked to v2… Human comparison is the only verification." The code matches the spec; the brief describing it does not. Building face-api.js in would contradict §0 and §8's DPDP finding that automated matching needs consent collected again. |
| Self-capture enrollment on mobile | **HELD** | `mobile/src/screens/pahchan/EnrollScreen.tsx`; `POST /api/v1/pahchan/enrollment` with `source='self_capture'`, lands pending. |
| Punch queue, 72-hour retention, flushes on reconnect | **HELD** | `mobile/src/offline/punchQueue.ts:38` `PUNCH_RETENTION_MS = 72*60*60*1000`, measured from `captured_at` not enqueue time. |
| Camera-only clock-in screen | **HELD** | `ClockScreen.tsx:258` `<CameraView facing="front">`; no `expo-image-picker` anywhere in `mobile/`; no gallery permission requested. |
| Three retention jobs that actually delete | **HELD, with one caveat** — see §3 | `backend/services/pahchan_retention.py` |
| Reviewer side and enrollment register | **HELD as routes, BROKEN as a verification surface** — see §2 | `frontend/src/pages/pahchan/{Register,EnrollQueue}.jsx` |
| Admin shift policies | **HELD** | `frontend/src/pages/pahchan/PahchanPolicy.jsx`, `PATCH /api/v1/pahchan/policy` |
| Pahchan absent from every nav list | *(another agent owns nav — verified and reported, not edited)* | see §6 |

---

## 2 · The finding that matters most: the register cannot verify anything

`07-pahchan.md` §3 calls the register "the surface that decides whether this
works", because human comparison is the **only** verification mechanism in v1.
It does not work, and the failure is silent.

**`frontend/src/pages/pahchan/Register.jsx`, `Triple` component.**

```js
const [urls, setUrls] = useState({ punch: null, refs: [] });

useEffect(() => {
  api.get(`/v1/pahchan/punches/${punchId}/photo`)
    .then(r => setUrls(u => ({ ...u, punch: r.data.url })))
```

`urls.refs` is initialised to `[]` and **never written to anywhere in the file**.
The effect fetches the punch selfie only. So `urls.refs[0]` and `urls.refs[1]`
are permanently `undefined`, and because `hasRefs` is computed from
`referenceKeys` (which the API *does* return), the two reference slots render
un-muted with no `src` — showing the `…` placeholder forever, indistinguishable
from a slow load.

The root cause is in the backend: **there is no endpoint that signs an
enrollment photo key.** `GET /punches/{punch_id}/photo` signs
`pahchan_punches.photo_key`; nothing signs
`pahchan_enrollment_photos.object_key`. Confirmed by enumerating every
`sign_key` call site in `backend/` — 14 of them, none on an enrollment row.

Consequence, in the spec's own terms: the reviewer sees a selfie next to two
empty boxes and presses ↵. §3 names this exact outcome as the thing to design
against — a reviewer who cannot compare "confirms everything without looking,
which is worse than no review, because it manufactures a record of verification
that did not happen." The keyboard burst-review path makes it fast to do.

**The same root cause breaks `EnrollQueue.jsx`.** Its "Approve" button calls
`POST /enrollment/{photo_id}/approve` without ever rendering the photograph —
the endpoint returns `object_key` and the component ignores it. The router's own
docstring says approving "is the act of vouching that this face belongs to this
employee, and everything downstream rests on that." It is currently vouching
sight-unseen.

**Fix (implemented — see §7):** add a signed-URL endpoint for enrollment photos
with the same audit + gating discipline as the punch photo endpoint, then wire
both surfaces.

---

## 3 · Retention jobs — verified against the "logs but does not delete" failure

`backend/services/pahchan_retention.py`. All three passes issue **real deletes**,
not archive moves and not log lines. Verified statement by statement.

| Job | Deletes object | Deletes/NULLs row | Verdict |
|---|---|---|---|
| `purge_punch_photos` | `storage.delete_file` | `UPDATE … SET photo_key = NULL` | **HELD** — object gone, row kept (§8: the record outlives the photo, by law) |
| `purge_reference_photos` | `storage.delete_file` | `DELETE FROM pahchan_enrollment_photos` | **HELD** |
| `purge_punch_records` | photo first, then row | `DELETE FROM pahchan_punches` | **HELD** — ordering prevents §5's orphan case |

Preconditions that would have made these silent no-ops, all checked:

- **`manav_employees.status` values.** `purge_reference_photos` filters
  `status IN ('terminated','resigned','absconding')`. The column's CHECK
  constraint at `backend/migrations/018_graha_ganit_manav.sql:199-200` is
  `('active','on_notice','terminated','resigned','absconding')` — all three
  match exactly. **HELD.** (`on_notice` correctly excluded — still employed.)
- **`storage.delete_file(key, org_id=…)`** — signature at
  `backend/services/storage.py:257` is `(key: str, org_id: Optional[str] = None)`.
  **HELD.**
- **`storage.sign_key(org_id, key)`** — signature at `storage.py:181` is
  `(org_id: str, key: str)`. Call site passes in that order. **HELD.**
- **Failed deletes do not clear the pointer.** `_delete_object` returns False on
  any unconfirmed deletion and the caller `continue`s without NULLing
  `photo_key`, so tomorrow's run retries. This is the correct conservative
  reading and is the difference between "late" and "orphaned forever". **HELD.**
- **Cron wired.** `POST /api/internal/cron/pahchan-retention` at
  `backend/routers/scheduler.py:61`, secret-gated.

**CAVEAT — the schedule is not proven.** The endpoint exists and is correct, but
I have found no in-repo scheduler entry that calls it daily (no cron manifest,
no Railway cron config committed). The jobs will delete correctly *when invoked*;
whether anything invokes them is external configuration I cannot verify from the
branch. Flagged rather than claimed. See §5 for what I could not finish.

**Second caveat, honest in the code already:** `purge_reference_photos` keys the
45-day grace off `manav_employees.updated_at`, because there is no exit-date
column. Any edit to a terminated employee's record restarts the 45 days. Errs
toward keeping biometric data *longer*, which is the wrong direction for a
retention promise. A dedicated `exited_on` column would fix it; noted as a
schema proposal, not applied.

---

## 4 · Biometric lifecycle, traced end to end

*(section in progress — full trace below in the final report)*

---

## 5 · What I could not finish

*(in progress)*

---

## 6 · Nav

*(in progress — another agent owns nav; verified and reported only)*

---

## 7 · Changes made

*(in progress)*
