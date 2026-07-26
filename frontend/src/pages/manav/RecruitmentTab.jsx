import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Badge, CANDIDATE_STAGES, STAGE_COLORS_REC } from './_shared';

export default function RecruitmentTab() {
  const { pushToast } = useToast();
  const [openings, setOpenings] = useState([]);
  const [activeOpening, setActiveOpening] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showOpeningForm, setShowOpeningForm] = useState(false);
  const [showCandidateForm, setShowCandidateForm] = useState(false);
  const [openingForm, setOpeningForm] = useState({ title: '', description: '' });
  const [candidateForm, setCandidateForm] = useState({ full_name: '', email: '', phone: '', resume_url: '' });
  const [saving, setSaving] = useState(false);
  const [editingOpening, setEditingOpening] = useState(null);
  const [editOpeningForm, setEditOpeningForm] = useState({});
  const [editOpeningSaving, setEditOpeningSaving] = useState(false);

  useEffect(() => { loadOpenings(); }, []);
  useEffect(() => { if (activeOpening) loadCandidates(); }, [activeOpening]);

  async function loadOpenings() {
    try {
      const r = await api.get('/v1/manav/job-openings');
      const data = r.data.data || [];
      setOpenings(data);
      if (!activeOpening && data.length > 0) setActiveOpening(data[0].id);
    } catch { pushToast({ title: 'Failed to load job openings', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function loadCandidates() {
    try {
      const r = await api.get(`/v1/manav/candidates?job_opening_id=${activeOpening}`);
      setCandidates(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load candidates', type: 'error' }); }
  }

  async function createOpening(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await api.post('/v1/manav/job-openings', openingForm);
      pushToast({ title: 'Job opening created', type: 'success' });
      setShowOpeningForm(false);
      setOpeningForm({ title: '', description: '' });
      await loadOpenings();
      setActiveOpening(r.data.id);
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  async function createCandidate(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/manav/candidates', { ...candidateForm, job_opening_id: activeOpening });
      pushToast({ title: 'Candidate added', type: 'success' });
      setShowCandidateForm(false);
      setCandidateForm({ full_name: '', email: '', phone: '', resume_url: '' });
      loadCandidates();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  async function moveStage(candidateId, stage) {
    try {
      await api.patch(`/v1/manav/candidates/${candidateId}/stage`, { stage });
      pushToast({ title: `Moved to ${stage}`, type: 'success' });
      loadCandidates();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Move failed', type: 'error' }); }
  }

  async function hire(candidateId) {
    try {
      await api.post(`/v1/manav/candidates/${candidateId}/hire`);
      pushToast({ title: 'Candidate hired — employee record created', type: 'success' });
      loadCandidates();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  function startEditOpening() {
    const o = openings.find(x => x.id === activeOpening);
    if (!o) return;
    setEditingOpening(o.id);
    setEditOpeningForm({ title: o.title || '', description: o.description || '', status: o.status || 'open' });
  }

  async function saveEditOpening(e) {
    e.preventDefault();
    setEditOpeningSaving(true);
    try {
      await api.patch(`/v1/manav/job-openings/${editingOpening}`, editOpeningForm);
      pushToast({ title: 'Job opening updated', type: 'success' });
      setEditingOpening(null);
      loadOpenings();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Could not update job opening', type: 'error' }); }
    finally { setEditOpeningSaving(false); }
  }

  if (loading) return <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p>;

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <select className="k-input" style={{ width: 220 }} value={activeOpening} onChange={e => setActiveOpening(e.target.value)}>
          <option value="">Select job opening…</option>
          {openings.map(o => <option key={o.id} value={o.id}>{o.title} ({o.candidate_count})</option>)}
        </select>
        {activeOpening && <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={startEditOpening}>Edit Opening</button>}
        <div style={{ flex: 1 }} />
        <button className="k-btn k-btn--ghost" style={{ fontSize: 13 }} onClick={() => setShowOpeningForm(true)}>+ Job Opening</button>
        {activeOpening && <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => setShowCandidateForm(true)}>+ Candidate</button>}
      </div>

      {showOpeningForm && (
        <form onSubmit={createOpening} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>New Job Opening</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Title *</span>
              <input className="k-input" required value={openingForm.title} onChange={e => setOpeningForm({ ...openingForm, title: e.target.value })} /></label>
            <label style={{ fontSize: 13, gridColumn: '1 / -1' }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Description</span>
              <textarea className="k-input" rows={2} value={openingForm.description} onChange={e => setOpeningForm({ ...openingForm, description: e.target.value })} style={{ resize: 'vertical', width: '100%' }} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowOpeningForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Creating…' : 'Create'}</button>
          </div>
        </form>
      )}

      {editingOpening && (
        <form onSubmit={saveEditOpening} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Edit Job Opening</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Title</span>
              <input className="k-input" value={editOpeningForm.title} onChange={e => setEditOpeningForm({ ...editOpeningForm, title: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Status</span>
              <select className="k-input" value={editOpeningForm.status} onChange={e => setEditOpeningForm({ ...editOpeningForm, status: e.target.value })}>
                <option value="open">Open</option><option value="closed">Closed</option><option value="on_hold">On Hold</option>
              </select></label>
            <label style={{ fontSize: 13, gridColumn: '1 / -1' }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Description</span>
              <textarea className="k-input" rows={2} value={editOpeningForm.description} onChange={e => setEditOpeningForm({ ...editOpeningForm, description: e.target.value })} style={{ resize: 'vertical', width: '100%' }} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setEditingOpening(null)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={editOpeningSaving}>{editOpeningSaving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      )}

      {showCandidateForm && (
        <form onSubmit={createCandidate} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Add Candidate</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Full Name *</span>
              <input className="k-input" required value={candidateForm.full_name} onChange={e => setCandidateForm({ ...candidateForm, full_name: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Email</span>
              <input className="k-input" type="email" value={candidateForm.email} onChange={e => setCandidateForm({ ...candidateForm, email: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Phone</span>
              <input className="k-input" value={candidateForm.phone} onChange={e => setCandidateForm({ ...candidateForm, phone: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Resume URL</span>
              <input className="k-input" value={candidateForm.resume_url} onChange={e => setCandidateForm({ ...candidateForm, resume_url: e.target.value })} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowCandidateForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Adding…' : 'Add'}</button>
          </div>
        </form>
      )}

      {!activeOpening ? (
        <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Create a job opening to start tracking candidates.</p>
      ) : (
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 16 }}>
          {CANDIDATE_STAGES.map(stage => {
            const inStage = candidates.filter(c => c.stage === stage);
            return (
              <div key={stage} style={{ minWidth: 220, flex: '1 0 220px', background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <Badge text={stage} color={STAGE_COLORS_REC[stage]} />
                  <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{inStage.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {inStage.map(c => (
                    <div key={c.id} style={{ background: 'var(--bg)', border: '1px solid var(--rule-soft)', borderRadius: 8, padding: 10 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{c.full_name}</div>
                      {c.email && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 2 }}>{c.email}</div>}
                      {c.resume_url && <a href={c.resume_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--k-primary)' }}>Resume ↗</a>}
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                        {stage === 'offer' && (
                          <button onClick={() => hire(c.id)} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#10b98118', color: '#10b981', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Hire</button>
                        )}
                        {CANDIDATE_STAGES.filter(s => s !== stage && s !== 'hired').map(s => (
                          <button key={s} onClick={() => moveStage(c.id, s)}
                            style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: `${STAGE_COLORS_REC[s]}18`,
                              color: STAGE_COLORS_REC[s], border: 'none', cursor: 'pointer', fontWeight: 600 }}>{s}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                  {inStage.length === 0 && <p style={{ fontSize: 12, color: 'var(--ink-3)', textAlign: 'center', padding: 12 }}>No candidates</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
