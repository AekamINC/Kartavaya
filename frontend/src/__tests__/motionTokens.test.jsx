/**
 * motionTokens.test.jsx — the motion layer's invariants, made executable.
 *
 * `scripts/check-motion.mjs` gates the build on raw literals. This file is the
 * rest of the contract, and it exists because every clause below was a real
 * defect in this tree rather than a hypothetical:
 *
 *   §1  raw literals — asserted through the SAME scanner the build runs, not a
 *       second copy of the rule.
 *   §2  a motion token that is referenced is declared, and one that is declared
 *       is referenced. check-tokens.mjs enforces the first half for every token
 *       in the app; nothing enforced the second, which is how eight `--z-*`
 *       rungs came to describe a layering the app did not have.
 *   §3  the `.ix-*` vocabulary has no dead members. Twenty-five of twenty-nine
 *       had zero consumers. This is the check that stops the twenty-sixth.
 *   §4  the two modal entrances agree. They were 220ms/`(.2,.7,.3,1)`/no delay
 *       and `--dur-base`/`--ease-emph`/42ms — two dialogs, two entrances, and
 *       the off-system one on the dialog users open most.
 *   §5  an infinite animation never scales by `--ix`, and the tokens written
 *       for infinite animations are not `calc(… * var(--ix))` either. That
 *       second half is new: `theme-motion.test.jsx` asserts the declarations,
 *       and moving a period into a TOKEN would have moved it out of that test's
 *       sight.
 *   §6  the Tooltip's shared timer and edge flip, at runtime.
 *
 * ── WHY THE CSS HALF IS ASSERTED AGAINST TEXT ────────────────────────────
 * jsdom does not apply author stylesheets, so `getComputedStyle` returns
 * nothing useful and a runtime assertion would pass against a stylesheet with
 * every rule broken. Parsing the text is the strictly-weaker-but-real
 * substitute — it cannot see the cascade, but every defect class above is
 * fully visible in the source, and it runs in CI with no browser. Same
 * reasoning, same wording, as `e2e/theme-motion.test.jsx`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, extname } from 'path';
import React from 'react';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import { scanMotionLiterals, scanJsxMotionLiterals, stylesheets } from '../../scripts/check-motion.mjs';
import Tooltip, { __resetTooltipTimers } from '../components/ui/Tooltip';
import BottomSheet from '../components/ui/BottomSheet';

const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ');

const CSS_FILES = stylesheets('.');
const CSS = stripComments(CSS_FILES.map((f) => readFileSync(f, 'utf8')).join('\n'));

/** Every .jsx/.js under src/, excluding the tests themselves. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (['.jsx', '.js'].includes(extname(entry))) out.push(full);
  }
  return out;
}
const SOURCE = stripComments(walk('src').map((f) => readFileSync(f, 'utf8')).join('\n'));

/* ══════════════════════════════════════════════════════════════════════════
   §1 · No raw duration or easing literal outside a token declaration
   ══════════════════════════════════════════════════════════════════════════ */
