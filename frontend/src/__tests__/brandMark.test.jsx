/**
 * TWO figures, chosen by how much room the mark has.
 *
 * REPLACES `brandMarkIsTheLotus.test.jsx`, which pinned the opposite and was
 * right for about four hours.
 *
 * The sequence, because the tests only make sense against it:
 *
 *   1. The mark was two nested diamonds — neither a K nor a lotus.
 *   2. Owner: use the loader's lotus. Done, and the mark WAS the loader — the
 *      same `lobe()` and `COURSES` that `kamal.js` draws the Sanvaad
 *      conversation ground from, so all three tracked each other.
 *   3. Owner, having seen the alternatives: "C Half lotus for favicon and rest."
 *   4. Owner, settled: "lotus logo as logo and half lotus for favicon and small
 *      place but where possible i loved to have full lotus … and login page
 *      needs to be bigger for sure, full size."
 *
 * So the full lotus wins wherever it fits and `LotusK` takes the small places.
 *
 *   5. Owner: "'k' needs to be part of lotus same as loader" — क goes in the eye.
 *   6. Owner: "use full space … only 5px padding" — the inset became a FIXED
 *      5px a side rather than a ratio. A ratio looks right on a 128px chip and
 *      leaves a 56px one half empty, because the eye reads the gap.
 *
 * The threshold is on the FIGURE, not the chip: `LOTUS_MIN_FIGURE` = 40, the
 * size below which two courses read as a ring. At 5px padding that is a 50px
 * chip and up. Written this way round because the old form — a chip threshold
 * of 56 — silently moved the moment the padding changed.
 *
 * Step 4 restores what step 3 gave up — at the sizes that matter, the mark IS
 * the loader's drawing again, so retuning a petal moves the mark, the loader and
 * the Sanvaad conversation ground together.
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { KLogo } from '../lib/brand';
import SideBrand from '../components/layout/SideBrand';
import LotusK, { PATHS, penFor } from '../components/brand/LotusK';
import Lotus, { lobe, COURSES, EYE_R } from '../components/brand/Lotus';

afterEach(cleanup);

const markOf = c => c.querySelector('svg.lotusk');

describe('the brand mark', () => {
  it('is the FULL lotus wherever there is room', () => {
    const { container } = render(<KLogo size={104} />);
    const svg = container.querySelector('svg.lotus');
    expect(svg, 'a large mark does not draw the lotus').toBeTruthy();
    expect(svg.getAttribute('viewBox')).toBe('0 0 260 260');
    expect(svg.classList.contains('lotus--still'), 'the mark is animating').toBe(true);
  });

  it('puts क in the eye, the way the loader does', () => {
    // Owner: "'k' needs to be part of lotus same as loader." It is not
    // decoration: Lotus.jsx opened its eye from r11 to r32 FOR this letter, so a
    // lotus without it is the ornament with a hole where the mark should be.
    const { container } = render(<KLogo size={104} />);
    const ka = container.querySelector('.k-mark__ka');
    expect(ka, 'the mark draws no letter').toBeTruthy();
    expect(ka.textContent).toBe('क');
    expect(ka.getAttribute('lang')).toBe('hi');
    // Sized off the eye, never hard-coded — 0.179 is r32 of a 260 box, the same
    // ratio BrandLoader uses. A fixed size puts the letter through the ring.
    const px = parseFloat(ka.style.fontSize);
    expect(px).toBe(Math.round((104 - 10) * 0.179));
  });

  it('scales the letter with the mark rather than fixing it', () => {
    const a = render(<KLogo size={128} />).container.querySelector('.k-mark__ka');
    const big = parseFloat(a.style.fontSize);
    cleanup();
    const b = render(<KLogo size={64} />).container.querySelector('.k-mark__ka');
    expect(parseFloat(b.style.fontSize)).toBeLessThan(big);
  });

  it('falls back to the half-lotus K only where the lotus cannot resolve', () => {
    const { container } = render(<KLogo size={40} />);
    const svg = markOf(container);
    expect(svg, 'a small mark does not draw the K').toBeTruthy();
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.querySelectorAll('path').length).toBe(PATHS.length);
  });

  it('switches on the FIGURE reaching 40px, not on a chip size', () => {
    // 50 - 10 = 40 of lotus; 49 - 10 = 39, which is the K. The threshold is
    // stated on the drawing because that is what actually stops resolving.
    const at50 = render(<KLogo size={50} />).container.querySelector('svg.lotus');
    expect(at50, '50 gives the figure 40px and should be the lotus').toBeTruthy();
    cleanup();
    const at49 = render(<KLogo size={49} />).container.querySelector('svg.lotusk');
    expect(at49, '49 gives the figure 39px and should be the K').toBeTruthy();
  });

  it('leaves exactly 5px a side, at every size', () => {
    // Owner: "use full space for lotus only 5px padding." It was 0.72 of the
    // chip — 28% air, which read as a small mark floating in a big square.
    for (const chipSize of [56, 104, 128]) {
      const { container } = render(<KLogo size={chipSize} />);
      const svg = container.querySelector('svg.lotus');
      expect(Number(svg.getAttribute('width')), `${chipSize}px chip`).toBe(chipSize - 10);
      cleanup();
    }
  });

  it('draws the spine, which is what makes it read as a K', () => {
    // The upright is the whole difference between this and an ornament. A
    // future retune that loses it leaves a flower, and the brief was a letter.
    const { container } = render(<KLogo size={40} />);
    const ds = [...markOf(container).querySelectorAll('path')].map(p => p.getAttribute('d'));
    expect(ds.some(d => /^M6\.5 3\.5V20\.5$/.test(d))).toBe(true);
    expect(ds.length, 'a K needs a spine and two arms').toBe(3);
  });

  it('widens the pen as it shrinks', () => {
    // 1.8 in a 24 viewbox is right at 72px and hairline at 16.
    expect(penFor(16)).toBeGreaterThan(penFor(72));
    const { container } = render(<LotusK size={16} />);
    const w = Number(container.querySelector('path').getAttribute('stroke-width'));
    expect(w).toBe(penFor(16));
  });

  it('paints --on-primary, because the accent chip can be light', () => {
    // Saffron and Amber are two of the twelve presets; white on either is
    // under 2:1.
    const { container } = render(<KLogo size={40} />);
    expect(markOf(container).style.color).toContain('--on-primary');
  });

  it('is in the sidebar — the mark on every screen', () => {
    // The miss that took two rounds to find. `KLogo` was changed and nothing
    // moved, because the sidebar rendered an <img> of a PNG instead.
    const { container } = render(<SideBrand />);
    expect(
      container.querySelector('svg.lotus, svg.lotusk'),
      'the sidebar does not render the mark',
    ).toBeTruthy();
    expect(container.querySelector('img'), 'the sidebar still paints a raster').toBeNull();
  });

  it('gives the sidebar the FULL lotus, not the small fallback', () => {
    // 56px, which is the floor exactly — the rail is 72px wide, so it fits.
    const { container } = render(<SideBrand />);
    expect(container.querySelector('svg.lotus')).toBeTruthy();
  });

  it('survives the sidebar collapsing to the rail', () => {
    const { container } = render(<SideBrand rail />);
    expect(container.querySelector('svg.lotus, svg.lotusk')).toBeTruthy();
  });
});

describe('the loader was left alone', () => {
  it('still animates, and is still the lotus', () => {
    // The owner's second instruction: "keep loader as well as it is for
    // animations while loading". A mark change must never reach it.
    const { container } = render(<Lotus size={168} />);
    const svg = container.querySelector('svg.lotus');
    expect(svg, 'the loader is no longer the lotus').toBeTruthy();
    expect(svg.classList.contains('lotus--still'), 'the loader is frozen').toBe(false);
    expect(container.querySelector('.lotus__s').style.getPropertyValue('--len')).toBeTruthy();
  });

  it('keeps the geometry the Sanvaad ground also draws from', () => {
    // `kamal.js` builds the conversation ground from these. They are asserted
    // here because that ground fails SILENTLY — a blank tile, never an error.
    expect(typeof lobe).toBe('function');
    expect(COURSES.length).toBe(4);
    expect(EYE_R).toBe(32);
    expect(lobe(34, 70, 12)).toMatch(/^M0,-34\.00C/);
  });

  it('is the SAME figure the large mark draws — held still rather than trimmed', () => {
    // What step 4 restored. At the sizes that matter the mark is the loader's
    // drawing, so retuning a petal moves the mark, the loader and the Sanvaad
    // ground together. The only difference is the animation.
    // At 128 the figure is 92px, which `lotusDetail` draws at all four courses —
    // so the mark and the loader are stroke for stroke the same drawing.
    const mark = render(<KLogo size={128} />).container.querySelector('svg.lotus');
    const markPaths = mark.querySelectorAll('path').length;
    cleanup();
    const loader = render(<Lotus size={168} />).container.querySelector('svg.lotus');
    expect(mark.getAttribute('viewBox')).toBe(loader.getAttribute('viewBox'));
    expect(markPaths).toBe(loader.querySelectorAll('path').length);
  });

  it('drops courses below that, rather than shrinking an unreadable figure', () => {
    // 104 draws 75px of lotus, which `lotusDetail` gives three courses. Same
    // drawing, fewer courses — only possible because every course is one pen.
    // 128 -> 118px -> four courses. 80 -> 70px -> three. 56 -> 46px -> two.
    const big = render(<KLogo size={128} />).container.querySelectorAll('.lotus__s').length;
    cleanup();
    const mid = render(<KLogo size={80} />).container.querySelectorAll('.lotus__s').length;
    cleanup();
    const small = render(<KLogo size={56} />).container.querySelectorAll('.lotus__s').length;
    expect(small).toBeGreaterThan(0);
    expect(small).toBeLessThan(mid);
    expect(mid).toBeLessThan(big);
  });
});
