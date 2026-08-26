# Phase 7 — Make territories route, and capture Indian addresses

**Effort:** ~1.5 weeks · **Blocks on:** nothing · **Runs parallel with:** anything

> **"PIN" here means PIN code — Postal Index Number, the six-digit Indian
> postcode.** `400001` is Fort, Mumbai. It is not a password or a security PIN.
> The whole phase hangs on that number because it is the only piece of an Indian
> address that is machine-readable without a geocoder.

Added 2026-08-26 from `HANDOVER-2026-08-26-territory-maps.md`. **Rewritten the
same day** after an eight-lane audit checked every claim against the live
database, the live R2 bucket and the running deploys. Where the audit and the
handover disagree, the audit wins and the difference is called out.

---

## The finding that reorders everything — and the correction to it

`rules.pincodes` has **zero consumers in the entire backend**. Proven, not
asserted: `grep -rn "pincodes" --include=*.py backend/` returns exactly one
line, and it is a `print` inside a script.

**Territories route nothing.** That, not the map, is the gap.

But the audit found the ordering argument needs one more correction, and it is
the reason this phase is 1.5 weeks and not 1:

> **Nothing can route today even with a perfect resolver.** The product has no
> place to type a PIN on a contact, and no territory anywhere holds one.

`/territories/{id}/assign-next` also has **zero callers in the whole repo** — so
"hand it to the existing round-robin" means calling something nothing has ever
called.

### The live denominators — every acceptance in this phase is measured against these

| | Live, 2026-08-26 |
|---|---|
| Territories, both in-scope orgs | **17** (E2E 17, **Unicode 0**) |
| …carrying at least one PIN | **0** — three carry a `pincodes` key, all `[]` |
| …carrying at least one member | **0** |
| Contacts | 289 |
| …with a `territory_id` | **0** |
| E2E contacts with a PIN | **0 of 235** |
| Unicode contacts with a PIN | **42 of 54** (38 own + 4 inherited from their client) |
| Deals with a `territory_id` | 0 of 162 |

**The two organisations fail for opposite reasons.** Unicode has the addresses
and no territories; E2E has the territories and no addresses. Neither can prove
7.1 alone, and that shapes the order below.

---

## 7.0 · Capture a PIN at all  ⭐ **the real first step**

The handover did not know this and the first draft of this plan did not either.

- **Fault:** no contact write path in the product captures a PIN.
  `graha_contacts.billing_address` / `shipping_address` are live `jsonb` columns
  and the API models already accept them, but the create form has no address
  fields at all (`ContactsTab.jsx:488-513`).
- **Fault 2:** `graha_contacts.territory_id` is **unreachable from every API
  path** — not on `ContactCreate` (`graha.py:91-110`), not on `ContactUpdate`
  (`graha.py:117-135`), and absent from both the INSERT and the PATCH SET-build.
- **Fault 3:** no territory edit form exists. `PATCH /territories/{id}`
  (`graha.py:2895`) already validates members via `_validated_territory_users`
  and has **zero callers**. Without it nobody can put a PIN on a territory
  through the product, so 7.1 could never be proven "by a row" as the phase rule
  demands.
- **Do:** City / State / Pincode on the contact create form and edit panel,
  writing into `billing_address`; and a territory edit form that sets
  `rules.pincodes` and `assigned_users`.
- **Accept:** a contact created through the web UI with pincode `395002` comes
  back from `GET /v1/graha/contacts/{id}` with `billing_address.pincode =
  '395002'` — a row where E2E has **0 of 235** today. And
  `jsonb_array_length(rules->'pincodes') > 0` moves off **0**.

## 7.1 · PIN → territory → rep. The commercial half

- **Do:** a pure service module, `backend/services/territory_routing.py`:
  `normalise_pin(raw)` returns the value only if it matches `^[1-9][0-9]{5}$`,
  else `''`; then match against every territory's PIN list; then hand off to the
  existing round-robin.
- **The PIN source ladder:** the contact's own `billing_address->>'pincode'`,
  else `shipping_address->>'pincode'`, else its client's `address->>'pincode'`.
  That ladder is worth building — it takes Unicode from 38 routable contacts
  to **42**.
- **Hook:** inside `create_contact`'s existing transaction, after the INSERT
  (`graha.py:605-616`) and before `contact_created(...)`. **Not `_bg()`** — see
  the traps.
- **Backfill as a ROUTE, not a migration:** `POST /v1/graha/contacts/route-all`,
  gated `is_org_admin`, mirroring `rescore_all_contacts` (`graha.py:2484-2502`).
  Migrations are pre-approved; rewriting live rows is not.
