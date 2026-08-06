import React, { useMemo } from 'react';
import { MODULES } from '../../lib/moduleColors';
import { OB_MODULES, OB_PRESETS } from './data';
import { Check, Lock } from './icons';
import { useLanguage } from '../../components/CustomizePanel';
import { secondaryOf } from '../../lib/labels';
import { Secondary } from '../../components/Bilingual';

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
 *
 * ── THE GRID IS NOT DRAWN FROM `OB_MODULES` ALONE ANY MORE ──────────────────
 *
 * `OB_MODULES` is twelve hardcoded cards. `PATCH /v1/org/modules` — which this
 * step now reaches — refuses three different kinds of entry, and until the
 * catalogue arrived every one of those refusals was a card that looked exactly
 * like its neighbour and failed on save:
 *
 *   · BUNDLED (`sahayak`, `esign`) — a plan feature with no subscription row.
 *     `patch_modules` answers 400 "bundled with the plan … cannot be toggled
 *     here". They are always on and are shown that way, locked.
 *   · NOT PROVISIONED — 403 "not part of this organisation's subscription. Ask
 *     your account manager at Aekam to add it." Only Aekam provisions a module,
 *     so the card says so instead of offering a switch that cannot close.
 *   · DEPENDED ON — switching one off while another needs it is 400. That one
 *     is left to the endpoint: the dependency map lives server-side, the message
 *     names the blockers, and duplicating it here would be a second copy to
 *     drift.
 *
 * `catalogue` null or empty means the read failed or has not landed. Everything
 * stays interactive in that case and the choice is held locally, exactly as this
 * step behaved before — a step that cannot ask must not therefore refuse.
 */
/**
 * The module name in the second script.
 *
 * `m.code` is the module id, which is also its key in `lib/labels.js` — so this
 * picks up the Gujarati `navConfig.js` has always had, without a second
 * `{en, hi, gu}` triple being written anywhere. `MODULES` in
 * `lib/moduleColors.js` is that second table and has no `gu` column at all.
 */
function ModIn({ code, fallback, lang }) {
  const { secondary, script } = secondaryOf(code, lang);
  return secondary
    ? <Secondary className="ob__mod-hi" value={secondary} />
    : <Secondary className="ob__mod-hi" value={fallback} />;
}

export default function StepModules({ value, onChange, industry, catalogue = null, canSet = true }) {
  const lang = useLanguage();
  const on = value.modules;

  /** `code → catalogue row`, or an empty map when we could not ask. */
  const byCode = useMemo(() => {
    const out = {};
    if (Array.isArray(catalogue)) for (const m of catalogue) out[m.code] = m;
    return out;
  }, [catalogue]);

  const known = Object.keys(byCode).length > 0;
  /** Read-only: we know the org's real state and this caller cannot change it. */
  const readOnly = known && !canSet;

  const toggle = (code) => onChange({
    ...value,
    modules: on.includes(code) ? on.filter((c) => c !== code) : [...on, code],
    modulesTouched: true,
  });
  const reset = () => onChange({
    ...value,
    modules: (OB_PRESETS[industry] || OB_PRESETS.Other)
      .filter((c) => !known || byCode[c]?.toggleable || byCode[c]?.bundled),
    modulesTouched: true,
  });

  const cards = OB_MODULES.map((m) => {
    const row = byCode[m.code];
    const bundled = Boolean(row?.bundled);
    // Not in the catalogue at all is treated as unknown, not as unavailable:
    // `role_tiers` and `OB_MODULES` are two lists and a code missing from one is
    // a gap in this product, not a statement about the customer's contract.
    const unavailable = known && row != null && !row.toggleable && !bundled;
    return {
      ...m,
      bundled,
      unavailable,
      locked: bundled || unavailable || readOnly,
      isOn: bundled ? true : on.includes(m.code),
      note: bundled ? 'included in your plan'
        : unavailable ? 'not in your subscription'
          : null,
    };
  });

  const nOn = cards.filter((c) => c.isOn).length;

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
        {cards.map((m) => {
          const meta = MODULES[m.code];
          return (
            <button
              key={m.code}
              type="button"
              aria-pressed={m.isOn}
              disabled={m.locked}
              className={`ob__mod ${m.isOn ? 'on' : ''} ${m.sensitive ? 'sens' : ''}`.replace(/\s+/g, ' ').trim()}
              onClick={() => !m.locked && toggle(m.code)}
            >
              <span className="ob__mod-t">
                <ModIn code={m.code} fallback={meta?.en || m.code} lang={lang} />
                <span className="ob__mod-en">{meta?.en || m.code}</span>
              </span>
              <span className="ob__mod-d">{m.note || m.d}</span>
              <span className="ob__mod-f">
                {m.sensitive
                  ? <span className="ob__lock"><Lock width={11} height={11} />sensitive</span>
                  : <span />}
                <span className={`ob__check ${m.isOn ? 'on' : ''}`.trim()}>
                  <Check width={12} height={12} />
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="ob__bar">
        <span>
          <strong>{nOn}</strong> selected
          {nOn > 6 && <span className="ob__muted"> · that is a lot for week one</span>}
        </span>
        {!readOnly && (
          <button type="button" className="au__link" onClick={reset}>Reset to recommended</button>
        )}
      </div>

      {readOnly && (
        <div className="ob__note">
          <Lock width={13} height={13} />
          <span>
            Only the organisation owner can switch a module on or off. This is what your
            organisation has today — carry on, and ask your owner if something is missing.
          </span>
        </div>
      )}

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
