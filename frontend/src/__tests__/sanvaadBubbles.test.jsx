/**
 * sanvaadBubbles.test.jsx — the side convention, the run grouping, the channel
 * tone and the emoji picker.
 *
 * WHY EACH OF THESE IS ASSERTED AT THE DOM AND NOT AT THE PROP.
 *
 * `sanvaadWiring.test.jsx` opens with the reason and it is this module's own
 * history: three features were built at both ends of a prop chain, shipped, and
 * dead, while every check and every test stayed green — because nothing looked
 * for the CONTROL. The four things below have the same shape. "Own messages on
 * the right" is one class on one element; a test that asserts `Message` was
 * called with `mine` would pass forever after somebody stopped rendering the
 * class. So every case here mounts the real parent with the props a real caller
 * hands it and reads the rendered output.
 *
 * THE RUN CASES ARE THE ONES THAT MATTER MOST, because they are the ones a small
 * fixture cannot catch by accident. `runEnd` is a fact about the message AFTER,
 * computed in a second pass in `MessageLog`, and getting it wrong produces one
 * missing tail somewhere in the middle of a real channel — invisible in review
 * and invisible in a two-message test.
 *
 * Rendered with react-dom directly rather than @testing-library/react — the same
 * constraint `sanvaadWiring.test.jsx`, `sanvaadChatPane.test.jsx` and
 * `pageHeader.test.jsx` all record, and the same workaround: the
 * `@testing-library/dom` peer is not installed, so importing that library
 * throws.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(() => Promise.resolve({ data: [] })),
    post: vi.fn(() => Promise.resolve({ data: {} })),
    patch: vi.fn(() => Promise.resolve({ data: {} })),
    put: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));

const { default: MessageLog } = await import('../pages/sanvaad/MessageLog');
const { default: Message } = await import('../pages/sanvaad/Message');
const { ToastProvider } = await import('../components/ui');
const { CHANNEL_TONES, channelTone, toneStyle, toneVar } = await import('../pages/sanvaad/channelTone');

let container = null;
let root = null;

/** 09:00 IST on a fixed day, so nothing here depends on when it is run. */
const at = mins => new Date(Date.UTC(2026, 7, 2, 3, 30 + mins, 0)).toISOString();

const msg = (over = {}) => ({
  id: 'm1',
  channel_id: 'c1',
  sender_id: 'u2',
  sender_name: 'Rohan Iyer',
  content: 'Draft is ready for review.',
  created_at: at(0),
  reactions: [],
  ...over,
});

const mount = async (ui) => {
  await act(async () => {
    root.render(<MemoryRouter><ToastProvider>{ui}</ToastProvider></MemoryRouter>);
  });
  await act(async () => { await Promise.resolve(); });
};

const click = async (el) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
};

/**
 * Write into a React-controlled input so that React hears about it.
 *
 * `el.value = x` does not work: React installs its own `value` setter on the
 * NODE and records the new value in its tracker before passing it on, so the
 * dispatched event is compared against a shadow value that already matches and
 * `onChange` never fires. Going through the PROTOTYPE's setter writes past the
 * instance property and leaves the tracker stale. `Composer.writeDraft` carries
 * the same workaround for the same reason.
 */
const typeInto = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const cls = sel => [...container.querySelectorAll(sel)];

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  try { window.localStorage.clear(); } catch { /* storage disabled */ }
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
});

/* ── 1 · The side ─────────────────────────────────────────────────────────── */

