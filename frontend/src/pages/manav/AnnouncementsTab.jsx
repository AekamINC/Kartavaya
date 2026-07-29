// Manav → Announcements. Company-wide notices.
//
// `load()` caught to a toast over a list left at `[]`, so a failed fetch
// rendered "No announcements — post company-wide announcements that all
// employees will see".
//
// The pinned marker was a 📌 emoji. 07 §175 is explicit that this design system
// has no emoji; the pin is now the card's border plus a text label, which also
// survives being read aloud.
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Empty } from '../../components/editorial';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { Badge, PRIORITY_COLORS, useList, ErrorNote, Shim, errText } from './_shared';

const BLANK = { title: '', body: '', priority: 'normal', pinned: false, expires_at: '' };

// `onUpdate` refreshes the KPI strip on ManavPage. Without it the list
// below updates and the headline figure above does not — measured live:
// approving a leave flipped the row to "approved" while the strip still
// read "5 awaiting approval", and only a reload corrected it to 4.
// EmployeesTab already took this prop, which is why the employee count was
// the one figure that stayed right.
export default function AnnouncementsTab({ onUpdate }) {
  const { pushToast } = useToast();
  const list = useList('/v1/manav/announcements');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/v1/manav/announcements/${editing}`, form);
        pushToast({ title: 'Announcement updated', type: 'success' });
      } else {
        await api.post('/v1/manav/announcements', form);
        pushToast({ title: 'Announcement published', type: 'success' });
      }
      close();
      list.reload();
      list.reload();
      onUpdate?.();
    } catch (err) {
      pushToast({ title: errText(err, 'The announcement could not be saved.'), type: 'error' });
    } finally { setSaving(false); }
  }

  async function remove(id) {
    try {
      await api.delete(`/v1/manav/announcements/${id}`);
      pushToast({ title: 'Announcement removed', type: 'success' });
      list.reload();
      list.reload();
      onUpdate?.();
    } catch (err) {
      pushToast({ title: errText(err, 'The announcement could not be removed.'), type: 'error' });
    }
  }

  function close() { setShowForm(false); setEditing(null); setForm(BLANK); }

  function startEdit(a) {
    setEditing(a.id);
    setForm({
      title: a.title || '', body: a.body || '', priority: a.priority || 'normal',
      pinned: !!a.pinned, expires_at: a.expires_at || '',
    });
    setShowForm(true);
  }

  return (
    <div>
      <div className="mn-bar">
        <div className="mn-bar__gap" />
        <button type="button" className="k-btn k-btn--primary"
          onClick={() => { setEditing(null); setForm(BLANK); setShowForm(true); }}>
          + New announcement
        </button>
      </div>

      {showForm && (
        <form onSubmit={save} className="k-formpanel">
          <h3 className="k-section__title">{editing ? 'Edit' : 'New'} announcement</h3>
          <div className="k-formpanel__grid k-formpanel__grid--2">
            <label className="k-formpanel__label mn-fw">
              <span>Title *</span>
              <input className="k-formpanel__input" required value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })} />
            </label>
            <label className="k-formpanel__label mn-fw">
              <span>Body *</span>
              <textarea className="k-formpanel__input mn-ta" required rows={4} value={form.body}
                onChange={e => setForm({ ...form, body: e.target.value })} />
            </label>
            <label className="k-formpanel__label">
              <span>Priority</span>
              <select className="k-formpanel__input" value={form.priority}
                onChange={e => setForm({ ...form, priority: e.target.value })}>
                {['low', 'normal', 'high', 'urgent'].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className="k-formpanel__label">
              <span>Expires at</span>
              <input className="k-formpanel__input" type="datetime-local" value={form.expires_at}
                onChange={e => setForm({ ...form, expires_at: e.target.value })} />
            </label>
            <label className="k-formpanel__label mn-check">
              <input type="checkbox" checked={form.pinned}
                onChange={e => setForm({ ...form, pinned: e.target.checked })} />
              <span>Pin to top</span>
            </label>
          </div>
          <div className="k-formpanel__actions">
            <button type="button" className="k-btn k-btn--ghost" onClick={close}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Update' : 'Publish'}
            </button>
          </div>
        </form>
      )}

      {list.loading ? <Shim count={3} />
        : list.error ? <ErrorNote what="Announcements" error={list.error} onRetry={list.reload} />
          : list.items.length === 0 ? (
            <Empty
              icon="📢"
              title="No announcements"
              sub="Post a company-wide notice and every employee will see it."
            />
          ) : (
            <div className="mn-list">
              {list.items.map(a => (
                <article key={a.id} className={`mn-ann${a.pinned ? ' mn-ann--pin' : ''}`}>
                  <div className="mn-ann__top">
                    <h4 className="mn-ann__t">
                      {a.title}
                      {a.pinned && <span className="mn-ann__pin"> · Pinned</span>}
                    </h4>
                    <Badge text={a.priority} color={PRIORITY_COLORS[a.priority] || 'var(--on-surface-3)'} />
                  </div>
                  <p className="mn-ann__body">{a.body}</p>
                  <div className="mn-ann__foot">
                    <span className="mn-ann__when">
                      {fmtWhen(a.published_at || a.created_at)}
                      {a.expires_at && ` · Expires ${fmtDate(a.expires_at)}`}
                    </span>
                    <div className="mn-ann__act">
                      <button type="button" className="k-btn k-btn--ghost k-btn--sm"
                        onClick={() => startEdit(a)}>Edit</button>
                      <button
                        type="button"
                        className="k-btn k-btn--ghost k-btn--sm k-btn--reject"
                        onClick={() => setConfirm({
                          title: 'Remove this announcement?',
                          message: `“${a.title}” will stop being shown to employees. This cannot be undone.`,
                          confirmLabel: 'Remove',
                          intent: 'danger',
                          onConfirm: () => remove(a.id),
                        })}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

function fmtWhen(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { dateStyle: 'medium' });
}
