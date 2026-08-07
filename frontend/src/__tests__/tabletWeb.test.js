/**
 * The web app in a tablet browser — `design-handover/31-tablet.md` §8.
 *
 * ── WHY THIS FILE EXISTS AT ALL ─────────────────────────────────────────────
 *
 * §8 is the half of the tablet work that is NOT the native app, and it makes
 * three claims the build disagreed with. One of them the build disagreed with
 * DELIBERATELY, with a measurement written into the stylesheet — so this file
 * records which way the disagreement was settled and by whom, because the next
 * person to read `editorial.css`'s comment will otherwise reasonably put the
 * rail back.
 *
 * OWNER, 2026-08-07: "adopt the prototype's burger overlay."
 *
 * The build had added a 72px icon rail across 768–1023 precisely BECAUSE the
 * burger-at-960 behaviour had been measured and judged wrong. That reasoning was
 * not bad; it was overruled. Both halves belong in the record.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

function srcDir() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'styles', 'editorial.css'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('could not locate src/');
}
const SRC = srcDir();
const read = rel => readFileSync(join(SRC, rel), 'utf8');
/** Strip comments — a rule quoted in prose is not a rule that ships. */
const css = rel => read(rel).replace(/\/\*[\s\S]*?\*\//g, '');

/** The body of the first `@media <query> { … }` block, brace-matched. */
function mediaBlock(text, query) {
  const at = text.indexOf(`@media ${query}`);
  if (at === -1) return null;
  const open = text.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(open + 1, i);
  }
  return null;
}

describe('§8 Finding 3 — the web app does not get a rail', () => {
  it('the 768–1023 band does not restore the sidebar', () => {
    // "The web app does not get a rail. It gets the sidebar it already has: in
    // flow at ≥1024 CSS px, an overlay with a burger below that, the bottom nav
    // at ≤767. Do not port the native rail to the web. Two navigations for one
    // product on one device is how the burger came to open a scrim over nothing."
    const band = mediaBlock(css('styles/editorial.css'), '(min-width: 768px) and (max-width: 1023px)');
    if (band === null) return; // the block is gone entirely, which is the goal
    expect(band, 'the tablet band still re-shows .kv__side').not.toMatch(/\.kv__side\s*\{\s*display:\s*flex/);
    expect(band, 'the tablet band still hides the burger').not.toMatch(/\.kv__mobbar\s*\{\s*display:\s*none/);
  });

  it('the ≤1023 swap still ships its replacement in the same rule', () => {
    // The build's own standing rule, and it survives this change: "never hide a
    // nav surface without shipping its replacement in the same change."
    const block = mediaBlock(css('styles/editorial.css'), '(max-width: 1023px)');
    expect(block).toBeTruthy();
    expect(block).toMatch(/\.kv__side\s*\{\s*display:\s*none/);
    expect(block, 'the sidebar is hidden with no burger to replace it').toMatch(/\.kv__mobbar\s*\{\s*display:\s*flex/);
    expect(block).toMatch(/\.kv__scrim\s*\{\s*display:\s*block/);
  });

  it('Sidebar does not force the rail from a width query', () => {
    // A user who CHOOSES the rail keeps it — `prefs.sidebar === 'rail'` is a
    // preference. What goes is inferring it from the viewport, which is the
    // "two navigations for one product" §8 forbids.
    const code = read('components/layout/Sidebar.jsx').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code, 'Sidebar still derives the rail from a media query').not.toMatch(/isTablet\s*\|\|\s*prefs\.sidebar/);
  });
});

describe('§8 Finding 1 — a coarse pointer is not a width', () => {
  it('there is a pointer-only block that does not ask about width', () => {
    // "An iPad in landscape reports 1180 CSS px, lands in the ≥1024 branch, and
    // is served the full desktop layout including its 28px icon buttons — which
    // a mouse hits and a thumb does not. The fix is to stop inferring input from
    // width."
    //
    // NOT `(hover: none) and (pointer: coarse)`, which the build already uses in
    // four places: that pair is about the PRIMARY pointer, and an iPad with a
    // Magic Keyboard attached reports a fine pointer while the same hand still
    // reaches past it to touch the glass.
    const text = css('styles/editorial.css');
    const block = mediaBlock(text, '(pointer: coarse)');
    expect(block, '§8 Finding 1 block is missing from editorial.css').toBeTruthy();
    expect(block, 'the coarse block does not raise any target to 44px').toMatch(/min-height:\s*44px/);
    expect(block).toMatch(/min-width:\s*44px/);
  });
});

describe('§9 web table — sticky first column follows the finger', () => {
  it('the sticky column rule is not gated on width alone', () => {
    // "Sticky first column and edge fade apply on coarse pointers, not only
    // ≤767." An iPad in landscape reports 1180 CSS px and lands in the desktop
    // branch, so a table dragged sideways under a thumb lost its row labels —
    // the one thing that makes a wide table readable.
    const text = css('styles/mobile-responsive.css');
    const block = mediaBlock(text, '(max-width: 767px), (pointer: coarse)');
    expect(block, 'the table block is still width-only').toBeTruthy();
    expect(block, 'the first column is no longer sticky').toMatch(/position:\s*sticky/);
  });
});
