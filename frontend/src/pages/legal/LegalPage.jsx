import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { KLogo, KWordmark } from '../../lib/brand';
import { EFFECTIVE, LEGAL_READY, OUTSTANDING, isTKTK } from './legalFacts';
import '../../styles/landing.css';
import '../../styles/legal.css';

/**
 * LegalPage — the shared shell for /privacy, /subprocessors, /security and /dpa.
 *
 * NOT the landing page's Nav. That component's links are all `#hash` anchors
 * into sections of `/`, which on a sub-page scroll to nothing. A legal page is
 * frequently arrived at from a search result or a link pasted into a due
 * diligence questionnaire, so its only navigation obligations are: get back to
 * the product, and reach the other three documents.
 *
 * These pages are centred on a reading measure, which is the one deliberate
 * departure from the fluid left-aligned rule that governs the app. That rule
 * exists so dense tables and boards use the whole screen; a legal page is
 * continuous prose, and prose at 1240px is unreadable. The app shell is not
 * involved here — like the landing page, this tree renders outside auth.
 */

const DOCS = [
  { to: '/privacy',       label: 'Privacy policy' },
  { to: '/subprocessors', label: 'Sub-processors' },
  { to: '/security',      label: 'Security' },
  { to: '/dpa',           label: 'Data processing agreement' },
];

/**
 * TK — renders an owner-owed fact.
 *
 * Deliberately loud. The failure this guards against is a placeholder that
 * reads like real text ("123 Business Park, Mumbai") surviving into
 * production, where it becomes a false statement on a document people rely on.
 * An amber box with the word MISSING cannot be mistaken for content.
 */
export function TK({ v }) {
  if (!isTKTK(v)) return <>{v}</>;
  return (
    <mark className="lgl__tk" title={v.__tktk}>
      MISSING — {v.__tktk}
    </mark>
  );
}

export default function LegalPage({ title, lede, updated = EFFECTIVE, children }) {
  useEffect(() => {
    const prev = document.title;
    document.title = `${title} · Kartavaya`;
    return () => { document.title = prev; };
  }, [title]);

  return (
    <div className="lp lgl">
      <header className="lgl__nav">
        <div className="lgl__wrap lgl__nav-in">
          <Link to="/" className="lgl__brand" aria-label="Kartavaya home">
            <KLogo size={48} /><KWordmark size="md" />
          </Link>
          <nav className="lgl__nav-links" aria-label="Legal documents">
            {DOCS.map(d => (
              <Link key={d.to} className="lgl__nav-a" to={d.to}>{d.label}</Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="lgl__wrap lgl__main">
        <h1 className="lgl__h1">{title}</h1>
        {lede && <p className="lgl__lede">{lede}</p>}
        <p className="lgl__meta">
          {LEGAL_READY ? 'In effect from' : 'Draft — not yet in effect. Dated'} {updated}.
        </p>

        {/* The draft banner is rendered for everyone, not hidden behind an env
            flag. If this document reaches a customer before the outstanding
            facts are filled in, they must see that it is unfinished — a draft
            that looks final is the specific harm here. */}
        {!LEGAL_READY && (
          <div className="lgl__draft" role="note">
            <strong>This document is a draft.</strong> {OUTSTANDING.length}{' '}
            {OUTSTANDING.length === 1 ? 'fact is' : 'facts are'} still outstanding
            and are marked in the text. It is not a statement of Aekam Inc's
            position until they are supplied and this notice disappears.
          </div>
        )}

        <div className="lgl__body">{children}</div>
      </main>

      <footer className="lgl__foot">
        <div className="lgl__wrap">
          <div className="lgl__foot-links">
            {DOCS.map(d => (
              <Link key={d.to} className="lgl__foot-a" to={d.to}>{d.label}</Link>
            ))}
            <Link className="lgl__foot-a" to="/">Back to Kartavaya</Link>
          </div>
          <div className="lgl__foot-base">© {new Date().getFullYear()} Aekam Inc</div>
        </div>
      </footer>
    </div>
  );
}

/** A numbered section. Anchored, because these get cited clause by clause. */
export function Sec({ n, h, children }) {
  const id = `s${n}`;
  return (
    <section className="lgl__sec" id={id}>
      <h2 className="lgl__h2">
        <a className="lgl__anchor" href={`#${id}`} aria-label={`Link to section ${n}`}>{n}.</a>
        {' '}{h}
      </h2>
      {children}
    </section>
  );
}
