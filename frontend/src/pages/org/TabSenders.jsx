import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Button, ErrorState, SkeletonCard, Tag, useToast } from '../../components/ui';
import { apiErrorText } from '../../lib/apiError';

/**
 * TabSenders — one From address per purpose, and the honest reason nine of them
 * are not being used yet.
 *
 * ── What is broken today ────────────────────────────────────────────────────
 * Every message the product sends leaves from ONE address: `FROM_EMAIL`, a
 * Railway environment variable. A payslip, a marketing campaign and a password
 * reset all arrive from the same place, so a recipient who blocks the marketing
 * blocks their payslip with it. Sender reputation is per-address; mixing
 * transactional mail with campaigns on one address means the campaign can cost
 * you the payslips.
 *
 * ── Three things on this screen tell the truth rather than looking finished ──
 *
 * 1 · **`available: false` disables the form and names the migration.** The
 *     table this saves into is `migrations/110_org_email_senders.sql`, which is
 *     a file and is NOT applied — staging and production share one database, so
 *     nothing here applies migrations automatically. Until it is applied the
 *     endpoint answers 503 and the inputs are disabled. `TabSecurity.jsx` made
 *     the same call for the same reason: a control that accepts what you type
 *     and drops it is worse than one that is visibly off.
 *
 * 2 · **THERE IS NO "VERIFIED" CHECKBOX AND THERE MUST NEVER BE ONE.** An
 *     unverified From does not degrade delivery, it fails it — Resend answers
 *     403 "the domain is not verified" and SES answers MessageRejected, so the
 *     message never leaves. Verification is DKIM and SPF records published in
 *     DNS and confirmed in the provider's own dashboard; there is no API call
 *     this product can make to perform it and no webhook wired up to learn that
 *     it happened. A tick box an org can set to assert their DNS is correct is
 *     a control that lies, and the thing it lies about is whether payslips
 *     arrive. So the flag is read-only here, shown as a tag, and set by Aekam
 *     by hand after somebody has looked at the dashboard.
 *
 * 3 · **An address that is saved but not verified says "not in use" in so many
 *     words, and shows what is being used instead.** Storing an address and
 *     silently continuing to send from the old one, with a green tick beside
 *     it, is the specific lie this screen exists not to tell.
 *
 * ── Blank clears ────────────────────────────────────────────────────────────
 * Emptying an address deletes the row and that bucket goes back to the default
 * sender. There is no separate delete control, because two ways to say the same
 * thing is two things that can disagree.
 */

/** label + input + hint, matching TabProfile's `F`. */
function F({ id, label, hint, error, value, disabled, onChange, ...rest }) {
  return (
    <div className="of__f">
      <label className="of__l" htmlFor={id}>{label}</label>
      <input
        id={id}
        className="of__i"
        value={value ?? ''}
        disabled={disabled}
        onChange={onChange}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={[hint && `${id}-h`, error && `${id}-e`].filter(Boolean).join(' ') || undefined}
        {...rest}
      />
      {hint && <span className="of__h of__h--flush" id={`${id}-h`}>{hint}</span>}
      {error && <span className="of__e" id={`${id}-e`} role="alert">{error}</span>}
    </div>
  );
}

const Info = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.6v.1" />
  </svg>
);

/**
 * A bare address, the same shape the API and the database CHECK both enforce.
 * Checked here so a typo is a message under the field rather than a 400 after a
 * round-trip — NOT so the server can trust it. The server validates the same
 * thing, the database CHECKs it, and the resolver strips control characters on
 * read, because this value ends up in an RFC 5322 `From:` header.
 */
