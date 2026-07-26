import React from 'react';
import { MODULES } from '../../lib/moduleColors';
import { OB_MODULES, OB_PRESETS } from './data';
import { Check, Lock } from './icons';

/**
 * Step 3 — modules.
 *
 * Everything switched off stays hidden. It does not sit greyed out in the
 * sidebar advertising what the org is not paying for.
 *
 * The three sensitive modules switch the card accent to --danger when on, and
 * the footnote says outright that access follows the org role rather than
 * arriving with the module. RBAC settles that (Owner and Org admin only); a
 * step that implied a per-member grant would be promising something the role
 * model does not do.
 */
export default function StepModules({ value, onChange, industry }) {
  const on = value.modules;
  const toggle = (code) => onChange({
    ...value,
    modules: on.includes(code) ? on.filter((c) => c !== code) : [...on, code],
    modulesTouched: true,
  });
  const reset = () => onChange({
    ...value,
    modules: OB_PRESETS[industry] || OB_PRESETS.Other,
    modulesTouched: true,
  });

  return (
    <>
      <div className="ob__head">
        <h2 className="ob__h2">Which modules do you need?</h2>
        <p className="ob__sub">
          Preselected for <strong>{industry}</strong>. Everything you switch off stays
          hidden — it does not sit greyed out in your sidebar advertising what you are
          not using.
        </p>
      </div>

      <div className="ob__mods">
        {OB_MODULES.map((m) => {
          const meta = MODULES[m.code];
          const isOn = on.includes(m.code);
          return (
            <button
              key={m.code}
              type="button"
              aria-pressed={isOn}
              className={`ob__mod ${isOn ? 'on' : ''} ${m.sensitive ? 'sens' : ''}`.replace(/\s+/g, ' ').trim()}
              onClick={() => toggle(m.code)}
            >
              <span className="ob__mod-t">
                <span className="ob__mod-hi" lang="hi">{meta?.hi || m.code}</span>
                <span className="ob__mod-en">{meta?.en || m.code}</span>
              </span>
              <span className="ob__mod-d">{m.d}</span>
              <span className="ob__mod-f">
                {m.sensitive
                  ? <span className="ob__lock"><Lock width={11} height={11} />sensitive</span>
                  : <span />}
                <span className={`ob__check ${isOn ? 'on' : ''}`.trim()}>
                  <Check width={12} height={12} />
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="ob__bar">
        <span>
          <strong>{on.length}</strong> selected
          {on.length > 6 && <span className="ob__muted"> · that is a lot for week one</span>}
        </span>
        <button type="button" className="au__link" onClick={reset}>Reset to recommended</button>
      </div>

      <div className="ob__note">
        <Lock width={13} height={13} />
        <span>
          Ganit, Manav and Vetana hold money and personal data. Access to them follows
          the organisation role — Owner and Org admin — and is never granted by turning
          the module on.
        </span>
      </div>
    </>
  );
}
