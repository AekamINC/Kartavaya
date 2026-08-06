/**
 * ThreadPanel — the SAME thread, two presentations, and the deep link that has
 * to land in whichever one is on screen.
 *
 * `28-messaging-v2.md` §2 is explicit that the panel is not deleted: "It stays
 * as the mobile presentation of the same data — a phone has no room to indent —
 * and it is what a deep link to a reply still opens. What goes away is it being
 * the *only* way to read a reply." It WAS deleted by a parallel run, restored to
 * disk, and imported by nothing. These tests are the wiring's evidence.
 *
 * WHAT IS ASSERTED, AND WHAT DELIBERATELY IS NOT. A test that asserts
 * `ThreadPanel` is imported asserts a fact about the module graph and would pass
 * against a component rendered into a hidden div. So nothing here mentions the
 * import. Each case opens the thread the way a reader does — by pressing the
 * `.m2th__open` disclosure, or by arriving on a deep link — and then asks which
 * of the two surfaces the replies are on. The pair is written as an EXCLUSION in
 * both directions, because the failure that matters is not "the panel is
 * missing" but "both are showing", which puts the same reply on screen twice
 * under one `id` and is the state `Message`'s `anchored` note describes.
 *
 * ── The viewport mock ───────────────────────────────────────────────────────
 *
 * MEASURED: there is no viewport-mocking helper in this repo to copy.
 * `grep -rn "matchMedia" src` over the suites returns nothing, and jsdom does
 * not implement `window.matchMedia` at all (`typeof window.matchMedia` is
 * `'undefined'`), which is why `useMediaQuery`'s no-matchMedia guard has been
 * silently answering `false` for every test that has ever rendered `ChannelsTab`
 * or `ChatPane` — they have all run in the desktop branch and none of them knew
 * it. So the stub below is new, and it is deliberately the smallest thing that
 * can be wrong in only one way: it parses `(max-width: N)` out of the query and
 * compares it to a width this file sets. No listener bookkeeping beyond what
 * `useMediaQuery` calls, because nothing here rotates a device mid-test.
 *
 * Rendered with react-dom directly, for the reason `sanvaadChatPane.test.jsx`
 * gives: `@testing-library/react` is installed but its `@testing-library/dom`
 * peer is not, so importing it throws.
 */
import React from 'react';
import { act } from 'react';
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
const { ToastProvider } = await import('../components/ui');

/* ── The viewport ─────────────────────────────────────────────────────────── */

let viewport = 1280;

/**
 * Just enough `matchMedia` for `useMediaQuery`: `matches`, and the two listener
 * methods it attaches and detaches. Only `(max-width: N)` is understood, which
 * is the only shape either caller passes; anything else answers false rather
 * than guessing, so a query this stub does not model fails loudly in the
 * assertion instead of quietly matching.
 */
const installMatchMedia = () => {
  window.matchMedia = (query) => {
    const max = /\(\s*max-width:\s*(\d+)px\s*\)/.exec(String(query));
    return {
      media: String(query),
      matches: max ? viewport <= Number(max[1]) : false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    };
  };
};

/* ── The conversation ─────────────────────────────────────────────────────── */

const CHANNEL = {
  id: 'c1', name: 'gst-filing', type: 'public', description: 'Q1 FY27 returns',
  member_count: 4, is_archived: false,
};

const ROOT = {
  id: 'm1',
  channel_id: 'c1',
  sender_id: 'u2',
  sender_name: 'Aanya Mehta',
  content: 'Have we filed the March return yet?',
  created_at: '2026-08-06T09:00:00Z',
  reactions: [],
  thread_count: 1,
  last_reply_at: '2026-08-06T09:20:00Z',
  thread_faces: [{ user_id: 'u3', name: 'Rohan Iyer' }],
};

const REPLY = {
  id: 'r1',
  channel_id: 'c1',
  parent_message_id: 'm1',
  sender_id: 'u3',
  sender_name: 'Rohan Iyer',
  content: 'Filed on the fourth, ARN is in the drive.',
  created_at: '2026-08-06T09:20:00Z',
  reactions: [],
};

