# mobile/ test coverage

**Branch:** `mobile-test-coverage`, branched fresh from `origin/staging` at `a1f5dffa`
**Commits:** `126c8134` (+ a follow-up strengthening one guard)
**Gates:** `npm test` → 104 pass / 0 fail · `node node_modules/typescript/bin/tsc --noEmit` → exit 0

---

## Run it

```bash
cd mobile
npm ci                 # ~2 min; produces no .bin, which is why tsc is invoked by path below
npm test               # 104 tests, ~0.4s, no simulator, no network
node node_modules/typescript/bin/tsc --noEmit    # exit 0
```

`npm test` expands to:

```
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
     --import ./src/test/register.mjs \
     --test "src/**/*.test.ts"
```

No new dependency was added. `package.json` gained nothing under `dependencies` or
`devDependencies` — this keeps the bargain the previous author made when they wrote the
first 13 tests against `node:test` specifically to avoid one. `typecheck` was also
repointed at `node node_modules/typescript/bin/tsc` so `npm run typecheck` works.

### What it covers

| Area | Tests | Kind |
|---|---:|---|
| `offline/punchQueue.ts` — 72h buffer, never-drop, ordering, photo lifecycle | 34 | **real** — module executes |
| `screens/pahchan/register.ts` — attendance arithmetic | 12 | **real** |
| `components/screenStatus.ts` — `resolveScreenState`, incl. 4xx | 13 | **real** (pre-existing) |
| `theme/fonts.ts` — `hindi()` / `display()` | 11 | **real** |
| False-empty guard across all 13 state-resolving screens | 8 | source-contract |
| Devanagari typography + the two swapped words | 10 | source-contract |
| `ClockScreen` — retakes, queue-before-network, queued-vs-sent | 16 | source-contract |

