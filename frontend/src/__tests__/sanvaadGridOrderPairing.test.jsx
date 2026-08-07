/**
 * The own-reply that rendered one word per line.
 *
 * Caught on screen by the owner, 2026-08-07: a reply inside an expanded thread
 * showed "Also / you / can / react / to / the / messages / as / well" stacked
 * vertically, with the avatar out to its right.
 *
 * THE MECHANISM, because it generalises and this file exists for the general
 * case rather than the one rule:
 *
 *   .m2m                    grid-template-columns: 36px minmax(0, 1fr)
 *   .m2m--mine              grid-template-columns: minmax(0, 1fr) 36px
 *   .m2m--mine .m2m__b      order: 1        <- bubble first
 *   .m2m--mine .m2m__av     order: 2        <- avatar second
 *
 * `--mine` reverses the layout in TWO places at once: it mirrors the column
 * template AND it reorders the children. They only agree while both are in
 * force. `.m2th__body .m2m` is (0,2,0) to `.m2m--mine`'s (0,1,0), so inside a
 * thread the template was reset to 26px-first while the `order` swap survived —
 * the bubble was placed in the 26px column and the avatar in the flexible one.
 * 26px is narrower than most words, so the text wrapped at every space.
 *
 * Nothing errored. A grid column can be 26px wide and still be valid CSS, so
 * this fails as a shape and never as an exception, which is why it needs a test
 * rather than a type.
 *
 * THE RULE THIS PINS: any selector that re-states `grid-template-columns` for
 * `.m2m` must also state the `--mine` mirror, or the two halves of "mine" —
 * template and order — disagree.
 */
import { describe, it, expect } from 'vitest';
import { allCssRules } from './e2e/_harness';

const RULES = allCssRules();

/** Rules that set grid-template-columns on a selector mentioning `.m2m`. */
function templateSetters() {
  return RULES.filter(
    r => /grid-template-columns\s*:/.test(r.body) &&
         r.selectors.some(s => /\.m2m(\b|--|__)/.test(s))
  );
}

describe('sanvaad · the message grid and its --mine mirror', () => {
  it('states a --mine template wherever it re-states the base template', () => {
    const setters = templateSetters();
    expect(setters.length, 'no rule sets grid-template-columns on .m2m at all')
      .toBeGreaterThan(0);

    // Every CONTEXT that scopes .m2m (`.m2th__body .m2m`, and any future one)
    // must carry a --mine twin in the same context.
    const contexts = new Map();
    for (const r of setters) {
      for (const sel of r.selectors) {
        if (!/\.m2m(\b|--)/.test(sel)) continue;
        const mine = /\.m2m--mine/.test(sel);
        // The prefix before `.m2m` is the context: '' for the bare rule.
        const ctx = sel.slice(0, sel.indexOf('.m2m')).trim();
        const entry = contexts.get(ctx) || { base: false, mine: false };
        if (mine) entry.mine = true; else entry.base = true;
        contexts.set(ctx, entry);
      }
    }

    const unpaired = [...contexts.entries()]
      .filter(([, v]) => v.base && !v.mine)
      .map(([ctx]) => ctx || '(root)');

    expect(
      unpaired,
      'these contexts re-state .m2m\'s grid-template-columns without a ' +
      '.m2m--mine mirror. `.m2m--mine .m2m__b { order: 1 }` still applies there, ' +
      'so an own message puts its BUBBLE in the avatar column — the one-word-' +
      'per-line bug the owner caught on 2026-08-07.',
    ).toEqual([]);
  });

  it('mirrors the columns rather than repeating them', () => {
    // A twin that copies the base template instead of reversing it would pass
    // the pairing test above and reproduce the identical bug.
    for (const r of templateSetters()) {
      for (const sel of r.selectors) {
        if (!/\.m2m--mine/.test(sel)) continue;
        const m = /grid-template-columns\s*:\s*([^;]+)/.exec(r.body);
        expect(m, `${sel} matched as a template setter but states none`).toBeTruthy();
        const cols = m[1].trim();
        // The flexible track must come FIRST for --mine, because the bubble is
        // ordered first there. A fixed px track in position one is the bug.
        expect(
          /^minmax\(\s*0/.test(cols),
          `${sel} sets "${cols}". For --mine the FLEXIBLE track must come first: ` +
          'the bubble is order:1 and lands in column one.',
        ).toBe(true);
      }
    }
  });

  it('keeps the thread avatar column and the thread template the same width', () => {
    // The mirror is only correct if its fixed track matches the avatar size the
    // same context sets. 26px template against a 36px avatar would overflow.
    const thread = RULES.filter(r =>
      r.selectors.some(s => s.includes('.m2th__body'))
    );
    const avatar = thread.find(r => r.selectors.some(s => s.includes('.m2m__av')));
    expect(avatar, '.m2th__body does not size .m2m__av').toBeTruthy();
    const w = /width\s*:\s*(\d+)px/.exec(avatar.body);
    expect(w, '.m2th__body .m2m__av states no width').toBeTruthy();

    for (const r of thread) {
      const m = /grid-template-columns\s*:\s*([^;]+)/.exec(r.body);
      if (!m) continue;
      expect(
        m[1],
        `.m2th__body sizes the avatar ${w[1]}px but its template says "${m[1].trim()}"`,
      ).toContain(`${w[1]}px`);
    }
  });
});
