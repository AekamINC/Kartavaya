/**
 * sanvaadWiring.test.jsx — the prop chains, pinned at both ends.
 *
 * Every feature asserted here was BUILT, SHIPPED AND DEAD. Mentions, pinning and
 * the typing line were each written at both ends of a chain — a handler in
 * `ChatPane`, a control in `Message` — while the component in the middle simply
 * did not forward the prop. `npm run check`, `npm run build` and all 857 unit
 * tests were green the whole time, and stayed identically green when the three
 * were revived, because nothing anywhere asserted that the two ends were
 * connected. A test suite that cannot tell a working feature from a severed one
 * is not testing the feature.
 *
 * So these are deliberately END-TO-END through the intermediary. Every case
 * mounts the real parent, hands it the real props a real caller hands it, and
 * looks for the CONTROL in the DOM — never for a call count on a mock parent.
 * `MessageLog` re-exports nothing and computes little; its entire job is to be a
 * faithful conduit, and the only way to state that is to look at what came out
 * the far side.
 *
 * Rendered with react-dom directly rather than @testing-library/react — the same
 * constraint `sanvaadChatPane.test.jsx`, `pageHeader.test.jsx` and
 * `kanbanTab.test.jsx` all record, and the same workaround.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

/**
 * Every props object `Message` was rendered with, newest last.
 *
 * The DOM assertions below are the ones that matter — a control a reader can
 * see is the only proof a feature exists — but one requirement in this file is
 * a statement about the PROP itself and cannot be read off the DOM alone:
 * `canUnpin` goes into `MessageLog` as a predicate and must come out of it as a
 * boolean. `typeof` answers that in one line; reconstructing it from rendered
 * output would take three cases and still not distinguish "false" from "a
 * function that returned false".
 *
 * The spy renders the REAL component, so nothing below is testing a stand-in:
 * it records and delegates. `vi.hoisted` because a `vi.mock` factory is lifted
 * above every other statement in the module and cannot close over an ordinary
 * `const`.
 */
const captured = vi.hoisted(() => []);

vi.mock('../pages/sanvaad/Message', async () => {
  const actual = await vi.importActual('../pages/sanvaad/Message');
  const react = await import('react');
  const Real = actual.default;
  return {
    ...actual,
    default: function MessageSpy(props) {
      captured.push(props);
      return react.createElement(Real, props);
    },
  };
});

const { default: MessageLog } = await import('../pages/sanvaad/MessageLog');
const { default: ChannelList } = await import('../pages/sanvaad/ChannelList');
const { default: ChatPane } = await import('../pages/sanvaad/ChatPane');
const { ToastProvider } = await import('../components/ui');

let container = null;
let root = null;

const NOW = new Date('2026-08-02T09:15:00+05:30').toISOString();

/** One ordinary message from somebody who is not the reader. */
const MSG = {
  id: 'm1',
  channel_id: 'c1',
  sender_id: 'u2',
  sender_name: 'Rohan Iyer',
  content: 'Draft is ready for review.',
  created_at: NOW,
  reactions: [],
};

const CHANNEL = {
  id: 'c1', name: 'gst-filing', type: 'public', member_count: 4, is_archived: false,
};

const mount = async (ui) => {
  await act(async () => {
    root.render(<MemoryRouter><ToastProvider>{ui}</ToastProvider></MemoryRouter>);
  });
  // A second flushed tick, so the message load and the read-marker post settle.
  await act(async () => { await Promise.resolve(); });
};

const click = async (el) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
};

/**
 * `Menu` portals its panel to `document.body`, so the rows are NOT inside
 * `container` — querying the container for them finds nothing and reads as "the
 * control is missing", which is the exact failure this file exists to detect.
 */
const menuRows = () => [...document.querySelectorAll('[role="menuitem"]')];
const menuRow = label => menuRows().find(b => b.textContent.includes(label));

/** Open the hover tray's "More" menu on the only message on screen. */
const openMessageMenu = async () => {
  const trigger = container.querySelector('[aria-label="Message actions"]');
  expect(trigger).toBeTruthy();
  await click(trigger);
};

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  captured.length = 0;
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

