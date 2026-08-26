# Handover — territory maps and Indian address capture (2026-08-26)

**Read this against your own progress before acting on it.** This session ran in
parallel with yours on `staging` and did not see your work. Reconcile against
`docs/plans/README.md` and `docs/plans/PROGRESS.md` first — if this contradicts
a phase you are mid-way through, your phase wins and you should tell the owner
rather than merge blindly.

## What this session was for

The owner wants the territory map working as a **selling point**: draw the PIN
codes a sales territory covers, and capture Indian client addresses properly.
Scope came in as "mapmyindia — do I need to create an app?" and expanded.

---

## The four facts that cost the most to establish

**1. `rules.pincodes` has ZERO consumers in the entire backend.** I grepped every
`.py`; the only `pincode` hits are invoice addresses. Territories today store a
name, members and a PIN list, and *nothing reads the PIN list*. `territory_id` on
deals and contacts is set by hand, and round-robin only fires when someone calls
`/territories/{id}/assign-next` explicitly. **Territories do not route anything.**
That, not the map, is the actual gap.

**2. `TerritoryMap.jsx` draws nothing.** It builds a map centred on India's
centroid and stops. `pincodes` is used for exactly one thing —
`zoom: pincodes.length ? 6 : 4`. No markers, no polygons. It has never drawn a
territory.

**3. Our Mappls SDK URL has been dead since August 2025.** The code calls
`https://apis.mappls.com/advancedmaps/api/{KEY}/map_sdk?...` — key in the path.
Mappls moved to `https://sdk.mappls.com/map/sdk/web?v=3.0&access_token={KEY}`.
The old form would fail on any account with any key. This was never a
credentials problem.

**4. There were two Mappls accounts.** Early screenshots came from an
`auth.mappls.com` account whose Allocations tab showed SDKs greyed out. The
owner later confirmed that account is **not** the real one — `api.mappls.com` is.
Any conclusion of the form "the SDK is not allocated to us" came from the wrong
account and is void.

---

## Decisions the owner made

| Layer | Choice |
|---|---|
| Basemap | **Mappls SDK** |
| Address autosuggest / geocode / standardise / place detail | **Mappls REST** |
| PIN code polygons | **data.gov.in** open data |
| PIN → district/state | **data.gov.in** directory |
| Lead routing | our own code, no vendor |

Rejected along the way, with reasons, so they are not re-litigated:

- **Google Maps** — works, and `POSTAL_CODE` data-driven styling *does* cover
  India (I checked the coverage table). Rejected on cost: USD billing, card
  required, per-load metering, against a standing "no Google spend" line.
- **Protomaps + MapLibre** — recommended earlier on "we own every colour", then
  dropped when the owner said plainly: *"i dont mind not having design token but
  i want real map."* That removed its main advantage.
- **OpenStreetMap alone** — does **not** carry Indian PIN boundaries; it only
  ever answered the basemap half.
- **PostGIS** — available on Supabase (3.3.7) but **not installed**. It is not
  needed: routing is string equality on the PIN, and polygons render browser-side.
  Only lat/lng point-in-polygon would need it. **Do not install it for this.**

---

## Done and verified

**Boundary data — in R2, not in git.**

- `backend/scripts/prepare_pincode_boundaries.py` converts the 90MB government
  GeoJSONL to 69 sharded JSON files (sharded on the first two PIN digits).
- **19,312 of 19,312 PIN codes**, complete. 3.34M → 957K vertices (71.4%
  removed), 18.5MB total.
- Uploaded to `aekaminc/shared/reference/pincode-boundaries/datagov-2025-05/`
  via `backend/scripts/upload_pincode_boundaries.py`.
- **It is in the platform bucket under `shared/`, deliberately never per-org.**
  Every org can bring its own R2; this dataset is identical for all of them and
  owned by none. `_resolve_r2(None)` already yields `shared/`. If you find an
  `--org` flag on that script, someone has misread the requirement.
- `backend/data/pincode_boundaries/` is now **gitignored**. Rebuild locally with
  the prepare script; never commit it.

