/**
 * SkillsPane — the skills for this page, and running one without leaving it.
 *
 * The defect proposal 71 is written against is a PATH, not a feature: a skill
 * is reachable at Sahayak → Skills → Catalog → add → Active → run, which is
 * five clicks from the page where somebody is actually staring at the ageing
 * receivables list. Everything here exists to make that path one click on the
 * page they are already on.
 *
 * ── What it will not do ─────────────────────────────────────────────────────
 *
 * · It never posts `generate_images: true`. Images add three credits per AI
 *   step and are NOT in `estimated_credits`, so a dock offering them would be
 *   quoting a price it then exceeds. The toggle lives in Sahayak, next to the
 *   cost line that accounts for it.
 * · It never asks for a variable. A skill whose prompts carry `{topic}` needs
 *   a form; a form does not belong in a 360px popover, and `SkillsTab` already
 *   has one. Those rows say so and open Sahayak.
 * · It never installs. `assign_skill_to_org` is platform-tier by design
 *   (OPERATIONS_CONSOLE_ROLES holds no org role), so a button here could only
 *   ever 403. The row says who turns it on instead.
 *
 * ── The run itself ──────────────────────────────────────────────────────────
 *
 * `POST /v1/hub/org/skills/{id}/run` — the same call `pages/sahayak/SkillsTab`
 * makes, with the same body shape, so there is one run path in the product and
 * not two. The id is the ORG SKILL id; posting a template id 404s.
 *
 * A 403 from that route is `assert_step_access` refusing a module the caller
 * does not hold, and it arrives with the server's own sentence naming which
 * module. It is rendered IN THE ROW rather than as a toast: a toast vanishes
 * and leaves the button looking like it might work next time.
 */
import React, { useState } from 'react';
import { api } from '../../../lib/api';
import { errText } from '../../../pages/hub/_shared';
import { blockersFor } from '../../../pages/hub/skills/_shared';
import DockRow, { DockEmpty, DockRestricted } from './DockRow';
import { costLabel, summariseOutput } from './dockItems';

/** The one reason a row cannot be run, chosen in the order the user meets it. */
function blockReason(skill, caps) {
  if (!skill.active) return 'Not on your organisation — Aekam turns this on';
  const serverBlockers = blockersFor(skill.steps, caps);
  if (serverBlockers?.length) return serverBlockers[0];
  if (skill.missingModules.length) {
    return `Needs the ${skill.missingModules.join(' and ')} module`;
  }
  if (skill.asks.length) return 'Asks a question first — opens in Sahayak';
  return '';
}

