import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Toggle, Button } from '../../components/ui';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { useToast } from '../../components/ui/toast';
import { apiErrorText } from '../../lib/apiError';

/**
 * TabSecurity — org-level security policy, `GET/PATCH /api/v1/org/security`
 * (`routers/org_security.py`). Write is org_owner only (platform_admin god
 * mode too); read is org_admin+.
 *
 * UPDATE 2026-08-23 (workstream L): this was rendered fully disabled while
 * the backend and the TOTP store did not exist. Both now do — 207/208 are
 * applied live, and `services/totp.py`/`routers/totp.py` ship real
 * enrolment. `tfa_allowed`/`tfa_enforced` are ENFORCED (auth_router.py
 * login() reads them); idle_timeout/ip_ranges/password_policy remain
 * stored-only, per `enforced` in the GET response, and are rendered
 * accordingly below rather than claimed as live.
 *
 * The two constraints this screen must still honour, now that it is real:
 *
 *  1 · Turning `tfa_enforced` on refuses (409) until the lockout count is
 *      known, then requires `acknowledge_lockout` equal to the exact
 *      number who would be locked out. Not a confirm dialog — the number.
 *  2 · Saving `ip_ranges` refuses (400) if it would exclude the address
 *      doing the saving. The backend checks this; the UI just surfaces it.
 */

const Info = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.6v.1" />
  </svg>
);

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

export default function TabSecurity() {
  const { pushToast } = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmDlg, setConfirmDlg] = useState(null);

  // Local edit buffer — only these three are user-editable inline; 2FA
  // toggles apply immediately (see below) because they carry their own
  // confirmation step and mixing that with a pending "Save changes" button
  // would let a saved lockout number go stale between load and click.
  const [idleTimeout, setIdleTimeout] = useState('none');
  const [ipRanges, setIpRanges] = useState('');
  const [passwordPolicy, setPasswordPolicy] = useState('standard');

  const load = async () => {
    setLoading(true);
    try {
      const { data: d } = await api.get('/v1/org/security');
      setData(d);
      setIdleTimeout(d.idle_timeout == null ? 'none' : String(d.idle_timeout));
      setIpRanges((d.ip_ranges || []).join('\n'));
      setPasswordPolicy(d.password_policy || 'standard');
    } catch {
      setData(null);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const patch = async (body) => {
    try {
      await api.patch('/v1/org/security', body);
      await load();
      return true;
    } catch (e) {
      pushToast({
        type: 'error',
        title: apiErrorText(e, 'Could not save.'),
      });
      return false;
    }
  };

  const toggleAllowed = async (checked) => {
    await patch({ tfa_allowed: checked });
  };

  const toggleEnforced = async (checked) => {
    if (!checked) { await patch({ tfa_enforced: false }); return; }
    const two = data?.two_factor;
    if (!two?.countable) {
      pushToast({
        type: 'error',
        title: two?.reason || 'Cannot count who would be locked out yet.',
      });
      return;
    }
    const locked = two.would_be_locked_out || 0;
    if (locked > 0) {
      setConfirmDlg({
        message: `${locked} of ${two.members} member${two.members === 1 ? '' : 's'} have no authenticator set up and will be unable to sign in the moment this saves. Continue?`,
        intent: 'warn',
        onConfirm: () => patch({ tfa_enforced: true, acknowledge_lockout: locked }),
      });
      return;
    }
    await patch({ tfa_enforced: true, acknowledge_lockout: locked });
  };

  const saveSessionSettings = async (e) => {
    e.preventDefault();
    setSaving(true);
    const ranges = ipRanges.split('\n').map((s) => s.trim()).filter(Boolean);
    const ok = await patch({
      idle_timeout: idleTimeout === 'none' ? null : Number(idleTimeout),
      ip_ranges: ranges,
      password_policy: passwordPolicy,
    });
    setSaving(false);
    if (ok) pushToast({ type: 'success', title: 'Saved' });
  };

  if (loading) return <div className="st__group"><p className="sr__d">Loading…</p></div>;

  if (!data) {
    return (
      <div className="st__group">
        <p className="sr__d">Could not load security settings.</p>
      </div>
    );
  }

  const two = data.two_factor || {};

  return (
    <div>
      {!data.storage_ready && (
        <section className="st__group">
          <p className="opend">{Info}<span>{data.storage_note}</span></p>
        </section>
      )}

      <section className="st__group">
        <h2 className="st__gt">Two-factor authentication</h2>

        <Row
          title="Allow two-factor authentication"
          detail="Members can add an authenticator app to their own account, from Customization → Security. Opt-in, per person."
        >
          <Toggle
            checked={!!data.tfa_allowed}
            onChange={toggleAllowed}
            disabled={!data.storage_ready}
            label="Allow two-factor authentication"
          />
        </Row>

        <Row
          title="Require it for every member"
          detail={
            two.countable
              ? `${two.enrolled ?? 0} of ${two.members ?? 0} member${two.members === 1 ? '' : 's'} have an authenticator set up.`
              : (two.reason || 'Cannot count enrolment yet.')
          }
        >
          <Toggle
            checked={!!data.tfa_enforced}
            onChange={toggleEnforced}
            disabled={!data.storage_ready || (!data.tfa_enforced && !two.countable)}
            label="Require two-factor authentication"
          />
        </Row>
      </section>

      <form onSubmit={saveSessionSettings}>
        <section className="st__group">
          <h2 className="st__gt">Sessions</h2>
          <Row
            title="Idle timeout"
            detail="Not yet enforced — stored for when session-expiry ships. Shared machines in a shared office are the case this exists for."
          >
            <select
              className="of__i"
              value={idleTimeout}
              onChange={(e) => setIdleTimeout(e.target.value)}
              disabled={!data.storage_ready}
              aria-label="Idle timeout"
            >
              <option value="none">Never</option>
              <option value="30">30 minutes</option>
              <option value="120">2 hours</option>
              <option value="480">8 hours</option>
            </select>
          </Row>
        </section>

        <section className="st__group">
          <h2 className="st__gt">Network</h2>
          <Row
            title="Restrict sign-in to IP ranges"
            detail="Not yet enforced — stored for when this ships. One CIDR range per line. An empty list means no restriction; the save is refused if it would exclude your own address."
          >
            <textarea
              className="of__i of__i--mono"
              rows={3}
              value={ipRanges}
              onChange={(e) => setIpRanges(e.target.value)}
              disabled={!data.storage_ready}
              placeholder="203.0.113.0/24"
              aria-label="Allowed IP ranges"
            />
          </Row>
        </section>

        <section className="st__group">
          <h2 className="st__gt">Passwords</h2>
          <Row
            title="Minimum password policy"
            detail="Not yet enforced — stored for when signup reads this. Length and reuse rules for members who sign in with a password."
          >
            <select
              className="of__i"
              value={passwordPolicy}
              onChange={(e) => setPasswordPolicy(e.target.value)}
              disabled={!data.storage_ready}
              aria-label="Password policy"
            >
              <option value="standard">Standard — 8 characters</option>
              <option value="strong">Strong — 12 characters, mixed</option>
            </select>
          </Row>
        </section>

        <div className="dz__act">
          <Button type="submit" variant="fill" size="sm" disabled={saving || !data.storage_ready}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
      <ConfirmDialog state={confirmDlg} onClose={() => setConfirmDlg(null)} />
    </div>
  );
}
