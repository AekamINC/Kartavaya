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
//
// ── WHAT THIS SCREEN CAN NOW RECORD, AND WHAT IT REFUSES ────────────────────
// Until 2026-08-21 nothing could write to `staging.udin_register`, so the
// at-risk list this whole module exists to serve had nothing to be at risk
// about. Three things can now be recorded and one is refused:
//
//   record a signing   ALWAYS allowed, however old. A document signed ninety
//                      days ago with no UDIN is exactly what the lapsed count
//                      exists to show, and a firm typing up its backlog is
//                      entering precisely those.
//   generate           REFUSED once the window has closed — the one genuinely
//                      statutory refusal in the module. The ICAI portal will
//                      not issue a number, so recording one here would be
//                      recording something that did not happen.
//   not required       the honest way off the backlog, and it needs a reason.
//   revoke             refused once the 48 hours are up, with FAQ Q124's answer
//                      attached: generate a fresh UDIN inside whatever is left.
import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Empty } from '../../components/editorial';
import { DataTable, Td } from '../../components/editorial';
import DateInput from '../../components/ui/DateInput';
import useTableView from '../../hooks/useTableView';
import TableToolbar, { ArrangedTableSection } from '../../components/ui/TableToolbar';
import useModuleWrite from '../../hooks/useModuleWrite';
import { useToast } from '../../components/ui/toast';
import { Badge, ErrorNote, Shim, errText, useResource, today } from './_shared';
// The product's one date renderer and its one person renderer. `CreatedCell`
// and `ByCell` render `ui/Table`'s `<Cell>`, which IS a `<td>` — the same
// element `Td` renders — so they drop into this table unchanged and it keeps
// one date format rather than growing a second beside `signed_on`.
import { CreatedCell, UpdatedCell, ByCell } from '../../components/ui/CreatedColumn';

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

/**
 * The register's columns, hoisted so the two expansion rows span
 * `UDIN_COLUMNS.length` rather than a literal 8.
 *
 * `ArrangedDataTable` only retargets a spanning row when its `colSpan` EQUALS
 * the base column count — that is how it tells "spans everything" from "a
 * positional row" — so a hardcoded 8 under a twelve-column table both
 * under-spans today and stops being retargeted the moment a column is hidden.
 *
 * The four appended at the END, after the blank actions column, because a body
 * cell is identified by POSITION: cell *i* is column *i*. Appending leaves every
 * existing column where a stored arrangement already expects it.
 *
 * `Signed on` IS NOT `Created`, and `Signed by` IS NOT `Entered by`. The first
 * pair is the ICAI fact — who certified the document and on what date, which is
 * what the UDIN attests. The second is a fact about this product: who typed the
 * row in and when. A backlog entered by an articled assistant on behalf of a
 * partner has two different names in those two columns, and showing only one of
 * them would put somebody's name against a certification they did not make.
 * `services/custody/udin.py` says the same thing on the SQL side.
 */
const UDIN_COLUMNS = [
  'Client', 'Document', 'Signed by', 'Signed on', 'Generate by', 'Day', 'Left', '',
  'Entered', 'Entered by', 'Updated', 'Updated by',
];

const URGENCY_LABELS = {
  not_started: 'Dated ahead',
  lapsed: 'Lapsed',
  last_day: 'Last day',
  critical: 'Critical',
  due_soon: 'Due soon',
  open: 'Open',
};

const UDIN_STATUS_LABELS = {
  signed: 'Signed, no UDIN',
  generated: 'Generated',
  revoked: 'Revoked',
  not_required: 'Not required',
};

// ICAI's own three mandatory categories, and the three the UDIN portal itself
// splits on — which is why the register stores one of them rather than a
// free-text document type.
const DOCUMENT_KINDS = [
  ['certificate', 'Certificate'],
  ['gst_or_tax_audit_report', 'GST or tax audit report'],
  ['audit_assurance_attestation', 'Audit, assurance or attestation'],
];

