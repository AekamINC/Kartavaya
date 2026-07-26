import React from 'react';
import { MODULES } from '../../lib/moduleColors';
import { OB_TEMPLATES, OB_TIPS } from './data';
import { Check, Dash, Clock } from './icons';

/**
 * The ending — 12 §1 "Skip state".
 *
 * "Skipping shows a neutral dash, not a checkmark, and the three summary rows
 * switch to a dashed pending state … Claiming setup is complete when it was
 * skipped is a lie the user will discover on the empty dashboard."
 *
 * TWO OF THE FIVE STEPS CAN LAND, THREE CANNOT.
 *
 * `POST /invites` and `POST /teams` exist. There is no endpoint for a user
 * profile, an organisation record, or an org's enabled module set — 12 §4 lists
 * `GET/POST /v1/onboarding` as NEW and it is not in the backend. Those three
 * write to `kv_onboarding` on this device and nowhere else, so:
 *
 *   · the modules row is ALWAYS pending. It never ticks, at any point, because
 *     a tick would claim the org's module set was saved and it was not. What
 *     changes with `applied` is only whether the copy says the user chose the
 *     list or inherited the industry default.
 *   · the headline and the big glyph follow `landed` — whether anything at all
 *     reached the server — not whether the user walked the steps. Pressing
 *     Continue through five panes that persist nothing is not a ready
 *     workspace, and saying so produces exactly the empty dashboard 12 §1 warns
 *     about.
 */
export default function StepDone({ state, applied, onFinish }) {
  /** The only two steps with an endpoint behind them. */
  const sentInvites = applied.includes('invite') && state.sentInvites > 0;
  const madeProject = applied.includes('project') && !!state.createdProject;
  const landed = sentInvites || madeProject;
  /** Walked at least one step with the primary button rather than skipping out. */
  const walked = applied.length > 0;

  const tpl = OB_TEMPLATES.find((t) => t.id === state.template);
  const modNames = state.modules.map((c) => MODULES[c]?.hi || c).join(' · ');
  const modChosen = applied.includes('modules');

  const rows = [
    // Never `true`. See the docblock.
    [false,
      modChosen
        ? `${state.modules.length} module${state.modules.length === 1 ? '' : 's'} picked, not yet applied`
        : 'Recommended modules are on',
      state.modules.length
        ? `${modNames} — held on this device until org module settings ship`
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
    lede = 'Your name, organisation and module picks are held on this device. '
      + 'Nothing was sent to the server, because no one was invited and no project was created. '
      + 'Everything below is still open from Settings.';
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
        <p className="ob__hi" lang="hi">{landed ? 'सब तैयार है' : 'बाद में कर लेंगे'}</p>
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
