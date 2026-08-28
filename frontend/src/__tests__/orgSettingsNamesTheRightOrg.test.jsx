/**
 * The Organisation hub names the company the SERVER resolved — not the first
 * org role that happens to be on the user object.
 *
 * ── The incident this closes ────────────────────────────────────────────────
 *
 * On 2026-08-28 an automated run renamed **Aekam Inc** — the one organisation
 * proposal 93 guarantees is untouched — while believing it was editing Unicode
 * Group, and wrote a UPI row into it. The save genuinely succeeded, so the run
 * went green. The screen was not silent about which company was being edited;
 * it was WRONG, which is worse, because a wrong label is trusted.
 *
 * The lede read `org_name` off `user.org_roles.find(...)`. That is not the org
 * a write lands in, and three separate ways it can differ are all live today:
 *
 *   · a person with seats in several orgs gets whichever role sorts first
 *     (the account that found this holds org_admin in three);
 *   · the org switcher sends `X-Org-Id` and never touches `org_roles`;
 *   · platform staff resolve through `platform_bypass` into somebody else's
 *     organisation entirely — which is exactly what happened.
 *
 * `GET /v1/org/profile` and the `PATCH` the Profile tab sends are resolved by
 * the SAME `get_org_id` dependency, so a name taken from that response cannot
 * disagree with where the save lands.
 *
 * ── Why the mock says two different things ──────────────────────────────────
 *
 * `currentUser()` returns a role on **Aekam Inc** while `/v1/org/profile`
 * answers **Unicode Group**. That is the incident's exact shape, and the
 * assertion is that the heading shows the one the server named.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui/toast';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(url => {
      if (url === '/v1/org/members') return Promise.resolve({ data: [] });
      if (url === '/v1/org/invites') return Promise.resolve({ data: [] });
      if (url === '/v1/subscription/current') return Promise.resolve({ data: { active_modules: [] } });
      // The server's answer — the org this session actually resolves to.
      if (url === '/v1/org/profile') {
        return Promise.resolve({ data: { id: 'fae87907-2f99-4b35-a241-c94d9e1e4a17', name: 'Unicode Group' } });
      }
      return Promise.resolve({ data: {} });
    }),
    put: vi.fn(() => Promise.resolve({ data: {} })),
    post: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));

// The token's view: a role on a DIFFERENT organisation from the one above.
vi.mock('../lib/auth', () => ({
  currentUser: () => ({ user_id: 'u1', org_roles: [{ role_code: 'org_owner', org_name: 'Aekam Inc' }] }),
}));

const { default: OrgSettingsPage } = await import('../pages/OrgSettingsPage');

let container;
let root;

const settle = async (ms = 0) => {
  await act(async () => { await new Promise(r => setTimeout(r, ms)); });
};

const until = async (check, timeout = 3000) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    try { check(); return; } catch (err) {
      if (Date.now() > deadline) throw err;
      await settle(15);
    }
  }
};

const draw = async () => {
  await act(async () => {
    root.render(<ToastProvider><MemoryRouter><OrgSettingsPage /></MemoryRouter></ToastProvider>);
  });
  await settle();
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe('Organisation hub — which company am I editing', () => {
  it('names the org the server resolved, not the first role on the user', async () => {
    await draw();
    await until(() => {
      expect(container.textContent).toContain('Unicode Group');
    });
  });

  it('does NOT show the org from the user token once the server has answered', async () => {
    // The failing case, stated as its own assertion rather than as the absence
    // of the first: "Aekam Inc" on this screen is the bug report.
    await draw();
    await until(() => {
      expect(container.textContent).toContain('Unicode Group');
    });
    expect(container.textContent).not.toContain('Aekam Inc');
  });

  it('renders the org NAME and never its id', async () => {
    // `check-rendered-ids.mjs` is the static half of this rule; a UUID is also
    // not what tells a person they are in the wrong company.
    await draw();
    await until(() => {
      expect(container.textContent).toContain('Unicode Group');
    });
    expect(container.textContent).not.toContain('fae87907');
  });
});