**A bug worth remembering:** the first run silently dropped 17 PIN codes
(500041, 826001, 800023 and similar). They are single campuses whose source
geometry is already a quadrilateral, and Douglas-Peucker collapsed them below
GeoJSON's 4-position minimum. Those territories would have drawn nothing, with
no error anywhere. Fixed by `SIMPLIFY_FLOOR = 12` — rings that small are rounded
but not simplified. **Any future re-tuning of the tolerance must re-check the
written count equals 19,312.**

**Credentials — all set by the owner, nothing outstanding.**

| Value | Where | Powers |
|---|---|---|
| `VITE_MAPPLS_KEY` | Vercel, Production + Preview | the map SDK |
| `MAPPLS_CLIENT_ID` | Railway staging | REST OAuth |
| `MAPPLS_CLIENT_SECRET` | Railway staging | REST OAuth |

Vercel rejects `VITE_MAPPLS_KEY` as a "Secret" because the `VITE_` prefix makes
it public by definition — it is stored as **Config**. That is correct, not a
workaround. Domain whitelist is set on the Mappls console to `kartavaya.com`,
`app.kartavaya.com`, `staging.kartavaya.com` (+ `www.` and `localhost:5173`
advised). **Leave "Whitelisted Ips" empty** — Railway egress IPs are not static
and filling it will break REST intermittently.

All five needed REST APIs are confirmed allocated: Autosuggest, Geocoding,
Reverse Geocoding, Address Standardization, Place Detail.

---

## Not done — the drop-off

1. **PIN directory table.** CSV is downloaded (20,144 rows, 18,839 distinct PINs,
   with state/district/block/LGD, MIT licensed) but no migration or loader is
   written. **A PIN can span multiple districts** (110003 → both New Delhi and
   South East), so the table must not assume one district per PIN.
2. **The boundary endpoint.** Nothing serves the R2 shards yet. Intended shape:
   `GET /v1/graha/territories/{id}/geometry` → FeatureCollection for that
   territory's PINs only.
3. **`TerritoryMap.jsx` rewrite** onto the Mappls SDK with the corrected URL.
4. **CSP.** `frontend/vercel.json` blocks `sdk.mappls.com` in `script-src`,
   `connect-src` and `style-src`, and has no `worker-src`. **The map cannot load
   until this is changed.** Note there is also a typo in `connect-src`:
   `https://staging.kartavya.com` is missing the second `a` (should be
   `kartavaya`). Inert today because `'self'` covers it, but wrong.
5. **Address autosuggest**, server-side, debounced and cached.
6. **Routing** — PIN → territory → round-robin rep. The commercial half.

---

## Things that will waste your time if you do not know them

- **data.gov.in blocks WebFetch but not curl with a browser User-Agent.** The
  catalogue page is a JS app with no direct download link; the file came from
  the `yashveeeeeeer/india-geodata` GitHub release (tag `postal/boundaries`,
  asset `Datagov_Pincode_Boundaries.geojsonl.7z`). Feature count matches the
  government's published 19,312, which is the integrity check.
- **`backend/` has no geo libraries** and this work deliberately adds none. The
  prepare script implements Douglas-Peucker in ~20 lines of stdlib Python.
  Extraction needed `py7zr`, installed in a throwaway venv, never in
  `requirements.txt`.
- **The Browser pane takes ~15s** to pull network resources into a map library.
  I misdiagnosed a working PMTiles setup as broken three times by measuring at
  5–8 seconds. If a map looks blank, wait longer before concluding anything.
- **OSM's public tile server may not be used commercially.** It was fine for a
  throwaway demo; it cannot ship.
- **An Indian PIN code averages ~82 km²; a UK postcode covers ~17 addresses.**
  The owner asked for the UK "type a postcode, get your address" flow. It does
  not transfer. PIN can only fill district and state; the real equivalent is
  autosuggest on the address text.
- Boundary vintage is **May 2025 with no published refresh schedule**. The
  *directory* is monthly. Routing never reads the boundary file, so staleness is
  cosmetic — a new PIN routes correctly with no shape to draw.

---

## Coordination

At the time of writing, `git status` showed **14 modified files and 7 new test
files that are not mine** — payroll, billing, dristi, pahchan, e2e specs. That is
your work. I have touched **only**:

