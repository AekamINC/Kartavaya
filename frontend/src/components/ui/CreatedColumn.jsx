/**
 * CreatedColumn — the "Created" header and cell, written once.
 *
 * WHY THIS EXISTS
 * ---------------
 * The owner asked for a created date on EVERY table in the product, sortable.
 * There are 59 files rendering a table and no data-driven `<DataTable>` to
 * change once: `Table.jsx` is a set of primitives, so each table hand-writes
 * its own `<HeadCell>` and `<Cell>` list. Without a shared piece, "created
 * date" would be 59 slightly different date formats, 59 slightly different
 * sort keys, and 59 places to fix when one of them is wrong.
 *
 * So the column is one import and two tags:
 *
 *     <CreatedHead sort={sort} onSort={setSort} />       in the header row
 *     <CreatedCell value={row.created_at} />             in the body row
 *
 * FORMAT, and why it is not `toLocaleDateString()`
 * -----------------------------------------------
 * `formatDate` from `lib/dates` is the product's one date renderer. A table of
 * records is scanned, not read, so the cell shows the SHORT form and puts the
 * full timestamp in `title=` for the one row somebody stops on. The value is
 * also emitted as a `<time datetime>` so it is machine-readable and so a
 * screen reader gets the unambiguous form rather than "31 Aug".
 *
 * MISSING VALUES ARE NOT BLANK
 * ----------------------------
 * A record whose `created_at` the API does not return renders an em dash with
 * a title saying so, never an empty cell. An empty cell in a date column reads
 * as "created at no time", and the difference between "we don't show it" and
 * "it isn't there" is exactly what sent the last audit down a wrong path.
 */
import React from 'react';
import { Cell, HeadCell } from './Table';
// `lib/timeFormat` is the product's date renderer — "16 Jun 2026", en-IN, and
// it already returns an em dash for a missing value. `lib/dates` is calendar
// arithmetic and has no formatter; `documents/fileMeta` has a second
// `formatDate` scoped to file cards. This is the one for record tables.
import { formatDate } from '../../lib/timeFormat';

/** The sort keys every table uses, so a saved sort means the same everywhere. */
export const CREATED_KEY = 'created_at';
export const UPDATED_KEY = 'updated_at';

/**
 * WHO, never an id.
 *
 * `created_by` and `updated_by` store `users.user_id` — TEXT like
 * `user_f1a0a472b98f`. That value must never reach the screen: it is a member
 * id, and the rule is that a user, member or org id is never rendered. So the
 * API is expected to send a resolved NAME beside it (`created_by_name`), and
 * this cell renders the name or an honest absence — never the id it was
 * resolved from, and never the person's EMAIL as a stand-in for a name, which
 * is how a table quietly becomes a directory of client email addresses.
 *
 * `unknown` is the deliberate wording for "there is an id here but no user row
 * behind it any more" — a deleted account. It is different from "nobody did
 * this", which is what an absent id means, and the two must not read alike.
 */
export function ByCell({ name, hasActor = undefined, className = '' }) {
  const text = typeof name === 'string' ? name.trim() : '';
  if (text) {
    return <Cell className={`tbl__by ${className}`.trim()}>{text}</Cell>;
  }
  const gone = hasActor === true;
  return (
    <Cell className={`tbl__by ${className}`.trim()}>
      <span
        className="tbl__created-none"
        title={gone
          ? 'The account that did this no longer exists'
          : 'No person is recorded against this record'}
      >
        {gone ? 'unknown' : '—'}
      </span>
    </Cell>
  );
}

export function ByHead({ sort, onSort, sortKey, label, className = '' }) {
  return (
    <HeadCell
      sortKey={sortKey}
      sort={sort}
      onSort={onSort}
      className={`tbl__by ${className}`.trim()}
    >
      {label}
    </HeadCell>
  );
}

export function CreatedHead({ sort, onSort, className = '', label = 'Created' }) {
  return (
    <HeadCell
      sortKey={CREATED_KEY}
      sort={sort}
      onSort={onSort}
      className={`tbl__created ${className}`.trim()}
    >
      {label}
    </HeadCell>
  );
}

export function CreatedCell({ value, className = '' }) {
  if (!value) {
    return (
      <Cell className={`tbl__created ${className}`.trim()}>
        <span className="tbl__created-none" title="No creation date on this record">—</span>
      </Cell>
    );
  }
  const d = new Date(value);
  const ok = !Number.isNaN(d.getTime());
  return (
    <Cell className={`tbl__created ${className}`.trim()}>
      {ok ? (
        <time dateTime={d.toISOString()} title={d.toLocaleString()}>
          {formatDate(value)}
        </time>
      ) : (
        <span className="tbl__created-none" title={`Unreadable date: ${value}`}>—</span>
      )}
    </Cell>
  );
}

export function UpdatedHead({ sort, onSort, className = '', label = 'Updated' }) {
  return (
    <HeadCell
      sortKey={UPDATED_KEY}
      sort={sort}
      onSort={onSort}
      className={`tbl__created ${className}`.trim()}
    >
      {label}
    </HeadCell>
  );
}

/** When it last changed. Same rendering rules as CreatedCell. */
export function UpdatedCell({ value, className = '' }) {
  return <CreatedCell value={value} className={className} />;
}

/**
 * Sort rows by creation, newest first by default.
 *
 * Rows with NO created_at sort last in both directions rather than being
 * treated as epoch zero. A record whose date the API omitted is not the oldest
 * record; putting it at the top of a "newest first" list would be a lie the
 * user cannot see through.
 */
export function byCreated(rows, dir = 'descending', key = CREATED_KEY) {
  const t = (r) => {
    const v = r?.[key];
    if (!v) return null;
    const n = new Date(v).getTime();
    return Number.isNaN(n) ? null : n;
  };
  return [...(rows || [])].sort((a, b) => {
    const x = t(a);
    const y = t(b);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return dir === 'ascending' ? x - y : y - x;
  });
}
