import React from 'react';

/**
 * Trust — only claims that are true and checkable today.
 *
 * TWO CLAIMS FROM THE PROTOTYPE ARE DELIBERATELY ABSENT:
 *
 * 1. The SOC 2 badge. It was a placeholder. An unaudited SOC 2 claim made to
 *    accounting firms is a compliance misrepresentation aimed at precisely the
 *    audience trained to verify it.
 *
 * 2. "Data stays in India." The handover asked for this to be verified before
 *    writing it, and the evidence points the other way: services/storage.py
 *    configures the S3 client with region_name="auto", and .env.example ships
 *    AWS_REGION=us-east-1. There is no Indian-region configuration anywhere in
 *    the backend. If the buckets and Postgres genuinely are in an Indian
 *    region, this is worth adding back — it is a real differentiator for this
 *    audience — but it needs someone to confirm the infrastructure first, not
 *    a guess from the code.
 *
 * Everything below links to something a visitor can inspect. A trust section
 * that cannot be checked is decoration.
 */
const CLAIMS = [
  {
    h: 'GST-compliant invoicing',
    p: 'HSN and SAC codes, CGST/SGST/IGST, place of supply, export invoices, and GSTR-1 and GSTR-3B summaries. A tax invoice missing its GSTIN is flagged before it can be sent.',
  },
  {
    h: 'Every action is logged',
    p: 'Who changed what and when, including platform support access to your workspace. The audit trail is readable by your firm’s admins, not only by us.',
  },
  {
    h: 'One client cannot see another',
    p: 'Client accounts see only the projects shared with them. Internal comments, time entries and rates are never exposed to a client account.',
  },
  {
    h: 'Access is per person, per module',
    p: 'Payroll, invoicing and HR are marked sensitive and granted individually. Turning a module off revokes access without destroying the history behind it.',
  },
];

export default function Trust() {
  return (
    <section className="lsec" id="trust">
      <div className="lwrap">
        <div data-rev>
          <div className="lsec__kicker">Trust</div>
          <h2 className="lsec__h">What we can actually promise</h2>
          <p className="lsec__lede">
            Four things that are true today and that you can check inside the
            product on your first afternoon.
          </p>
        </div>

        <div className="ltrust" data-rev>
          {CLAIMS.map(c => (
            <div className="ltrust__c" key={c.h}>
              <div className="ltrust__h">{c.h}</div>
              <p className="ltrust__p">{c.p}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
