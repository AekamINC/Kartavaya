# Phase 8 — Maps across the modules

**Effort:** ~1 week, split into five independent steps · **Blocks on:** 7.3, 7.4,
7.5 for step 8.2 only — 8.1 and 8.4 block on nothing · **Runs parallel with:**
anything

> Phase 7 is **entirely Graha**. Every file it names is `backend/routers/graha.py`,
> `frontend/src/pages/graha/*` or `components/TerritoryMap.jsx`. This phase is
> what the other six modules get, and it deliberately front-loads the parts that
> need **no vendor, no API key and no CSP change**, because those can ship while
> Phase 7 is still arguing with a licence.

Written 2026-08-26 from proposal 92 (market research) plus a read of the live
tree. Where this plan and the research disagree, the code wins — three things
the research treated as "to build" turned out to be already shipped.

---

## What already exists — checked, not assumed

**Altitude on attendance is DONE, end to end.** The owner asked for it; it is
built. Migration `193_pahchan_altitude.sql` adds `altitude_m` +
`altitude_tolerance_m` to `pahchan_sites` and `altitude_m` +
`altitude_accuracy_m` to `pahchan_punches`; `routers/pahchan.py` validates the
pair, computes `_altitude_gap_m`, and refuses a tolerance with no altitude in
English rather than a 422; `mobile/src/api/pahchan.ts` and
`mobile/src/offline/punchQueue.ts` carry it through the offline queue;
`Sites.jsx`, `Rules.jsx` and `Register.jsx` all render it; and
`backend/tests/test_pahchan_altitude.py` guards it.

Migration 193's own header already contains the physics and it is correct:
GNSS vertical error runs ~1.5–3× horizontal, so **this cannot separate floor 10
from floor 9 (a storey is ~3 m) but it can separate a 10th floor from street
level**, and 15 m is the smallest tolerance that is not mostly noise.

- **The one open question is data, not code:** does any of the live sites
  actually carry an `altitude_m`? Migration 193 recorded 9 site rows and 1,659
  punch rows, all four columns NULL at the time. **Re-verify before claiming
  ✅** — a NULL altitude means the check is off, which is the correct default
  and also indistinguishable from "nobody ever used it".
- **Do not add a barometer.** It was considered and it is the wrong trade: a
  meaningful share of Android devices have no pressure sensor, and without a
  local reference, pressure-derived altitude drifts ±100 m with the weather.
  The GNSS number we already store, with its `altitude_accuracy_m` beside it,
  is the honest one.
- **Do not "fix" the sea-level offset.** What the browser and Expo return is
  WGS84 **ellipsoidal** height, and India sits over one of the largest geoid
  depressions on Earth — the anomaly southeast of India runs to about −105 m.
  This does not matter and must not be corrected, because the site altitude is
  captured by the same devices in the same frame: we compare a phone reading to
  a phone reading. `Sites.jsx:162` already says this. Converting one side to
  orthometric height would break every existing site.

---

## The two things every module gets, and the rule that separates them

**Geocoding is a save-time event, never a view-time event.** Everything below
follows from that one line.

| | The free layer | The precise layer |
|---|---|---|
| What it shows | the PIN area the address falls in | the exact place |
| Where the data comes from | `shared/reference/pincode-boundaries/` in R2 — already ours | Google Maps, in Google's tab |
| Cost per open | zero | zero |
| Address sent to a vendor | **never** | only what the user chose to open |
| Honest caption | "PIN area — ~82 km² on average, not the building" | — |

A rooftop pin drawn *inside* our app is the third option and it is the
expensive one: it needs a geocode per popup, which is metered, and which sends
a client's premises to Mappls on every open — and Mappls' terms take a
perpetual sub-licensable licence over submitted content and forbid caching the
result to avoid fees (proposal 92 §6.3). So a stored coordinate is only ever
written when a human deliberately drops a pin (8.4), never as a side effect of
looking at a record.

---

## 8.0 · `<AddressBlock>` — one component, six modules, no vendor  ⭐ **start here**

The cheapest item in the whole map programme and the widest. No API key, no
CSP change, no metering, no licence exposure.

