// Manav → Departments.
//
// `load()` caught to a toast over a list left at `[]`, so a failed fetch
// rendered "No departments yet — organise your team by department".
//
// Deleting a department was also unguarded: a bare click, no confirmation, on a
// record that other employees reference by name. It now confirms, and says how
// many people are attached.
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Empty } from '../../components/editorial';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { useList, ErrorNote, Shim, errText } from './_shared';

export default function DepartmentsTab() {
  const { pushToast } = useToast();
  const list = useList('/v1/manav/departments');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '' });
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ name: '' });
  const [editSaving, setEditSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/manav/departments', form);
      pushToast({ title: 'Department created', type: 'success' });
      setShowForm(false);
      setForm({ name: '' });
      list.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'The department could not be created.'), type: 'error' });
    } finally { setSaving(false); }
  }

  async function saveEdit(e) {
    e.preventDefault();
    setEditSaving(true);
    try {
      await api.patch(`/v1/manav/departments/${editingId}`, editForm);
      pushToast({ title: 'Department updated', type: 'success' });
      setEditingId(null);
      list.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'The department could not be updated.'), type: 'error' });
    } finally { setEditSaving(false); }
  }

  async function remove(id) {
    try {
      await api.delete(`/v1/manav/departments/${id}`);
      pushToast({ title: 'Department deleted', type: 'success' });
      list.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'The department could not be deleted.'), type: 'error' });
    }
  }

  return (
    <div>
      <div className="mn-bar">
        <div className="mn-bar__gap" />
        <button type="button" className="k-btn k-btn--primary" onClick={() => setShowForm(true)}>
          + Add department
        </button>
      </div>

      {showForm && (
        <form onSubmit={save} className="k-formpanel">
          <div className="k-formpanel__grid k-formpanel__grid--2">
            <label className="k-formpanel__label">
              <span>Department name *</span>
              <input className="k-formpanel__input" required value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })} />
            </label>
          </div>
          <div className="k-formpanel__actions">
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>
              {saving ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      )}

      {list.loading ? <Shim count={4} />
        : list.error ? <ErrorNote what="Departments" error={list.error} onRetry={list.reload} />
          : list.items.length === 0 ? (
            <Empty
              icon="🏢"
              title="No departments yet"
              sub="Organise your team by department for easier reporting, leave clash checks and shift management."
            />
          ) : (
            <div className="mn-grid">
              {list.items.map(d => (
                <div key={d.id} className="mn-card">
                  {editingId === d.id ? (
                    <form onSubmit={saveEdit}>
                      <label className="k-formpanel__label">
                        <span>Name</span>
                        <input className="k-formpanel__input" value={editForm.name}
                          onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
                      </label>
                      <div className="mn-card__act">
                        <button type="submit" className="k-btn k-btn--primary k-btn--sm" disabled={editSaving}>
                          {editSaving ? 'Saving…' : 'Save'}
                        </button>
                        <button type="button" className="k-btn k-btn--ghost k-btn--sm"
                          onClick={() => setEditingId(null)}>Cancel</button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <h4 className="mn-card__t">{d.name}</h4>
                      <div className="mn-card__meta">
                        <div>{d.employee_count} employee{Number(d.employee_count) === 1 ? '' : 's'}</div>
                        {d.head_name && <div>Head: {d.head_name}</div>}
                      </div>
                      <div className="mn-card__act">
                        <button type="button" className="k-btn k-btn--ghost k-btn--sm"
                          onClick={() => { setEditingId(d.id); setEditForm({ name: d.name }); }}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className="k-btn k-btn--ghost k-btn--sm k-btn--reject"
                          onClick={() => setConfirm({
                            title: `Delete ${d.name}?`,
                            message: Number(d.employee_count) > 0
                              ? `${d.employee_count} employee${Number(d.employee_count) === 1 ? ' is' : 's are'} recorded in this department. Deleting it does not delete them, but they will no longer be grouped — and leave clash checks read the department, so those stop working for them.`
                              : 'This department has no employees in it.',
                            confirmLabel: 'Delete',
                            intent: 'danger',
                            onConfirm: () => remove(d.id),
                          })}
                        >
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
