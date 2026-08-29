/**
 * Two defects Suite 13 found by driving the real screens, and the two lines
 * that close them. Both were invisible to every existing check: no row was
 * wrong, no request 500'd, and nothing appeared in the console.
 *
 * ── DEFECT 1 · a channel TOPIC was stored and rendered nowhere ──────────────
 *
 * `ChannelDetails` offers a Topic field whose own hint reads *"Shown beside the
 * name in the header."* `PATCH /channels/{id}` accepts it, `list_channels`
 * returns it as `description`, and the settings sheet reads it back — so from
 * inside the form it looks exactly like a working field.
 *
 * It appeared on no screen. Measured against HEAD on 2026-08-29,
 * `grep '\.description'` over `pages/sanvaad/**` and `components/sanvaad/**`
 * returned two hits: the form that WRITES it, and `ChatPane`'s sub-line, whose
 * non-DM arm was hard-coded to `"N members · updates every few seconds"`. The
 * rail row spends the same slot on the member count. A column with a writer, a
 * label promising a location, and no reader.
 *
 * ── DEFECT 2 · adding a member did not reach the open conversation ──────────
 *
 * `useChannelMessages.reloadMembers` was called in exactly one place — the
 * mount effect keyed on `channelId` — and was not returned from the hook, so
 * nothing outside could call it. `ChannelDetails` signals a change with
 * `onChanged(null, { members: true })`; `ChannelsTab.channelChanged` answers it
 * with `loadChannels()`, which reloads the RAIL. `ChatPane` is keyed on the
 * channel id, so it does not remount either.
 *
 * Three things went stale together, and the third is the one that bites: the
 * header count, the face stack, and — because `MentionInput.people` IS this
 * array — THE @MENTION VOCABULARY. Somebody added to a private channel could
 * not be mentioned in it until the reader navigated away and came back, which
 * is precisely what you add a colleague in order to do.
 *
 * ── ⚠ THE FIRST VERSION OF THE SECOND CHECK WAS DECORATION ─────────────────
 *
 * It imported the two files with `?raw` and asserted that `reloadMembers`
 * appeared inside the `return { … }` block. THE MUTATION PROOF CAUGHT IT:
 * deleting `reloadMembers` from that return left the test GREEN, because the
 * pattern `/return\s*\{[\s\S]*reloadMembers[\s\S]*\};/` is greedy across the
 * whole file and the name still occurs in the JSDoc beside it. A check nobody
 * has seen fail is decoration — and this one had been written, run, and
 * believed before the mutation was tried.
 *
 * It is a BEHAVIOURAL check now: the pane's own face stack, which is rendered
 * from the hook's `members` array and from nothing else, must grow when a
 * person is added through the real sheet.
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
const patch = vi.fn();
const del = vi.fn();

vi.mock('../lib/api', () => ({
  api: {
    get: (...a) => get(...a),
    post: (...a) => post(...a),
    patch: (...a) => patch(...a),
    delete: (...a) => del(...a),
  },
}));

const { default: ChatPane } = await import('../pages/sanvaad/ChatPane');
const { ToastProvider } = await import('../components/ui');

let container = null;
let root = null;

const CHANNEL = {
  id: 'c1',
  name: 'gst-filing',
  type: 'public',
  description: 'Q1 FY27 returns, and who is chasing which ARN',
  member_count: 1,
  is_archived: false,
};

const EDITOR = { canPost: true, canManage: true, level: 'admin', loading: false };

const KEVAL = { user_id: 'u1', full_name: 'Keval UK', role: 'admin' };
const ANAYA = { user_id: 'u2', full_name: 'Anaya Iyer', role: 'member' };

/** What `GET …/members` answers. The test swaps it to simulate the add. */
let members = [KEVAL];
/** What `GET /v1/messaging/directory` answers — the people who CAN be added. */
let directory = [KEVAL, ANAYA];

function route(url) {
  const u = String(url);
  if (u.includes('/directory')) return { data: directory };
  if (/\/members$/.test(u)) return { data: members };
  if (/\/pins$/.test(u)) return { data: [] };
  return { data: [] };
}

/**
 * Flush microtasks AND real timers.
 *
 * `DmPicker` and `ChannelDetails`' "Add someone" both debounce their directory
 * read by 220ms (`setTimeout`), so a microtask-only flush leaves the section
 * showing "Searching..." for ever and the Add button never exists. Fake timers
 * are not used because the same components also await promises between the
 * timeout and the render, and interleaving those by hand is how a flake gets
 * written into a test that is supposed to remove one.
 */
const settle = async (times = 4, ms = 0) => {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
  if (ms) {
    // eslint-disable-next-line no-promise-executor-return
    await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
    for (let i = 0; i < times; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { await Promise.resolve(); });
    }
  }
};

