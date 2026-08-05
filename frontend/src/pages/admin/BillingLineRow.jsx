import React from 'react';
import { Button, Checkbox, Field, Input, Tag } from '../../components/ui';
import { inr } from '../../lib/inr';
import { formatPeriod } from '../../lib/timeFormat';

/**
 * BillingLineRow — the ONE repeating billing line, built once and mounted four
 * times (BUILD SPEC §4.3).
 *
 * A client is billed for more than one thing, and before `org_billing_lines`
 * the console could express exactly one of them: a single `monthly_price`
 * scalar with no description, no start date and no way to say "and ₹8,000/mo
 * for support since March". Four of the five lines share one shape —
 * `{enabled, description, amount}` — so there is one component, and the
 * platform fee is that component with the toggle removed rather than a second
 * implementation that merely resembles it.
 *
 * ── What the checkbox means, and the one place the spec had to be read ───────
 *
 * §4.3 says the toggled rows are "unticked and empty on open, always", and in
 * the next sentence says unticking an existing line ends it. Both are true of
 * different rows, and the distinction is the DB shape rather than a preference:
 *
 *   · A `monthly` line is OPEN (`period_end IS NULL`) until someone ends it, so
 *     it has a live on/off state and the checkbox is that state. Opening this
 *     row blank while the org is being charged ₹8,000/mo for support would
 *     invite the operator to tick, type 8000 and save — a SECOND open support
 *     line, both billed, and nothing downstream would notice. "No double
 *     charge" outranks a blank field.
 *   · A `one_off` line (integration setup) has `period_end = period_start` by
 *     CHECK constraint, so it is never open and there is nothing to untick. That
 *     row is blank on every open, always, exactly as written.
 *
 * The owner's requirement — never pre-fill an amount nobody agreed — is about
 * DEFAULTS. A figure this org is actually being charged is not a default, and
 * hiding it is how it gets charged twice.
 *
 * ── Why `canWrite` is destructured on its own line ───────────────────────────
 *
 * `scripts/check-write-gates.mjs` reads line by line and accepts
 * `const { canWrite` as the declaration. A parameter-list destructure is
 * invisible to it and reports a false "uses canWrite but never declares it",
 * which fails `npm run check`. One line, and the identifier is genuinely in
 * scope, so nothing is being worked around — see the report.
 *
 * The gate itself is NOT `useModuleWrite()`. The console sits outside every
 * `ModuleAccess` provider, so that hook returns `canWrite: true` unconditionally
 * here and would mask the real answer. The real gate is `canManageBilling`,
 * mirroring `BILLING_CONSOLE_ROLES`, resolved once by the page and passed down.
 */

/** `{enabled, description, amount}` — the whole shape, in one place. */
export const blankLine = () => ({ enabled: false, description: '', amount: '' });

/** A line row from the API as this form holds it. */
export const lineToForm = (row) => (row
  ? { enabled: true, description: row.description || '', amount: String(row.amount ?? '') }
  : blankLine());

/**
 * The form value a row STARTS from, which is what `dirty` is measured against.
 *
 * The platform variant has no toggle, so it is always enabled — including when
 * the org has no platform line yet. Without this the row rendered open, the
 * operator typed a fee, and Save stayed disabled forever because the value it
 * was validating still carried `enabled: false` from the absent line.
 */
export const lineBase = (existing, showToggle = true) => {
  const f = lineToForm(existing);
  return showToggle ? f : { ...f, enabled: true };
};

const num = v => (Number.isFinite(Number(v)) ? Number(v) : NaN);

/** A description and a non-negative amount. Both, or the line is not saveable.
 *  `enabled` is not checked here — the Save control only exists inside the
 *  branch that already knows the row is on. */
export const lineReady = v =>
  Boolean(String(v?.description || '').trim() && num(v?.amount) >= 0);

export const lineChanged = (a, b) =>
  a.enabled !== b.enabled
  || String(a.description || '') !== String(b.description || '')
  || String(a.amount ?? '') !== String(b.amount ?? '');

/** "Aug 2026" for a period date, "—" for nothing. */
export const monthLabel = iso => (iso ? formatPeriod(iso, iso) : '—');

