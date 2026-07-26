import React from 'react';
import { KLogo, KWordmark } from '../../lib/brand';

/**
 * AuthShell — the split sign-in shell.
 *
 * This was the last screen still on the old cold-blue system: #f4fafd page,
 * #d0e8f5 borders, #0a1628 text, #8aa5be copy, all baked in as literals. It is
 * the FIRST screen anyone sees, and because none of those values were tokens it
 * could not respond to the theme at all — a user with dark mode set got a white
 * sign-in page and then a near-black app one click later.
 *
 * Everything below is tokens, so the auth flow now themes with the rest of the
 * product and inherits the contrast work in 00 §7.
 *
 * The brand panel is HIDDEN below 900px rather than stacked. Stacking a tall
 * decorative panel above the form on a phone means scrolling past marketing to
 * reach a password field.
 */

export const authInput = {
  width: '100%', padding: '11px 14px',
  background: 'var(--s-container)',
  border: '1.5px solid var(--outline-variant)',
  borderRadius: 'var(--r-sm)', fontSize: 14,
  color: 'var(--on-surface)', outline: 'none', boxSizing: 'border-box',
  fontFamily: 'var(--font-ui)',
};

export const authLabel = {
  display: 'block', fontSize: 10, fontWeight: 800, letterSpacing: 2,
  textTransform: 'uppercase', color: 'var(--on-surface-3)', marginBottom: 6,
};

export const authBtn = {
  width: '100%', padding: 13,
  background: 'var(--primary)', border: 'none',
  borderRadius: 'var(--r-sm)', fontSize: 12, fontWeight: 800,
  color: 'var(--on-primary)', cursor: 'pointer',
  letterSpacing: 2, textTransform: 'uppercase', marginTop: 4,
  fontFamily: 'var(--font-ui)',
};

/**
 * Inline field error. The flow reported every failure as a toast in the corner
 * — including client-side checks about a field that is right there on screen —
 * so the field that caused the problem looked fine while the explanation sat
 * elsewhere and then vanished on a timer.
 */
export const authFieldErr = {
  fontSize: 11.5, color: 'var(--danger)', marginTop: 5,
  fontFamily: 'var(--font-ui)', letterSpacing: 0, textTransform: 'none',
};

const FEATURES = [
  'Custom Kanban columns per project',
  'Client portal with restricted access',
  'Invite-only — no public sign-ups',
  '4 board views: Kanban, List, Schedule, Tracker',
];

export default function AuthShell({ children, title, sub }) {
  return (
    <div className="au">
      <aside className="au__brand">
        <div className="au__mesh" aria-hidden="true" />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12 }}>
          <KLogo size={36} /><KWordmark dark />
        </div>
        <div style={{ position: 'relative' }}>
          <h2 className="au__title">{title}</h2>
          <p className="au__sub">{sub}</p>
        </div>
        <ul className="au__features">
          {FEATURES.map(f => (
            <li key={f}>
              <span className="au__dash" aria-hidden="true" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </aside>

      <main className="au__form">
        <div className="au__box">
          {children}
          <div className="au__foot">
            <span>Powered by</span>
            <span className="au__dot" aria-hidden="true" />
            <span className="au__aekam">Aekam Inc</span>
          </div>
        </div>
      </main>
    </div>
  );
}
