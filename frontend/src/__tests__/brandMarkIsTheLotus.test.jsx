/**
 * The mark is the loader's lotus, held at full — and the loader still moves.
 *
 * Owner, 2026-08-07: "use that loader full loaded images and convert to logo …
 * and keep loader as well as it is for animations while loading".
 *
 * Those are two claims that pull against each other, and both are pinned here:
 *
 *   ONE DRAWING.  `KLogo` renders `Lotus`, not a copy of it. A second copy of
 *                 `lobe()` would drift the first time either is retuned, which
 *                 is exactly why 28-messaging-v2.md §6 forbids redrawing it for
 *                 `kamal.js` — the conversation ground is the same rosette.
 *   STILL vs NOT. The mark carries `lotus--still`; the loader must not. If the
 *                 modifier leaked onto BrandLoader the app would look frozen
 *                 while it loaded, and nothing would error.
 *
 * What was replaced was neither a K nor a lotus: two nested diamonds, drawn
 * inline in `lib/brand.jsx`.
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { KLogo } from '../lib/brand';
import Lotus, { lobe, COURSES, EYE_R } from '../components/brand/Lotus';

afterEach(cleanup);

const svgOf = c => c.querySelector('svg.lotus');

describe('the brand mark is the lotus', () => {
  it('renders the lotus rather than a shape of its own', () => {
    const { container } = render(<KLogo size={40} />);
    const svg = svgOf(container);
    expect(svg, 'KLogo does not render .lotus at all').toBeTruthy();
    // The 260 viewbox is Lotus's own coordinate space. A mark drawn in any
    // other box is a second drawing wearing the class name.
    expect(svg.getAttribute('viewBox')).toBe('0 0 260 260');
  });

  it('holds the figure at full instead of animating it', () => {
    const { container } = render(<KLogo size={40} />);
    expect(svgOf(container).classList.contains('lotus--still')).toBe(true);
  });

  it('leaves the loader animating — the modifier must not leak', () => {
    const { container } = render(<Lotus size={168} />);
    const svg = svgOf(container);
    expect(svg.classList.contains('lotus--still'), 'the loader is frozen').toBe(false);
    // And its strokes still carry the per-stroke length the trim animates on.
    const stroked = container.querySelector('.lotus__s');
    expect(stroked.style.getPropertyValue('--len')).toBeTruthy();
  });

  it('drops courses at small sizes rather than shrinking an unreadable one', () => {
    // Sixty petals inside a 260 viewbox rendered at 28px is a smudge. The mark
    // draws fewer courses of the SAME figure, which only works because every
    // course is the same stroke.
    const big = render(<KLogo size={120} />);
    const bigCount = big.container.querySelectorAll('.lotus__s').length;
    cleanup();
    const small = render(<KLogo size={28} />);
    const smallCount = small.container.querySelectorAll('.lotus__s').length;

    expect(smallCount).toBeGreaterThan(0);
    expect(
      smallCount, 'the 28px mark draws as many strokes as the 120px one',
    ).toBeLessThan(bigCount);
  });

  it('widens the pen as it loses courses', () => {
    // 1.6 in a 260 viewbox is right at 168px and invisible at 28.
    const { container } = render(<KLogo size={28} />);
    const pen = parseFloat(svgOf(container).style.getPropertyValue('--pen'));
    expect(pen).toBeGreaterThan(1.6);
  });

  it('paints --on-primary, because the accent chip can be light', () => {
    // Saffron and Amber are two of the twelve presets; a white mark on either
    // is under 2:1.
    const { container } = render(<KLogo size={40} />);
    expect(svgOf(container).style.color).toContain('--on-primary');
  });

  it('keeps one source for the geometry the ground also uses', () => {
    // `kamal.js` draws the conversation ground from these same exports. They
    // are asserted here so a refactor that inlines them into Lotus breaks this
    // file rather than the ground, which fails silently as a blank tile.
    expect(typeof lobe).toBe('function');
    expect(Array.isArray(COURSES)).toBe(true);
    expect(COURSES.length).toBe(4);
    expect(EYE_R).toBe(32);
    expect(lobe(34, 70, 12)).toMatch(/^M0,-34\.00C/);
  });
});