/* ── 1 · MessageLog is a conduit, not a filter ─────────────────────────────── */

describe('MessageLog · forwards the pin chain to Message', () => {
  it('renders the pin control when onPin is supplied', async () => {
    const onPin = vi.fn();
    await mount(
      <MessageLog
        messages={[MSG]}
        loading={false}
        meId="u1"
        members={[]}
        onPin={onPin}
        onUnpin={vi.fn()}
        canUnpin={() => false}
      />
    );

    await openMessageMenu();
    expect(menuRow('Pin message')).toBeTruthy();

    // And the handler that reaches `Message` is the caller's own function, not
    // a wrapper this layer invented. `ChatPane` owns the toast and the
    // optimistic rollback; a conduit that re-wraps would own them by accident.
    expect(captured.at(-1).onPin).toBe(onPin);
  });

  it('renders NO pin control when onPin is withheld, while the rest of the menu survives', async () => {
    // `meId` matches the sender, so edit and delete are both in the menu. The
    // menu therefore opens either way and the assertion is about the pin row
    // alone — a test that merely found no menu could not tell "pinning is gone"
    // from "the tray is gone".
    await mount(
      <MessageLog
        messages={[MSG]}
        loading={false}
        meId="u2"
        members={[]}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    await openMessageMenu();
    expect(menuRow('Edit message')).toBeTruthy();
    expect(menuRow('Delete message')).toBeTruthy();
    expect(menuRow('Pin message')).toBeFalsy();
  });

  it('offers Unpin rather than Pin on a message that is already pinned', async () => {
    await mount(
      <MessageLog
        messages={[{ ...MSG, pinned_at: NOW, pinned_by: 'u2', pinned_by_name: 'Rohan Iyer' }]}
        loading={false}
        meId="u1"
        members={[]}
        onPin={vi.fn()}
        onUnpin={vi.fn()}
        canUnpin={() => true}
      />
    );

    // The pinned chip on the row itself: `pinned_at` is server state, and this
    // is the half of it that survives even on a continuation row.
    expect(container.querySelector('.msg--pinned')).toBeTruthy();
    expect(container.querySelector('.msg__pin').textContent).toContain('Pinned by Rohan Iyer');

    await openMessageMenu();
    expect(menuRow('Unpin message')).toBeTruthy();
    expect(menuRow('Pin message')).toBeFalsy();
  });
});

/* ── 2 · The predicate/boolean seam ────────────────────────────────────────── */

describe('MessageLog · canUnpin arrives as a predicate and leaves as a boolean', () => {
  const PINNED = { ...MSG, pinned_at: NOW, pinned_by: 'u9' };

  /**
   * THE BUG, stated once because all three cases below are the same bug.
   *
   * `ChatPane` passes a PREDICATE — the rule is "the person who pinned it, or a
   * channel admin", which is per-message because `pinned_by` is. `Message`
   * wants the ANSWER, and gates the row with `disabled: pinned && !canUnpin`.
   * Forward the predicate unchanged and `!fn` is `false` for every function
   * that has ever existed, so the ✕ is enabled for the whole channel and the
   * only thing standing between a reader and somebody else's pin is a 403 they
   * get after clicking. Nothing about that is visible in a build, a lint or a
   * render — the control looks correct, it is simply offered to everybody.
   */
  it('disables Unpin when the predicate says this reader may not', async () => {
    const canUnpin = vi.fn(() => false);
    await mount(
      <MessageLog
        messages={[PINNED]}
        loading={false}
        meId="u1"
        members={[]}
        onUnpin={vi.fn()}
        canUnpin={canUnpin}
      />
    );

    // Applied to THIS row, not called once for the log: `pinned_by` differs per
    // message, so a single answer reused across the log would be wrong on every
    // row but one.
    expect(canUnpin).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1', pinned_by: 'u9' }));

    await openMessageMenu();
    const row = menuRow('Unpin message');
    expect(row).toBeTruthy();
    // Still present, deliberately — hiding it would leave a pinned message with
    // no visible explanation of why it cannot be unpinned.
    expect(row.disabled).toBe(true);

    // Asserted AFTER the DOM, so the visible symptom is what fails first if the
    // normalisation is ever dropped. This pair is the cause underneath it.
    expect(typeof captured.at(-1).canUnpin).toBe('boolean');
    expect(captured.at(-1).canUnpin).toBe(false);
  });

  it('enables Unpin when the predicate says this reader may', async () => {
    await mount(
      <MessageLog
        messages={[PINNED]}
        loading={false}
        meId="u1"
        members={[]}
        onUnpin={vi.fn()}
        canUnpin={() => true}
      />
    );

    expect(captured.at(-1).canUnpin).toBe(true);

    await openMessageMenu();
    expect(menuRow('Unpin message').disabled).toBe(false);
  });

  it('answers false when no predicate is given at all', async () => {
    // The safe direction, and the one a caller who has not been taught about
    // pinning yet gets for free. `undefined` must not read as "allowed".
    await mount(
      <MessageLog
        messages={[PINNED]}
        loading={false}
        meId="u1"
        members={[]}
        onUnpin={vi.fn()}
      />
    );

    expect(captured.at(-1).canUnpin).toBe(false);
    await openMessageMenu();
    expect(menuRow('Unpin message').disabled).toBe(true);
  });
});

/* ── 3 · The rail's two badges ─────────────────────────────────────────────── */

describe('ChannelList · the mention badge survives muting and the count does not', () => {
  const rows = () => [...container.querySelectorAll('.ch')];

  const CHANNELS = [
    // Muted, unread, AND named in a mention. The interesting row: the two badges
    // must disagree here or the asymmetry does not exist.
    { id: 'c1', name: 'gst-filing', type: 'public', member_count: 4, unread_count: 7, mention_count: 2, muted: true },
    // Ordinary unread.
    { id: 'c2', name: 'audit-fy27', type: 'public', member_count: 3, unread_count: 5, mention_count: 0, muted: false },
    // Muted with nothing addressed to this reader — the row that must go quiet.
    { id: 'c3', name: 'random', type: 'public', member_count: 9, unread_count: 41, mention_count: 0, muted: true },
  ];

  const list = () => (
    <ChannelList
      channels={CHANNELS}
      loading={false}
      selectedId={null}
      onSelect={vi.fn()}
      onCreate={vi.fn()}
      onToggleAll={vi.fn()}
      showAll={false}
    />
  );

  it('shows the mention badge and the mute glyph, and suppresses the unread count', async () => {
    await mount(list());
    const [muted, plain, quiet] = rows();

    // Muting suppresses the COUNT and not the MENTION. Information can wait;
    // somebody saying your name is an obligation, and nobody mutes their own
    // name.
    expect(muted.querySelector('.ch__mn').textContent).toBe('2');
    expect(muted.querySelector('.ch__badge')).toBeNull();
    expect(muted.querySelector('.ch__mute')).toBeTruthy();

    expect(plain.querySelector('.ch__badge').textContent).toBe('5');
    expect(plain.querySelector('.ch__mn')).toBeNull();
    expect(plain.querySelector('.ch__mute')).toBeNull();

    expect(quiet.querySelector('.ch__badge')).toBeNull();
    expect(quiet.querySelector('.ch__mn')).toBeNull();
    expect(quiet.querySelector('.ch__mute')).toBeTruthy();
  });

  it('bolds the row exactly when it is carrying something, so weight and badges agree', async () => {
    await mount(list());
    const [muted, plain, quiet] = rows();

    // A bold row with no badge on it reads as a rendering fault, which is what
    // deriving `.unread` from the raw count produced on a muted channel.
    expect(muted.className).toContain('unread');
    expect(plain.className).toContain('unread');
    expect(quiet.className).not.toContain('unread');
  });

  it('names both badges for a screen reader, since colour and absence announce nothing', async () => {
    await mount(list());
    const [muted, plain] = rows();

    expect(muted.querySelector('.ch__mn').getAttribute('aria-label')).toBe('2 mentions');
    expect(muted.querySelector('.ch__mute').getAttribute('aria-label')).toBe('Muted');
    expect(plain.querySelector('.ch__badge').getAttribute('aria-label')).toBe('5 unread');
  });
});

/* ── 4 · The mention vocabulary ────────────────────────────────────────────── */

describe('MessageLog · mentions come from the member list, not from who has posted', () => {
  /**
   * `renderMentions.test.jsx` guards this exact bug for task comments and says
   * why: the inserter writes the member's FULL display name ("@Aanya Mehta")
   * while a parser that stops at the space renders a bolded "@Aanya" followed
   * by plain " Mehta" — the visible symptom of the two halves disagreeing.
   *
   * Sanvaad had a second way to reach the same broken output, and it is the one
   * asserted here: the parser was correct, but the VOCABULARY it was given came
   * from the senders in the loaded page. A colleague who had never posted in
   * this channel was not in it, so "@Aanya Mehta" fell through to the bare
   * `[\w.-]+` fallback and rendered as "@Aanya" plus loose text — while the
   * server had already resolved the full name and put a mention in Aanya's
   * inbox. The message said one thing and the notification said another.
   */
  const AANYA = { user_id: 'u9', full_name: 'Aanya Mehta', role: 'member' };
  const BODY = 'Morning @Aanya Mehta, can you check the GSTR-1 draft?';

  it('renders a never-posted member as one mention, not a bolded first name', async () => {
    await mount(
      <MessageLog
        messages={[{ ...MSG, content: BODY }]}
        loading={false}
        meId="u1"
        members={[AANYA]}
      />
    );

    // Aanya is in the channel and has said nothing in it — the only sender in
    // the log is Rohan. This is the case the sender-derived vocabulary missed.
    expect(container.textContent).toContain('Rohan Iyer');

    const mentions = [...container.querySelectorAll('.msg__mn')];
    expect(mentions.map(n => n.textContent)).toEqual(['@Aanya Mehta']);

    // Nothing dropped and nothing duplicated around the mention — the other
    // half of the split going wrong.
    expect(container.querySelector('.msg__b').textContent).toBe(BODY);
  });

  it('still knows a sender who is absent from the member list', async () => {
    // The union is not decoration. `members` is empty until `list_members`
    // lands and stays empty if it failed, and somebody who has since left the
    // channel is off the list while still owning the messages they wrote.
    await mount(
      <MessageLog
        messages={[
          { ...MSG, id: 'm0', content: 'Sending it over.' },
          { ...MSG, id: 'm1', content: 'Thanks @Rohan Iyer.', sender_id: 'u3', sender_name: 'Priya Nair' },
        ]}
        loading={false}
        meId="u1"
        members={[]}
      />
    );

    expect([...container.querySelectorAll('.msg__mn')].map(n => n.textContent))
      .toEqual(['@Rohan Iyer']);
  });

  it('marks a mention of the reader differently from a mention of anybody else', async () => {
    await mount(
      <MessageLog
        messages={[{ ...MSG, content: 'cc @Aanya Mehta and @Keval Shah' }]}
        loading={false}
        meId="u1"
        meName="Keval Shah"
        members={[AANYA, { user_id: 'u1', full_name: 'Keval Shah' }]}
      />
    );

    const mine = [...container.querySelectorAll('.msg__mn')]
      .filter(n => n.className.includes('msg__mn--me'));
    expect(mine.map(n => n.textContent)).toEqual(['@Keval Shah']);
  });
});

/* ── 5 · A message body is a string, never markup ──────────────────────────── */

describe('Sanvaad · a message body never reaches the DOM as markup', () => {
  it('renders a script tag as the characters somebody typed', async () => {
    const BODY = '<script>alert("xss")</script> and <img src=x onerror=alert(1)>';
    await mount(
      <MessageLog messages={[{ ...MSG, content: BODY }]} loading={false} meId="u1" members={[]} />
    );

    // A channel message is a string one colleague typed that renders in every
    // other colleague's browser, so an injected `<img onerror>` here runs for
    // the whole channel rather than for its author.
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.msg__b').textContent).toBe(BODY);
  });

  it('refuses a javascript: URL rather than rendering it as a link', async () => {
    // The one thing React's escaping does NOT give for free: it will happily
    // render `href="javascript:…"`. `safeHref` is an allowlist, so the text
    // stays text.
    await mount(
      <MessageLog
        messages={[{ ...MSG, content: 'try javascript:alert(1) and https://kartavaya.com' }]}
        loading={false}
        meId="u1"
        members={[]}
      />
    );

    const hrefs = [...container.querySelectorAll('a')].map(a => a.getAttribute('href'));
    expect(hrefs).toEqual(['https://kartavaya.com']);
    expect(container.querySelector('.msg__b').textContent).toContain('javascript:alert(1)');
  });

  it('has no innerHTML path anywhere on this surface', async () => {
    /**
     * The defence is structural, not local: `parseRich` emits plain data and
     * `Message` turns it into React children, which React escapes on insertion.
     * One `dangerouslySetInnerHTML` added anywhere on this path — the log, the
     * pinned bar, the thread panel, the search results, all of which render the
     * same `content` — silently undoes the whole thing, and would not fail a
     * single other test in this repo.
     *
     * Matched on the SYNTACTIC FORM (`= ` or `:` after the attribute, `(` after
     * the call) rather than on the bare word, because both files carry long
     * comments naming these APIs as the thing they must not use, and a scan
     * that could not tell a warning from a use would have to be deleted the
     * first time somebody explained the rule again.
     */
    // `join(dirname(fileURLToPath(…)))` and NOT `new URL('../pages/sanvaad/',
    // import.meta.url)`, which is the idiom this would otherwise be written in.
    // Vite owns that exact expression — its asset handling rewrites it at
    // transform time — so under vitest it does not resolve to a file at all but
    // to `http://localhost:3000/src/pages/sanvaad`, and `fileURLToPath` refuses
    // it. The failure is at least loud; the same rewrite in a test that only
    // globbed would have quietly matched nothing and passed forever.
    const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'pages', 'sanvaad');
    const banned = [/dangerouslySetInnerHTML\s*[=:]/, /\.innerHTML\s*=/, /insertAdjacentHTML\s*\(/];
    const files = readdirSync(dir).filter(n => /\.jsx?$/.test(n));

    // A scan over nothing is not a passing scan. If this directory is ever moved
    // or renamed, that has to fail here rather than silently stop checking.
    expect(files.length).toBeGreaterThan(10);

    const offenders = files.filter(n => {
      const src = readFileSync(join(dir, n), 'utf8');
      return banned.some(re => re.test(src));
    });

    expect(offenders).toEqual([]);
  });
});

/* ── 6 · The typing line ───────────────────────────────────────────────────── */

describe('ChatPane · the typing line', () => {
  const pane = extra => (
    <ChatPane
      channel={CHANNEL}
      meId="u1"
      access={{ canPost: true, canManage: false, level: 'editor', loading: false }}
      {...extra}
    />
  );

  it('renders nothing at all when nobody is typing', async () => {
    await mount(pane({ typing: [] }));
    expect(container.querySelector('.sv__typing')).toBeNull();
    // The live region itself stays mounted and empty. A region that appears at
    // the same moment as its content is never announced, because the
    // announcement fires on a mutation of a region the screen reader was
    // already watching.
    expect(container.querySelector('[aria-live="polite"]')).toBeTruthy();
  });

  it('names one person, and two, and stops naming above three', async () => {
    const who = n => ({ user_id: `u${n}`, full_name: `Person ${n}` });

    await mount(pane({ typing: [{ user_id: 'u2', full_name: 'Rohan Iyer' }] }));
    expect(container.querySelector('.sv__typing').textContent).toContain('Rohan Iyer is typing…');

    await mount(pane({ typing: [who(2), who(3)] }));
    expect(container.querySelector('.sv__typing').textContent)
      .toContain('Person 2 and Person 3 are typing…');

    await mount(pane({ typing: [who(2), who(3), who(4), who(5)] }));
    expect(container.querySelector('.sv__typing').textContent)
      .toContain('Several people are typing…');
  });

  it('never tells the reader that they themselves are typing', async () => {
    // The server already excludes the caller from `/live`; this is the second
    // lock on a door that has to stay shut, because "you are typing" is the one
    // claim the reader can definitively falsify.
    await mount(pane({ typing: [{ user_id: 'u1', full_name: 'Keval Shah' }] }));
    expect(container.querySelector('.sv__typing')).toBeNull();
  });
});
