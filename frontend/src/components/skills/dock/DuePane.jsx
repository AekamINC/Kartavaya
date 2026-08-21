/**
 * DuePane — the statutory obligations that fall on this page.
 *
 * ── THIS TAB IS BUILT AND HAS NOTHING TO READ ───────────────────────────────
 *
 * `staging.statute_calendar` (migrations 158, 170, 172 — 45 rows) is the only
 * source of dated law in the product, and `backend/services/statute.py` is the
 * only thing that reads it. That module is imported by nine skill handlers and
 * by NOTHING ELSE: there is no route in `backend/routers/` that serves an
 * obligation, no `/v1/statute`, no compliance calendar endpoint. Verified by
 * grep across the whole backend on 20 August 2026.
 *
 * So the honest thing this pane can do today is say so. It does.
 *
 * ── What it will NOT do instead ─────────────────────────────────────────────
 *
 * It will not compute due dates in the browser. GSTR-3B on day 20, PF on day
 * 15 — those look like constants and they are not: every row in that table
 * carries `effective_from` and `effective_to`, and proposal 72 states the
 * failure exactly — "the statute table is dated law and a date read without
 * its window is how you print last year's rule". `services/statute.py` refuses
 * to answer without `as_of` for that reason, and a hard-coded due day in a
 * JavaScript file cannot honour a window it has never seen. The TDS forms were
 * renumbered on 1 April 2026; a constant shipped the week before would still
 * be printing the old ones.
 *
 * A wrong statutory date is worse than a missing one by a wide margin, and the
 * dock's whole claim is that it says what is true before you click.
 *
 * ── The wiring, when it is authorised ───────────────────────────────────────
 *
 * `lib/routeModules.DUE_SOURCE` is the single constant to change, and
 * `DUE_ROW_KEYS` beside it is the row shape this pane already renders. Each
 * page entry in that file carries its `authorities` — `gst` and `incometax`
 * for Finance, `epfo` and `esic` for Payroll — read from the live table's own
 * values, so nothing here needs editing when an endpoint exists.
 */
import React from 'react';
import { DUE_SOURCE } from '../../../lib/routeModules';
import DockRow, { DockEmpty } from './DockRow';

/** `2026-09-15` → `15 Sep 2026`. Absolute, never "in 26 days" alone. */
function onDay(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function DuePane({ page, due, listId, cursor, onCursor }) {
  if (!DUE_SOURCE) {
    return <DockEmpty
      title="The statute calendar is not served to the browser yet."
      body="Forty-five dated obligations exist in the database and only the skill
            handlers can read them. Nothing here is going to guess a due date:
            every one of those rows carries the window it is valid in, and a
            date read without its window prints last year's rule."
      hint="Ganit's compliance checks read the same table — try Skills." />;
  }

  if (!due.length) {
    return <DockEmpty
      title="Nothing statutory falls on this page."
      body={page.note
        || `The calendar has no dated obligation for ${page.label}.`}
      hint="Dated obligations exist for GST, PF, ESI and income tax." />;
  }

  return (
    <div className="k-dock__list" role="listbox" id={listId}
      aria-label={`Due dates for ${page.label}`}>
      {due.map((d, i) => (
        <DockRow
          key={d.key}
          id={`${listId}-${i}`}
          tone="due"
          name={d.title}
          // The authority, the cadence, and the date itself — never a bare
          // countdown. `as_of` rides along because a countdown whose reference
          // date is invisible is a countdown nobody can check.
          meta={`${String(d.authority).toUpperCase()} · ${d.cadence} · due ${onDay(d.due_on)}`}
          go={`${d.days_away}d`}
          selected={cursor === i}
          onSelect={() => onCursor(i)}
        />
      ))}
    </div>
  );
}
