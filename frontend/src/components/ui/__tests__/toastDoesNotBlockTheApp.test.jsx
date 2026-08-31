/**
 * A toast is a notice beside the work, not an overlay on top of it.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
 * `.tst` carried `pointer-events: all` and `.k-toasts` is `z-index: 520`,
 * above the drawer (200) and the modal (420). MEASURED on the deployed app on
 * 2026-08-31 by putting a real `.tst` card into the real `.k-toasts` region
 * and hit-testing every visible control at its own centre — on the tasks list
 * with NOTHING open, one toast covered four top-bar controls:
 *
 *     button[Keyboard shortcuts]         @1439,28
 *     button[Appearance]                 @1481,28
 *     button[Notifications, 40 unread]   @1523,28
 *     button[New task]                   @1600,28
 *
 * "New task" is the primary action of that page. And an ERROR toast never
 * auto-dismisses — deliberately, `DURATION.error` is null — so this was not a
 * four-second inconvenience but the top bar taken away until somebody found
 * the Dismiss button hiding under their cursor.
 *
 * Suite 03.20 is what surfaced it: thirty-eight attempts to click "Restore
 * task" on an open drawer, every one refused by `<div class="tst tst--ok">`.
 * Only the MOUSE was refused, which is why every role-and-name driven check in
 * the programme agreed the button was fine — the third overlay of this exact
 * shape in one week, after the corner dock and the column resize grip.
 *
 * With the rule injected live, the same sweep dropped 6 intercepted controls
 * to 2, and those 2 are the toast's own Undo and Dismiss, both still reachable.
 *
 * ── WHAT THIS FILE PINS, AND WHY EACH ONE CAN FAIL ─────────────────────────
 *  1. the stylesheet still makes the card click-through AND still gives the
 *     two buttons the pointer back — a fix that only did the first half would
 *     trade a blocked application for an undismissable error card;
 *  2. hover-to-pause still works, which is the §9 rule the change had to carry
 *     across. `:hover` cannot answer it any more, so the provider answers it
 *     from geometry, and geometry can silently stop matching;
 *  3. leaving the card resumes it, or a toast dismissed under a resting cursor
 *     stays paused for ever;
 *  4. the card carries `data-toast-id`, without which the listener cannot name
 *     the toast it is resuming;
 *  5. the card does NOT also pause from its own mouse handlers. Two owners is
 *     worse than none here: `pause()` recomputes `remaining` from an `endsAt`
 *     the first pause froze, so a SECOND pause a moment later hands back less
 *     time than the toast had — hovering would shorten what hover exists to
 *     hold open. ⚠ Read that test's own note: its first revision fired both
 *     events in one instant and stayed green over exactly the defect it was
 *     written to catch.
 *
 * Rendered with react-dom directly — `@testing-library/react` is installed and
 * its `@testing-library/dom` peer is not, so importing it throws.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { ToastProvider, useToast } from '../toast';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Comments stripped before matching: twice in this codebase a source-reading
 *  assertion passed by matching its own explanatory prose, and the comments
 *  around these rules quote the declarations verbatim. */
const cssWithoutComments = () => {
  const raw = readFileSync(path.join(HERE, '..', '..', '..', 'styles', 'components.css'), 'utf8');
  return raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ');
};

let container = null;
let root = null;
let api = null;

function Probe() {
  api = useToast();
  return null;
}

/** jsdom gives every element a zero rect, so the card has to be given one. */
const CARD_RECT = { left: 1356, top: 20, right: 1676, bottom: 82, width: 320, height: 62 };
const stubRects = () => {
  const real = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
    if (this.classList && this.classList.contains('tst')) return { ...CARD_RECT, x: CARD_RECT.left, y: CARD_RECT.top, toJSON() { return this; } };
    return real.call(this);
  });
};

