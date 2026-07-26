import React from 'react';
import { Field, Input, Select } from '../../components/ui';
import { INDUSTRIES, TEAM_SIZES } from './data';

/**
 * Step 2 — the organisation.
 *
 * AUTH-SPEC has the industry answered at signup, and preselects modules from
 * it. There is no signup — Kartavaya is invite-only — so the question has to be
 * asked here instead, one step before the grid it drives. Changing it
 * re-preselects; a selection the user has already touched is not overwritten
 * (see `touchedModules` in OnboardingPage).
 */
export default function StepOrg({ value, onChange }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });

  return (
    <>
      <div className="ob__head">
        <h2 className="ob__h2">About your organisation</h2>
        <p className="ob__sub">
          This is what the next step uses to guess which modules you need. It is a
          starting point, not a lock — you can turn any of them on or off.
        </p>
      </div>

      <div className="ob__fields">
        <Field label="Organisation name" sanskrit="संस्था" htmlFor="ob-org">
          <Input id="ob-org" value={value.org} onChange={set('org')} placeholder="Aekam Inc" autoFocus />
        </Field>
        <Field label="Industry" htmlFor="ob-industry">
          <Select id="ob-industry" value={value.industry} onChange={set('industry')}>
            {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
          </Select>
        </Field>
        <Field label="Team size" htmlFor="ob-size">
          <Select id="ob-size" value={value.size} onChange={set('size')}>
            {TEAM_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
      </div>
    </>
  );
}