const mount = async (ui) => {
  await act(async () => { root.render(<MemoryRouter><ToastProvider>{ui}</ToastProvider></MemoryRouter>); });
  await settle();
};

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  get.mockReset(); post.mockReset(); patch.mockReset(); del.mockReset();
  members = [KEVAL];
  directory = [KEVAL, ANAYA];
  get.mockImplementation((url) => Promise.resolve(route(url)));
  post.mockResolvedValue({ data: {} });
  patch.mockResolvedValue({ data: {} });
  del.mockResolvedValue({ data: {} });
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

const byLabel = (label) => [...container.querySelectorAll('button')]
  .find((b) => b.getAttribute('aria-label') === label);

describe('Sanvaad · a channel topic has somewhere to be read', () => {
  it('puts the stored topic in the header sub-line', async () => {
    await mount(<ChatPane channel={CHANNEL} meId="u1" access={EDITOR} />);
    const sub = container.querySelector('.m2c__sub');
    expect(sub, 'ChatPane rendered no sub-line at all').toBeTruthy();
    // ⚠ The assertion is the TOPIC, not "something is there". Before the fix
    // this element existed and read "1 member · updates every few seconds",
    // which is exactly why nobody noticed the topic had nowhere to go.
    expect(sub.textContent).toContain('Q1 FY27 returns');
  });

  it('falls back to the member count when the channel has no topic', async () => {
    await mount(<ChatPane channel={{ ...CHANNEL, description: '' }} meId="u1" access={EDITOR} />);
    // The count is not LOST by the fix — it keeps the slot whenever there is
    // nothing better in it. A fix that silently removed the count would trade
    // one missing fact for another.
    expect(container.querySelector('.m2c__sub').textContent).toMatch(/1 member/);
  });

  it('leaves a DM alone — it has no member count worth printing', async () => {
    await mount(
      <ChatPane channel={{ ...CHANNEL, type: 'dm', description: '' }} meId="u1" access={EDITOR} />,
    );
    expect(container.querySelector('.m2c__sub').textContent).toContain('Direct message');
  });
});

describe('Sanvaad · a member added in the sheet reaches the open conversation', () => {
  it('grows the pane\'s face stack when someone is added through the real sheet', async () => {
    await mount(<ChatPane channel={CHANNEL} meId="u1" access={EDITOR} />);

    /*
     * `.m2c__faces i` is drawn from `members` — the HOOK's array — and from
     * nothing else (`ChatPane`: `const faces = (!dm && members.length) ?
     * members.slice(0, 4) : []`). It is therefore the pane's own view of the
     * membership, which is the thing that went stale. `channel.member_count` is
     * a PROP and would have gone on reading 1 either way, so asserting on the
     * header button would have proved nothing.
     */
    expect(container.querySelectorAll('.m2c__faces i').length,
      'the pane did not load its members on mount').toBe(1);

    const gear = byLabel('Channel settings');
    expect(gear, 'no channel-settings control on the header').toBeTruthy();
    await act(async () => { gear.click(); });
    await settle(6, 400);

    // The Sheet PORTALS to document.body, so it is not inside `container` --
    // `components/ui/Sheet.jsx` renders through a portal so the overlay escapes
    // any `overflow: hidden` ancestor. Querying `container` finds nothing and
    // reads as "the sheet did not open", which is the wrong diagnosis.
    const addRow = [...document.querySelectorAll('.svd__row')]
      .find((r) => r.textContent.includes('Anaya Iyer'));
    expect(addRow, 'the sheet offered nobody to add — the directory mock did not reach it')
      .toBeTruthy();
    const addBtn = [...addRow.querySelectorAll('button')]
      .find((b) => b.textContent.trim() === 'Add');
    expect(addBtn, 'the "Add someone" row carries no Add button').toBeTruthy();

    // The server now has the second member — the state after
    // `POST …/members?user_id=…` has answered 201.
    members = [KEVAL, ANAYA];

    await act(async () => { addBtn.click(); });
    await settle(8, 400);

    /*
     * ⚠ THIS IS THE WHOLE CHECK. Before the fix, `ChannelDetails` refreshed its
     * OWN member list (so the sheet looked right), told `ChannelsTab`, which
     * reloaded the RAIL — and the pane behind the sheet still held one member.
     * The face stack stayed at one, the header count stayed at one, and the `@`
     * picker could not offer the person who had just been added.
     */
    expect(container.querySelectorAll('.m2c__faces i').length,
      'the pane never refetched its members, so the header, the face stack and ' +
      'the @mention vocabulary all stayed on the pre-add membership')
      .toBe(2);
  });

  it('still shows the sheet\'s own list correctly, so the two are not confused', async () => {
    await mount(<ChatPane channel={CHANNEL} meId="u1" access={EDITOR} />);
    await act(async () => { byLabel('Channel settings').click(); });
    await settle(6, 400);
    // The sheet's Members section is `ChannelDetails`' own state and always
    // worked. It is asserted here so a future failure says which of the two
    // lists broke rather than leaving it to be guessed.
    const sheet = document.querySelector('.svd');
    expect(sheet, 'the settings sheet did not render').toBeTruthy();
    expect(sheet.textContent).toContain('Keval UK');
  });
});
