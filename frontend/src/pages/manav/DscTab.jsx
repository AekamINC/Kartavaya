// Manav → DSC.
//
// The register of client signing tokens the practice physically holds.
//
// ── What this replaces ───────────────────────────────────────────────────────
// Nothing, and that was the defect. `staging.dsc_register` has existed since
// migration 160 and `services/custody/dsc.py` has read it since the day it
// landed. There was no router and no screen, so the table held 0 rows —
// measured live on 2026-08-21 — and the only record of a certificate's expiry
// date was printed on the token itself, in a drawer. The read surface landed
// first; this screen now writes too, which is what makes the register a
// register rather than a claim.
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
//
// ── WHY THERE IS NO "STATUS" FIELD ON THE FORM ───────────────────────────────
// All five verdicts are DERIVED. `usable`, `expired` and `not_yet_valid` are
// arithmetic on the two validity dates; `revoked` and `not_in_possession` are
// derived from facts a person genuinely records — a revocation date, a custody
// move — so this screen offers the two FACTS as their own controls and offers
// the status as nothing at all. A stored status would be wrong from midnight
// until whatever job got round to flipping it, which is exactly the morning
// somebody is looking at it.
//
// Recording a certificate as `with_client` therefore reads back immediately as
// "Not with us", because the row the server returns is shaped by the same code
// that shapes a list row.
import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Empty } from '../../components/editorial';
import { DataTable, Td } from '../../components/editorial';
import DateInput from '../../components/ui/DateInput';
import useTableView from '../../hooks/useTableView';
import TableToolbar, { ArrangedTableSection } from '../../components/ui/TableToolbar';
// The audit CELLS are shared; the audit HEADERS cannot be. `DataTable` builds
// every `<th>` itself out of its `columns` prop — strings or plain objects, not
// nodes — so `CreatedHead`/`ByHead` have no way in. See the columns array below.
import {
  CreatedCell, UpdatedCell, ByCell,
} from '../../components/ui/CreatedColumn';
import useModuleWrite from '../../hooks/useModuleWrite';
import { useToast } from '../../components/ui/toast';
import { Badge, ErrorNote, Shim, errText, useClientOptions, useResource, today } from './_shared';

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

/**
 * The register's columns, hoisted out of the JSX so that the expansion rows
 * below can span `DSC_COLUMNS.length` instead of a literal.
 *
 * That is not tidiness. `ArrangedDataTable` only retargets a spanning row when
 * its `colSpan` EQUALS the base column count — that is how it recognises a row
 * as "not a positional row, spans everything" — so a hardcoded 8 under a
 * twelve-column table both under-spans today and stops being retargeted when a
 * column is hidden. The length expression cannot drift from the array.
 */
const DSC_COLUMNS = [
  'Holder', 'Client', 'Certificate', 'Valid to', 'Expiry', 'Custody', 'Status', '',
  // Appended at the END, after the blank actions column, because
  // `ArrangedDataTable` identifies a body cell by its POSITION: cell *i* is
  // column *i*. Appending leaves every existing column at the index the stored
  // arrangement already knows, where inserting before the actions column would
  // renumber half the table. A person who wants them beside Status moves them
  // in the Columns sheet.
  'Created', 'Created by', 'Updated', 'Updated by',
];

const DSC_STATUS_LABELS = {
  usable: 'Usable',
  not_in_possession: 'Not with us',
  not_yet_valid: 'Not yet valid',
  expired: 'Expired',
  revoked: 'Revoked',
};

// The vocabularies are the CHECK constraints of migration 160, in the order the
// migration lists them. Restated here only as LABELS — the server refuses
// anything outside its own tuples and its refusal names the whole set, so a
// value added to the migration and to `services/custody/dsc.py` and forgotten
// here is a missing option rather than a broken write.
const CERT_CLASSES = [
  ['class_3', 'Class 3'],
  ['class_2', 'Class 2 (issued before 2021)'],
  ['class_1', 'Class 1'],
  ['aadhaar_ekyc_otp', 'Aadhaar eKYC — OTP'],
  ['aadhaar_ekyc_biometric', 'Aadhaar eKYC — biometric'],
  ['unknown', 'Not known'],
];

