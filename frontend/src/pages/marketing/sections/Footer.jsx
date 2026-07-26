import React from 'react';
import { KLogo, KWordmark } from '../../../lib/brand';

/**
 * Footer.
 *
 * The legal column links to routes that do not exist yet. They are marked so
 * rather than pointed at '#', because a privacy policy link that goes nowhere
 * is a worse signal to this audience than an honest "coming" state — and a '#'
 * link looks live until someone clicks it.
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <KLogo size={28} /><KWordmark />
            </div>
            <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--on-surface-2)', maxWidth: '32ch' }}>
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
                    : <span className="lfoot__a" key={l.label} style={{ color: 'var(--on-surface-faint)' }}>{l.label}</span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="lfoot__base">
          <span>© {new Date().getFullYear()} Aekam Inc</span>
          <span lang="sa" style={{ fontFamily: 'var(--font-indic)' }}>कर्तव्य — that which must be done</span>
        </div>
      </div>
    </footer>
  );
}
