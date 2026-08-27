/**
 * ClientLocations — where a firm's client companies actually are, and, said out
 * loud, how many of them we cannot place at all. Phase 8.3.
 *
 * ── READ THIS BEFORE ASKING WHERE THE MAP IS ────────────────────────────────
 *
 * There is no basemap in this file, and that is the finding rather than an
 * omission. 8.3 was scoped as "the client map"; measured against the live rows
 * on 2026-08-27, a drawn client map cannot be built yet, for two independent
 * reasons, either of which alone would be fatal:
 *
 *   1. NO CLIENT CARRIES A COORDINATE. `graha_clients` has no `lat`/`lng` at
 *      all — those columns, with `geo_source` and `geo_fetched_at` beside them,
 *      are what PHASE-8 §8.4 exists to add, and §8.4 is deliberately LAST
 *      because a stored coordinate is the one step that creates an obligation.
 *      Geocoding an address at view time to fill the gap is exactly what §8.0
 *      forbids: it is metered, and it sends a customer's premises to a vendor
 *      whose terms take a perpetual licence over what we submit.
 *
 *   2. THE ONLY GEOMETRY ENDPOINT IS TERRITORY-SCOPED. The free layer — a PIN's
 *      published boundary out of R2, no vendor, no metering — is reachable only
 *      through `GET /v1/graha/territories/{id}/geometry` (Phase 7.3). There is
 *      no route that answers for a bare pincode. And the two real orgs are
 *      arranged so that the workaround is not merely awkward, it is empty:
 *
 *          E2E Test & Associates   17 territories · 0 client pincodes
 *          Unicode Group            0 territories · 21 client pincodes
 *
 *      Every client pincode in the product belongs to the org that has no
 *      territory, so routing clients through territory geometry would draw
 *      precisely nothing. That is a fact about the data, not a guess about it.
 *
 * A map centred on India with no shape on it is worse than no map: this repo
 * spent a day on an empty Mappls box that rendered its credit, rendered its
 * coverage line, and drew nothing — every signal a reader would check said the
 * feature worked. So this component renders the sentences a map would have been
 * a picture of, and it renders them TRUE.
 *
 * ── WHAT WAS MEASURED, 2026-08-27, READ-ONLY ────────────────────────────────
 *
 *   E2E Test & Associates   61 active companies
 *                           48 line1 · 43 city · 30 state_code · 0 pincode
 *   Unicode Group           28 active companies
 *                           22 pincode, of which 21 are six digits
 *                           5 whose `address` is `{}`
 *                           19 distinct PINs, all 19 in `staging.pin_directory`
 *
 * So the honest coverage of a PIN-area map today would be 21 of 89 companies
 * across both orgs, and 0 of 61 in one of them. A picture showing 21 pins is
 * read as "here are our clients"; this panel is built so that it cannot be.
 * The denominator is never optional here and never smaller than the truth.
 *
 * ── EMPTINESS IS NOT NULLNESS, AND KEY COUNT IS NOT EMPTINESS ───────────────
 *
 * `graha_clients.address` is `jsonb NOT NULL`. A `!address` test passes on
 * every row in the database and measures nothing at all. The five unplaceable
 * Unicode rows are `{}`, not null.
 *
 * And `Object.keys(address).length` is the other trap. Unicode's `Navrang
 * Polymers` holds 43 keys: "0".."41" spell `{"city": "Mumbai", "state":
 * "Maharashtra"}` one character per key — a JSON string that a caller spread
 * with `{...address}` and saved back — plus a 43rd, genuine `city` of "Navi
 * Mumbai" that CONTRADICTS the exploded copy. Count keys and it is the
 * best-described address in the org. Join the values and it is a line of
 * punctuation. Read the keys we know BY NAME and it is "Navi Mumbai", which is
 * the right answer and the only one that does not involve reassembling
 * anything. Nothing here reassembles anything.
 *
 * `INC UK` is the mirror case: `pincode: "NW1 245"`. It is not an Indian PIN,
 * it is not corrected, it is not blanked, and it is not quietly dropped — it is
 * counted in its own line and shown as stored. Blanking a record because its
 * PIN is not six digits is the same guess in the other direction.
 *
 * ── WHY THE FIELD READER IS A SECOND COPY ───────────────────────────────────
 *
 * `ui/AddressBlock` decodes the same three stored shapes and exports
 * `addressLines`, which is the emptiness test and is used here for exactly
 * that. What it does not export is the FIELDS — it has no reason to; its job is
 * two display lines. Placing a company needs the pincode and the town as
 * separate values, so `fieldsOf` below repeats that decode deliberately. The
 * duplication is named rather than hidden, and `clientLocations.test.jsx` pins
 * both against the same live specimens so the two cannot drift silently.
 *
 * ── PRIVACY AND THE ID RULE ─────────────────────────────────────────────────
 *
 * Takes rows as a prop and fetches nothing; no address is ever put in a request
 * from here. It renders company NAMES and never an id — it is not given one, so
 * it cannot render one (`check-rendered-ids.mjs`). The one outbound thing is an
 * anchor to the Google Maps URL scheme, which takes no key and no quota, and it
 * is built for a PIN AREA — never for a named company's street address, which
 * is the one join a reader could hand a vendor by clicking.
 */
