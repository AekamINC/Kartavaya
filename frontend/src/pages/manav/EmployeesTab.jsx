// Manav → Employees. The personnel directory and one employee's file.
//
// 87 inline styles, the most of any file in this module. Every one of them was
// a literal that already existed as a token or a class: the form grid is
// `k-formpanel__grid--3`, the table is `k-modtable`, the detail pane is
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
import {
  Badge, EMP_TYPES, STATUS_COLORS,
  useList, useResource, ErrorNote, Shim, errText,
} from './_shared';

const BLANK = {
  name: '', email: '', phone: '', employee_code: '', department: '', designation: '',
  date_of_joining: '', date_of_birth: '', gender: '', employment_type: 'full_time',
  pan: '', aadhaar: '', shift: 'general',
};

export default function EmployeesTab({ onUpdate }) {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change HR records' });
  const { pushToast } = useToast();
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  // The applied query, not the typed one — the list re-fetches when the person
  // presses Filter or Enter, not on every keystroke.
  const [query, setQuery] = useState({ search: '', department: '' });
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [detailId, setDetailId] = useState(null);

  const url = buildUrl(query);
  const list = useList(url, [url]);

  function applyFilter() { setQuery({ search, department: deptFilter }); }

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
      pushToast({ title: errText(err, 'The employee could not be added.'), type: 'error' });
    } finally { setSaving(false); }
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
          <p className="note note--info">
            PAN and Aadhaar are stored masked and are shown in full only to an
            org owner or admin. Every reveal is written to the audit log.
          </p>
          <div className="k-formpanel__actions">
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving || !canWrite} title={denial || undefined}>
              {saving ? 'Adding…' : 'Add employee'}
            </button>
          </div>
        </form>
      )}

      {list.loading ? <Shim count={6} />
        : list.error ? <ErrorNote what="The employee directory" error={list.error} onRetry={list.reload} />
          : list.items.length === 0 ? (
            <Empty
              icon="👥"
              title={query.search || query.department ? 'No employees match that filter' : 'No employees yet'}
              sub={query.search || query.department
                ? 'Clear the search and department filters to see the whole directory.'
                : 'Add your team members to manage attendance, leave and payroll from one place.'}
            />
          ) : (
            <DataTable columns={['Code', 'Name', 'Department', 'Designation', 'Type', 'Status']}>
              {list.items.map(e => (
                <tr
                  key={e.id}
                  className="mn-t__row--click"
                  onClick={() => setDetailId(e.id)}
                  tabIndex={0}
                  role="button"
                  aria-label={`Open ${e.name}`}
                  onKeyDown={ev => {
                    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setDetailId(e.id); }
                  }}
                >
                  <Td className="mn-t__mono">{e.employee_code || '—'}</Td>
                  <Td bold>{e.name}</Td>
                  <Td className="mn-t__mute">{e.department || '—'}</Td>
                  <Td className="mn-t__mute">{e.designation || '—'}</Td>
                  <Td>{e.employment_type?.replace(/_/g, ' ')}</Td>
                  <Td><Badge text={e.status} color={STATUS_COLORS[e.status] || 'var(--on-surface-3)'} /></Td>
                </tr>
              ))}
            </DataTable>
          )}
    </div>
  );
}

function buildUrl({ search, department }) {
  const p = new URLSearchParams();
  if (search) p.set('search', search);
  if (department) p.set('department', department);
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
    });
    setEditing(true);
  }

  async function saveEdit(e) {
    e.preventDefault();
    setEditSaving(true);
    try {
      await api.patch(`/v1/manav/employees/${id}`, editForm);
      pushToast({ title: 'Employee updated', type: 'success' });
      setEditing(false);
      res.reload();
      onChanged?.();
    } catch (err) {
      pushToast({ title: errText(err, 'The employee could not be updated.'), type: 'error' });
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
          <Fact k="Shift" v={emp.shift} />
          <Fact k="Blood group" v={emp.blood_group} />
        </dl>

        {(emp.pan || emp.aadhaar) && (
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

      {balances.length > 0 && (
        <section className="k-section">
          <div className="k-section__head">
            <h3 className="k-section__title">
              Leave balances<span className="k-section__title-hi" lang="hi">अवकाश शेष</span>
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
