/**
 * Raising a sensitive module to Approver or Admin must name what is being
 * handed over, before it is handed over.
 *
 * MEASURED BEFORE THE FIX: Organisation ▸ Members ▸ Edit access opens a Sheet
 * of GrantRows. Clicking `Approver` on the Vetana row and then `Save access`
 * issued `PUT /v1/org/members/{id}/modules` — two clicks, no confirmation, and
 * the API answered 200. The row does carry a SENSITIVE lock tag and the
 * separated-duty note, and neither is a confirmation: they are labels on a
 * control the operator has already decided to use. `ConfirmDialog` was wired to
 * member REMOVAL only, so the destructive action on the screen was guarded and
 * the privilege-granting one was not.
 *
 * Two halves, and the split is deliberate:
 *
 *   1. `sensitiveGrantRaises` is PURE and is held directly. The rule it encodes
 *      — that ANY change to approver or admin counts, not an increase in ladder
 *      position — is the one that is easy to get backwards, because on Vetana
 *      and Ganit approver sits BELOW admin in the ladder while being the greater
 *      authority. An index comparison reads admin → approver as a demotion and
 *      confirms nothing, which is exactly the move the separation is about.
 *   2. The wiring is asserted through the rendered Sheet, because a pure
 *      function nobody calls is the same as no confirmation at all.
 *
 * This screen NEVER enforces. The server refuses an org_admin granting approver
 * on vetana/ganit (`role_tiers.refuse_grant`) and audits every sensitive grant
 * change at `warn`. A test that asserted the dialog PREVENTS the grant would be
 * asserting the wrong thing, and is not written here.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const put = vi.fn(() => Promise.resolve({ data: {} }));
const get = vi.fn();

vi.mock('../lib/api', () => ({
  api: {
    get: (...a) => get(...a),
    put: (...a) => put(...a),
    post: vi.fn(() => Promise.resolve({ data: {} })),
    patch: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
  },
  rows: (r) => (Array.isArray(r?.data) ? r.data : []),
  body: (r) => r?.data ?? {},
}));

const {
  sensitiveGrantRaises, sensitiveGrantMessage, SENSITIVE_GRANT_CONSEQUENCE,
} = await import('../pages/org/catalogue');
const { ToastProvider } = await import('../components/ui');
const { default: TabMembers } = await import('../pages/org/TabMembers');

// ─────────────────────────────────────────────────────────────────────────────
// 1 · The rule, held directly
// ─────────────────────────────────────────────────────────────────────────────

describe('sensitiveGrantRaises', () => {
  it('catches a fresh approver grant on payroll', () => {
    const raises = sensitiveGrantRaises([], [{ code: 'vetana', level: 'approver' }]);
    expect(raises).toHaveLength(1);
    expect(raises[0].consequence).toMatch(/release payments/);
  });

  it('catches ADMIN → APPROVER on a separated-duty module', () => {
    // The one an index comparison gets wrong: approver is LOWER in the ladder
    // and is nonetheless the authority to release money.
    const raises = sensitiveGrantRaises(
      [{ code: 'vetana', level: 'admin' }],
      [{ code: 'vetana', level: 'approver' }],
    );
    expect(raises).toHaveLength(1);
    expect(raises[0].from).toBe('admin');
  });

  it('catches APPROVER → ADMIN as well', () => {
    const raises = sensitiveGrantRaises(
      [{ code: 'ganit', level: 'approver' }],
      [{ code: 'ganit', level: 'admin' }],
    );
    expect(raises).toHaveLength(1);
  });

  it('says nothing when the level is unchanged', () => {
    // Re-saving the sheet to change an unrelated checkbox must not nag. A
    // confirmation that fires on every save is one nobody reads.
    expect(sensitiveGrantRaises(
      [{ code: 'vetana', level: 'approver' }],
      [{ code: 'vetana', level: 'approver' }, { code: 'graha', level: 'editor' }],
    )).toEqual([]);
  });

  it('says nothing about viewer or editor on a sensitive module', () => {
    // Non-admin HR and books access is the ordinary case for anyone in an HR
    // team who is not the owner. This must not become a lock on the module.
    expect(sensitiveGrantRaises([], [
      { code: 'manav', level: 'viewer' },
      { code: 'ganit', level: 'editor' },
    ])).toEqual([]);
  });

  it('says nothing about admin on a module that is not sensitive', () => {
    expect(sensitiveGrantRaises([], [{ code: 'graha', level: 'admin' }])).toEqual([]);
  });

  it('does not confirm a REVOCATION', () => {
    // Taking access away is the safe direction.
    expect(sensitiveGrantRaises([{ code: 'vetana', level: 'admin' }], [])).toEqual([]);
  });

  it('reports every raise in one save, not just the first', () => {
    const raises = sensitiveGrantRaises([], [
      { code: 'vetana', level: 'approver' },
      { code: 'ganit', level: 'admin' },
      { code: 'manav', level: 'admin' },
    ]);
    expect(raises.map(r => r.code).sort()).toEqual(['ganit', 'manav', 'vetana']);
  });

  it('survives a member whose grants have never been loaded', () => {
    expect(sensitiveGrantRaises(undefined, undefined)).toEqual([]);
  });
});

describe('the sentence', () => {
  it('names the person, the module and what the level contains', () => {
    const raises = sensitiveGrantRaises([], [{ code: 'vetana', level: 'approver' }]);
    const msg = sensitiveGrantMessage('Priya Sharma', raises);
    expect(msg).toContain('Priya Sharma');
    expect(msg).toContain('Vetana');
    expect(msg).toContain('approve payroll runs and release payments');
  });

  it('never renders "undefined" for a member with no display name', () => {
    const raises = sensitiveGrantRaises([], [{ code: 'ganit', level: 'admin' }]);
    expect(sensitiveGrantMessage('', raises)).not.toMatch(/undefined/);
  });

  it('has a consequence sentence for every level it can confirm', () => {
    // A raise with no sentence would render "Vetana — Priya can undefined".
    for (const [code, byLevel] of Object.entries(SENSITIVE_GRANT_CONSEQUENCE)) {
      for (const level of ['approver', 'admin']) {
        expect(byLevel[level], `${code}:${level}`).toBeTruthy();
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 · The wiring
// ─────────────────────────────────────────────────────────────────────────────

const MEMBER = {
  user_id: 'u1',
  email: 'priya@example.com',
  full_name: 'Priya Sharma',
  role_code: 'org_member',
  module_grants: [{ code: 'graha', role: 'editor' }],
};

function route(url) {
  if (url.includes('/org/members')) return Promise.resolve({ data: [MEMBER] });
  if (url.includes('/org/invites')) return Promise.resolve({ data: [] });
  if (url.includes('/subscription/current')) {
    return Promise.resolve({ data: { active_modules: ['graha', 'vetana', 'ganit', 'manav'] } });
  }
  return Promise.resolve({ data: {} });
}

let host;
let root;

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <ToastProvider>
        <TabMembers />
      </ToastProvider>,
    );
  });
}

// Scoped to `document`, not `host`: ConfirmDialog and the Sheet portal out of
// the mount point, so a host-scoped query finds the trigger and never the
// dialog it opens.
const byText = (re, sel = 'button') =>
  [...document.querySelectorAll(sel)].find(n => re.test(n.textContent || ''));

const click = async (node, what = 'element') => {
  if (!node) throw new Error(`${what} not found`);
  await act(async () => {
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

/** Row actions collapse into a Menu, so Edit module grants is two clicks in. */
async function openGrantSheet() {
  await click(
    document.querySelector('[aria-haspopup="menu"]'),
    'the row actions menu',
  );
  await click(
    byText(/Edit module grants/i, '[role="menuitem"]'),
    'the Edit module grants item',
  );
}

