/**
 * DuePane — the statutory obligations that fall on this page.
 *
 * ── WHERE THE DATES COME FROM, AND WHERE THEY DO NOT ────────────────────────
 *
 * `staging.statute_calendar` (migrations 158, 170, 172 — 45 rows) is the only
 * source of dated law in the product. For months nothing served it: it was
 * read by `backend/services/statute.py` and, through it, by nine skill
 * handlers, and by no router at all — so this pane could do nothing honest but
 * say so, and it did.
 *
 * `backend/routers/statute.py` serves it now. `/v1/statute/due` resolves which
 * VERSION of each obligation is in force on a date, projects its next
 * occurrence from that row's own `due_day`, `due_month` and
 * `due_month_offset`, and echoes the date it measured from.
 *
 * ── WHAT THIS FILE STILL WILL NOT DO ────────────────────────────────────────
 *
 * It computes no date. GSTR-3B on day 20, PF on day 15 — those look like
 * constants and they are not: every row carries `effective_from` and
 * `effective_to`, and proposal 72 states the failure exactly — "the statute
 * table is dated law and a date read without its window is how you print last
 * year's rule". The TDS forms were renumbered on 1 April 2026; a constant
 * shipped the week before would still be printing the old ones. So the
 * arithmetic is on the server, beside the resolver that reads the window, and
 * this file formats what it is handed.
 *
 * ── AN OBLIGATION WITH NO DATE IS STILL AN OBLIGATION ───────────────────────
 *
 * Six of the income-tax rows in force today carry `due_day = NULL`, and
 * migration 158 is explicit about what that means: "THE SCHEDULE IS NOT A
 * DAY-OF-MONTH RULE. Read `notes`; do not guess." The quarterly TDS statements
 * fall on 31 July, 31 October, 31 January — and 31 MAY for the fourth quarter,
 * so any uniform rule is wrong four times a year. Every 2025-Act row was
 * seeded undated for the same reason: the form renumbering was verified, that
 * the old dates carried across was not.
 *
 * Those rows are SHOWN, without a date and with the reason. Dropping them
 * would be this panel deciding a firm has one fewer duty than it has; dating
 * them would be worse. A wrong statutory date beats a missing one by no margin
 * at all, in the wrong direction.
 */
import React from 'react';
import DockRow, { DockEmpty } from './DockRow';

/** `2026-09-15` → `15 Sep 2026`. Absolute, never "in 26 days" alone. */
function onDay(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * The countdown, and it is allowed to be negative.
 *
 * A date that has passed says so. The projection returns the next occurrence
 * on or after `as_of`, so a past date only appears where the calendar itself
 * says the deadline is behind us — and rewriting that as `0d` would be the
 * panel smoothing over the one case a firm most needs to see.
 */
function away(days) {
  if (days == null) return '';
  if (days === 0) return 'today';
  if (days < 0) return `${Math.abs(days)}d ago`;
  return `${days}d`;
}

/**
 * `income_tax` → `INCOME TAX`. The column's spelling is the wire's spelling and
 * the filter matches on it exactly, but an underscore on screen is a database
 * artefact and the other three values have none.
 */
function authorityLabel(a) {
  return String(a).replace(/_/g, ' ').toUpperCase();
}

export default function DuePane({ page, due, asOf, unavailable, listId, cursor, onCursor }) {
  // Unreachable, which is NOT the same sentence as "nothing is due" and must
  // never be shown as one. A firm told it has no filing when the calendar
  // simply did not answer has been told something about its own compliance
  // that nobody checked.
  if (unavailable) {
    return <DockEmpty
      title="The statute calendar did not answer."
      body="This tab reads dated law from the server and computes no date of
            its own, so when that read fails there is nothing here it is
            willing to say. Nothing is implied about what you owe."
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
    <>
      <div className="k-dock__list" role="listbox" id={listId}
        aria-label={`Due dates for ${page.label}`}>
        {due.map((d, i) => (
          <DockRow
            key={d.key}
            id={`${listId}-${i}`}
            // Two tones, because two different things are being said. A dated
            // obligation is a deadline; an undated one is a duty whose
            // schedule this table does not record, and giving them the same
            // mark would read as though the second had a date off screen.
            tone={d.due_on ? 'due' : 'undated'}
            name={d.title}
            // The authority, the cadence, and the date itself — never a bare
            // countdown.
            meta={d.due_on
              ? `${authorityLabel(d.authority)} · ${d.cadence} · due ${onDay(d.due_on)}`
              : `${authorityLabel(d.authority)} · ${d.cadence} · no date recorded`}
            // `reason` also withholds the countdown chip, which is correct:
            // there is no number to count.
            reason={d.due_on ? undefined : d.basis}
            go={away(d.days_away)}
            selected={cursor === i}
            onSelect={() => onCursor(i)}
          />
        ))}
      </div>
      {/* The anchor. A countdown whose reference date is invisible is a
          countdown nobody can check, and every row above was measured from
          this one day. */}
      {asOf && (
        <p className="k-dock__asof">
          The law as it stood on {onDay(asOf)}.
        </p>
      )}
    </>
  );
}
