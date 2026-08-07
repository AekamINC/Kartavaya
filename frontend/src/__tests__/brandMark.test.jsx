/**
 * The mark is `LotusK`. The loader is `Lotus`. They are two figures ON PURPOSE.
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
 *
 * Step 3 gives up the property step 2 bought. `LotusK` is a separate drawing and
 * will NOT track the ornament. That is the right call — the lotus does not read
 * as a K and the brief was a K — but it is a real cost, so the one thing this
 * file still guards from step 2 is that the LOADER was left alone.
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
  it('is the half-lotus K, in its own 24 viewbox', () => {
    const { container } = render(<KLogo size={48} />);
    const svg = markOf(container);
    expect(svg, 'KLogo does not render .lotusk').toBeTruthy();
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.querySelectorAll('path').length).toBe(PATHS.length);
  });

  it('draws the spine, which is what makes it read as a K', () => {
    // The upright is the whole difference between this and an ornament. A
    // future retune that loses it leaves a flower, and the brief was a letter.
    const { container } = render(<KLogo size={48} />);
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
    const { container } = render(<KLogo size={48} />);
    expect(markOf(container).style.color).toContain('--on-primary');
  });

  it('is in the sidebar — the mark on every screen', () => {
    // The miss that took two rounds to find. `KLogo` was changed and nothing
    // moved, because the sidebar rendered an <img> of a PNG instead.
    const { container } = render(<SideBrand />);
    expect(markOf(container), 'the sidebar does not render the mark').toBeTruthy();
    expect(container.querySelector('img'), 'the sidebar still paints a raster').toBeNull();
  });

  it('survives the sidebar collapsing to the rail', () => {
    const { container } = render(<SideBrand rail />);
    expect(markOf(container)).toBeTruthy();
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

  it('is a different figure from the mark, and that is deliberate', () => {
    const mark = render(<KLogo size={48} />).container.querySelector('svg.lotusk');
    expect(mark).toBeTruthy();
    cleanup();
    const loader = render(<Lotus size={168} />).container.querySelector('svg.lotus');
    expect(loader).toBeTruthy();
    // Different coordinate spaces is the cheapest proof they are not one file
    // pretending to be two.
    expect(mark.getAttribute('viewBox')).not.toBe(loader.getAttribute('viewBox'));
  });
});
