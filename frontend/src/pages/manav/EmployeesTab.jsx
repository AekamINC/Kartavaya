// Manav → Employees. The personnel directory and one employee's file.
//
// ── The link between a personnel record and a login ──────────────────────────
//
// An employee row carries a `user_id`, and it is the only thing joining the
// person HR typed into this form to an account that can sign in. Nothing in the
// product could set it. Measured against the live database: 81 employee records
// across 3 organisations, 0 with a user_id — and the reason nobody noticed is
// this screen. An unlinked employee rendered EXACTLY like a linked one: same
// row, same six columns, no mention of a login anywhere on the detail page.
//
// Meanwhile the person signs in and the product does not know who they are.
// Clock-in answers "Your account is not linked to an employee record", their own
// payslip is not theirs, their attendance is empty, and leave has nobody to
// apply as. Every one of those reads as a broken feature rather than as missing
// data, because the data that is missing was never shown.
//
// So: the directory carries a Login column and a filter for it, the count of
// unlinked records is stated above the table rather than left to be counted by
// eye, and the detail page has a panel that makes the link. The panel does NOT
// invite anybody — `POST /api/v1/org/invites` is the one place in the product
// that puts a person into an organisation and it counts seats while it does. A
// second door into that would be a second seat counter.
//
// 87 inline styles, the most of any file in this module. Every one of them was
// a literal that already existed as a token or a class: the form grid is
// `k-formpanel__grid--3`, the table is `.tbl` (through `<DataTable>`, which
// used to render `.k-modtable` and now renders the one table system), the
// detail pane is
// `k-detail`. None of the literals tracked the Text size or Border radius
// preferences.
//
// ── The defect that mattered more than the styling ───────────────────────────
//
// `load()` was `catch { pushToast(…) }` with `employees` left at `[]`, and the
// render branched on `employees.length === 0` to print "No employees yet — add
// your team members". So a 500, a dropped connection or a permission refusal
// all rendered as a confident statement that this organisation employs nobody,
// under a toast that had already faded. On a personnel directory that is not a
// cosmetic bug. It now goes through `useList`, which cannot collapse the two.
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Empty, BackButton, DataTable, Td } from '../../components/editorial';
import useModuleWrite from '../../hooks/useModuleWrite';
import { Secondary } from '../../components/Bilingual';
import {
  Badge, EMP_TYPES, STATUS_COLORS,
  useList, useResource, ErrorNote, Shim, errText,
} from './_shared';

const BLANK = {
  name: '', email: '', phone: '', employee_code: '', department: '', designation: '',
  date_of_joining: '', date_of_birth: '', gender: '', employment_type: 'full_time',
  pan: '', aadhaar: '', shift: 'general',
  // ── The statutory block ────────────────────────────────────────────────────
  //
  // Payroll deducts provident fund and ESI, prints both on the payslip, and
  // attaches an advisory telling the admin to set the missing identifier at
  // "Manav → Employees → the employee's record". This form IS that record, and
  // until now it had no input for any of the three: the columns existed, the
  // API accepted them, and there was nowhere to type them. Measured on the
  // shared database before this was built — 0 of 81 employees with a UAN, 0
  // with an ESI number, 1 with a bank account, and 720 payslips marked
  // disbursed against employees with no account on file.
  //
  // `bank_details` is a nested object because that is the column's shape.
  uan: '', esi_number: '',
  bank_details: { bank_name: '', account_number: '', ifsc: '' },
};

/** The problems a 422 from the statutory validator carries, as one line each.
 *
 *  The backend refuses a malformed identifier rather than storing it, and
 *  returns every problem at once — see `services/statutory_ids.py`. A toast
 *  that said only "the employee could not be added" would throw away the part
 *  that tells the admin WHICH of the three numbers is wrong and why. */
function statutoryProblems(err) {
  const d = err?.response?.data?.detail ?? err?.response?.data;
  if (d?.error !== 'statutory_identifier_invalid') return null;
  return (d.problems || []).map(p => `${p.label}: ${p.message}`);
}

