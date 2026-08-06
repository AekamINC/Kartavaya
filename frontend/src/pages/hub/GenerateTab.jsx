// Hub → Generate. One brief in, one piece of content out, one wallet debited.
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { AGENT_LABELS, LANGUAGES, errText } from './_shared';
import useModuleWrite from '../../hooks/useModuleWrite';
import { Secondary } from '../../components/Bilingual';

const EMPTY = { agent_type: 'social_media', brief: '', platform: '', language: 'en', extra_instructions: '' };

export default function GenerateTab({ clientId, wallet, onSpent }) {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change Sahayak content' });
  const { pushToast } = useToast();
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  // The failure is rendered IN the panel, not only as a toast. A generation can
  // fail for a reason the person must act on — out of credits, no brand profile,
  // provider refused the brief — and a toast that has already vanished leaves
  // them looking at a form that appears to have done nothing.
  const [error, setError] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const balance = wallet?.balance ?? null;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    setError('');
    try {
      const r = await api.post(`/v1/hub/clients/${clientId}/generate`, form);
      setResult(r.data);
      onSpent?.(r.data.credits_remaining);
      pushToast({ title: 'Content generated', type: 'success' });
    } catch (err) {
      setError(errText(err, 'Generation failed.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="hb-gen">
      <form className="hb-card hb-form" onSubmit={submit}>
        <h3 className="hb-card__t">
          Generate content
          <Secondary className="hb-card__hi" value="सहायक" />
        </h3>

        <div className="hb-grid hb-grid--2">
          <label className="hb-field">
            <span className="hb-field__l">Agent type</span>
            <select className="k-input" value={form.agent_type} onChange={e => set('agent_type', e.target.value)}>
              {Object.entries(AGENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>

          <label className="hb-field">
            <span className="hb-field__l">Platform</span>
            <input className="k-input" placeholder="e.g. Instagram, LinkedIn"
              value={form.platform} onChange={e => set('platform', e.target.value)} />
          </label>

          <label className="hb-field hb-field--wide">
            <span className="hb-field__l">Brief <span className="hb-req" aria-hidden="true">*</span></span>
            <textarea className="k-input hb-ta" rows={3} required
              placeholder="Describe what content you need…"
              value={form.brief} onChange={e => set('brief', e.target.value)} />
          </label>

          <label className="hb-field">
            <span className="hb-field__l">Language</span>
            <select className="k-input" value={form.language} onChange={e => set('language', e.target.value)}>
              {LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>

          <label className="hb-field">
            <span className="hb-field__l">Extra instructions</span>
            <input className="k-input" placeholder="Any additional context…"
              value={form.extra_instructions} onChange={e => set('extra_instructions', e.target.value)} />
          </label>
        </div>

        <div className="hb-form__foot">
          <span className="hb-cap">
            {/* `?? null` above rather than `?? 0`: a wallet that has not loaded is
                not a wallet with nothing in it, and telling someone they have
                zero credits when the request simply has not answered is the same
                class of lie as an empty state over a failure. */}
            {balance == null
              ? 'Credit balance unavailable'
              : <>Credits available: <b className="hb-num">{balance}</b></>}
          </span>
          <button type="submit" className="k-btn k-btn--primary" disabled={busy || !form.brief.trim() || !canWrite} title={denial || undefined}>
            {busy ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </form>

      {error && (
        <div className="note note--warn hb-err" role="status">
          <b>Generation failed.</b> {error}
        </div>
      )}

      {result && (
        <section className="hb-card hb-card--lit">
          <div className="hb-card__head">
            <h3 className="hb-card__t hb-card__t--flush">Generated content</h3>
            <span className="hb-cap hb-mono">
              {[result.ai?.provider, result.ai?.model].filter(Boolean).join(' · ') || 'model not reported'}
            </span>
          </div>
          <div className="hb-out">{result.content?.body}</div>
          <div className="hb-cap hb-out__foot">
            Credits remaining: <b className="hb-num">{result.credits_remaining ?? '—'}</b>
            <span className="hb-out__note">Saved to the Content tab as a draft.</span>
          </div>
        </section>
      )}
    </div>
  );
}
