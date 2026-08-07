import React, { useEffect, useState } from 'react';
import { KLogo, KWordmark } from '../../../lib/brand';
import { PRIMARY_CTA, SECONDARY_CTA, ctaReady } from '../cta';

const LINKS = [
  { href: '#modules',  label: 'Modules' },
  { href: '#features', label: 'How it works' },
  { href: '#pricing',  label: 'Plans' },
  { href: '#trust',    label: 'Trust' },
];

/** Transparent over the hero, solid once scrolled; burger under 860px. */
export default function Nav() {
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav className={`lnav${solid ? ' solid' : ''}`}>
      <div className="lwrap lnav__in">
        <a href="#top" className="lnav__brand">
          <KLogo size={64} /><KWordmark size="lg" />
        </a>

        <div className={`lnav__links${open ? ' open' : ''}`} id="lnav-links">
          {LINKS.map(l => (
            <a key={l.href} className="lnav__a" href={l.href} onClick={() => setOpen(false)}>{l.label}</a>
          ))}
          <a className="lnav__a" href={SECONDARY_CTA.href}>{SECONDARY_CTA.label}</a>
          {ctaReady && (
            <a className="lcta lcta--fill lcta--nav" href={PRIMARY_CTA.href}>
              {PRIMARY_CTA.label}
            </a>
          )}
        </div>

        <button
          className="lnav__burger k-iconbtn"
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-controls="lnav-links"
          aria-label={open ? 'Close menu' : 'Open menu'}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {open ? <><path d="M18 6L6 18" /><path d="M6 6l12 12" /></>
                  : <><path d="M3 12h18" /><path d="M3 6h18" /><path d="M3 18h18" /></>}
          </svg>
        </button>
      </div>
    </nav>
  );
}
