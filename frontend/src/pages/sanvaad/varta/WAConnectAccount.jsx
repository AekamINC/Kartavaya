/**
 * Connect a WhatsApp Business account.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────
 *
 * `POST /api/v1/whatsapp/accounts` has existed since the module was built. It
 * takes six fields, encrypts the access token with `services.crypto.encrypt` and
 * marks the account active. Nothing in the frontend ever called it.
 *
 * The Accounts sub-tab listed accounts and, when there were none, printed
 * "Connect your Meta Business Account to send and receive on your own number" —
 * an instruction to perform an action the product had no control for. So
 * `varta_business_accounts` was empty for every org, including Aekam's own, and
 * the reason was not that nobody had connected one. Nobody could.
 *
 * That is the fourth time this shape has been found in a week: a working
 * endpoint, a finished screen, and nothing joining them. It compiles, it
 * typechecks and it renders.
 *
 * ── Manual credentials, not embedded signup ──────────────────────────────────
 *
 * Meta offers an embedded-signup OAuth flow that would hand these six values
 * back automatically. It needs an app review, a configured redirect and a
 * Facebook Login product on the app — worth doing, and a different piece of
 * work. The backend contract that exists today takes the six values directly,
 * so this form matches the backend rather than inventing a second path to it.
 *
 * ── The token ────────────────────────────────────────────────────────────────
 *
 * The access token is a credential and is treated as one: masked, never
 * defaulted, never echoed back by the API (the INSERT's RETURNING clause omits
 * `access_token_enc`), and pasted by the account's owner rather than stored
 * anywhere this form can reach.
 */
import React, { useState } from 'react';
import { api } from '../../../lib/api';
import { Modal, Field, Input, Button } from '../../../components/ui';
import { useToast } from '../../../components/ui/toast';
import useModuleWrite from '../../../hooks/useModuleWrite';

const BLANK = {
  display_name: '',
  phone_number: '',
  waba_id: '',
  phone_number_id: '',
  access_token: '',
  webhook_verify_token: '',
};

/** Meta calls these two "WhatsApp Business Account ID" and "Phone number ID". */
const FIELDS = [
  {
    key: 'display_name', label: 'Display name', required: true,
    hint: 'The name customers see. Usually your business name.',
    placeholder: 'Unicode Group',
  },
  {
    key: 'phone_number', label: 'WhatsApp number', required: true,
    hint: 'With country code, the way Meta shows it.',
    placeholder: '+919876543210',
  },
  {
    key: 'waba_id', label: 'WhatsApp Business Account ID', required: true,
    hint: 'Meta Business Suite → WhatsApp Accounts. A long number.',
    placeholder: '104xxxxxxxxxxxx',
  },
  {
    key: 'phone_number_id', label: 'Phone number ID', required: true,
    hint: 'Not the phone number itself — the ID beside it in the API setup panel.',
    placeholder: '109xxxxxxxxxxxx',
  },
  {
    key: 'access_token', label: 'Permanent access token', required: true, secret: true,
    hint: 'Stored encrypted and never shown again. Use a System User token, not a temporary one — temporary tokens expire in 24 hours.',
    placeholder: 'EAAG…',
  },
  {
    key: 'webhook_verify_token', label: 'Webhook verify token', required: false,
    hint: 'Any string you choose. Paste the same value into Meta’s webhook configuration — the number stays "Waiting for Meta" until Meta calls back with it, and that callback is what marks it Connected.',
    placeholder: 'a phrase only you know',
  },
];

export default function WAConnectAccount({ open, onClose, onConnected }) {
  // Derived here, not received as a prop. `check-write-gates` refuses the prop
  // form and its reason is worth keeping: a component that trusts a caller's
  // `canWrite` renders whatever the caller last computed, and the caller is
  // free to stop passing it — at which point this is a ReferenceError on the
  // first open, not a build error. The hook reads the route.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'connect a WhatsApp account' });
  const { pushToast } = useToast();
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const missing = FIELDS.filter(f => f.required && !form[f.key].trim()).map(f => f.label);

  async function submit(e) {
    e.preventDefault();
    if (missing.length) {
      // Named, not just "fill in the required fields" — six near-identical
      // long numbers is exactly where a reader loses track of which is blank.
      setErr(`Still needed: ${missing.join(', ')}.`);
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await api.post('/v1/whatsapp/accounts', {
        display_name: form.display_name.trim(),
        phone_number: form.phone_number.trim(),
        waba_id: form.waba_id.trim(),
        phone_number_id: form.phone_number_id.trim(),
        access_token: form.access_token.trim(),
        webhook_verify_token: form.webhook_verify_token.trim(),
      });
      // NOT "connected". The row is written `pending` and becomes `active`
      // when Meta completes the webhook handshake against the verify token —
      // saying "connected" here was the toast promising a state the server had
      // not reached, on a screen that then showed "Waiting for Meta" beside it.
      pushToast({
        title: 'Number saved — waiting for Meta to verify it',
        type: 'success',
      });
      setForm(BLANK);
      onConnected?.();
      onClose();
    } catch (e2) {
      // The reason, not "something went wrong". A rejected token and a
      // duplicate number need different things done about them.
      const detail = e2?.response?.data?.detail;
      setErr(typeof detail === 'string' ? detail
        : 'Could not connect the account. Check the token has not expired and the IDs belong to the same business.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={v => { if (!v && !busy) onClose(); }}
      title="Connect a WhatsApp Business account" size="md" dataTestId="wa-connect">
      <form onSubmit={submit} className="wa-conn">
        <p className="wa-conn__lede">
          These six values come from Meta Business Suite, under
          {' '}<b>WhatsApp → API setup</b>. Kartavaya sends and receives on your own
          number — it is never a shared one.
        </p>

        {FIELDS.map(f => (
          <Field key={f.key} label={f.label} required={f.required} hint={f.hint}>
            {props => (
              <Input {...props}
                type={f.secret ? 'password' : 'text'}
                value={form[f.key]}
                placeholder={f.placeholder}
                autoComplete={f.secret ? 'new-password' : 'off'}
                spellCheck={false}
                onChange={e => set(f.key, e.target.value)} />
            )}
          </Field>
        ))}

        {err && <p className="wa-conn__err" role="alert">{err}</p>}

        <div className="wa-conn__act">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="fill" loading={busy}
            disabled={busy || !canWrite} title={denial || undefined}>
            {busy ? 'Connecting…' : 'Connect'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
