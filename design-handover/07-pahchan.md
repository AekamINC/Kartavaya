# Pahchan — attendance · पहचान

## Prerequisites
- `00-tokens.md`
- `02-common-components.md`
- `17-mobile-app.md` — the RN shell this lives in
- `08-rbac-screens.md` — who reviews
- `RBAC-SPEC.md` — role definitions

## Files to modify
- `mobile/src/screens/PahchanScreen.tsx`
- `mobile/src/navigation/` — the two-tab shell variant
- `frontend/src/pages/PahchanPage.jsx` — the register

## Files to create
- `mobile/src/screens/pahchan/ClockScreen.tsx`, `EnrollScreen.tsx`
- `frontend/src/pages/pahchan/Register.jsx`, `EnrollQueue.jsx`, `PahchanPolicy.jsx`
- `frontend/src/lib/punch.js` — the contract below

## Estimated scope
6 screens, 2 shells, 1 policy surface, 1 report. Prototype: `Pahchan v1.html`.

---

## 0 · What v1 is

An employee signs in with **their own account**, takes a **live selfie**, and punches in or out. The organisation verifies by **human comparison** against two reference photos captured at enrollment.

Face matching is parked to v2. Device enrollment is dropped.

Three things follow from that, and they shape every screen:

**Human comparison is the only verification.** Not a fallback, not a second opinion — the whole mechanism. If the reviewer cannot keep up, the feature is theatre. §3 exists to make a day clearable in seconds.

**The selfie is the only identity evidence.** Login proves who holds the credentials, not who is standing there. Nothing else in the punch is hard to fake — coordinates are spoofable for free, a timestamp is a timestamp. This is why capture is camera-only.

**Two reference photos, captured now, are what make v2 cheap.** They become the embeddings. One frontal photo gives a single embedding that fails on anyone who turns their head; re-enrolling every client's workforce later is the kind of migration that quietly kills a feature. The pair costs one extra tap per employee, once.

## 1 · Camera-only, and no gallery permission

In-app camera. No gallery picker, no "choose existing", and **the gallery permission is never requested** — a granted permission is an attack surface whether or not the UI exposes it.

With login-only auth, a gallery path means one saved selfie works forever, and every punch after the first is a file copy. That is not a degraded version of the feature; it is the absence of it.

Front camera required. This does not defeat the known attack — holding up a printed photograph — but it raises the cost, and the human reviewer is what actually catches it. **Do not remove the reviewer in v2 without adding liveness detection.** An automatic matcher with no liveness check is a downgrade wearing the word "automatic".

Retake limit: **3**. Unlimited retakes let someone hunt for a frame that hides where they are.

## 2 · Nothing blocks a punch

| Condition | Behaviour |
|---|---|
| Location off | Record, flag, tell the employee it will be flagged |
| Accuracy worse than ±100m | Record, flag, show the reviewer the accuracy radius |
| Outside the geofence | Record, flag — configurable, default allow |
| No connection | Queue on device, send on reconnect, mark `src: offline` with the sync time |
| No reference pair | Record, flag, prompt HR to enroll |
| Mock location detected | Record, flag prominently — see §8 |

Field staff are the reason this module exists. A blocked punch at a client site becomes a payroll dispute a week later, and the employee is right. Every degraded case records and flags.

**Weak GPS is not fraud.** Indoor and basement fixes routinely exceed ±100m. Blocking on accuracy locks out warehouse and parking-level staff specifically.

## 3 · The register — the surface that decides whether this works

A reviewer sees the punch selfie **and both references inline on every row**, at 50×62 — large enough to recognise a face without opening anything. Twelve punches is one scroll and twelve glances.

The failure mode to design against is the click-into-each-record list. Twelve punches at three clicks each is thirty-six interactions before anyone has looked at a face, and a reviewer who cannot keep up **confirms everything without looking** — which is worse than no review, because it manufactures a record of verification that did not happen.

```
J / K or ↑ / ↓   move
↵                confirm, advance
F                flag, advance
O                open the detail
```

Keyboard is what makes "seconds" true. Mouse-only is one row at a time no matter how dense the layout.

Row grid: `26px 1fr 176px 118px 96px 88px` — index, person + flags, the triple, time, where, verdict. Below 900px the location and verdict columns drop and the row becomes index / person / triple / time; a reviewer on a phone is triaging, not clearing a day.

**Default filter is "needs a look".** Requiring a verdict on every clean row is the same rubber-stamp trap. Policy sets whether clean rows need a verdict at all; default is no.

### The detail

Opens inline, for outliers only. Three photos at full size, the map, and the metadata. **The accuracy figure is drawn as a radius on the map, not a dot** — a dot makes a ±184m fix look like proof of presence, which is the one thing it is not.

