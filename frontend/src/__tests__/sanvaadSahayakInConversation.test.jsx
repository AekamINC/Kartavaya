/**
 * Three things that shipped GREEN and were wrong, and the assertions that would
 * have stopped each one.
 *
 * All three were found by audit, not by this suite, and the suite was 1173/1173
 * at the time. That is the point of this file: each block below is the check
 * whose ABSENCE let a defect through, written so it fails against the code as it
 * stood rather than merely describing the fix.
 *
 *  1. A DEEP LINK TO A THREAD REPLY COULD NEVER RESOLVE. `Message` rendered
 *     replies with `anchored={false}`, so a reply had no `id` at all;
 *     `ChatPane` polled `getElementById('m-<replyId>')` for six seconds and then
 *     told the reader "That reply is no longer in the thread. It may have been
 *     deleted." — while the reply sat expanded and visible on screen. The stated
 *     justification, that the same message could be on screen twice, cannot
 *     happen: `list_messages` filters `parent_message_id IS NULL`, so a reply is
 *     never a log row, and `ChatPane` holds one `openThreadId`.
 *
 *  2. THE COMPOSER'S BOX WAS NOT RENDERED AND THE TEXTAREA LOST ITS BORDER TO A
 *     CASCADE COLLISION. `.m2cp textarea` (0,1,1) is written for the prototype's
 *     `.m2cp__box`; `.cmp__ta` (0,1,0) is the legacy field. With `.m2cp`
 *     wrapping the legacy bar the V2 rule won and stripped `border` and
 *     `background` off a box that nothing else was drawing. This asserts the
 *     STRUCTURE — the textarea and the foot are siblings inside one `.m2cp__box`
 *     — because that is what makes the CSS true, and a stylesheet assertion
 *     alone would pass against a box nobody renders.
 *
 *  3. SAHAYAK-IN-CONVERSATION HAD CSS AND ZERO DOM. All three entry points from
 *     `28-messaging-v2.md` §7 — the card at the unread divider, the side panel,
 *     the composer button — had rules in `sahayak.css` and `sanvaad.css` and not
 *     one JSX consumer. `check-classes` cannot see this: it fails on a class a
 *     page RENDERS without a rule, never on a rule no page renders.
 */
import React from 'react';
import { act } from 'react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const get = vi.fn();
const post = vi.fn();

vi.mock('../lib/api', () => ({
  api: {
    get: (...a) => get(...a),
    post: (...a) => post(...a),
    patch: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));

const { default: ChatPane } = await import('../pages/sanvaad/ChatPane');
const { default: Message } = await import('../pages/sanvaad/Message');
const { default: SahayakAside } = await import('../pages/sanvaad/SahayakAside');
const { default: SahayakCard } = await import('../components/sanvaad/SahayakCard');
const { ToastProvider } = await import('../components/ui');

let container = null;
let root = null;

const CHANNEL = {
  id: 'c1', name: 'gst-filing', type: 'public', member_count: 4, is_archived: false,
};

const EDITOR = { canPost: true, canManage: false, level: 'editor', loading: false };

const mount = async (ui) => {
  await act(async () => {
    root.render(<MemoryRouter><ToastProvider>{ui}</ToastProvider></MemoryRouter>);
  });
  await act(async () => { await Promise.resolve(); });
};

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  get.mockReset();
  post.mockReset();
  get.mockResolvedValue({ data: [] });
  post.mockResolvedValue({ data: {} });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
  vi.useRealTimers();
});

/* ══════════════════════════════════════════════════════════════════════════
   1 · A thread reply is reachable by the link that quotes it
   ══════════════════════════════════════════════════════════════════════════ */

