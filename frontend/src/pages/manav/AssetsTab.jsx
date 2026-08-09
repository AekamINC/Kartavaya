// Manav → Assets. Company equipment and who holds it.
//
// 66 inline styles, the second-largest count in the module, and the widest
// table: six columns of which one held an entire inline assign/return/delete
// control cluster with its own nested select.
//
// ── Defects beyond the styling ───────────────────────────────────────────────
//
// 1 · `load()` caught to a toast over `assets` left at `[]`, so a failed fetch
//     rendered "No assets found — track company assets like laptops, phones
//     and equipment". `loadEmployees()` was a bare `catch {}`.
//
// 2 · Delete was unconfirmed. One click on a row control permanently removed an
//     asset record — including its purchase cost and assignment history — with
//     no dialog. It now confirms, and says whether the asset is currently out
//     with somebody.
//
// 3 · The category filter ran client-side over whatever page had loaded, while
//     reading as though it filtered the collection. It still filters in the
//     browser (the route takes no category parameter — checked), but the empty
//     state now distinguishes "no assets at all" from "none in this category",
//     which is the case the old copy got wrong.
//
// 4 · The assign control was a `<select>` and two buttons captioned "OK" and
//     "X" rendered inline inside a table cell. "X" is not a word.
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Empty, DataTable, Td } from '../../components/editorial';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import useModuleWrite from '../../hooks/useModuleWrite';
import {
  Badge, ASSET_CATEGORIES, ASSET_CONDITIONS, CATEGORY_COLORS, CONDITION_COLORS,
  useList, ErrorNote, Shim, errText,
} from './_shared';
import DateInput from '../../components/ui/DateInput';

const BLANK = {
  asset_tag: '', name: '', category: 'laptop', serial_number: '',
  purchase_date: '', purchase_cost: '', condition: 'new', notes: '',
};

