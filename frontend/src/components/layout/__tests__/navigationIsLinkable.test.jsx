/**
 * Every destination in the app shell must be a real link.
 *
 * ── THE COMPLAINT ──────────────────────────────────────────────────────────
 * The owner, 2026-09-01: "user cannot open anything in new tab ... they cannot
 * work two different module at same time in different [tabs]. all pages should
 * have option for open in different tab or new windows etc."
 *
 * ── WHAT WAS ACTUALLY WRONG ────────────────────────────────────────────────
 * Nothing BLOCKED a new tab. The app never produced a link to open. Every
 * destination in the sidebar, the admin sidebar and the mobile bar was a
 * `<button onClick={() => navigate(to)}>`, and a button has no href — so
 * ctrl-click, middle-click, cmd-click and the browser's own "Open link in new
 * tab" all had nothing to act on. 32 staff destinations, 7 admin ones, and the
 * mobile bar: not one of them could be opened in a second tab.
 *
 * That failure is invisible in every screenshot and in every click-through
 * test, because a button that navigates LOOKS exactly like a link that
 * navigates. It only shows up when somebody tries to middle-click it.
 *
 * ── WHY THESE ASSERT ON `href`, NOT ON THE ELEMENT NAME ────────────────────
 * `<Link>` is an implementation detail; `href` is what the browser acts on. A
 * test asserting "renders a Link component" would pass over a `<Link>` given
 * `to=""`, which produces no usable address.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import Sidebar from '../Sidebar';
import { CustomizeProvider } from '../../CustomizePanel';
import {
  makeHost, installMockApi, installNetworkKillSwitch, restoreNetwork,
  signIn, users,
} from '../../../__tests__/e2e/_harness';

const SRC = ['src', 'frontend/src']
  .map((p) => path.resolve(process.cwd(), p))
  .find(existsSync);

const read = (rel) => readFileSync(path.join(SRC, rel), 'utf8');

/** Source with comments removed — these files EXPLAIN what they no longer do. */
const live = (rel) => read(rel)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((l) => !l.trim().startsWith('//'))
  .join('\n');

let host;

beforeEach(() => {
  installNetworkKillSwitch();
  installMockApi({});
  host = makeHost();
  signIn(Object.values(users)[0]);
});

afterEach(async () => {
  await host.unmount();
  restoreNetwork();
  vi.restoreAllMocks();
});

/* ── The rendered assertion ─────────────────────────────────────────────── */

describe('the sidebar renders destinations a browser can open', () => {
  // `makeHost().mount` already wraps in a MemoryRouter. Nesting a second one
  // throws "You cannot render a <Router> inside another <Router>".
  // Sidebar reads `useCustomize` for the label script (English/Hindi/Gujarati),
  // so it needs the provider its real parent gives it.
  const mountSidebar = () => host.mount(
    <CustomizeProvider><Sidebar /></CustomizeProvider>,
    { path: '/dashboard' },
  );

  it('gives every nav entry an href', async () => {
    await mountSidebar();
    await act(async () => {});

    const items = [...host.container.querySelectorAll('.side__item')];
    expect(items.length, 'the sidebar rendered no entries at all').toBeGreaterThan(0);

    const withoutHref = items.filter((el) => !el.getAttribute('href'));
    expect(
      withoutHref.map((el) => el.textContent.trim().slice(0, 30)),
      'these sidebar entries cannot be opened in a new tab',
    ).toEqual([]);
  });

  it('renders them as anchors, so the context menu offers "open in new tab"', async () => {
    await mountSidebar();
    await act(async () => {});
    const items = [...host.container.querySelectorAll('.side__item')];
    expect(items.every((el) => el.tagName === 'A')).toBe(true);
  });

  it('still marks the current page for a screen reader', async () => {
    // The conversion must not cost what the button already did right.
    await mountSidebar();
    await act(async () => {});
    expect(host.container.querySelectorAll('[aria-current="page"]').length)
      .toBeGreaterThan(0);
  });
});

/* ── The source assertion, which is the ratchet ──────────────────────────── */

describe('the shell does not navigate by onClick', () => {
  /**
   * A rendered test covers only what this fixture happens to render — one role,
   * one route, one viewport. The source check covers every entry in every
   * branch, and it is the one that fails when somebody adds a nav item as a
   * button next year.
   */
  const SHELLS = [
    'components/layout/Sidebar.jsx',
    'components/layout/MobileNav.jsx',
    'components/admin/AdminSidebar.jsx',
  ];

  it.each(SHELLS)('%s has no onClick navigate', (rel) => {
    expect(
      /navigate\s*\(/.test(live(rel)),
      `${rel} still navigates in JS — a destination reached that way has no href`,
    ).toBe(false);
  });

  it.each(SHELLS)('%s imports Link', (rel) => {
    expect(read(rel)).toMatch(/import \{[^}]*\bLink\b[^}]*\} from 'react-router-dom'/);
  });

  it.each(SHELLS)('%s does not reach for NavLink', (rel) => {
    /* `pages/client/ClientShell.jsx` records why it was rejected once already:
     * NavLink's own matcher marks a parent current on every child path, and
     * this app has colliding prefixes. Both sidebars carry an `isActive` that
     * also understands `?tab=`, which NavLink cannot see at all.
     *
     * Comments stripped — this very check failed on its own prose the first
     * time it ran, which is the fixture-shaped fault in miniature. */
    expect(live(rel)).not.toMatch(/\bNavLink\b/);
  });
});

/* ── The floor ──────────────────────────────────────────────────────────── */

describe('anti-vacuity', () => {
  it('there are destinations to check in the first place', () => {
    // If navConfig ever emptied, every assertion above would pass over nothing.
    const destinations = read('components/layout/navConfig.js').match(/to:\s*'/g) || [];
    expect(destinations.length).toBeGreaterThan(20);
  });
});
