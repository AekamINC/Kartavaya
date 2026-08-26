# Phase 7 — Make territories route, and capture Indian addresses

**Effort:** ~1 week · **Blocks on:** nothing · **Runs parallel with:** anything

Added 2026-08-26 from `docs/HANDOVER-2026-08-26-territory-maps.md`, which a
parallel session produced from a live conversation with the owner rather than
from this plan. It was reconciled against Phases 0–6 before being written here:
**no existing phase owns territories or CRM address capture**, and the
handover's finding contradicts nothing already marked done.

Phase 4 is the nearest neighbour in *shape* — a table with no screen — but it
enumerates eight named screens and this is not among them, so this is an
addition to the plan rather than a fit inside 4.

## The finding that reorders everything

**`rules.pincodes` has ZERO consumers in the entire backend.** Territories store
a name, members and a PIN list, and *nothing reads the PIN list*. `territory_id`
on deals and contacts is set by hand, and round-robin only fires when somebody
explicitly calls `/territories/{id}/assign-next`.

**Territories do not route anything.** That, not the map, is the gap.

The handover lists routing LAST of six while calling it "the part the owner is
actually selling". **That ordering is inverted here on purpose.** Routing is
string equality on a PIN — it needs no polygon, no SDK, no CSP change and no
vendor. It is the cheapest item on the list and the only one with revenue
attached. The map is how a territory is *explained*; routing is what it *does*.

So: **7.1 first, and it can ship the day it is written.**

## Tasks

### 7.1 · PIN → territory → rep. The commercial half  ⭐ do this first

- **Exists:** `rules.pincodes` on the territory, read by nothing. Round-robin
  exists but only on an explicit call.
- **Do:** resolve an inbound lead or contact's PIN against every territory's PIN
  list, assign `territory_id`, then hand it to the existing round-robin. No
  geometry, no vendor, no new dependency.
- **Accept:** a contact created with a PIN that falls in a territory gets a
  `territory_id` and a rep **without anybody opening a map** — proven by a row
  moving off 0, per the phase rule.
- **Watch:** a PIN in no territory must assign nothing and refuse nothing. Like
  GSTIN/PAN/TAN, this blocks nothing.

### 7.2 · PIN directory table + loader

- **Have:** CSV downloaded — 20,144 rows, 18,839 distinct PINs, with
  state/district/block/LGD, MIT licensed. No migration, no loader.
- **Do:** a table and a loader; fill district and state from a PIN.
- **THE TRAP:** **a PIN can span multiple districts** — 110003 hits both New
  Delhi and South East. `pincode` must NOT be the primary key.
- **Note:** the directory refreshes monthly; the boundary file does not.

### 7.3 · The boundary endpoint

- **Have:** all **19,312 of 19,312** PIN polygons in R2 at
  `aekaminc/shared/reference/pincode-boundaries/datagov-2025-05/`, sharded on the
  first two digits, 18.5MB. **Platform bucket under `shared/`, deliberately
  never per-org** — every org may bring its own R2, and this dataset is identical
  for all of them and owned by none. `_resolve_r2(None)` already yields
  `shared/`. An `--org` flag on that script would be a misreading.
- **Do:** `GET /v1/graha/territories/{id}/geometry` → a FeatureCollection for
  that territory's PINs only.
- **Accept:** the endpoint returns geometry for a real territory, and **names any
  PIN it could not find a boundary for** rather than silently omitting it.

### 7.4 · CSP — the map cannot load without this

- **Fault:** `frontend/vercel.json` blocks `sdk.mappls.com` in `script-src`,
  `connect-src` and `style-src`, and declares no `worker-src`.
- **Do:** add `https://sdk.mappls.com` to those three and `worker-src 'self'
  blob:`.
- **⚠ TWO HAZARDS ON THIS ONE FILE.** `vercel.json` takes **no comments** — a
  stray `"//"` key kills the deploy silently, with no logs, and the site stays
  on the old build. And `index.html`'s inline pre-paint script is allowed only
  by a **sha256 hardcoded in this same CSP**; edit the script without moving the
  hash and the browser blocks it on every load. `frontend/scripts/check-csp-hash.mjs`
  is the first gate in `npm run check` and will go red if they drift.
- **Done already:** the `connect-src` typo (`staging.kartavya.com`, missing the
  second `a`) was corrected in `111d60ff`. Inert — `'self'` covered it — but wrong.

### 7.5 · `TerritoryMap.jsx` rewrite

- **Fault:** it draws **nothing**. It builds a map centred on India's centroid
  and stops; `pincodes` is used for exactly one thing, `zoom: pincodes.length ? 6 : 4`.
  No markers, no polygons. It has never drawn a territory.
