// Srijan → Skills. The org's own skill packs, and the catalog to add from.
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Empty } from '../../components/editorial';
import { Resource, StatusPill, useList, errText } from '../hub/_shared';
import { SkillGlyph, CATEGORY_TONE, CATEGORY_LABELS, parseSteps, extractVariables, estimateCredits } from '../hub/skills/_shared';
import { AGENT_LABELS, LANGUAGES, words } from './_shared';

export default function SkillsTab({ canAssign, costs, onSpent }) {
  const { pushToast } = useToast();
  const mine = useList('/v1/hub/org/skills', []);
  const catalog = useList('/v1/hub/skills/templates', []);

  const [pane, setPane] = useState('mine');
  const [openId, setOpenId] = useState(null);
  const [vars, setVars] = useState({ brand_name: '', language: 'en' });
  const [withImages, setWithImages] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [result, setResult] = useState(null);

  const assignedIds = new Set((mine.items || []).map(s => s.template_id));
  const available = (catalog.items || []).filter(t => !assignedIds.has(t.id));

  async function assign(id) {
    setBusyId(id);
    try {
      await api.post(`/v1/hub/org/skills/${id}`, { custom_config: {} });
      pushToast({ title: 'Added to your organisation', type: 'success' });
      mine.reload();
      setPane('mine');
    } catch (err) {
      pushToast({ title: errText(err, 'Could not add the skill.'), type: 'error' });
    } finally { setBusyId(null); }
  }

  async function run(e, skill) {
    e.preventDefault();
    setBusyId(skill.id);
    setResult(null);
    try {
      const r = await api.post(`/v1/hub/org/skills/${skill.id}/run`, {
        variables: vars, generate_images: withImages,
      });
      setResult({ id: skill.id, ...r.data });
      onSpent?.();
      pushToast({ title: `${skill.template_name || skill.name} finished`, type: 'success' });
    } catch (err) {
      pushToast({ title: errText(err, 'The skill run failed.'), type: 'error' });
    } finally { setBusyId(null); }
  }

  return (
    <div>
      <div className="hb-filters" role="group" aria-label="Skill view">
        {[['mine', 'Active'], ['catalog', 'Catalog']].map(([k, l]) => (
          <button type="button" key={k} className={`hb-chip${pane === k ? ' on' : ''}`}
            aria-pressed={pane === k} onClick={() => setPane(k)}>
            {l}
            <span className="hb-chip__n">{k === 'mine' ? (mine.items?.length ?? '–') : (catalog.items ? available.length : '–')}</span>
          </button>
        ))}
      </div>

      {pane === 'mine' && (
        <Resource
          state={mine}
          what="Your organisation’s skills"
          empty={<Empty
            icon="generic"
            title="No skills added yet"
            sub="A skill pack runs several AI steps in order and drops the results into your content library."
            cta="Browse the catalog"
            onCta={() => setPane('catalog')}
          />}
        >
          <div className="hb-list">
            {mine.items?.map(skill => {
              const steps = parseSteps(skill.steps).sort((a, b) => (a.order || 0) - (b.order || 0));
              const open = openId === skill.id;
              const est = skill.estimated_credits ?? estimateCredits(steps, costs);
              const needed = extractVariables(steps);
              return (
                <article className="hb-card sk-card" key={skill.id}>
                  <div className="sk-card__head">
                    <span className="sk-card__id">
                      <SkillGlyph name={skill.icon} />
                      <span>
                        <b className="sk-card__t">{skill.template_name || skill.name}</b>
                        <span className="hb-cap sk-card__d">
                          {skill.description || `${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`}
                        </span>
                      </span>
                    </span>
                    <span className="sk-card__meta">
                      {skill.category && (
                        <StatusPill status={CATEGORY_LABELS[skill.category] || skill.category}
                          tone={CATEGORY_TONE[skill.category]} />
                      )}
                      <button type="button" className="k-btn k-btn--ghost hb-btn--sm"
                        aria-expanded={open}
                        onClick={() => { setOpenId(open ? null : skill.id); setResult(null); }}>
                        {open ? 'Close' : 'Run'}
                      </button>
                    </span>
                  </div>

                  <div className="sk-flow">
                    {steps.map((s, i) => (
                      <span className="sk-flow__s" key={i}>
                        <span className="sk-flow__n">{s.order || i + 1}</span>
                        {AGENT_LABELS[s.agent_type] || words(s.agent_type)}
                        {s.platform && <span className="hb-cap"> · {s.platform}</span>}
                      </span>
                    ))}
                  </div>

                  {open && (
                    <form className="sk-run" onSubmit={e => run(e, skill)}>
                      <div className="hb-grid hb-grid--2">
                        <label className="hb-field">
                          <span className="hb-field__l">Brand name</span>
                          <input className="k-input" placeholder="Your brand name" value={vars.brand_name}
                            onChange={e => setVars(v => ({ ...v, brand_name: e.target.value }))} />
                        </label>
                        <label className="hb-field">
                          <span className="hb-field__l">Language</span>
                          <select className="k-input" value={vars.language}
                            onChange={e => setVars(v => ({ ...v, language: e.target.value }))}>
                            {LANGUAGES.map(([val, l]) => <option key={val} value={val}>{l}</option>)}
                          </select>
                        </label>
                        {/* The prompts' own placeholders, which the previous
                            version never asked for — it sent two fixed variables
                            and left every `{topic}` in the template unfilled. */}
                        {needed.filter(n => !['brand_name', 'language'].includes(n)).map(n => (
                          <label className="hb-field" key={n}>
                            <span className="hb-field__l">{words(n)}</span>
                            <input className="k-input" value={vars[n] || ''} required
                              placeholder={`Enter ${words(n)}…`}
                              onChange={e => setVars(v => ({ ...v, [n]: e.target.value }))} />
                          </label>
                        ))}
                      </div>

                      <label className="sk-check">
                        <input type="checkbox" checked={withImages} onChange={e => setWithImages(e.target.checked)} />
                        <span>Generate an image for each step</span>
                      </label>

                      <div className="hb-form__foot">
                        <span className="hb-cap">
                          {est != null ? `About ${est} credits${withImages ? ', more with images' : ''}` : 'Cost table unavailable'}
                        </span>
                        <button type="submit" className="k-btn k-btn--primary" disabled={busyId === skill.id}>
                          {busyId === skill.id ? 'Running…' : 'Run now'}
                        </button>
                      </div>

                      {result?.id === skill.id && (
                        <div className="note note--info sr-done" role="status">
                          <b>Finished — {result.steps_completed} steps, {result.credits_used} credits.</b>{' '}
                          {result.content_ids?.length || 0} items are waiting in the Content tab.
                        </div>
                      )}
                    </form>
                  )}
                </article>
              );
            })}
          </div>
        </Resource>
      )}

      {pane === 'catalog' && (
        <Resource
          state={catalog}
          what="The skill catalog"
          empty={<Empty icon="generic" title="The catalog is empty"
            sub="No skill pack templates exist for this organisation yet." />}
        >
          {available.length === 0 ? (
            <p className="hb-none">Every template in the catalog is already active on your organisation.</p>
          ) : (
            <div className="hb-cards">
              {available.map(t => {
                const steps = parseSteps(t.steps);
                const est = t.estimated_credits ?? estimateCredits(steps, costs);
                return (
                  <article className="hb-card sk-card" key={t.id}>
                    <div className="sk-card__head">
                      <span className="sk-card__id">
                        <SkillGlyph name={t.icon} />
                        <b className="sk-card__t">{t.name}</b>
                      </span>
                      {t.category && (
                        <StatusPill status={CATEGORY_LABELS[t.category] || t.category} tone={CATEGORY_TONE[t.category]} />
                      )}
                    </div>
                    <p className="hb-cap sk-card__d">{t.description || 'No description.'}</p>
                    <div className="hb-cap hb-mono sk-card__cost">
                      {steps.length} {steps.length === 1 ? 'step' : 'steps'}
                      {est != null && <> · ~{est} credits per run</>}
                    </div>
                    <div className="sk-card__act">
                      <button type="button" className="k-btn k-btn--primary hb-btn--sm sk-card__go"
                        disabled={busyId === t.id || !canAssign} onClick={() => assign(t.id)}>
                        {busyId === t.id ? 'Adding…' : canAssign ? 'Add to organisation' : 'Needs an admin'}
                      </button>
                    </div>
                    {!canAssign && (
                      <p className="hb-cap">
                        Adding a skill changes what the whole organisation can run, so it needs an
                        owner, an org admin or a Srijan admin.
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </Resource>
      )}
    </div>
  );
}