const ACCESS = { canPost: true, canManage: false, level: 'editor', loading: false };

let container = null;
let root = null;

const mount = async (ui) => {
  await act(async () => {
    root.render(<MemoryRouter><ToastProvider>{ui}</ToastProvider></MemoryRouter>);
  });
  // Let the message page, the members call and the read-marker post settle.
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
};

/** Poll the real clock — `FOCUS_POLL_MS` is 120ms and the retry loop is real. */
const until = async (predicate, ms = 2000) => {
  const deadline = Date.now() + ms;
  /* eslint-disable no-await-in-loop */
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await act(async () => { await new Promise(r => setTimeout(r, 25)); });
  }
  /* eslint-enable no-await-in-loop */
  return predicate();
};

const click = async (el) => {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await act(async () => { await Promise.resolve(); });
};

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  viewport = 1280;
  installMatchMedia();
  // jsdom has no layout, so no scrolling. The deep-link path calls this on the
  // node it finds, and an undefined method would throw inside the retry loop.
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  get.mockReset();
  post.mockReset();
  get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes('/thread')) return Promise.resolve({ data: [REPLY] });
    if (u.includes('/messages')) return Promise.resolve({ data: [ROOT] });
    return Promise.resolve({ data: [] });
  });
  post.mockResolvedValue({ data: {} });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
  delete window.matchMedia;
  vi.useRealTimers();
});

const disclosure = () => container.querySelector('.m2th__open');
const panel = () => container.querySelector('.m2thp');
const inlineBody = () => container.querySelector('.m2th__body');

const pane = (props = {}) => (
  <ChatPane channel={CHANNEL} me={{ user_id: 'u1', full_name: 'Keval Shah' }}
    meId="u1" meName="Keval Shah" access={ACCESS} {...props} />
);

describe('ThreadPanel · which surface the replies open on', () => {
  it('on a phone the replies open in the panel and NOT indented in the log', async () => {
    viewport = 375;
    await mount(pane());

    // The disclosure is the same control at both widths — `Message` gates it on
    // `thread_count > 0 && !small` and never on a breakpoint. If this is null
    // the phone has lost its way into a thread altogether.
    expect(disclosure()).toBeTruthy();
    expect(panel()).toBeNull();

    await click(disclosure());
    expect(await until(() => container.textContent.includes('ARN is in the drive'))).toBe(true);

    expect(panel(), 'the panel is the phone presentation').toBeTruthy();
    expect(inlineBody(), 'nothing indents on a phone').toBeNull();
    // The reply itself, inside the panel and not merely somewhere on the page.
    expect(panel().textContent).toContain('ARN is in the drive');
    // The root is drawn above the replies, which is the whole reason the panel
    // needs the ROW and not just the id.
    expect(panel().textContent).toContain('Have we filed the March return yet?');
  });

  it('on a desktop the replies indent in the log and NO panel is rendered', async () => {
    viewport = 1280;
    await mount(pane());

    expect(disclosure()).toBeTruthy();
    await click(disclosure());
    expect(await until(() => container.textContent.includes('ARN is in the drive'))).toBe(true);

    expect(inlineBody(), 'the inline thread is the desktop presentation').toBeTruthy();
    expect(panel(), 'no overlay over a log that has room to indent').toBeNull();
    expect(inlineBody().textContent).toContain('ARN is in the drive');
  });

  it('renders the reply exactly once, whichever surface it is on', async () => {
    // The failure this catches is both surfaces at once: `Message` stamps
    // `id="m-<id>"` on an anchored row, and the deep link resolves a duplicate
    // id to whichever came first in document order — silently scrolling to the
    // copy the reader cannot see.
    for (const width of [375, 1280]) {
      viewport = width;
      await mount(pane());
      await click(disclosure());
      expect(await until(() => !!document.getElementById('m-r1'))).toBe(true);
      expect(
        container.querySelectorAll('#m-r1').length,
        `one reply node at ${width}px`
      ).toBe(1);
      await act(async () => { root.render(<div />); });
    }
  });
});

