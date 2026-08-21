// Manav → UDIN.
//
// What the practice has signed and not yet numbered.
//
// A practising Chartered Accountant must obtain a Unique Document
// Identification Number for every certificate, every GST and tax audit report
// and every other audit, assurance and attestation function they sign. There is
// a window, it starts at signing, and it closes. A signed document with no UDIN
// past that window cannot be fixed afterwards: ICAI notification
// No.1-CA(7)/192/2019 was issued under Item (1) of Part II of the Second
// Schedule to the Chartered Accountants Act 1949, so a contravention is
// professional misconduct.
//
// ── The two clocks, and why they are two panels and not one ─────────────────
// GENERATION is counted in whole DAYS from the DATE of signing, and BOTH END
// DATES COUNT — so a 60-day window from the 1st ends on `signed_on + 59`, and
// `days_left === 0` means TODAY IS THE LAST DAY and is NOT lapsed. That zero is
// the whole point of the screen; an "expires in 0 days" that actually meant
// "expired" would be the off-by-one wearing a different hat.
//
// REVOCATION is counted in HOURS from the INSTANT of generation — 48 of them,
// and the server's clock decides, not the browser's. A revocation is not an
// undo: past the window the member has to generate a FRESH UDIN inside whatever
// is left of the sixty days.
//
// ── The window is a row, not a constant ─────────────────────────────────────
// The generation window has already moved once: 15 days to 60, at the Council's
// 405th meeting on 17 September 2021. So the number comes from
// `staging.udin_window` (2 rows live) and the screen prints WHERE it came from
// — 'table' or the ICAI default compiled into the build. A firm reading a
// deadline is entitled to know which.
import React, { useState } from 'react';
import { Empty } from '../../components/editorial';
import { DataTable, Td } from '../../components/editorial';
import DateInput from '../../components/ui/DateInput';
import useTableView from '../../hooks/useTableView';
import TableToolbar from '../../components/ui/TableToolbar';
import { Badge, ErrorNote, Shim, useResource, today } from './_shared';

// `urgency` is a bucket for colour and ordering. THE NUMBER IS THE TRUTH — the
// server says so, and it is deliberately not a database enum because a bucket
// boundary is a product opinion that must never require a migration.
const URGENCY_COLORS = {
  not_started: 'var(--on-surface-3)',
  lapsed: 'var(--danger)',
  last_day: 'var(--danger)',
  critical: 'var(--warn)',
  due_soon: 'var(--st-in-progress)',
  open: 'var(--ok)',
};

const URGENCY_LABELS = {
  not_started: 'Dated ahead',
  lapsed: 'Lapsed',
  last_day: 'Last day',
  critical: 'Critical',
  due_soon: 'Due soon',
  open: 'Open',
};

const STATUS_LABELS = {
  signed: 'Signed, no UDIN',
  generated: 'Generated',
  revoked: 'Revoked',
  not_required: 'Not required',
};

/** `0` is the last day, not "no days left". */
function leftWord(n) {
  if (n === 0) return 'last day';
  if (n > 0) return `${n} day${n === 1 ? '' : 's'} left`;
  return `lapsed ${-n} day${n === -1 ? '' : 's'} ago`;
}

/** A 48-hour countdown as hours and minutes. Never negative — the server
 *  clamps at zero and carries the yes/no separately. */
