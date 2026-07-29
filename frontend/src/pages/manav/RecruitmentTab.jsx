// Manav → Recruitment. Job openings and the candidate pipeline.
//
// `loadOpenings()` and `loadCandidates()` both caught to a toast over lists
// left at `[]`. The openings failure was the worse of the two: with `openings`
// empty, `activeOpening` never got set, and the render fell through to
// "Create a job opening to start tracking candidates" — telling someone to
// create records that may already exist and simply failed to load.
//
// The stage-move chips were `<button>` elements carrying an eight-property
// inline object each, with the tint computed in JS by `mixAlpha(colour, 9)`.
// They are now `.mn-chip` with `--c` set per instance, so the text colour and
// its background tint are derived from ONE value and cannot disagree.
//
// "Hire" is now confirmed. It creates an employee record from the candidate —
// a write into the personnel directory — and it fired on a single click.
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Empty } from '../../components/editorial';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { Badge, CANDIDATE_STAGES, STAGE_COLORS_REC, useList, ErrorNote, Shim, errText } from './_shared';
import useModuleWrite from '../../hooks/useModuleWrite';

export default function RecruitmentTab() {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change HR records' });
  const { pushToast } = useToast();
  const openings = useList('/v1/manav/job-openings');
  const [activeOpening, setActiveOpening] = useState('');
  const [panel, setPanel] = useState(null);        // 'opening' | 'candidate' | 'edit' | null
  const [confirm, setConfirm] = useState(null);

  // The first opening becomes the selection once the list arrives, but only if
  // nothing is chosen yet — a reload must not yank the person back to the top.
  const list = openings.items;
  const current = activeOpening || (list && list.length > 0 ? list[0].id : '');

  const candUrl = current ? `/v1/manav/candidates?job_opening_id=${current}` : null;
  const candidates = useList(candUrl || '/v1/manav/candidates?job_opening_id=', [candUrl]);

  async function moveStage(candidateId, stage) {
    try {
      await api.patch(`/v1/manav/candidates/${candidateId}/stage`, { stage });
      pushToast({ title: `Moved to ${stage}`, type: 'success' });
      candidates.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'The candidate could not be moved.'), type: 'error' });
    }
  }

  async function hire(candidateId) {
    try {
      await api.post(`/v1/manav/candidates/${candidateId}/hire`);
      pushToast({ title: 'Candidate hired — employee record created', type: 'success' });
      candidates.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'The candidate could not be hired.'), type: 'error' });
    }
  }

  if (openings.loading) return <Shim count={4} />;
  if (openings.error) {
    return <ErrorNote what="Job openings" error={openings.error} onRetry={openings.reload} />;
  }

  const activeRow = list.find(o => o.id === current);

  return (
    <div>
      <div className="mn-bar">
        <label className="mn-field">
          <span className="mn-field__l">Opening</span>
          <select className="k-input mn-f--lg" value={current}
            onChange={e => setActiveOpening(e.target.value)}>
            <option value="">Select job opening…</option>
            {list.map(o => (
              <option key={o.id} value={o.id}>{o.title} ({o.candidate_count})</option>
            ))}
          </select>
        </label>
        {current && (
          <button type="button" className="k-btn k-btn--ghost"
            onClick={() => setPanel(panel === 'edit' ? null : 'edit')}>
            Edit opening
          </button>
        )}
        <div className="mn-bar__gap" />
        <button type="button" className="k-btn k-btn--ghost"
          onClick={() => setPanel(panel === 'opening' ? null : 'opening')}>
          + Job opening
        </button>
        {current && (
          <button type="button" className="k-btn k-btn--primary"
            onClick={() => setPanel(panel === 'candidate' ? null : 'candidate')}
          disabled={!canWrite} title={denial || undefined}>
            + Candidate
          </button>
        )}
      </div>

      {panel === 'opening' && (
        <OpeningForm
          onClose={() => setPanel(null)}
          onCreated={id => { setPanel(null); openings.reload(); if (id) setActiveOpening(id); }}
          pushToast={pushToast}
        />
      )}

      {panel === 'edit' && activeRow && (
        <OpeningForm
          existing={activeRow}
          onClose={() => setPanel(null)}
          onCreated={() => { setPanel(null); openings.reload(); }}
          pushToast={pushToast}
        />
      )}

      {panel === 'candidate' && current && (
        <CandidateForm
          openingId={current}
          onClose={() => setPanel(null)}
          onCreated={() => { setPanel(null); candidates.reload(); openings.reload(); }}
          pushToast={pushToast}
        />
      )}

      {!current ? (
        <Empty
          icon="📋"
          title={list.length === 0 ? 'No job openings yet' : 'No opening selected'}
          sub={list.length === 0
            ? 'Create a job opening to start tracking candidates through the pipeline.'
            : 'Choose an opening above to see its candidates.'}
        />
      ) : candidates.loading ? <Shim count={3} />
        : candidates.error ? (
          <ErrorNote what="Candidates for this opening" error={candidates.error} onRetry={candidates.reload} />
        ) : (
          <div className="mn-pipe">
            {CANDIDATE_STAGES.map(stage => {
              const inStage = candidates.items.filter(c => c.stage === stage);
              return (
                <section key={stage} className="mn-pipe__col">
                  <div className="mn-pipe__head">
                    <Badge text={stage} color={STAGE_COLORS_REC[stage]} />
                    <span className="mn-pipe__n">{inStage.length}</span>
                  </div>
                  <div className="mn-pipe__body">
                    {inStage.map(c => (
                      <article key={c.id} className="mn-cand">
                        <div className="mn-cand__n">{c.full_name}</div>
                        {c.email && <div className="mn-cand__e">{c.email}</div>}
                        {c.resume_url && (
                          <a className="mn-cand__link" href={c.resume_url}
                            target="_blank" rel="noreferrer">Resume ↗</a>
                        )}
                        <div className="mn-cand__move">
                          {stage === 'offer' && (
                            <button
                              type="button"
                              className="mn-chip"
                              style={{ '--c': 'var(--ok)' }}
                              onClick={() => setConfirm({
                                title: `Hire ${c.full_name}?`,
                                message: 'This creates an employee record in the personnel directory from this candidate. They will appear in the employee list, and can then be given attendance, leave and payroll.',
                                confirmLabel: 'Hire',
                                intent: 'neutral',
                                onConfirm: () => hire(c.id),
                              })}
                            >
                              Hire
                            </button>
                          )}
                          {CANDIDATE_STAGES.filter(s => s !== stage && s !== 'hired').map(s => (
                            <button
                              key={s}
                              type="button"
                              className="mn-chip"
                              style={{ '--c': STAGE_COLORS_REC[s] || 'var(--on-surface-3)' }}
                              onClick={() => moveStage(c.id, s)}
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      </article>
                    ))}
                    {inStage.length === 0 && (
                      <p className="mn-pipe__none">None</p>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

/** Create or edit — the same five fields either way. */
function OpeningForm({ existing, onClose, onCreated, pushToast }) {
  // F32 — this component owns its own write controls, so it asks
  // the same question rather than taking the answer as a prop.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change HR records' });
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(existing
    ? { title: existing.title || '', description: existing.description || '', status: existing.status || 'open' }
    : { title: '', description: '' });

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      if (existing) {
        await api.patch(`/v1/manav/job-openings/${existing.id}`, form);
        pushToast({ title: 'Job opening updated', type: 'success' });
        onCreated(existing.id);
      } else {
        const r = await api.post('/v1/manav/job-openings', form);
        pushToast({ title: 'Job opening created', type: 'success' });
        onCreated(r.data?.id);
      }
    } catch (err) {
      pushToast({ title: errText(err, 'The job opening could not be saved.'), type: 'error' });
    } finally { setSaving(false); }
  }

  return (
    <form onSubmit={submit} className="k-formpanel">
      <h4 className="k-section__title">{existing ? 'Edit' : 'New'} job opening</h4>
      <div className="k-formpanel__grid k-formpanel__grid--2">
        <label className="k-formpanel__label">
          <span>Title *</span>
          <input className="k-formpanel__input" required value={form.title}
            onChange={e => setForm({ ...form, title: e.target.value })} />
        </label>
        {existing && (
          <label className="k-formpanel__label">
            <span>Status</span>
            <select className="k-formpanel__input" value={form.status}
              onChange={e => setForm({ ...form, status: e.target.value })}>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
              <option value="on_hold">On hold</option>
            </select>
          </label>
        )}
        <label className="k-formpanel__label mn-fw">
          <span>Description</span>
          <textarea className="k-formpanel__input mn-ta" rows={2} value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })} />
        </label>
      </div>
      <div className="k-formpanel__actions">
        <button type="button" className="k-btn k-btn--ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="k-btn k-btn--primary" disabled={saving || !canWrite} title={denial || undefined}>
          {saving ? 'Saving…' : existing ? 'Save' : 'Create'}
        </button>
      </div>
    </form>
  );
}

function CandidateForm({ openingId, onClose, onCreated, pushToast }) {
  // F32 — this component owns its own write controls, so it asks
  // the same question rather than taking the answer as a prop.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change HR records' });
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', resume_url: '' });

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/manav/candidates', { ...form, job_opening_id: openingId });
      pushToast({ title: 'Candidate added', type: 'success' });
      onCreated();
    } catch (err) {
      pushToast({ title: errText(err, 'The candidate could not be added.'), type: 'error' });
    } finally { setSaving(false); }
  }

  return (
    <form onSubmit={submit} className="k-formpanel">
      <h4 className="k-section__title">Add candidate</h4>
      <div className="k-formpanel__grid k-formpanel__grid--2">
        <label className="k-formpanel__label">
          <span>Full name *</span>
          <input className="k-formpanel__input" required value={form.full_name}
            onChange={e => setForm({ ...form, full_name: e.target.value })} />
        </label>
        <label className="k-formpanel__label">
          <span>Email</span>
          <input className="k-formpanel__input" type="email" value={form.email}
            onChange={e => setForm({ ...form, email: e.target.value })} />
        </label>
        <label className="k-formpanel__label">
          <span>Phone</span>
          <input className="k-formpanel__input" value={form.phone}
            onChange={e => setForm({ ...form, phone: e.target.value })} />
        </label>
        <label className="k-formpanel__label">
          <span>Resume URL</span>
          <input className="k-formpanel__input" value={form.resume_url}
            onChange={e => setForm({ ...form, resume_url: e.target.value })} />
        </label>
      </div>
      <div className="k-formpanel__actions">
        <button type="button" className="k-btn k-btn--ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="k-btn k-btn--primary" disabled={saving || !canWrite} title={denial || undefined}>
          {saving ? 'Adding…' : 'Add'}
        </button>
      </div>
    </form>
  );
}
