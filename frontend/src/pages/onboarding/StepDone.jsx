import React from 'react';
import { MODULES } from '../../lib/moduleColors';
import { OB_TEMPLATES, OB_TIPS } from './data';
import { Check, Dash, Clock } from './icons';

/**
 * The ending — 12 §1 "Skip state".
 *
 * Skipping shows a neutral DASH, not a checkmark, and each summary row that was
 * not actually applied switches to the dashed pending state with copy that says
 * what is still undone. "Claiming setup is complete when it was skipped is a lie
 * the user will discover on the empty dashboard."
 *
 * `applied` is the set of steps finished with the primary button. Skip advances
 * without adding to it, so this screen can only report what really happened —
 * including the two things this build cannot yet persist server-side, which
 * therefore never claim to have been.
 */
export default function StepDone({ state, applied, onFinish }) {
  const skipped = applied.length === 0;
  const tpl = OB_TEMPLATES.find((t) => t.id === state.template);
  const modNames = state.modules.map((c) => MODULES[c]?.hi || c).join(' · ');

  const rows = [
    applied.includes('modules')
      ? [true, `${state.modules.length} modules chosen`, `${modNames} — saved on this device until org module settings ship`]
      : [false, 'Recommended modules are on', `${modNames} — change them in Settings`],
    applied.includes('invite') && state.sentInvites > 0
      ? [true, `${state.sentInvites} invitation${state.sentInvites === 1 ? '' : 's'} sent`, state.invites.map((i) => i.email).join(', ')]
      : [false, 'No one invited yet', 'Invite people any time from Settings → Members'],
    applied.includes('project') && state.createdProject
      ? [true, `“${state.createdProject}” created`, tpl ? `${tpl.cols.length} columns from the ${tpl.name} template` : 'Default columns']
      : [false, 'No project yet', 'Create one from the dashboard whenever you are ready'],
  ];

  return (
    <div className="ob__mid">
      {skipped
        ? <span className="obs__dash" aria-hidden="true"><Dash width={18} height={18} /></span>
        : <span className="ob__done" aria-hidden="true"><Check width={26} height={26} /></span>}

      <div className="ob__head">
        <h1 className="ob__h1">
          {skipped ? <>Setup skipped —<br /><em className="ob__em">that’s fine.</em></> : <>Your workspace<br /><em className="ob__em">is ready.</em></>}
        </h1>
        <p className="ob__hi" lang="hi">{skipped ? 'बाद में कर लेंगे' : 'सब तैयार है'}</p>
        {skipped && (
          <p className="ob__lede">
            Nothing was configured. Your organisation exists with the modules your
            industry usually needs, and everything else waits until you want it.
          </p>
        )}
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
        <button type="button" className="au__btn" onClick={onFinish}>
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