describe('ThreadPanel · the deep link to a reply', () => {
  /**
   * `?channel=…&message=<replyId>&thread=<rootId>` — written by
   * `services/samvaad_mentions.py` (`MENTION_URL_THREAD_PARAM = "thread"`, and
   * the value is the reply's `parent_message_id`), read by `ChannelsTab`, and
   * landing here as `focusMessageId` / `focusThreadId`.
   */
  it('opens the panel at the named reply on a phone, with no press at all', async () => {
    viewport = 375;
    await mount(pane({ focusMessageId: 'r1', focusThreadId: 'm1' }));

    expect(await until(() => !!panel())).toBe(true);
    expect(await until(() => !!document.getElementById('m-r1'))).toBe(true);
    // On the surface the reader was sent to, not merely somewhere in the tree.
    expect(panel().contains(document.getElementById('m-r1'))).toBe(true);
    expect(inlineBody()).toBeNull();
    // The focus loop found it and flashed it. This is the assertion that fails
    // if `FOCUS_WAIT_MS`/`FOCUS_POLL_MS` are removed: the replies are a round
    // trip away, so the first attempt lands before the node exists and only the
    // retry can reach it.
    expect(await until(() => document.getElementById('m-r1').classList.contains('msg--new')))
      .toBe(true);
  });

  it('opens the inline thread at the named reply on a desktop', async () => {
    viewport = 1280;
    await mount(pane({ focusMessageId: 'r1', focusThreadId: 'm1' }));

    expect(await until(() => !!inlineBody())).toBe(true);
    expect(await until(() => !!document.getElementById('m-r1'))).toBe(true);
    expect(inlineBody().contains(document.getElementById('m-r1'))).toBe(true);
    expect(panel()).toBeNull();
  });

  it('refuses rather than opening an empty panel when the root is not in the page', async () => {
    // `list_messages` returns the newest fifty. A thread whose root has scrolled
    // past them cannot be opened at either width — an inline thread has no row
    // to hang off and the panel would dereference `root.id` on a root it does
    // not have. The reader is told which way out there is.
    viewport = 375;
    await mount(pane({ focusMessageId: 'r9', focusThreadId: 'm9' }));

    expect(await until(() => document.body.textContent.includes('load earlier messages')))
      .toBe(true);
    expect(panel()).toBeNull();
    expect(inlineBody()).toBeNull();
  });
});