- **Fault 2:** the SDK URL has been **dead since August 2025** —
  `apis.mappls.com/advancedmaps/api/{KEY}/map_sdk` with the key in the path.
  Current form is `https://sdk.mappls.com/map/sdk/web?v=3.0&access_token={KEY}`.
  This was never a credentials problem.
- **Do:** rewrite onto the current URL, draw 7.3's GeoJSON, surface any PIN with
  no boundary rather than hiding it.
- **Licence condition:** **GODL attribution must stay visible.** Not optional.

### 7.6 · Address autosuggest

- **Do:** server-side through the Railway OAuth credentials, debounced ~300ms and
  cached, so typing an address does not burn a transaction per keystroke.
- **THE EXPECTATION TO RESET:** the owner asked for the UK "type a postcode, get
  your address" flow. **It does not transfer.** An Indian PIN averages ~82 km²
  against a UK postcode's ~17 addresses. A PIN can fill district and state and
  nothing finer; the real equivalent is autosuggest on the address text.

## Decisions already made — do not re-litigate

| Layer | Choice |
|---|---|
| Basemap | Mappls SDK |
| Autosuggest / geocode / standardise / place detail | Mappls REST |
| PIN polygons | data.gov.in open data |
| PIN → district/state | data.gov.in directory |
| Lead routing | our own code, no vendor |

Rejected, with the reason, so nobody proposes them again:

- **Google Maps** — works, and `POSTAL_CODE` styling does cover India. Rejected
  on cost: USD billing, card required, per-load metering, against the standing
  no-Google-spend line.
- **Protomaps + MapLibre** — recommended, then dropped when the owner said *"i
  dont mind not having design token but i want real map."*
- **OpenStreetMap alone** — carries no Indian PIN boundaries; answers only the
  basemap half. Its public tile server also **may not be used commercially**.
- **PostGIS** — available on Supabase (3.3.7), **not installed**, and not needed:
  routing is string equality and polygons render browser-side. **Do not install
  it for this.**

## Credentials — all set, nothing outstanding

`VITE_MAPPLS_KEY` on Vercel (Production + Preview, stored as **Config** not
Secret — the `VITE_` prefix makes it public by definition, which is correct);
`MAPPLS_CLIENT_ID` and `MAPPLS_CLIENT_SECRET` on Railway staging. All five REST
APIs confirmed allocated.

**⚠ Leave "Whitelisted Ips" EMPTY on the Mappls console.** Railway egress IPs are
not static and filling it breaks REST intermittently. Domain whitelist is set.

## Traps that will cost you a day each

- **data.gov.in blocks WebFetch but not `curl` with a browser User-Agent.**
- **`backend/` has no geo libraries and this work adds none.** The prepare script
  implements Douglas-Peucker in ~20 lines of stdlib Python.
- **The Browser pane takes ~15s** to pull network resources into a map library.
  A working setup was misdiagnosed as broken three times by measuring at 5–8
  seconds. If a map looks blank, wait longer before concluding anything.
- **Simplification silently dropped 17 PIN codes** on the first run (500041,
  826001, 800023 and similar) — single campuses whose source geometry is already
  a quadrilateral, collapsed below GeoJSON's 4-position minimum. Fixed with
  `SIMPLIFY_FLOOR = 12`. **Any re-tuning of the tolerance must re-check that the
  written count equals 19,312.**
- **Boundary vintage is May 2025 with no published refresh schedule.** Routing
  never reads the boundary file, so staleness is cosmetic: a new PIN routes
  correctly with no shape to draw.
- **`backend/data/pincode_boundaries/` is gitignored.** Rebuild locally; never
  commit it.

## Definition of done

- 7.1 proven by a row: a contact with a PIN gains a `territory_id` and a rep
  through the product, not through a console.
- The boundary endpoint names unmatched PINs rather than omitting them.
- GODL attribution visible wherever a map draws.
- `npm run build` AND `npm run check` green — `check` alone exits 0 on
  unparseable CSS, and this phase edits CSP and styles.
- `cd backend && python -m pytest -q` against the known baseline, not zero.
- `docs/STATUS.md` and `docs/plans/PROGRESS.md` updated in the same commit.

## Provenance

Everything above except the ordering argument and the CSP hash hazard comes from
`docs/HANDOVER-2026-08-26-territory-maps.md`, written by a parallel session and
handed over unowned. Its two scripts
(`backend/scripts/prepare_pincode_boundaries.py`,
`upload_pincode_boundaries.py`) and its `.gitignore` block are in the tree and
are the only code it left.
