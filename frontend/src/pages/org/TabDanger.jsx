import React from 'react';

/**
 * TabDanger — the two actions that are no longer anyone's to take from here.
 *
 * `10-org-settings.md` §2 gives this tab a `TransferOwnership` and a `DeleteOrg`
 * control, and §4 lists `POST /v1/org/transfer-ownership` and
 * `POST /v1/org/delete` as new endpoints. **The role model settled on
 * 2026-07-26 supersedes both.** Tier 2 is now: org_owner and org_admin both
 * manage the organisation, and NEITHER can delete it or transfer ownership —
 * those two moved to Aekam platform staff.
 *
 * So this tab has no buttons. That is the implementation, not an omission: a
 * "Delete organisation" control that ends in a 403, or in an endpoint that does
 * not exist, is worse than a page that explains where the action lives. The
 * `.odz` zone still paints, because the reader arrives here looking for exactly
 * these two things and needs to find their answer, not an empty tab.
 *
 * The 7-day queue is quoted because it is the settled decision (START-HERE §
 * "Decisions already settled"): deletion is queued, never executed on the click,
 * so there is a week in which a mistake is recoverable.
 */
export default function TabDanger({ orgName }) {
  return (
    <div>
      <section className="st__group">
        <div className="odz">
          <h2 className="odz__t">Transfer ownership</h2>
          <p className="odz__p">
            Moving ownership of {orgName || 'this organisation'} to another person is
            done by Aekam, not from inside the organisation. Both the outgoing and
            incoming owner are contacted before it takes effect, and the change is
            written to your audit log.
          </p>
          <p className="odz__p">
            An org admin already has every management power an owner has — members,
            module grants, billing details, company profile. If someone needs those,
            make them an org admin on the Members tab; ownership is only about who
            the account belongs to.
          </p>
        </div>
      </section>

      <section className="st__group">
        <div className="odz">
          <h2 className="odz__t">Delete this organisation</h2>
          <p className="odz__p">
            Also handled by Aekam. A deletion is <strong>queued for seven days</strong>{' '}
            rather than executed, and any owner or admin can stop it during that
            window — which is the whole reason it is not a button here.
          </p>
          <p className="odz__p">
            Everything goes: projects, tasks, invoices, payroll history, documents,
            and every member’s access. Export what you need first — the usage report
            and invoice history are on the Billing tab, and each module exports its
            own records.
          </p>
        </div>
      </section>

      <section className="st__group">
        <p className="of__h">
          To start either one, contact your account manager at Aekam. Requests made
          in writing from the owner’s own email address are actioned fastest, because
          neither can be taken on a phone call.
        </p>
      </section>
    </div>
  );
}