const BLANK = {
  client_id: '',
  client_name: '',
  document_kind: 'certificate',
  document_title: '',
  document_ref: '',
  financial_year: '',
  signed_on: '',
  signed_by_member: '',
  signed_by_membership_no: '',
  notes: '',
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

/**
 * The company list, fetched only once the create form is open.
 *
 * `/v1/custody/clients` rather than the CRM's own route, which is gated on
 * holding CRM, Finance or Sales — a practice that bought HR alone would
 * otherwise be able to read this register and not the names in it.
 */
function useClientOptions(enabled) {
  const [state, setState] = useState({ loading: false, error: '', items: [] });
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    setState({ loading: true, error: '', items: [] });
    api.get('/v1/custody/clients')
      .then(r => {
        if (alive) setState({ loading: false, error: '', items: r.data?.data || [] });
      })
      .catch(err => {
        if (alive) setState({ loading: false, error: errText(err), items: [] });
      });
    return () => { alive = false; };
  }, [enabled]);
  return state;
}

export default function UdinTab() {
  const { canWrite, reason: denial } = useModuleWrite({
    label: 'change the UDIN register',
  });
  const { pushToast } = useToast();

  const [asOf, setAsOf] = useState(today());
  const [includeLapsed, setIncludeLapsed] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);

  const [acting, setActing] = useState(null);      // { id, kind }
  const [number, setNumber] = useState({ udin: '', note: '' });
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState('');

  const summaryPath = `/v1/custody/udin/summary?as_of=${encodeURIComponent(asOf)}`;
  const riskPath =
    `/v1/custody/udin/at-risk?as_of=${encodeURIComponent(asOf)}`
    + `&include_lapsed=${includeLapsed ? 'true' : 'false'}`;

  const summary = useResource(summaryPath, [summaryPath]);
  const risk = useResource(riskPath, [riskPath]);
  const revocable = useResource('/v1/custody/udin/revocable', []);
  const clients = useClientOptions(showForm);

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

  function reloadAll() {
    risk.reload();
    summary.reload();
    revocable.reload();
  }

  function openAction(id, kind) {
    setActing(a => (a && a.id === id && a.kind === kind ? null : { id, kind }));
    setNumber({ udin: '', note: '' });
    setWhy('');
  }

  const set = k => e => setForm({ ...form, [k]: e.target.value });

  function pickClient(e) {
    const id = e.target.value;
    const hit = clients.items.find(c => String(c.id) === id);
    // The picker fills the SNAPSHOT as well as the link, and leaves it editable.
    // `client_name` on this table is the name as it stood on the day the
    // document was signed — a company that renames itself must not
    // retrospectively rename what the practice certified.
    setForm(f => ({ ...f, client_id: id, client_name: hit ? hit.name : f.client_name }));
  }

  async function create(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const { data } = await api.post('/v1/custody/udin', {
        ...form,
        client_id: form.client_id || null,
      });
      pushToast({
        title: data.is_lapsed
          ? `Recorded — the window closed on ${data.generate_by}`
          : `Recorded — generate by ${data.generate_by}`,
        type: data.is_lapsed ? 'error' : 'success',
      });
      setShowForm(false);
      setForm(BLANK);
      reloadAll();
    } catch (err) {
      pushToast({ title: errText(err, 'The signing could not be recorded.'), type: 'error' });
    } finally { setSaving(false); }
  }

  async function generate(e, id) {
    e.preventDefault();
    setBusy(id);
    try {
      await api.post(`/v1/custody/udin/${id}/generate`, number);
      pushToast({ title: 'UDIN recorded — 48 hours to revoke it', type: 'success' });
      setActing(null);
      reloadAll();
    } catch (err) {
      pushToast({ title: errText(err, 'The UDIN could not be recorded.'), type: 'error' });
    } finally { setBusy(''); }
  }

  async function notRequired(e, id) {
    e.preventDefault();
    setBusy(id);
    try {
      await api.post(`/v1/custody/udin/${id}/not-required`, { reason: why });
      pushToast({ title: 'Recorded as not requiring a UDIN', type: 'success' });
      setActing(null);
      reloadAll();
    } catch (err) {
      pushToast({ title: errText(err, 'That could not be recorded.'), type: 'error' });
    } finally { setBusy(''); }
  }

  async function revokeNumber(e, id) {
    e.preventDefault();
    setBusy(id);
    try {
      await api.post(`/v1/custody/udin/${id}/revoke`, { reason: why });
      pushToast({ title: 'UDIN revoked', type: 'success' });
      setActing(null);
      reloadAll();
    } catch (err) {
      pushToast({ title: errText(err, 'The UDIN could not be revoked.'), type: 'error' });
    } finally { setBusy(''); }
  }

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
        <button
          type="button"
          className="k-btn k-btn--primary"
          disabled={!canWrite}
          title={denial || undefined}
          onClick={() => setShowForm(v => !v)}
        >
          {showForm ? 'Close' : '+ Record a signing'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={create} className="k-formpanel">
          <h3 className="k-section__title">Record a signed document</h3>
          {clients.error && (
            <ErrorNote what="The company list" error={clients.error} />
          )}
          <div className="k-formpanel__grid k-formpanel__grid--3">
            <label className="k-formpanel__label">
              <span>Client</span>
              <select className="k-formpanel__input" value={form.client_id}
                onChange={pickClient}>
                <option value="">Not one of our companies</option>
                {clients.items.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="k-formpanel__label">
              <span>Recorded as *</span>
              {/* A SNAPSHOT, not a join. Migration 161 stores the name on the
                  row because the name on a signed document is the name as it
                  was on the day it was signed. */}
              <input className="k-formpanel__input" required value={form.client_name}
                onChange={set('client_name')} />
            </label>
            <label className="k-formpanel__label">
              <span>Kind *</span>
              <select className="k-formpanel__input" value={form.document_kind}
                onChange={set('document_kind')}>
                {DOCUMENT_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>

            <label className="k-formpanel__label">
              <span>Document *</span>
              <input className="k-formpanel__input" required
                placeholder="Net worth certificate"
                value={form.document_title} onChange={set('document_title')} />
            </label>
            <label className="k-formpanel__label">
              <span>Reference</span>
              <input className="k-formpanel__input" value={form.document_ref}
                onChange={set('document_ref')} />
            </label>
            <label className="k-formpanel__label">
              <span>Financial year</span>
              {/* Optional and blocks nothing when empty; '2026-27' is the shape
                  the column will take. */}
              <input className="k-formpanel__input" placeholder="2026-27"
                value={form.financial_year} onChange={set('financial_year')} />
            </label>

            <label className="k-formpanel__label">
              <span>Signed on *</span>
              {/* DAY 1 OF THE WINDOW IS THIS DATE ITSELF — ICAI counts both end
                  dates. A date in the future is refused; a date ninety days ago
                  is not, because that backlog is the point of the register. */}
              <DateInput type="date" className="k-formpanel__input" required
                value={form.signed_on} onChange={set('signed_on')} />
            </label>
            <label className="k-formpanel__label">
              <span>Signed by *</span>
              <input className="k-formpanel__input" required placeholder="CA Anil Sharma"
                value={form.signed_by_member} onChange={set('signed_by_member')} />
            </label>
            <label className="k-formpanel__label">
              <span>Membership number</span>
              {/* Printed on the document and embedded in the UDIN itself, so it
                  is not a system identifier. Optional, and it blocks nothing —
                  but supplying it lets the register catch a UDIN pasted from
                  another partner's portal session. */}
              <input className="k-formpanel__input" value={form.signed_by_membership_no}
                onChange={set('signed_by_membership_no')} />
            </label>

            <label className="k-formpanel__label mn-fw">
              <span>Notes</span>
              <input className="k-formpanel__input" value={form.notes}
                onChange={set('notes')} />
            </label>
          </div>
          <p className="mn-quote">
            The number is not recorded here. A row is born unnumbered, the
            {s ? ` ${s.window_days}-day ` : ' '}window runs from the signing
            date, and the UDIN is attached on the row once the portal has issued
            it.
          </p>
          <div className="k-formpanel__actions">
            <button type="button" className="k-btn k-btn--ghost"
              onClick={() => { setShowForm(false); setForm(BLANK); }}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary"
              disabled={saving || !canWrite} title={denial || undefined}>
              {saving ? 'Recording…' : 'Record signing'}
            </button>
          </div>
        </form>
      )}

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
            {Object.entries(UDIN_STATUS_LABELS).map(([key, label]) => (
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
          sub="Every certificate, audit report and attestation this practice signs belongs here with the date it was signed. Record the first one with the button above."
        />
      )}

      {!risk.loading && !risk.error && rows.length > 0 && (
        <ArrangedTableSection className="tv-card">
          {/* ONE row of chrome. `TableToolbar` and the table under it are
              paired here so the table's "Columns…" control renders INSIDE the
              toolbar rather than on a second line of its own — see
              `ui/columnsSlot.js` for why the button travels and the state does
              not. The `.tv-card` frame is unchanged; the wrapper renders it. */}
          <TableToolbar view={table} label="documents" searchPlaceholder="Client, document or member…" />
          <DataTable arrange="manav.udin_register"
            columns={UDIN_COLUMNS}
          >
            {table.rows.map(r => (
              <React.Fragment key={r.id}>
                <tr>
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
                  <Td>
                    <div className="mn-rowact">
                      {/* THE CONTROL IS ABSENT ONCE THE WINDOW HAS CLOSED, and
                          the row still shows why. The portal will not issue a
                          number now, so offering the button would be offering
                          to record something that cannot have happened. */}
                      {!r.is_lapsed && (
                        <button type="button" className="k-btn k-btn--ghost k-btn--sm"
                          disabled={!canWrite} title={denial || undefined}
                          onClick={() => openAction(r.id, 'generate')}>
                          Add UDIN
                        </button>
                      )}
                      <button type="button" className="k-btn k-btn--ghost k-btn--sm"
                        disabled={!canWrite} title={denial || undefined}
                        onClick={() => openAction(r.id, 'not_required')}>
                        Not required
                      </button>
                    </div>
                  </Td>
                  {/* WHO typed the row into the register and WHO last moved it.
                      `hasActor` is passed on both: a document entered by an
                      assistant who has since left reads `unknown`, a different
                      fact from "nobody is recorded against this document". */}
                  <CreatedCell value={r.created_at} />
                  <ByCell name={r.created_by_name} hasActor={r.has_creator} />
                  <UpdatedCell value={r.updated_at} />
                  <ByCell name={r.updated_by_name} hasActor={r.has_updater} />
                </tr>

                {acting && acting.id === r.id && acting.kind === 'generate' && (
                  <tr>
                    <td colSpan={UDIN_COLUMNS.length}>
                      <form className="k-formpanel" onSubmit={e => generate(e, r.id)}>
                        <h3 className="k-section__title">
                          UDIN for “{r.document_title}”
                        </h3>
                        <div className="k-formpanel__grid k-formpanel__grid--2">
                          <label className="k-formpanel__label">
                            <span>UDIN *</span>
                            {/* Eighteen letters or digits — the column's own bar.
                                Nothing about the INTERNAL shape is checked: a
                                number that does not match ICAI's published
                                syntax is recorded exactly as entered. */}
                            <input className="k-formpanel__input" required maxLength={18}
                              placeholder="19304576AKTSBN1359"
                              value={number.udin}
                              onChange={e => setNumber({ ...number, udin: e.target.value })} />
                          </label>
                          <label className="k-formpanel__label">
                            <span>Note</span>
                            <input className="k-formpanel__input" value={number.note}
                              onChange={e => setNumber({ ...number, note: e.target.value })} />
                          </label>
                        </div>
                        <p className="mn-quote">
                          Day {r.day_of_window} of {r.window_days}; the last
                          permissible date is {r.generate_by}. The 48-hour
                          revocation window starts the moment this is recorded,
                          and the server’s clock decides — not this browser’s.
                        </p>
                        <div className="k-formpanel__actions">
                          <button type="button" className="k-btn k-btn--ghost"
                            onClick={() => setActing(null)}>Cancel</button>
                          <button type="submit" className="k-btn k-btn--primary"
                            disabled={busy === r.id || !canWrite} title={denial || undefined}>
                            {busy === r.id ? 'Recording…' : 'Record UDIN'}
                          </button>
                        </div>
                      </form>
                    </td>
                  </tr>
                )}

                {acting && acting.id === r.id && acting.kind === 'not_required' && (
                  <tr>
                    <td colSpan={UDIN_COLUMNS.length}>
                      <form className="k-formpanel" onSubmit={e => notRequired(e, r.id)}>
                        <h3 className="k-section__title">
                          No UDIN needed for “{r.document_title}”?
                        </h3>
                        <div className="k-formpanel__grid k-formpanel__grid--2">
                          <label className="k-formpanel__label mn-fw">
                            <span>Why *</span>
                            {/* Required, because this is a judgement rather than
                                a fact and the register has to carry the
                                judgement next to it. */}
                            <input className="k-formpanel__input" required
                              placeholder="Not an audit, assurance or attestation function"
                              value={why} onChange={e => setWhy(e.target.value)} />
                          </label>
                        </div>
                        <p className="mn-quote">
                          This is the honest way off the backlog. Without it the
                          only exits are a real number and a lapse.
                        </p>
                        <div className="k-formpanel__actions">
                          <button type="button" className="k-btn k-btn--ghost"
                            onClick={() => setActing(null)}>Cancel</button>
                          <button type="submit" className="k-btn k-btn--primary"
                            disabled={busy === r.id || !canWrite} title={denial || undefined}>
                            {busy === r.id ? 'Recording…' : 'Record'}
                          </button>
                        </div>
                      </form>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </DataTable>
        </ArrangedTableSection>
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
              {acting && acting.id === r.id && acting.kind === 'revoke' ? (
                <form className="k-formpanel" onSubmit={e => revokeNumber(e, r.id)}>
                  <div className="k-formpanel__grid k-formpanel__grid--2">
                    <label className="k-formpanel__label mn-fw">
                      <span>Why *</span>
                      {/* A revocation with no reason is not a record of
                          anything, and this is the row an audit is read for. */}
                      <input className="k-formpanel__input" required
                        value={why} onChange={e => setWhy(e.target.value)} />
                    </label>
                  </div>
                  <p className="mn-quote">
                    A revocation is not an undo. Past the window the member has
                    to generate a fresh UDIN inside whatever is left of the sixty
                    days (FAQ Q124), and only the member who generated this one
                    can revoke it (FAQ Q151).
                  </p>
                  <div className="k-formpanel__actions">
                    <button type="button" className="k-btn k-btn--ghost"
                      onClick={() => setActing(null)}>Cancel</button>
                    <button type="submit" className="k-btn k-btn--primary"
                      disabled={busy === r.id || !canWrite} title={denial || undefined}>
                      {busy === r.id ? 'Revoking…' : 'Revoke this UDIN'}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="mn-rowact">
                  <button type="button" className="k-btn k-btn--ghost k-btn--sm"
                    disabled={!canWrite} title={denial || undefined}
                    onClick={() => openAction(r.id, 'revoke')}>
                    Revoke
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