/**
 * The sentence a money refusal wants rendered, never parsed.
 *
 * `services/credits.py` answers with `detail = {error, message, …numbers}` and
 * the rest of the API answers with `detail = "a string"`. Handing an object to
 * a toast title throws "Objects are not valid as a React child" — a refusal
 * that white-screens the console is worse than the refusal it was reporting.
 *
 * It lives in this file because it is the leaf every billing surface in this
 * batch already imports, and the batch's file ownership gives A7 no shared
 * module of its own. Move it to `lib/` the next time `lib/` is opened.
 */
export function refusalMessage(err, fallback = 'That did not go through') {
  const detail = err?.response?.data?.detail;
  if (typeof detail === 'string' && detail) return detail;
  if (detail?.message) return detail.message;
  return fallback;
}

export default function BillingLineRow(props) {
  // One line, deliberately — see the docblock.
  const { canWrite, reason } = props;
  const {
    label, sanskrit, hint, kind, cadence = 'monthly',
    showToggle = true, value, existing = null, busy = false,
    onChange, onSave, onRevert,
  } = props;

  const base = lineBase(existing, showToggle);
  const dirty = lineChanged(value, base);
  const ready = lineReady(value);
  const on = showToggle ? value.enabled : true;
  const idBase = `obl-${kind}`;

  /* What this org is billed for this line, stated before any field is read.
     "Not billed" is a fact worth printing — an empty row is ambiguous between
     "nothing here" and "did not load".

     A one-off row is never BOUND to a line (see the docblock), so it cannot
     derive this and the caller states it instead: without the override the
     integration-setup row would read "Not billed" in a month it had already
     charged a setup fee. */
  const state = props.state ?? (existing
    ? `${inr(existing.amount ?? 0)}${existing.cadence === 'monthly' ? '/month' : ' one-off'} · from ${monthLabel(existing.period_start)}`
    : 'Not billed');

  return (
    <div className={`obl__row${on ? '' : ' is-off'}`}>
      <div className="obl__head">
        {showToggle ? (
          <Checkbox
            checked={value.enabled}
            disabled={!canWrite || busy}
            label={`${label} — bill this organisation`}
            onChange={next => onChange({ ...value, enabled: next })}
          />
        ) : (
          /* The platform fee has no toggle: it is always present and cannot be
             removed. A disabled checkbox would say the same thing while
             inviting the click that does nothing. */
          <Tag color="var(--on-surface-3)">Always</Tag>
        )}
        <span className="obl__lbl">
          {label}
          {sanskrit && <span className="obl__hi" lang="hi" aria-hidden="true">{sanskrit}</span>}
        </span>
        <span className="obl__state">{state}</span>
      </div>

      {on && (
        <>
          <div className="obl__fields">
            <Field label="Description" htmlFor={`${idBase}-desc`}>
              {p => (
                <Input
                  {...p}
                  value={value.description}
                  disabled={!canWrite || busy}
                  title={canWrite ? undefined : reason || undefined}
                  placeholder={label}
                  onChange={e => onChange({ ...value, description: e.target.value })}
                />
              )}
            </Field>
            {/* `step="any"`, never a sales increment: `step="100"` makes a
                negotiated ₹4,999 fail HTML constraint validation, and no fee is
                owed in round hundreds. Same trade as InvoiceBuilder's amount. */}
            <Field
              label={cadence === 'monthly' ? 'Amount ₹ / month' : 'Amount ₹ one-off'}
              htmlFor={`${idBase}-amt`}
            >
              {p => (
                <Input
                  {...p}
                  type="number" inputMode="decimal" min="0" step="any"
                  value={value.amount}
                  disabled={!canWrite || busy}
                  title={canWrite ? undefined : reason || undefined}
                  onChange={e => onChange({ ...value, amount: e.target.value })}
                />
              )}
            </Field>
          </div>

          {hint && <p className="obl__note">{hint}</p>}

          {dirty && (
            <div className="obl__acts">
              <Button
                variant="fill" size="sm"
                disabled={!canWrite || !ready || busy}
                title={canWrite ? undefined : reason || undefined}
                onClick={onSave}
              >
                {busy ? 'Saving…' : existing ? 'Save change' : 'Add this line'}
              </Button>
              <Button variant="text" size="sm" disabled={busy} onClick={onRevert}>Cancel</Button>
              {!ready && (
                <span className="obl__note">A description and an amount are both required.</span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