const ADDR = /^[^\s<>@,;:"]+@[^\s<>@,;:"]+\.[^\s<>@,;:"]+$/;

function addressError(v) {
  if (!v || !v.trim()) return null;          // blank is legal — it clears
  if (v.includes('<') || v.includes('>')) {
    return 'Enter the address only. The name goes in the next field.';
  }
  return ADDR.test(v.trim()) ? null : 'That is not a valid email address.';
}

export default function TabSenders() {
  const { pushToast } = useToast();
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ available: false, fallback: '', verification_note: '' });
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get('/v1/org/profile/senders')
      .then(r => {
        if (!alive) return;
        setRows(r.data?.senders || []);
        setMeta({
          available: Boolean(r.data?.available),
          fallback: r.data?.fallback || '',
          verification_note: r.data?.verification_note || '',
        });
      })
      // Same reasoning as TabProfile: a failed GET must not render a blank
      // form, because saving a blank form here would delete every configured
      // address and silently move the whole org back to one sender.
      .catch(() => { if (alive) setFailed(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const set = (purpose, key, value) => setRows(rs =>
    rs.map(r => (r.purpose === purpose ? { ...r, [key]: value } : r)));

  const errors = Object.fromEntries(
    rows.map(r => [r.purpose, addressError(r.from_email)]).filter(([, e]) => e));

  const save = async () => {
    if (Object.keys(errors).length) {
      pushToast({ type: 'error', title: 'Fix the highlighted addresses before saving' });
      return;
    }
    setSaving(true);
    try {
      const r = await api.put('/v1/org/profile/senders', {
        senders: rows.map(({ purpose, from_email, from_name }) => ({
          purpose,
          from_email: (from_email || '').trim() || null,
          from_name: (from_name || '').trim() || null,
        })),
      });
      // The response is the saved state, including any `is_verified` the server
      // recomputed — changing an address to a different domain drops its
      // verification, and the screen has to show that immediately rather than
      // keep displaying the tag the old address had.
      setRows(r.data?.senders || []);
      pushToast({ type: 'success', title: 'Sender addresses saved' });
    } catch (err) {
      pushToast({
        type: 'error',
        title: apiErrorText(err, 'Failed to save sender addresses'),
      });
    } finally { setSaving(false); }
  };

  if (loading) return <SkeletonCard lines={8} />;

  if (failed) {
    return (
      <ErrorState
        kind="server"
        detail="Couldn’t load sender addresses. The form stays hidden rather than showing blank — saving a blank form would clear every address you have set. Reload to try again."
        onRetry={() => window.location.reload()}
      />
    );
  }

  const disabled = !meta.available || saving;

  return (
    <div>
      <section className="st__group">
        <p className="opend opend--stack">
          {Info}
          <span>
            Every message currently leaves as <code>{meta.fallback || 'the default sender'}</code>.
            {' '}Sender reputation is per address, so a marketing campaign and a
            payslip sharing one address means a recipient who blocks the campaign
            blocks the payslip too. Set an address per purpose to separate them.
          </span>
        </p>

        {!meta.available && (
          <p className="opend">
            {Info}
            <span>
              <strong>Nothing here can be saved yet.</strong> The table these
              addresses live in does not exist on the database —{' '}
              <code>110_org_email_senders.sql</code> has been written but not
              applied. The fields are disabled rather than accepting what you
              type and dropping it.
            </span>
          </p>
        )}

        {meta.verification_note && (
          <p className="opend">
            {Info}
            <span>{meta.verification_note}</span>
          </p>
        )}
      </section>

      {rows.map(row => (
        <section className="st__group" key={row.purpose}>
          <h2 className="st__gt">
            {row.purpose}
            {' '}
            {row.from_email && (
              row.is_verified
                ? <Tag color="var(--ok)">In use</Tag>
                // NOT "unverified" as a bare word: the fact the user needs is
                // that this address is stored and is NOT the one their mail is
                // going out from.
                : <Tag color="var(--warn)">Saved — not in use yet</Tag>
            )}
          </h2>
          <span className="of__h of__h--lede">{row.label}</span>
          <div className="of">
            <F
              id={`snd-${row.purpose}-email`}
              label="From address"
              value={row.from_email}
              disabled={disabled}
              error={errors[row.purpose]}
              placeholder={meta.available ? 'payroll@yourcompany.com' : ''}
              hint={
                row.from_email && !row.is_verified
                  ? `Stored, but mail still goes out as ${meta.fallback || 'the default sender'} until the domain is verified.`
                  : 'Leave blank to use the default sender.'
              }
              onChange={e => set(row.purpose, 'from_email', e.target.value)}
            />
            <F
              id={`snd-${row.purpose}-name`}
              label="Display name"
              value={row.from_name}
              disabled={disabled}
              placeholder="Your Company Payroll"
              hint="Optional. Shown instead of the raw address."
              onChange={e => set(row.purpose, 'from_name', e.target.value)}
            />
          </div>
        </section>
      ))}

      <section className="st__group">
        <Button onClick={save} disabled={disabled}>
          {saving ? 'Saving…' : 'Save sender addresses'}
        </Button>
      </section>
    </div>
  );
}