"Real" means the module is imported and its functions are called. "Source-contract" means
the `.tsx` file is read as text — see [Honest limits](#honest-limits).

---

## The harness

`mobile/src/test/register.mjs`, loaded via `--import`, registers two synchronous module
hooks (`node:module`'s `registerHooks`, no flag needed on Node 24):

1. **Metro-style resolution.** `punchQueue.ts` writes `import { storage } from '../lib/storage'`.
   Metro resolves that; Node's ESM resolver requires the explicit `.ts`. The hook adds it.
   This is the only piece of Metro reimplemented, and it is why the previous author could
   only test a module that imported nothing.
2. **Native stubs.** `react-native-mmkv`, `expo-crypto`, `expo-file-system`, `react-native`
   and the three `@expo-google-fonts/*` packages are JSI/native bindings that throw off-device.
   Each maps to an in-memory stub in `src/test/stubs/`.

`lib/storage.ts` and `punchQueue.ts` themselves run **unmodified** — only the bindings
underneath them are replaced, so the real JSON round-trip and the real `try/catch` are
exercised.

### No network, structurally

`api/client` is stubbed too, and not for convenience: the real module is an axios instance
whose base URL falls back to the **staging** deployment, and staging shares a Supabase
database with production. The stub has no axios, no URL and no socket, so there is no code
path from this suite to a network. That is a property of the harness, not a promise about
how carefully the tests were written. **No database was read or written at any point.**

### Biometric data

No real face data is used, generated, logged or transmitted. `photo_uri` values in tests are
synthetic paths to files that do not exist; no real file is created or deleted. The queue
holds a pointer and never image bytes — `the queue stores a pointer, never image bytes`
asserts exactly that, and also that the local path is never sent to the server.

---

## A/B: every guard was watched failing

Each fix was reverted in the working tree, the suite run, and the file restored with
`git checkout --`. **20 of 20 mutations produced a red suite.** A guard nobody has seen
fail is not a guard, so this is the table that matters.

| Mutation | Result | First test to fail |
|---|---|---|
| `TodayScreen` drops `isError` | **RED** | isError is wired to a real query flag |
| `InboxScreen` drops `isError` | **RED** | isError is wired to a real query flag |
| `BoardsScreen` drops `isError` | **RED** | isError is wired to a real query flag |
| `TodayScreen` defaults data to `[]` (renamed destructure) | **RED**¹ | the regression screens do not default data to an empty array |
| Pahchan retakes never reset | **RED** | THE RETAKE DEFECT — the counter is reset once a capture lands |
| Retakes reset *before* enqueue (sends 0, not the real count) | **RED** | THE RETAKE DEFECT — … |
| Shutter hidden past the retake limit | **RED** | THE SHUTTER IS NEVER HIDDEN |
| Punch sent before being queued | **RED** | the punch is QUEUED before anything on the network is touched |
| `SrijanScreen` re-bolds `सृजन` | **RED** | no style that names the Devanagari face carries a synthetic weight |
| Messages relabelled `सन्देश` | **RED** | Messages is NEVER labelled सन्देश |
| `NewTaskSheet` label back in one `<Text>` | **RED** | a bilingual "LATIN · देवनागरी" string is always split by BiLabel |
| `screenStatus` loses 4xx handling | **RED** | THE FIX — a 4xx is `request`, not `error` |
| punchQueue drops a punch after 3 attempts | **RED** | a failing punch is kept forever — there is no retry ceiling |
| punchQueue retention cut to 24h | **RED** | PUNCH_RETENTION_MS is 72 hours |
| punchQueue sends before the photo uploaded | **RED** | a punch with no photo_key waits rather than going without one |
| punchQueue regenerates `client_punch_id` on retry | **RED** | client_punch_id is generated once and NEVER regenerated |
| punchQueue replays newest-first | **RED** | replay is oldest-first by captured_at |
| punchQueue silently deletes expired punches | **RED** | an expired punch is RETURNED, not silently deleted |
| `hindi()` emits a weight | **RED** | hindi() NEVER returns a fontWeight |
| `pruneExpired` boundary moved | **RED** | the retention boundary is measured from captured_at |

¹ **This one initially came back GREEN and the guard was strengthened.** The first version of
the regex only matched `{ data = [] }`; the revert used the renamed form
`{ data: tasks = [] }`, which is the spelling this codebase actually uses, and slipped
through. Both forms are now caught, and the re-run is RED. It is recorded here rather than
quietly fixed because it is the one place the A/B pass earned its keep.

---

## Rules encoded, not re-decided

- **Retakes: 3, then flagged for a manager.** `MAX_RETAKES = 3` is asserted against
  `RETRY_FLAG_THRESHOLD = 3` in `backend/routers/pahchan.py`. The suite asserts the shutter
  is **never** hidden — no `willBeFlaggedForRetries ? null`, no early return, and the
  `disabled` prop provably does not mention the retake count. `retry_count` is proven to
  reach the wire verbatim at 0, 1, 2, 3 and 4, and the punch is sent at every one of them.
- **A queued punch is visibly distinct, four ways.** Fill colour (`QUEUED_AMBER` vs
  `CONFIRM_GREEN`), glyph (`cloud-upload` vs `checkmark`), the words "Saved on this phone",
  and the haptic (`Warning` vs `Success`). Each is a separate assertion, so removing any one
  is red. `captured_at` is proven to be press time, taken before the queue write.
- **Devanagari: Tiro, 400 only, never tracked, never uppercased.** Swept over all 30 style
  objects that name the Devanagari face. Explicit neutralising values (`fontWeight: '400'`,
  `letterSpacing: 0`, `textTransform: 'none'`) are allowed, since that is the correct form
  next to a tracked Latin kicker.
- **Messages is `संवाद`; Inbox is `सन्देश`.** Asserted at all three sites, plus a check that
  no two tab destinations share a Hindi label.
- **No colour was hand-copied into a test.** The two ClockScreen hexes asserted
  (`#E8A33D`, `#5BD98A`) are camera-overlay constants defined in `ClockScreen.tsx` itself,
  which the file documents as deliberately outside the palette because the background is a
  live camera feed. `palette.generated.ts` and `tokens.css` are untouched and unread.

---

## Defect found by the new tests

**`components/NewTaskSheet.tsx` — `USE A TEMPLATE · टेम्पलेट` rendered as a single `<Text>`**
carrying `fontWeight: '700'` and `letterSpacing: 0.5`. Both landed on the Devanagari: there
is no bold Tiro, so that is synthetic bold on Android and a system-face fallback on iOS, and
RN applies tracking after shaping, which breaks the shirorekha in `टेम्पलेट`.

This is precisely the defect `BiLabel.tsx` was written to make unrepresentable. Every other
bilingual label in that file — and in `AttachmentSourceSheet`, `BoardScreen`, `MeScreen`,
`SettingsScreen` — already routes through `BiLabel` or splits on the separator. This one was
missed by that migration. Fixed by routing it through `BiLabel`, and now guarded by a test
that does not depend on JSX attribute parsing (which is how it originally hid: the enclosing
`TouchableOpacity` had a `>` inside an attribute, so an element-level regex could not see past it).

---

## Orphaned coverage, now gated

`src/screens/pahchan/register.check.mjs` held **12 real checks over payroll arithmetic** —
in→out pairing, forgotten clock-outs contributing zero rather than hours-until-now, IST
early-morning punches filing under the local day. They passed. They also **gated nothing**:
the file is `.mjs`, the test glob is `src/**/*.test.ts`, so they ran only when somebody
remembered to type the command by hand. Ported verbatim in substance to
`__tests__/register.test.ts` and the orphan removed. `register.ts`'s header was updated to
point at the new location.

---

## Honest limits

### Cannot be tested here at all — needs a device

Node's type-stripping removes TypeScript syntax but **does not transform JSX**, so no `.tsx`
file in this repo can be imported by `node --test`. Nothing renders. Specifically **NOT VERIFIED**:

- **Gestures** — `SwipeRow`, pull-to-refresh, the shutter press. No touch exists.
- **Haptics** — the Warning/Success distinction on a queued vs sent punch is asserted to be
  *coded*; whether the two patterns are actually distinguishable in a pocket is untested.
- **Camera** — `CameraView`, `takePictureAsync`, the front lens, image resize/compression.
  The suite asserts no gallery import exists and `facing="front"` is present. It cannot
  confirm a photo is ever produced.
- **Sheet presentation** — `Sheet.tsx`, `NewTaskSheet`, `AttachmentSourceSheet` mounting,
  backdrop, dismissal.
- **Animation timing** — `CONFIRM_HOLD_MS = 900`, the spring overshoot, the shutter flash
  decay, and every reduced-motion collapse. Asserted as constants only.
- **Touch-target size** — no 44pt/48dp check is possible. Style values could be read, but
  computed hit areas including `hitSlop` and parent padding cannot.
- **Actual glyph rendering** — whether Tiro loaded, whether a fallback face silently
  substituted, whether the shirorekha is intact. The suite proves the *style objects* are
  correct; only a screenshot on both platforms proves the *glyphs* are.
- **Screen reader output** — `accessibilityLiveRegion`, label ordering, focus. Props are
  asserted present; VoiceOver/TalkBack behaviour is not.
- **Navigation** — `RootStack`, deep links in `linking.ts`, tab state.
- **Theme correctness against `tokens.css`** — deliberately untouched. The palette is
  generated and the generator fails the build on drift; duplicating a colour into a test
  would create the second source of truth that mechanism exists to prevent.

### Weaker than it looks — source-contract tests

The 34 tests marked "source-contract" above read `.tsx` files as text. They pin specific
line-level decisions and all were watched failing, but they prove *the code implementing a
rule is present and shaped correctly* — **not that the screen behaves correctly when a
finger touches it**. Two consequences worth knowing:

- A sufficiently creative refactor can satisfy them while changing behaviour.
- They are coupled to source structure, so a rename can produce a red that is not a defect.
  Each failure message names the rule and the file so this is quick to triage.

Where a rule could be tested for real it was: `resolveScreenState` (the decision the
false-empty wiring feeds) and `punchQueue` (the durability the ClockScreen ordering
depends on) both run their actual modules.

### Not attempted

- **`useOfflineMutation`, `mutationQueue` flush/squash/backoff.** `mutationQueue` is loadable
  by this harness — it is only touched here to prove `clearQueue()` cannot wipe attendance.
  Its squash and backoff logic is the obvious next real-test target and needs no new
  infrastructure.
- **`api/*.ts` request shaping.** Loadable, untested.
- **`theme/tones.ts`, `theme/motion.ts`, `lib/runningTimer.ts`.** Pure or near-pure; cheap
  real tests available.
- **`BiLabel.splitBilingual`.** A pure exported function stranded in a `.tsx`, so it cannot
  be imported. Moving it to a `.ts` beside the component would make it directly testable —
  the same split the previous author made for `screenStatus.ts`.

### If render tests are wanted before 15 August

They need `@testing-library/react-native` + `react-test-renderer` + a babel transform, which
is a real dependency decision (RN ships Flow-typed source; there is no zero-dependency path).
That would convert most of the source-contract tests into behavioural ones and unlock the
false-empty guard as an actual render assertion. It is a deliberate open choice, not an
oversight.

---

## Files

**Added**
```
mobile/src/test/register.mjs                          harness: module hooks
mobile/src/test/source.ts                             source-contract helpers
mobile/src/test/stubs/{react-native-mmkv,expo-crypto,expo-file-system,
                       api-client,react-native,expo-google-fonts}.ts
mobile/src/offline/__tests__/punchQueue.test.ts       34 real
mobile/src/screens/__tests__/falseEmpty.test.ts        8 contract
mobile/src/screens/__tests__/devanagari.test.ts       10 contract
mobile/src/screens/pahchan/__tests__/clockScreen.test.ts  16 contract
mobile/src/screens/pahchan/__tests__/register.test.ts 12 real (ported)
mobile/src/theme/__tests__/fonts.test.ts              11 real
```

**Modified**
```
mobile/package.json                    test + typecheck scripts (no new deps)
mobile/src/components/NewTaskSheet.tsx defect fix — bilingual label via BiLabel
mobile/src/screens/pahchan/register.ts header points at the ported tests
```

**Removed**
```
mobile/src/screens/pahchan/register.check.mjs   ported into the gated suite
```

`package-lock.json` was **not** modified or committed. Nothing outside `mobile/` was touched.

---

## Notes for whoever runs this next

- `npm ci` in `mobile/` produces no `node_modules/.bin`, so `npx tsc` does not work.
  Use `node node_modules/typescript/bin/tsc --noEmit` (this is what `npm run typecheck` now does).
- Fixtures use times **relative to now**, never literal dates. A hard-coded timestamp ages
  past the 72-hour window and the punch is retired instead of sent — the retention rule
  working correctly and a test failing for the wrong reason. This bit once during authoring.
- Test files must use **erasable TypeScript only** — no `enum`, no parameter properties.
  Node strips types rather than compiling them, so `constructor(public x: number)` is a hard
  parse error. This bit once too, in a stub.
- Comments are stripped before every source-contract assertion. This codebase documents its
  own defects in prose — `SrijanScreen` explains the absent `fontWeight` in a comment
  containing the word `fontWeight` — and matching raw text reads those as the code they warn
  about. `readSkeleton()` additionally strips string contents, for counting structure.
