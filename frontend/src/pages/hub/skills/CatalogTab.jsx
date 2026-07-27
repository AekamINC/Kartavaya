// Skill Packs → Catalog. Templates the org owns, minus the ones already
// assigned to this client.
//
// "Delete" here deactivates the template ORG-WIDE, not for this client — the
// button sat next to "Assign to Client" with no indication of that, one
// mis-click away from removing a template every other client also uses. It now
// says what it does and asks first.
import React, { useState } from 'react';
import { api } from '../../../lib/api';
import { useToast } from '../../../components/ui/toast';
import { Empty } from '../../../components/editorial';
import { Resource, StatusPill, errText, words, creditLabel } from '../_shared';
import { SkillGlyph, CATEGORY_TONE, CATEGORY_LABELS, parseSteps, estimateCredits } from './_shared';

export default function CatalogTab({ clientId, state, available, costs, canManage, onCreate, onChanged }) {
  const { pushToast } = useToast();
  const [busyId, setBusyId] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);

  async function assign(id) {
    setBusyId(id);
    try {
      await api.post(`/v1/hub/clients/${clientId}/skills/${id}`, {});
      pushToast({ title: 'Skill pack assigned', type: 'success' });
      onChanged?.();
    } catch (err) {
      pushToast({ title: errText(err, 'Could not assign it.'), type: 'error' });
    } finally { setBusyId(null); }
  }

  async function deactivate(id) {
    try {
      await api.delete(`/v1/hub/skills/templates/${id}`);
      setConfirmDel(null);
      pushToast({ title: 'Template deactivated for the whole organisation', type: 'success' });
      onChanged?.();
    } catch (err) {
      pushToast({ title: errText(err, 'Could not deactivate it.'), type: 'error' });
    }
  }

  return (
    <Resource
      state={state}
      what="The skill pack catalog"
      empty={<Empty
        icon="generic"
        title="No templates yet"
        sub="A template is a reusable workflow — build one and assign it to as many clients as you like."
        cta={canManage ? 'Create a template' : undefined}
        onCta={canManage ? onCreate : undefined}
      />}
    >
      {available.length === 0 ? (
        <p className="hb-none">
          Every template in the catalog is already assigned to this client.
        </p>
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

                <div className="sk-flow">
                  {steps.map((s, i) => (
                    <span className="sk-flow__s" key={i}>
                      <span className="sk-flow__n">{i + 1}</span>{words(s.agent_type)}
                    </span>
                  ))}
                </div>

                <div className="hb-cap hb-mono sk-card__cost">
                  {steps.length} {steps.length === 1 ? 'step' : 'steps'}
                  {est != null && <> · ~{creditLabel(est)} per run</>}
                </div>

                <div className="sk-card__act">
                  <button type="button" className="k-btn k-btn--primary hb-btn--sm sk-card__go"
                    disabled={busyId === t.id} onClick={() => assign(t.id)}>
                    {busyId === t.id ? 'Assigning…' : 'Assign to this client'}
                  </button>
                  {canManage && (confirmDel === t.id ? (
                    <span className="sk-card__confirm">
                      {/* The blast radius, in the confirmation, because the button
                          label cannot carry it. */}
                      <span className="hb-cap hb-cap--bad">
                        Deactivates &ldquo;{t.name}&rdquo; for every client in the org.
                      </span>
                      <button type="button" className="k-btn k-btn--ghost hb-btn--sm" onClick={() => setConfirmDel(null)}>Keep</button>
                      <button type="button" className="k-btn k-btn--ghost hb-btn--sm hb-btn--danger" onClick={() => deactivate(t.id)}>Deactivate</button>
                    </span>
                  ) : (
                    <button type="button" className="k-btn k-btn--ghost hb-btn--sm hb-btn--danger"
                      onClick={() => setConfirmDel(t.id)}>Deactivate</button>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </Resource>
  );
}
