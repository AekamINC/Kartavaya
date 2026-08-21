// Manav → DSC.
//
// The register of client signing tokens the practice physically holds.
//
// ── What this replaces ───────────────────────────────────────────────────────
// Nothing, and that is the defect. `staging.dsc_register` has existed since
// migration 160 and `services/custody/dsc.py` has read it since the day it
// landed. There was no router and no screen, so the table held 0 rows —
// measured live on 2026-08-21 — and the only record of a certificate's expiry
// date was printed on the token itself, in a drawer.
//
// ── The one idea the screen is built around ──────────────────────────────────
// **"EXPIRED" IS ONLY HALF OF IT.** A token handed back to the client in March
// stops a filing exactly as dead as one whose certificate expired in March, and
// the firm is exactly as surprised on the morning of the deadline. So this
// screen never shows a bare date: every row carries `status`, which folds
// expiry, revocation, a not-yet-live certificate AND custody into one verdict.
// The date is there to say how long you have, not to be interpreted.
//
// The four views are the four questions a practice actually asks, and they are
// deliberately not filters over one list:
//
//   register    everything, with the status split. The complete view.
//   expiring    renewals due inside a window. INCLUSIVE AT BOTH ENDS — 0 days
//               means "dies today, still works today".
//   unusable    the filing-day check. Expired OR revoked OR not yet valid OR
//               not in this office. This is the one to read before promising a
//               client a filing date.
//   firm-own    the partners' own DSCs. `client_id IS NULL` means the
//               PRACTICE'S OWN and not "all clients", which is the misreading
//               `services/custody/dsc.py` warns about three separate times —
//               so it is its own route and its own view, never a cleared filter.
//
// The register and the two lists do NOT add up: a certificate revoked early but
// still inside its valid_to is in neither list, by design. The server says so
// in `note` and this screen prints it rather than leaving a reader to sum two
// numbers and get a third.
import React, { useState } from 'react';
import { Empty } from '../../components/editorial';
import { DataTable, Td } from '../../components/editorial';
import DateInput from '../../components/ui/DateInput';
import useTableView from '../../hooks/useTableView';
import TableToolbar from '../../components/ui/TableToolbar';
import { Badge, ErrorNote, Shim, useResource, today } from './_shared';

// The five verdicts `dsc.status_of` can return, in the order of how dead a
// thing is. Tokens only — a literal here would be the light-mode colour in dark
// mode, which is the bug `_shared.jsx` was written to end.
const DSC_STATUS_COLORS = {
  usable: 'var(--ok)',
  not_in_possession: 'var(--warn)',
  not_yet_valid: 'var(--st-in-progress)',
  expired: 'var(--danger)',
  revoked: 'var(--danger)',
};

const DSC_STATUS_LABELS = {
  usable: 'Usable',
  not_in_possession: 'Not with us',
  not_yet_valid: 'Not yet valid',
  expired: 'Expired',
  revoked: 'Revoked',
};

const VIEWS = [
  ['register', 'Register'],
  ['expiring', 'Expiring'],
  ['unusable', 'Cannot sign'],
  ['firm-own', "The firm's own"],
];

/** `0` reads as "today", not as "no days". Negative says how long ago. */
function daysWord(n) {
  if (n === 0) return 'today';
  if (n > 0) return `${n} day${n === 1 ? '' : 's'}`;
  return `${-n} day${n === -1 ? '' : 's'} ago`;
}

function pathFor(view, stamp, days) {
  const as_of = `as_of=${encodeURIComponent(stamp)}`;
  if (view === 'expiring') return `/v1/custody/dsc/expiring?days=${days}&${as_of}`;
  if (view === 'unusable') return `/v1/custody/dsc/unusable?${as_of}`;
  if (view === 'firm-own') return `/v1/custody/dsc/firm-own?${as_of}`;
  return `/v1/custody/dsc?${as_of}`;
}

