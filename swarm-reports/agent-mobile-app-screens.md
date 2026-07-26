# Mobile app — screens, wiring, endpoints

Branch: `agent/mobile-app-screens` (cut from `origin/staging`).
Scope: `mobile/` — Expo 51 + React Native + **TypeScript**.
Spec: `design-handover/17-mobile-app.md`.

> **Worktree note.** The worktree branch `worktree-agent-afc9794a5dd0e78e0` was cut
> from `main`, not `staging` — 13 commits ahead of a merge-base 272 commits behind
> `origin/staging`. Working on it would have produced a diff against production.
> A fresh branch was cut from `origin/staging` instead. `main` was not touched.

## Gate commands

| Gate | Command | Notes |
|---|---|---|
| Mobile typecheck | `cd mobile && npx tsc --noEmit` | already declared as `npm run typecheck` in `mobile/package.json` |
| Web tokens | `node frontend/scripts/check-tokens.mjs` | web only, does not read `mobile/` |
| Web classes | `node frontend/scripts/check-classes.mjs` | web only, does not read `mobile/` |

There is no lint config in `mobile/` — `tsc --noEmit` is the only mobile gate.
Deps installed with `npm ci --ignore-scripts`; `mobile/package-lock.json` verified
unmodified afterwards (`git status` clean).

**Baseline: `npx tsc --noEmit` exits 0 on `origin/staging` before any change.**

---

## Verification of prior claims

| Claim | Verdict | Evidence |
|---|---|---|
| Palette is generated, not transcribed | **HELD** | Generator is `mobile/scripts/gen-tokens.mjs`; output is `mobile/src/theme/palette.generated.ts` (297 lines, header says GENERATED, do not edit). `mobile/src/theme/tokens.ts` is a hand-written *mapping* layer over the generated palette — it is not itself the generated file, contrary to the literal text of 17-mobile-app.md §"New files" which says `tokens.ts  rewritten`. To change colours, edit `frontend/src/styles/tokens.css` then run `npm run tokens` in `mobile/`. |
| Retired blue `#0082c6` removed | **HELD with one exception** | No live value in `src/theme/`, `src/nav/`, `src/screens/`, `src/components/` — every hit there is prose in a comment explaining the removal. **STALE spot:** `mobile/src/theme.js` still carries live `blue: '#0082c6'`, `mid: '#03a1b6'`, `grad: [...]`, `gradD: [...]`. Nothing imports it (grep for the import specifier returns zero hits outside a comment). It is a dead file that would reintroduce the blue the moment anyone imported it. |
| Five-tab nav + attendance-only shell | **HELD** | `nav/RootStack.tsx` — `MainTabs` is Today · Tasks · Create · Messages · More with `CreateStub` returning null and `BottomBar` intercepting the press; `PahchanTabs` is Clock · Me; shell selected by `isAttendanceOnly(user.role)` from the role, not a flag. |
| `SwipeRow` + swipe-to-complete via offline queue | **HELD** | `components/SwipeRow.tsx` (229 lines) exists once and is the shared primitive. |
| Punch queue, 72-hour retention | **HELD** | `offline/punchQueue.ts` (240 lines). Owned by the Pahchan agent — not modified here. |
| EAS build config points at a live endpoint | **HELD** | `mobile/eas.json`: `development`, `preview` and `simulator` all set `EXPO_PUBLIC_API_URL=https://kartavya-staging.up.railway.app`; `production` sets `https://kartavya-production.up.railway.app`. Both verified live: `curl /api/health` returns **200** on each. No profile points at the 404 hostname. `src/api/client.ts` and `src/config.js` both fall back to **staging**, never production. |

---

## Screen inventory against 17-mobile-app.md §Screens

(filled in as work lands — see below)