- **Do:** one component that renders a stored address and offers **Open in
  Maps** — an anchor to
  `https://www.google.com/maps/search/?api=1&query={encodeURIComponent(...)}`.
  Prefer `query={lat},{lng}` when a coordinate exists (far more accurate than
  an Indian address string); fall back to the joined address text. Desktop
  opens a new tab; mobile web offers the Google Maps app; in Expo use
  `Linking.openURL` on the same URL and the app opens directly.
- **Why it is free:** the Maps URLs scheme takes **no API key, no quota and no
  billing account**, and an anchor is not a fetch, so `vercel.json` is untouched.
- **Licence read:** a link out is navigation, not a map rendered in our
  application, so it does not collide with the Mappls "not with or near a
  non-Mappls Map" clause. **This is an interpretation, not a quoted clause** —
  if it is ever contested, the fallback is to point the link at Mappls instead,
  which is a one-line change because the URL is built in one place.
- **Consumers, in rollout order** — all six use the same component:

  | Module | Surface | Table + column |
  |---|---|---|
  | Graha | client detail, contact detail | `graha_clients.address`, `graha_contacts.billing_address` / `shipping_address` |
  | Ganit / Kray | vendor detail | `ganit_vendors.address` |
  | Manav | employee detail | `manav_employees.address` |
  | Vikray | order shipping block | `vikray_orders.shipping_address` |
  | Pahchan | a punch in the Register | `pahchan_punches.lat` / `.lng` — coordinate, so `query=lat,lng` |
  | Ganit | invoice address block | already renders `pincode` in `invoice_pdf.py` |

- **Accept:** the same component imported by five pages plus one mobile screen;
  clicking it on a real Unicode client opens Google Maps at that address. A
  render test asserts the href is built from the record, and that a record with
  no address renders **nothing at all** rather than a link to `?query=`.
- **Watch:** Unicode's `Navrang Polymers` has its whole address stored as a
  stringified JSON exploded into character keys, and `INC UK` has
  `pincode = 'NW1 245'`. Both must render without throwing — the component
  degrades to "no address", it never guesses.

## 8.1 · Pahchan: the map that is actually missing

The strongest non-Graha map case in the product, and the code already says so.

- **Fault:** a geofence is configured by **typing two decimal numbers and a
  radius**. `Sites.jsx:31` names the risk itself — *"a radius typed as 15
  instead of 150, or a pin dropped on the"* wrong place — and there is no way
  to see either. `Register.jsx:231` records that the prototype had a Leaflet
  map on OSM tiles and this does not.
- **Do:** (a) a map on the site form — drop a pin, drag the radius, read back
  lat/lng/radius into the same fields the form already posts; (b) the punch
  shown against its site circle in the Register, so a reviewer sees *why* a
  punch was flagged instead of reading two numbers.
- **Altitude stays a number, not a map layer.** A circle is horizontal; the
  vertical window is already explained in words on `Rules.jsx:119`. Do not try
  to draw it.
- **Depends on 7.4 (CSP) and 7.5 (SDK loader).** Reuse the loader from 7.5 —
  do not write a second one.
- **Accept:** a site created through the map form produces the same row shape
  as one typed by hand, proven by an existing site edited both ways; and a
  flagged punch in the Register draws inside/outside its circle.

## 8.2 · The PIN preview popover — free, and it reuses 7.3

- **Do:** make the pincode in `<AddressBlock>` clickable. It opens a popover
  drawing that PIN's polygon from the geometry endpoint built in 7.3, on the
  Mappls basemap from 7.5, with the district and state from the 7.2 directory
  underneath it.
- **No geocode. No address leaves our servers. No per-open metering.**
- **The caption is load-bearing:** *"PIN area — an Indian PIN averages ~82 km².
  This shows the postal area, not the building."* The same expectation reset
  7.6 owes the address form.
- **Honour 7.3's three buckets.** `unmatched` (58 directory PINs have no
  boundary) must say "no boundary published for 400097", and `unavailable` (R2
  read failed) must never be shown as if the PIN does not exist.
- **Accept:** clicking `395002` on a Unicode contact draws one polygon and
  names Surat, Gujarat, with zero calls to any vendor endpoint in the network
  tab.

## 8.3 · Address autosuggest, reused

- **Do:** lift the field group built in 7.6 into a shared `<AddressForm>` and
  give it to `ganit_vendors`, `manav_employees` and `vikray_orders`.
