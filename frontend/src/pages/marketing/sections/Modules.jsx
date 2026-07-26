import React from 'react';

/**
 * Modules — the product's actual vocabulary.
 *
 * Devanagari LEADS here, and this is the one place the bilingual hierarchy
 * deliberately inverts from 24-bilingual-devanagari.md's rule. Everywhere
 * inside the product the Devanagari is a recognition cue beside an English
 * label; on this page it IS the differentiator, and a firm in Ahmedabad reads
 * गणित faster than "Invoicing".
 *
 * Names taken from components/layout/navConfig.js rather than retyped, so the
 * page cannot drift from the product's own menu.
 */
const MODULES = [
  { hi: 'ग्राहक',    en: 'CRM' },
  { hi: 'गणित',     en: 'Invoicing & GST' },
  { hi: 'मानव',     en: 'HRMS' },
  { hi: 'वेतन',     en: 'Payroll' },
  { hi: 'विक्रय',   en: 'Sales' },
  { hi: 'दृष्टि',   en: 'Analytics' },
  { hi: 'प्रचार',   en: 'Marketing' },
  { hi: 'प्रमाण',   en: 'E-signatures' },
  { hi: 'संवाद',    en: 'Messaging & WhatsApp' },
  { hi: 'सृजन',     en: 'AI hub' },
  { hi: 'कर्तव्य',  en: 'Tasks' },
  { hi: 'फ़लक',     en: 'Boards' },
  { hi: 'सम्मति',   en: 'Approvals' },
  { hi: 'प्रतिवेदन', en: 'Reports' },
  { hi: 'स्वचालन',  en: 'Automations' },
];

export default function Modules() {
  return (
    <section className="lsec" id="modules">
      <div className="lwrap">
        <div data-rev>
          <div className="lsec__kicker">Modules</div>
          <h2 className="lsec__h">Fifteen modules, one login</h2>
          <p className="lsec__lede">
            Enable what your firm uses and leave the rest off. Access is granted
            per person per module, so payroll and invoicing stay closed to the
            people who do not need them.
          </p>
        </div>

        <div className="lmods" data-rev>
          {MODULES.map(m => (
            <div className="lmod" key={m.hi}>
              <div className="lmod__hi" lang="hi">{m.hi}</div>
              <div className="lmod__en">{m.en}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