export default function EmployeesTab({ onUpdate }) {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change HR records' });
  const { pushToast } = useToast();
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  // The applied query, not the typed one — the list re-fetches when the person
  // presses Filter or Enter, not on every keystroke.
  const [query, setQuery] = useState({ search: '', department: '', linked: '' });
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [detailId, setDetailId] = useState(null);

  const url = buildUrl(query);
  const list = useList(url, [url]);

  // Applied on change, not on Filter, and deliberately unlike the two text
  // inputs beside it. A select has no "and now press Enter" — leaving its value
  // showing "Not linked" over a directory that has not been filtered is the
  // failure mode, and it is a silent one.
  function setLinked(value) {
    setQuery(q => ({ ...q, linked: value }));
  }

  function applyFilter() {
    setQuery(q => ({ ...q, search, department: deptFilter }));
  }

  // Counted over the rows actually on screen, and worded that way. The endpoint
  // caps at 500, so "3 of the 60 shown" is true whether or not the list was
  // truncated, where "3 of 60 employees" would not be.
  const shown = list.items || [];
  const unlinkedShown = shown.filter(e => !e.user_id).length;

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/manav/employees', form);
      pushToast({ title: 'Employee added', type: 'success' });
      setShowForm(false);
      setForm(BLANK);
      list.reload();
      onUpdate?.();
    } catch (err) {
      const problems = statutoryProblems(err);
      if (problems) {
        // One toast per bad identifier. The whole point of refusing rather than
        // storing is that the admin can correct it, and they cannot correct
        // what they were not told.
        problems.forEach(title => pushToast({ title, type: 'error' }));
      } else {
        pushToast({ title: errText(err, 'The employee could not be added.'), type: 'error' });
      }
    } finally { setSaving(false); }
  }

  /** Set one key inside the nested `bank_details` object. */
  function setBank(key, value) {
    setForm(f => ({ ...f, bank_details: { ...f.bank_details, [key]: value } }));
  }

  if (detailId) {
    return (
      <EmployeeDetail
        id={detailId}
        onBack={() => { setDetailId(null); list.reload(); }}
        onChanged={() => { list.reload(); onUpdate?.(); }}
      />
    );
  }

  return (
    <div>
      <div className="mn-bar">
        <input
          className="k-input mn-f--grow"
          placeholder="Search employees…"
          aria-label="Search employees by name or code"
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && applyFilter()}
        />
        <input
          className="k-input mn-f"
          placeholder="Department"
          aria-label="Filter by department"
          value={deptFilter}
          onChange={e => setDeptFilter(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && applyFilter()}
        />
        <select
          className="k-input mn-f"
          aria-label="Filter by login"
          value={query.linked}
          onChange={e => setLinked(e.target.value)}
        >
          <option value="">All logins</option>
          <option value="no">No login linked</option>
          <option value="yes">Login linked</option>
        </select>
        <button type="button" className="k-btn k-btn--ghost" onClick={applyFilter}>Filter</button>
        <div className="mn-bar__gap" />
        <button type="button" className="k-btn k-btn--primary" onClick={() => setShowForm(true)}
          disabled={!canWrite} title={denial || undefined}>
          + Add employee
        </button>
      </div>

      {showForm && (
        <form onSubmit={save} className="k-formpanel">
          <h3 className="k-section__title">New employee</h3>
          <div className="k-formpanel__grid k-formpanel__grid--3">
            <Field label="Name *">
              <input className="k-formpanel__input" required value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Employee code">
              <input className="k-formpanel__input" placeholder="e.g. EMP001" value={form.employee_code}
                onChange={e => setForm({ ...form, employee_code: e.target.value })} />
            </Field>
            <Field label="Email">
              <input className="k-formpanel__input" type="email" value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Phone">
              <input className="k-formpanel__input" value={form.phone}
                onChange={e => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="Department">
              <input className="k-formpanel__input" value={form.department}
                onChange={e => setForm({ ...form, department: e.target.value })} />
            </Field>
            <Field label="Designation">
              <input className="k-formpanel__input" value={form.designation}
                onChange={e => setForm({ ...form, designation: e.target.value })} />
            </Field>
            <Field label="Employment type">
              <select className="k-formpanel__input" value={form.employment_type}
                onChange={e => setForm({ ...form, employment_type: e.target.value })}>
                {EMP_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
              </select>
            </Field>
            <Field label="Date of joining">
              <input className="k-formpanel__input" type="date" value={form.date_of_joining}
                onChange={e => setForm({ ...form, date_of_joining: e.target.value })} />
            </Field>
            <Field label="Date of birth">
              <input className="k-formpanel__input" type="date" value={form.date_of_birth}
                onChange={e => setForm({ ...form, date_of_birth: e.target.value })} />
            </Field>
            <Field label="Gender">
              <select className="k-formpanel__input" value={form.gender}
                onChange={e => setForm({ ...form, gender: e.target.value })}>
                <option value="">—</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label="PAN">
              <input className="k-formpanel__input" value={form.pan}
                onChange={e => setForm({ ...form, pan: e.target.value })} />
            </Field>
            <Field label="Aadhaar">
              <input className="k-formpanel__input" value={form.aadhaar}
                onChange={e => setForm({ ...form, aadhaar: e.target.value })} />
            </Field>
          </div>

          <h3 className="k-section__title">
            Statutory and salary account
            <Secondary className="k-section__title-hi" value="वैधानिक विवरण" />
          </h3>
          <div className="k-formpanel__grid k-formpanel__grid--3">
            <Field label="UAN">
              <input className="k-formpanel__input" value={form.uan} inputMode="numeric"
                placeholder="12 digits" aria-describedby="emp-uan-help"
                onChange={e => setForm({ ...form, uan: e.target.value })} />
            </Field>
            <Field label="ESI insurance number">
              <input className="k-formpanel__input" value={form.esi_number} inputMode="numeric"
                placeholder="10 digits" aria-describedby="emp-esi-help"
                onChange={e => setForm({ ...form, esi_number: e.target.value })} />
            </Field>
            <Field label="Bank name">
              <input className="k-formpanel__input" value={form.bank_details.bank_name}
                onChange={e => setBank('bank_name', e.target.value)} />
            </Field>
            <Field label="Account number">
              <input className="k-formpanel__input" value={form.bank_details.account_number}
                inputMode="numeric" placeholder="as issued by the bank"
                onChange={e => setBank('account_number', e.target.value)} />
            </Field>
            <Field label="IFSC">
              <input className="k-formpanel__input" value={form.bank_details.ifsc}
                placeholder="e.g. HDFC0001234" autoCapitalize="characters"
                onChange={e => setBank('ifsc', e.target.value)} />
            </Field>
          </div>
          <p className="note note--info" id="emp-uan-help">
            The UAN is 12 digits and the ESI insurance number is 10 — the
            employee&rsquo;s own numbers, not the establishment codes. A number
            in the wrong format is refused rather than saved: provident fund and
            ESI are filed against these, and a wrong number credits somebody
            else, which is harder to undo than a blank one.
          </p>
          <p className="note note--info" id="emp-esi-help">
            PAN, Aadhaar and the account number are stored masked and are shown
            in full only to an org owner or admin. Every reveal is written to
            the audit log.
          </p>
          <div className="k-formpanel__actions">
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving || !canWrite} title={denial || undefined}>
              {saving ? 'Adding…' : 'Add employee'}
            </button>
          </div>
        </form>
      )}

      {/* Only when the request SUCCEEDED and the rows say so. Rendering this
          from a failed fetch would be the same defect the module was rebuilt
          around, wearing a different sentence. */}
      {/* NOT `role="status"`, deliberately. `ErrorNote` is the module's live
          region and the tests locate it as "the first [role=status]" — a second
          one above the table makes a successful load look like a failed one to
          anything reading the page that way, and it announces on every render
          of a condition that is not a change. It is a sentence above a table,
          in document order, next to the column that says the same thing. */}
      {!list.loading && !list.error && unlinkedShown > 0 && (
        <div className="note note--warn mn-nolink">
          <b>{unlinkedShown} of the {shown.length} employees shown have no login linked.</b>{' '}
          They cannot clock in, open their own payslip, apply for leave or see
          their own attendance. Open a record to link it to an account.
          {query.linked !== 'no' && (
            <button type="button" className="k-btn k-btn--ghost mn-nolink__go"
              onClick={() => setLinked('no')}>
              Show only these
            </button>
          )}
        </div>
      )}

      {list.loading ? <Shim count={6} />
        : list.error ? <ErrorNote what="The employee directory" error={list.error} onRetry={list.reload} />
          : list.items.length === 0 ? (
            <Empty
              icon="👥"
              title={query.search || query.department || query.linked
                ? 'No employees match that filter'
                : 'No employees yet'}
              sub={query.search || query.department || query.linked
                ? 'Clear the search, department and login filters to see the whole directory.'
                : 'Add your team members to manage attendance, leave and payroll from one place.'}
            />
          ) : (
            <DataTable columns={['Code', 'Name', 'Department', 'Designation', 'Type', 'Login', 'Status']}>
              {list.items.map(e => (
                <tr
                  key={e.id}
                  className="mn-t__row--click"
                  onClick={() => setDetailId(e.id)}
                  tabIndex={0}
                  role="button"
                  aria-label={`Open ${e.name}${e.user_id ? '' : ' — no login linked'}`}
                  onKeyDown={ev => {
                    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setDetailId(e.id); }
                  }}
                >
                  <Td className="mn-t__mono">{e.employee_code || '—'}</Td>
                  <Td bold>{e.name}</Td>
                  <Td className="mn-t__mute">{e.department || '—'}</Td>
                  <Td className="mn-t__mute">{e.designation || '—'}</Td>
                  <Td>{e.employment_type?.replace(/_/g, ' ')}</Td>
                  {/* The column that did not exist. A badge either way, never a
                      blank cell for the unlinked case: an empty cell reads as
                      "not filled in yet", and this is a state, not a field. */}
                  <Td>
                    {e.user_id
                      ? <Badge text="linked" color="var(--ok)" />
                      : <Badge text="no login" color="var(--warn)" />}
                  </Td>
                  <Td><Badge text={e.status} color={STATUS_COLORS[e.status] || 'var(--on-surface-3)'} /></Td>
                </tr>
              ))}
            </DataTable>
          )}
    </div>
  );
}