import React, { useMemo } from 'react';
import { addressLines, mapsHref } from './ui/AddressBlock';
import { GST_STATES } from '../lib/validators';
import '../styles/clientmap.css';

/** A six-digit Indian PIN. Nothing else is treated as one, ever. */
const PIN = /^\d{6}$/;

/** A value counts only if it is text with something in it. */
function text(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v !== 'string') return '';
  return v.trim();
}

/**
 * The stored column → a plain object of fields, or null.
 *
 * The same three shapes `AddressBlock.asFields` handles: the object the DDL
 * promises, the character-exploded object, and the doubly-encoded JSON string.
 * `depth` bounds the decode so a hypothetically triple-encoded row cannot turn
 * a render into a loop.
 */
function fieldsOf(raw, depth = 0) {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return null;
    if (t[0] === '{' || t[0] === '[') {
      if (depth > 0) return null;
      let parsed;
      try { parsed = JSON.parse(t); } catch { return null; }
      return fieldsOf(parsed, depth + 1);
    }
    return { line1: t };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw;
}

/**
 * The state as a NAME, never the GST code.
 *
 * All 30 populated E2E companies carry `state_code` and no `state`, so printing
 * the raw value would group them under "24" and "27". An unrecognised code
 * yields nothing rather than its own digits — a number nobody recognises is
 * noise in a place name. `state` wins when both exist: Navrang is the standing
 * proof that two fields describing one place can disagree.
 */
function stateOf(f) {
  const named = text(f.state);
  if (named) return named;
  const code = text(f.state_code);
  if (!code) return '';
  return GST_STATES[code] || GST_STATES[code.padStart(2, '0')] || '';
}

/**
 * One company's stored address → what can be said about where it is.
 *
 * Exported for the test, and because 8.4 will need the same read to decide
 * which records are worth offering a pin drop on.
 *
 *   pin      a six-digit Indian PIN, or ''
 *   pinRaw   whatever was stored in `pincode`, as stored
 *   city     the town, or ''
 *   state    the state NAME, or ''
 *   hasText  is there ANY readable address at all (the emptiness test)
 */
export function placeOf(address) {
  const f = fieldsOf(address);
  const pinRaw = f ? text(f.pincode) : '';
  return {
    pin: PIN.test(pinRaw) ? pinRaw : '',
    pinRaw,
    city: f ? text(f.city) : '',
    state: f ? stateOf(f) : '',
    hasText: addressLines(address).length > 0,
  };
}

const plural = (n, one, many) => (n === 1 ? one : many);