`No reference pair` suppresses the confirm affordance and offers *Send enrollment request* instead. There is nothing to compare against, so confirming is not verification, it is trust with a checkmark on it.


## The keyboard handler has two traps, and both bite in production

The register is built for burst review — J/K to move, ↵ to confirm, F to flag. Both of these were live in the prototype and are easy to reproduce in any implementation.

**A handler closing over `cursor` reads a stale value for every press in a burst.** React batches, so five fast confirms called `setVerdict(v => ({...v, [cur.id]: 'ok'}))` with the *same* `cur` five times while `setCursor(c => c + 1)` advanced correctly five times. The counter said one row reviewed and four people were silently skipped — in the queue whose whole purpose is not skipping anyone. Functional `setState` does not save you here: the *value read from the closure* is stale, not the state being written.

Keep the cursor in a ref that mutates synchronously, and route every write through one `seek()`:

```js
const curRef = useRef(0);
const seek = n => { curRef.current = Math.max(0, Math.min(n, rows.length - 1)); setCursor(curRef.current); };
const record = val => {
  const row = rows[curRef.current];
  if (!row) return;
  setVerdict(v => ({ ...v, [row.id]: val }));
  seek(curRef.current + 1);
};
```

Row clicks and filter resets must call `seek` too, or the ref desyncs from the highlight.

**Bind the listener only when rows are on screen.** `if (state !== 'ready' || !rows.length) return;` before `addEventListener`. Otherwise ↵ during a fetch records a verdict against a row the reviewer cannot see — and that is exactly when it happens, because someone mid-burst keeps pressing while the next page loads. Gate by not binding rather than by early-returning inside the handler; there is then no path at all.

The same rule applies to any list with a loading state and a keyboard shortcut that writes.

## Reuse before you create

The prototype is standalone HTML and hand-rolls everything; that is a constraint of the format, not a design decision. **Every row below already exists in `frontend/src`.** Verified against the branch — two paths that look plausible do *not* exist: there is no `components/navigation/` and no `components/data-display/`.

| Prototype | Use instead | Real path |
|---|---|---|
| `.ph-seg` (All 12 / Needs a look 6) | `Seg` | `components/customize/Seg.jsx` |
| `.rv__hd` + `.rv__r` grid, §07 `<table>` | `DataTable` / `Td` | `components/editorial/ModuleUI.jsx` |
| `.rv__flag--*` | `StatusChip` | `components/editorial/StatusChip.jsx` |
| `.ph-card` | `Card` | `components/editorial/Card.jsx` |
| `.ph-sec` head | `Section` | `components/editorial/ModuleUI.jsx` |
| register empty / finished | `EmptyState` | `components/ui/EmptyState.jsx` |
| `.rv__sk` | `SkeletonTable` + `SkeletonRegion` | `components/ui/Skeleton.jsx` |
| `.rv__state--err` | `ErrorState` | `components/ui/ErrorState.jsx` |
| page frame | `PageHeader`, `TabBar` | `components/editorial/` |
| `.ph-note` | `Note` | `components/module/Note.jsx` |

Everything reachable through `import { … } from '../components/editorial'` — see `editorial/index.js`, which re-exports `TabBar, Section, Badge, Shimmer, Empty, BackButton, ModCard, DataTable, Td` from `ModuleUI.jsx`.

**Genuinely new, because no primitive covers them:** `.pc__*` (the viewfinder — a full-bleed camera surface with an overlaid transparent status bar), `.rv__trip` (the punch-and-two-references comparison), `.en-slot` (the enrollment capture slot), `.pcal__*` (the month calendar). Build these; do not build the rest.

### `Seg` has no count prop

`Seg({ options, value, onChange, label })` where `options` is `[{value, label}]`. The register control needs "All 12" and "Needs a look 6", so either fold the count into `label` or add an optional `count` rendered as a trailing `.seg__n`. Prefer the latter — the count is a distinct piece of information and folding it into a string makes it untranslatable.

### Attendance states are not in `statusColors.js`

`STATUS_COLORS`, `APPROVAL_COLORS`, `PRIORITY_COLORS`, `BILLING_COLORS` and `ORDER_COLORS` are all there; none covers a punch. Add a sixth map rather than a tenth private one:

```js
// Attendance review flags (Pahchan). Not task status — a flagged punch is a
// question for a reviewer, not a failed state, so nothing here is --danger
// except a hard geofence breach.
export const PUNCH_COLORS = {
  late:     'var(--warn)',
  overtime: 'var(--warn)',
  geo:      'var(--danger)',
  accuracy: 'var(--tertiary)',
  offline:  'var(--st-in-progress)',
  clean:    'var(--ok)',
};
export const PUNCH_LABELS = {
  late: 'Late', overtime: 'Overtime', geo: 'Outside site',
  accuracy: 'Weak GPS', offline: 'Sent later', clean: 'Clear',
};
```

### `Badge` is broken and Pahchan must not use it

```jsx
export function Badge({ text, color }) {
  const c = color || '#6E7B91';
  return <span className="k-badge" style={{ background: `${c}18`, color: c }}>{text}</span>;
}
```

`statusColors.js` now returns `var(--st-done)`, so `${c}18` produces the string `"var(--st-done)18"` — not a colour. **Every `Badge` fed from a status map currently renders with no background**, including every order badge in `VikrayPage.jsx`. `statusColors.js` documents this exact hazard and ships `mixAlpha(color, pct)` for it; `Badge` predates the fix and never adopted it.

Two changes: `background: mixAlpha(c, 10)`, and `color` must come from an `on-` token rather than the same hue as the tint — a chip tinted with its own foreground can never reach 4.5:1, which is the finding in `00-tokens.md`. `StatusChip` already does this correctly with `style={{'--c': s.color}}` and a separate dot, so **prefer `StatusChip` over `Badge` everywhere.**

### Two empty-state components exist

`ModuleUI.Empty` defaults to the emoji `📋` and is used across the module pages. `ui/EmptyState.jsx` has eight real SVG illustrations, bilingual `{en, hi}` titles and a proper CTA — but is still on Tailwind classes (`text-textDefault`, `cn`) from the old system. **Use `EmptyState`, and port it off Tailwind**; the design system has no emoji.

## The register needs four states, and two of the empties are different

```
loading   SkeletonRegion + SkeletonTable. The skeleton must SHARE the real
          row's rules, not mirror them, and that means BOTH levels:

            row   add .rv__skr to the .rv__r selector list and to the
                  900px override, rather than authoring a second grid.
            cell  give each skeleton cell the real cell class —
                  .rv__n, .rv__who, .rv__trip, .rv__t, .rv__loc, .rv__v —
                  each wrapping its .skb blocks.

          Sharing only the grid fixes the columns and leaves every
          cell-level rule unreached. The 900px branch collapses to four
          columns via .rv__loc,.rv__v{display:none}; anonymous <span
          class="skb"> cells cannot be hidden, so six cells wrapped
          inside a four-column grid — a 192px jump on mobile, worse than
          the 155px desktop jump that sharing the grid had just fixed.

          The column header renders during loading too. It labels the
          table, so it belongs to any state where a table is present or
          arriving — bind it to hasTable, not to state === 'ready'.
          Not shown for empty or error, where column labels would sit
          over nothing.

          Size the photo slots to the real 50x62; the three-face
          comparison is what the row is for, and it also makes the row
          resolve to the right height with no explicit min-height.
          No entrance animation — a skeleton that fades in postpones the
          feedback it exists to give. The shimmer is the animation.
empty     "Nobody has clocked in yet." Not an error. On a normal weekday
          the first punches land 9:00–9:40, so say that.
finished  Filter on, zero rows. "Nothing needs a look — every punch today
          cleared the checks." A FINISHED queue, not an empty one, and it
          gets --ok and a check, because reaching it is the goal.
error     "The register did not load. Punches are safe — this is a read
          failure, not data loss." Retry + Work offline.
```

The third is the one that gets missed. Reusing the "nothing here" empty for a cleared filter tells a reviewer who has just finished their work that something is missing.

## 4 · The punch contract

```ts
{
  id: string,
  employee_id: string,
  direction: 'in' | 'out',
  captured_at: string,        // ISO 8601 with offset, device clock
  received_at: string,        // server clock — these differ on offline sync
  photo_key: string,          // object store; never a URL in any payload
  lat: number, lng: number,
  accuracy_m: number,         // metres, always present, never rounded to 0
  distance_m: number,         // from the assigned geofence centre
  geofence_id: string | null,
  source: 'live' | 'offline',
  synced_at: string | null,
  mock_location: boolean | null,   // null = not checked on this platform
  flags: ('late'|'geo'|'noref'|'accuracy'|'offline'|'overtime'|'mock')[],
  review: { by: string, at: string, verdict: 'ok'|'flagged' } | null
}
```

`captured_at` and `received_at` are both required and are **not interchangeable**. An offline punch captured at 09:41 and synced at 11:38 is a 09:41 punch; using the receipt time silently rewrites attendance for anyone with poor signal. The gap between them is also the only honest place to spot a device clock that has been moved.