export default function SkillsPane({
  page, skills, caps, restricted, listId, cursor, onCursor, onGo,
}) {
  const [open, setOpen] = useState(null);      // the selected skill's key
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [failed, setFailed] = useState('');

  if (restricted) {
    return <DockRestricted
      what="Skills"
      who="Sahayak is not one of your modules. Ask your org admin for access." />;
  }

  if (!skills.length) {
    return <DockEmpty
      title="No skill on the shelf touches this page yet."
      body={page.note
        || `Nothing in the catalogue is scoped to ${page.label}.`}
      hint="Noted — we build where this gets opened. Try Automations or Numbers." />;
  }

  const selected = skills.find(s => s.key === open);

  if (selected) {
    const reason = blockReason(selected, caps);
    return (
      <div className="k-dock__detail">
        <button type="button" className="k-dock__back"
          onClick={() => { setOpen(null); setResult(null); setFailed(''); }}>
          ← back
        </button>
        <h4 className="k-dock__dh">{selected.name}</h4>
        {selected.description && (
          <p className="k-dock__why">{selected.description}</p>
        )}

        {/* WHAT IT DOES, BEFORE IT RUNS. `runIntent` derives this from the
            capability list, so a `brief` whose step is in WRITE_SKILL_FUNCTIONS
            reads "CHANGES DATA" rather than "reads only". */}
        <p className="k-dock__fine">
          {selected.type} · {costLabel(selected.cost)} · {selected.intent}
        </p>

        <ul className="k-dock__steps">
          {selected.steps.map((s, i) => (
            <li className="k-dock__step" key={i}>
              {s.skill_function
                ? `${s.label || s.skill_function} — reads your data`
                : `${s.agent_type || 'AI step'} — writes text`}
            </li>
          ))}
        </ul>

        <div className="k-dock__act">
          {reason
            ? <span className="k-dock__flag">{reason}</span>
            : (
              <button type="button" className="k-btn k-btn--primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true); setFailed(''); setResult(null);
                  try {
                    // Images OFF, always. See the header.
                    const r = await api.post(
                      `/v1/hub/org/skills/${selected.runId}/run`,
                      { variables: {}, generate_images: false });
                    // The run response carries counts, not findings. The
                    // findings are on the run ROW, which this reads back — the
                    // alternative is telling somebody "4 steps finished" and
                    // making them navigate to see what was found.
                    let outputs = [];
                    try {
                      const runs = await api.get(
                        `/v1/hub/org/skills/${selected.runId}/runs`);
                      const list = runs.data?.data || runs.data || [];
                      const mine = list.find(x => x.id === r.data?.run_id) || list[0];
                      // `outputs` is jsonb and this codebase has been bitten by
                      // that before — `parseSteps` exists because `steps` on the
                      // same table arrives as text from some routes and as an
                      // array from others. Tolerate both rather than render
                      // nothing on the day the codec changes.
                      const raw = typeof mine?.outputs === 'string'
                        ? JSON.parse(mine.outputs) : mine?.outputs;
                      outputs = (Array.isArray(raw) ? raw : [])
                        .filter(o => o?.skill_function);
                    } catch { /* the run succeeded; its detail is a bonus */ }
                    setResult({ ...r.data, outputs });
                  } catch (err) {
                    setFailed(errText(err, 'The skill run failed.'));
                  } finally { setBusy(false); }
                }}>
                {busy ? 'Running…' : 'Run now'}
              </button>
            )}
          <button type="button" className="k-dock__footlink"
            onClick={() => onGo('/hub/org?tab=skills')}>
            Open in Sahayak
          </button>
        </div>

        {failed && <p className="k-dock__err" role="status">{failed}</p>}

        {result && (
          <div className="k-dock__out" role="status">
            <b>
              Finished — {result.steps_completed}{' '}
              {result.steps_completed === 1 ? 'step' : 'steps'},{' '}
              {result.credits_used} {result.credits_used === 1 ? 'credit' : 'credits'}.
            </b>
            {result.outputs.map((o, i) => {
              const s = summariseOutput(o);
              return (
                <span className="k-dock__outblock" key={i}>
                  <span className="k-dock__outlabel">{s.label}</span>
                  {/* Keyed on the INDEX, not on `k`. A findings list can
                      easily carry two rows with the same label — two follow-ups
                      on one client — and React would drop the second. And the
                      colon is omitted when there is no label: the overflow line
                      ("and 14 more") is a sentence, not a field. */}
                  {s.lines.map(([k, v], j) => (
                    <span className="k-dock__outline" key={j}>
                      {k ? `${k}: ` : ''}{v}
                    </span>
                  ))}
                  {s.truncated && (
                    <span className="k-dock__outline">
                      The finding is longer than this — open it in Sahayak.
                    </span>
                  )}
                </span>
              );
            })}
            {(result.content_ids?.length || 0) > 0 && (
              <span className="k-dock__outline">
                {result.content_ids.length}{' '}
                {result.content_ids.length === 1 ? 'item is' : 'items are'} waiting
                in the Content tab.
              </span>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="k-dock__list" role="listbox" id={listId}
      aria-label={`Skills for ${page.label}`}>
      {skills.map((s, i) => {
        const reason = blockReason(s, caps);
        return (
          <DockRow
            key={s.key}
            id={`${listId}-${i}`}
            tone={s.type}
            name={s.name}
            meta={`${s.type} · ${costLabel(s.cost)} · ${s.intent}`}
            go="Run"
            reason={reason}
            selected={cursor === i}
            onSelect={() => { onCursor(i); setOpen(s.key); }}
          />
        );
      })}
    </div>
  );
}