- **Accept:** `SELECT count(territory_id) FROM staging.graha_contacts` moves off
  **0** when a contact is created through the UI with a PIN a territory claims.
- **Watch:** a PIN in no territory assigns nothing and **refuses nothing**. Same
  rule as GSTIN/PAN/TAN — it blocks nothing.

### 7.1a · Close the cross-tenant leaks IN THE SAME COMMIT — not optional

Writing `territory_id` **activates three cross-tenant leaks that are harmless
today only because the column is empty**:

- `graha.py:1038`, `graha.py:1222` and `services/crm_report.py:232` all join
  `graha_territories` on `tr.id` alone, each one sitting directly below a
  correctly-scoped client join. This is the `graha_clients` lesson again.
- `create_deal` (`graha.py:1147-1155`) writes `body.territory_id` with **no org
  check** and the FK is not composite — one org can file its deal under another
  org's territory today.
- `_DEAL_COLS` (`graha.py:1292`) lists `territory_id` but `DealUpdate` has no
  such field, so the allowlist entry is dead. If you add the field, do not let
  it fall to the else-branch at `graha.py:1340-1342`.

## 7.2 · PIN directory table + loader

- **Have:** the CSV — 20,144 data rows, 18,839 distinct PINs, header
  `pincode,state,district,blocks,state_lgd,district_lgd`, MIT licensed.
- **⚠ IT EXISTS IN EXACTLY ONE PLACE ON EARTH:** a temp scratchpad belonging to
  a dead session. **Step one is to put it in R2 before anything else touches
  it.** One `%TEMP%` clear and the download starts over.
- **THE TRAP, and it is worse than the handover says.** The handover says
  110003 spans two districts. The CSV gives it **three** (NEW DELHI/094,
  SOUTH/098, SOUTH EAST/677). **1,229 of 18,839 PINs are multi-district**, and
  **51 do not even resolve to one state** — 110025 is DELHI/SOUTH EAST,
  DELHI/SOUTH *and* UTTAR PRADESH/BUDAUN. So `pincode` must not be the primary
  key, and 7.6's "a PIN fills district and state" is **false for 51 PINs**.
- **The key that works,** measured over all 20,144 rows: `(pincode, state,
  district)` has 0 duplicates, and so does `(pincode, district_lgd)`.
- **`state_lgd` and `district_lgd` are ZERO-PADDED TEXT** (`'07'`, `'094'`). An
  `integer` column destroys them silently — `07` becomes `7` and stops matching
  any government table.
- **Next migration number is 222** (221 is the highest; never re-number).
- **Accept:** `count(*)` → 20144 and `count(DISTINCT pincode)` → 18839, both off
  zero. **Stop and report before running the loader** — 20,144 live rows is a
  data change, and the standing migration approval does not cover it.

## 7.3 · The boundary endpoint

- **Have, verified against live R2:** `_resolve_r2(None)` → `bucket=aekaminc
  key_prefix='shared/'`; `shared/reference/pincode-boundaries/datagov-2025-05/`
  holds **69 objects, 19,312 PINs**, byte-identical to the local copy. Platform
  bucket under `shared/`, deliberately never per-org.
- **Do:** `backend/services/pin_boundaries.py` — a shard reader with a cached
  index, **deliberately not in the router**. Then `GET
  /v1/graha/territories/{id}/geometry`.
- **THE THREE BUCKETS ARE THE ACCEPTANCE AND THEY MUST NOT BE MERGED:**
  `unmatched` (no such boundary), `unavailable` (R2 read failed) and `invalid`
  (not a PIN). Collapsing `unavailable` into `unmatched` tells a customer "there
  is no shape for 110001" when R2 is merely down.
- **58 directory PINs have no boundary, and 531 boundary PINs are not in the
  directory.** Both datasets are incomplete and neither is authoritative.
- **Accept:** against a territory carrying 110001 and 110009 — one Feature,
  `matched:1`, `unmatched:["110009"]`. A real PIN **named**, not dropped.

## 7.4 · CSP — the map cannot load without this

- **Verified today:** the whole CSP is one JSON string at `vercel.json:50`. The
  served header on `staging.kartavaya.com` is **byte-identical** to the file, so
  there is no drift to chase. The inline pre-paint script's sha256 matches
  `index.html` — confirmed three ways.