- **Carry 7.6's constraints with it, not just its code:** query fragment only,
  never the stored record; not fired for an already-saved address; **never on
  the public inbound form**; Mappls named as a processor in the privacy notice.
- **Meter it per org per day from the first commit.** Mappls publishes no
  pricing and its console's own usage figures are contractually definitive, so
  our count is for reconciliation, not discovery.
- **Accept:** a vendor created in Kray through autosuggest lands a `pincode` in
  `ganit_vendors.address`, and the daily call count for the org is queryable.

## 8.4 · One coordinate, written on purpose

Deliberately last, because it is the only step that creates an obligation.

- **Do:** a "drop a pin" affordance on `<AddressBlock>` for a user who wants
  precision. It writes `lat`, `lng`, **`geo_source`** and **`geo_fetched_at`**
  in the same migration — never a bare coordinate pair.
- **Why those two extra columns:** they are what makes a retention rule, a
  vendor swap or a licence answer possible later. Without them the only honest
  answer to "where did this coordinate come from" is a shrug. Google's terms
  permit a cached coordinate for 30 days and a `place_id` indefinitely; Mappls
  forbids caching to avoid fees. A coordinate with no provenance cannot comply
  with either.
- **The reward, and it costs nothing:** once a coordinate exists we can emit a
  **DIGIPIN** beside it — India Post's 10-character, ~4 m grid code, open
  source, encode/decode is pure arithmetic with **no vendor and no API call**.
  That is the precision the owner was asking for when he asked for the UK
  postcode flow. It cannot be typed (there is no address→DIGIPIN directory), so
  it only becomes available the moment a location is captured.
- **What it unlocks, and none of it before this:** "clients near me" (research
  rank 5), conveyance distance in Manav (rank 11), coverage heat maps in Dristi
  (rank 10).
- **Accept:** one contact carries a coordinate, its `geo_source`, and a DIGIPIN
  derived from it locally.

---

## Order of work

**8.0 → 8.1 → 8.2 → 8.3 → 8.4.**

8.0 first because it needs nothing from Phase 7 and can ship the same day.
8.1 next because it fixes a real defect (an invisible geofence) rather than
adding a view. 8.2 and 8.3 wait on Phase 7 landing. 8.4 last because a stored
coordinate is a commitment and everything before it is reversible.

## Deliberately not in this phase

- **Route optimisation** — a product, not a feature. Zoho built a separate
  paid app for it.
- **Heat maps** — meaningless at 289 contacts. Revisit at four figures.
- **Live staff tracking** — the highest DPDP exposure in the map catalogue and
  the poorest fit for a professional-services product. A geofence that captures
  location only at the punch is materially more defensible than continuous
  tracking, and that is what we already have.
- **An embedded Google map anywhere** — forbidden while a Mappls map exists in
  the same application (proposal 92 §6.2). Link out; never embed.
- **A geocode-results cache as a cost lever** — forbidden by the Mappls terms.
  If volume bites, make fewer calls.

## Definition of done

- `<AddressBlock>` imported by five web pages and one mobile screen, with a
  render test asserting an empty address renders no link.
- A Pahchan site created by dropping a pin, proven by a row identical in shape
  to a typed one.
- A PIN popover that draws a polygon with **zero vendor calls** in the network
  tab, and that names an unmatched PIN instead of dropping it.
- Autosuggest live on vendors and employees, with a per-org daily call count.
- If 8.4 ships: one coordinate with `geo_source` and `geo_fetched_at` beside it.
- `npm run build` **and** `npm run check` — `check` alone exits 0 on
  unparseable CSS and this phase adds map styles.
- `cd backend && python -m pytest -q` against the known baseline, not zero.
- `docs/STATUS.md` and `docs/plans/PROGRESS.md` updated in the same commit.

## Provenance

Feature ranking, competitor behaviour, Mappls licence conditions and the
Indian addressing evidence: `docs/proposals/92-map-integration-market-research.html`.
Graha-side capture, routing, boundaries, CSP and the map itself:
`docs/plans/PHASE-7-territory-and-address.md`, which remains the plan of record
for everything inside Graha. The altitude findings above come from reading
migration 193, `routers/pahchan.py`, `mobile/src/offline/punchQueue.ts` and the
three Pahchan screens on 2026-08-26 — it is built, and the only thing left to
check is whether a live site uses it.
