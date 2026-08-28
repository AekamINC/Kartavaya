/**
 * PincodeAutofill — the district and state a PIN is in, from OUR OWN data.
 *
 * Phase 7.6's second half, and the half that actually works today.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * §7.6 is "Indian address capture", and the plan's mechanism for it was Mappls
 * autosuggest. That is built, wired and correct — and Mappls refuses it. Six
 * routes were measured on 2026-08-28 and every one was refused; the credential
 * is fine and the block is domain validation on server-side calls, which only
 * their console or their support can change (OWNER-ACTIONS item 14).
 *
 * So the address forms had a box that could only apologise. This is the part of
 * the same job that needs nobody's permission:
 *
 *     GET /v1/pincodes/{pin}   ->  staging.pin_directory, 20,144 rows,
 *                                  Government of India, already in our database
 *
 * No key, no quota, no allocation, no vendor call, and — the part that matters
 * most — **no licence encumbrance**. Nothing is submitted to anybody, so
 * nothing is licensed to anybody, and the Geospatial Data Guidelines question
 * hanging over the Mappls path (a foreign entity may not route Indian map data
 * through its own servers) does not arise: this is open government data we
 * already hold under GODL-India, and the reader is told so.
 *
 * ── WHAT IT WILL AND WILL NOT FILL ──────────────────────────────────────────
 *
 * It fills **state**, and it offers the **district** as information.
 *
 * ⚠ A DISTRICT IS NOT A CITY, and conflating them is the obvious mistake this
 * component refuses to make. `395002` is in SURAT district; the city might be
 * Surat, but `400706` is in THANE district and the city is Navi Mumbai — the
 * live `Navrang Polymers` row says exactly that. Writing a district into a
 * `city` box would put a confident wrong answer into a customer's record, and
 * the person filling the form is the one who knows. So the district is shown,
 * never written.
 *
 * ⚠ AND A PIN IS NOT ONE PLACE. Measured over all 20,144 rows: 1,229 PINs span
 * more than one district and **51 span more than one STATE**. When the
 * directory returns more than one row nothing is filled at all and every
 * candidate is listed, because picking the first would answer a two-answer
 * question with one — correctly, for ever, with no way for the reader to know
 * the other existed.
 *
 * ── AND IT NEVER OVERWRITES ─────────────────────────────────────────────────
 *
 * The fill is a BUTTON, not an effect. Typing a pincode looks the answer up and
 * says what it found; nothing enters the form until somebody presses. A form
 * that quietly rewrote a state while the operator was typing would be the same
 * failure as a suggestion that blanks a field — worse, because it looks right.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, body } from '../../lib/api';

/** `^[1-9][0-9]{5}$` after a trim — the product's ONE definition of a PIN,
 *  matching `services/territory_routing.normalise_pin` exactly. A component
 *  laxer than the server would look up a value the server refuses. */
const PIN_RE = /^[1-9][0-9]{5}$/;

export function isPin(raw) {
  return PIN_RE.test(String(raw ?? '').trim());
}

/**
 * @param {string} pincode   the value of the form's pincode box
 * @param {string} state     what the form currently holds, so we can say
 *                           "already set" rather than offering to set it again
 * @param {(patch: object) => void} onFill  called ONLY from the button
 */
export default function PincodeAutofill({ pincode, state = '', onFill }) {
  const [found, setFound] = useState(null);
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);
  // Monotonic, so a slow answer to an old pincode can never overwrite a fast
  // answer to a newer one — the same discipline `AddressSuggest` uses.
  const seq = useRef(0);

  const pin = String(pincode ?? '').trim();
  const valid = isPin(pin);

  useEffect(() => {
    if (!valid) { setFound(null); setErr(false); return undefined; }
    const mine = ++seq.current;
    setBusy(true);
    setErr(false);
    let live = true;
    api.get(`/v1/pincodes/${pin}`)
      .then((r) => {
        if (!live || mine !== seq.current) return;
        const d = body(r);
        setFound(Array.isArray(d.directory) ? d.directory : []);
      })
      .catch(() => { if (live && mine === seq.current) setErr(true); })
      .finally(() => { if (live && mine === seq.current) setBusy(false); });
    return () => { live = false; };
  }, [pin, valid]);

  const fill = useCallback(() => {
    if (!found || found.length !== 1) return;
    // STATE only. The district is shown and never written — see the header.
    onFill?.({ state: found[0].state });
  }, [found, onFill]);

  // Nothing to say. Renders nothing rather than an empty region: a value that
  // is not a PIN is not corrected and not complained about, which is §8.0's
  // rule in the other direction (`INC UK` really stores 'NW1 245').
  if (!valid) return null;
  if (busy) return <span className="k-pinfill k-pinfill--soft">Looking up {pin}…</span>;

  if (err) {
    return (
      <span className="k-pinfill k-pinfill--soft" role="status">
        The pincode directory could not be read just now. This does not stop you
        typing the address.
      </span>
    );
  }

  if (found && found.length === 0) {
    /* A real and ordinary answer: 531 PINs that HAVE a published boundary are
       absent from this directory release. It must not read as "no such
       pincode", and it must not block anything — GSTIN/PAN/TAN are
       non-mandatory by owner rule and a pincode is the same. */
    return (
      <span className="k-pinfill k-pinfill--soft" role="status">
        This release does not list a district for {pin}. That is not a problem —
        the address saves either way.
      </span>
    );
  }

  if (found && found.length > 1) {
    /* 1,229 PINs span two or more districts and 51 span two or more STATES.
       `110020` is genuinely both SOUTH DELHI and SOUTH EAST DELHI. Nothing is
       filled, and both are named. */
    return (
      <span className="k-pinfill" role="status">
        {pin} covers{' '}
        {found.map(d => `${d.district}, ${d.state}`).join(' · ')} — it spans{' '}
        {found.length} districts, so nothing has been filled in for you.
      </span>
    );
  }

  if (!found) return null;

  const only = found[0];
  const already = String(state || '').trim().toLowerCase()
    === String(only.state || '').trim().toLowerCase();

  return (
    <span className="k-pinfill" role="status">
      {pin} is in <strong>{only.district}</strong>, {only.state}.{' '}
      {already ? (
        <span className="k-pinfill--soft">State already set.</span>
      ) : (
        <button type="button" className="k-btn k-btn--ghost k-btn--sm"
          onClick={fill}>
          Use {only.state}
        </button>
      )}
      {/* GODL-India, for the directory. The same credit rule the boundary and
          basemap responses carry: the data and what is owed for it travel
          together. */}
      <span className="k-pinfill--soft"> Government of India directory.</span>
    </span>
  );
}
