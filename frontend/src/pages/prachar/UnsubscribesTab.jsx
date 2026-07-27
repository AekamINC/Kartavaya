// Unsubscribes — the list every send is filtered against.
//
// The smallest tab, and the one where being wrong is most expensive: a person
// on this list who receives a marketing email is a compliance failure, and a
// person removed from it by a mis-click starts receiving mail they asked to
// stop. So:
//
//  · `setList(r.data)` on `{"data": [...]}` — same `.map` crash as four other
//    tabs. Fixed by `rows()`.
//  · Removing an address was a one-click "Remove" with no confirmation. It now
//    names the address and says what removing it means.
//  · `add()` did no validation, so a typo went to the server as a valid
//    suppression and silently blocked nothing.
//  · There was no search. A suppression list is the one list here that grows
//    without bound and is only ever consulted to answer "is this address on it".
import React, { useState, useMemo } from 'react';
import { DataTable, Td } from '../../components/editorial';
import { useToast } from '../../components/ui/toast';
import { api, rows, Panel, Bar, useResource, useMutate, humanise, plural, fmtDate } from './_shared';

// Deliberately permissive — it rejects the typo classes that matter (no @, no
// dot in the domain, spaces) without inventing rules the server does not have.
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function UnsubscribesTab({ onChanged }) {
  const { pushToast } = useToast();
  const { busy, go } = useMutate(pushToast);
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('manual');
  const [q, setQ] = useState('');

  const { data, loading, error, reload } = useResource(
    () => api.get('/v1/prachar/unsubscribes').then(rows), [],
  );
  const list = data || [];
  const refresh = () => { reload(); onChanged?.(); };

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? list.filter((u) => (u.email || '').toLowerCase().includes(t)) : list;
  }, [list, q]);

  const add = async () => {
    const v = email.trim().toLowerCase();
    if (!v) return pushToast({ type: 'error', title: 'Enter an email address.' });
    if (!LOOKS_LIKE_EMAIL.test(v)) {
      return pushToast({ type: 'error', title: `"${v}" does not look like an email address.` });
    }
    if (list.some((u) => (u.email || '').toLowerCase() === v)) {
      return pushToast({ type: 'info', title: `${v} is already on the list.` });
    }
    const r = await go(
      () => api.post(`/v1/prachar/unsubscribes?email=${encodeURIComponent(v)}&reason=${encodeURIComponent(reason)}`),
      `${v} will no longer receive marketing email`,
    );
    if (r.ok) { setEmail(''); refresh(); }
    return undefined;
  };

  const remove = async (u) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(
      `Remove ${u.email} from the opt-out list?\n\nThey will start receiving marketing email again. Only do this if they have asked to be re-subscribed.`,
    )) return;
    const r = await go(() => api.delete(`/v1/prachar/unsubscribes/${u.id}`), `${u.email} removed from the list`);
    if (r.ok) refresh();
  };

  return (
    <div>
      <Bar title="Opted out" hi="निकास">
        {list.length > 0 && (
          <input
            className="k-formpanel__input"
            type="search"
            placeholder="Find an address…"
            aria-label="Search the opt-out list"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        )}
      </Bar>

      <p className="note note--info pr__note">
        Every campaign send is filtered against this list before it goes out, and the
        skipped count is reported back to you. Nobody here receives marketing email.
      </p>

      <div className="pr__inline">
        <input
          className="k-formpanel__input"
          type="email"
          placeholder="name@example.com"
          aria-label="Email address to suppress"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
        />
        <select className="k-formpanel__input" aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="manual">Added by hand</option>
          <option value="requested">They asked us to</option>
          <option value="bounced">Address bounces</option>
          <option value="complaint">Marked as spam</option>
        </select>
        <button type="button" className="k-btn k-btn--primary k-btn--sm" onClick={add} disabled={busy}>
          {busy ? 'Adding…' : 'Add'}
        </button>
      </div>

      <Panel
        loading={loading}
        error={error}
        onRetry={reload}
        empty={list.length === 0}
        emptyProps={{
          icon: '🚫',
          title: 'Nobody has opted out',
          sub: 'Contacts who unsubscribe, bounce or report a message appear here and are excluded from every future send.',
        }}
        count={3}
      >
        {shown.length === 0 ? (
          <p className="pr__step-when">No address on the list matches “{q}”.</p>
        ) : (
          <DataTable columns={['Email', 'Reason', 'Since', '']}>
            {shown.map((u) => (
              <tr key={u.id}>
                <Td bold>{u.email}</Td>
                <td className="pr__step-when">{humanise(u.reason || 'manual')}</td>
                <td>{fmtDate(u.unsubscribed_at)}</td>
                <td>
                  <button type="button" className="pr__del" onClick={() => remove(u)} disabled={busy}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
        <p className="pr__step-when">
          {q.trim()
            ? `${shown.length} of ${plural(list.length, 'address', 'addresses')} shown.`
            : `${plural(list.length, 'address', 'addresses')} suppressed.`}
        </p>
      </Panel>
    </div>
  );
}
