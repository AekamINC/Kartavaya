# Starting prompt for a fresh Claude session

Paste §2 as the first message. §1 is for you (the human) — it says what to
connect before pasting, and what genuinely cannot be done without it.

---

## 1 · Tools to connect first

Claude Code's own file, search and Bash tools cover most of this work. The list
below is only about **MCP connectors and local toolchain**, and it is split by
what actually breaks without each one.

### Required

| Tool | Why | Without it |
|---|---|---|
| **Bash / local repo** | Everything. Tests, builds, migrations, `railway run`. | Nothing works. |
| **Railway CLI** (authenticated) | `railway run -e staging -s Kartavya python <script>` is the ONLY way to reach the live database and R2. Deploys and cron config too. | You cannot measure anything against real data — and this project's rule is that unmeasured claims do not ship. |
| **GitHub** (`gh` CLI or the GitHub MCP) | Branch is `staging`; pushes and PRs. | You can commit locally but not push. |

### Strongly recommended

| Tool | Why |
|---|---|
| **Supabase MCP** | Schema reads, `list_tables`, advisors. Convenient — but note `railway run` already reaches the same database, so this is a nicety, not a second capability. |
| **Sentry MCP** | Backend and **mobile** crash reports. The 2.0.3 mobile crash was diagnosed through it. |
| **Playwright** | Web e2e lives in `frontend/e2e-real`, creds in `.env.e2e`. |

### For the mobile workstream (M) specifically

**No MCP server can build, install or drive the app.** This is the part people
get wrong:

- **Playwright cannot touch the app.** It is a web browser driver. It will not
  open an APK.
- **Local Android toolchain** — JDK + Android SDK + `adb`, and the Expo/EAS CLI.
  The build is `bash mobile/scripts/build-apk.sh release`. Without this
  toolchain you can read and edit mobile code but **cannot produce or install a
  build**, which is the one thing M still needs.
- **Maestro** for Android e2e (iOS was dropped from the programme).
- **Sentry** for crashes, as above.
- **iOS cannot be built at all** — the blocker is an Apple Developer account,
  not the repo. Do not spend time on it.
- **Expo Go cannot run this app** (react-native-mmkv is native). Only a dev
  build or a release APK will run it, and **every mobile probe needs a cold
  restart** — hot reload lies on this app.

### Not needed

Apify, Qase, Vercel MCP, the marketing/sales/productivity connector packs. If a
connector prompts for OAuth, skip it — none of the remaining work needs one.

---

## 2 · The prompt

> Read `docs/HANDOVER-2026-08-23-B.md` first, then `docs/OWNER-ACTIONS.md`, then
> `CLAUDE.md`. They are current and were written from measurement, not memory.
>
> **The job.** Four things remain of the thirteen workstreams in
> `docs/proposals/82-scope.html`:
>
> - **H · Compliance as a setting** — not started. Spec is
>   `docs/proposals/80-*.html`.
> - **J · Marketing** — not started. Reproduce inbox 15 before building.
> - **L · Two-factor authentication** — not started. Spec is
>   `docs/proposals/81-*.html`.
> - **M · Mobile** — code is done; the APK is not built and inbox 9 was never
>   reproduced.
>
> Plus **tenancy PROPOSED_079**, which is now unblocked and ready to run.
>
> Build them fully — tested and verified, not half. You pick the order for
> efficiency; you do not pick the scope. Do not narrow a workstream to what
> fits, and do not report anything as done that isn't.
>
> **Your role.** System architect and lead developer: ten years modern stack,
> security expertise. If you spawn agents, brief them as senior
> architect/developer with eight years, security and QA expertise.
>
> **The one dangerous fact.** Staging and production share a single Supabase
> database — only the `staging` and `public` schemas exist, and production
> writes to `staging` too. So every migration is a production schema change and
> every write-path probe touches production data. Never test validation by
> writing to the live database. State write-path side effects and give a short
> risk report before running a migration. Back up anything irreversible to a
> restore schema and verify counts after.
>
> **Measure before you claim.** `railway run -e staging -s Kartavya python
> <script>` reaches the live database read-only. A mock pool answers `[]` to any
> column name you like and will confirm whatever you already believe — two real
> defects in the last session survived a green unit test and were found only by
> probing live. Verify a premise before putting it in front of the owner,
> including premises you were handed.
>
> **Staging only.** Railway, Vercel and Sentry stay in staging. **Do not merge
> `staging` into `main` and do not deploy production** — that is the owner's
> decision alone.
>
> **Never stop.** If something needs the owner, add it to
> `docs/OWNER-ACTIONS.md` and carry straight on with everything else. A block
> parks a piece, never a batch and never a workstream. Finish the blocked piece
> the moment he actions it, without being asked again.
>
> **Approved for these workstreams only, not standing:** full CRUD on
> migrations, Railway crons, Vercel and Sentry — don't stop to ask. Cleaning
> dead tables and rows is approved, deletes included, but prove dead by
> measurement against the live catalogue first. `users.role` rows that look
> corrupt are REAL. Marketing: build everything as a setting; the ICAI question
> is settled and must not be re-opened.
>
> Report progress per batch. Start by telling me the order you have chosen and
> why.