function countdown(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

export default function UdinTab() {
  const [asOf, setAsOf] = useState(today());
  const [includeLapsed, setIncludeLapsed] = useState(true);

  const summaryPath = `/v1/custody/udin/summary?as_of=${encodeURIComponent(asOf)}`;
  const riskPath =
    `/v1/custody/udin/at-risk?as_of=${encodeURIComponent(asOf)}`
    + `&include_lapsed=${includeLapsed ? 'true' : 'false'}`;

  const summary = useResource(summaryPath, [summaryPath]);
  const risk = useResource(riskPath, [riskPath]);
  const revocable = useResource('/v1/custody/udin/revocable', []);

  const rows = risk.data?.data || [];
  const revoke = revocable.data?.data || [];
  const s = summary.data;

  const table = useTableView(rows, {
    filters: [
      { key: 'urgency', label: 'Urgency' },
      { key: 'document_kind_label', label: 'Kind' },
    ],
    searchKeys: ['client_name', 'document_title', 'document_ref', 'signed_by_member'],
  });

  return (
    <div>
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
        <label className="mn-chk">
          <input
            type="checkbox"
            checked={includeLapsed}
            onChange={e => setIncludeLapsed(e.target.checked)}
          />
          {/* Lapsed rows are the ones nothing can be done about. A firm working
              a queue may want them out of the way; a firm counting its exposure
              must not. */}
          <span>Include lapsed</span>
        </label>
        <span className="mn-bar__gap" />
        <span className="mn-count">
          {risk.loading ? 'Loading…' : `${rows.length} awaiting a UDIN`}
        </span>
      </div>

      {s && (
        <>
          <div className="mn-facts">
            <div>
              <span className="mn-fact__k">Lapsed</span>
              {/* The only figure here that represents something already
                  unfixable, and it is not a status and can never be one:
                  whether the window has closed is a fact about today. */}
              <span className="mn-fact__v" style={{ color: 'var(--danger)' }}>
                {s.lapsed}
              </span>
            </div>
            <div>
              <span className="mn-fact__k">Open</span>
              <span className="mn-fact__v">{s.open_total}</span>
            </div>
            <div>
              <span className="mn-fact__k">Next deadline</span>
              <span className="mn-fact__v">{s.next_deadline || '—'}</span>
            </div>
            {Object.entries(STATUS_LABELS).map(([key, label]) => (
              <div key={key}>
                <span className="mn-fact__k">{label}</span>
                <span className="mn-fact__v">{s.by_status?.[key] ?? 0}</span>
              </div>
            ))}
          </div>
          <p className="mn-quote">
            Generation window {s.window_days} days from the date of signing,
            both dates counted; revocation {s.revoke_window_hours} hours from
            generation. Source: {s.window_sources?.generate === 'table'
              ? 'the practice’s own window table'
              : 'the published ICAI default'}.
          </p>
        </>
      )}

      {summary.error && (
        <ErrorNote what="The UDIN summary" error={summary.error} onRetry={summary.reload} />
      )}

      {risk.loading && <Shim count={4} />}
      {!risk.loading && risk.error && (
        <ErrorNote what="The UDIN backlog" error={risk.error} onRetry={risk.reload} />
      )}

      {!risk.loading && !risk.error && rows.length === 0 && (
        <Empty
          icon="🧾"
          title="Nothing is waiting for a UDIN"
          sub="Every certificate, audit report and attestation this practice signs belongs here with the date it was signed. The register is empty — there is no way to add a signing from this screen yet."
        />
      )}

      {!risk.loading && !risk.error && rows.length > 0 && (
        <div className="tv-card">
          <TableToolbar view={table} label="documents" searchPlaceholder="Client, document or member…" />
          <DataTable
            columns={['Client', 'Document', 'Signed by', 'Signed on', 'Generate by', 'Day', 'Left']}
          >
            {table.rows.map(r => (
              <tr key={r.id}>
                <Td>{r.client_name || <span className="mn-t__mute">—</span>}</Td>
                <Td>
                  <div className="mn-t__n--b">{r.document_title}</div>
                  <div className="mn-t__mute">
                    {r.document_kind_label}
                    {r.document_ref ? ` · ${r.document_ref}` : ''}
                    {r.financial_year ? ` · FY ${r.financial_year}` : ''}
                  </div>
                </Td>
                <Td className="mn-t__mute">
                  {r.signed_by_member}
                  {/* The ICAI membership number is printed on the document and
                      embedded in the UDIN itself. It is not a system id. */}
                  {r.signed_by_membership_no ? ` · MRN ${r.signed_by_membership_no}` : ''}
                </Td>
                <Td mono>{r.signed_on}</Td>
                <Td mono>{r.generate_by}</Td>
                <Td className="mn-t__mute">
                  {r.day_of_window} of {r.window_days}
                </Td>
                <Td>
                  <Badge
                    text={URGENCY_LABELS[r.urgency] || r.urgency}
                    color={URGENCY_COLORS[r.urgency]}
                  />
                  <div className="mn-t__mute">{leftWord(r.days_left)}</div>
                </Td>
              </tr>
            ))}
          </DataTable>
        </div>
      )}

      <h4 className="dr__lbl">Still revocable — 48 hours from generation</h4>
      {revocable.error && (
        <ErrorNote what="The revocation window" error={revocable.error} onRetry={revocable.reload} />
      )}
      {!revocable.error && revoke.length === 0 && (
        <p className="mn-quote">
          Nothing generated in the last {s?.revoke_window_hours ?? 48} hours.
          Only the member who generated a UDIN can revoke it, and only inside
          that window.
        </p>
      )}
      {revoke.length > 0 && (
        <ul className="mn-list">
          {revoke.map(r => (
            <li key={r.id} className="mn-rec">
              <div className="mn-rec__top">
                <span className="mn-rec__name">{r.document_title}</span>
                <span className="mn-rec__amt">{countdown(r.seconds_left)}</span>
              </div>
              <div className="mn-rec__body mn-t__mute">
                {r.client_name} · {r.udin} · generated by {r.signed_by_member}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
