// Skill Packs → Assigned. What this client can run, and the run itself.
import React, { useState } from 'react';
import { api } from '../../../lib/api';
import { useToast } from '../../../components/ui/toast';
import { Empty } from '../../../components/editorial';
import { Resource, StatusPill, errText, words, creditLabel } from '../_shared';
import { SkillGlyph, CATEGORY_TONE, CATEGORY_LABELS, parseSteps, extractVariables, estimateCredits } from './_shared';

export default function AssignedTab({ clientId, state, costs, onBrowse, onRan }) {
  const { pushToast } = useToast();
  const [runFor, setRunFor] = useState(null);   // the skill whose form is open
  const [vars, setVars] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);

  function openRun(skill) {
    const names = extractVariables(parseSteps(skill.steps));
    setVars(Object.fromEntries(names.map(n => [n, ''])));
    setRunFor(skill);
  }

  async function run(e) {
    e.preventDefault();
    const skill = runFor;
    setBusyId(skill.id);
    setRunFor(null);
    try {
      const r = await api.post(`/v1/hub/clients/${clientId}/skills/${skill.id}/run`, { variables: vars });
      pushToast({
        title: `${skill.template_name} finished — ${r.data.steps_completed} items, ${creditLabel(r.data.credits_used)}`,
        type: 'success',
      });
      onRan?.();
    } catch (err) {
      pushToast({ title: errText(err, 'The skill pack did not finish.'), type: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id) {
    try {
      await api.delete(`/v1/hub/clients/${clientId}/skills/${id}`);
      setConfirmDel(null);
      pushToast({ title: 'Skill removed from this client', type: 'success' });
      state.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'Could not remove it.'), type: 'error' });
    }
  }

  return (
    <Resource
      state={state}
      what="This client’s skill packs"
      empty={<Empty
        icon="generic"
        title="No skill packs assigned"
        sub="A skill pack runs several AI steps in order against this client’s brand profile."
        cta="Browse the catalog"
        onCta={onBrowse}
      />}
    >
      <div className="hb-list">
        {state.items?.map(skill => {
          const steps = parseSteps(skill.steps);
          const est = skill.estimated_credits || estimateCredits(steps, costs);
          return (
            <article className="hb-card sk-card" key={skill.id}>
              <div className="sk-card__head">
                <span className="sk-card__id">
                  <SkillGlyph name={skill.icon} />
                  <span>
                    <b className="sk-card__t">{skill.template_name}</b>
                    <span className="hb-cap sk-card__d">{skill.template_description || 'No description.'}</span>
                  </span>
                </span>
                <span className="sk-card__meta">
                  {skill.category && (
                    <StatusPill status={CATEGORY_LABELS[skill.category] || skill.category}
                      tone={CATEGORY_TONE[skill.category]} />
                  )}
                  <span className="hb-cap hb-mono">
                    {est != null ? `~${creditLabel(est)}` : 'cost unavailable'}
                  </span>
                </span>
              </div>

              <div className="sk-flow">
                {steps.length === 0 ? (
                  <span className="hb-cap">This pack has no steps — it will do nothing until one is added.</span>
                ) : steps.map((s, i) => (
                  <span className="sk-flow__s" key={i}>
                    <span className="sk-flow__n">{i + 1}</span>
                    {words(s.agent_type)}
                    {s.platform && <span className="hb-cap"> · {s.platform}</span>}
                  </span>
                ))}
              </div>

              {runFor?.id === skill.id ? (
                <form className="sk-run" onSubmit={run}>
                  {Object.keys(vars).length === 0 ? (
                    <p className="hb-cap">
                      This pack needs no inputs — it runs on the brand profile alone.
                    </p>
                  ) : (
                    <div className="hb-grid hb-grid--2">
                      {Object.keys(vars).map(k => (
                        <label className="hb-field" key={k}>
                          <span className="hb-field__l">{words(k)}</span>
                          <input className="k-input" value={vars[k]} required
                            placeholder={`Enter ${words(k)}…`}
                            onChange={e => setVars(v => ({ ...v, [k]: e.target.value }))} />
                        </label>
                      ))}
                    </div>
                  )}
                  <div className="hb-form__foot hb-form__foot--end">
                    <button type="button" className="k-btn k-btn--ghost hb-btn--sm" onClick={() => setRunFor(null)}>Cancel</button>
                    <button type="submit" className="k-btn k-btn--primary hb-btn--sm">
                      {est != null ? `Run · ${creditLabel(est)}` : 'Run'}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="sk-card__act">
                  <button type="button" className="k-btn k-btn--primary hb-btn--sm"
                    disabled={busyId === skill.id} onClick={() => openRun(skill)}>
                    {busyId === skill.id ? 'Running…' : 'Run skill pack'}
                  </button>
                  {confirmDel === skill.id ? (
                    <span className="sk-card__confirm">
                      <span className="hb-cap">Remove from this client?</span>
                      <button type="button" className="k-btn k-btn--ghost hb-btn--sm" onClick={() => setConfirmDel(null)}>Keep</button>
                      <button type="button" className="k-btn k-btn--ghost hb-btn--sm hb-btn--danger" onClick={() => remove(skill.id)}>Remove</button>
                    </span>
                  ) : (
                    <button type="button" className="k-btn k-btn--ghost hb-btn--sm hb-btn--danger"
                      onClick={() => setConfirmDel(skill.id)}>Remove</button>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </Resource>
  );
}