describe('Message · own messages right, everybody else left', () => {
  /**
   * The owner said this twice and corrected themselves in between — "if i
   * message it goes on left and someone chat it stays on right", then "Yes mine
   * right and other on left please". The second one is the settled answer and it
   * is the one direction of the two that a test can pin: `.msg--mine` is the
   * whole convention, because the stylesheet turns it into
   * `flex-direction: row-reverse` and nothing else decides the side.
   */
  it('marks my own message and leaves everybody else unmarked', async () => {
    await mount(
      <MessageLog
        messages={[
          msg({ id: 'a', sender_id: 'u2', sender_name: 'Rohan Iyer' }),
          msg({ id: 'b', sender_id: 'u1', sender_name: 'Keval Shah', created_at: at(30) }),
        ]}
        loading={false}
        meId="u1"
        members={[]}
      />
    );

    const rows = cls('.msg');
    expect(rows).toHaveLength(2);
    expect(rows[0].className).not.toContain('msg--mine');
    expect(rows[1].className).toContain('msg--mine');
  });

  /**
   * `meId` is compared as a STRING on both sides because the id arrives as a
   * uuid string from `currentUser()` and as whatever `list_messages` serialised
   * on the row. A `===` between a number and a numeric string would put every
   * one of this reader's own messages on the wrong side of the log, which is the
   * single most visible thing this change can get wrong.
   */
  it('matches the sender across a number/string id mismatch', async () => {
    await mount(
      <MessageLog messages={[msg({ sender_id: 7 })]} loading={false} meId="7" members={[]} />
    );
    expect(cls('.msg')[0].className).toContain('msg--mine');
  });

  /**
   * Proposal 09: "Name — first bubble of a run only, NEVER on own messages. You
   * know who you are." The avatar stays either way, so the run keeps its indent.
   */
  it('never prints my own name over my own bubble', async () => {
    await mount(
      <MessageLog messages={[msg({ sender_id: 'u1', sender_name: 'Keval Shah' })]}
        loading={false} meId="u1" members={[]} />
    );
    expect(cls('.msg__who')).toHaveLength(0);
    expect(cls('.msg__av')).toHaveLength(1);
    // `.msg--named` is what drops the avatar past the name line, so it must not
    // be on a row that has no name to drop past.
    expect(cls('.msg')[0].className).not.toContain('msg--named');
  });
});

/* ── 2 · The run ──────────────────────────────────────────────────────────── */

