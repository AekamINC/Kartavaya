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
            <div className="k-card" style={{ padding: 14 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--on-surface)', marginBottom: 10 }}>
                Balance sheet FY25 — draft
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <span className="k-btn k-btn--primary k-btn--sm">✓ Approve</span>
                <span className="k-btn k-btn--ghost k-btn--sm" style={{ color: 'var(--danger)' }}>✕ Decline</span>
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
            <div className="k-card" style={{ padding: 14, fontSize: 12.5 }}>
              {[['Taxable value', '₹1,05,508'], ['CGST 9%', '₹9,496'], ['SGST 9%', '₹9,496'], ['Total', '₹1,24,500']].map(([k, v], i, a) => (
                <div key={k} style={{
                  display: 'flex', justifyContent: 'space-between', padding: '5px 0',
                  fontWeight: i === a.length - 1 ? 700 : 400,
                  color: i === a.length - 1 ? 'var(--on-surface)' : 'var(--on-surface-2)',
                  borderTop: i === a.length - 1 ? '1px solid var(--outline-variant)' : 'none',
                  marginTop: i === a.length - 1 ? 4 : 0, paddingTop: i === a.length - 1 ? 8 : 5,
                  fontVariantNumeric: 'tabular-nums',
                }}>
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
            <div className="k-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 7 }}>
              {/* The Devanagari carries lang="hi" and .lfrag__hi so it renders in
                  --font-hindi. Without a font that covers the script the browser
                  falls back per glyph and the word arrives in mixed weights —
                  which is what --font-ui alone was doing here. */}
              {[['गणित', 'Invoicing', true], ['वेतन', 'Payroll', false], ['ग्राहक', 'CRM', true]].map(([hi, en, on]) => (
                <div key={en} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  fontSize: 12.5, padding: '6px 9px', borderRadius: 'var(--r-sm)',
                  border: `1px solid ${on ? 'var(--primary)' : 'var(--outline-variant)'}`,
                  color: on ? 'var(--on-surface)' : 'var(--on-surface-3)',
                }}>
                  <span><span className="lfrag__hi" lang="hi">{hi}</span> · {en}</span>
                  {/* --primary-text, not --primary: this is text on a surface.
                      And --on-surface-3, not --on-surface-faint, which is 2.3:1
                      and declared NON-TEXT ONLY in kartavaya-design.css. */}
                  <span style={{ fontSize: 10, fontWeight: 700, color: on ? 'var(--primary-text)' : 'var(--on-surface-3)' }}>
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
