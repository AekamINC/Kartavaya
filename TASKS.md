# Tasks

Add anything here and I will pick it up. **Everything except the `- [ ]` line is optional** — one line is a valid task. Write it however you like; I would rather read a scrappy note than have you stop to format.

Add new items under **Inbox**. I triage from there into the priority sections, so you never have to decide where something goes.

**Tags, if you want them** — put them on the same line, anywhere:

| Tag | Meaning |
|---|---|
| `!!` | urgent — do this before whatever you were doing |
| `!` | important, not urgent |
| `@me` | I am blocked on you (a key, a decision, a billing lookup) |
| `?` | you are not sure it is worth doing — I should push back if it isn't |
| `web` `app` `api` `db` | where it lives, if you know |

Cross out with `- [x]` or just tell me it's done.

---

## Inbox — add here

- [ ] 

---

## Now

- [ ] Compare the £0.04 charge's Google Cloud project against the project my Gemini key belongs to `@me` `!`
  Why: it either unblocks Gemini web search or settles Serper as permanent. One lookup in the billing console; I cannot see billing.

- [ ] Smoke-test the new APK — sign in, force-stop, reopen `@me`
  Why: it fixes a logout bug nobody has confirmed is gone. `adb shell am force-stop com.aekaminc.Kartavaya`

- [ ] Reorder the chatbot chain so the free model runs before Gemini `api` `!`
  Why: every Sahayak question spends prepay before reaching `glm-4.5-air:free`, which costs nothing. One line. Biggest remaining saving.

## Next

- [ ] Decide: rolling sessions or fixed? `@me`
  Everyone is signed out on day 7. `/auth/refresh` exists and mobile never calls it. Wiring it changes behaviour, so it is your call not mine.

- [ ] Namespace the mobile `auth_token` by environment `app`
  A staging token and a production token collide on one device, which also reads as a logout.

- [ ] Count web searches and grounded calls per org `api` `db`
  Nothing counts either today, so crossing a free tier would be discovered from an invoice.

- [ ] Test Serper end-to-end through the deployed chat route `api`
  Verified as a service with the live key, not through a real question.

## Later

- [ ] Work out why `mobile/.easignore` is inert `app` `?`
  The EAS archive stayed at exactly 1.0 GB after adding it. 16-minute uploads and a 3–4 hour queue make this worth solving only if you want to rely on cloud builds — local is 5 minutes.

- [ ] Sanvaad conversion — component by component, never by selector list `web`
  Parked from the week of 2026-08-10. Link previews need SSRF-safe unfurling; the photo grid has no media column.

## Blocked

- [ ] JustDial / IndiaMART live test `@me`
  No marketplace credentials exist. Needs real accounts, and I will not run it against a live one without you watching.

- [ ] iOS build
  Needs an Apple Developer account. The config and iPadOS code are done and tested.

---

## Done

<!-- I move things here with the date and the commit. -->

- [x] 2026-08-08 — Sahayak web search on Serper `18a38973`
- [x] 2026-08-08 — Release APK signed people out `c5b1dead`
- [x] 2026-08-08 — Gemini models pinned; `-latest` alias had moved us to 3.6 `863117c6`
- [x] 2026-08-08 — Gemini key stopped spending on images; calls were logged at $0.00 `98ed77a7`