describe('MessageLog · three messages from one person are one block', () => {
  const RUN = [
    msg({ id: 'a', created_at: at(0) }),
    msg({ id: 'b', created_at: at(1), content: 'Second.' }),
    msg({ id: 'c', created_at: at(2), content: 'Third.' }),
  ];

  it('renders one avatar, one name and one timestamp for the whole run', async () => {
    await mount(<MessageLog messages={RUN} loading={false} meId="u1" members={[]} />);

    expect(cls('.msg')).toHaveLength(3);
    // The defect 06 §1 names: "a burst of five messages from one person costs
    // five avatars and five names".
    expect(cls('.msg__av')).toHaveLength(1);
    expect(cls('.msg__who')).toHaveLength(1);
    // And 09's anatomy table: the timestamp belongs to the LAST bubble of a run,
    // not to every one of them. The two rows that lost theirs keep the gutter,
    // which is where the per-message time still lives on hover.
    expect(cls('.msg__when')).toHaveLength(1);
    expect(cls('.msg__gut')).toHaveLength(2);
  });

  it('suppresses the tail on every bubble but the last', async () => {
    await mount(<MessageLog messages={RUN} loading={false} meId="u1" members={[]} />);
    const rows = cls('.msg');

    // `.msg--mid` is what removes the tail — "suppressed mid-run so a burst
    // reads as one utterance". The last row must NOT carry it, or the run has no
    // tail at all and stops pointing at its author.
    expect(rows.map(r => r.className.includes('msg--mid'))).toEqual([true, true, false]);
    // The timestamp and the tail are one decision, so they cannot disagree.
    expect(rows[2].querySelector('.msg__when')).toBeTruthy();
    expect(rows[0].querySelector('.msg__when')).toBeNull();
  });

  it('breaks the run at a date separator', async () => {
    await mount(
      <MessageLog
        messages={[
          msg({ id: 'a', created_at: new Date(Date.UTC(2026, 7, 1, 3, 30)).toISOString() }),
          msg({ id: 'b', created_at: at(0) }),
        ]}
        loading={false}
        meId="u1"
        members={[]}
      />
    );
    expect(cls('.sv__sep')).toHaveLength(2);
    // Nothing is grouped across a day, in EITHER direction: the row above the
    // separator ends its run and the row below starts a new one.
    expect(cls('.msg').map(r => r.className.includes('msg--mid'))).toEqual([false, false]);
    expect(cls('.msg__when')).toHaveLength(2);
  });

  /**
   * THE CASE THE FIRST IMPLEMENTATION GOT WRONG.
   *
   * `continuation` is a fact about the message before and `runEnd` is a fact
   * about the message after, so the two are computed from opposite ends — and
   * the unread divider is decided by a flag that is set as the list is walked.
   * Ask "will the next row draw a divider?" from the wrong point in that walk
   * and the answer is off by one row: the message above the rule keeps its tail
   * and its timestamp goes to a bubble on the other side of it, which reads as
   * one message spanning a boundary that exists precisely to say it does not.
   */
  it('breaks the run at the unread divider', async () => {
    await mount(
      <MessageLog
        messages={RUN}
        loading={false}
        meId="u1"
        members={[]}
        lastReadAt={at(0.5)}
      />
    );

    expect(cls('.sv__newline')).toHaveLength(1);
    const rows = cls('.msg');
    // Row 0 is above the rule and therefore ends its run; row 1 starts a new one
    // and is not a continuation; row 2 continues row 1 and ends it.
    expect(rows.map(r => r.className.includes('msg--mid'))).toEqual([false, true, false]);
    expect(rows.map(r => r.className.includes('msg--cont'))).toEqual([false, false, true]);
    // Two runs, so two names, two avatars and two printed times.
    expect(cls('.msg__who')).toHaveLength(2);
    expect(cls('.msg__av')).toHaveLength(2);
    expect(cls('.msg__when')).toHaveLength(2);
  });

  it('does not group two different people', async () => {
    await mount(
      <MessageLog
        messages={[
          msg({ id: 'a', created_at: at(0) }),
          msg({ id: 'b', created_at: at(1), sender_id: 'u3', sender_name: 'Priya Nair' }),
        ]}
        loading={false}
        meId="u1"
        members={[]}
      />
    );
    expect(cls('.msg').map(r => r.className.includes('msg--mid'))).toEqual([false, false]);
    expect(cls('.msg__who').map(n => n.textContent)).toEqual(['Rohan Iyer', 'Priya Nair']);
  });

  /**
   * `runEnd` defaults TRUE, because a standalone message is a run of one and is
   * therefore its own last. This is what keeps a caller that has not been taught
   * about the prop — `ThreadPanel`'s root message, and anything written next —
   * rendering a tail and a timestamp rather than neither.
   */
  it('gives a message rendered with no runEnd its tail and its time', async () => {
    await mount(<Message msg={msg()} meId="u1" names={[]} />);
    expect(cls('.msg')[0].className).not.toContain('msg--mid');
    expect(cls('.msg__when')).toHaveLength(1);
  });
});

/* ── 3 · The channel tone ─────────────────────────────────────────────────── */