describe('Message · an expanded thread reply is an anchor', () => {
  const ROOT = {
    id: 'm1', channel_id: 'c1', sender_id: 'u2', sender_name: 'Anil Verma',
    content: 'HSN 7208 is right for hot-rolled coil.', type: 'text',
    created_at: '2026-08-04T10:00:00Z', reactions: [], thread_count: 1,
  };
  const REPLY = {
    id: 'r99', channel_id: 'c1', parent_message_id: 'm1', sender_id: 'u3',
    sender_name: 'Rohan Mehta', content: 'Patched both invoices.', type: 'text',
    created_at: '2026-08-04T10:04:00Z', reactions: [],
  };

  it('gives the reply a `m-<id>` element, which is what the deep link looks up', async () => {
    get.mockImplementation(url => (String(url).includes('/thread')
      ? Promise.resolve({ data: [REPLY] })
      : Promise.resolve({ data: [] })));

    await mount(<Message msg={ROOT} threadOpen meId="u1" onToggleThread={() => {}} />);

    // The reply is on screen…
    expect(container.textContent).toContain('Patched both invoices.');
    // …and this is the assertion whose absence let the defect ship. Before the
    // fix it was null, and `ChatPane`'s focus loop polled it 50 times and then
    // blamed a deletion.
    expect(document.getElementById('m-r99')).toBeTruthy();
    // The root keeps its own anchor. Both exist; neither collides, because a
    // reply is never also a log row.
    expect(document.getElementById('m-m1')).toBeTruthy();
    expect(document.querySelectorAll('#m-r99').length).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2 · The composer is the prototype's box
   ══════════════════════════════════════════════════════════════════════════ */

describe('Composer · one bordered block, two rows', () => {
  it('puts the textarea and the foot inside a single `.m2cp__box`', async () => {
    await mount(<ChatPane channel={CHANNEL} meId="u1" access={EDITOR} />);

    const box = container.querySelector('.m2cp__box');
    expect(box).toBeTruthy();

    const ta = container.querySelector('textarea.cmp__ta');
    const foot = container.querySelector('.m2cp__foot');
    expect(box.contains(ta)).toBe(true);
    expect(box.contains(foot)).toBe(true);
    // SIBLINGS, which is the whole shape: `messaging.css:210-219` draws the
    // border and the focus ring on the block and nothing on the field, so a
    // foot nested inside the field's wrapper would put the ring in the wrong
    // place and a foot outside the box would leave it unbordered.
    expect(ta.parentElement).toBe(foot.parentElement);
    // The send button is in the foot row, not floating beside the field.
    expect(foot.querySelector('.cmp__send')).toBeTruthy();
  });

  it('no longer renders the legacy `.cmp` bar the V2 rule was overriding', async () => {
    await mount(<ChatPane channel={CHANNEL} meId="u1" access={EDITOR} />);
    // `.cmp` carried `border-top` + `background: var(--surface)` and was the
    // element the box replaces. While both existed, `.m2cp textarea` stripped
    // the field's own border and `.cmp` drew a full-width bar behind it.
    expect(container.querySelector('.m2cp .cmp')).toBeNull();
  });

  it('keeps the keyboard hint, because Enter and Shift+Enter now differ', async () => {
    await mount(<ChatPane channel={CHANNEL} meId="u1" access={EDITOR} />);
    const hint = container.querySelector('.m2cp__hint');
    expect(hint).toBeTruthy();
    expect(hint.querySelectorAll('kbd').length).toBe(2);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3 · Sahayak's three entry points exist in the DOM
   ══════════════════════════════════════════════════════════════════════════ */

const ANSWER = {
  ask: 'catch_up',
  message_count: 3,
  credits: 2,
  dropped: 1,
  unanswered: 'Nobody has stated the ITC mismatch total in this channel.',
  empty: null,
  points: [
    {
      text: 'HSN 7208 is correct for hot-rolled coil, and both invoices were patched.',
      cites: [{ message_id: 'm1', parent_message_id: null, author: 'Anil Verma', at: '4:41 pm' }],
    },
    {
      text: 'Filing is set for the 20th, conditional on your sign-off.',
      cites: [{ message_id: 'r99', parent_message_id: 'm1', author: 'Rohan Mehta', at: '4:58 pm' }],
    },
  ],
};

const idleSahayak = overrides => ({
  asked: null, answer: null, error: '', busy: false,
  ask: vi.fn(), clear: vi.fn(), ...overrides,
});

describe('Sahayak · entry point three, the composer button', () => {
  it('renders `.m2cp__ai` in the composer foot when the shell can open a panel', async () => {
    await mount(
      <ChatPane
        channel={CHANNEL}
        meId="u1"
        access={EDITOR}
        sahayak={idleSahayak()}
        onToggleSahayak={() => {}}
      />
    );
    const ai = container.querySelector('.m2cp__foot .m2cp__ai');
    expect(ai).toBeTruthy();
    expect(ai.textContent).toContain('Draft with Sahayak');
  });

  it('renders no button at all when there is no panel to open — Varta', async () => {
    await mount(<ChatPane channel={CHANNEL} meId="u1" access={EDITOR} />);
    expect(container.querySelector('.m2cp__ai')).toBeNull();
  });
});

describe('Sahayak · entry point one, the card at the unread divider', () => {
  const OLD = {
    id: 'm0', channel_id: 'c1', sender_id: 'u2', sender_name: 'Anil Verma',
    content: 'Before you left.', type: 'text',
    created_at: '2026-08-04T09:00:00Z', reactions: [],
  };
  const NEW = {
    id: 'm1', channel_id: 'c1', sender_id: 'u2', sender_name: 'Anil Verma',
    content: 'After you left.', type: 'text',
    created_at: '2026-08-04T11:00:00Z', reactions: [],
  };
  const READ_CHANNEL = { ...CHANNEL, my_last_read: '2026-08-04T10:00:00Z' };

  const withLog = () => get.mockImplementation(url => (String(url).includes('/messages')
    ? Promise.resolve({ data: [NEW, OLD] })
    : Promise.resolve({ data: [] })));

  it('renders the card immediately after the divider, and nowhere else', async () => {
    withLog();
    await mount(
      <ChatPane
        channel={READ_CHANNEL}
        meId="u1"
        access={EDITOR}
        sahayak={idleSahayak({ asked: 'catch_up', answer: ANSWER })}
        onToggleSahayak={() => {}}
      />
    );

    const divider = container.querySelector('.m2div--new');
    const card = container.querySelector('.sh-card--inline');
    expect(divider).toBeTruthy();
    expect(card).toBeTruthy();
    // "at the unread divider — the point the reader left off is the only place
    // a summary of what they missed belongs" (28 §7).
    expect(divider.nextElementSibling).toBe(card);
    // Two cited points, drawn by the counter-driven `<ol>`.
    expect(card.querySelector('ol.sh-pts')).toBeTruthy();
    expect(card.querySelectorAll('.sh-pts li').length).toBe(2);
    // The claims the server deleted are STATED, not swallowed.
    expect(card.querySelector('.sh-card__foot').textContent).toContain('1 point was dropped');
  });

  it('offers "Catch me up" only where there is a divider to hang it on', async () => {
    withLog();
    await mount(
      <ChatPane channel={READ_CHANNEL} meId="u1" access={EDITOR}
        sahayak={idleSahayak()} onToggleSahayak={() => {}} />
    );
    expect(container.textContent).toContain('Catch me up');

    // Same channel, never left: no `my_last_read`, no divider, no card to ask
    // for. A summary of what you missed where you missed nothing has to invent
    // a subject.
    //
    // `key` because `lastReadAt` is captured ONCE per mount — deliberately, so
    // the divider marks where the reader arrived rather than following them
    // down the log — and `ChannelsTab` keys this component by channel id for
    // exactly that reason. Re-rendering the same instance with a different
    // channel prop is a state the product cannot reach.
    await mount(
      <ChatPane key="fresh" channel={CHANNEL} meId="u1" access={EDITOR}
        sahayak={idleSahayak()} onToggleSahayak={() => {}} />
    );
    expect(container.textContent).not.toContain('Catch me up');
  });

  it('renders no card when every claim failed the server citation check', async () => {
    withLog();
    await mount(
      <ChatPane
        channel={READ_CHANNEL}
        meId="u1"
        access={EDITOR}
        sahayak={idleSahayak({
          asked: 'catch_up',
          answer: { ...ANSWER, points: [], dropped: 4 },
        })}
        onToggleSahayak={() => {}}
      />
    );
    expect(container.querySelector('.m2div--new')).toBeTruthy();
    expect(container.querySelector('.sh-card')).toBeNull();
  });
});

describe('Sahayak · entry point two, the side panel', () => {
  it('states its scope and offers the closed ask list before anything is asked', async () => {
    await mount(
      <SahayakAside channelName="gst-filing" sahayak={idleSahayak()} onClose={() => {}} />
    );
    const aside = container.querySelector('.sh-aside');
    expect(aside).toBeTruthy();
    // "Scope is stated at the top" — 28 §7.
    const scope = aside.querySelector('.sh-aside__scope');
    expect(scope.textContent).toContain('#gst-filing');
    // Three asks, and each is a real button.
    expect(aside.querySelectorAll('button.sh-ask__q').length).toBe(3);
    // The Devanagari half carries `lang`, or a screen reader says it in English
    // phonemes (24-bilingual-devanagari.md).
    expect(aside.querySelector('.sh-aside__t span').getAttribute('lang')).toBe('hi');
  });

  it('shows the answer and the server\'s own refusal, and never invents one', async () => {
    await mount(
      <SahayakAside
        channelName="gst-filing"
        sahayak={idleSahayak({ asked: 'decided', answer: ANSWER })}
        onClose={() => {}}
      />
    );
    expect(container.querySelectorAll('.sh-pts li').length).toBe(2);
    expect(container.querySelector('.sh-none').textContent)
      .toContain('ITC mismatch total');

    // The same panel with no `unanswered` on the answer prints no such block.
    await mount(
      <SahayakAside
        channelName="gst-filing"
        sahayak={idleSahayak({ asked: 'decided', answer: { ...ANSWER, unanswered: null } })}
        onClose={() => {}}
      />
    );
    expect(container.querySelector('.sh-none')).toBeNull();
  });

  it('distinguishes "nothing since you read" from "nothing here at all"', async () => {
    const empty = extra => idleSahayak({
      asked: 'catch_up',
      answer: { ask: 'catch_up', message_count: 0, credits: 0, dropped: 0, points: [], ...extra },
    });

    await mount(<SahayakAside channelName="gst-filing" sahayak={empty({ empty: 'since' })} onClose={() => {}} />);
    expect(container.textContent).toContain('since you last read it');

    await mount(<SahayakAside channelName="gst-filing" sahayak={empty({ empty: 'channel' })} onClose={() => {}} />);
    expect(container.textContent).toContain('nothing in #gst-filing to read yet');
  });
});

describe('Sahayak · a cite is a control', () => {
  it('is focusable, is announced as a button, and opens the record it names', async () => {
    const onCite = vi.fn();
    await mount(<SahayakCard title="Caught up" points={ANSWER.points} onCite={onCite} />);

    const cites = container.querySelectorAll('.sh-pts__src cite');
    expect(cites.length).toBe(2);
    expect(cites[0].getAttribute('role')).toBe('button');
    expect(cites[0].getAttribute('tabindex')).toBe('0');

    await act(async () => { cites[1].click(); });
    expect(onCite).toHaveBeenCalledTimes(1);
    // The cited reply carries its thread root, which is what lets the jump
    // EXPAND the thread rather than land at the bottom of the channel.
    expect(onCite.mock.calls[0][0]).toMatchObject({ message_id: 'r99', parent_message_id: 'm1' });

    // Keyboard too: `<cite>` is not focusable and gets neither Enter nor Space
    // for free, so both are stated.
    await act(async () => {
      cites[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onCite).toHaveBeenCalledTimes(2);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4 · The two ink defects no automated check can see

   `check-contrast` has three passes and NONE of them reaches either of these.
   Pass 2 measures the token matrix and never pairs a foreground ramp token with
   a container. Pass 3 measures pairs stated in ONE rule — and both defects are
   a rule that sets a background and a DIFFERENT rule, elsewhere, that sets the
   ink over it. So the checks below read the stylesheet directly, because the
   alternative is that the next person to touch these rules finds out from a
   reader.

   Both are the same bug in two files: when a row or a bubble goes tonal, EVERY
   line in it must be recoloured. `sanvaad.css`'s `.m2row.on` was left without
   it — 2.83:1 in dark on three metadata lines, 5.23:1 in light, which is why it
   goes unnoticed.

   `.sh__row.on` in `sahayak.css` is the counter-example that gets it right, and
   it went the long way round to being one. It was briefly restyled onto a RING
   — border plus a 3px 15% shadow, no fill — on the reasoning that a row which
   keeps its own ground has nothing to re-ink. True, and it removed the state
   instead: measured over the twelve accents in both themes, `--primary` vs
   `--outline-variant` (the border a reader actually compares against) is under
   3:1 at 9 of 24, and the ring is 1.07–1.33:1 over `--s-lowest` at all 24, so
   it is not visible anywhere. It is back on the prototype's own idiom,
   `.m2row.on` (messaging.css:74), with the re-ink the fill requires.

   The INVARIANT is what this block guards, not which rule demonstrates it. The
   sahayak assertion below ties the fill and the re-ink together in BOTH
   directions, and it derives the lines it checks from the stylesheet: any child
   of `.sh__row` painted with `--on-surface-3` must be overridden exactly when
   the row is filled. A fill added back without the override fails here; so does
   an override left behind after the fill is removed.
   ══════════════════════════════════════════════════════════════════════════ */

const ROOT = process.cwd();
const noComments = css => css.replace(/\/\*[\s\S]*?\*\//g, ' ');
const SANVAAD = noComments(readFileSync(resolve(ROOT, 'src/styles/sanvaad.css'), 'utf8'));
const SAHAYAK = noComments(readFileSync(resolve(ROOT, 'src/styles/sahayak.css'), 'utf8'));

/** The declarations of the first rule whose selector list contains `sel`. */
const ruleFor = (css, sel) => {
  const i = css.indexOf(sel);
  if (i === -1) return null;
  const open = css.indexOf('{', i);
  const close = css.indexOf('}', open);
  return open === -1 || close === -1 ? null : css.slice(open + 1, close);
};

describe('tonal rows recolour every line in them', () => {
  it('re-inks the three metadata lines of a selected `.m2row`', () => {
    // `--on-surface-3` is a ramp tuned against `--surface`. Over
    // `--primary-container` in dark it is #8e8d87 on #0a4f49 — 2.83:1.
    const rule = ruleFor(SANVAAD, '.m2row.on .m2row__last');
    expect(rule).not.toBeNull();
    expect(rule).toContain('var(--on-primary-container)');
    for (const child of ['.m2row__last', '.m2row__when', '.m2row__kind']) {
      expect(SANVAAD).toContain(`.m2row.on ${child}`);
    }
  });

  /**
   * The lines inside a `.sh__row` that are painted with `--on-surface-3`,
   * DERIVED from the stylesheet rather than listed here.
   *
   * The previous version of this guard hardcoded three children and demanded
   * all three be re-inked whenever the row went tonal. That list was wrong in
   * one direction: `.sh-si__t` carries no colour of its own — it inherits
   * `--on-surface` from `.sh-si` — and `--on-surface` on `--primary-container`
   * measures 7.65:1 (dark teal, the worst of the 24 accent x theme pairs) up to
   * 14.83:1. Requiring an override for it would have forced a rule that repaints
   * a line which already clears AA by a factor of two, and the next person would
   * have deleted the guard rather than the rule.
   *
   * `--on-surface-3` is the token that actually fails: on `--primary-container`
   * it is 2.84:1 at dark teal and 2.90:1 at dark emerald, and under 4.5:1 at
   * fifteen of the twenty-four. So the invariant is stated against the TOKEN,
   * and the set of lines it covers is read out of the file. A fourth line added
   * to a row with `--on-surface-3` on it is picked up automatically.
   */
  const onSurface3Lines = () => {
    const out = [];
    for (const block of SAHAYAK.split('}')) {
      const cut = block.indexOf('{');
      if (cut === -1) continue;
      const sel = block.slice(0, cut).trim();
      const decls = block.slice(cut + 1);
      // Only the row's own children, and only where the DECLARED ink is the
      // failing token — a `:hover` that swaps in `--danger` is not this bug.
      if (!/^\.sh-si(__\w+)?$/.test(sel)) continue;
      if (/(^|[;\s])color\s*:\s*var\(--on-surface-3\)/.test(decls)) out.push(sel);
    }
    return out;
  };

  it('ties the fill and the re-ink together on `.sh__row.on`, in both directions', () => {
    const rule = ruleFor(SAHAYAK, '.sh__row.on');
    expect(rule).not.toBeNull();

    // The guard is only worth anything if it is watching something. If a
    // refactor renames these lines off `--on-surface-3` this fails loudly
    // rather than passing vacuously over an empty list.
    const lines = onSurface3Lines();
    expect(lines.length, 'lines painted with --on-surface-3 inside a row').toBeGreaterThan(0);

    const tonal = /background(-color)?\s*:/.test(rule);
    // Either it fills and re-inks every failing line, or it does neither. The
    // failure this whole block exists for is exactly the combination in
    // between, and it is the combination that looks fine in light.
    for (const child of lines) {
      expect(
        SAHAYAK.includes(`.sh__row.on ${child}`),
        `${child} is on --on-surface-3, so a tonal row must override it`
      ).toBe(tonal);
    }

    if (tonal) {
      // Restored 2026-08-06 to `.m2row.on` (messaging.css:74), the prototype's
      // only selected-conversation idiom. What it replaced — border alone plus
      // a 3px 15% ring — was measured and carried the state at neither part:
      // `--primary` vs `--outline-variant` is under 3:1 at 9 of 24, and the
      // ring is 1.07–1.33:1 over `--s-lowest` at all 24.
      expect(rule).toContain('background: var(--primary-container)');
      expect(rule).toContain('border-color: var(--primary)');
      // Not `--on-surface-3` again under a longer selector, and not the accent
      // at full strength either. `--on-surface-2` is the next step up the same
      // neutral ramp and clears AA on the container at all 24 (4.62–9.75).
      const ink = ruleFor(SAHAYAK, `.sh__row.on ${lines[0]}`);
      expect(ink).toContain('var(--on-surface-2)');
      expect(ink).not.toContain('var(--on-surface-3)');
    }
  });
});

describe('a fixed fill states its own ink and never inherits one', () => {
  it('paints `.sh__you--failed` with `--on-danger`, not the accent-derived `--on-primary`', () => {
    // `applyPrefs` rewrites `--on-primary` per accent, so the ink inherited from
    // `.sh__you` moved with the accent while the `--danger` fill did not:
    // 2.48:1 in dark at crimson and forest, 3.19:1 in light at saffron.
    const rule = ruleFor(SAHAYAK, '.sh__you--failed');
    expect(rule).toContain('var(--danger)');
    expect(rule).toContain('color: var(--on-danger)');
    expect(rule).not.toContain('var(--on-primary)');
  });
});

describe('the composer box owns the focus ring, and only one of them', () => {
  it('cancels the legacy field ring inside `.m2cp`', () => {
    // `.cmp__ta:focus` is (0,2,0) and beats `.m2cp textarea` (0,1,1), so without
    // this the field draws its own `0 0 0 3px` ring 1px inside the box's.
    const rule = ruleFor(SANVAAD, '.m2cp .cmp__ta:focus');
    expect(rule).not.toBeNull();
    expect(rule).toContain('box-shadow: none');
    // And the box's ring — the prototype's, `messaging.css:211` — is still there.
    expect(ruleFor(SANVAAD, '.m2cp__box:focus-within')).toContain('box-shadow: 0 0 0 3px');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5 · The third grid track, end to end

   `.m2--aside` is the 336px column the panel lives in and the class that makes
   it exist is on `.m2` — `ChannelsTab`'s element, not `ChatPane`'s. Every other
   block in this file mounts a component in isolation, which cannot show that
   the toggle in one component widens a grid in another. This mounts the shell.

   It is also the only check that the panel is reachable AT ALL: a component
   with no render site is exactly the defect this whole file is about, and three
   green unit tests on `SahayakAside` would not have caught it.
   ══════════════════════════════════════════════════════════════════════════ */

vi.mock('../lib/auth', () => ({
  currentUser: () => ({ user_id: 'u1', full_name: 'Keval Shah' }),
}));

const { default: ChannelsTab } = await import('../pages/sanvaad/ChannelsTab');

describe('ChannelsTab · the Sahayak panel is reachable and widens the grid', () => {
  const shellApi = () => get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes('/messaging/me')) {
      return Promise.resolve({ data: { level: 'editor', can_post: true, can_manage: false } });
    }
    // The channel LIST — not `/channels/<id>/…`, which is members, messages
    // and pins and must stay empty or the member list picks up channel rows.
    if (/\/messaging\/channels(\?|$)/.test(u)) return Promise.resolve({ data: [CHANNEL] });
    return Promise.resolve({ data: [] });
  });

  it('opens on the header toggle and closes again, with the grid following', async () => {
    shellApi();
    await mount(<ChannelsTab />);

    // Nothing open: two tracks, no panel.
    expect(container.querySelector('.m2').className).not.toContain('m2--aside');
    expect(container.querySelector('.sh-aside')).toBeNull();

    await act(async () => { container.querySelector('.m2row')?.click(); });
    await act(async () => { await Promise.resolve(); });

    const toggle = [...container.querySelectorAll('button')]
      .find(b => b.getAttribute('aria-label') === 'Sahayak panel');
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    await act(async () => { toggle.click(); });
    await act(async () => { await Promise.resolve(); });

    expect(container.querySelector('.m2').className).toContain('m2--aside');
    expect(container.querySelector('.sh-aside')).toBeTruthy();
    expect(container.querySelectorAll('.sh-ask__q').length).toBe(3);
    expect(container.querySelector('.svbtn.on')).toBeTruthy();

    await act(async () => {
      [...container.querySelectorAll('button')]
        .find(b => b.getAttribute('aria-label') === 'Sahayak panel').click();
    });
    await act(async () => { await Promise.resolve(); });

    // The class must go WITH the panel. A grid still carrying a 336px track
    // with nothing in it is a stripe of empty background beside the log.
    expect(container.querySelector('.m2').className).not.toContain('m2--aside');
    expect(container.querySelector('.sh-aside')).toBeNull();
  });
});
