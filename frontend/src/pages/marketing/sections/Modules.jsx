import React from 'react';

/**
 * Modules — the product's actual vocabulary.
 *
 * ── DEVANAGARI LEADS HERE. DO NOT "FIX" IT ─────────────────────────────────
 * This inverts 24-bilingual-devanagari.md's global "English main, Devanagari
 * sub" rule, and the inversion is now a STATED EXCEPTION in `24` itself
 * (§"The landing page is an exception, and it is deliberate") rather than a
 * comment in this file — which is what it was, and which read as drift.
 *
 * The two surfaces do different jobs. In the app a Devanagari sub-label is
 * WAYFINDING for someone who walks the same eight items every day, so English
 * leads because that is what they are scanning for. Here it is POSITIONING: it
 * says this product was built for an Indian practice, by people who name things
 * in Sanskrit, before a single feature is read. The visitor is not navigating,
 * so nothing is slowed down by a word they skim past.
 *
 * Bounded to this page. It does not extend to the app screenshots, the auth
 * screens or onboarding — by the time someone signs in they are navigating.
 *
 * ── Names ──────────────────────────────────────────────────────────────────
 * Checked against components/layout/navConfig.js rather than retyped, so the
 * page cannot drift from the product's own menu. Where the English differs it
 * is an expansion for a reader who has never seen the product ("Invoicing" →
 * "Invoicing & GST"), not a second vocabulary.
 *
 * CRM is ग्रह — Graha, the module's own name. NOT ग्राहक.
 *
 * This line previously read ग्राहक and claimed, just above, to have been
 * "checked against navConfig.js rather than retyped, so the page cannot drift
 * from the product's own menu". The page HAD drifted, and this was the drift:
 *
 *   · `navConfig.js:64`  — `hi: 'ग्रह'`, and :60-62 say "`ग्रह` not `ग्राहक`"
 *   · `lib/moduleColors.js` — `graha: { hi: 'ग्रह' }`, the single source
 *   · the design reference, on the LANDING PAGE itself — `Landing.jsx:6`,
 *     `Landing2.jsx:36` and `Landing2.jsx:134` all render ग्रह
 *
 * ग्राहक means *customer*, and the sidebar already spends it on the Clients
 * section heading (`navConfig.js:143`, `section: 'clients', sans: 'ग्राहक'`).
 * One word cannot label a module here and a different thing after sign-in — a
 * prospect reading ग्राहक next to "CRM" on this page then finds ग्राहक over
 * something else on their first afternoon in the product.
 *
 * The older note this replaces argued only against ग्राह (seizing/crocodile),
 * which nobody proposed; it never addressed ग्रह, the word actually in use.
 */
const MODULES = [
  { hi: 'ग्रह',      en: 'CRM' },
  { hi: 'गणित',     en: 'Invoicing & GST' },
  { hi: 'मानव',     en: 'HRMS' },
  { hi: 'वेतन',     en: 'Payroll' },
  { hi: 'विक्रय',   en: 'Sales' },
  { hi: 'दृष्टि',   en: 'Analytics' },
  { hi: 'प्रचार',   en: 'Marketing' },
  { hi: 'प्रमाण',   en: 'E-signatures' },
  { hi: 'संवाद',    en: 'Messaging & WhatsApp' },
  { hi: 'सहायक',    en: 'AI assistant' },
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