/** Turn a module on and pick a level on its GrantRow. */
async function grant(code, level) {
  const label = { vetana: /Vetana/, ganit: /Ganit/, manav: /Manav/ }[code];
  const row = [...document.querySelectorAll('.ogr__r')]
    .find(r => label.test(r.textContent || ''));
  if (!row) throw new Error(`no GrantRow for ${code}`);
  // The shared Checkbox renders as `button[role=checkbox]`, not an input.
  await click(row.querySelector('[role="checkbox"]'), `${code} checkbox`);
  await click(
    [...row.querySelectorAll('button')]
      .find(b => new RegExp(`^${level}$`, 'i').test(b.textContent || '')),
    `${code} ${level} button`,
  );
}

describe('the member sheet', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    put.mockClear();
    get.mockReset();
    get.mockImplementation(route);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('saves a non-sensitive change with no confirmation at all', async () => {
    await mount();
    await openGrantSheet();
    await click(byText(/^Save access$/i), 'Save access');

    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('stops a Vetana approver grant on an alertdialog that names it', async () => {
    await mount();
    await openGrantSheet();
    await grant('vetana', 'Approver');
    await click(byText(/^Save access$/i), 'Save access');

    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog, 'the confirmation').toBeTruthy();
    expect(dialog.textContent).toMatch(/Priya Sharma/);
    expect(dialog.textContent).toMatch(/release payments/);
    // Nothing has been written yet — that is the whole point of the step.
    expect(put).not.toHaveBeenCalled();
  });

  it('writes the grant only after the confirm button', async () => {
    await mount();
    await openGrantSheet();
    await grant('vetana', 'Approver');
    await click(byText(/^Save access$/i), 'Save access');
    await click(byText(/^Grant access$/i), 'Grant access');

    expect(put).toHaveBeenCalledTimes(1);
    const [url, body] = put.mock.calls[0];
    expect(url).toContain('/v1/org/members/u1/modules');
    expect(body.modules).toEqual(
      expect.arrayContaining([{ code: 'vetana', role: 'approver' }]),
    );
  });

  it('writes nothing when the confirmation is cancelled', async () => {
    await mount();
    await openGrantSheet();
    await grant('vetana', 'Approver');
    await click(byText(/^Save access$/i), 'Save access');
    await click(byText(/^Cancel$/i), 'Cancel');

    expect(put).not.toHaveBeenCalled();
  });

  it('reuses the existing ConfirmDialog rather than a second one', async () => {
    // A second dialog would be a second copy of the focus-restore and
    // alertdialog-role fixes this one already carries.
    await mount();
    await openGrantSheet();
    await grant('vetana', 'Approver');
    await click(byText(/^Save access$/i), 'Save access');

    expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
  });
});
