import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Button, ErrorState, SkeletonCard, Tag, useToast } from '../../components/ui';

/**
 * TabUpi — one receiving UPI ID per platform, and a code to scan before you
 * trust any of them.
 *
 * ── Why this is a list and not one field ────────────────────────────────────
 *
 * UPI is interoperable, so a single ID is payable from every app. That is true
 * and it answers a different question: it means anyone can PAY you, not that
 * you hold one account. A firm with Paytm, PhonePe and Google Pay accounts has
 * three that settle and report separately, and deciding which one receives is
 * an ordinary business decision — the same shape as `TabSenders`, one row per
 * purpose.
 *
 * ── THE QR PREVIEW IS THE ONLY REAL CHECK IN THIS ENTIRE FLOW ───────────────
 *
 * There is no payment gateway anywhere in this product. A mistyped UPI ID does
 * not fail — it pays whoever does hold that handle, silently, with nothing to
 * reverse it. A form cannot tell a correct address from a well-formed wrong
 * one; a phone can, because scanning the code shows the account holder's name
 * as their own bank reports it. So the code sits beside every saved row and the
 * copy asks the user to scan it, rather than a green tick implying we checked
 * something we cannot check.
 *
 * The preview carries NO amount, deliberately. A code with a real figure in it
 * is one accidental confirm away from the firm paying itself, and a token
 * figure teaches people to ignore the number on a payment screen.
 *
 * ── What is deliberately NOT validated ──────────────────────────────────────
 *
 * The handle suffix. A PhonePe user may hold `@ybl`, `@ibl`, `@axl` or a bank
 * handle registered years ago. Refusing a working address because it was not
 * the suffix we expected leaves the user with nothing to argue with, and the
 * thing they then cannot do is get paid. Only the shape is checked, here and
 * again on the server and again by a database CHECK.
 *
 * Blank clears the row, exactly as it does for sender addresses — one way to
 * say a thing, so there is nothing for a separate Delete to disagree with.
 */

const BACKEND = import.meta.env.VITE_BACKEND_URL;

/** `identifier@handle`. The same shape the API and the CHECK both enforce. */
const VPA = /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/;

function vpaError(v) {
  if (!v || !v.trim()) return null;              // blank is legal — it clears
  if (/\s/.test(v.trim())) return 'A UPI ID has no spaces in it.';
  return VPA.test(v.trim()) ? null : 'That is not a UPI ID. It looks like yourname@bank.';
}

const Info = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.6v.1" />
  </svg>
);

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

