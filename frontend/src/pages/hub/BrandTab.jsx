// Hub → Brand. The profile every prompt for this client is built on top of.
//
// The two colour inputs were `<input type="color">` with no swatch and no hex
// shown, so the only way to know what was stored was to open the picker. They
// now show the value beside the well and stay keyboard-reachable.
import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Resource, errText } from './_shared';
import useModuleWrite from '../../hooks/useModuleWrite';

const TONES = ['professional', 'casual', 'friendly', 'bold', 'inspirational', 'witty'];

/** Fields the API owns; they must not be echoed back on save. */
const READ_ONLY = ['id', 'client_id', 'org_id', 'created_at', 'updated_at'];

export default function BrandTab({ clientId, state, brand, onSaved }) {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change Sahayak content' });
  const { pushToast } = useToast();
  const [form, setForm] = useState(brand || {});
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Re-seed when the parent finishes loading, but never over unsaved edits —
  // the original re-set the form on every parent refresh and quietly discarded
  // whatever had been typed since.
  useEffect(() => {
    if (!dirty) setForm(brand || {});
  }, [brand, dirty]);

  const set = (k, v) => { setDirty(true); setForm(f => ({ ...f, [k]: v })); };

  async function save() {
    setBusy(true);
    try {
      const fields = Object.fromEntries(
        Object.entries(form).filter(([k]) => !READ_ONLY.includes(k))
      );
      await api.put(`/v1/hub/clients/${clientId}/brand`, fields);
      setDirty(false);
      pushToast({ title: 'Brand profile saved', type: 'success' });
      onSaved?.();
    } catch (err) {
      pushToast({ title: errText(err, 'Could not save the brand profile.'), type: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Resource state={state} what="The brand profile">
      <form className="hb-card hb-form" onSubmit={e => { e.preventDefault(); save(); }}>
        <div className="hb-card__head">
          <h3 className="hb-card__t hb-card__t--flush">
            Brand profile
            <span className="hb-card__hi" lang="hi">पहचान</span>
          </h3>
          <span className="hb-cap">Injected into every prompt run for this client.</span>
        </div>

        <div className="hb-grid hb-grid--2">
          <label className="hb-field hb-field--wide">
            <span className="hb-field__l">Brand voice</span>
            <textarea className="k-input hb-ta" rows={2}
              placeholder="e.g. Professional yet approachable, data-driven…"
              value={form.brand_voice || ''} onChange={e => set('brand_voice', e.target.value)} />
          </label>

          <label className="hb-field">
            <span className="hb-field__l">Tone</span>
            <select className="k-input" value={form.tone || 'professional'} onChange={e => set('tone', e.target.value)}>
              {TONES.map(t => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
            </select>
          </label>

          <label className="hb-field">
            <span className="hb-field__l">Tagline</span>
            <input className="k-input" value={form.tagline || ''} onChange={e => set('tagline', e.target.value)} />
          </label>

          <label className="hb-field hb-field--wide">
            <span className="hb-field__l">Target audience</span>
            <textarea className="k-input hb-ta" rows={2}
              placeholder="e.g. Small business owners in India, 25–45…"
              value={form.target_audience || ''} onChange={e => set('target_audience', e.target.value)} />
          </label>

          {[['color_primary', 'Primary colour', '#0082c6'], ['color_secondary', 'Secondary colour', '#05b7aa']].map(([k, label, fallback]) => (
            <label className="hb-field" key={k}>
              <span className="hb-field__l">{label}</span>
              <span className="hb-colour">
                <input className="hb-colour__in" type="color"
                  value={form[k] || fallback} onChange={e => set(k, e.target.value)} />
                {/* The stored value in text. A colour well alone tells you the
                    hue and nothing you can copy, paste or check against a
                    brand book. */}
                <output className="hb-colour__v hb-mono">{(form[k] || fallback).toUpperCase()}</output>
              </span>
            </label>
          ))}

          <label className="hb-field hb-field--wide">
            <span className="hb-field__l">Content do&rsquo;s</span>
            <textarea className="k-input hb-ta" rows={2}
              placeholder="e.g. Use data and statistics, include a call to action…"
              value={form.content_dos || ''} onChange={e => set('content_dos', e.target.value)} />
          </label>

          <label className="hb-field hb-field--wide">
            <span className="hb-field__l">Content don&rsquo;ts</span>
            <textarea className="k-input hb-ta" rows={2}
              placeholder="e.g. Avoid slang, never name a competitor…"
              value={form.content_donts || ''} onChange={e => set('content_donts', e.target.value)} />
          </label>
        </div>

        <div className="hb-form__foot">
          {/* Three states, not two. A client with no brand profile yet loads
              this form empty and un-dirty, and the two-state version then told
              them it was "Saved." — a claim about a record that does not
              exist, on the one field set that decides what every generated
              draft sounds like. */}
          <span className="hb-cap">
            {dirty ? 'Unsaved changes.' : brand ? 'Saved.' : 'Not saved yet.'}
          </span>
          <button type="submit" className="k-btn k-btn--primary" disabled={busy || !dirty || !canWrite} title={denial || undefined}>
            {busy ? 'Saving…' : 'Save brand profile'}
          </button>
        </div>
      </form>
    </Resource>
  );
}
