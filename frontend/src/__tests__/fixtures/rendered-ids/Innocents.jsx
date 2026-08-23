/*
 * NOT APPLICATION CODE. Every legitimate use of an id that the widened rule
 * must stay silent about. A ratchet that fires on any of these is switched off
 * within a week, which is worse than no ratchet — so each one is pinned.
 *
 * The `_by` cases at the bottom are the point of the file: `created_by_name`
 * and `updated_by_name` hold NAMES and are drawn on nearly every table in the
 * product, and `_by\b` must not reach inside them. `_` is a word character, so
 * the word boundary does that on its own — but only as long as nobody
 * "improves" the regex into `_by` unanchored.
 */
export function Innocents({ row, rows, names, onOpen }) {
  return (
    <div data-org-id={row.org_id} title={row.user_id} aria-describedby={row.user_id}>
      {/* keys, hrefs and route targets — attributes, never drawn */}
      <a href={`/tasks/${row.task_id}`}>{row.title}</a>
      <ul>
        {rows.map((r) => (
          <li key={r.member_id} onClick={() => onOpen(r.user_id)}>
            {/* a lookup THROUGH an id is a name, and is the fix, not the bug */}
            {names[r.user_id]}
            {/* a call whose callee is not id-shaped is judged by its name */}
            {labelFor(r.user_id)}
          </li>
        ))}
      </ul>
      {/* comparisons and predicates: the id is being USED */}
      {row.user_id === row.owner_id && <span>you</span>}
      {rows.filter((r) => r.user_id).length}
      {/* a child component receives the id as a prop; what it DRAWS is its own
          file's problem, and this one cannot see it */}
      <Avatar userId={row.user_id} name={row.user_name} />
      {/* the double brace of a style object is not a child */}
      <span style={{ padding: 10, fontFamily: 'var(--mono)' }}>{row.title}</span>

      {/* ── the `_by` trap ─────────────────────────────────────────────── */}
      <span>{row.created_by_name}</span>
      <span>{row.updated_by_name || '—'}</span>
      <span>{row.approved_by_name}</span>
      {/* table state, not an actor — the reason `By\b` was not added */}
      <span>{row.sortBy}</span>
    </div>
  );
}