const CERT_TYPES = [
  ['signature', 'Signature'],
  ['encryption', 'Encryption'],
  ['combined', 'Combined'],
  ['document_signer', 'Document signer'],
  ['dgft', 'DGFT'],
  ['unknown', 'Not known'],
];

// Seven states and not a boolean, because the remedy differs: `with_client` is
// a phone call, `lost` is a security incident, `destroyed` means the token no
// longer exists.
const CUSTODY_STATES = [
  ['with_firm', 'With the firm'],
  ['with_client', 'Given back to the client'],
  ['never_held', 'Never held — the client keeps it'],
  ['in_transit', 'In transit'],
  ['lost', 'Lost'],
  ['destroyed', 'Destroyed'],
  ['surrendered', 'Surrendered to the CA'],
];

const HOLDER_KINDS = [
  ['individual', 'A person'],
  ['organisation', 'An organisation'],
  ['unknown', 'Not known'],
];

const TOKEN_KINDS = [
  ['usb_token', 'USB token'],
  ['hsm', 'HSM'],
  ['software', 'Software'],
  ['unknown', 'Not known'],
];

const VIEWS = [
  ['register', 'Register'],
  ['expiring', 'Expiring'],
  ['unusable', 'Cannot sign'],
  ['firm-own', "The firm's own"],
];

const BLANK = {
  client_id: '',
  holder_name: '',
  holder_kind: 'individual',
  holder_designation: '',
  holder_pan: '',
  holder_din: '',
  certificate_class: 'class_3',
  certificate_type: 'signature',
  issuing_authority: '',
  serial_number: '',
  valid_from: '',
  valid_to: '',
  custody_status: 'with_firm',
  custody_location: '',
  custody_holder_name: '',
  token_kind: 'usb_token',
  token_serial: '',
  registered_portals: '',
  notes: '',
};

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

/**
 * The company list, fetched only once a form that needs it is open.
 *
 * `/v1/custody/clients` and NOT `/v1/graha/clients`: the CRM route is gated on
 * holding CRM, Finance or Sales, so a practice that bought HR alone could read
 * its own DSC register and not the names in it. The custody route returns names
 * and ids and nothing else, behind the same editor bar as the write it feeds.
 *
 * Loading, failure and emptiness are kept apart for the reason `_shared.jsx`
 * gives at length: a caught error that leaves the list at `[]` renders as "no
 * clients", which is a sentence a reader believes.
 */

