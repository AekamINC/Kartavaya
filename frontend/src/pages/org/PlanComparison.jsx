import React from 'react';
import { inr, grouped } from '../../lib/inr';

/**
 * PlanComparison — the dead `plans` state, finally rendered.
 *
 * `/v1/subscription/plans` was fetched on every mount of the billing page,
 * stored in `plans` and `availableModules`, and referenced nowhere in the JSX.
 * So the page made a fourth parallel request on every load and rendered none of
 * it, and there was no plan comparison and no upgrade path anywhere in the
 * product despite the data arriving each time.
 *
 * **Credits are the headline, not a price.** Pricing is per-org negotiated and
 * `list_plans` strips `price_monthly` for anyone who is not platform staff, so
 * a rupee figure here would be either absent or invented.
 *
 * Every number on these cards comes from the API row and none is written down
 * here — not in the JSX and not in this comment. The earlier version of this
 * header listed each plan's monthly credit allowance, which is a tier figure
 * Aekam sets per organisation by hand; a copy of it in the frontend is wrong the
 * first time someone changes a plan, and wrong silently, because nothing reads
 * it. `default_credits` and `max_users` are read, never asserted.
 */
export default function PlanComparison({ plans = [], currentPlanName, currentPlanCode }) {
  if (!plans.length) return null;

  return (
    <div className="opl">
      {plans.map(p => {
        const current = (currentPlanCode && p.code === currentPlanCode)
          || (currentPlanName && p.name === currentPlanName);
        const credits = p.default_credits;

        return (
          <div key={p.id || p.code || p.name} className={`opl__c${current ? ' cur' : ''}`}>
            {/* The "current" marker is a word, not only a border colour — a
                1px ring is the whole cue otherwise, and it is the one thing on
                this grid a user must not misread. The non-breaking space on the
                other cards keeps every plan name on the same baseline. */}
            <span className="opl__cur">{current ? 'Current plan' : ' '}</span>
            <span className="opl__n">{p.name}</span>

            <span>
              <span className="opl__cr">{credits != null ? grouped(credits) : '—'}</span>
              <span className="opl__u"> credits / month</span>
            </span>

            {p.max_users != null && (
              <span className="opl__u">Up to {p.max_users} {p.max_users === 1 ? 'user' : 'users'}</span>
            )}

            <span className="opl__p">
              {/* price_monthly is present only for platform staff. For everyone
                  else "On quote" is the truth, not a placeholder. */}
              {p.price_monthly != null ? `${inr(p.price_monthly)} / month` : 'On quote'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
