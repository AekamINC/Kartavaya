/*
 * NOT APPLICATION CODE. The two renders that shipped past
 * `check-rendered-ids.mjs`, copied verbatim from the commits that introduced
 * them, so the ratchet can be proved to fail rather than asserted to work.
 *
 *   · `graha/ApprovalsTab.jsx` @ fb280dac, line 160
 *   · `vikray/TargetsTab.jsx`  @ dc25af15, line 318
 *
 * It lives under `src/__tests__/` because `walk()` skips that directory by
 * name — a fixture full of violations sitting anywhere else in `src` would
 * turn the real gate permanently red. It is not `*.test.jsx`, so vitest does
 * not collect it either.
 */
export function Offenders({ r, t }) {
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
      </tbody>
    </table>
  );
}
