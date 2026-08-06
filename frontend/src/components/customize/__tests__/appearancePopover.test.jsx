/**
 * The appearance popover, asserted through the REAL top bar.
 *
 * ── Why the Topbar and not the component ────────────────────────────────────
 *
 * The complaint being fixed is "you have to navigate to a settings page and
 * back". A test that mounts `AppearanceMenu` on its own proves the popover
 * works and proves nothing at all about whether anyone can reach it, which is
 * the entire defect. So every case here mounts `layout/Topbar.jsx` — the
 * component `AppShell` renders once for every route inside the shell — and
 * drives it the way a user does.
 *
 * ── Why two module routes ───────────────────────────────────────────────────
 *
 * The brief this answers is scoped to Sahayak, and the obvious wrong fix is a
 * control that only exists there. `/graha` (CRM) and `/vetana` (Payroll) are
 * two unrelated modules with different breadcrumb metadata; the popover has to
 * open and apply identically on both, and neither of them is Sahayak. If
 * someone later moves this into `pages/sahayak/**` these two cases fail.
 *
 * ── What "applies immediately" is measured as ───────────────────────────────
 *
 * Not "the store changed" — that is a test of React. `applyPrefs` writes the
 * accent onto `documentElement.style`, and every accent-coloured rule in the
 * product reads those custom properties, so the assertion is that the ROOT
 * ELEMENT carries the new value synchronously after the click, with no save
 * button, no navigation and no reload. `--primary-container` is asserted
 * alongside `--k-primary` because those are two different code paths inside
 * `applyPrefs` and the container half has been the one that silently stayed
 * teal before.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

/* OrgSwitcher, rendered inside the Topbar, GETs /v1/org/memberships on mount.
   It is not what is under test and a real request in jsdom is an unhandled
   rejection, so the module is stubbed. It already treats a failure as "no
   switcher", which is the shape this returns. */
vi.mock('../../../lib/api', () => ({
  api: {
    get:  vi.fn(() => Promise.resolve({ data: { data: [], support: [] } })),
    post: vi.fn(() => Promise.resolve({ data: {} })),
    put:  vi.fn(() => Promise.resolve({ data: {} })),
  },
}));

import Topbar from '../../layout/Topbar';
import { CustomizeProvider, ACCENTS, DEFAULTS } from '../../CustomizePanel';

const CRIMSON = ACCENTS.find(a => a.id === 'crimson');

function mountAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <CustomizeProvider>
        <Topbar />
      </CustomizeProvider>
    </MemoryRouter>,
  );
}

/** The one control that has to exist for any of this to be reachable. */
const trigger = () => screen.getByRole('button', { name: 'Appearance' });

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-density');
});
afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('style');
});

describe('appearance popover · reachable from the top bar', () => {
  it.each([
    ['/graha',  'CRM'],
    ['/vetana', 'Payroll'],
  ])('opens on %s without navigating away', async (path) => {
    const user = userEvent.setup();
    mountAt(path);

    // Closed to begin with, and the button says so.
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog', { name: 'Appearance' })).toBeNull();

    await user.click(trigger());

    const pop = screen.getByRole('dialog', { name: 'Appearance' });
    expect(pop).toBeInTheDocument();
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');

    // The eight groups the reference popover carries, read off the section
    // labels themselves rather than by text search: "Accent" also appears
    // inside AccentGrid's own markup, and a search that matches two things is
    // not evidence about either.
    const labels = [...pop.querySelectorAll('.kap__lbl')].map(el => el.textContent);
    expect(labels).toEqual([
      'Mode', 'Accent', 'Sidebar', 'Density', 'Corners', 'Motion',
      'Typeface', 'Conversation', 'Notification sound',
    ]);
  });

  it.each([['/graha'], ['/vetana']])(
    'applies the accent to the live document on %s, with no save and no navigation',
    async (path) => {
      const user = userEvent.setup();
      mountAt(path);

      await user.click(trigger());
      const pop = screen.getByRole('dialog', { name: 'Appearance' });

      const before = document.documentElement.style.getPropertyValue('--k-primary');
      expect(before).not.toBe(CRIMSON.color);

      await user.click(within(pop).getByRole('radio', { name: /Crimson/ }));

      // The ROOT carries it — that is what every accent-coloured rule reads.
      expect(document.documentElement.style.getPropertyValue('--k-primary'))
        .toBe(CRIMSON.color);
      // The container half is a separate branch of applyPrefs; it has been the
      // one to stay teal before, so it is asserted separately.
      expect(document.documentElement.style.getPropertyValue('--primary-container'))
        .not.toBe('');

      // The popover is still open and the page was never left.
      expect(screen.getByRole('dialog', { name: 'Appearance' })).toBeInTheDocument();

      // And it went through the one store, not a private copy.
      expect(JSON.parse(localStorage.getItem('k_prefs')).accent).toBe('crimson');
    },
  );

  it('drives a non-colour setting onto the root too', async () => {
    const user = userEvent.setup();
    mountAt('/graha');

    await user.click(trigger());
    const pop = screen.getByRole('dialog', { name: 'Appearance' });

    expect(DEFAULTS.density).toBe('cozy');
    await user.click(within(pop).getByRole('radio', { name: 'Compact' }));

    expect(document.documentElement.getAttribute('data-density')).toBe('compact');
  });

  it('closes on Escape and puts focus back on the trigger', async () => {
    const user = userEvent.setup();
    mountAt('/vetana');

    await user.click(trigger());
    expect(screen.getByRole('dialog', { name: 'Appearance' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Appearance' })).toBeNull();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    // FocusTrap restores to whatever was focused before it mounted — the
    // button the user pressed. Without this a keyboard user is dropped at
    // <body> and has to tab back through the whole bar.
    expect(document.activeElement).toBe(trigger());
  });

  it('closes on an outside press, and a press on the trigger does not re-open it', async () => {
    const user = userEvent.setup();
    mountAt('/graha');

    await user.click(trigger());
    expect(screen.getByRole('dialog', { name: 'Appearance' })).toBeInTheDocument();

    // mousedown, because that is the event the dismissal listens for — a
    // `click` listener fires after the target has handled its own mousedown.
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog', { name: 'Appearance' })).toBeNull();

    // The trigger lives INSIDE the dismissal ref, so pressing it while open is
    // a toggle rather than dismiss-then-reopen. Press it twice: open, closed.
    await user.click(trigger());
    expect(screen.getByRole('dialog', { name: 'Appearance' })).toBeInTheDocument();
    await user.click(trigger());
    expect(screen.queryByRole('dialog', { name: 'Appearance' })).toBeNull();
  });

  it('is a keyboard-operable button with an accessible name, not a div', async () => {
    const user = userEvent.setup();
    mountAt('/vetana');

    const btn = trigger();
    expect(btn.tagName).toBe('BUTTON');
    expect(btn).toHaveAttribute('aria-haspopup', 'dialog');

    btn.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Appearance' })).toBeInTheDocument();
  });
});
