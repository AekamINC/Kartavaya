import React from 'react';
import { MODULES } from '../../lib/moduleColors';
import { OB_TEMPLATES, OB_TIPS } from './data';
import { Check, Dash, Clock } from './icons';
import { Secondary } from '../../components/Bilingual';

/**
 * The ending — 12 §1 "Skip state".
 *
 * "Skipping shows a neutral dash, not a checkmark, and the three summary rows
 * switch to a dashed pending state … Claiming setup is complete when it was
 * skipped is a lie the user will discover on the empty dashboard."
 *
 * FOUR OF THE FIVE STEPS CAN LAND. ONE STILL CANNOT.
 *
 * This block used to say two of five, and named "a user profile, an
 * organisation record, or an org's enabled module set" as the three with no
 * endpoint. Rechecked against the routers on 2026-08-06, two thirds of that was
 * stale: `PATCH /v1/org/profile` takes StepOrg's three fields and
 * `PATCH /v1/org/modules` takes StepModules' output, and both are wired now.
 *
 * The one that really has no endpoint is the USER'S OWN NAME — every
 * `UPDATE users SET` in the backend is a password reset, an admin edit, or a
 * mobile-number write, and there is no self-serve profile route. So StepProfile
 * still saves to `kv_onboarding` on this device and nowhere else, and no row
 * here claims otherwise.
 *
 * EVERY ROW REPORTS WHAT THE SERVER RECEIVED, not what the user typed, and that
 * is the only rule this file has. A row ticks when a write landed; it stays in
 * the dashed pending state when the value is held locally — including when the
 * write was ATTEMPTED and failed, which is why `state.orgSaved` and
 * `state.modulesApplied` are set inside the `try` and not beside the press.
 *
 * The headline and the big glyph follow `landed` — whether anything at all
 * reached the server — not whether the user walked the steps. Pressing Continue
 * through five panes that persist nothing is not a ready workspace, and saying
 * so produces exactly the empty dashboard 12 §1 warns about.
 */
export default function StepDone({ state, applied, onFinish }) {
  /** Each of these is true only if a request came back 2xx. */
  const savedOrg = applied.includes('org') && !!state.orgSaved;
  const setModules = applied.includes('modules') && (state.modulesApplied || 0) > 0;
  const sentInvites = applied.includes('invite') && state.sentInvites > 0;
  const madeProject = applied.includes('project') && !!state.createdProject;
  const landed = savedOrg || setModules || sentInvites || madeProject;
  /** Walked at least one step with the primary button rather than skipping out. */
  const walked = applied.length > 0;

  const tpl = OB_TEMPLATES.find((t) => t.id === state.template);
  const modNames = state.modules.map((c) => MODULES[c]?.hi || c).join(' · ');
  const modChosen = applied.includes('modules');

  const rows = [
    savedOrg
      ? [true, `${state.org} saved`, `${state.industry} · ${state.size}`]
      : [false,
        state.org ? `${state.org} — held on this device` : 'Organisation not named',
        'Set the name, industry and size in Settings → Organisation'],
    setModules
      ? [true,
        `${state.modulesApplied} module${state.modulesApplied === 1 ? '' : 's'} switched`,
        modNames || 'Change them any time in Settings → Modules']
      : [false,
        modChosen
          ? `${state.modules.length} module${state.modules.length === 1 ? '' : 's'} picked, nothing changed`
          : 'Recommended modules are on',
        state.modules.length
          ? `${modNames} — your organisation's module set is unchanged`
          : 'Nothing selected — turn modules on in Settings'],
    sentInvites
      ? [true, `${state.sentInvites} invitation${state.sentInvites === 1 ? '' : 's'} sent`, state.invites.map((i) => i.email).join(', ')]
      : [false, 'No one invited yet', 'Invite people any time from Settings → Members'],
    madeProject
      ? [true, `“${state.createdProject}” created`, tpl ? `${tpl.cols.length} columns from the ${tpl.name} template` : 'Default columns']
      : [false, 'No project yet', 'Create one from the dashboard whenever you are ready'],
  ];

  let headline;
  let lede;
  if (landed) {
    headline = <>Your workspace<br /><em className="ob__em">is ready.</em></>;
  } else if (walked) {
    headline = <>Answers saved —<br /><em className="ob__em">nothing applied yet.</em></>;
    lede = 'Your answers are held on this device. Nothing reached the server — either '
      + 'because there was nothing to send, or because a save did not go through and '
      + 'said so at the time. Everything below is still open from Settings.';
  } else {
    headline = <>Setup skipped —<br /><em className="ob__em">that’s fine.</em></>;
    lede = 'Nothing was configured. Your organisation exists with the modules your '
      + 'industry usually needs, and everything else waits until you want it.';
  }

  return (
    <div className="ob__mid">
      {landed
        ? <span className="ob__done" aria-hidden="true"><Check width={26} height={26} /></span>
        : <span className="obs__dash" aria-hidden="true"><Dash width={18} height={18} /></span>}

      <div className="ob__head">
        <h1 className="ob__h1">{headline}</h1>
        <Secondary className="ob__hi" as="p" value={landed ? 'सब तैयार है' : 'बाद में कर लेंगे'} />
        {lede && <p className="ob__lede">{lede}</p>}
      </div>

      <div className="ob__summary">
        {rows.map(([ok, title, detail]) => (
          <div key={title} className={`obs__r ${ok ? '' : 'obs__r--pend'}`.trim()}>
            <span className="obs__ic">{ok ? <Check width={14} height={14} /> : <Clock width={14} height={14} />}</span>
            <span style={{ minWidth: 0 }}>
              <span className="obs__t">{title}</span>
              <span className="obs__d">{detail}</span>
            </span>
          </div>
        ))}
      </div>

      <div className="ob__cta">
        <button type="button" className="au__btn ob__next" onClick={onFinish}>
          <span>Go to dashboard</span>
        </button>
      </div>

      <div className="ob__tips">
        {OB_TIPS.map(([title, detail]) => (
          <div key={title} className="ob__tip">
            <span className="ob__tip-t">{title}</span>
            <span className="ob__tip-d">{detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
