import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Button } from '../../components/ui';
import { useToast } from '../../components/ui/toast';
import { apiErrorText } from '../../lib/apiError';

/**
 * TabSecurity (customize/) — personal two-factor authentication.
 *
 * Not to be confused with `pages/org/TabSecurity.jsx`, which is an org
 * owner's policy screen (require 2FA for everyone, IP ranges, idle
 * timeout). This one is the account owner's own enrolment: add an
 * authenticator, see recovery codes once, turn it off. Every call is
 * `/api/v1/me/2fa/*` (`routers/totp.py`) — self-scoped, no org context.
 */

function Row({ title, detail, children }) {
  return (
    <div className="sr">
      <div className="sr__l">
        <div className="sr__t">{title}</div>
        <div className="sr__d">{detail}</div>
      </div>
      <div className="sr__c">{children}</div>
    </div>
  );
}

/** Shown exactly once, right after /confirm or a regenerate — the backend
 * never returns plaintext codes again. */
function RecoveryCodes({ codes, onDone }) {
  const { pushToast } = useToast();
  const copyAll = () => {
    navigator.clipboard?.writeText(codes.join('\n'));
    pushToast({ type: 'success', title: 'Recovery codes copied' });
  };
  return (
    <div className="st__group">
      <h2 className="st__gt">Save your recovery codes</h2>
      <p className="sr__d">
        Each code works once, if you lose access to your authenticator. Store
        them somewhere safe — this is the only time they are shown.
      </p>
      <pre
        style={{
          fontFamily: 'monospace', fontSize: 14, lineHeight: 1.8,
          background: 'var(--surface-2)', padding: '14px 18px',
          borderRadius: 8, userSelect: 'all',
        }}
      >
        {codes.join('\n')}
      </pre>
      <div className="dz__act" style={{ marginTop: 10 }}>
        <Button variant="out" size="sm" onClick={copyAll}>Copy all</Button>
        <Button variant="fill" size="sm" onClick={onDone}>I've saved these</Button>
      </div>
    </div>
  );
}

