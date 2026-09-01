// The skill detail drawer — the end of a terminal card.
//
// ── What this is for ─────────────────────────────────────────────────────────
//
// A skill card said what a pack costs and offered one button that most people
// cannot press: `assign_skill_to_org` is `require_platform_role(*
// OPERATIONS_CONSOLE_ROLES)` and every one of those five roles is platform
// tier, so no org-tier account can turn a skill on for itself. That constraint
// is deliberate and it is not what was wrong. What was wrong is that the
// product's answer to the customer was the sentence "Assigning a template is an
// Aekam function. Ask your account contact." and then nothing — no detail, no
// permissions, no way to ask. The card was the end of the road.
//
// So this drawer spends its space on the two questions a requester actually has
// and the product could already answer, and then lets them ask.
//
//   · WHAT IT READS AND WHAT IT CHANGES, per step.
//     `/v1/hub/skills/capabilities` has answered this all along — every
//     `skill_functions` entry carries `kind`, `writes`, `needs` and
//     `available` — and no screen showed it. `permissionsFor` below turns the
//     steps plus that list into the sentence "this one reads your overdue
//     invoices" and "this one raises invoices". It is derived, never guessed:
//     with no capability list the block says the permissions were NOT CHECKED
//     rather than showing an empty list, because an empty list reads as "it
//     touches nothing" and that is the most dangerous thing this screen could
//     say.
//
//   · WHAT A RUN COSTS, from the live price table and nowhere else.
//     `packPrice` is the one rule, shared with the card. `estimated_credits` is
//     a stored column `routers/hub.py` itself calls "an ESTIMATE that prices
//     nothing"; it is used only when the live table did not load and is
//     labelled as stored when it is. With neither, the cost row says the cost
//     is unavailable — a wrong price on a screen someone buys from is worse
//     than a missing one.
//
// ── SKILLS ARE REQUESTED, NOT INSTALLED ──────────────────────────────────────
//
// There is no self-serve install path here and there is not one behind a flag
// either. A button that 403s is worse than one that is honest about who presses
// it, so the footer says plainly that Aekam turns it on, says WHY (adding a
// skill changes what everyone in the org can run and what it costs), and makes
// the note the point of the interaction rather than a form field.
//
// ── `permissions` ON THE TEMPLATE IS NOT READ ────────────────────────────────
//
// Migration 112 adds `hub_skill_templates.permissions JSONB` for a stated
// permission set, NULL meaning "not stated". It is deliberately not consumed
// here: the column is unapplied, and on the day it lands it is NULL on all
// nineteen rows, so reading it would add a second code path whose only possible
// output today is a blank panel — over a derivation from `capabilities` that is
// live, correct and already available. When something populates it, this is
// where it goes, and it should WIN over the derivation rather than sit beside
// it.
import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import useExitAnimation from '../../hooks/useExitAnimation';
import { errText, words, creditLabel } from '../../pages/hub/_shared';
import { GLYPHS, stepKind, SkillFit } from '../../pages/hub/skills/_shared';

/* ── Marks ───────────────────────────────────────────────────────────────────
   Local and tiny. `components/editorial` owns the product's icon set and none
   of its entries are these five; a section rule that needs a 13px tick is not
   worth a round trip through a shared map it would be the only user of. */
const MARK = { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true };

