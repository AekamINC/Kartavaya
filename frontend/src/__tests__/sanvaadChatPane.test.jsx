/**
 * ChatPane's four structural states.
 *
 * These are the states this module has never actually been in. Migration 058 —
 * which creates every `samvada_*` table — was applied only on 2026-07-26, and
 * before that every web call omitted `/v1` (404) and the module gate used a code
 * no subscription row could hold (403). So the surface compiled for months
 * without once rendering against real data, and "it builds" has never been
 * evidence that it mounts.
 *
 * Each case below is a control the RENDERED reference has and the build did not:
 *
 *   1. viewer          — `ScreensSanvaad.jsx:286`, the locked bar and the reason
 *   2. archived        — `:260` the banner and `:290` the different reason
 *   3. editor          — the composer is actually reachable
 *   4. type='system'   — `MESSAGING-ATTENDANCE-SPEC.md:20`, a module event
 *
 * Rendered with react-dom directly: `@testing-library/react` is installed but
 * its `@testing-library/dom` peer is not, so importing it throws. Same reason
 * and same shape as `pageHeader.test.jsx`.
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
const { moduleMeta } = await import('../lib/moduleColors');

let container = null;
let root = null;

const CHANNEL = {
  id: 'c1', name: 'gst-filing', type: 'public', description: 'Q1 FY27 returns',
  member_count: 4, is_archived: false,
};

const mount = async (ui) => {
  await act(async () => {
    root.render(<MemoryRouter><ToastProvider>{ui}</ToastProvider></MemoryRouter>);
  });
  // Let the message load and the read-marker post settle.
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

const text = () => container.textContent;

describe('ChatPane · who may post', () => {
  it('gives a viewer the locked bar and no composer at all', async () => {
    await mount(
      <ChatPane
        channel={CHANNEL}
        meId="u1"
        access={{ canPost: false, canManage: false, level: 'viewer', loading: false }}
      />
    );
    expect(container.querySelector('.cmp--locked')).toBeTruthy();
    expect(container.querySelector('.cmp__ta')).toBeNull();
    expect(text()).toContain('Viewer');
    // The reason has to name the way out, or the bar is just a dead end.
    expect(text()).toContain('Editor');
  });

  it('gives an editor a real composer', async () => {
    await mount(
      <ChatPane
        channel={CHANNEL}
        meId="u1"
        access={{ canPost: true, canManage: false, level: 'editor', loading: false }}
      />
    );
    expect(container.querySelector('.cmp__ta')).toBeTruthy();
    expect(container.querySelector('.cmp--locked')).toBeNull();
  });

  it('shuts an archived channel for an editor, and says something different', async () => {
    await mount(
      <ChatPane
        channel={{ ...CHANNEL, is_archived: true }}
        meId="u1"
        access={{ canPost: true, canManage: true, level: 'admin', loading: false }}
      />
    );
    expect(container.querySelector('.sv__banner')).toBeTruthy();
    expect(container.querySelector('.cmp__ta')).toBeNull();
    expect(text()).toContain('archived');
    expect(text()).toContain('including admins');
    // Not the viewer copy — an archived room is not a permissions problem.
    expect(text()).not.toContain('Your Sanvaad access is');
  });

  it('offers the channel-settings control that reaches PATCH and the member routes', async () => {
    await mount(
      <ChatPane
        channel={CHANNEL}
        meId="u1"
        access={{ canPost: true, canManage: false, level: 'editor', loading: false }}
      />
    );
    const settings = [...container.querySelectorAll('button')]
      .find(b => b.getAttribute('aria-label') === 'Channel settings');
    expect(settings).toBeTruthy();
  });
});

describe('ChatPane · a module event is not a person', () => {
  const SYS = {
    id: 'm1',
    channel_id: 'c1',
    sender_id: 'u2',
    sender_name: 'Aanya Mehta',
    content: '2 purchase invoices flagged — HSN code missing.',
    type: 'system',
    metadata: { module: 'ganit', action_label: 'Open in Ganit', action_href: '/ganit' },
    created_at: new Date().toISOString(),
    reactions: [],
  };

  it('renders type=system with a module identity rather than the triggering user', async () => {
    get.mockImplementation(url =>
      (String(url).includes('/messages')
        ? Promise.resolve({ data: [SYS] })
        : Promise.resolve({ data: [] })));

    await mount(
      <ChatPane
        channel={CHANNEL}
        meId="u1"
        access={{ canPost: true, canManage: false, level: 'editor', loading: false }}
      />
    );

    expect(container.querySelector('.msg--sys')).toBeTruthy();
    expect(container.querySelector('.msg__systag').textContent).toBe('system');
    // Read the label from `moduleColors` rather than hardcoding it. The English
    // name is that file's to own and it has already moved once — `ganit` was
    // "Invoicing" and is now "Finance", which `_DESIGN-GAP.md` §2 lists as the
    // designer's word against the build's paraphrase. What this test is for is
    // that the row carries the MODULE's identity, not that the module is spelt
    // any particular way.
    expect(text()).toContain(moduleMeta('ganit').en);
    // And that the person whose action produced the event is not presented as
    // its author. This is the assertion that fails if system rendering regresses
    // to an ordinary message.
    expect(text()).not.toContain('Aanya Mehta');
    // No avatar and no hover tray: there is nobody to react to.
    expect(container.querySelector('.msg--sys .msg__av')).toBeNull();
    expect(container.querySelector('.msg--sys .msg__act')).toBeNull();
    // The deep link `metadata` carries.
    expect(container.querySelector('.msg__sysa').getAttribute('href')).toBe('/ganit');
  });
});
