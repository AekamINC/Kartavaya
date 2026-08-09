// Graha · deals — the list, the create form, and per-row stage movement.
//
// 66 inline styles are now `gr__*` classes. Two behavioural corrections came
// out of the conversion and are marked below: the deal title was a `<span>`
// carrying an onClick (unreachable by keyboard, invisible to a screen reader as
// a control), and the empty state was a hand-rolled emoji block rather than the
// shared `EmptyState` every other list in the product uses.
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, rows, body } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState, errorKind } from '../../components/ui/ErrorState';
import { SkeletonList, SkeletonRegion } from '../../components/ui/Skeleton';
import { RotBadge, Badge, stageColor } from './_shared';
import { inr } from '../../lib/inr';
import useModuleWrite from '../../hooks/useModuleWrite';
import DateInput from '../../components/ui/DateInput';

/**
 * `newNonce` lets the page header's "New deal" button open this tab's create
 * form. It is a counter rather than a boolean so a second press re-opens the
 * form after the first was cancelled — a boolean would already be `true` and
 * the effect would not re-run.
 */
export default function DealsTab({ newNonce = 0 }) {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change deals' });
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  // A failed load used to leave `deals` at [] and paint "No deals yet — track
  // your sales pipeline here", which is a confident wrong answer: the user
  // cannot tell it from a genuinely empty pipeline, and the toast that says
  // otherwise is gone in four seconds.
  const [err, setErr] = useState(null);
  // Deals whose stage change is in flight. MOTION-SPEC §7.1 — the row shows the
  // new stage at opacity .6 until the server agrees, then goes solid.
  const [pending, setPending] = useState(() => new Set());
  const [showForm, setShowForm] = useState(false);
  const [stageFilter, setStageFilter] = useState('');
  const [contacts, setContacts] = useState([]);
  const [dealClients, setDealClients] = useState([]);
  const [form, setForm] = useState({ title: '', contact_id: '', client_id: '', value: '', stage: 'New', probability: 20, expected_close_date: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [editDeal, setEditDeal] = useState(null);
  const [editDealSaving, setEditDealSaving] = useState(false);
  const [noteDeal, setNoteDeal] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!newNonce) return;
    setShowForm(true);
    loadFormData();
  }, [newNonce]);

  async function load() {
    setErr(null);
    try {
      let url = '/v1/graha/deals?';
      if (stageFilter) url += `stage=${stageFilter}&`;
      const r = await api.get(url);
      setDeals(rows(r));
    } catch (e) {
      setErr(e);
      pushToast({ title: 'Failed to load deals', type: 'error' });
    }
    finally { setLoading(false); }
  }

  // The two dropdowns are an enrichment on the create form: either failing
  // leaves that select empty rather than blocking the form.
  async function loadFormData() {
    try {
      const [cr, clr] = await Promise.all([api.get('/v1/graha/contacts'), api.get('/v1/graha/clients')]);
      setContacts(rows(cr));
      setDealClients(rows(clr));
    } catch { /* selects offer "None" only */ }
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/graha/deals', { ...form, value: parseFloat(form.value) || 0 });
      pushToast({ title: 'Deal created', type: 'success' });
      setShowForm(false);
      setForm({ title: '', contact_id: '', client_id: '', value: '', stage: 'New', probability: 20, expected_close_date: '', notes: '' });
      load();
    } catch (e2) { pushToast({ title: e2.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  async function deleteDeal(dealId, title) {
    if (!window.confirm(`Delete deal "${title}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/v1/graha/deals/${dealId}`);
      pushToast({ title: 'Deal deleted', type: 'success' });
      load();
    } catch { pushToast({ title: 'Could not delete deal', type: 'error' }); }
  }

  /**
   * Optimistic stage change — MOTION-SPEC §7.1.
   *
   * Before: `await PATCH` then `load()`. The select snapped back to the old
   * stage for a whole round trip, then the entire list re-rendered. If the
   * write failed the toast fired but the row had already been reset by the
   * refetch, so the two paths looked identical from the user's side.
   *
   * Now the row shows the new stage immediately at `opacity .6`, and a failure
   * restores the WHOLE previous deal rather than just its stage — restoring one
   * field leaves a row that is half-committed and looks fine.
   */
  async function updateStage(dealId, stage) {
    const previous = deals.find(d => d.id === dealId);
    if (!previous) return;
    setDeals(prev => prev.map(d => (d.id === dealId ? { ...d, stage } : d)));
    setPending(prev => new Set(prev).add(dealId));
    try {
      const r = await api.patch(`/v1/graha/deals/${dealId}`, { stage });
      const b = body(r);
      const fresh = b?.data ?? b;
      if (fresh && fresh.id != null) {
        setDeals(prev => prev.map(d => (d.id === dealId ? { ...d, ...fresh } : d)));
      }
      pushToast({ title: `Deal moved to ${stage}`, type: 'success' });
    } catch {
      pushToast({ title: 'Could not update deal stage', type: 'error' });
      setDeals(prev => prev.map(d => (d.id === dealId ? previous : d)));
    } finally {
      setPending(prev => { const n = new Set(prev); n.delete(dealId); return n; });
    }
  }

  async function createInvoice(dealId) {
    try {
      const r = await api.post(`/v1/ganit/invoices/from-deal/${dealId}`);
      const b = body(r);
      if (b.status === 'exists') {
        pushToast({ title: 'Invoice already exists for this deal', type: 'info' });
      } else {
        pushToast({ title: `Draft invoice ${b.invoice_number} created`, type: 'success' });
      }
      navigate('/ganit');
    } catch (e) { pushToast({ title: e.response?.data?.detail || 'Failed to create invoice', type: 'error' }); }
  }

  function startEditDeal(d) {
    setEditDeal({
      id: d.id, title: d.title || '', value: d.value || '', stage: d.stage || 'New',
      probability: d.probability ?? 20, expected_close_date: d.expected_close_date || '',
      notes: d.notes || '',
    });
  }

  async function saveEditDeal() {
    if (!editDeal) return;
    setEditDealSaving(true);
    try {
      const { id, ...fields } = editDeal;
      const payload = { ...fields, value: parseFloat(fields.value) || 0 };
      if (!payload.expected_close_date) delete payload.expected_close_date;
      if (!payload.notes) delete payload.notes;
      await api.patch(`/v1/graha/deals/${id}`, payload);
      pushToast({ title: 'Deal updated', type: 'success' });
      setEditDeal(null);
      load();
    } catch { pushToast({ title: 'Could not update deal', type: 'error' }); }
    finally { setEditDealSaving(false); }
  }

  async function saveNote(dealId) {
    setNoteSaving(true);
    try {
      await api.patch(`/v1/graha/deals/${dealId}`, { notes: noteText });
      pushToast({ title: 'Notes updated', type: 'success' });
      setNoteDeal(null);
      load();
    } catch { pushToast({ title: 'Could not update notes', type: 'error' }); }
    finally { setNoteSaving(false); }
  }

  const stages = ['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'];
  const field = (label, node) => (
    <label className="gr__f"><span className="gr__fl">{label}</span>{node}</label>
  );

  return (
    <div>
      <div className="gr__bar">
        <select className="k-input gr__sel" aria-label="Filter by stage" value={stageFilter} onChange={e => setStageFilter(e.target.value)}>
          <option value="">All Stages</option>
          {stages.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="k-btn k-btn--ghost" onClick={load}>Filter</button>
        <div className="gr__spacer" />
        <button className="k-btn k-btn--primary" disabled={!canWrite} title={denial || undefined}
          onClick={() => { setShowForm(true); loadFormData(); }}>+ New Deal</button>
      </div>

      {showForm && (
        <form onSubmit={save} className="gr__panel">
          <h3 className="gr__ptitle">New Deal</h3>
          <div className="gr__grid">
            {field('Title *', <input className="k-input" required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />)}
            {field('Client / Company', (
              <select className="k-input" value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })}>
                <option value="">— None —</option>
                {dealClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            ))}
            {field('Contact', (
              <select className="k-input" value={form.contact_id} onChange={e => setForm({ ...form, contact_id: e.target.value })}>
                <option value="">None</option>
                {contacts.map(c => <option key={c.id} value={c.id}>{c.name} {c.company && `(${c.company})`}</option>)}
              </select>
            ))}
            {field('Value (₹)', <input className="k-input" type="number" value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} />)}
            {field('Stage', (
              <select className="k-input" value={form.stage} onChange={e => setForm({ ...form, stage: e.target.value })}>
                {stages.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            ))}
            {field('Probability (%)', <input className="k-input" type="number" min="0" max="100" value={form.probability} onChange={e => setForm({ ...form, probability: parseInt(e.target.value, 10) || 0 })} />)}
            {field('Expected Close', <DateInput className="k-input" type="date" value={form.expected_close_date} onChange={e => setForm({ ...form, expected_close_date: e.target.value })} />)}
          </div>
          <div className="gr__acts">
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Creating…' : 'Create Deal'}</button>
          </div>
        </form>
      )}

      {loading ? (
        <SkeletonRegion label="Loading deals"><SkeletonList rows={6} /></SkeletonRegion>
      ) : err ? (
        <ErrorState kind={errorKind(err)} onRetry={load} />
      ) : deals.length === 0 ? (
        <EmptyState
          illustration="generic"
          title={{ en: 'No deals yet', hi: 'कोई सौदा नहीं' }}
          description="Track your sales pipeline here. Add your first opportunity to see it move through the stages."
          action={canWrite ? 'New Deal' : undefined}
          onAction={canWrite ? () => { setShowForm(true); loadFormData(); } : undefined}
        />
      ) : (
        <div className="gr__cards">
          {deals.map(d => (
            <div key={d.id} className={`gr__card${pending.has(d.id) ? ' ix-pending' : ''}`}>
              {editDeal?.id === d.id ? (
                <div>
                  <h4 className="gr__ptitle gr__ptitle--sm">Edit Deal</h4>
                  <div className="gr__grid">
                    {field('Title *', <input className="k-input" value={editDeal.title} onChange={e => setEditDeal({ ...editDeal, title: e.target.value })} />)}
                    {field('Value (₹)', <input className="k-input" type="number" value={editDeal.value} onChange={e => setEditDeal({ ...editDeal, value: e.target.value })} />)}
                    {field('Stage', (
                      <select className="k-input" value={editDeal.stage} onChange={e => setEditDeal({ ...editDeal, stage: e.target.value })}>
                        {stages.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ))}
                    {field('Probability (%)', <input className="k-input" type="number" min="0" max="100" value={editDeal.probability} onChange={e => setEditDeal({ ...editDeal, probability: parseInt(e.target.value, 10) || 0 })} />)}
                    {field('Expected Close', <DateInput className="k-input" type="date" value={editDeal.expected_close_date} onChange={e => setEditDeal({ ...editDeal, expected_close_date: e.target.value })} />)}
                  </div>
                  <label className="gr__f gr__f--block"><span className="gr__fl">Notes</span>
                    <textarea className="k-input gr__ta" rows={3} value={editDeal.notes} onChange={e => setEditDeal({ ...editDeal, notes: e.target.value })} /></label>
                  <div className="gr__acts">
                    <button type="button" className="k-btn k-btn--ghost" onClick={() => setEditDeal(null)}>Cancel</button>
                    <button type="button" className="k-btn k-btn--primary" disabled={editDealSaving} onClick={saveEditDeal}>{editDealSaving ? 'Saving…' : 'Save'}</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="gr__crow">
                    <div>
                      {/* Was a <span onClick>. A control that opens an editor has
                          to be a button or it does not exist for the keyboard. */}
                      <button type="button" className="gr__link" onClick={() => startEditDeal(d)}>{d.title}</button>
                      {d.client_name && <span className="gr__kbco"> {d.client_name}</span>}
                      {d.contact_name && <span className="gr__ls"> {d.contact_name} {d.contact_company && `· ${d.contact_company}`}</span>}
                    </div>
                    <div className="gr__cside">
                      <span className="gr__val">{inr(Number(d.value))}</span>
                      <Badge text={d.stage} color={stageColor(d.stage)} />
                      {d.stage !== 'Won' && d.stage !== 'Lost' && <RotBadge updatedAt={d.updated_at} />}
                    </div>
                  </div>
                  <div className="gr__cmeta">
                    <span>Probability: {d.probability}%</span>
                    {d.expected_close_date && <span>Close: {d.expected_close_date}</span>}
                    <div className="gr__spacer" />
                    <button className="k-btn k-btn--ghost" onClick={() => startEditDeal(d)}>Edit</button>
                    <button className="k-btn k-btn--ghost" onClick={() => { setNoteDeal(d.id); setNoteText(d.notes || ''); }}>Notes</button>
                    <button className="k-btn k-btn--reject" onClick={() => deleteDeal(d.id, d.title)}>Delete</button>
                    {d.stage === 'Won' && (
                      <button className="k-btn k-btn--primary" onClick={() => createInvoice(d.id)}>Create Invoice</button>
                    )}
                    {stages.filter(s => s !== d.stage && s !== 'Lost').map(s => (
                      <button key={s} className="k-btn k-btn--ghost" onClick={() => updateStage(d.id, s)}>{s}</button>
                    ))}
                  </div>
                  {noteDeal === d.id && (
                    <div className="gr__cedit">
                      <label className="gr__f"><span className="gr__fl">Notes</span>
                        <textarea className="k-input gr__ta" rows={3} value={noteText} onChange={e => setNoteText(e.target.value)} /></label>
                      <div className="gr__acts gr__acts--tight">
                        <button type="button" className="k-btn k-btn--ghost" onClick={() => setNoteDeal(null)}>Cancel</button>
                        <button type="button" className="k-btn k-btn--primary" disabled={noteSaving} onClick={() => saveNote(d.id)}>{noteSaving ? 'Saving…' : 'Save Notes'}</button>
                      </div>
                    </div>
                  )}
                  {noteDeal !== d.id && d.notes && <div className="gr__cnote">{d.notes}</div>}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