export default function DscTab() {
  const [view, setView] = useState('register');
  // ONE date for the whole screen, and it is a real parameter rather than the
  // browser's clock read repeatedly. A filing-day check is asked ABOUT the
  // filing date, which is usually not today.
  const [asOf, setAsOf] = useState(today());
  const [days, setDays] = useState(30);

  const path = pathFor(view, asOf, days);
  const res = useResource(path, [path]);

  const rows = res.data?.data || [];
  const summary = res.data?.summary || null;

  // Called before any early return — a hook after a conditional is the rule
  // React actually enforces, and the sibling tabs in this directory get it
  // wrong. The filters come from the loaded rows, never from a hardcoded list.
  const table = useTableView(rows, {
    filters: [
      { key: 'status', label: 'Status' },
      { key: 'custody_status', label: 'Custody' },
    ],
    searchKeys: ['holder_name', 'client_name', 'serial_number', 'token_serial'],
  });

  return (
    <div>
      <div className="mn-sub" role="tablist" aria-label="DSC views">
        {VIEWS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            className={`mn-sub__b${view === id ? ' on' : ''}`}
            onClick={() => setView(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mn-bar">
        <label className="mn-field">
          <span className="mn-field__l">Position on</span>
          <DateInput
            type="date"
            className="inp mn-f"
            value={asOf}
            onChange={e => setAsOf(e.target.value || today())}
          />
        </label>
        {view === 'expiring' && (
          <label className="mn-field">
            <span className="mn-field__l">Within</span>
            <input
              type="number"
              min="0"
              max="3650"
              className="inp mn-f--sm"
              value={days}
              onChange={e => setDays(Math.max(0, Number(e.target.value) || 0))}
            />
          </label>
        )}
        <span className="mn-bar__gap" />
        <span className="mn-count">
          {res.loading ? 'Loading…' : `${rows.length} certificate${rows.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {summary && (
        <div className="mn-facts">
          {Object.entries(DSC_STATUS_LABELS).map(([key, label]) => (
            <div key={key}>
              {/* Zero-filled by the server on purpose. A dashboard that renders
                  only the keys it was given shows nothing at all where
                  "0 expired" is the reassuring thing the reader came for. */}
              <span className="mn-fact__k">{label}</span>
              <span className="mn-fact__v" style={{ color: DSC_STATUS_COLORS[key] }}>
                {summary[key]}
              </span>
            </div>
          ))}
          <div>
            <span className="mn-fact__k">On the register</span>
            <span className="mn-fact__v">{summary.total}</span>
          </div>
        </div>
      )}

      {res.data?.note && <p className="mn-quote">{res.data.note}</p>}

      {res.loading && <Shim count={4} />}
      {!res.loading && res.error && (
        <ErrorNote what="The DSC register" error={res.error} onRetry={res.reload} />
      )}

      {!res.loading && !res.error && rows.length === 0 && (
        <Empty
          icon="🔑"
          title={view === 'register' ? 'No signing tokens recorded' : 'Nothing in this view'}
          sub={
            view === 'register'
              ? 'This register is empty. Every client DSC the practice holds — whose it is, when it expires, and whether it is in this office today — belongs here. There is no way to add one from this screen yet.'
              : 'Nothing matches this question on the date above. Try the register view for the complete picture.'
          }
        />
      )}

      {!res.loading && !res.error && rows.length > 0 && (
        <div className="tv-card">
          <TableToolbar view={table} label="certificates" searchPlaceholder="Holder, client or serial…" />
          <DataTable
            columns={['Holder', 'Client', 'Certificate', 'Valid to', 'Expiry', 'Custody', 'Status']}
          >
            {table.rows.map(r => (
              <tr key={r.id}>
                <Td>
                  <div className="mn-t__n--b">{r.holder_name}</div>
                  {r.holder_designation && (
                    <div className="mn-t__mute">{r.holder_designation}</div>
                  )}
                </Td>
                <Td>
                  {/* `belongs_to_firm` is keyed off client_id, not off a null
                      name: the join is org-scoped, so a missing name can also
                      mean a client_id pointing somewhere it should not. */}
                  {r.belongs_to_firm ? <em className="mn-t__mute">The firm’s own</em>
                    : (r.client_name || <span className="mn-t__mute">—</span>)}
                </Td>
                <Td className="mn-t__mute">
                  <span className="mn-cap">{String(r.certificate_class || '').replace(/_/g, ' ')}</span>
                  {r.issuing_authority_canonical && ` · ${r.issuing_authority_canonical}`}
                </Td>
                <Td mono>{r.valid_to}</Td>
                <Td className="mn-t__mute">{daysWord(r.days_to_expiry)}</Td>
                <Td className="mn-t__mute mn-cap">
                  {String(r.custody_status || '').replace(/_/g, ' ')}
                  {r.custody_location ? ` · ${r.custody_location}` : ''}
                </Td>
                <Td>
                  <Badge text={DSC_STATUS_LABELS[r.status] || r.status} color={DSC_STATUS_COLORS[r.status]} />
                  {/* Advisory, never blocking — the same standing this product
                      gives GSTIN, PAN and TAN. A mistyped year is the common
                      one: 2027 entered as 2037. */}
                  {(r.warnings || []).map(w => (
                    <div key={w} className="mn-t__mute">{w}</div>
                  ))}
                </Td>
              </tr>
            ))}
          </DataTable>
        </div>
      )}
    </div>
  );
}