export default function TabSecurity() {
  const { pushToast } = useToast();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  // idle | setup | codes | disable | regenerate
  const [step, setStep] = useState('idle');
  const [setupData, setSetupData] = useState(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [recoveryCodes, setRecoveryCodes] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/v1/me/2fa');
      setStatus(data);
    } catch {
      setStatus(null);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const reset = () => {
    setStep('idle'); setSetupData(null); setCode(''); setPassword(''); setErr(null);
  };

  const beginSetup = async () => {
    setErr(null); setBusy(true);
    try {
      const { data } = await api.post('/v1/me/2fa/setup');
      setSetupData(data);
      setStep('setup');
    } catch {
      pushToast({ type: 'error', title: 'Could not start setup. Try again.' });
    } finally { setBusy(false); }
  };

  const confirmSetup = async (e) => {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      const { data } = await api.post('/v1/me/2fa/confirm', {
        setup_token: setupData.setup_token, code: code.trim(),
      });
      setRecoveryCodes(data.recovery_codes);
      setStep('codes');
      setCode('');
      load();
    } catch (e2) {
      setErr(apiErrorText(e2, 'Incorrect code. Check the time on your device.'));
    } finally { setBusy(false); }
  };

  const disable2fa = async (e) => {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      await api.post('/v1/me/2fa/disable', { password });
      pushToast({ type: 'success', title: 'Two-factor authentication turned off' });
      reset();
      load();
    } catch (e2) {
      setErr(apiErrorText(e2, 'Incorrect password.'));
    } finally { setBusy(false); }
  };

  const regenerate = async (e) => {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      const { data } = await api.post('/v1/me/2fa/recovery-codes/regenerate', { code: code.trim() });
      setRecoveryCodes(data.recovery_codes);
      setStep('codes');
      setCode('');
      load();
    } catch (e2) {
      setErr(apiErrorText(e2, 'Incorrect code.'));
    } finally { setBusy(false); }
  };

  if (loading) return <div className="st__group"><p className="sr__d">Loading…</p></div>;

  if (step === 'codes' && recoveryCodes) {
    return <RecoveryCodes codes={recoveryCodes} onDone={reset} />;
  }

  if (step === 'setup' && setupData) {
    return (
      <div className="st__group">
        <h2 className="st__gt">Set up two-factor authentication</h2>
        <p className="sr__d">
          Scan this with an authenticator app (Google Authenticator, Authy, 1Password),
          or enter the code by hand.
        </p>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start', margin: '14px 0' }}>
          <img
            src={setupData.qr_svg_data_uri}
            alt="Scan with your authenticator app"
            width={180} height={180}
            style={{ border: '1px solid var(--rule)', borderRadius: 8 }}
          />
          <div>
            <div className="sr__d" style={{ marginBottom: 4 }}>Can't scan? Enter this code:</div>
            <code style={{ fontSize: 15, userSelect: 'all' }}>{setupData.secret}</code>
          </div>
        </div>
        <form onSubmit={confirmSetup} style={{ maxWidth: 280 }}>
          <input
            className="of__i"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="6-digit code"
            value={code}
            onChange={(e) => { setCode(e.target.value); setErr(null); }}
            autoFocus
            required
          />
          {err && <div className="aufld__e" role="alert" style={{ marginTop: 6 }}>{err}</div>}
          <div className="dz__act" style={{ marginTop: 10 }}>
            <Button type="submit" variant="fill" size="sm" disabled={busy}>
              {busy ? 'Verifying…' : 'Verify and enable'}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={reset}>Cancel</Button>
          </div>
        </form>
      </div>
    );
  }

  if (step === 'disable') {
    return (
      <div className="st__group">
        <h2 className="st__gt">Turn off two-factor authentication</h2>
        <form onSubmit={disable2fa} style={{ maxWidth: 280 }}>
          <input
            className="of__i"
            type="password"
            placeholder="Current password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setErr(null); }}
            autoFocus
            required
          />
          {err && <div className="aufld__e" role="alert" style={{ marginTop: 6 }}>{err}</div>}
          <div className="dz__act" style={{ marginTop: 10 }}>
            <Button type="submit" variant="danger" size="sm" disabled={busy}>
              {busy ? 'Turning off…' : 'Turn off'}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={reset}>Cancel</Button>
          </div>
        </form>
      </div>
    );
  }

  if (step === 'regenerate') {
    return (
      <div className="st__group">
        <h2 className="st__gt">Regenerate recovery codes</h2>
        <p className="sr__d">Your old codes stop working the moment new ones are issued.</p>
        <form onSubmit={regenerate} style={{ maxWidth: 280 }}>
          <input
            className="of__i"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="6-digit code"
            value={code}
            onChange={(e) => { setCode(e.target.value); setErr(null); }}
            autoFocus
            required
          />
          {err && <div className="aufld__e" role="alert" style={{ marginTop: 6 }}>{err}</div>}
          <div className="dz__act" style={{ marginTop: 10 }}>
            <Button type="submit" variant="fill" size="sm" disabled={busy}>
              {busy ? 'Working…' : 'Regenerate'}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={reset}>Cancel</Button>
          </div>
        </form>
      </div>
    );
  }

  const requiredBy = status?.required_by_org || [];

  return (
    <div className="st__group">
      {requiredBy.length > 0 && (
        <p className="opend">
          <span>
            {requiredBy.map((o) => o.org_name).join(', ')} requires two-factor
            authentication for every member. {status?.enabled
              ? "You're covered."
              : 'Set it up below, or you will not be able to sign in.'}
          </span>
        </p>
      )}

      <Row
        title="Two-factor authentication"
        detail={
          status?.enabled
            ? `Enabled${status.enrolled_at ? ` since ${new Date(status.enrolled_at).toLocaleDateString()}` : ''}. A code from your authenticator app is required every time you sign in.`
            : 'Add an authenticator app for a second step at sign-in, on top of your password.'
        }
      >
        {status?.enabled ? (
          <Button variant="out" size="sm" onClick={() => setStep('disable')}>Turn off</Button>
        ) : (
          <Button variant="fill" size="sm" onClick={beginSetup} disabled={busy}>
            {busy ? 'Starting…' : 'Set up'}
          </Button>
        )}
      </Row>

      {status?.enabled && (
        <Row
          title="Recovery codes"
          detail={`${status.recovery_codes_remaining ?? 0} unused code${status.recovery_codes_remaining === 1 ? '' : 's'} remaining. Use one if you lose access to your authenticator.`}
        >
          <Button variant="out" size="sm" onClick={() => setStep('regenerate')}>Regenerate</Button>
        </Row>
      )}

      {status && !status.storage_ready && (
        <p className="sr__d" style={{ marginTop: 10 }}>
          Two-factor authentication isn't available on this deployment yet.
        </p>
      )}
    </div>
  );
}
