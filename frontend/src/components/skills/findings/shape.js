/**
 * What a `check` skill hands back, turned into things a page can draw.
 *
 * ── The problem this solves ──────────────────────────────────────────────────
 *
 * A data step's handler returns a plain dict. There is no schema for it and
 * there never was one: sixty-one handlers were written by several authors
 * across several sessions, and what they agree on is a HABIT, not a contract —
 * a few lists of rows, a `counts` object, a period, and a sentence saying what
 * the numbers cannot see. Waiting for a schema would mean rendering nothing
 * until every handler is rewritten, which is what has been happening.
 *
 * So this classifies by SHAPE rather than by name. Anything list-of-objects is
 * a table, anything object-of-numbers is a count strip, a long string is a
 * paragraph, a short one is a fact. A handler that grows a new key renders on
 * the day it ships without anybody touching this file.
 *
 * ── EXCEPT the caveat, which IS named ────────────────────────────────────────
 *
 * `backend/tests/test_every_skill_states_its_limits.py` pins five key names and
 * exists to stop a sixth appearing. That test's whole premise is that these
 * outputs reach chartered accountants — often through a language model that
 * paraphrases them — and that a caveat the reader does not see is the failure
 * mode. So the five are matched by name, lifted out of the body, and rendered
 * first and whole. They are the one part of a finding that is never a table
 * cell, never clipped and never behind a disclosure.
 *
 * ── And an absent caveat is rendered too ─────────────────────────────────────
 *
 * Twenty-six handlers state no limits at all — the pre-contract registry, named
 * in that test's `WITHOUT_A_CAVEAT` debt list. `caveatsOf` returns an empty
 * array for them rather than nothing, so the page can say "this skill states no
 * limits" instead of drawing a silence that reads like an all-clear.
 */

/**
 * The five names, IN THE ORDER A READER NEEDS THEM.
 *
 * This is deliberately NOT the order the backend test declares them in. That
 * list is a vocabulary — an alphabet of what is legal. This is a reading order:
 * what the thing is, then what it is emphatically not, then what it could not
 * see, then the specific reservations. `what_this_is_not` sits second because
 * `brief_advance_tax_reserve` makes it the FIRST key of its output for exactly
 * that reason — "this is not tax advice" has to arrive before the numbers do.
 */
export const CAVEAT_KEYS = [
  'what_this_is',
  'what_this_is_not',
  'limitations',
  'caveats',
  'caveat',
];

/**
 * The heading each key gets.
 *
 * They are NOT all "Caveat". The five words mean different things and the
 * handlers chose between them deliberately — `what_this_is` scopes the output,
 * `limitations` says what the query could not reach, `caveats` carries specific
 * conditional reservations. Flattening them to one label would throw away the
 * only distinction the vocabulary has.
 */
export const CAVEAT_LABELS = {
  what_this_is: 'What this is',
  what_this_is_not: 'What this is NOT',
  limitations: 'What this could not see',
  caveats: 'Caveats',
  caveat: 'Caveat',
};

/** `what_this_is` is a scope statement; the other four are warnings. */
export const CAVEAT_TONE = {
  what_this_is: 'scope',
  what_this_is_not: 'warn',
  limitations: 'warn',
  caveats: 'warn',
  caveat: 'warn',
};

/**
 * Columns and facts whose value is one of OUR ids.
 *
 * The owner's rule is absolute: no user, member, org or record id is ever
 * drawn. A handler is free to return `contact_id` in its rows — several do, and
 * the dispatcher needs them — but a UUID in a column a chartered accountant
 * reads is noise at best. `check-rendered-ids.mjs` cannot catch this one: the
 * columns here are computed at runtime from a dict nobody wrote in JSX, so the
 * positional check has nothing to look at. The rule is enforced here instead.
 *
 * Narrow on purpose. `gstin`, `pan`, `udin`, `invoice_number` and `uan` are
 * identifiers too and every one of them is the reader's own handle on a record
 * at a portal we do not own — the same reason `check-rendered-ids` keeps an
 * ALLOW list for a UPI address and an Apify slug.
 */
const OUR_ID = /(^|_)(id|ids|uid|uuid|guid)$/i;

/** Keys whose numbers are not quantities and must not be grouped. */
const NOT_A_QUANTITY = /(year|period|month|day|days|pin|code|gstin|pan|tan|hsn|sac|percent|pct|rate)/i;

const isScalar = v => v === null || v === undefined
  || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/** `find_overdue_invoices` → `Find overdue invoices`. Sentence case, not Title. */
export function label(key) {
  const s = String(key ?? '').replace(/_/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

/**
 * One value as text.
 *
 * `null` becomes an em dash rather than the string "null", and `false` becomes
 * "no" rather than disappearing — a false in a compliance row is a finding, and
 * rendering it as blank is how "PF not enabled" becomes "nothing to report".
 */
export function cellText(value, key = '') {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value);
    // Grouping separators help on money and counts and hurt on a year: 2026
    // rendered as "2,026" reads as a quantity. `en-IN` because every figure
    // here is one a firm in India will reconcile against something else.
    if (NOT_A_QUANTITY.test(key) || Math.abs(value) < 1000) return String(value);
    return value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }
  if (Array.isArray(value)) {
    return value.length ? value.map(v => cellText(v)).join(', ') : '—';
  }
  if (isPlainObject(value)) {
    const parts = Object.entries(value)
      .filter(([k]) => !OUR_ID.test(k))
      .map(([k, v]) => `${label(k)}: ${cellText(v, k)}`);
    return parts.length ? parts.join(' · ') : '—';
  }
  return String(value);
}