describe('ThreadPanel · what the panel is allowed to offer', () => {
  it('gives a viewer the locked bar inside the thread, not a reply box', async () => {
    viewport = 375;
    await mount(pane({ access: { ...ACCESS, canPost: false, level: 'viewer' } }));
    await click(disclosure());
    expect(await until(() => !!panel())).toBe(true);

    expect(panel().querySelector('.m2cp__locked')).toBeTruthy();
    expect(panel().querySelector('.cmp__ta')).toBeNull();
  });

  it('says the channel is archived rather than blaming the reader’s access', async () => {
    viewport = 375;
    await mount(pane({ channel: { ...CHANNEL, is_archived: true } }));
    await click(disclosure());
    expect(await until(() => !!panel())).toBe(true);

    expect(panel().querySelector('.m2cp__locked')).toBeTruthy();
    expect(panel().textContent).not.toContain('Your Sanvaad access is');
  });

  it('puts the replies on the conversation ground, as the prototype log does', async () => {
    // The panel used to render `sv__log m2log`: `.sv__log` had no ground at
    // all, so without the second class the identical reply sat on `--s-low`
    // here and on `--conv-ground` inline. `.sv__log` is deleted now and
    // `.m2log` — the prototype's own scroller, which carries the ground — is
    // the only class on the element, so this asserts the class is there ALONE
    // rather than that it wins a cascade against a rule that no longer exists.
    viewport = 375;
    await mount(pane());
    await click(disclosure());
    expect(await until(() => !!panel())).toBe(true);

    const log = panel().querySelector('.m2log');
    expect(log).toBeTruthy();
    expect(log.classList.contains('sv__log')).toBe(false);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * SENDING A THREADED REPLY FROM THE CHANNEL COMPOSER.
 *
 * This is the write path the whole inline-thread feature exists for, and until
 * now no test in the repo exercised it. `ChatPane.submit` called
 * `onOpenThread?.(replyTo)` — a name that was a prop back when `ChannelsTab`
 * owned `ThreadPanel`, was never re-pointed when §2 moved the open into
 * `ChatPane` as `openThreadId`, and was therefore an UNDECLARED BINDING.
 *
 * Optional chaining does not guard one. `?.` is a check on the VALUE being
 * nullish, not on the name resolving, so `onOpenThread?.(x)` throws
 * `ReferenceError` exactly as a bare call would. The throw landed inside
 * `submit`\s `try`, so the reply was POSTed, the count went up, and the reader
 * was then shown a red "Failed to send" over a draft that had been put back and
 * a reply bar that was still armed — with `setReplyTo(null)` and `onSent`
 * skipped. Pressing Enter again, which is what that state invites, double-posts.
 *
 * The suite passed with the bug in place because nothing sent WITH A REPLY
 * TARGET. So each assertion below is written against the reader's evidence —
 * the toast, the draft, the reply bar — rather than against the call.
 */
describe('the channel composer · sending into a thread', () => {
  /**
   * Write into the textarea `MentionInput` controls so React hears the edit.
   * `el.value = x` is not enough: React installs its own `value` setter on the
   * node and records the write in its tracker, so the dispatched `input` is
   * de-duplicated away and `onChange` never fires. Going through the PROTOTYPE's
   * setter leaves the tracker stale and the event is seen as a real edit. This is
   * the same technique, and the same reason, as `Composer.writeDraft`.
   */
  const writeDraft = async (el, next) => {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
      if (setter) setter.call(el, next); else el.value = next;
      el.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
  };

  const composer = () => container.querySelector('textarea.cmp__ta');
  const replyBar = () => container.querySelector('.m2cp__reply');
  const trayReply = () => container.querySelector('button[aria-label="Reply in thread"]');

  const enter = async (el) => {
    await act(async () => {
      el.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
  };

  it('posts the reply and reports success — no error toast, no retained draft', async () => {
    const onSent = vi.fn();
    await mount(pane({ onSent }));

    await click(trayReply());
    expect(replyBar(), 'the reply bar arms').toBeTruthy();

    await writeDraft(composer(), 'yes, filed');
    await enter(composer());

    // The reply really is on the wire, with its parent named.
    const sent = post.mock.calls.find(([, body]) => body && body.parent_message_id);
    expect(sent, 'the reply was POSTed').toBeTruthy();
    expect(sent[1]).toMatchObject({ content: 'yes, filed', parent_message_id: 'm1' });

    // …and the reader is told so. Each of these three was false before the fix,
    // with the row already in the database.
    expect(document.body.textContent).not.toContain('Failed to send');
    expect(onSent, 'the shell is told to refresh its rail').toHaveBeenCalled();
    expect(composer().value, 'the draft is not handed back').toBe('');
  });

  it('disarms the reply bar and opens the thread the reply went into', async () => {
    await mount(pane());

    await click(trayReply());
    await writeDraft(composer(), 'yes, filed');
    await enter(composer());

    // `setReplyTo(null)` sat AFTER the throwing call, so the bar stayed armed and
    // the next Enter would have sent a second copy into the same thread.
    expect(replyBar(), 'the reply bar disarms').toBeNull();

    // `replyTo` is the thread ROOT, so this is the thread just written into.
    // Desktop, so the presentation is the indent rather than the panel.
    expect(await until(() => !!inlineBody())).toBe(true);
    expect(inlineBody().textContent).toContain('ARN is in the drive');
  });

  it('an ordinary message still sends, and opens no thread', async () => {
    // The guard is `if (replyTo)`, so this is the branch that must stay untouched.
    const onSent = vi.fn();
    await mount(pane({ onSent }));

    await writeDraft(composer(), 'morning all');
    await enter(composer());

    expect(document.body.textContent).not.toContain('Failed to send');
    expect(onSent).toHaveBeenCalled();
    expect(inlineBody(), 'nothing expands on a plain send').toBeNull();
  });
});
