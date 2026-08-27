/*
 * NOT APPLICATION CODE. The two renders that shipped past
 * `check-rendered-ids.mjs`, copied verbatim from the commits that introduced
 * them, so the ratchet can be proved to fail rather than asserted to work.
 *
 *   · `graha/ApprovalsTab.jsx` @ fb280dac, line 160
 *   · `vikray/TargetsTab.jsx`  @ dc25af15, line 318
 *   · `graha/ContactsTab.jsx`  @ 1d8cc7b9, line 405   (added 2026-08-27)
 *   · `graha/ReportsTab.jsx`   @ 1d8cc7b9, line 317   (added 2026-08-27)
 *
 * The last two are BOTH `assigned_to`, and they are the second time the same
 * class of miss has shipped: the vocabulary knew `_id`/`_by`/`uid`/`uuid` and
 * this product's assignee column is a `_to`. `requested_by` taught that lesson
 * once already — see note 1 in `check-rendered-ids.mjs`.
 *
 * It lives under `src/__tests__/` because `walk()` skips that directory by
 * name — a fixture full of violations sitting anywhere else in `src` would
 * turn the real gate permanently red. It is not `*.test.jsx`, so vitest does
 * not collect it either.
 */
export function Offenders({ r, t, c }) {
  return (
    <table>
      <tbody>
        <tr>
          <td style={{ padding: '10px', fontSize: 11, fontFamily: 'var(--mono)' }}>{r.requested_by?.slice(0, 12) || '—'}</td>
          <td>{t.salesperson_name || <span className="vk-tg__unknown">{t.salesperson_id}</span>}</td>
        </tr>
        {/* The other two ways to launder an id into text, both of which the
            check used to wave through: a wrapper whose NAME is not id-shaped,
            and a template literal that the string-literal escape hatch read as
            a constant. */}
        <tr>
          <td>{String(r.created_by)}</td>
          <td>{`${r.updated_by}`}</td>
        </tr>
        {/* Both live on 2026-08-27, both `assigned_to`. The second is the
            SAME shape as `requested_by` above and was missed only because the
            column name is a `_to`. The first adds a ternary, whose `?` the
            check reads as control flow, and hides the truncation inside a
            template literal — three coats of paint over one user id. */}
        <tr>
          <td>{c.assigned_to ? `${c.assigned_to.substring(0, 8)}…` : '—'}</td>
          <td>{r.assigned_to?.slice(0, 12) || '—'}</td>
        </tr>
      </tbody>
    </table>
  );
}