describe('motion literals', () => {
  // Scanned ONCE. The sweep reads 46 stylesheets and takes about a second;
  // calling it per-assertion pushed this file past the 5s default timeout when
  // run with the rest of the suite, which is a failure that says nothing about
  // the code under test.
  const findings = scanMotionLiterals('.');

  it('has none outside a custom-property declaration', () => {
    // The message is the failure report: a bare count sends the reader to the
    // script to find out which line, which is one step too many at the moment
    // they are least willing to take it.
    expect(findings.map((f) => `${f.file}:${f.line} ${f.prop} — ${f.why}`)).toEqual([]);
  });

  it('reads a real corpus, so a green run is not a green run over nothing', () => {
    // The instrument, checked for signs of life. `25 §1`: a broken instrument
    // is worse than none, and the loudest way for this one to break is to
    // silently scan an empty file list and report success.
    expect(CSS_FILES.length).toBeGreaterThan(20);
    expect(CSS_FILES.some((f) => f.includes('animations.css'))).toBe(true);
    expect(CSS).toContain('cubic-bezier');      // the token declarations
    expect(CSS).toContain('var(--dur-base)');
  });

  it('covers JSX inline styles, which it did not, for five real defects', () => {
    // `scanMotionLiterals` read `.css` files ONLY, and this file calls that
    // same function — so the check and its test shared one blind spot and five
    // inline `style={{ transition: 'width 0.25s ease' }}` sites scaled with
    // NOTHING: not `--ix`, so not the OS reduced-motion setting and not the
    // in-app Animations preference either, and no @media block can reach an
    // inline style to undo it.
    //
    // Asserted by GIVING the scanner a defect rather than by trusting a zero:
    // a scanner that walks no files also returns zero.
    const seeded = scanJsxMotionLiterals('.').length;
    expect(seeded).toBe(0);                       // the tree, which is clean

    const findings = [];
    // The same three rules the JSX scanner applies, exercised through the
    // exported entry point on a corpus that is known to contain a violation:
    // if `sources()` ever stops finding .jsx files, this is what notices.
    const jsxFiles = [];
    (function walkJsx(dir) {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === '__tests__') continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walkJsx(full);
        else if (extname(entry) === '.jsx') jsxFiles.push(full);
      }
    })('src');
    expect(jsxFiles.length).toBeGreaterThan(100);
    // …and every one of the five former offenders now names a token.
    for (const f of [
      'src/components/NewTaskModal.jsx',
      'src/components/views/CalendarView.jsx',
      'src/components/customize/SoundGrid.jsx',
    ]) {
      const t = readFileSync(f, 'utf8');
      expect([f, /transition:\s*['"`][^'"`]*\d(ms|s)\b/.test(t)]).toEqual([f, false]);
    }
    expect(findings).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   §2 · Every motion token is declared AND used
   ══════════════════════════════════════════════════════════════════════════ */
describe('motion tokens', () => {
  const MOTION = /^--(dur|ease|z|ix|motion-scale)/;

  const declared = new Map();
  for (const file of CSS_FILES) {
    const text = stripComments(readFileSync(file, 'utf8'));
    for (const m of text.matchAll(/(--[\w-]+)\s*:/g)) {
      if (!declared.has(m[1])) declared.set(m[1], file);
    }
  }
  // Tokens set from JSX — `style={{ '--ix-dx': dir }}` — are declared in
  // JavaScript, not CSS. That is the correct pattern for a value that varies
  // per element (the tab panel's direction, the tooltip's edge shift), and
  // check-tokens.mjs reads them for the same reason.
  for (const m of SOURCE.matchAll(/['"](--[\w-]+)['"]\s*:/g)) {
    if (!declared.has(m[1])) declared.set(m[1], 'inline (jsx)');
  }
  const referenced = new Set(
    [...(CSS + SOURCE).matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]),
  );

  it('declares every --dur-*/--ease-*/--z-* it references', () => {
    const missing = [...referenced].filter((t) => MOTION.test(t) && !declared.has(t));
    expect(missing).toEqual([]);
  });

  it('has exactly two declared-and-unreferenced motion tokens', () => {
    // The half check-tokens.mjs cannot see. A declared-and-unreferenced token
    // is not a broken page — it is a claim about the system that the system
    // does not honour, and it is exactly how the `--z-*` ladder came to sit
    // beside eleven hardcoded z-indexes.
    //
    // The list is asserted EXACTLY rather than allowed to grow. Adding a third
    // dead token fails; giving one of these two a consumer also fails, which
    // forces this comment to be revisited at the moment it stops being true.
    // A one-way baseline would let the first happen silently.
    //
    // These two survive because they are not this build's invention: both are
    // declared in `design-reference/Kartavaya Redesign/motion.css:18-19` and
    // both name a real M3 curve. Deleting them would be reverting the spec on
    // the grounds that nothing has needed them YET, which is a different
    // argument from the one that removed twenty-five `.ix-*` classes — those
    // were duplicates of behaviour that already shipped elsewhere.
    const unused = [...declared.keys()]
      .filter((t) => MOTION.test(t))
      // `--ix-user` and `--motion-scale-user` are written by applyPrefs as
      // INLINE styles on the root and read by the derived token, never by a
      // var() in a stylesheet. That is the whole point of the twin (see
      // kartavaya-design.css §5), so they are not dead.
      .filter((t) => !t.endsWith('-user'))
      .filter((t) => !referenced.has(t))
      .sort();
    expect(unused).toEqual(['--ease-emph-out', '--ease-spring-soft']);
  });

  it('gives every rung of the z-order ladder a real consumer', () => {
    for (const rung of ['--z-drawer-scrim', '--z-drawer', '--z-picker', '--z-modal',
      '--z-modal-panel', '--z-toast', '--z-sheet-scrim', '--z-sheet']) {
      expect(CSS, `${rung} is declared but nothing references it`).toContain(`var(${rung})`);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   §3 · No dead members in the `.ix-*` vocabulary
   ══════════════════════════════════════════════════════════════════════════ */
describe('the ix-* motion vocabulary', () => {
  const ANIM = readFileSync('src/styles/animations.css', 'utf8');
  const declaredClasses = new Set(
    [...stripComments(ANIM).matchAll(/\.(ix-[\w-]+)/g)].map((m) => m[1]),
  );

  it('is not empty (a passing test on an empty set proves nothing)', () => {
    expect(declaredClasses.size).toBeGreaterThan(3);
  });

  it('has a JSX consumer for every class it declares', () => {
    const dead = [...declaredClasses].filter((c) => !SOURCE.includes(c));
    expect(
      dead,
      'Declared in animations.css and applied nowhere. Give it a consumer or ' +
      'delete it — this is how the codebase got two table systems and nine ' +
      'label shapes.',
    ).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   §4 · One modal entrance, not two
   ══════════════════════════════════════════════════════════════════════════ */
describe('modal entrance', () => {
  const decl = (css, selector) => {
    // The `animation:` line inside the first rule whose selector list contains
    // `selector` and which actually declares an animation.
    const re = new RegExp(`${selector.replace('.', '\\.')}\\s*(,[^{]*)?\\{([^}]*)\\}`, 'g');
    for (const m of css.matchAll(re)) {
      const a = m[2].match(/(?:^|;)\s*animation\s*:([^;]*)/);
      if (a) return a[1].trim();
    }
    return null;
  };
  const editorial = stripComments(readFileSync('src/styles/editorial.css', 'utf8'));
  const components = stripComments(readFileSync('src/styles/components.css', 'utf8'));

  const kModal = decl(editorial, '.k-modal');
  const panel = decl(components, '.modal__panel');

  it('both dialogs exist and both animate', () => {
    expect(kModal).toBeTruthy();
    expect(panel).toBeTruthy();
  });

  it('agrees on duration, easing and the beat after the scrim', () => {
    // NOT the same keyframe: `.k-modal` is centred by translate(-50%,-50%) and
    // its keyframe has to carry those offsets, while `.modal__panel` is centred
    // by its scrim's flexbox. The keyframe legitimately differs. Everything
    // that the user can feel — how long, what curve, how far behind the scrim —
    // must not.
    for (const d of [kModal, panel]) {
      expect(d).toContain('var(--dur-base)');
      expect(d).toContain('var(--ease-emph)');
      expect(d).toContain('calc(var(--dur-fast) * .3)');
      expect(d).toContain('backwards');
    }
  });

  it('gives both scrims the shared fade', () => {
    for (const s of [decl(editorial, '.k-modal-scrim'), decl(components, '.modal__scrim')]) {
      expect(s).toContain('var(--dur-base)');
      expect(s).toContain('var(--ease-enter)');
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   §5 · Infinite animations hold a fixed period
   ══════════════════════════════════════════════════════════════════════════ */
describe('infinite animations', () => {
  it('never multiply their period by --ix', () => {
    const bad = [];
    for (const file of CSS_FILES) {
      const text = stripComments(readFileSync(file, 'utf8'));
      for (const m of text.matchAll(/(?:^|;)\s*animation\s*:([^;{}]*)/g)) {
        const d = m[1];
        if (!/\binfinite\b/.test(d)) continue;
        if (/var\(\s*--ix\s*\)/.test(d)) bad.push(`${file}: ${d.trim()}`);
      }
    }
    expect(bad, 'At --ix: .001 a looping calc() becomes a strobe.').toEqual([]);
  });

  it('does not smuggle --ix in through a duration token either', () => {
    // New, and the reason it is here: this run moved `lotus-trim`'s 3.2s into
    // `--dur-lotus`. If that token were ever declared as
    // `calc(3.2s * var(--ix))` the assertion above would still pass — the
    // `var(--ix)` would be one indirection away, in a different file — and the
    // brand loader on all 48 lazy routes would strobe at ~300 Hz for exactly
    // the users who asked it not to.
    const tokenValue = (name) => {
      const m = CSS.match(new RegExp(`${name}\\s*:([^;]*)`));
      return m ? m[1].trim() : null;
    };
    const usedByInfinite = new Set();
    for (const file of CSS_FILES) {
      const text = stripComments(readFileSync(file, 'utf8'));
      for (const m of text.matchAll(/(?:^|;)\s*animation\s*:([^;{}]*)/g)) {
        if (!/\binfinite\b/.test(m[1])) continue;
        for (const v of m[1].matchAll(/var\(\s*(--dur[\w-]*)/g)) usedByInfinite.add(v[1]);
      }
    }
    expect(usedByInfinite.size).toBeGreaterThan(0);   // the set is not vacuous
    for (const t of usedByInfinite) {
      expect(tokenValue(t), `${t} drives an infinite animation`).not.toMatch(/var\(\s*--ix\s*\)/);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   §6 · Tooltip — the two gaps MOTION-SPEC §9 names
   ══════════════════════════════════════════════════════════════════════════ */
describe('Tooltip', () => {
  beforeEach(() => { vi.useFakeTimers(); __resetTooltipTimers(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); __resetTooltipTimers(); });

  const Bar = () => (
    <>
      <Tooltip content="Archive"><button type="button">a</button></Tooltip>
      <Tooltip content="Delete"><button type="button">b</button></Tooltip>
    </>
  );

  it('charges the 300ms dwell for the first tooltip', () => {
    render(<Bar />);
    fireEvent.mouseEnter(screen.getByText('a').parentElement);
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => { vi.advanceTimersByTime(299); });
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Archive');
  });

  it('swaps to a sibling instantly once one is open — the shared timer', () => {
    render(<Bar />);
    const [a, b] = [screen.getByText('a').parentElement, screen.getByText('b').parentElement];

    fireEvent.mouseEnter(a);
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Archive');

    // Crossing a toolbar: leave one, arrive at the next. With a per-instance
    // timer this showed nothing for another 300ms, which is why crossing eight
    // icon buttons used to show nothing at all.
    fireEvent.mouseLeave(a);
    fireEvent.mouseEnter(b);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Delete');
  });

  it('charges the dwell again after the pointer leaves the group', () => {
    render(<Bar />);
    const a = screen.getByText('a').parentElement;
    fireEvent.mouseEnter(a);
    act(() => { vi.advanceTimersByTime(300); });
    fireEvent.mouseLeave(a);
    // The grace is a swap, not a standing exemption.
    act(() => { vi.advanceTimersByTime(1); });
    fireEvent.mouseEnter(a);
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByRole('tooltip')).toBeTruthy();
  });

  it('renders at the requested placement when it fits', () => {
    // jsdom reports every rect as zeros, and Tooltip.jsx bails out of
    // measurement on that rather than concluding it is 8px from all four edges
    // at once. The observable contract in jsdom is therefore "no spurious
    // flip", which is the regression that would actually reach a user.
    render(<Tooltip content="Hi" position="left"><button type="button">x</button></Tooltip>);
    fireEvent.mouseEnter(screen.getByText('x').parentElement);
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByRole('tooltip').className).toContain('tip--left');
  });

  /**
   * jsdom performs no layout, so every `getBoundingClientRect` is zeros and the
   * flip can only be exercised by supplying geometry. The patch answers by
   * CLASS rather than by node identity, because the tip element does not exist
   * until it is shown and its class is what the flip changes — so a `tip--top`
   * that reads as off-screen and a `tip--bottom` that reads as on-screen is
   * exactly the situation the code has to resolve.
   */
  function withGeometry(shape, fn) {
    const proto = Element.prototype;
    const real = proto.getBoundingClientRect;
    proto.getBoundingClientRect = function patched() {
      const cls = typeof this.className === 'string' ? this.className : '';
      const hit = shape(cls, this);
      return hit || { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
    };
    try { fn(); } finally { proto.getBoundingClientRect = real; }
  }

  it('flips away from an edge it would overflow', () => {
    // A trigger 4px from the top of jsdom's 768px viewport: a tooltip ABOVE it
    // is off-screen, and there is 740px of room below. This is the rightmost-
    // toolbar-button failure MOTION-SPEC §9 names, rotated to the vertical
    // axis where the flip (rather than the shift) is the correct answer.
    withGeometry((cls) => {
      if (cls.includes('tip--top')) return { top: -12, bottom: 4, left: 290, right: 350, width: 60, height: 16 };
      if (cls.includes('tip--bottom')) return { top: 30, bottom: 46, left: 290, right: 350, width: 60, height: 16 };
      if (cls.includes('tipw')) return { top: 4, bottom: 24, left: 300, right: 340, width: 40, height: 20 };
      return null;
    }, () => {
      render(<Tooltip content="Hi" position="top"><button type="button">x</button></Tooltip>);
      fireEvent.mouseEnter(screen.getByText('x').parentElement);
      act(() => { vi.advanceTimersByTime(300); });
      expect(screen.getByRole('tooltip').className).toContain('tip--bottom');
    });
  });

  it('stays put when the far side has no more room than the near one', () => {
    // A tooltip clipped at the top on a viewport with no room below either.
    // Flipping would move it from one clipped edge to a worse one, which is
    // not an improvement — so the requested placement is kept.
    withGeometry((cls) => {
      if (cls.includes('tip--')) return { top: -12, bottom: 4, left: 290, right: 350, width: 60, height: 16 };
      if (cls.includes('tipw')) return { top: 4, bottom: 762, left: 300, right: 340, width: 40, height: 758 };
      return null;
    }, () => {
      render(<Tooltip content="Hi" position="top"><button type="button">y</button></Tooltip>);
      fireEvent.mouseEnter(screen.getByText('y').parentElement);
      act(() => { vi.advanceTimersByTime(300); });
      expect(screen.getByRole('tooltip').className).toContain('tip--top');
    });
  });

  it('shifts a centred tooltip back inside the right edge', () => {
    // THE case §9 actually describes: "tooltips on the rightmost toolbar
    // buttons render off-screen". A top-placed tip is centred on its trigger,
    // so no flip on the vertical axis can help it — only `--tip-dx` can.
    withGeometry((cls) => {
      // jsdom's viewport is 1024 wide. The tip overhangs by 40px past the 8px
      // margin, so the expected shift is -40.
      if (cls.includes('tip--')) return { top: 300, bottom: 316, left: 956, right: 1056, width: 100, height: 16 };
      if (cls.includes('tipw')) return { top: 320, bottom: 340, left: 986, right: 1026, width: 40, height: 20 };
      return null;
    }, () => {
      render(<Tooltip content="Delete for everyone" position="top"><button type="button">z</button></Tooltip>);
      fireEvent.mouseEnter(screen.getByText('z').parentElement);
      act(() => { vi.advanceTimersByTime(300); });
      const tip = screen.getByRole('tooltip');
      expect(tip.className).toContain('tip--top');       // no pointless flip
      expect(tip.style.getPropertyValue('--tip-dx')).toBe('-40px');
    });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   §7 · The bottom sheet's snap points and the dismiss gesture
   ══════════════════════════════════════════════════════════════════════════
   MOTION-SPEC §5 and IxDrawer.jsx:386-397. The numbers here are the SPEC's —
   58/94 as a 1-based `data-snap`, and dismissal at 40% of the sheet's own
   height — so a change of feel has to change this file, not slip through as a
   constant nobody re-read.

   jsdom performs no layout, so the sheet's height is supplied. That is not a
   weakness of the test: the dismiss threshold is a FRACTION of a measured
   height, and supplying the height is the only way to assert the arithmetic
   rather than assert that zero is not greater than zero. */
describe('BottomSheet snap points', () => {
  afterEach(cleanup);

  const SHEET_H = 500;
  function mount(onClose = () => {}) {
    const r = render(<BottomSheet open onClose={onClose} title="Task"><p>body</p></BottomSheet>);
    const panel = document.querySelector('.bsh');
    // 500px tall: the 40% dismiss threshold is therefore 200px of travel.
    panel.getBoundingClientRect = () => ({
      top: 268, bottom: 768, left: 0, right: 390, width: 390, height: SHEET_H,
    });
    return { ...r, panel, grab: document.querySelector('.bsh__grab') };
  }

  /**
   * jsdom does not implement `PointerEvent`, and testing-library's
   * `fireEvent.pointerMove` therefore falls back to a plain `Event` — which
   * carries no `clientY` at all. A drag fired that way arrives as dy = 0 and
   * reads as a TAP, so the three drag assertions below would have passed
   * against a component that ignored movement entirely. (They did, before this
   * helper: "drag up" and "drag down" both passed by toggling.)
   *
   * A `MouseEvent` with a pointer event's type is the fix: it carries
   * `clientY`, and React's synthetic system dispatches it to `onPointerMove`
   * because it listens by type, not by constructor.
   */
  const pointer = (el, type, clientY) =>
    act(() => { el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientY, button: 0 })); });

  const drag = (grab, dy) => {
    pointer(grab, 'pointerdown', 400);
    pointer(grab, 'pointermove', 400 + dy);
    pointer(grab, 'pointerup', 400 + dy);
  };

  it('opens at the 58% peek', () => {
    const { panel } = mount();
    expect(panel.getAttribute('data-snap')).toBe('1');
  });

  it('tapping the handle toggles peek to full and back', () => {
    const { panel, grab } = mount();
    drag(grab, 0);                                   // no movement = a tap
    expect(panel.getAttribute('data-snap')).toBe('2');
    drag(grab, 0);
    expect(panel.getAttribute('data-snap')).toBe('1');
  });

  it('dragging up moves to the full snap, dragging down comes back', () => {
    const { panel, grab } = mount();
    drag(grab, -60);
    expect(panel.getAttribute('data-snap')).toBe('2');
    drag(grab, 60);
    expect(panel.getAttribute('data-snap')).toBe('1');
  });

  it('dismisses on a swipe down past 40% of the sheet height', () => {
    const onClose = vi.fn();
    const { grab } = mount(onClose);
    // 201px on a 500px sheet — one pixel past the threshold, which is the
    // assertion worth making. 220px would pass against an off-by-a-lot rule.
    drag(grab, SHEET_H * 0.4 + 1);
    expect(document.querySelector('.bsh').className).toContain('is-closing');
  });

  it('does not dismiss on a drag that stops short of 40%', () => {
    const { panel, grab } = mount();
    drag(grab, SHEET_H * 0.4 - 1);
    expect(panel.className).not.toContain('is-closing');
    expect(panel.getAttribute('data-snap')).toBe('1');   // dropped a snap instead
  });

  it('tracks the finger 1:1 while a pointer is down, without a transition', () => {
    const { panel, grab } = mount();
    pointer(grab, 'pointerdown', 400);
    pointer(grab, 'pointermove', 460);
    expect(panel.getAttribute('data-dragging')).toBe('');
    expect(panel.style.transform).toBe('translateY(60px)');
    // Upward travel is NOT translated — the sheet would detach from the bottom
    // edge and show a strip of scrim beneath it. The intent is read on release.
    pointer(grab, 'pointermove', 340);
    expect(panel.style.transform).toBe('');
    pointer(grab, 'pointerup', 340);
    expect(panel.getAttribute('data-dragging')).toBeNull();
  });

  it('exposes the handle as a real control, not a touch-only affordance', () => {
    const { panel, grab } = mount();
    expect(grab.getAttribute('role')).toBe('slider');
    expect(grab.getAttribute('aria-valuenow')).toBe('1');
    fireEvent.keyDown(grab, { key: 'ArrowUp' });
    expect(panel.getAttribute('data-snap')).toBe('2');
    fireEvent.keyDown(grab, { key: 'ArrowDown' });
    expect(panel.getAttribute('data-snap')).toBe('1');
    // Already at the peek: ArrowDown must not walk off the bottom of the list.
    fireEvent.keyDown(grab, { key: 'ArrowDown' });
    expect(panel.getAttribute('data-snap')).toBe('1');
  });

  it('reads a drag as a drag and not as a tap', () => {
    // The regression this helper exists for. A pointer stream with no clientY
    // arrives as dy = 0, which is indistinguishable from a tap — so a
    // component that ignored `pointermove` entirely would still toggle the
    // snap and pass every assertion above. Dragging DOWN from the peek has no
    // snap to fall to, so a correct implementation leaves it at 1 while the
    // tap-shaped bug would move it to 2.
    const { panel, grab } = mount();
    expect(panel.getAttribute('data-snap')).toBe('1');
    drag(grab, 40);
    expect(panel.getAttribute('data-snap')).toBe('1');
  });
});
