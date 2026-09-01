/**
 * IfscHint — what the code they just typed actually is.
 *
 * ── WHY THIS EARNS A COMPONENT ─────────────────────────────────────────────
 * `services/statutory_ids.py` already refuses a malformed IFSC and says why:
 * "A salary credited on a wrong IFSC is routed to a different branch." But the
 * shape check only proves eleven characters in the right pattern. `HDFC0999999`
 * passes it and names nothing, and the product asked a payroll clerk to type a
 * bank name and a branch by hand NEXT TO a code that already contains both,
 * with no way to tell them the two disagreed.
 *
 * This draws the branch the RBI directory says the code is. The clerk reads one
 * line and knows whether they typed their own bank or somebody else's.
 *
 * ── THE FOUR STATES ARE FOUR STATES ────────────────────────────────────────
 * ⚠ `unavailable` IS NOT A VALIDATION FAILURE and must never be drawn as one.
 * It means the reference data could not be read — their IFSC may be perfectly
 * correct. Telling a clerk their bank details are wrong, during an outage, at
 * the moment they are trying to pay people, is worse than saying nothing. So
 * that state renders a neutral note, not a warning.
 *
 * `malformed` renders NOTHING. Somebody halfway through typing eleven
 * characters is not making a mistake yet, and a red line that appears on
 * keystroke three and vanishes on eleven is noise the whole way.
 *
 * ── AND IT NEVER BLOCKS ────────────────────────────────────────────────────
 * Nothing here gates a save. It is the GSTIN/PAN rule applied to a bank code:
 * the product tells you what it knows and lets you proceed. An IFSC absent from
 * a directory published last month is a real thing — new branches exist — and
 * refusing the save would strand a real employee.
 */
import React, { useEffect, useState } from 'react';
import { api, body } from '../../lib/api';

/** Eleven characters in the RBI pattern. Below this there is nothing to ask. */
const SHAPE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export const normaliseIfsc = (raw) =>
  String(raw || '').replace(/[\s-]+/g, '').toUpperCase();

export default function IfscHint({ value }) {
  const [state, setState] = useState(null);

  useEffect(() => {
    const code = normaliseIfsc(value);
    if (!SHAPE.test(code)) { setState(null); return undefined; }

    let dead = false;
    // Debounced: a clerk pasting and correcting a code should not spend a
    // request per keystroke on a lookup that is only interesting once.
    const t = setTimeout(() => {
      api.get(`/v1/reference/ifsc/${code}`)
        .then((r) => { if (!dead) setState(body(r)); })
        // A failed request is indistinguishable from the directory being
        // unreadable, and both must read as "cannot say" rather than "wrong".
        .catch(() => { if (!dead) setState({ status: 'unavailable' }); });
    }, 350);

    return () => { dead = true; clearTimeout(t); };
  }, [value]);

  if (!state || state.status === 'malformed') return null;

  if (state.status === 'found') {
    const b = state.branch || {};
    return (
      <p className="note note--info" role="status">
        <strong>{b.bank}</strong>
        {b.branch ? ` — ${b.branch}` : ''}
        {b.centre ? `, ${b.centre}` : ''}
        {b.state ? `, ${b.state}` : ''}
      </p>
    );
  }

  if (state.status === 'unknown') {
    return (
      <p className="note note--warn" role="status">
        No branch with this IFSC is in the RBI directory. Check it against the
        bank&rsquo;s own letter — you can still save it.
      </p>
    );
  }

  // unavailable. Deliberately neutral: this says nothing about their code.
  return (
    <p className="note note--info" role="status">
      The bank directory could not be reached, so this code has not been
      checked.
    </p>
  );
}