export default function AssetsTab() {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change HR records' });
  const { pushToast } = useToast();
  const list = useList('/v1/manav/assets');
  const employees = useList('/v1/manav/employees');
  const [catFilter, setCatFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [assigningId, setAssigningId] = useState(null);
  const [assignEmployee, setAssignEmployee] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(BLANK);
  const [editSaving, setEditSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState('');

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/manav/assets', {
        ...form, purchase_cost: parseFloat(form.purchase_cost) || 0,
      });
      pushToast({ title: 'Asset created', type: 'success' });
      setShowForm(false);
      setForm(BLANK);
      list.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'The asset could not be created.'), type: 'error' });
    } finally { setSaving(false); }
  }

  async function remove(id) {
    setBusy(id);
    try {
      await api.delete(`/v1/manav/assets/${id}`);
      pushToast({ title: 'Asset removed', type: 'success' });
      list.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'The asset could not be removed.'), type: 'error' });
    } finally { setBusy(''); }
  }

  async function assign(id) {
    if (!assignEmployee) return;
    setBusy(id);
    try {
      await api.post(`/v1/manav/assets/${id}/assign`, { employee_id: assignEmployee });
      pushToast({ title: 'Asset assigned', type: 'success' });
      setAssigningId(null);
      setAssignEmployee('');
      list.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'The asset could not be assigned.'), type: 'error' });
    } finally { setBusy(''); }
  }

  async function returnAsset(id) {
    setBusy(id);
    try {
      await api.post(`/v1/manav/assets/${id}/return`);
      pushToast({ title: 'Asset returned', type: 'success' });
      list.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'The asset could not be returned.'), type: 'error' });
    } finally { setBusy(''); }
  }

  function startEdit(a) {
    setEditingId(a.id);
    setEditForm({
      asset_tag: a.asset_tag || '', name: a.name || '', category: a.category || 'laptop',
      serial_number: a.serial_number || '', condition: a.condition || 'new',
      notes: a.notes || '', purchase_cost: a.purchase_cost ?? '',
      purchase_date: a.purchase_date || '',
    });
  }

  async function saveEdit(e) {
    e.preventDefault();
    setEditSaving(true);
    try {
      await api.patch(`/v1/manav/assets/${editingId}`, editForm);
      pushToast({ title: 'Asset updated', type: 'success' });
      setEditingId(null);
      list.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'The asset could not be updated.'), type: 'error' });
    } finally { setEditSaving(false); }
  }

  const all = list.items || [];
  const filtered = catFilter ? all.filter(a => a.category === catFilter) : all;

  return (
    <div>
      <div className="mn-bar">
        <label className="mn-field">
          <span className="mn-field__l">Category</span>
          <select className="k-input mn-f" value={catFilter}
            onChange={e => setCatFilter(e.target.value)}>
            <option value="">All categories</option>
            {ASSET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <div className="mn-bar__gap" />
        <button type="button" className="k-btn k-btn--primary" onClick={() => setShowForm(true)}
          disabled={!canWrite} title={denial || undefined}>
          + New asset
        </button>
      </div>

      {showForm && (
        <form onSubmit={save} className="k-formpanel">
          <h3 className="k-section__title">New asset</h3>
          <div className="k-formpanel__grid k-formpanel__grid--3">
            <label className="k-formpanel__label">
              <span>Asset tag *</span>
              <input className="k-formpanel__input" required placeholder="e.g. AST-001"
                value={form.asset_tag} onChange={e => setForm({ ...form, asset_tag: e.target.value })} />
            </label>
            <label className="k-formpanel__label">
              <span>Name *</span>
              <input className="k-formpanel__input" required value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="k-formpanel__label">
              <span>Category</span>
              <select className="k-formpanel__input" value={form.category}
                onChange={e => setForm({ ...form, category: e.target.value })}>
                {ASSET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="k-formpanel__label">
              <span>Serial number</span>
              <input className="k-formpanel__input" value={form.serial_number}
                onChange={e => setForm({ ...form, serial_number: e.target.value })} />
            </label>
            <label className="k-formpanel__label">
              <span>Purchase date</span>
              <DateInput className="k-formpanel__input" type="date" value={form.purchase_date}
                onChange={e => setForm({ ...form, purchase_date: e.target.value })} />
            </label>
            <label className="k-formpanel__label">
              <span>Purchase cost</span>
              <input className="k-formpanel__input" type="number" min="0" step="0.01"
                value={form.purchase_cost}
                onChange={e => setForm({ ...form, purchase_cost: e.target.value })} />
            </label>
            <label className="k-formpanel__label">
              <span>Condition</span>
              <select className="k-formpanel__input" value={form.condition}
                onChange={e => setForm({ ...form, condition: e.target.value })}>
                {ASSET_CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="k-formpanel__label mn-fw">
              <span>Notes</span>
              <input className="k-formpanel__input" value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })} />
            </label>
          </div>
          <div className="k-formpanel__actions">
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving || !canWrite} title={denial || undefined}>
              {saving ? 'Creating…' : 'Create asset'}
            </button>
          </div>
        </form>
      )}

      {employees.error && (
        <ErrorNote what="The employee list" error={employees.error} onRetry={employees.reload} />
      )}

      {list.loading ? <Shim count={5} />
        : list.error ? <ErrorNote what="The asset register" error={list.error} onRetry={list.reload} />
          : filtered.length === 0 ? (
            <Empty
              icon="💻"
              title={catFilter && all.length > 0 ? `No ${catFilter} assets` : 'No assets yet'}
              sub={catFilter && all.length > 0
                ? `${all.length} asset${all.length === 1 ? '' : 's'} are recorded in other categories. Clear the filter to see them.`
                : 'Track company equipment — laptops, phones, vehicles — and who currently holds each one.'}
            />
          ) : (
            <DataTable columns={['Tag', 'Name', 'Category', 'Condition', 'Assigned to', 'Actions']}>
              {filtered.map(a => (
                <React.Fragment key={a.id}>
                  <tr>
                    <Td className="mn-t__mono">{a.asset_tag || '—'}</Td>
                    <Td bold>{a.name}</Td>
                    <Td>
                      <Badge text={a.category} color={CATEGORY_COLORS[a.category] || 'var(--on-surface-3)'} />
                    </Td>
                    <Td>
                      <Badge text={a.condition} color={CONDITION_COLORS[a.condition] || 'var(--on-surface-3)'} />
                    </Td>
                    <Td className={a.employee_name ? undefined : 'mn-t__mute'}>
                      {a.employee_name || 'Unassigned'}
                    </Td>
                    <Td>
                      <div className="mn-rowact">
                        <button type="button" className="k-btn k-btn--ghost k-btn--sm"
                          onClick={() => startEdit(a)}>Edit</button>

                        {a.assigned_to ? (
                          <button type="button" className="k-btn k-btn--ghost k-btn--sm"
                            disabled={busy === a.id}
                            onClick={() => returnAsset(a.id)}>
                            {busy === a.id ? 'Returning…' : 'Return'}
                          </button>
                        ) : assigningId === a.id ? (
                          <span className="mn-rowact">
                            <select
                              className="k-input mn-f--sm"
                              aria-label={`Assign ${a.name} to`}
                              value={assignEmployee}
                              disabled={employees.loading || !!employees.error}
                              onChange={e => setAssignEmployee(e.target.value)}
                            >
                              <option value="">
                                {employees.loading ? 'Loading…' : employees.error ? 'Unavailable' : 'Select…'}
                              </option>
                              {(employees.items || []).map(emp => (
                                <option key={emp.id} value={emp.id}>{emp.name}</option>
                              ))}
                            </select>
                            <button type="button" className="k-btn k-btn--primary k-btn--sm"
                              disabled={!assignEmployee || busy === a.id || !canWrite}
                              onClick={() => assign(a.id)} title={denial || undefined}>
                              {busy === a.id ? 'Assigning…' : 'Assign'}
                            </button>
                            <button type="button" className="k-btn k-btn--ghost k-btn--sm"
                              onClick={() => { setAssigningId(null); setAssignEmployee(''); }}>
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button type="button" className="k-btn k-btn--ghost k-btn--sm"
                            disabled={!!employees.error}
                            onClick={() => setAssigningId(a.id)}>Assign</button>
                        )}

                        <button
                          type="button"
                          className="k-btn k-btn--ghost k-btn--sm k-btn--reject"
                          onClick={() => setConfirm({
                            title: `Delete ${a.name}?`,
                            message: a.employee_name
                              ? `This asset is currently with ${a.employee_name}. Deleting the record removes the asset and its assignment history permanently — it does not record a return.`
                              : 'The asset record and its history are removed permanently.',
                            confirmLabel: 'Delete',
                            intent: 'danger',
                            onConfirm: () => remove(a.id),
                          })}
                        >
                          Delete
                        </button>
                      </div>
                    </Td>
                  </tr>

                  {editingId === a.id && (
                    <tr>
                      <td colSpan={6}>
                        <form onSubmit={saveEdit} className="k-formpanel mn-editrow">
                          <div className="k-formpanel__grid k-formpanel__grid--3">
                            <label className="k-formpanel__label">
                              <span>Name</span>
                              <input className="k-formpanel__input" value={editForm.name}
                                onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
                            </label>
                            <label className="k-formpanel__label">
                              <span>Category</span>
                              <select className="k-formpanel__input" value={editForm.category}
                                onChange={e => setEditForm({ ...editForm, category: e.target.value })}>
                                {ASSET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                              </select>
                            </label>
                            <label className="k-formpanel__label">
                              <span>Serial number</span>
                              <input className="k-formpanel__input" value={editForm.serial_number}
                                onChange={e => setEditForm({ ...editForm, serial_number: e.target.value })} />
                            </label>
                            <label className="k-formpanel__label">
                              <span>Condition</span>
                              <select className="k-formpanel__input" value={editForm.condition}
                                onChange={e => setEditForm({ ...editForm, condition: e.target.value })}>
                                {ASSET_CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
                              </select>
                            </label>
                            <label className="k-formpanel__label">
                              <span>Purchase date</span>
                              <DateInput className="k-formpanel__input" type="date" value={editForm.purchase_date}
                                onChange={e => setEditForm({ ...editForm, purchase_date: e.target.value })} />
                            </label>
                            <label className="k-formpanel__label">
                              <span>Purchase cost</span>
                              <input className="k-formpanel__input" type="number" min="0" step="0.01"
                                value={editForm.purchase_cost}
                                onChange={e => setEditForm({ ...editForm, purchase_cost: e.target.value })} />
                            </label>
                            <label className="k-formpanel__label mn-fw">
                              <span>Notes</span>
                              <input className="k-formpanel__input" value={editForm.notes}
                                onChange={e => setEditForm({ ...editForm, notes: e.target.value })} />
                            </label>
                          </div>
                          <div className="k-formpanel__actions">
                            <button type="button" className="k-btn k-btn--ghost"
                              onClick={() => setEditingId(null)}>Cancel</button>
                            <button type="submit" className="k-btn k-btn--primary" disabled={editSaving || !canWrite} title={denial || undefined}>
                              {editSaving ? 'Saving…' : 'Save'}
                            </button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </DataTable>
          )}

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