/** A string long enough that it is prose and has to be a paragraph, not a chip. */
const isProse = s => s.length > 90 || s.includes('\n');

/**
 * Every caveat the finding states, in reading order, flattened to lines.
 *
 * A value may be a string (`caveat`, `what_this_is`) or an array of strings
 * (`limitations`, `caveats`) — both shapes are live in the handlers today, and
 * `gst_cliffs` uses both in one return. An EMPTY array is dropped: the handler
 * built the key and then found nothing to put in it, which is not a caveat.
 *
 * Returns `[]` when the finding states nothing, which the renderer says out
 * loud. See the header note on the debt list.
 */
export function caveatsOf(data) {
  if (!isPlainObject(data)) return [];
  const out = [];
  for (const key of CAVEAT_KEYS) {
    if (!(key in data)) continue;
    const raw = data[key];
    const lines = (Array.isArray(raw) ? raw : [raw])
      .filter(v => typeof v === 'string' && v.trim())
      .map(v => v.trim());
    if (lines.length) out.push({ key, label: CAVEAT_LABELS[key], tone: CAVEAT_TONE[key], lines });
  }
  return out;
}

/**
 * The columns of a list-of-objects, in first-seen order across ALL rows.
 *
 * Not from `rows[0]`: handlers build rows conditionally, so a defect only the
 * fourth invoice has would vanish as a column. Ids are dropped here rather than
 * at render time so the count of columns is honest everywhere downstream.
 */
export function columnsOf(rows) {
  const seen = [];
  for (const row of rows) {
    if (!isPlainObject(row)) continue;
    for (const k of Object.keys(row)) {
      if (OUR_ID.test(k)) continue;
      if (!seen.includes(k)) seen.push(k);
    }
  }
  return seen;
}

/**
 * Split one handler's dict into the blocks a page draws.
 *
 * Order of the returned arrays is the order the keys appeared in the dict,
 * which is the order the handler's author wrote them — several handlers put
 * `what_this_is` first on purpose, and the rest are sequenced so the headline
 * counts precede the rows they count. Re-sorting would throw that away.
 */
export function splitFinding(data) {
  const empty = {
    error: '', caveats: [], counts: [], tables: [], lists: [], notes: [], facts: [], emptyLists: [],
  };
  if (!isPlainObject(data)) {
    // A handler that returned a bare list or a string is not the shape anything
    // here expects, but it is still the answer. Carried through as one block
    // rather than dropped.
    if (Array.isArray(data) && data.length && data.every(isPlainObject)) {
      return { ...empty, tables: [{ key: 'rows', label: 'Rows', rows: data, columns: columnsOf(data) }] };
    }
    if (data !== null && data !== undefined && data !== '') {
      return { ...empty, notes: [{ key: 'result', label: 'Result', text: cellText(data) }] };
    }
    return empty;
  }

  const out = { ...empty, caveats: caveatsOf(data) };

  for (const [key, value] of Object.entries(data)) {
    if (CAVEAT_KEYS.includes(key)) continue;          // lifted out above
    if (OUR_ID.test(key)) continue;                   // names, not ids

    // `error` is NOT a caveat and the backend test names that distinction
    // explicitly: it means the step could not run, which is a different
    // statement from "here is what I cannot see".
    if (key === 'error' && typeof value === 'string' && value.trim()) {
      out.error = value.trim();
      continue;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        // AN EMPTY LIST IS A RESULT. `"invoices": []` out of the GSTR-1
        // readiness check means every invoice in the period is filable — the
        // single most valuable thing that skill can say. Dropping the key
        // because it is falsy renders a clean month as a blank page.
        out.emptyLists.push({ key, label: label(key) });
      } else if (value.every(isPlainObject)) {
        out.tables.push({ key, label: label(key), rows: value, columns: columnsOf(value) });
      } else {
        out.lists.push({ key, label: label(key), items: value.map(v => cellText(v, key)) });
      }
      continue;
    }

    if (isPlainObject(value)) {
      const entries = Object.entries(value).filter(([k]) => !OUR_ID.test(k));
      if (entries.length && entries.every(([, v]) => isScalar(v))) {
        out.counts.push({
          key,
          label: label(key),
          entries: entries.map(([k, v]) => ({ key: k, label: label(k), text: cellText(v, k) })),
        });
      } else if (entries.length) {
        // Nested one level deeper than a count strip can draw. Rendered as
        // text rather than skipped — a dropped key is a lie by omission.
        out.notes.push({ key, label: label(key), text: cellText(value, key) });
      }
      continue;
    }

    if (typeof value === 'string') {
      const text = value.trim();
      if (!text) continue;
      if (isProse(text)) out.notes.push({ key, label: label(key), text });
      else out.facts.push({ key, label: label(key), text });
      continue;
    }

    if (isScalar(value)) {
      out.facts.push({ key, label: label(key), text: cellText(value, key) });
    }
  }

  return out;
}

/**
 * Does this run have anything to draw?
 *
 * `outputs` is absent entirely on a deploy that predates the run response
 * carrying it. That is NOT the same as a run that found nothing, and the two
 * must not render the same — see `Findings.jsx`.
 */
export function dataOutputs(outputs) {
  if (!Array.isArray(outputs)) return [];
  return outputs.filter(o => o && o.skill_function);
}
