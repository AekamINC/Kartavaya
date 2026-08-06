import React from 'react';
import { Field, Input } from '../../components/ui';
import { Secondary } from '../../components/Bilingual';

/**
 * Step 1 — who you are, and what the next four minutes buy.
 *
 * The wizard opens on a step that asks for one thing rather than on a splash
 * screen, so the first click is progress instead of acknowledgement.
 */
export default function StepProfile({ value, onChange, orgKnown }) {
  return (
    <div className="ob__mid">
      <div className="ob__head">
        <h1 className="ob__h1">Welcome to Kartavaya,<br /><em className="ob__em">let’s set you up.</em></h1>
        <Secondary className="ob__hi" as="p" value="कर्तव्य में आपका स्वागत है" />
        <p className="ob__lede">
          {orgKnown
            ? 'Your organisation already exists — you were invited into it. A couple of short steps and your workspace matches how you actually work.'
            : 'A few short steps and your workspace is set up the way your business actually runs — which modules you use, who is in, and what you are working on first.'}
        </p>
      </div>

      <Field label="Your name" sanskrit="नाम" htmlFor="ob-name">
        <Input
          id="ob-name"
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          placeholder="How your team will see you"
          autoFocus
        />
      </Field>

      <div className="ob__fine">
        Takes about two minutes. Every one of these can be changed later, and skipping
        any of them costs nothing.
      </div>
    </div>
  );
}
