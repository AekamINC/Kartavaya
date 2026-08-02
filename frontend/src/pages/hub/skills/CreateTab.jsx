// Skill Packs → Create. Build a template once, assign it to any client.
import React, { useState } from 'react';
import { api } from '../../../lib/api';
import { useToast } from '../../../components/ui/toast';
import { errText, creditLabel, useResource } from '../_shared';
import {
  StepEditor, SkillGlyph, ICON_OPTIONS, CATEGORY_LABELS, estimateCredits, stepKind,
} from './_shared';

const BLANK = {
  name: '', description: '', category: 'general', icon: 'star',
  steps: [{ agent_type: 'social_media', prompt_template: '', platform: '' }],
};

/**
 * A step counts once it can actually run.
 *
 * This was `s.prompt_template.trim()`, which does two wrong things the moment a
 * data step exists: it throws on `undefined` — a data step has no prompt at all,
 * so opening the editor and switching one step to Data crashed the tab — and it
 * would then have filtered every data step out of the payload, silently
 * submitting a template missing exactly the steps that make it worth having.
 */
function isRunnable(step) {
  return stepKind(step) === 'data'
    ? !!step.skill_function
    : !!(step.prompt_template || '').trim();
}

export default function CreateTab({ costs, canManage, onCreated }) {
  const { pushToast } = useToast();
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);

  // What a step can be built out of, from the server. See `StepEditor`.
  const caps = useResource('/v1/hub/skills/capabilities', []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const valid = form.steps.filter(isRunnable);
  const est = estimateCredits(valid, costs);

  // A write step that has not been confirmed is refused by the server, so say
  // so here rather than letting someone press Create and read a 400.
  const unconfirmed = valid.filter(
    s => s.skill_function
      && (caps.data?.skill_functions || []).some(f => f.name === s.skill_function && f.writes)
      && !s.allow_writes,
  );

  if (!canManage) {
    return (
      <div className="note note--info hb-note" role="status">
        <b>Creating templates needs an admin grant.</b> Templates are shared across the whole
        organisation, so only an org owner, an org admin or a Srijan admin can add one. You can
        still assign an existing template to a client from the Catalog tab.
      </div>
    );
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim()) { pushToast({ title: 'Give the template a name.', type: 'error' }); return; }
    if (valid.length === 0) {
      pushToast({ title: 'At least one step needs a prompt or something to read.', type: 'error' });
      return;
    }
    if (unconfirmed.length) {
      pushToast({
        title: 'Confirm the steps that change data before creating this template.',
        type: 'error',
      });
      return;
    }
    setBusy(true);
    try {
      await api.post('/v1/hub/skills/templates', { ...form, steps: valid });
      pushToast({ title: 'Template created', type: 'success' });
      setForm(BLANK);
      onCreated?.();
    } catch (err) {
      pushToast({ title: errText(err, 'Could not create the template.'), type: 'error' });
    } finally { setBusy(false); }
  }

  return (
    <form className="hb-card hb-form" onSubmit={submit}>
      <div className="hb-card__head">
        <h3 className="hb-card__t hb-card__t--flush">
          Create a skill pack template
          <span className="hb-card__hi" lang="hi">नया</span>
        </h3>
        <span className="hb-cap">
          Steps run in order. An <b>AI step</b> writes something and costs credits; a{' '}
          <b>data step</b> reads your own records — invoices, KPIs, stock, attendance — and costs
          nothing. What a data step finds is handed to the steps after it, so the writing is done
          against real figures rather than in the abstract.
        </span>
      </div>

      <div className="hb-grid hb-grid--2">
        <label className="hb-field">
          <span className="hb-field__l">Template name <span className="hb-req" aria-hidden="true">*</span></span>
          <input className="k-input" required value={form.name} placeholder="e.g. Monthly newsletter pack"
            onChange={e => set('name', e.target.value)} />
        </label>

        <label className="hb-field">
          <span className="hb-field__l">Category</span>
          <select className="k-input" value={form.category} onChange={e => set('category', e.target.value)}>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>

        <label className="hb-field hb-field--wide">
          <span className="hb-field__l">Description</span>
          <textarea className="k-input hb-ta" rows={2} value={form.description}
            placeholder="What does this pack produce, and when should someone reach for it?"
            onChange={e => set('description', e.target.value)} />
        </label>
      </div>

      <fieldset className="hb-fs">
        <legend className="hb-field__l">Icon</legend>
        <div className="sk-icons">
          {ICON_OPTIONS.map(name => (
            <button type="button" key={name}
              className={`sk-icon${form.icon === name ? ' on' : ''}`}
              aria-pressed={form.icon === name} aria-label={name}
              onClick={() => set('icon', name)}>
              <SkillGlyph name={name} />
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="hb-fs">
        <legend className="hb-field__l">Steps</legend>
        {caps.error && (
          <div className="note note--warn hb-note" role="status">
            <b>The list of things a data step can read did not load.</b> {caps.error} AI steps
            still work; data steps and grounding are unavailable until this loads.
          </div>
        )}
        <StepEditor steps={form.steps} costs={costs} capabilities={caps.data}
          onChange={s => set('steps', s)} />
      </fieldset>

      <div className="hb-form__foot">
        <span className="hb-cap">
          {valid.length === 0
            ? 'No step has a prompt or a data source yet.'
            : est != null
              ? <>{valid.length} {valid.length === 1 ? 'step' : 'steps'} · about {creditLabel(est)} per run</>
              : <>{valid.length} {valid.length === 1 ? 'step' : 'steps'} · cost table unavailable</>}
        </span>
        <button type="submit" className="k-btn k-btn--primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create template'}
        </button>
      </div>
    </form>
  );
}
