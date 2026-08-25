import React from 'react';
import { grouped } from '../../lib/inr';

/**
 * PlanComparison — the dead `plans` state, finally rendered.
 *
 * `/v1/subscription/plans` was fetched on every mount of the billing page,
 * stored in `plans` and `availableModules`, and referenced nowhere in the JSX.
 * So the page made a fourth parallel request on every load and rendered none of
 * it, and there was no plan comparison and no upgrade path anywhere in the
 * product despite the data arriving each time.
 *
 * **Credits are the headline, never a price.** Pricing is entirely per-org
 * negotiated — there is no fixed rupee figure "per plan" to show, ever. This
 * used to read `p.price_monthly != null ? inr(...) : 'On quote'`, which shows
 * a real number for whichever accounts the backend treats as platform staff
 * (`list_plans` sends `price_monthly` only to them). Owner's call: on an
 * org-facing page, "On quote" is the only correct answer regardless of who is
 * viewing it — `price_monthly` is deliberately never read here, not even when
 * the API sends it, so a future viewer with more access can't make a real
 * number reappear by accident.
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

            {/* Never `p.price_monthly` — see the file header. "On quote" is the
                truth for every viewer, not a placeholder for the ones the
                backend hasn't recognised as staff yet. */}
            <span className="opl__p">On quote</span>
          </div>
        );
      })}
    </div>
  );
}