const moveTo = async (clientX, clientY) => {
  await act(async () => {
    window.dispatchEvent(new MouseEvent('mousemove', { clientX, clientY, bubbles: true }));
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  stubRects();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<ToastProvider><Probe /></ToastProvider>);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
  api = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const cards = () => document.querySelectorAll('.k-toasts .tst');

describe('a toast does not block the application', () => {
  it('the stylesheet makes the card click-through', () => {
    const css = cssWithoutComments();
    expect(
      /\.tst\s*\{[^}]*pointer-events:\s*none/.test(css),
      'THE DEFECT: `.tst` takes the pointer again, so every toast covers '
      + 'whatever is under it — measured as four top-bar controls including '
      + '"New task", and an error toast never expires',
    ).toBe(true);
    expect(
      /pointer-events:\s*all/.test(css.match(/\.tst\s*\{[^}]*\}/)?.[0] || ''),
      '`.tst` still declares `pointer-events: all`',
    ).toBe(false);
  });

  it('and still gives the toast its own two buttons back', () => {
    const css = cssWithoutComments();
    expect(
      /\.tst__act,\s*\.tst__a\s*\{[^}]*pointer-events:\s*auto/.test(css),
      'the card is click-through and its OWN controls are too — Dismiss is '
      + 'unreachable, and an error toast never auto-dismisses, so it would '
      + 'stay on screen for the rest of the session',
    ).toBe(true);
  });

  it('pauses while the pointer rests over the card', async () => {
    await act(async () => { api.success('Task archived'); });
    expect(cards()).toHaveLength(1);

    await moveTo(1500, 50);                       // inside the card's rect
    await act(async () => { vi.advanceTimersByTime(9_000); });

    expect(
      cards(),
      'hover no longer pauses the timer. §9 says it must on all types, and '
      + '`:hover` cannot answer it now the card is click-through — the '
      + 'provider has to, from geometry',
    ).toHaveLength(1);
  });

  it('resumes the moment the pointer leaves it', async () => {
    await act(async () => { api.success('Task archived'); });
    await moveTo(1500, 50);
    await act(async () => { vi.advanceTimersByTime(3_000); });
    expect(cards()).toHaveLength(1);

    await moveTo(200, 400);                        // well clear of the card
    await act(async () => { vi.advanceTimersByTime(9_000); });
    expect(
      cards(),
      'the toast stayed paused after the pointer left, so one dismissed under '
      + 'a resting cursor would never expire',
    ).toHaveLength(0);
  });

  it('names each card, so the listener can resume the one it paused', async () => {
    await act(async () => { api.success('Task archived'); });
    expect(
      cards()[0].getAttribute('data-toast-id'),
      'the card carries no `data-toast-id`, so the pointer listener cannot '
      + 'resume the toast it paused when the cursor moves off it',
    ).toBeTruthy();
  });

  it('does not ALSO pause from a mouseover on the card', async () => {
    /**
     * ⚠ THE POINTER HAS TO MOVE *WITHIN* THE CARD, AND TIME HAS TO PASS.
     *
     * The first version of this test fired one `mouseover` and one `mousemove`
     * in the same act and asserted the toast survived. It passed with the
     * defect installed, because two pauses at the SAME instant both compute
     * `endsAt - now` from an untouched `endsAt` and agree. That is a check
     * satisfied by its own shape — the dominant finding of this whole
     * programme, reproduced in the test written to catch it.
     *
     * The damage needs a SECOND pause LATER: React's `onMouseOver` fires again
     * on every child the cursor crosses, while the window listener returns
     * early once it is already over the same card. So a cursor that drifts
     * from the title to the message re-pauses, and each re-pause measures the
     * remaining life against a deadline the first pause already froze.
     */
    await act(async () => { api.success('Task archived'); });
    const card = cards()[0];

    await moveTo(1500, 50);                       // in: paused with 4000 left
    await act(async () => { vi.advanceTimersByTime(2_500); });

    // Drifting across the card. Harmless with one owner; with two, this is
    // where the toast quietly loses 2.5s of the life it was told to hold.
    await act(async () => {
      card.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 1600, clientY: 60 }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 1600, clientY: 60, bubbles: true }));
    });

    await moveTo(200, 400);                       // out: resumes what is left
    await act(async () => { vi.advanceTimersByTime(3_000); });

    expect(
      cards(),
      'the toast expired early. It was paused twice with time in between, and '
      + 'the second pause measured the remaining life against an endsAt the '
      + 'first had already frozen — so hovering SHORTENED the toast that hover '
      + 'is supposed to hold open',
    ).toHaveLength(1);
  });
});