describe('channelTone · a stored key, and what happens before there is one', () => {
  it('uses the stored colour when the server sent one', () => {
    expect(channelTone({ id: 'c1', type: 'public', color: 'vetana' })).toBe('vetana');
    expect(toneStyle({ id: 'c1', type: 'public', color: 'vetana' }))
      .toEqual({ '--ch-c': 'var(--m-vetana)' });
  });

  /**
   * MIGRATION 100 IS APPLIED BY HAND against a database staging and production
   * share, and the deploy is a separate act — so `color: null` on every channel
   * at once is a real state of the world for a window of unknown length, not an
   * edge case. A rail that renders every tile the same grey for that window is
   * the feature not existing yet, so the key is derived from the id instead.
   */
  it('still gives a colour to a channel the server has no colour for', () => {
    const key = channelTone({ id: 'c1', type: 'public', color: null });
    expect(CHANNEL_TONES).toContain(key);
  });

  it('gives the same channel the same colour every time it is asked', () => {
    // The owner's requirement in their own words: "it gets assinged a different
    // random and it STAYS, no changes everytime". Stable across renders, across
    // reloads and between two people looking at the same rail — which is what
    // rules out Math.random() and an index into the rendered list.
    const a = channelTone({ id: '9f1c0b6e-2f3a-4d5b-8c7e-1a2b3c4d5e6f', type: 'public' });
    const b = channelTone({ id: '9f1c0b6e-2f3a-4d5b-8c7e-1a2b3c4d5e6f', type: 'public' });
    expect(a).toBe(b);
    expect(CHANNEL_TONES).toContain(a);
  });

  it('spreads a handful of uuids over more than one tone', () => {
    // A hash that returns the same bucket for every uuid would satisfy both
    // tests above and defeat the whole feature — the rail would be one colour,
    // which is what it already was.
    const ids = [
      '0f8b7c1d-1111-4000-8000-000000000001',
      '1a2b3c4d-2222-4000-8000-000000000002',
      '2b3c4d5e-3333-4000-8000-000000000003',
      '3c4d5e6f-4444-4000-8000-000000000004',
      '4d5e6f70-5555-4000-8000-000000000005',
      '5e6f7081-6666-4000-8000-000000000006',
    ];
    const tones = new Set(ids.map(id => channelTone({ id, type: 'public' })));
    expect(tones.size).toBeGreaterThan(2);
  });

  it('gives a DM no colour at all', () => {
    // The rail renders a DM as the other person, not as a `#` tile, so there is
    // nothing to colour — and a tone spent there is a tone nobody can see.
    // Migration 100's backfill skips `type = 'dm'` for the same reason.
    expect(channelTone({ id: 'c1', type: 'dm' })).toBeNull();
    expect(channelTone({ id: 'c1', type: 'dm', color: 'graha' })).toBeNull();
    expect(toneStyle({ id: 'c1', type: 'dm' })).toBeUndefined();
  });

  it('discards a value that is not one of the eight', () => {
    // `var(--m-nonsense)` with no fallback resolves to nothing and the tile
    // draws in whatever it inherits — an invisible channel that still occupies a
    // row, with no console warning. Migration 100's CHECK is meant to make this
    // unreachable; this is the second lock.
    const key = channelTone({ id: 'c1', type: 'public', color: '#2F6690' });
    expect(CHANNEL_TONES).toContain(key);
    expect(key).not.toBe('#2F6690');
  });

  it('tolerates a row with no id and a row that is not a row', () => {
    // `failureStates.test.jsx` mounts ChannelList with `channels={[]}`, and
    // proposal 09 names the same requirement: the lookup must not throw.
    expect(channelTone(null)).toBeNull();
    expect(channelTone(undefined)).toBeNull();
    expect(channelTone({ type: 'public' })).toBeNull();
    expect(toneVar(null)).toBeNull();
  });

  it('resolves every one of the eight to a module tone variable', () => {
    // The keys are module ids and `lib/moduleColors` is the one map from a
    // module id to `var(--m-*)`. A key that fell through would resolve to
    // `var(--primary)` — the user's accent — and every channel would be teal.
    for (const key of CHANNEL_TONES) {
      expect(toneVar(key)).toBe(`var(--m-${key})`);
    }
  });
});

/* ── 4 · The emoji picker ─────────────────────────────────────────────────── */