export default function TabUpi() {
  const { pushToast } = useToast();
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ available: false, org_name: '', notice: '' });
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  // Bumped after every successful save so the <img> URLs change and the browser
  // re-requests them. The server sends `no-store`, but a stale code for the OLD
  // address is the one thing this preview must never show, so the cache is not
  // the only thing standing between the user and it.
  const [stamp, setStamp] = useState(0);

  useEffect(() => {
    let alive = true;
    api.get('/v1/org/profile/upi-accounts')
      .then(r => {
        if (!alive) return;
        setRows(r.data?.accounts || []);
        setMeta({
          available: Boolean(r.data?.available),
          org_name: r.data?.org_name || '',
          notice: r.data?.notice || '',
        });
      })
      // A failed GET must not render a blank form: saving a blank form here
      // would delete every ID the org has published on its invoice links.
      .catch(() => { if (alive) setFailed(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const set = (platform, key, value) => setRows(rs =>
    rs.map(r => (r.platform === platform ? { ...r, [key]: value } : r)));

  /** Exactly one default, chosen here rather than left to the server to pick.
   *  Two defaults is not a preference — it decides where "Other UPI app" sends
   *  the money, and the answer would depend on row order. */
  const makeDefault = (platform) => setRows(rs =>
    rs.map(r => ({ ...r, is_default: r.platform === platform })));

  const errors = Object.fromEntries(
    rows.map(r => [r.platform, vpaError(r.vpa)]).filter(([, e]) => e));

  const filled = rows.filter(r => (r.vpa || '').trim());

  const save = async () => {
    if (Object.keys(errors).length) {
      pushToast({ type: 'error', title: 'Fix the highlighted UPI IDs before saving' });
      return;
    }
    setSaving(true);
    try {
      const r = await api.put('/v1/org/profile/upi-accounts', {
        accounts: rows.map(({ platform, vpa, payee_name, is_active, is_default }) => ({
          platform,
          vpa: (vpa || '').trim() || null,
          payee_name: (payee_name || '').trim() || null,
          is_active: is_active !== false,
          is_default: Boolean(is_default),
        })),
      });
      // The response is the saved state, including any default the server
      // settled on when the form named none.
      setRows(r.data?.accounts || []);
      setStamp(s => s + 1);
      pushToast({
        type: 'success',
        title: 'UPI IDs saved',
        message: 'Scan each code with your phone before you send an invoice.',
      });
    } catch (err) {
      pushToast({
        type: 'error',
        title: err?.response?.data?.detail || 'Failed to save UPI IDs',
      });
    } finally { setSaving(false); }
  };

  if (loading) return <SkeletonCard lines={8} />;

  if (failed) {
    return (
      <ErrorState
        kind="server"
        detail="Couldn’t load your UPI IDs. The form stays hidden rather than showing blank — saving a blank form would remove every ID your invoice links pay to. Reload to try again."
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
            Set the UPI ID for each app your firm actually holds an account
            with. Customers opening a shared invoice link see a button for each
            one, and the money goes straight to that account — Kartavaya never
            holds it and takes no cut.
          </span>
        </p>

        {meta.notice && (
          <p className="opend">
            {Info}
            <span>{meta.notice}</span>
          </p>
        )}

        {!meta.available && (
          <p className="opend">
            {Info}
            <span>
              <strong>Nothing here can be saved yet.</strong> The table these
              IDs live in does not exist on the database —{' '}
              <code>129_org_upi_accounts.sql</code> has been written but not
              applied. The fields are disabled rather than accepting what you
              type and dropping it.
            </span>
          </p>
        )}

        {meta.available && !filled.length && (
          <p className="opend">
            {Info}
            <span>
              No UPI ID is set, so your invoice links currently show
              “this sender has not published a UPI address” instead of a Pay
              button.
            </span>
          </p>
        )}
      </section>

      {rows.map(row => {
        const saved = Boolean(row.vpa) && !errors[row.platform];
        return (
          <section className="st__group" key={row.platform}>
            <h2 className="st__gt">
              {row.label}
              {' '}
              {saved && row.is_default && <Tag color="var(--ok)">Default</Tag>}
              {saved && row.is_active === false && <Tag color="var(--warn)">Off</Tag>}
            </h2>

            <div className="oupi">
              <div className="oupi__form">
                <F
                  id={`upi-${row.platform}`}
                  label="UPI ID"
                  value={row.vpa}
                  disabled={disabled}
                  error={errors[row.platform]}
                  placeholder={meta.available ? row.hint : ''}
                  hint="Leave blank if you do not use this app."
                  onChange={e => set(row.platform, 'vpa', e.target.value)}
                />
                <F
                  id={`upi-${row.platform}-name`}
                  label="Payee name"
                  value={row.payee_name}
                  disabled={disabled}
                  placeholder={meta.org_name}
                  hint={`Optional. Shown to the payer before they confirm — blank uses ${meta.org_name || 'your company name'}.`}
                  onChange={e => set(row.platform, 'payee_name', e.target.value)}
                />

                {row.vpa && (
                  <div className="oupi__ctl">
                    <label className="oupi__chk">
                      <input
                        type="checkbox"
                        checked={row.is_active !== false}
                        disabled={disabled}
                        onChange={e => set(row.platform, 'is_active', e.target.checked)}
                      />
                      {/* Off keeps the ID. Deleting the row would lose it and
                          invite a retype, which is where a wrong digit comes
                          from in the first place. */}
                      <span>Show this on invoice links</span>
                    </label>
                    <button
                      type="button"
                      className="oupi__def"
                      disabled={disabled || row.is_default || row.is_active === false}
                      onClick={() => makeDefault(row.platform)}
                    >
                      {row.is_default ? 'Default' : 'Make default'}
                    </button>
                  </div>
                )}
              </div>

              {/* The check that a form cannot perform. Only for a SAVED ID —
                  the code is drawn by the server from the stored row, so an
                  unsaved edit would show the previous address and quietly
                  confirm the wrong account. */}
              {saved && meta.available && (
                <figure className="oupi__qr">
                  <img
                    alt={`UPI code for the ${row.label} ID ending ${String(row.vpa).slice(-6)}`}
                    width={132}
                    height={132}
                    src={`${BACKEND}/api/v1/org/profile/upi-accounts/qr.svg?platform=${encodeURIComponent(row.platform)}&v=${stamp}`}
                  />
                  <figcaption>
                    Scan this with your phone. Your app should name your own
                    account — if it names someone else, the ID is wrong.
                  </figcaption>
                </figure>
              )}
            </div>
          </section>
        );
      })}

      <section className="st__group">
        <Button onClick={save} disabled={disabled}>
          {saving ? 'Saving…' : 'Save UPI IDs'}
        </Button>
      </section>
    </div>
  );
}