const Ic = {
  read: (
    <svg {...MARK}><path d="M6 3.5h7l5 5V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20V4a.5.5 0 0 1 .5-.5z"
      stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M13 3.5V9h5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
  ),
  write: (
    <svg {...MARK}><path d="M4 20h16M6 15.5 16.5 5a2.1 2.1 0 0 1 3 3L9 18.5l-4 1z"
      stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
  ),
  steps: (
    <svg {...MARK}><path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
  ),
  cost: (
    <svg {...MARK}><path d="M7 4.5h10M7 9h10M7 4.5c5 0 6 1.5 6 4S12 12.5 7 12.5h2l7 7"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  lock: (
    <svg {...MARK}><rect x="5" y="10" width="14" height="10.5" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8.5 10V7.5a3.5 3.5 0 1 1 7 0V10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
  ),
  spark: (
    <svg {...MARK}><path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 20.5l-1.8-7.9L4.5 10.8 10.2 9z"
      stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
  ),
};

/**
 * What each step reads and what it changes, from the capability list.
 *
 * Returns `null` when `caps` has not loaded. NULL IS NOT `[]`. An empty list
 * renders as "this skill touches nothing", which is a claim; null renders as
 * "not checked", which is the truth. The same distinction `blockersFor` makes
 * and for the same reason.
 *
 * Two kinds of read are folded together on purpose — the records a data step
 * pulls (`skill_function`) and the grounding a prompt is given
 * (`step.context`) — because from the org's point of view they are the same
 * fact: this step saw that data. The dispatcher treats them differently; a
 * person deciding whether to ask for the skill does not.
 */
export function permissionsFor(steps, caps) {
  if (!caps) return null;
  const byName = Object.fromEntries((caps.skill_functions || []).map(f => [f.name, f]));
  const sources = Object.fromEntries((caps.context_sources || []).map(s => [s.key, s.label]));

  return (steps || []).map((step, i) => {
    const kind = stepKind(step);
    const reads = [];
    const writes = [];

    if (kind === 'data' && step.skill_function) {
      const meta = byName[step.skill_function];
      const label = words(step.skill_function);
      if (meta?.writes) {
        // The dispatcher refuses a write function whose step did not opt in
        // (`skill_dispatcher.py:401`), so this is not a write that WILL happen
        // — it is a step that would stop the run. Said as such rather than
        // listed under "changes", which would over-report, or omitted, which
        // would hide a step that cannot run.
        if (step.allow_writes) writes.push(label);
        else writes.push(`${label} — the step does not allow writes, so a run refuses it`);
      } else {
        reads.push(label);
      }
    }
    for (const key of step.context || []) reads.push(sources[key] || words(key));

    return {
      n: i + 1,
      kind,
      title: kind === 'data' ? 'Reads your data' : 'Writes with AI',
      detail: kind === 'data'
        ? (words(step.skill_function) || 'nothing chosen')
        : (words(step.agent_type) || 'an AI step'),
      cost: kind === 'data' ? 'free' : 'metered',
      reads,
      writes,
    };
  });
}

/** The tile. One saturated ground, one flat white mark — see marketplace.css. */
export function SkillTile({ icon, tone }) {
  return (
    <span className="mk-g" style={{ '--mc': tone }} aria-hidden="true">
      {GLYPHS[icon] || GLYPHS.star}
    </span>
  );
}

/**
 * Available → Requested → Active, and nothing else.
 *
 * `blocked` is not a fourth state of the same axis — it says the server cannot
 * run the steps, which is true regardless of whether the org has the skill —
 * so it is passed separately and wins, because there is no point telling
 * somebody they may ask for something that would not run.
 */
export function SkillStatusPill({ status, at }) {
  if (status === 'active') return <span className="mk-st mk-st--active">Active</span>;
  if (status === 'requested') {
    return (
      <span className="mk-st mk-st--requested">
        Requested{at ? ` · ${at}` : ''}
      </span>
    );
  }
  if (status === 'blocked') return <span className="mk-st mk-st--blocked">Cannot run</span>;
  return null;
}

/** `2026-08-06T10:00:00Z` → `6 Aug 2026`. Absolute, never "2 days ago". */
function onDay(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function SkillDrawer({
  open, pack, caps, request, active, canAssign, assignBlocked, busy,
  onAssign, onClose, onRequested,
}) {
  /* THE EXIT. Six overlays in this product shipped with an entrance and no exit
     — they rose into place and then ceased to exist between two frames. This
     drawer's `open` comes from the parent and has already flipped by the time
     it hears about it, so something has to hold the node there while
     `.is-closing` plays; that is the whole job of this hook. The unmount is
     driven by `animationend` and never a constant, because the CSS duration is
     `calc(360ms * var(--ix))` and `--ix` is a runtime preference no number here
     could track. */
  const { alive, closing, onAnimationEnd } = useExitAnimation(open);
  const { t, steps, ai, data, tone, live, listed, blockers } = pack;
  const closeRef = useRef(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  // The server's own sentence when the request table does not exist yet. Held
  // in state rather than raised as a toast: a toast disappears and leaves the
  // button looking like it might work next time.
  const [dormant, setDormant] = useState('');
  const [failed, setFailed] = useState('');
  const [justSent, setJustSent] = useState(null);

  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!alive) return null;

  const held = !!blockers?.length;
  const pending = justSent || request;
  const perms = permissionsFor(steps, caps);
  const reads = perms ? [...new Set(perms.flatMap(p => p.reads))] : null;
  const writes = perms ? [...new Set(perms.flatMap(p => p.writes))] : null;

  const status = active ? 'active' : held ? 'blocked' : pending ? 'requested' : 'available';

  async function request_() {
    setSending(true);
    setFailed('');
    try {
      const r = await api.post(`/v1/hub/skills/${t.id}/request`, { note });
      setJustSent(r.data);
      onRequested?.(r.data);
    } catch (err) {
      // 503 is the ONE failure that is not the user's problem and not
      // transient: migration 112 is a file and nothing in application code
      // applies it. The endpoint says in as many words that the request was NOT
      // recorded, and that sentence is shown where the button was rather than
      // in a toast that vanishes.
      if (err?.response?.status === 503) setDormant(errText(err));
      else setFailed(errText(err, 'The request could not be sent.'));
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {/* A real button, not a div with onClick: the scrim is a way out of the
          drawer and a way out has to be reachable from the keyboard. */}
      <button type="button" className={`mk-dr__scrim${closing ? ' is-closing' : ''}`}
        aria-label="Close" onClick={onClose} />
      {/* `onAnimationEnd` is bound to the PANEL and not the scrim: the two leave
          together and the panel is the one whose travel has to complete. */}
      <aside className={`mk-dr${closing ? ' is-closing' : ''}`} onAnimationEnd={onAnimationEnd}
        role="dialog" aria-modal="true" aria-label={t.name}>
        <div className="mk-dr__hd" style={{ '--mc': tone }}>
          <SkillTile icon={t.icon} tone={tone} />
          <div className="mk-dr__id">
            <div className="mk-c__n">{t.name}</div>
            <div className="mk-c__mod">
              <i aria-hidden="true" />
              {pack.module ? pack.module.label : (t.category || 'general')}
              {' · '}
              {steps.length} {steps.length === 1 ? 'step' : 'steps'}
            </div>
            <div className="mk-dr__tags">
              <span className="mk-v">Reviewed</span>
              <SkillStatusPill status={status} at={onDay(pending?.requested_at)} />
            </div>
          </div>
          <button type="button" ref={closeRef} className="k-iconbtn" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
            </svg>
          </button>
        </div>

        <div className="mk-dr__b">
          <p className="mk-c__d">{t.description || 'No description.'}</p>

          {/* Who it is for and when to run it (261). First in the body, above
              even the blocker: somebody who opens this drawer is deciding
              whether to ASK for the skill, and that decision starts with
              whether it is theirs at all. */}
          <SkillFit template={t} />

          {held && (
            <p className="mk-c__blk">
              <span aria-hidden="true">{Ic.lock}</span>
              <span>{blockers.join(' ')}</span>
            </p>
          )}

          <div>
            <h4 className="mk-sec__t">{Ic.read} What it reads</h4>
            {reads === null ? (
              <p className="mk-perm__unknown">
                Not checked — the capability list did not load, so what this skill reads
                could not be worked out. It is not a claim that it reads nothing.
              </p>
            ) : reads.length === 0 ? (
              <p className="mk-perm__none">Nothing. No step is given any of your records.</p>
            ) : (
              <div className="mk-perm">
                {reads.map(r => (
                  <div className="mk-perm__r mk-perm__r--read" key={r}>
                    <i aria-hidden="true">✓</i><span>{r}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h4 className="mk-sec__t">{Ic.write} What it changes</h4>
            {writes === null ? (
              <p className="mk-perm__unknown">
                Not checked. Availability and write access come from the same list, and
                it did not load.
              </p>
            ) : writes.length === 0 ? (
              <p className="mk-perm__none">Nothing. This skill only reads and reports.</p>
            ) : (
              <div className="mk-perm">
                {writes.map(w => (
                  <div className="mk-perm__r mk-perm__r--write" key={w}>
                    <i aria-hidden="true">!</i><span>{w}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h4 className="mk-sec__t">{Ic.steps} Steps</h4>
            {steps.length === 0 ? (
              <p className="mk-perm__unknown">
                This skill has no steps, so a run would produce nothing.
              </p>
            ) : (
              <div className="mk-steps">
                {(perms || steps.map((s, i) => ({
                  n: i + 1,
                  title: stepKind(s) === 'data' ? 'Reads your data' : 'Writes with AI',
                  detail: stepKind(s) === 'data'
                    ? (words(s.skill_function) || 'nothing chosen')
                    : (words(s.agent_type) || 'an AI step'),
                  cost: stepKind(s) === 'data' ? 'free' : 'metered',
                }))).map(s => (
                  <div className="mk-step" key={s.n}>
                    <span className="mk-step__n">{s.n}</span>
                    <span>
                      <span className="mk-step__t">{s.title}</span>
                      <code className="mk-step__k">{s.detail}</code>
                    </span>
                    <span className="mk-step__c">{s.cost}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h4 className="mk-sec__t">{Ic.cost} What a run costs</h4>
            <div className="mk-cost">
              <div className={`mk-cost__r${data ? ' mk-cost__r--free' : ''}`}>
                <span>{data} data {data === 1 ? 'step' : 'steps'}</span>
                <span>{data ? 'free' : '—'}</span>
              </div>
              <div className="mk-cost__r">
                <span>{ai} AI {ai === 1 ? 'step' : 'steps'}</span>
                <span>{ai ? (live != null ? creditLabel(live) : 'unknown') : '—'}</span>
              </div>
              {/* THE ONE PRICE RULE, shared with the card through `packPrice`.
                  The live sum leads because it is what the wallet is charged;
                  the stored column is a labelled fallback; with neither, this
                  says so rather than printing a zero. */}
              {live != null ? (
                <div className="mk-cost__r mk-cost__r--tot">
                  <span>Per run</span><span>{live === 0 ? 'free' : creditLabel(live)}</span>
                </div>
              ) : listed != null ? (
                <div className="mk-cost__r mk-cost__r--tot">
                  <span>Per run</span><span>listed at {creditLabel(listed)}</span>
                </div>
              ) : (
                <div className="mk-cost__r mk-cost__r--tot mk-cost__r--none">
                  <span>Per run</span><span>unavailable</span>
                </div>
              )}
              <div className="mk-cost__r">
                <span>One-off setup</span>
                <span>{t.setup_fee_paise ? `₹${(t.setup_fee_paise / 100).toLocaleString('en-IN')}` : 'none'}</span>
              </div>
            </div>
            <p className="mk-cost__foot">
              {live != null
                ? 'Credit costs come from the live cost table, not from this page. A figure printed here that disagreed with what you were charged would be worse than no figure.'
                : listed != null
                  ? 'The live cost table did not load, so this is the figure stored on the template. The wallet is charged the sum of the steps at run time, which may differ.'
                  : 'The live cost table did not load and this template has no stored figure, so nothing here is a price. Ask before you commit to it.'}
            </p>
          </div>
        </div>

        <div className="mk-dr__foot">
          {active ? (
            <span className="mk-c__blk">
              <span>This skill is already switched on for your organisation. Run it from
                the Sahayak skills tab.</span>
            </span>
          ) : held ? (
            /* NO REQUEST BUTTON ON A SKILL THAT CANNOT RUN. Filing a lead for
               something this server has no implementation for wastes the
               customer's ask and the account contact's time, and the answer
               would be "no" for a reason nobody has to look up. */
            <span className="mk-c__blk" style={{ flex: 1 }}>
              <span aria-hidden="true">{Ic.lock}</span>
              <span>{blockers.join(' ')} Asking for it would not change that — the
                implementation has to land first.</span>
            </span>
          ) : canAssign ? (
            <>
              <button type="button" className="k-btn k-btn--primary hb-btn--sm"
                disabled={busy} onClick={() => onAssign(t.id)}>
                {busy ? 'Assigning…' : 'Assign to this client'}
              </button>
              <button type="button" className="k-btn k-btn--ghost hb-btn--sm" onClick={onClose}>
                Not now
              </button>
            </>
          ) : pending ? (
            <div className="mk-sent">
              <span aria-hidden="true">{Ic.spark}</span>
              <span>
                <b>
                  Requested{pending.requested_at ? ` on ${onDay(pending.requested_at)}` : ''} — Aekam has it
                </b>
                <p>
                  {pending.already_open
                    ? 'You already had a request open for this skill, so this did not file a second one. '
                    : ''}
                  You will get an email when it is switched on. Nothing is charged until it
                  runs, and the first run is yours to trigger.
                </p>
              </span>
            </div>
          ) : (
            <div style={{ flex: 1 }}>
              <div className="mk-req">
                <div className="mk-req__t">{Ic.spark} Aekam turns this on for you</div>
                <p className="mk-req__d">
                  {assignBlocked || 'Adding a skill changes what everyone in your organisation can run and what it costs, so it is switched on by your account contact rather than self-served.'}
                  {' '}Say what you want it for and the request goes with that context attached.
                </p>
                <textarea
                  value={note} onChange={e => setNote(e.target.value)}
                  maxLength={2000}
                  aria-label="What should this skill do for you?"
                  placeholder="Optional — what should it do for you, and how often?"
                  disabled={!!dormant}
                />
                {dormant && <p className="mk-req__off" role="status">{dormant}</p>}
                {failed && <p className="mk-req__off" role="status">{failed}</p>}
              </div>
              <div className="mk-dr__acts">
                <button type="button" className="k-btn k-btn--primary hb-btn--sm"
                  disabled={sending || !!dormant}
                  title={dormant || undefined}
                  onClick={request_}>
                  {sending ? 'Sending…' : dormant ? 'Not available yet' : 'Request this skill'}
                </button>
                <button type="button" className="k-btn k-btn--ghost hb-btn--sm" onClick={onClose}>
                  Not now
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
