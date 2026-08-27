import React from 'react';
import { GST_STATES } from '../../lib/validators';

/**
 * AddressBlock — a stored address, and the one way out to a map.
 *
 * Phase 8.0. One component, every module: Graha clients and contacts, Ganit /
 * Kray vendors, Manav employees, Vikray order shipping, and a Pahchan punch —
 * which carries a coordinate rather than an address and is the reason the
 * coordinate path exists at all.
 *
 * ── WHY THIS COSTS NOTHING ──────────────────────────────────────────────────
 *
 * The link is an ANCHOR to the Google Maps URLs scheme, which takes no API
 * key, no quota and no billing account. An anchor is navigation, not a fetch,
 * so it is not subject to `connect-src` and `vercel.json` is untouched by this
 * whole component. If you ever find yourself editing the CSP for a map link,
 * something else has gone wrong.
 *
 * The licence read behind it (PHASE-8 §8.0): a link OUT is navigation, not a
 * map rendered inside our application, so it does not collide with the Mappls
 * "not with or near a non-Mappls Map" clause. That is an interpretation and
 * not a quoted clause. It is safe to hold because the URL is built in exactly
 * one place — `mapsHref` below — so repointing it at Mappls if the reading is
 * ever contested is a one-function change.
 *
 * ── WHY THE COORDINATE WINS WHEN THERE IS ONE ───────────────────────────────
 *
 * Indian addresses geocode badly: unnumbered buildings, landmark-relative
 * directions, and a PIN that averages ~82 km². A stored `lat,lng` skips the
 * geocoder entirely and lands on the place. So a coordinate, when present,
 * always beats the address text — the address text is still what the human
 * READS, because "18.9333, 72.8336" tells nobody anything.
 *
 * ── EMPTY MEANS NO USABLE KEY. IT NEVER MEANS NULL. ─────────────────────────
 *
 * A link to `?query=` opens Google Maps on the user's current location, which
 * looks exactly like the product having found the client's premises. It is the
 * worst possible failure: confidently wrong. So a record with no address and
 * no coordinate returns `null` — not a disabled link, not an em-dash, nothing.
 * Past the guard, `href` is by construction never empty.
 *
 * `if (!address) return null` would be WRONG, and wrong on the majority of
 * live rows. Measured 2026-08-27: in E2E Test & Associates all 235 contacts
 * have `billing_address IS NOT NULL`, and every one of them is `{}`. So are
 * all 83 `manav_employees.address` and all 322 `vikray_orders.shipping_address`
 * in that org. The emptiness test is "no key we can read", which is what
 * `addressLines(...).length` computes, and it is also not
 * `Object.keys(x).length` — see Navrang below, which has 43.
 *
 * ── THE ADDRESSES IN THIS DATABASE ARE NOT UNIFORM ──────────────────────────
 *
 * Everything here is written against what is stored, not against the DDL. All
 * six columns are `jsonb`, in `staging` only, and every populated row measured
 * so far is an object. What varies is what is INSIDE it:
 *
 *   1. the object the DDL promises — some subset of the seven keys below.
 *   2. an object whose keys are "0", "1", "2" … : a JSON string that a client
 *      spread with `{...address}` and saved back. `backend/db.py:_json_encoder`
 *      documents where the string came from — ~120 call sites called
 *      `json.dumps` before binding, a codec dumped it a second time, and the
 *      column held a serialised string. Audited live 2026-07-29: 38 jsonb
 *      columns across 26 tables. The encoder is fixed; the rows are the fossil.
 *   3. a JSON *string*, the shape before somebody spread it. No populated row
 *      in the six swept columns is one today, but `routers/manav.py` records
 *      measuring `address` and `bank_details` coming back as strings from this
 *      very table, and case 2 cannot exist without case 3 having existed. It is
 *      eight lines to decode and it is the difference between showing an
 *      address and showing a blank, so it is handled.
 *
 * Case 3 is DECODED: a deterministic `JSON.parse` of a documented
 * double-encoding is not a guess. Case 2 is READ BY NAME, which is the whole
 * trick and is worth stating plainly, because the obvious implementations both
 * fail on it:
 *
 *     Unicode Group's `Navrang Polymers` has 43 keys. "0" through "41" spell
 *     `{"city": "Mumbai", "state": "Maharashtra"}` one character per key. The
 *     43rd is a GENUINE `city` holding "Navi Mumbai" — which contradicts the
 *     exploded copy. Render every key, or join the values in key order, and you
 *     get a line of punctuation. Read the seven known names, and you get "Navi
 *     Mumbai" and nothing else, because "0".."41" are not among them.
 *
 * So the rule is not "drop the malformed record". It is: read the keys we know,
 * ignore everything else, and never reassemble anything. Reassembling a string
 * from character-indexed keys is exactly the guess §8.0 forbids — and it would
 * lose to the real `city` sitting beside it anyway.
 *
 * Nothing here validates. `INC UK` (Unicode Group) is
 * `{"city":"Uganda","line1":"London","line2":"Bopal Circle","state":"New
 * York","pincode":"NW1 245"}` — incoherent in every field, not only the UK
 * postcode in an Indian-PIN column. It renders as stored and it travels into
 * the query as stored. Blanking a record because its PIN is not six digits
 * would be the same guess in the other direction, and would take a real
 * address off the screen to enforce a rule nobody asked for.
 *
 * Note `backend/services/doc_render.py:fmt_addr` deliberately does NOT decode
 * case 3 — it returns "" for anything that is not a dict. That is right for a
 * PDF, where a blank line on a tax invoice is safer than a recovered one. It is
 * wrong for a screen whose entire job is showing the address we hold.
 */

