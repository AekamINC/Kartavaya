// Vocabulary and the step editor shared by the Skill Packs tabs.
//
// ── The emoji ────────────────────────────────────────────────────────────────
//
// `HubSkillsPage` rendered a skill's icon as one of 📅 🚀 🎬 🔍 📢 ⭐ at 24px.
// 07-pahchan.md §175 is explicit that the design system has no emoji, and
// `ui/EmptyState.jsx` already carries that fix forward with a named-glyph map.
// The stored value is still `calendar` / `rocket` / …, so nothing in the
// database changes — only what those names render as.
import React from 'react';

const S = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true };

export const GLYPHS = {
  calendar: (
    <svg {...S}><rect x="3.5" y="5" width="17" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
  ),
  rocket: (
    <svg {...S}><path d="M13.5 4.5c3.4-1.3 6 1.3 4.7 4.7-1 2.6-4 5.6-6.7 7l-3-3c1.4-2.7 4.4-5.7 5-8.7z"
      stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M8.5 13.2 5 16.7M6.8 18.5 5 20.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
  ),
  video: (
    <svg {...S}><rect x="3" y="6.5" width="12" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="m15 11 6-3v8l-6-3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
  ),
  search: (
    <svg {...S}><circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="m16 16 4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
  ),
  megaphone: (
    <svg {...S}><path d="M4 10v4a1.5 1.5 0 0 0 1.5 1.5H8l8 4.5V5L8 9.5H5.5A1.5 1.5 0 0 0 4 11z"
      stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M19 9.5a4 4 0 0 1 0 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
  ),
  star: (
    <svg {...S}><path d="m12 3.8 2.6 5.3 5.9.85-4.25 4.15 1 5.9L12 17.15 6.75 20l1-5.9L3.5 9.95l5.9-.85z"
      stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
  ),
};

export const ICON_OPTIONS = Object.keys(GLYPHS);

export function SkillGlyph({ name }) {
  return <span className="sk-glyph" aria-hidden="true">{GLYPHS[name] || GLYPHS.star}</span>;
}

/** Category → token. Was a map of raw hexes tinted with a `${c}18` suffix. */
export const CATEGORY_TONE = {
  general: 'var(--on-surface-3)',
  festival: 'var(--warn)',
  launch: 'var(--danger)',
  engagement: 'var(--ok)',
  branding: 'var(--st-in-progress)',
  seasonal: 'var(--st-in-review)',
  industry: 'var(--tertiary)',
};

export const CATEGORY_LABELS = {
  general: 'General', festival: 'Festival', launch: 'Launch',
  engagement: 'Engagement', branding: 'Branding', seasonal: 'Seasonal', industry: 'Industry',
};

/**
 * The agent types a step can call.
 *
 * The per-agent credit cost is deliberately NOT hard-coded here. It was — as
 * `{ value: 'blog', credits: 5 }` — and the server owns that table
 * (`CREDIT_COSTS`, served on `/v1/hub/org/credits`). Two copies of a price list
 * is one copy that goes stale silently, and the stale one was in the UI telling
 * people what a run would cost. Costs are fetched and passed in as `costs`;
 * where they have not loaded, the label renders without a number rather than
 * with a wrong one.
 */
export const AGENT_TYPES = [
  ['social_media', 'Social Media'], ['blog', 'Blog'], ['ad_copy', 'Ad Copy'],
  ['email', 'Email'], ['whatsapp', 'WhatsApp'], ['lead_magnet', 'Lead Magnet'],
  ['campaign', 'Campaign Strategy'], ['seo', 'SEO Content'],
];

/** `steps` may arrive as a JSON string from the API. One place that decides. */
export function parseSteps(steps) {
  if (Array.isArray(steps)) return steps;
  if (typeof steps === 'string') {
    try { const v = JSON.parse(steps); return Array.isArray(v) ? v : []; } catch { return []; }
  }
  return [];
}

/** `{topic}` placeholders a run has to be asked for. */
export function extractVariables(steps) {
  const out = new Set();
  for (const s of steps || []) {
    for (const m of String(s.prompt_template || '').match(/\{(\w+)\}/g) || []) {
      const name = m.slice(1, -1);
      if (!['platform', 'brief', 'extra'].includes(name)) out.add(name);
    }
  }
  return [...out];
}

/** The sum a run will cost, or null when the cost table is unavailable. */
export function estimateCredits(steps, costs) {
  if (!costs) return null;
  return parseSteps(steps).reduce((n, s) => n + (costs[s.agent_type] ?? 0), 0);
}

export function StepEditor({ steps, costs, onChange }) {
  const update = (i, k, v) => onChange(steps.map((s, j) => (i === j ? { ...s, [k]: v } : s)));

  return (
    <div className="sk-steps">
      {steps.map((step, i) => (
        <div className="sk-step" key={i}>
          <div className="sk-step__head">
            <span className="sk-step__n">Step {i + 1}</span>
            {steps.length > 1 && (
              <button type="button" className="k-btn k-btn--ghost hb-btn--sm hb-btn--danger"
                onClick={() => onChange(steps.filter((_, j) => j !== i))}>Remove</button>
            )}
          </div>

          <div className="hb-grid hb-grid--2">
            <label className="hb-field">
              <span className="hb-field__l">Agent type</span>
              <select className="k-input" value={step.agent_type}
                onChange={e => update(i, 'agent_type', e.target.value)}>
                {AGENT_TYPES.map(([v, l]) => (
                  <option key={v} value={v}>{costs?.[v] != null ? `${l} — ${costs[v]} cr` : l}</option>
                ))}
              </select>
            </label>
            <label className="hb-field">
              <span className="hb-field__l">Platform</span>
              <input className="k-input" placeholder="e.g. instagram, linkedin"
                value={step.platform || ''} onChange={e => update(i, 'platform', e.target.value)} />
            </label>
          </div>

          <label className="hb-field">
            <span className="hb-field__l">
              Prompt template
              <span className="hb-field__hint">
                Wrap a value in braces to ask for it at run time — <code className="hb-code">{'{topic}'}</code>
              </span>
            </span>
            <textarea className="k-input hb-ta" rows={3} value={step.prompt_template}
              onChange={e => update(i, 'prompt_template', e.target.value)}
              placeholder="Write a social media post about {topic}. Include hashtags and a call to action." />
          </label>
        </div>
      ))}

      <button type="button" className="k-btn k-btn--ghost hb-btn--sm sk-steps__add"
        onClick={() => onChange([...steps, { agent_type: 'social_media', prompt_template: '', platform: '' }])}>
        Add a step
      </button>
    </div>
  );
}
