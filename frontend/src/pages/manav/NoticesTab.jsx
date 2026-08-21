// Manav → Notices.
//
// The department notice and assessment register, and the clock on it.
//
// ── Why this register is not like the others ─────────────────────────────────
// An invoice that goes unpaid stays an unpaid invoice. A DSC that expires stays
// an expired DSC. A GST ASMT-10 that goes unanswered is escalated BY SOMEBODY
// ELSE, on a date nobody in the practice chose, into a s.73/74 determination. A
// DRC-01 that goes unanswered becomes a DRC-07 demand order passed on whatever
// the record happens to show. Nobody has to remember to punish the practice.
// Missing the date is the punishment.
//
// ── Two things this screen refuses to get wrong ──────────────────────────────
//  · A notice due TODAY has 0 days remaining and is NOT overdue. The reply is
//    filed on the due date all the time, and a register that calls that late
//    trains people to ignore it — which is how a compliance list dies.
//  · `escalated` outranks every merely-overdue row, however far past due. The
//    deadline passed AND the consequence landed; a notice 90 days overdue and
//    one that has already become a demand order are not the same emergency.
//
// ── Who can open this ────────────────────────────────────────────────────────
// Org owners and org admins only. This screen answers "which of our clients are
// under assessment", which is the most commercially sensitive question the
// product can answer, and `services/custody/notices.py` explicitly declined to
// pick an access rule for it. `routers/custody.py` picks one and writes down
// why. Anyone else gets a 403 and reads the server's own sentence — NOT an
// empty table, because every register in this product has been genuinely empty
// and "no rows" is a sentence a reader believes.
import React, { useState } from 'react';
import { Empty } from '../../components/editorial';
import { DataTable, Td } from '../../components/editorial';
import DateInput from '../../components/ui/DateInput';
import useTableView from '../../hooks/useTableView';
import TableToolbar from '../../components/ui/TableToolbar';
import { Badge, ErrorNote, Shim, useResource, today } from './_shared';

// The bands, most urgent first — the same order `notices.URGENCY_ORDER` sorts
// on. `critical` starts at 0 days because 0 means due today: rule 88C and rule
// 88D give SEVEN days for a DRC-01B / DRC-01C, so a three-day "urgent" would
// leave a seven-day notice calm for more than half its life.
const BAND_COLORS = {
  escalated: 'var(--danger)',
  overdue: 'var(--danger)',
  critical: 'var(--warn)',
  urgent: 'var(--tertiary)',
  soon: 'var(--st-in-progress)',
  scheduled: 'var(--on-surface-3)',
  stopped: 'var(--ok)',
};

const BAND_LABELS = {
  escalated: 'Escalated',
  overdue: 'Overdue',
  critical: 'Critical',
  urgent: 'Urgent',
  soon: 'Soon',
  scheduled: 'Scheduled',
  stopped: 'Closed',
};

const VIEWS = [
  ['open', 'Live'],
  ['overdue', 'Overdue'],
  ['types', 'Catalogue'],
];