`accuracy_m` is never omitted and never defaulted to 0. A missing accuracy is `null` and flags.

## 5 · Retention

| | |
|---|---|
| Reference photos | Employment + **45 days**, then deleted |
| Punch selfies | **90 days**, then deleted |
| Punch records | **3 years, 5 in some states** — configurable, see §8 |

Deleted means deleted, not archived to cold storage. A retention promise with an archive behind it is not a retention promise.

The three classes are independent. Deleting the photo at 90 days must not cascade to the record, and expiring the record must not orphan a photo.

## 6 · Emailed reports carry no photographs

Times, hours, flags, exceptions, totals. Nothing else.

A mailbox is not a place retention can be enforced. Once an image leaves the portal the 90-day deletion is a promise nobody can keep — it sits in a mail server, a phone, a backup, and an IT team's archive, none of which Kartavaya can reach.

The email links back to the portal. Photographs stay behind auth, where the deletion job can actually reach them.

## 7 · What Aekam sees

**The count of Pahchan users per organisation. Nothing else.** No names, no photographs, no locations, no times.

Enforce this in the query, not the view. A console endpoint that fetches the roster and returns a length has already read the roster, and the first support ticket asking "which employee?" is one line away from being answerable. The platform endpoint returns a scalar.

## 8 · What the research changed

Four findings, verified against sources rather than assumed. Two contradict the brief.

### v2 face matching will require consent collected again

The brief asked for wording that lets v2 start without re-collecting consent. **It cannot, and the spec should say so plainly rather than attempt it.**

Attendance processing for an employment relationship is arguably a *legitimate use* under the DPDP Act 2023 — which means a **notice** is required, not consent. Automated face matching is a different purpose, and consent under the Act must be specific and granular; bundled or blanket consent is expressly not valid. A forward-looking clause covering "any future biometric processing" is precisely the bundling the rules prohibit, and it would be the first thing struck down.

Practical consequence: the v1 screen is a **notice**, not a consent form, and it states that face recognition is not used and that the employee will be asked separately if it ever is. Budget a consent collection pass as part of v2 scope.

*Checked: DPDP Act 2023 §7 legitimate use; DPDP Rules notified 13 Nov 2025 with phased commencement. Not a legal opinion — have counsel confirm before launch.*

### The punch record outlives the photo, by law

The brief sets retention for both photo classes and is silent on the record. State Shops & Establishments rules require an attendance register — name, hours worked, time of arrival and departure — to be preserved, commonly **three years after the last entry and five in some states**, with formats prescribed per state.

That is the one retention obligation carrying a statutory penalty, and it was not a field. It is now, defaulting to the longer figure.

It also settles what the monthly register in §6 must contain: those four columns are not a design choice, they are the muster roll.

### Mock location is table stakes

Not in the brief. A mock-location app spoofs coordinates in roughly thirty seconds, and Indian competitors in this segment block the check-in outright on detection.

Coordinates that can be faked for free are not evidence. v1 detects and flags rather than blocking — consistent with §2, and because detection is imperfect and a false positive would strand a legitimate employee. `mock_location: null` where the platform cannot check, so the reviewer can tell "not detected" from "not checked".

### A printed photo defeats a plain selfie

The standard attack. v1's answer is the human reviewer, and it is genuinely a good one — a person spots a photo-of-a-photo immediately where a naive matcher does not.

This is the strongest argument for keeping the reviewer in the loop during v2 rollout rather than switching over. Recorded here because the reasoning is easy to lose once "automatic" is on the roadmap.

## 9 · The two-tab shell

For someone whose entire relationship with Kartavaya is attendance — a driver, a site worker, a shop assistant. **Clock** and **Me**. No modules, no boards, no inbox.

Same account, same permissions, same backend. A shell selected by role, not a second product. The full eight-tab bar is right for staff who live in Kartavaya and wrong for someone who opens it twice a day.

*Me* carries the employee's own reference pair and the retention promise in plain words. Someone whose face is photographed twice a day should be able to see what is held and for how long without asking.

## 10 · Policy

Fifteen values across four groups; eleven editable, four fixed. The fixed ones are fixed because making them configurable lets an organisation configure the feature into meaninglessness — a gallery path, unlimited retakes, or indefinite photo retention would each do that on their own.

Full table with the reasoning per value: §06 of `Pahchan v1.html`.

The one to argue about is **`Unreviewed after 7 days → auto-accept`**. Silence is a policy whether or not it is written down; this makes it explicit and configurable. The alternative — rows accumulating forever in an unreviewed state — is a queue that becomes unusable in a month and then gets ignored, which is the same outcome without the honesty.
