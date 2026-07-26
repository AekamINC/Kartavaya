import React from 'react';
import { Toggle } from '../../components/ui';

/**
 * TabSecurity — designed, wired to nothing, and saying so.
 *
 * `GET/PATCH /v1/org/security` and the `org_security` table are both listed as
 * new work in `10-org-settings.md` §4 and neither exists. Nor does two-factor
 * authentication anywhere in the product: there is no TOTP secret, no enrolment
 * flow and no verification step in `auth_router.py`, so "require 2FA" has
 * nothing to require.
 *
 * The controls are therefore rendered disabled rather than omitted. The shape of
 * the screen is the specification, and two of these settings carry a constraint
 * that has to survive whoever builds them — stated here, on the control, where
 * it cannot be missed:
 *
 *  1 · **2FA enforce needs a lockout count before it is switchable.** Turning on
 *      "require 2FA for all members" when 6 of 14 people have no authenticator
 *      locks out 6 people immediately. The control must state the number and
 *      stay disabled until that number is knowable, or the first use of the
 *      feature is an outage.
 *
 *  2 · **IP whitelisting must validate against the admin's own address.** Saving
 *      a range that excludes the browser you are saving from locks the
 *      organisation out of its own settings, with no path back except support.
 *      Check before save, and refuse.
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
  return (
    <div>
      <section className="st__group">
        <p className="opend">
          {Info}
          <span>
            None of this is stored yet. <code>/v1/org/security</code> and the{' '}
            <code>org_security</code> table are unbuilt, and the product has no
            two-factor flow to enforce, so every control here is disabled rather
            than accepting a setting it would drop. Sign-in security is currently
            what Supabase Auth provides.
          </span>
        </p>
      </section>

      <section className="st__group">
        <h2 className="st__gt">Two-factor authentication</h2>

        <Row
          title="Allow two-factor authentication"
          detail="Members can add an authenticator app to their own account. Opt-in, per person."
        >
          <Toggle checked={false} disabled label="Allow two-factor authentication" />
        </Row>

        <Row
          title="Require it for every member"
          detail="Cannot be switched on until we can count how many members would be locked out by it. Turning this on while six of fourteen people have no authenticator locks out six people the moment it saves — the number has to be on screen first."
        >
          <Toggle checked={false} disabled label="Require two-factor authentication" />
        </Row>
      </section>

      <section className="st__group">
        <h2 className="st__gt">Sessions</h2>

        <Row
          title="Idle timeout"
          detail="Sign a member out after a period with no activity. Shared machines in a shared office are the case this exists for."
        >
          <select className="of__i" disabled defaultValue="none" aria-label="Idle timeout">
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
          detail="One CIDR range per line. Whatever builds this must check the range against the address of the browser doing the saving and refuse a range that excludes it — otherwise the first mistake locks the organisation out of its own settings with no way back except support."
        >
          <input className="of__i of__i--mono" disabled placeholder="203.0.113.0/24" aria-label="Allowed IP ranges" />
        </Row>
      </section>

      <section className="st__group">
        <h2 className="st__gt">Passwords</h2>

        <Row
          title="Minimum password policy"
          detail="Length and reuse rules for members who sign in with a password rather than a magic link."
        >
          <select className="of__i" disabled defaultValue="standard" aria-label="Password policy">
            <option value="standard">Standard — 8 characters</option>
            <option value="strong">Strong — 12 characters, mixed</option>
          </select>
        </Row>
      </section>
    </div>
  );
}