export default function NoticesTab() {
  const [view, setView] = useState('open');
  const [asOf, setAsOf] = useState(today());

  const path = view === 'types'
    ? '/v1/custody/notices/types'
    : `/v1/custody/notices${view === 'overdue' ? '/overdue' : ''}?as_of=${encodeURIComponent(asOf)}`;

  const res = useResource(path, [path]);
  const rows = res.data?.data || [];

  const table = useTableView(rows, {
    filters: view === 'types'
      ? [{ key: 'authority', label: 'Authority' }]
      : [{ key: 'authority', label: 'Authority' }, { key: 'status', label: 'Status' }],
    columns: { band: r => r.urgency?.band },
    searchKeys: view === 'types'
      ? ['label', 'code', 'form_no']
      : ['client_name', 'reference_no', 'notice_type_label', 'form_no', 'owner_name'],
  });

  return (
    <div>
      <div className="mn-sub" role="tablist" aria-label="Notice views">
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
        {view !== 'types' && (
          <label className="mn-field">
            <span className="mn-field__l">Position on</span>
            <DateInput
              type="date"
              className="inp mn-f"
              value={asOf}
              onChange={e => setAsOf(e.target.value || today())}
            />
          </label>
        )}
        <span className="mn-bar__gap" />
        <span className="mn-count">
          {res.loading ? 'Loading…' : `${rows.length} ${view === 'types' ? 'notice types' : 'notices'}`}
        </span>
      </div>

      {res.loading && <Shim count={4} />}
      {!res.loading && res.error && (
        <ErrorNote
          what={view === 'types' ? 'The notice catalogue' : 'The notice register'}
          error={res.error}
          onRetry={res.reload}
        />
      )}

      {!res.loading && !res.error && rows.length === 0 && (
        <Empty
          icon="📨"
          title={view === 'overdue' ? 'Nothing is overdue' : 'No notices recorded'}
          sub={
            view === 'overdue'
              ? 'No live notice has passed its reply date on the date above.'
              : 'Every notice, intimation and assessment order a client receives belongs here with the date it was served. The register is empty — there is no way to add one from this screen yet.'
          }
        />
      )}

      {!res.loading && !res.error && rows.length > 0 && view === 'types' && (
        <div className="tv-card">
          <TableToolbar view={table} label="notice types" searchPlaceholder="Form, code or label…" />
          <DataTable columns={['Notice', 'Authority', 'Form', 'Reply in', 'If ignored', 'Source']}>
            {table.rows.map(r => (
              <tr key={r.code}>
                <Td>
                  <div className="mn-t__n--b">{r.label}</div>
                  <div className="mn-t__mute">
                    {r.is_system ? 'Standard' : 'This practice’s own'}
                    {r.statute_ref ? ` · ${r.statute_ref}` : ''}
                  </div>
                </Td>
                <Td className="mn-t__mute mn-cap">{String(r.authority || '').replace(/_/g, ' ')}</Td>
                <Td className="mn-t__mute">
                  {r.form_no || '—'}
                  {r.reply_form_no ? ` → ${r.reply_form_no}` : ''}
                </Td>
                <Td className="mn-t__mute">
                  {/* `notice_specified` means the officer writes the date on the
                      notice — rule 142 prescribes no reply period for a DRC-01 —
                      so there is nothing to compute and the date must be read
                      off the paper. */}
                  {r.window_basis === 'notice_specified' ? 'As stated on the notice'
                    : r.reply_window_months
                      ? `${r.reply_window_months} month${r.reply_window_months === 1 ? '' : 's'}`
                      : `${r.reply_window_days} day${r.reply_window_days === 1 ? '' : 's'}`}
                  {r.window_in_working_days ? ' (working days)' : ''}
                </Td>
                <Td className="mn-t__mute">{r.consequence}</Td>
                <Td className="mn-t__mute">{r.source_url ? 'Published' : '—'}</Td>
              </tr>
            ))}
          </DataTable>
        </div>
      )}

      {!res.loading && !res.error && rows.length > 0 && view !== 'types' && (
        <div className="tv-card">
          <TableToolbar view={table} label="notices" searchPlaceholder="Client, reference or form…" />
          <DataTable columns={['Client', 'Notice', 'Reference', 'Received', 'Reply due', 'Where it stands', 'Owner']}>
            {table.rows.map(r => (
              <tr key={`${r.reference_no}-${r.received_on}`}>
                <Td>{r.client_name}</Td>
                <Td>
                  <div className="mn-t__n--b">{r.notice_type_label}</div>
                  <div className="mn-t__mute">
                    {r.form_no}
                    {r.reply_form_no ? ` → ${r.reply_form_no}` : ''}
                    {r.statute_ref ? ` · ${r.statute_ref}` : ''}
                  </div>
                </Td>
                <Td mono>{r.reference_no}</Td>
                <Td mono>{r.received_on}</Td>
                <Td mono>
                  {r.due_on || '—'}
                  {/* The officer's own date beats the statutory default. Worth
                      showing: an ASMT-10 that says fifteen days is due in
                      fifteen even though rule 99(1) caps the officer at 30. */}
                  {r.due_date_from_notice && (
                    <div className="mn-t__mute">as stated on the notice</div>
                  )}
                </Td>
                <Td>
                  <Badge
                    text={BAND_LABELS[r.urgency?.band] || r.urgency?.band}
                    color={BAND_COLORS[r.urgency?.band]}
                  />
                  <div className="mn-t__mute">{r.urgency_note}</div>
                </Td>
                <Td className="mn-t__mute">{r.owner_name || '—'}</Td>
              </tr>
            ))}
          </DataTable>
        </div>
      )}
    </div>
  );
}
