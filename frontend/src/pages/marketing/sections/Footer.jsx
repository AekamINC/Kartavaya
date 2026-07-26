import React from 'react';
import { KLogo, KWordmark } from '../../../lib/brand';

/**
 * Footer.
 *
 * The legal column links to routes that do not exist yet. They are marked so
 * rather than pointed at '#', because a privacy policy link that goes nowhere
 * is a worse signal to this audience than an honest "coming" state — and a '#'
 * link looks live until someone clicks it.
 *
 * NO LANGUAGE SELECTOR, and that is a decision rather than an omission. `22`'s
 * structure diagram lists one, but `24` §"The language selector cannot do what
 * it offers" records that there is no translation layer in the codebase — the
 * setting is a bilingual *navigation* preference inside the app, and it is
 * stored per signed-in user. A selector here would offer a stranger a choice
 * that changes nothing on the page they are reading, which is the exact failure
 * `24` argues against: an option that silently renders English is worse than
 * one not yet offered.
 */
const COLUMNS = [
  {
    h: 'Product',
    links: [
      { label: 'Modules',      href: '#modules' },
      { label: 'How it works', href: '#features' },
      { label: 'Plans',        href: '#pricing' },
      { label: 'Sign in',      href: '/login' },
    ],
  },
  {
    h: 'Company',
    links: [{ label: 'Aekam Inc', href: null }],
  },
  {
    h: 'Legal',
    links: [
      { label: 'Privacy policy',   href: null },
      { label: 'Terms of service', href: null },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="lfoot">
      <div className="lwrap">
        <div className="lfoot__grid">
          <div>
            <div className="lfoot__brand">
              <KLogo size={28} /><KWordmark />
            </div>
            <p className="lfoot__blurb">
              Practice management for Indian accounting firms.
            </p>
          </div>

          {COLUMNS.map(c => (
            <div key={c.h}>
              <div className="lfoot__h">{c.h}</div>
              <div className="lfoot__l">
                {c.links.map(l => (
                  l.href
                    ? <a className="lfoot__a" key={l.label} href={l.href}>{l.label}</a>
                    /* --on-surface-3, not --on-surface-faint: the faint token is
                       2.3:1 and carries a NON-TEXT ONLY comment at its
                       declaration. A pending legal link still has to be read. */
                    : <span className="lfoot__a lfoot__a--off" key={l.label}>{l.label}</span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="lfoot__base">
          <span>© {new Date().getFullYear()} Aekam Inc</span>
          {/* --font-hindi, not --font-indic (24 §Which token, where): this is a
              fixed glyph — the product's own name — not a label that follows the
              language setting. In EN+GU, --font-indic resolves to Noto Sans
              Gujarati, which has no Devanagari coverage.

              lang="sa" covers कर्तव्य ONLY. It previously wrapped the English
              gloss too, which hands "that which must be done" to a screen
              reader's Sanskrit voice — the same defect class as the PageHeader
              lang="sa" sweep, in the one place that sweep did not reach.
              CustomizeSettingsPage already does it this way: Devanagari inside
              the lang span, English outside it. */}
          <span className="lfoot__sans" lang="sa">कर्तव्य</span>
          <span> — that which must be done</span>
        </div>
      </div>
    </footer>
  );
}