/**
 * The seven keys that exist on live rows, in `invoice_pdf.py:_fmt_addr`'s
 * order, so a client's address reads the same on screen as on the invoice
 * raised against it. The split into two visual lines falls after `line2`,
 * where both backend renderers put it: street above, locality below.
 *
 * Any key NOT named here is ignored, which is the whole of case 2's defence.
 *
 * `state_code` is the seventh and it is never printed — see `stateOf`.
 */
const TOP = ['line1', 'line2'];

/** A value is part of an address only if it is text with something in it. */
function text(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v !== 'string') return '';
  return v.trim();
}

/**
 * The state, as a NAME, or nothing.
 *
 * `state_code` is the numeric GST code — '24' Gujarat, '27' Maharashtra — and
 * it is on real rows: all 61 populated `graha_clients` in E2E Test & Associates
 * carry `line1`, `city` and `state_code`, and never a `state` or a `pincode`.
 * Printing the code raw gives "Ahmedabad, 24", which reads as a house number.
 *
 * So it resolves through the same statutory table `EmployeesTab` resolves the
 * employee work state with — "The NAME, never the code", the comment there —
 * and an unrecognised code yields NOTHING rather than its own digits. That is
 * the one place this differs from `stateLabel` in Manav, which falls back to
 * the raw value: a code nobody recognises is still useful on a personnel form
 * that an importer wrote, and is noise inside a map query.
 *
 * `state` wins when both are present. It is what a human typed, and Navrang is
 * the standing proof that two fields describing one place can disagree.
 */
function stateOf(f) {
  const named = text(f.state);
  if (named) return named;
  const code = text(f.state_code);
  if (!code) return '';
  return GST_STATES[code] || GST_STATES[code.padStart(2, '0')] || '';
}

/**
 * Whatever the column handed back → the address object, or null.
 *
 * `depth` bounds the case-3 decode. One level is what the double-encode
 * produced; the bound exists so that a hypothetical triple-encoded row cannot
 * turn a render into a loop.
 */
function asFields(raw, depth = 0) {
  if (raw == null) return null;

  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return null;
    // A serialised object or array — case 3. Anything that fails to parse is
    // corruption rather than an address somebody typed, so it is dropped
    // rather than rendered as literal braces.
    if (t[0] === '{' || t[0] === '[') {
      if (depth > 0) return null;
      let parsed;
      try { parsed = JSON.parse(t); } catch { return null; }
      return asFields(parsed, depth + 1);
    }
    // A column holding an address as a person would write it. None of the six
    // swept columns is `text`, so this is reached only by a caller passing one
    // that has not been swept. It goes in `line1` because that is where a
    // single line of street text belongs; there is nothing to split on that
    // would not be a guess.
    return { line1: t };
  }

  // Arrays are objects too, and an address is never one.
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw;
}

/**
 * The address as at most two display lines. `[]` when there is nothing we can
 * read — which covers `null`, `{}`, and every malformed shape above.
 *
 * Exported because it is the emptiness test a caller needs when its own
 * section heading must not appear over a blank, and because 8.2's PIN popover
 * will read the same columns and must read them the same way.
 */