function buildUrl({ search, department, linked }) {
  const p = new URLSearchParams();
  if (search) p.set('search', search);
  if (department) p.set('department', department);
  // Only `yes`/`no` are accepted by the endpoint, which answers 400 to anything
  // else rather than returning the unfiltered directory. The select cannot
  // produce a third value, so this is the belt to that braces.
  if (linked === 'yes' || linked === 'no') p.set('linked', linked);
  const q = p.toString();
  return `/v1/manav/employees${q ? `?${q}` : ''}`;
}

/** A labelled form control. `k-formpanel__label` is already a flex column, so
 *  the label text and the control are siblings rather than a nested span. */
function Field({ label, children, wide }) {
  return (
    <label className={`k-formpanel__label${wide ? ' mn-fw' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   One employee
   ══════════════════════════════════════════════════════════════════════════ */

function EmployeeDetail({ id, onBack, onChanged }) {
  // F32 — this component owns its own write controls, so it asks
  // the same question rather than taking the answer as a prop.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change HR records' });
  const { pushToast } = useToast();
  const res = useResource(`/v1/manav/employees/${id}`, [id]);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [editSaving, setEditSaving] = useState(false);
  // Aadhaar, PAN and the bank account arrive masked. The full values come from
  // a separate endpoint only org owners/admins may call, and every read of it
  // is audited — so this stays null until explicitly asked for.
  const [pii, setPii] = useState(null);
  const [piiLoading, setPiiLoading] = useState(false);

  function startEdit(emp) {
    setEditForm({
      name: emp.name || '', email: emp.email || '', phone: emp.phone || '',
      department: emp.department || '', designation: emp.designation || '',
      employment_type: emp.employment_type || 'full_time',
      // The statutory block. This is the form the payslip advisory names when
      // it says "Manav → Employees → the employee's record", so it is the one
      // that has to be able to set these.
      uan: emp.uan || '', esi_number: emp.esi_number || '',
      bank_name: emp.bank_details?.bank_name || '',
      ifsc: emp.bank_details?.ifsc || '',
      // DELIBERATELY BLANK, and never prefilled from `emp`. The detail endpoint
      // masks the account number, so `emp.bank_details.account_number` is
      // "••••4821" — the glyphs, not the digits. Prefilling that and PATCHing
      // it back would write the mask over the only copy of the account number,
      // in a save that reports success and surfaces months later as a failed
      // salary credit. Blank means "leave the stored account alone"; the PATCH
      // merges rather than replaces, so omitting it preserves it, and the
      // backend refuses a value containing the mask glyph as a second lock.
      account_number: '',
    });
    setEditing(true);
  }

  async function saveEdit(e) {
    e.preventDefault();
    setEditSaving(true);
    try {
      const { bank_name, ifsc, account_number, ...rest } = editForm;
      const bank = {};
      if (bank_name !== '') bank.bank_name = bank_name;
      if (ifsc !== '') bank.ifsc = ifsc;
      // Only when the admin actually typed a number. See `startEdit`.
      if (account_number !== '') bank.account_number = account_number;
      const payload = Object.keys(bank).length ? { ...rest, bank_details: bank } : rest;

      await api.patch(`/v1/manav/employees/${id}`, payload);
      pushToast({ title: 'Employee updated', type: 'success' });
      setEditing(false);
      res.reload();
      onChanged?.();
    } catch (err) {
      const problems = statutoryProblems(err);
      if (problems) {
        problems.forEach(title => pushToast({ title, type: 'error' }));
      } else {
        pushToast({ title: errText(err, 'The employee could not be updated.'), type: 'error' });
      }
    } finally { setEditSaving(false); }
  }

  async function revealPii() {
    setPiiLoading(true);
    try {
      const r = await api.get(`/v1/manav/employees/${id}/sensitive`);
      setPii(r.data.employee);
    } catch (err) {
      pushToast({
        title: err?.response?.status === 403
          ? 'Only an org owner or admin can view identity documents'
          : errText(err, 'The identity documents could not be revealed.'),
        type: 'error',
      });
    } finally { setPiiLoading(false); }
  }

  if (res.loading) return <><BackButton onClick={onBack} label="Back to list" /><Shim count={5} /></>;
  if (res.error) {
    return (
      <div>
        <BackButton onClick={onBack} label="Back to list" />
        <ErrorNote what="This employee" error={res.error} onRetry={res.reload} />
      </div>
    );
  }

  const emp = res.data?.employee;
  if (!emp) {
    return (
      <div>
        <BackButton onClick={onBack} label="Back to list" />
        <ErrorNote
          what="This employee"
          error="The record came back without an employee. It may have been removed."
          onRetry={res.reload}
        />
      </div>
    );
  }

  const balances = res.data.leave_balances || [];

  return (
    <div>
      <BackButton onClick={onBack} label="Back to list" />

      <div className="k-detail">
        <div className="k-detail__header">
          <div>
            <h3 className="k-detail__title">{emp.name}</h3>
            <p className="k-detail__sub">
              {emp.employee_code && `${emp.employee_code} · `}
              {emp.designation}
              {emp.department && ` · ${emp.department}`}
            </p>
          </div>
          <div className="mn-rec__end">
            <Badge text={emp.status} color={STATUS_COLORS[emp.status] || 'var(--on-surface-3)'} />
            {!editing && (
              <button type="button" className="k-btn k-btn--ghost" onClick={() => startEdit(emp)}>Edit</button>
            )}
          </div>
        </div>

        {editing && (
          <form onSubmit={saveEdit} className="k-formpanel">
            <div className="k-formpanel__grid k-formpanel__grid--3">
              <Field label="Name">
                <input className="k-formpanel__input" value={editForm.name}
                  onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
              </Field>
              <Field label="Email">
                <input className="k-formpanel__input" type="email" value={editForm.email}
                  onChange={e => setEditForm({ ...editForm, email: e.target.value })} />
              </Field>
              <Field label="Phone">
                <input className="k-formpanel__input" value={editForm.phone}
                  onChange={e => setEditForm({ ...editForm, phone: e.target.value })} />
              </Field>
              <Field label="Department">
                <input className="k-formpanel__input" value={editForm.department}
                  onChange={e => setEditForm({ ...editForm, department: e.target.value })} />
              </Field>
              <Field label="Designation">
                <input className="k-formpanel__input" value={editForm.designation}
                  onChange={e => setEditForm({ ...editForm, designation: e.target.value })} />
              </Field>
              <Field label="Employment type">
                <select className="k-formpanel__input" value={editForm.employment_type}
                  onChange={e => setEditForm({ ...editForm, employment_type: e.target.value })}>
                  {EMP_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                </select>
              </Field>
            </div>

            <h3 className="k-section__title">
              Statutory and salary account
              <Secondary className="k-section__title-hi" value="वैधानिक विवरण" />
            </h3>
            <div className="k-formpanel__grid k-formpanel__grid--3">
              <Field label="UAN">
                <input className="k-formpanel__input" value={editForm.uan} inputMode="numeric"
                  placeholder="12 digits"
                  onChange={e => setEditForm({ ...editForm, uan: e.target.value })} />
              </Field>
              <Field label="ESI insurance number">
                <input className="k-formpanel__input" value={editForm.esi_number} inputMode="numeric"
                  placeholder="10 digits"
                  onChange={e => setEditForm({ ...editForm, esi_number: e.target.value })} />
              </Field>
              <Field label="Bank name">
                <input className="k-formpanel__input" value={editForm.bank_name}
                  onChange={e => setEditForm({ ...editForm, bank_name: e.target.value })} />
              </Field>
              <Field label="Account number">
                <input
                  className="k-formpanel__input"
                  value={editForm.account_number}
                  inputMode="numeric"
                  placeholder={emp.bank_details?.account_number
                    ? `${emp.bank_details.account_number} on file — type to replace`
                    : 'not on file'}
                  onChange={e => setEditForm({ ...editForm, account_number: e.target.value })}
                />
              </Field>
              <Field label="IFSC">
                <input className="k-formpanel__input" value={editForm.ifsc}
                  placeholder="e.g. HDFC0001234" autoCapitalize="characters"
                  onChange={e => setEditForm({ ...editForm, ifsc: e.target.value })} />
              </Field>
            </div>
            <p className="note note--info">
              Leave the account number blank to keep the one already on file —
              it is shown masked, so what you can see is not the number itself.
              The UAN is 12 digits and the ESI insurance number is 10; a value
              in the wrong format is refused rather than saved.
            </p>

            <div className="k-formpanel__actions">
              <button type="button" className="k-btn k-btn--ghost" onClick={() => setEditing(false)}>Cancel</button>
              <button type="submit" className="k-btn k-btn--primary" disabled={editSaving || !canWrite} title={denial || undefined}>
                {editSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        )}

        <dl className="mn-facts">
          <Fact k="Email" v={emp.email} />
          <Fact k="Phone" v={emp.phone} />
          <Fact k="Type" v={emp.employment_type?.replace(/_/g, ' ')} />
          <Fact k="Joining" v={emp.date_of_joining} />
          <Fact k="Date of birth" v={emp.date_of_birth} />
          <Fact k="Gender" v={emp.gender} />
          <Fact k="PAN" v={pii ? pii.pan : emp.pan} mono />
          <Fact k="Aadhaar" v={pii ? pii.aadhaar : emp.aadhaar} mono />
          <Fact k="UAN" v={emp.uan} mono />
          <Fact k="ESI number" v={emp.esi_number} mono />
          <Fact k="Bank" v={emp.bank_details?.bank_name} />
          <Fact
            k="Account"
            v={pii ? pii.bank_details?.account_number : emp.bank_details?.account_number}
            mono
          />
          <Fact k="IFSC" v={emp.bank_details?.ifsc} mono />
          <Fact k="Shift" v={emp.shift} />
          <Fact k="Blood group" v={emp.blood_group} />
        </dl>

        {(emp.pan || emp.aadhaar || emp.bank_details?.account_number) && (
          <div className="mn-pii">
            {pii ? (
              <>
                <span className="mn-pii__note">
                  Identity documents shown in full. This access was written to the audit log.
                </span>
                <button type="button" className="k-btn k-btn--ghost" onClick={() => setPii(null)}>Hide</button>
              </>
            ) : (
              <>
                <span className="mn-pii__note">
                  Identity documents are masked. Revealing them is recorded in the audit log
                  against your name.
                </span>
                <button type="button" className="k-btn k-btn--ghost" disabled={piiLoading} onClick={revealPii}>
                  {piiLoading ? 'Revealing…' : 'Reveal'}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <LoginPanel
        id={id}
        name={emp.name}
        login={res.data?.login || null}
        onChanged={() => { res.reload(); onChanged?.(); }}
      />

      {balances.length > 0 && (
        <section className="k-section">
          <div className="k-section__head">
            <h3 className="k-section__title">
              Leave balances<Secondary className="k-section__title-hi" value="अवकाश शेष" />
            </h3>
          </div>
          <DataTable columns={[
            'Leave type',
            { label: 'Allocated', align: 'right' },
            { label: 'Used', align: 'right' },
            { label: 'Carried', align: 'right' },
            { label: 'Available', align: 'right' },
          ]}>
            {balances.map(lb => (
              <tr key={lb.id}>
                <td>{lb.leave_name} <span className="mn-t__mute">({lb.leave_code})</span></td>
                <Td align="right" mono>{lb.allocated}</Td>
                <Td align="right" mono><span className="mn-t__n" style={{ '--c': 'var(--danger)' }}>{lb.used}</span></Td>
                <Td align="right" mono>{lb.carried_forward}</Td>
                <Td align="right" mono bold>
                  <span className="mn-t__n" style={{ '--c': 'var(--ok)' }}>
                    {(Number(lb.allocated) + Number(lb.carried_forward)) - Number(lb.used)}
                  </span>
                </Td>
              </tr>
            ))}
          </DataTable>
        </section>
      )}
    </div>
  );
}

function Fact({ k, v, mono }) {
  return (
    <div>
      <dt className="mn-fact__k">{k}</dt>
      <dd className={`mn-fact__v${mono ? ' mn-fact__v--mono' : ''}`}>{v || '—'}</dd>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Login access — the join between this record and an account
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * States a record's link, and offers the one action that changes it.
 *
 * The unlinked case is a `note--warn` and not a quiet dash, because it is the
 * state the whole product is currently in and it has consequences the HR admin
 * cannot otherwise see: an unlinked employee's clock-in is refused, their
 * payslip is not theirs, and every self-service screen answers as though the
 * organisation employs nobody. That is a sentence worth printing.
 */
function LoginPanel({ id, name, login, onChanged }) {
  // F32 — declared here, not taken as a prop. `check-classes`' sibling gate
  // exists because a `canWrite` closed over from a parent function is a
  // ReferenceError that builds cleanly and white-screens only this panel.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change HR records' });
  const { pushToast } = useToast();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  async function unlink() {
    setBusy(true);
    try {
      await api.delete(`/v1/manav/employees/${id}/link`);
      pushToast({ title: 'Login unlinked', type: 'success' });
      onChanged?.();
    } catch (err) {
      pushToast({ title: errText(err, 'The login could not be unlinked.'), type: 'error' });
    } finally { setBusy(false); }
  }

  return (
    <section className="k-section">
      <div className="k-section__head">
        <h3 className="k-section__title">
          Login access<Secondary className="k-section__title-hi" value="लॉगिन" />
        </h3>
      </div>

      {login ? (
        <div className={`note ${login.missing ? 'note--warn' : 'note--info'} mn-nolink`}>
          {login.missing ? (
            <>
              <b>This record points at an account that no longer exists.</b>{' '}
              Nothing signs in as {name}. Unlink it and link a current account.
            </>
          ) : (
            <>
              <b>{login.full_name || login.email || login.user_id}</b> signs in as
              this employee{login.email && login.full_name ? ` (${login.email})` : ''}.
              They can clock in, open their payslips, see their attendance and
              apply for leave.
            </>
          )}
          <button type="button" className="k-btn k-btn--ghost mn-nolink__go"
            onClick={unlink} disabled={busy || !canWrite} title={denial || undefined}>
            {busy ? 'Unlinking…' : 'Unlink'}
          </button>
        </div>
      ) : (
        <>
          {/* Same reasoning as the directory banner above: this is a fact about
              the record, sitting in its own section, not a status change. */}
          <div className="note note--warn mn-nolink">
            <b>No login is linked to this record.</b>{' '}
            {name} cannot clock in, open a payslip, see their own attendance or
            apply for leave — every one of those answers as though this record
            does not exist.
            {!picking && (
              <button type="button" className="k-btn k-btn--ghost mn-nolink__go"
                onClick={() => setPicking(true)} disabled={!canWrite} title={denial || undefined}>
                Link an account
              </button>
            )}
          </div>
          {picking && (
            <LinkPicker
              id={id}
              onCancel={() => setPicking(false)}
              onLinked={() => { setPicking(false); onChanged?.(); }}
            />
          )}
        </>
      )}
    </section>
  );
}

/**
 * Picks the account to link, from the members this organisation already has.
 *
 * Mounted only while the picker is open, so opening a personnel file does not
 * fetch the whole member list of the organisation on the chance that somebody
 * might link it.
 *
 * Accounts already held by another employee are LISTED and disabled, naming who
 * holds them. Hiding them leaves an admin unable to tell "they have no account"
 * from "their account is on the wrong record", and those two have opposite
 * remedies — invite them, versus go and unlink the other record.
 */
function LinkPicker({ id, onCancel, onLinked }) {
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change HR records' });
  const { pushToast } = useToast();
  const list = useList('/v1/manav/employees/link-candidates', []);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);

  async function link(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post(`/v1/manav/employees/${id}/link`, { user_id: choice });
      pushToast({ title: `Linked to ${r.data?.email || r.data?.full_name || 'the account'}`, type: 'success' });
      onLinked?.();
    } catch (err) {
      // The server's own words win. It answers a refusal with the name of the
      // employee already holding the account, or with where to send an
      // invitation — replacing that with "could not link" throws away the only
      // text that says what to do next.
      pushToast({ title: errText(err, 'The account could not be linked.'), type: 'error' });
    } finally { setBusy(false); }
  }

  if (list.loading) return <Shim count={2} />;
  if (list.error) {
    return <ErrorNote what="The list of accounts" error={list.error} onRetry={list.reload} />;
  }

  const free = list.items.filter(c => !c.linked_employee_id);

  return (
    <form onSubmit={link} className="k-formpanel">
      <Field label="Account" wide>
        <select className="k-formpanel__input" value={choice} required
          onChange={e => setChoice(e.target.value)}>
          <option value="">Choose an account…</option>
          {list.items.map(c => (
            <option key={c.user_id} value={c.user_id} disabled={!!c.linked_employee_id}>
              {c.full_name || c.email || c.user_id}
              {c.email && c.full_name ? ` · ${c.email}` : ''}
              {c.linked_employee_id ? ` — already linked to ${c.linked_employee_name}` : ''}
            </option>
          ))}
        </select>
      </Field>
      <p className="note note--info">
        {free.length === 0
          ? `Every account in this organisation is already linked to an employee.
             This person needs one of their own — invite them from
             Settings → Members. The invitation is what creates the login;
             come back here once they have accepted it.`
          : `Only people who already have an account in this organisation appear
             here. If this employee is not among them, invite them from
             Settings → Members first — linking does not create an account, send
             an email or grant anything.`}
      </p>
      <div className="k-formpanel__actions">
        <button type="button" className="k-btn k-btn--ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="k-btn k-btn--primary"
          disabled={busy || !choice || !canWrite} title={denial || undefined}>
          {busy ? 'Linking…' : 'Link account'}
        </button>
      </div>
    </form>
  );
}