export default function DscTab() {
  const { canWrite, reason: denial } = useModuleWrite({
    label: 'change the DSC register',
  });
  const { pushToast } = useToast();

  const [view, setView] = useState('register');
  // ONE date for the whole screen, and it is a real parameter rather than the
  // browser's clock read repeatedly. A filing-day check is asked ABOUT the
  // filing date, which is usually not today. It is a READ parameter only: every
  // write is stamped by the server, because a caller-supplied "now" on a
  // register of deadlines is a caller who can move one.
  const [asOf, setAsOf] = useState(today());
  const [days, setDays] = useState(30);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);

  // Which row has an action panel open, and which panel. One at a time: two
  // half-filled forms on one screen is how the wrong one gets submitted.
  const [acting, setActing] = useState(null);   // { id, kind }
  const [revoke, setRevoke] = useState({ revoked_on: '', reason: '' });
  const [move, setMove] = useState({ custody_status: 'with_client', custody_location: '', custody_holder_name: '', changed_on: '', note: '' });
  const [busy, setBusy] = useState('');

  const path = pathFor(view, asOf, days);
  const res = useResource(path, [path]);
  const clients = useClientOptions(showForm);

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

  function openAction(id, kind) {
    setActing(a => (a && a.id === id && a.kind === kind ? null : { id, kind }));
    setRevoke({ revoked_on: '', reason: '' });
    setMove({ custody_status: 'with_client', custody_location: '', custody_holder_name: '', changed_on: '', note: '' });
  }

  async function create(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const { data } = await api.post('/v1/custody/dsc', {
        ...form,
        // '' would reach a `::uuid` cast as an empty string, which is an
        // instant 500 rather than a null. An absent client MEANS the practice's
        // own certificate; the server treats it as a branch of its WHERE.
        client_id: form.client_id || null,
        registered_portals: form.registered_portals
          ? form.registered_portals.split(/[\s,]+/).filter(Boolean)
          : [],
      });
      pushToast({
        title: `Recorded — ${DSC_STATUS_LABELS[data.status] || data.status}`,
        type: 'success',
      });
      setShowForm(false);
      setForm(BLANK);
      res.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'The certificate could not be recorded.'), type: 'error' });
    } finally { setSaving(false); }
  }

  async function submitRevoke(e, id) {
    e.preventDefault();
    setBusy(id);
    try {
      await api.post(`/v1/custody/dsc/${id}/revoke`, revoke);
      pushToast({ title: 'Revocation recorded', type: 'success' });
      setActing(null);
      res.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'The revocation could not be recorded.'), type: 'error' });
    } finally { setBusy(''); }
  }

  async function submitMove(e, id) {
    e.preventDefault();
    setBusy(id);
    try {
      await api.post(`/v1/custody/dsc/${id}/custody`, move);
      pushToast({ title: 'Custody recorded', type: 'success' });
      setActing(null);
      res.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'The custody move could not be recorded.'), type: 'error' });
    } finally { setBusy(''); }
  }

  const set = k => e => setForm({ ...form, [k]: e.target.value });

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
        <button
          type="button"
          className="k-btn k-btn--primary"
          disabled={!canWrite}
          title={denial || undefined}
          onClick={() => setShowForm(v => !v)}
        >
          {showForm ? 'Close' : '+ Record a certificate'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={create} className="k-formpanel">
          <h3 className="k-section__title">Record a certificate</h3>
          {clients.error && (
            <ErrorNote what="The company list" error={clients.error} />
          )}
          <div className="k-formpanel__grid k-formpanel__grid--3">
            <label className="k-formpanel__label">
              <span>Whose certificate</span>
              <select
                className="k-formpanel__input"
                value={form.client_id}
                onChange={set('client_id')}
              >
                {/* NOT "all clients" and not "undecided". An empty client means
                    the PRACTICE'S OWN certificate — a partner's DSC held for
                    the firm's own signing — and the option says so. */}
                <option value="">The firm’s own</option>
                {clients.items.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="k-formpanel__label">
              <span>Holder’s name *</span>
              {/* The name inside the certificate. The filing has to be made in
                  that name, so it is the one field this row cannot do without. */}
              <input className="k-formpanel__input" required
                value={form.holder_name} onChange={set('holder_name')} />
            </label>
            <label className="k-formpanel__label">
              <span>Designation</span>
              <input className="k-formpanel__input" placeholder="Director, partner, signatory…"
                value={form.holder_designation} onChange={set('holder_designation')} />
            </label>

            <label className="k-formpanel__label">
              <span>Valid from *</span>
              <DateInput type="date" className="k-formpanel__input" required
                value={form.valid_from} onChange={set('valid_from')} />
            </label>
            <label className="k-formpanel__label">
              <span>Valid to *</span>
              {/* INCLUSIVE. This is the last day the certificate works — the
                  date the CA printed on it — and not the first day it does not. */}
              <DateInput type="date" className="k-formpanel__input" required
                value={form.valid_to} onChange={set('valid_to')} />
            </label>
            <label className="k-formpanel__label">
              <span>Certifying Authority</span>
              {/* Free text and never rejected: a CA whose licence lapses does
                  not un-issue the certificates in the drawer. The server
                  canonicalises the spelling and stores an unknown name as typed. */}
              <input className="k-formpanel__input" placeholder="eMudhra, Capricorn, (n)Code…"
                value={form.issuing_authority} onChange={set('issuing_authority')} />
            </label>

            <label className="k-formpanel__label">
              <span>Class</span>
              <select className="k-formpanel__input" value={form.certificate_class}
                onChange={set('certificate_class')}>
                {CERT_CLASSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="k-formpanel__label">
              <span>Type</span>
              <select className="k-formpanel__input" value={form.certificate_type}
                onChange={set('certificate_type')}>
                {CERT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="k-formpanel__label">
              <span>Certificate serial</span>
              <input className="k-formpanel__input" value={form.serial_number}
                onChange={set('serial_number')} />
            </label>

            <label className="k-formpanel__label">
              <span>Where the token is</span>
              <select className="k-formpanel__input" value={form.custody_status}
                onChange={set('custody_status')}>
                {CUSTODY_STATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="k-formpanel__label">
              <span>Location</span>
              <input className="k-formpanel__input" placeholder="Safe, cabin 2"
                value={form.custody_location} onChange={set('custody_location')} />
            </label>
            <label className="k-formpanel__label">
              <span>Held by</span>
              {/* A NAME, not a login. This is frequently the client's own
                  accountant, and the register is read by humans looking for a
                  token. */}
              <input className="k-formpanel__input" value={form.custody_holder_name}
                onChange={set('custody_holder_name')} />
            </label>

            <label className="k-formpanel__label">
              <span>Holder is</span>
              <select className="k-formpanel__input" value={form.holder_kind}
                onChange={set('holder_kind')}>
                {HOLDER_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="k-formpanel__label">
              <span>PAN</span>
              {/* NON-MANDATORY AND UNVALIDATED, and it must stay that way. The
                  income-tax portal binds a DSC to a PAN, so the field is here;
                  blocking on its shape is the rule this codebase has had to
                  un-fix more than once. */}
              <input className="k-formpanel__input" value={form.holder_pan}
                onChange={set('holder_pan')} />
            </label>
            <label className="k-formpanel__label">
              <span>DIN</span>
              <input className="k-formpanel__input" value={form.holder_din}
                onChange={set('holder_din')} />
            </label>

            <label className="k-formpanel__label">
              <span>Token</span>
              <select className="k-formpanel__input" value={form.token_kind}
                onChange={set('token_kind')}>
                {TOKEN_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="k-formpanel__label">
              <span>Token serial</span>
              {/* The number printed on the plastic — what somebody reads out
                  over the phone. Different from the serial inside the
                  certificate. */}
              <input className="k-formpanel__input" value={form.token_serial}
                onChange={set('token_serial')} />
            </label>
            <label className="k-formpanel__label">
              <span>Registered on</span>
              {/* RENEWING A DSC DOES NOT RE-REGISTER IT. A firm that renews on
                  the 28th and files on the 30th finds that out on the 30th. */}
              <input className="k-formpanel__input" placeholder="incometax mca gst traces"
                value={form.registered_portals} onChange={set('registered_portals')} />
            </label>

            <label className="k-formpanel__label mn-fw">
              <span>Notes</span>
              <input className="k-formpanel__input" value={form.notes}
                onChange={set('notes')} />
            </label>
          </div>
          <p className="mn-quote">
            There is no status to choose. Usable, expired, not yet valid,
            revoked and “not with us” are all worked out from the dates and the
            custody state on the day you ask — record a revocation or a custody
            move on the row itself.
          </p>
          <div className="k-formpanel__actions">
            <button type="button" className="k-btn k-btn--ghost"
              onClick={() => { setShowForm(false); setForm(BLANK); }}>
              Cancel
            </button>
            <button type="submit" className="k-btn k-btn--primary"
              disabled={saving || !canWrite} title={denial || undefined}>
              {saving ? 'Recording…' : 'Record certificate'}
            </button>
          </div>
        </form>
      )}

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
              ? 'Every client DSC the practice holds — whose it is, when it expires, and whether it is in this office today — belongs here. Record the first one with the button above.'
              : 'Nothing matches this question on the date above. Try the register view for the complete picture.'
          }
        />
      )}

      {!res.loading && !res.error && rows.length > 0 && (
        <ArrangedTableSection className="tv-card">
          {/* ONE row of chrome. `TableToolbar` and the table under it are
              paired here so the table's "Columns…" control renders INSIDE the
              toolbar rather than on a second line of its own — see
              `ui/columnsSlot.js` for why the button travels and the state does
              not. The `.tv-card` frame is unchanged; the wrapper renders it. */}
          <TableToolbar view={table} label="certificates" searchPlaceholder="Holder, client or serial…" />
          {/* THE AUDIT COLUMNS, and what `DataTable` would and would not take.
              `columns` is a list of STRINGS or of `{label, align, className,
              id, fixed}` objects — never nodes — and `ModuleUI.DataTable` builds
              each `<th>` itself from that entry, passing `HeadCell` no `sortKey`
              and no `onSort`. So `CreatedHead`/`ByHead` have nowhere to go here
              and these four headers are plain labels: the register's DataTable
              sorts nothing today, and a header that claimed otherwise would be
              the only sortable column on a table with no sort state to hold it.
              (The toolbar's search and filters above still work — they are
              `useTableView`, and it is `table.rows` this maps.)

              The CELLS are the shared components, because `CreatedCell` and
              `ByCell` render `ui/Table`'s `<Cell>`, which is a `<td>` — the same
              thing `Td` renders — so they sit in this row as ordinary cells.

              They are appended AFTER the blank actions column rather than
              before it, because `ArrangedDataTable` maps body cell *i* to
              column *i*: appending at both ends keeps every existing column at
              the index it already had, and a saved arrangement keeps meaning
              what it meant. */}
          <DataTable arrange="manav.dsc_register" columns={DSC_COLUMNS}>
            {table.rows.map(r => (
              <React.Fragment key={r.id}>
                <tr>
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
                  <Td>
                    <div className="mn-rowact">
                      <button type="button" className="k-btn k-btn--ghost k-btn--sm"
                        disabled={!canWrite} title={denial || undefined}
                        onClick={() => openAction(r.id, 'custody')}>
                        Custody
                      </button>
                      {/* A certificate already carrying a revocation date is
                          refused rather than updated — a second date would
                          replace the first — so the control is simply absent. */}
                      {!r.revoked_on && (
                        <button type="button" className="k-btn k-btn--ghost k-btn--sm"
                          disabled={!canWrite} title={denial || undefined}
                          onClick={() => openAction(r.id, 'revoke')}>
                          Revoke
                        </button>
                      )}
                    </div>
                  </Td>
                  {/* WHO recorded the certificate and WHO last amended it.
                      `hasActor` is passed on both: a token recorded by an
                      articled assistant who has since left reads `unknown`,
                      which is a different fact from "no person is recorded
                      against this certificate" — and on a custody register,
                      "who put this here" is the question the register exists to
                      answer. */}
                  <CreatedCell value={r.created_at} />
                  <ByCell name={r.created_by_name} hasActor={r.has_creator} />
                  <UpdatedCell value={r.updated_at} />
                  <ByCell name={r.updated_by_name} hasActor={r.has_updater} />
                </tr>

                {acting && acting.id === r.id && acting.kind === 'revoke' && (
                  <tr>
                    <td colSpan={DSC_COLUMNS.length}>
                      <form className="k-formpanel" onSubmit={e => submitRevoke(e, r.id)}>
                        <h3 className="k-section__title">Revoke {r.holder_name}’s certificate</h3>
                        <div className="k-formpanel__grid k-formpanel__grid--2">
                          <label className="k-formpanel__label">
                            <span>Revoked from *</span>
                            {/* The day the revocation TAKES EFFECT. The
                                certificate is dead ON that day, not from the day
                                after. A future date is allowed — a scheduled
                                surrender is a real thing — and comes back
                                flagged. */}
                            <DateInput type="date" className="k-formpanel__input" required
                              value={revoke.revoked_on}
                              onChange={e => setRevoke({ ...revoke, revoked_on: e.target.value })} />
                          </label>
                          <label className="k-formpanel__label">
                            <span>Why</span>
                            <input className="k-formpanel__input"
                              placeholder="Key compromise, holder left, CA revoked…"
                              value={revoke.reason}
                              onChange={e => setRevoke({ ...revoke, reason: e.target.value })} />
                          </label>
                        </div>
                        <p className="mn-quote">
                          Recorded once. The reason is added to this row’s notes,
                          never over them.
                        </p>
                        <div className="k-formpanel__actions">
                          <button type="button" className="k-btn k-btn--ghost"
                            onClick={() => setActing(null)}>Cancel</button>
                          <button type="submit" className="k-btn k-btn--primary"
                            disabled={busy === r.id || !canWrite} title={denial || undefined}>
                            {busy === r.id ? 'Recording…' : 'Record revocation'}
                          </button>
                        </div>
                      </form>
                    </td>
                  </tr>
                )}

                {acting && acting.id === r.id && acting.kind === 'custody' && (
                  <tr>
                    <td colSpan={DSC_COLUMNS.length}>
                      <form className="k-formpanel" onSubmit={e => submitMove(e, r.id)}>
                        <h3 className="k-section__title">Where is {r.holder_name}’s token?</h3>
                        <div className="k-formpanel__grid k-formpanel__grid--3">
                          <label className="k-formpanel__label">
                            <span>It is now *</span>
                            <select className="k-formpanel__input" value={move.custody_status}
                              onChange={e => setMove({ ...move, custody_status: e.target.value })}>
                              {CUSTODY_STATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                          </label>
                          <label className="k-formpanel__label">
                            <span>Since</span>
                            {/* When the CURRENT state began. Without it,
                                "with the client" is undated and nobody can tell
                                a token returned last week from one returned in
                                2023. Defaults to today; tomorrow is refused. */}
                            <DateInput type="date" className="k-formpanel__input"
                              value={move.changed_on}
                              onChange={e => setMove({ ...move, changed_on: e.target.value })} />
                          </label>
                          <label className="k-formpanel__label">
                            <span>Location</span>
                            <input className="k-formpanel__input" value={move.custody_location}
                              onChange={e => setMove({ ...move, custody_location: e.target.value })} />
                          </label>
                          <label className="k-formpanel__label">
                            <span>Held by</span>
                            <input className="k-formpanel__input" value={move.custody_holder_name}
                              onChange={e => setMove({ ...move, custody_holder_name: e.target.value })} />
                          </label>
                          <label className="k-formpanel__label mn-fw">
                            <span>Note</span>
                            <input className="k-formpanel__input" value={move.note}
                              onChange={e => setMove({ ...move, note: e.target.value })} />
                          </label>
                        </div>
                        <p className="mn-quote">
                          Anything but “with the firm” blocks a filing exactly as
                          hard as an expiry, and this row will say so the moment
                          it is recorded.
                        </p>
                        <div className="k-formpanel__actions">
                          <button type="button" className="k-btn k-btn--ghost"
                            onClick={() => setActing(null)}>Cancel</button>
                          <button type="submit" className="k-btn k-btn--primary"
                            disabled={busy === r.id || !canWrite} title={denial || undefined}>
                            {busy === r.id ? 'Recording…' : 'Record custody'}
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
    </div>
  );
}