export function addressLines(raw) {
  const f = asFields(raw);
  if (!f) return [];
  const top = TOP.map(k => text(f[k])).filter(Boolean).join(', ');
  const bottom = [text(f.city), stateOf(f), text(f.pincode), text(f.country)]
    .filter(Boolean).join(', ');
  return [top, bottom].filter(Boolean);
}

/**
 * A latitude or longitude, or null.
 *
 * Deliberately narrow about what it accepts. `Number('')`, `Number(null)`,
 * `Number(false)` and `Number([])` are all `0` — Null Island, off the coast of
 * Ghana — so anything that is not a number or a numeric string is refused
 * before `Number` is ever reached. `pahchan_punches.lat` is `NUMERIC(10,7)`,
 * which asyncpg hands back as a Decimal and FastAPI may serialise either way,
 * so both a number and its string form are legitimate here.
 */
function finite(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Both halves, in range, or null. A half-coordinate is not a location. */
export function coordinate(lat, lng) {
  const a = finite(lat);
  const b = finite(lng);
  if (a === null || b === null) return null;
  if (a < -90 || a > 90 || b < -180 || b > 180) return null;
  return { lat: a, lng: b };
}

/**
 * The one place the map URL is built. `null` when there is nothing to search
 * for — callers must treat that as "render no link", never as "link to an
 * empty query".
 */
export function mapsHref({ address, lat, lng } = {}) {
  const c = coordinate(lat, lng);
  // Full precision into the URL. The 4-decimal form below is for the human;
  // rounding is ~11 m at this latitude and there is no reason to spend it.
  const query = c ? `${c.lat},${c.lng}` : addressLines(address).join(', ');
  if (!query) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/**
 * Four decimals ≈ 11 m, which is finer than the GNSS fix that produced the
 * number and is what `pahchan/Register.jsx` has always shown. Changing the
 * displayed precision would change every punch row for no gain.
 */
function coordText(c) {
  return `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`;
}

/**
 * @param {object|string|null} address  the stored column, in any of its shapes
 * @param {number|string|null} lat      preferred over `address` when present
 * @param {number|string|null} lng
 * @param {string} label   block layout only; pass '' to suppress the heading
 * @param {boolean} inline one line, no heading — for a table cell or a
 *                         key/value row whose key is already the label
 * @param {string} linkLabel
 */
export default function AddressBlock({
  address,
  lat,
  lng,
  label = 'Address',
  inline = false,
  linkLabel = 'Open in Maps',
}) {
  const lines = addressLines(address);
  const coord = coordinate(lat, lng);

  // PHASE-8 §8.0's acceptance, first clause: a record with no address renders
  // NOTHING AT ALL rather than a link to `?query=`.
  if (!lines.length && !coord) return null;

  // A punch has a coordinate and no address; a client has an address and no
  // coordinate; after 8.4 a record may have both, and then the words are what
  // is read and the coordinate is what is opened.
  const shown = lines.length ? lines : [coordText(coord)];
  const href = mapsHref({ address, lat, lng });

  /* `target="_blank"` because the plan says desktop opens a new tab and
     because losing an open record to a map is a bad trade.

     `rel="noreferrer"` is doing real work and is not boilerplate. It suppresses
     the Referer header, and our URLs carry record ids — `/graha/clients/<uuid>`.
     Sending that to Google alongside the customer's premises would hand a
     vendor a join key for free, which is the opposite of §8.0's "address sent
     to a vendor: only what the user chose to open". It implies `noopener`,
     so the tab also gets no handle on `window.opener`. */
  const link = (
    <a className="k-link k-addr__link" href={href} target="_blank" rel="noreferrer">
      {linkLabel}
    </a>
  );

  if (inline) {
    // Spans throughout: the inline layout is dropped into `<dd>` and into
    // `rv-meta__v`, which is itself a span. A <div> inside a <span> is invalid
    // and inherits none of the row's inline sizing.
    return (
      <span className="k-addr k-addr--inline">
        <span className="k-addr__text">{shown.join(', ')}</span>
        {link}
      </span>
    );
  }

  return (
    <div className="k-addr">
      {label && <div className="k-addr__lbl">{label}</div>}
      <div className="k-addr__text">
        {shown.map(line => <div className="k-addr__line" key={line}>{line}</div>)}
      </div>
      {link}
    </div>
  );
}

export { AddressBlock };