- `backend/scripts/prepare_pincode_boundaries.py` (new)
- `backend/scripts/upload_pincode_boundaries.py` (new)
- `.gitignore` (one appended block)
- `docs/HANDOVER-2026-08-26-territory-maps.md` (this file)
- `.claude/launch.json` — a temporary demo entry was added and **removed again**;
  it should be back to its original two configurations.

Nothing else. If you see other changes attributed to this session, they are not
mine.

## Status: UNOWNED — the plan reconciliation is DONE, the build is not

The owner asked session `kartavya-fb` to take the remaining work. **It declined,
correctly**: its own user's live instruction was Phase 2, and a peer session
relaying "the owner said so" is not the same as its user directing it. So the
remaining work in the drop-off list above **has no owner** and awaits the owner's
direction.

**The reconciliation against `docs/plans/` is complete.** `kartavya-fb` read the
plans and answered:

1. **No phase owns territories or CRM address capture.** Phases 0–6 are: owner
   unblocks / six write-paths / six correctness fixes / billing executable /
   eight invisible-feature screens / statute wiring / retire duplicates. This is
   **genuinely new scope — not an intruder, but also not planned**, which is why
   it needs the owner's call rather than a session's.
2. **The `rules.pincodes` finding contradicts nothing marked done.** No phase
   claims territory routing works. Nothing to settle.
3. **PHASE-4-invisible-screens is a plausible home in shape** — it is explicitly
   about features that exist in the schema with no screen — but it enumerates
   eight *named* screens and territories is not among them. It would be an
   **addition to** that phase, not a fit within it.

Two drop-off items were closed by that session, both verified here:

- The `connect-src` typo is **fixed** — `frontend/vercel.json` now reads
  `https://staging.kartavaya.com` (commit `111d60ff`). Strike it from the list.
- The Mappls CSP entries were deliberately **left alone**, which is right: adding
  `sdk.mappls.com` while nothing loads it is dead config. Do it with the map work.

**New constraint on that file, learned the hard way by that session:** the CSP's
sha256 for the inline pre-paint script in `index.html` had drifted, so the script
was blocked on every load — dark-mode flash, and a frame of blurred sidebar on
Windows. Fixed in `2ef060a9`, and `frontend/scripts/check-csp-hash.mjs` is now
the **first** gate in `npm run check`. If you edit that inline script, the hash
must move with it or the check goes red. That is the point of it.

---

For whoever does pick this up, the original reconciliation instruction is kept
below, since re-reading the plan against a changed tree is cheap and the answers
above are one session's reading, not gospel:

- `docs/plans/README.md`
- `docs/plans/PROGRESS.md`
- `docs/plans/PHASE-0-owner-unblocks.md`
- `docs/plans/PHASE-1-write-paths.md`
- `docs/plans/PHASE-2-correctness-fixes.md`
- `docs/plans/PHASE-3-billing-executable.md`
- `docs/plans/PHASE-4-invisible-screens.md`
- `docs/plans/PHASE-5-statute-wiring.md`
- `docs/plans/PHASE-6-retire-duplicates.md`

This work was scoped from a live conversation with the owner and **I did not
check it against a single one of those files.** Everything here should be
treated as unverified against the plan until you have done that.

Three specific things to look for:

1. **Does a phase already own territories or CRM address capture?** If so, that
   phase is authoritative and this handover is the intruder. Raise it with the
   owner rather than reconciling silently.
2. **Does the finding that `rules.pincodes` has no consumers contradict anything
   already marked done?** If a phase claims territory routing works, one of us
   is wrong and it is worth settling before more is built on it.
3. **Is `PHASE-4-invisible-screens.md` the natural home for this?** A map that
   draws nothing and a PIN list nothing reads are exactly that shape. I have not
   read the file; I am flagging the name, not asserting the fit.

When something here does land, `docs/STATUS.md` and `docs/plans/PROGRESS.md` need
updating in the same commit. I deliberately left both untouched — you were
actively writing in that area and a simultaneous edit is how those files get
mangled — so that update is owed, not done. And by CLAUDE.md's own bar nothing
here is ✅ yet: the scripts and the data exist, but no customer can draw a
territory.