/** "A, B and C" — names, in a sentence a person can read. */
function nameList(names) {
  if (names.length <= 2) return names.join(' and ');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Sort groups by size then by label, so the picture is stable between renders
 * and the biggest concentration is the first thing read.
 */
function ranked(map) {
  return [...map.values()].sort(
    (a, b) => b.names.length - a.names.length || a.key.localeCompare(b.key),
  );
}

/**
 * @param {Array<{name: string, address: *}>} clients the companies as listed —
 *        this is the denominator, and it is the search result when a search is
 *        running. Ids are neither wanted nor read.
 */
export default function ClientLocations({ clients = [] }) {
  const view = useMemo(() => {
    const byPin = new Map();
    const byTown = new Map();
    const oddPin = [];
    const streetOnly = [];
    const nothing = [];

    clients.forEach((c) => {
      const name = text(c?.name) || 'Unnamed company';
      const p = placeOf(c?.address);

      if (p.pin) {
        const g = byPin.get(p.pin) || { key: p.pin, names: [], states: new Set() };
        g.names.push(name);
        if (p.state) g.states.add(p.state);
        byPin.set(p.pin, g);
        return;
      }
      // A pincode that is stored but is not an Indian PIN gets its own line and
      // is never corrected. It may still have a town, and that is said too.
      if (p.pinRaw) {
        oddPin.push({ name, value: p.pinRaw, where: [p.city, p.state].filter(Boolean).join(', ') });
        return;
      }
      if (p.city || p.state) {
        const key = [p.city, p.state].filter(Boolean).join(', ');
        const g = byTown.get(key) || { key, names: [] };
        g.names.push(name);
        byTown.set(key, g);
        return;
      }
      // A street line with no town and no PIN places nobody. Neither does `{}`,
      // and the two are different problems for whoever fixes them.
      (p.hasText ? streetOnly : nothing).push(name);
    });

    const pins = ranked(byPin);
    const towns = ranked(byTown);
    const placedByPin = pins.reduce((n, g) => n + g.names.length, 0);
    const placedByTown = towns.reduce((n, g) => n + g.names.length, 0);

    return {
      pins, towns, oddPin, streetOnly, nothing,
      placedByPin, placedByTown,
      unplaced: oddPin.length + streetOnly.length + nothing.length,
      total: clients.length,
    };
  }, [clients]);

  if (!view.total) return null;

  const {
    pins, towns, oddPin, streetOnly, nothing, placedByPin, placedByTown, unplaced, total,
  } = view;

  return (
    <section className="clm" aria-label="Where these companies are">
      {/* The count, with its denominator, before anything else. A reader who
          stops at the first line must still have been told what is missing. */}
      <p className="clm__lead" role="status">
        {placedByPin > 0 ? (
          <>
            <strong>{placedByPin}</strong> of <strong>{total}</strong>{' '}
            {plural(total, 'company', 'companies')} listed here{' '}
            {plural(placedByPin, 'carries', 'carry')} a pincode, falling in{' '}
            <strong>{pins.length}</strong> pincode{' '}
            {plural(pins.length, 'area', 'areas')}.
          </>
        ) : (
          <>
            None of the <strong>{total}</strong>{' '}
            {plural(total, 'company', 'companies')} listed here carries a
            pincode, so none of them can be placed on a map.
          </>
        )}
        {placedByTown > 0 && (
          <>
            {' '}Another <strong>{placedByTown}</strong>{' '}
            {plural(placedByTown, 'has', 'have')} a town or a state and no
            pincode — a district, not a place.
          </>
        )}
        {unplaced > 0 && (
          <>
            {' '}<strong>{unplaced}</strong>{' '}
            {plural(unplaced, 'is', 'are')} not placed at all.
          </>
        )}
      </p>

      {/* The expectation reset, and it is load-bearing rather than decorative.
          A PIN is an administrative area averaging ~82 km²; a reader shown a
          pincode grouping and not told this reads it as an address. */}
      <p className="clm__caveat">
        A pincode is a postal area — an Indian PIN averages about 82 km² — so
        this is the district a company falls in, never its building. No company
        in this product has a saved location, so nothing here is drawn on a map;
        the links below open the postal area, not the premises.
      </p>

      {pins.length > 0 && (
        <div className="clm__groups">
          {pins.map((g) => {
            /* The state is carried into the query ONLY when every company in
               the group agrees on it. Two companies in one PIN naming two
               states is a data conflict, and picking one would be a guess.
               The company's own street address is deliberately NOT sent: this
               link is the postal area, and a per-company link already exists
               on that company's own record. */
            const state = g.states.size === 1 ? [...g.states][0] : '';
            const href = mapsHref({ address: { pincode: g.key, state } });
            return (
              <div className="clm__grp" key={g.key}>
                <span className="clm__pin">{g.key}</span>
                <span className="clm__count">
                  {g.names.length} {plural(g.names.length, 'company', 'companies')}
                  {state && <span className="clm__where"> · {state}</span>}
                </span>
                <span className="clm__names">{nameList(g.names)}</span>
                {href && (
                  <a
                    className="k-link clm__go"
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open this pincode area
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}

      {towns.length > 0 && (
        <div className="clm__groups">
          <h5 className="clm__sub">Town or state only — no pincode stored</h5>
          {towns.map((g) => {
            const href = mapsHref({ address: { city: g.key } });
            return (
              <div className="clm__grp clm__grp--soft" key={g.key}>
                <span className="clm__place">{g.key}</span>
                <span className="clm__count">
                  {g.names.length} {plural(g.names.length, 'company', 'companies')}
                </span>
                <span className="clm__names">{nameList(g.names)}</span>
                {href && (
                  <a
                    className="k-link clm__go"
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open this area
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}

      {unplaced > 0 && (
        <div className="clm__gaps">
          {oddPin.map((o) => (
            <p className="clm__gap" key={`${o.name}:${o.value}`}>
              <strong>{o.name}</strong> has a pincode of “{o.value}”, which is
              not a six-digit Indian pincode. It is shown as stored and nothing
              is corrected here
              {o.where ? <> — the address gives {o.where}</> : null}.
            </p>
          ))}
          {streetOnly.length > 0 && (
            <p className="clm__gap">
              {streetOnly.length} {plural(streetOnly.length, 'company has', 'companies have')} a
              street line but no town, state or pincode, so there is nothing to
              place {plural(streetOnly.length, 'it', 'them')} by:{' '}
              {nameList(streetOnly)}.
            </p>
          )}
          {nothing.length > 0 && (
            <p className="clm__gap">
              {nothing.length} {plural(nothing.length, 'company has', 'companies have')} no
              address stored at all: {nameList(nothing)}.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
