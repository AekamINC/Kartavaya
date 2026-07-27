import React from 'react';

/**
 * Features — alternating rows, each with a real product fragment.
 *
 * Every claim here is something the code actually does. Nothing aspirational,
 * because the audience checks.
 */

const Frame = ({ children }) => (
  <div className="lframe" aria-hidden="true">
    <div className="lframe__bar">
      <span className="lframe__dot" /><span className="lframe__dot" /><span className="lframe__dot" />
    </div>
    <div className="lframe__body">{children}</div>
  </div>
);

export default function Features() {
  return (
    <section className="lsec" id="features">
      <div className="lwrap">
        <div data-rev>
          <div className="lsec__kicker">How it works</div>
          <h2 className="lsec__h">Built around how a firm actually runs</h2>
        </div>

        {/* Client approvals */}
        <div className="lfeat" data-rev>
          <div className="lfeat__txt">
            <h3 className="lfeat__h">Your client approves in one click</h3>
            <p className="lfeat__p">
              Send a deliverable for client approval and they get a link — no
              account setup, no software. They approve or decline with a reason,
              and it lands back on the task. Your internal comments stay internal.
            </p>
          </div>
          <Frame>
            <div className="k-card lfrag">
              <div className="lfrag__t lfrag__t--sp">
                Balance sheet FY25 — draft
              </div>
              <div className="lfrag__acts">
                <span className="k-btn k-btn--primary k-btn--sm">✓ Approve</span>
                <span className="k-btn k-btn--ghost k-btn--sm lfrag__decline">✕ Decline</span>
              </div>
            </div>
          </Frame>
        </div>

        {/* GST invoicing */}
        <div className="lfeat" data-rev>
          <div className="lfeat__txt">
            <h3 className="lfeat__h">GST is built in, not bolted on</h3>
            <p className="lfeat__p">
              HSN and SAC codes, CGST/SGST/IGST split, place of supply, export
              invoices under LUT, and GSTR-1 and GSTR-3B summaries. Invoice PDFs
              carry your letterhead, GSTIN and bank details.
            </p>
          </div>
          <Frame>
            {/* The total is the only row that differs, and it differs in five
                declarations at once — weight, ink, rule, and the two spacings
                that separate it from the components above it. One modifier
                rather than five ternaries. */}
            <div className="k-card lfrag lfrag--tax">
              {[['Taxable value', '₹1,05,508'], ['CGST 9%', '₹9,496'], ['SGST 9%', '₹9,496'], ['Total', '₹1,24,500']].map(([k, v], i, a) => (
                <div key={k} className={`lfrag__tr${i === a.length - 1 ? ' lfrag__tr--total' : ''}`}>
                  <span>{k}</span><span>{v}</span>
                </div>
              ))}
            </div>
          </Frame>
        </div>

        {/* Access control */}
        <div className="lfeat" data-rev>
          <div className="lfeat__txt">
            <h3 className="lfeat__h">Payroll stays closed to the people who don’t run it</h3>
            <p className="lfeat__p">
              Access is granted per person per module, and the sensitive ones —
              payroll, invoicing, HR — are marked as such. Turning a module off
              revokes access without deleting the history behind it.
            </p>
          </div>
          <Frame>
            <div className="k-card lfrag lfrag--acl">
              {/* The Devanagari carries lang="hi" and .lfrag__hi so it renders in
                  --font-hindi. Without a font that covers the script the browser
                  falls back per glyph and the word arrives in mixed weights —
                  which is what --font-ui alone was doing here. */}
              {[['गणित', 'Invoicing', true], ['वेतन', 'Payroll', false], ['ग्राहक', 'CRM', true]].map(([hi, en, on]) => (
                <div key={en} className={`lfrag__acl${on ? ' lfrag__acl--on' : ''}`}>
                  <span><span className="lfrag__hi" lang="hi">{hi}</span> · {en}</span>
                  {/* The colour reasoning — --primary-text rather than the
                      --primary fill, and --on-surface-3 rather than the
                      non-text --on-surface-faint — now lives with the rules in
                      landing.css. */}
                  <span className={`lfrag__grant${on ? ' lfrag__grant--on' : ''}`}>
                    {on ? 'GRANTED' : 'NO ACCESS'}
                  </span>
                </div>
              ))}
            </div>
          </Frame>
        </div>
      </div>
    </section>
  );
}