describe('Message · the full emoji picker behind the tray', () => {
  const openPicker = async () => {
    const trigger = container.querySelector('[aria-label="Add a reaction"]');
    expect(trigger).toBeTruthy();
    await click(trigger);
    /**
     * The dataset is a DYNAMIC import — proposal 09 §4 requires it to be, so it
     * does not sit in the main bundle — which means the panel paints its
     * "Loading emoji…" line first and the grid arrives a module-load later. That
     * is not a fixed number of microtasks: vitest resolves the chunk through the
     * module graph, so it is however long that takes.
     *
     * So this WAITS FOR THE GRID rather than flushing a guessed number of times.
     * A guess is how a test ends up asserting against the loading state and
     * passing for the wrong reason — the first draft of this helper flushed
     * twice, found the five quick reactions and no grid, and reported that the
     * picker offers five emoji.
     */
    for (let i = 0; i < 50 && !container.querySelector('.emo__g'); i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { await new Promise(r => { setTimeout(r, 0); }); });
    }
    expect(container.querySelector('.emo__g')).toBeTruthy();
    return trigger;
  };

  it('offers more than the five quick reactions, and posts the one chosen', async () => {
    const onReact = vi.fn();
    await mount(
      <MessageLog messages={[msg()]} loading={false} meId="u1" members={[]} onReact={onReact} />
    );

    // Before: the five, and the button that opens the rest.
    expect(container.querySelector('.emo')).toBeNull();
    await openPicker();

    const panel = container.querySelector('.emo');
    expect(panel).toBeTruthy();
    expect(panel.querySelector('.emo__q')).toBeTruthy();
    // "give full emoji options" — a searchable grid, not six hard-coded faces.
    // The five quick ones are inside it too, which is why this is well over five.
    expect(panel.querySelectorAll('.emo__b').length).toBeGreaterThan(200);

    const pick = [...panel.querySelectorAll('.emo__b')]
      .find(b => b.getAttribute('aria-label') === '🎉');
    expect(pick).toBeTruthy();
    await click(pick);

    expect(onReact).toHaveBeenCalledTimes(1);
    expect(onReact.mock.calls[0][1]).toBe('🎉');
    // One act, so the panel closes behind it.
    expect(container.querySelector('.emo')).toBeNull();
  });

  it('narrows the grid by keyword', async () => {
    await mount(
      <MessageLog messages={[msg()]} loading={false} meId="u1" members={[]} onReact={vi.fn()} />
    );
    await openPicker();

    const panel = container.querySelector('.emo');
    const all = panel.querySelectorAll('.emo__b').length;
    await typeInto(panel.querySelector('.emo__q'), 'rupee');

    const hits = [...container.querySelector('.emo').querySelectorAll('.emo__g .emo__b')];
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThan(all);
    // 'rupee' is in the keywords of the money bag and the money-mouth face, and
    // the search is a substring over keywords rather than a fuzzy score — so a
    // query that means something returns the things that mean it and nothing
    // else. `💰` is the one a reader typing "rupee" is after.
    expect(hits.map(b => b.getAttribute('aria-label'))).toContain('💰');
  });

  it('says so rather than showing an empty grid when nothing matches', async () => {
    await mount(
      <MessageLog messages={[msg()]} loading={false} meId="u1" members={[]} onReact={vi.fn()} />
    );
    await openPicker();
    await typeInto(container.querySelector('.emo__q'), 'zzzzqqqq');

    expect(container.querySelector('.emo__none')).toBeTruthy();
    expect(container.querySelectorAll('.emo__g .emo__b')).toHaveLength(0);
  });

  it('gives a viewer no way to react at all', async () => {
    // `onReact` is withheld for a reader who cannot post — `ChatPane` passes
    // `undefined` rather than a disabled control, which is this module's rule.
    // The picker has to disappear with the five, or a viewer gets a panel whose
    // every button does nothing.
    await mount(<MessageLog messages={[msg()]} loading={false} meId="u1" members={[]} />);
    expect(container.querySelector('[aria-label="Add a reaction"]')).toBeNull();
  });

  it('remembers what was chosen, for the frequently-used row', async () => {
    const onReact = vi.fn();
    await mount(
      <MessageLog messages={[msg()]} loading={false} meId="u1" members={[]} onReact={onReact} />
    );
    // Chosen from the TRAY, not from the panel — the five in the tray are most
    // of what anyone ever sends, so a recents list that only learned about the
    // slow path would never contain them.
    await click(container.querySelector('[aria-label="React 👍"]'));
    expect(JSON.parse(window.localStorage.getItem('sanvaad.emoji.recent'))).toEqual(['👍']);
  });
});
