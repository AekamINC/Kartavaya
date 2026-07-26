import React, { useEffect } from 'react';
import Nav from './sections/Nav';
import Hero from './sections/Hero';
import Modules from './sections/Modules';
import Features from './sections/Features';
import Pricing from './sections/Pricing';
import Trust from './sections/Trust';
import Footer from './sections/Footer';
import '../../styles/landing.css';

/**
 * LandingPage — the public marketing page.
 *
 * The only surface a person reads before deciding whether to trust this
 * product with their clients' GSTINs and bank details. Everyone else in the
 * app has already decided; this is read in about forty seconds, probably on a
 * phone, probably from a WhatsApp link sent by another accountant.
 *
 * Deliberately outside the authenticated tree — no AppShell, no auth context,
 * no query provider — so a visitor does not download the app bundle to read a
 * page. It does pull the product stylesheets, which is the accepted cost of
 * building the visuals from real components rather than illustrations.
 *
 * THE PRIMARY CTA HAS NO DESTINATION YET. See pages/marketing/cta.js — it is
 * stubbed rather than guessed, and renders as a disabled button until it is
 * filled in, so it cannot ship as a dead link.
 */
export default function LandingPage() {
  useEffect(() => {
    const els = document.querySelectorAll('[data-rev]');
    if (!els.length) return;

    // Reduced motion: leave everything visible and never arm the observer.
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !('IntersectionObserver' in window)) return;

    // The offset is applied by a class on the ROOT, added here — so if this
    // effect never runs, the content is already visible. Reveals that start at
    // opacity 0 in CSS produce a blank page whenever the observer fails.
    document.documentElement.classList.add('js-rev');

    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });

    els.forEach(el => io.observe(el));
    return () => {
      io.disconnect();
      document.documentElement.classList.remove('js-rev');
    };
  }, []);

  return (
    <div className="lp" id="top">
      <Nav />
      <main>
        <Hero />
        <Modules />
        <Features />
        <Pricing />
        <Trust />
      </main>
      <Footer />
    </div>
  );
}
