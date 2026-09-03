import React, { useEffect, useState } from 'react';
import { Button, Field, Input, Modal } from '../../components/ui';
import { api } from '../../lib/api';
import { grouped } from '../../lib/inr';
import { apiErrorText } from '../../lib/apiError';

/**
 * MemberCeilingModal — raise, lower or remove one person's ceiling.
 *
 * A ceiling is a LIMIT on the shared organisation balance. Nothing is debited
 * from a member and a member holds no credits of their own, so the dialog says
 * that in as many words: the mental model this replaces — "give Priya 200
 * credits" — is the one that makes an over-committed org look like a bug rather
 * than a first-come policy.
 *
 * The input is ABSOLUTE. It opens showing the current value and replaces it. An
 * additive field on a screen that also shows the current number is how somebody
 * types 200 meaning "make it 200" and gets 400.
 *
 * REFUSALS ARE RENDERED VERBATIM. `services/credits.py` composes a refusal that
 * names both what is needed and what is held, because the remedies belong to
 * different people — the member asks the org to raise the ceiling, the org asks
 * Aekam to raise the balance. Re-writing that sentence here, or matching on it,
 * would throw away the half the reader needs.
 */


export default function MemberCeilingModal({ open, person, cap, basePath, onClose, onSaved }) {
  const current = cap?.cap === null || cap?.cap === undefined ? '' : String(cap.cap);
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  // Re-seed when the dialog is pointed at a different person. Without this the
  // second row opened still shows the first person's ceiling, which is a wrong
  // number on a screen whose whole purpose is a number.
  useEffect(() => {
    setValue(current);
    setError('');
  }, [current, person?.user_id]);

  if (!person) return null;

  const name = person.name || person.email || person.user_id;
  const spent = Number(cap?.spent) || 0;
  const parsed = value.trim() === '' ? null : Number(value);
  const invalid = parsed !== null && (!Number.isInteger(parsed) || parsed < 0);

  const run = async (label, request) => {
    setBusy(label);
    setError('');
    try {
      const res = await request();
      onSaved?.(res?.data || null);
      onClose?.();
    } catch (e) {
      setError(apiErrorText(e, 'The ceiling was not changed.'));
    } finally {
      setBusy('');
    }
  };

  const save = () => run('save', () =>
    api.put(`${basePath}/members/${encodeURIComponent(person.user_id)}/cap`, { cap: parsed }));

  const clear = () => run('clear', () =>
    api.delete(`${basePath}/members/${encodeURIComponent(person.user_id)}/cap`));

  return (
    <Modal
      open={open}
      onOpenChange={v => { if (!v) onClose?.(); }}
      title={`Ceiling for ${name}`}
      dataTestId="member-ceiling"
      size="sm"
      footer={(
        <div className="bl__acts">
          <Button variant="out" onClick={onClose} disabled={Boolean(busy)}>Cancel</Button>
          <Button
            variant="out"
            onClick={clear}
            disabled={Boolean(busy) || cap?.cap === null || cap?.cap === undefined}
          >
            {busy === 'clear' ? 'Removing…' : 'Remove ceiling'}
          </Button>
          <Button variant="fill" onClick={save} disabled={Boolean(busy) || invalid}>
            {busy === 'save' ? 'Saving…' : 'Set ceiling'}
          </Button>
        </div>
      )}
    >
      <p className="bl__note">
        A ceiling limits this person’s share of the shared organisation balance. It does
        not give them their own credits.
      </p>

      <Field
        label="Ceiling, in credits"
        htmlFor="ceiling-value"
        hint="Leave it empty for no ceiling. 0 refuses every spend by this person."
        error={invalid ? 'A ceiling is a whole number of credits, zero or more.' : undefined}
      >
        {p => (
          <Input
            {...p}
            type="number"
            inputMode="numeric"
            min="0"
            step="1"
            value={value}
            onChange={e => setValue(e.target.value)}
          />
        )}
      </Field>

      <p className="bl__sub">
        {cap?.cap === null || cap?.cap === undefined
          ? `No ceiling today. ${grouped(spent)} credits spent this period.`
          : `Ceiling is ${grouped(cap.cap)} today, with ${grouped(spent)} spent this period.`}
        {' '}This replaces the current value — it is not added to it.
      </p>

      {error && <p className="bl__err" role="alert">{error}</p>}
    </Modal>
  );
}