- **Do:** append `https://sdk.mappls.com` and `https://apis.mappls.com` to
  `script-src` and `connect-src`, add them to **both** `style-src` *and*
  `style-src-elem` (there are two directives, not one), and add `worker-src
  'self' blob:` — currently absent, so a worker falls back to `script-src`.
- **No change needed to `img-src`** — it is already `'self' data: blob: https:`,
  so raster tiles load. Say so out loud, or somebody adds a redundant host.
- **⚠ `vercel.json` takes NO comments — not a `//` line and not a `"//"` KEY.**
  Commit `834587a5` is the proof: three deployments errored with **no build
  logs**, because schema validation runs before the build, and the site silently
  stayed on the old bundle.
- **⚠ Do not disturb the hash.** `frontend/scripts/check-csp-hash.mjs` is the
  first gate in `npm run check` and goes red if it drifts.
- **Accept:** the response header from `staging.kartavaya.com` contains
  `sdk.mappls.com` and `worker-src`. Anything less means the deploy did not land.

## 7.5 · `TerritoryMap.jsx` rewrite

- **Fault, confirmed:** it draws **nothing**. It builds a map on India's
  centroid and stops; `pincodes` is used for exactly one thing — `zoom:
  pincodes.length ? 6 : 4`. No markers, no polygons, ever.
- **Fault 2:** the SDK URL has been dead since **August 2025** —
  `apis.mappls.com/advancedmaps/api/{KEY}/map_sdk`, key in the path. Current
  form is `https://sdk.mappls.com/map/sdk/web?v=3.0&access_token={KEY}`. **This
  was never a credentials problem.**
- **Fault 3:** it renders only inside `{showForm && …}` (`TerritoriesTab.jsx:166`)
  — you cannot see a saved territory's shape without entering the create form.
- **Widen the design-system gates BEFORE writing map CSS**: add `mappls`,
  `mapmyindia`, `maplibregl`, `mapboxgl` to `EXTERNAL` in
  `check-orphan-selectors.mjs:89-92` and `check-classes.mjs`. Prove the gate
  still works by adding a junk selector and watching it go red.
- **GODL attribution is a licence condition, not a nicety.** Render *"Boundaries
  © Government of India (data.gov.in) — GODL-India · Basemap © Mappls"* as our
  own DOM, unconditionally, asserted by a render test so it cannot be quietly
  deleted.
- **Accept:** falsifiable, not a screenshot of a blue rectangle — the network
  tab shows a 200 from the geometry endpoint with `features.length > 0`, and
  `features.length + unmatched.length === rules.pincodes.length`.

## 7.6 · Address autosuggest

- **Do:** server-side through the Railway OAuth credentials —
  `backend/services/mappls.py` with a cached client-credentials token, then `GET
  /v1/graha/address/suggest?q=…` behind `require_user` + `_gate`, rate-limited
  `30/minute`, debounced ~300ms client-side.
- **Add `MAPPLS_CLIENT_ID` / `MAPPLS_CLIENT_SECRET` to `_ENV_SECRET_KEYS` in
  `sentry_scrub.py`**, and delete the dead `"MAPPLS_KEY"` entry on line 73 in
  the same edit.
- **THE EXPECTATION TO RESET, and it belongs in the product, not just here.**
  The owner asked for the UK "type a postcode, get your address" flow. **It does
  not transfer.** An Indian PIN averages ~82 km² against a UK postcode's ~17
  addresses — and 51 PINs do not even resolve to one state. Put a one-line lede
  under the address block saying what a PIN can and cannot fill.
- **Watch:** Unicode's client `INC UK` has `address->>'pincode' = 'NW1 245'` and
  `Navrang Polymers` has its whole address stored as a stringified JSON exploded
  into character keys. **Both must still load, edit and save** — the validation
  blocks nothing, per the standing GSTIN/PAN/TAN rule.

---

## Order of work

**7.0 → 7.1 + 7.1a → 7.2 → 7.3 → 7.4 → 7.5 → 7.6.**

7.0 first because nothing downstream can be proven by a row without it. 7.1a is
welded to 7.1 because 7.1 is what makes those three leaks reachable. 7.4 must
land and be verified on the served header before 7.5 is worth writing.

## Decisions already made — do not re-litigate

| Layer | Choice |
|---|---|
| Basemap | Mappls SDK |
| Autosuggest / geocode / standardise / place detail | Mappls REST |
| PIN polygons | data.gov.in open data |
| PIN → district/state | data.gov.in directory |
| Lead routing | our own code, no vendor |

Rejected, with the reason:

- **Google Maps** — works, `POSTAL_CODE` styling does cover India. Rejected on
  cost: USD billing, card required, per-load metering, against the standing
  no-Google-spend line.
- **Protomaps + MapLibre** — recommended, then dropped: *"i dont mind not having
  design token but i want real map."*
- **OpenStreetMap alone** — no Indian PIN boundaries, and its public tile server
  may not be used commercially.
- **PostGIS** — on Supabase (3.3.7) but **not installed**, and not needed:
  routing is string equality and polygons render browser-side. **Do not install
  it for this.**

## Open questions — owner

1. **When one PIN falls in two territories, which wins?** Nothing in the schema
   prevents it (`UNIQUE(org_id, name)` is the only constraint) and zero overlaps
   exist today. Free to decide now, an incident later.
2. **Should routing set the rep, or only the territory?** Writing `assigned_to`
   reassigns live work — 42 of 54 Unicode contacts already have an owner.
   **Recommendation: territory always, rep only when unassigned.**
3. **Should the public web form ask for a PIN?** It is the inbound path where
   routing is worth most and the one where every extra field costs conversions.
   Today it captures name/email/phone/company/message only.
4. **E2E has 0 pincodes across 235 contacts and 61 clients.** Proving 7.1 there
   means seeding addresses. Approved in principle by the standing "seed via
   Playwright as a real user" rule — confirm the scale.
5. **Are the 17 E2E territories real fixtures or Playwright residue?** Ten are
   machine-named `E2E Territory xxxxx`; seven are real regions (Mumbai Metro,
   Pune, Gujarat, Delhi NCR, South India, East India, Exports).

## Traps that will cost a day each

- **`data.gov.in` blocks WebFetch but not `curl` with a browser User-Agent.**
- **`backend/` has no geo libraries and this phase adds none.** The prepare
  script implements Douglas-Peucker in ~20 lines of stdlib Python.
- **The Browser pane takes ~15s** to pull network resources into a map library.
  A working setup was misdiagnosed as broken three times at 5–8 seconds.
- **`SIMPLIFY_FLOOR = 12` is load-bearing for exactly 17 PINs** (500041, 826001,
  800023 and similar) — single campuses whose source geometry is already a
  quadrilateral, collapsing below GeoJSON's 4-position minimum. Reproduced: with
  `0` it drops 17, with `12` it drops none. **Any re-tuning must re-check that
  the written count equals 19,312.**
- **`download_file` returns `None` on EVERY failure, including a missing key**
  (`storage.py:816-818`). If the geometry endpoint treats `None` as "no
  boundary", an R2 outage renders as "this territory has no shape".
- **Do NOT use `_bg()` for routing**, even though `compute_lead_score` does
  exactly that (`graha.py:1159`). `server.py:187-191` records that a Railway
  restart drops pending `_bg()` tasks.
- **Boundary vintage is May 2025, no published refresh schedule.** Routing never
  reads the boundary file, so staleness is cosmetic.
- **`backend/data/pincode_boundaries/` is gitignored** (committed `afd64727`).
  Rebuild locally; never commit it.
- **`staging.sales_territories` and `staging.sales_routing_rules` are both empty
  with zero code references** — Phase 6 retire candidates. 7.1 is right to build
  on `graha_territories`.

## Definition of done

- 7.0 proven by a row: a contact carries a pincode, and a territory carries a
  PIN list and a member — all three are **0** today.
- 7.1 proven by a row: `count(territory_id)` on contacts moves off **0** through
  the product, not a console.
- The three cross-tenant territory joins are org-scoped and a test asserts it.
- The geometry endpoint **names** unmatched PINs and keeps `unavailable`
  separate from `unmatched`.
- GODL attribution visible wherever a map draws, guarded by a render test.
- `npm run build` **and** `npm run check` green — `check` alone exits 0 on
  unparseable CSS, and this phase edits CSP and styles.
- `cd backend && python -m pytest -q` against the known baseline, **not zero**.
- `docs/STATUS.md` and `docs/plans/PROGRESS.md` updated in the same commit.

## Provenance

The handover (`docs/HANDOVER-2026-08-26-territory-maps.md`, committed
`afd64727`) supplied the vendor decisions, the credentials and the two scripts.
Everything measured — the denominators, the multi-district counts, the missing
capture path, the three cross-tenant joins, the R2 verification and the
ordering — comes from the eight-lane audit of 2026-08-26, which checked each
claim against the live database and the running deploys rather than against the
handover.
