/**
 * TabRecycleBin — the screen where one button is reversible and one is not.
 *
 * `routers/recycle_bin.py` and migration 239 shipped with no caller at all.
 * What this suite holds the caller to is the three things a bin can get wrong
 * in a way nobody notices until a customer has lost a file:
 *
 *   1 · **The two stages must be told apart IN WORDS.** `DELETE
 *       /v1/recycle-bin/{id}` is one verb with two outcomes, decided by the
 *       row's stage on the server. A screen that renders both stages the same
 *       way, distinguished by a chip, offers the reader one button that moves a
 *       file and one that erases it, and no sentence saying which is which.
 *   2 · **The irreversible one asks for the file's name typed.** Everything
 *       else on this screen is undoable; this one is not, and `ConfirmDialog`
 *       has carried `confirmText` for exactly this since 02 §3.
 *   3 · **No user id is ever drawn — and none is even sent.** These tests
 *       were written against a router that returned `deleted_by` as a raw
 *       `users.user_id` and left the screen to resolve it against the member
 *       list. That was fixed at the ROUTER (`services/recycle_bin.list_bin`
 *       now LEFT JOINs `public.users` for `deleted_by_name`), because the
 *       lookup missed anybody who had left the org and put an id in the
 *       browser where `check-rendered-ids.mjs` cannot see it — that ratchet is
 *       positional and reads what a component DRAWS, so an id behind
 *       `whoDeleted(row)` is invisible to it.
 *
 *       So the fixtures below send `deleted_by_name` and NO `deleted_by`, and
 *       one of them asserts the id is absent from the payload entirely. A test
 *       still describing the old shape would pass while the screen read a
 *       field the server had stopped sending.
 *
 * `createRoot` + `act` rather than @testing-library/react, which is the house
 * pattern (see `tabStorage.test.jsx` beside this file) and is NOT usable here —
 * its @testing-library/dom peer resolution is the reason the org suites do it
 * this way.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ToastProvider } from '../../../components/ui/toast';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** The real shape of `users.user_id`. Neither of these may reach the screen. */
const DELETER_ID = 'user_a1b2c3d4e5f6';
/** A deleter who is NOT in the member list — they left, or it was platform
 *  staff. The case where a `name || id` fallback would fire. */
const GHOST_ID = 'user_f1a0a472b98f';

const BIN_1 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const BIN_2 = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
const daysHence = (n) => new Date(Date.now() + n * 86400000).toISOString();

/** Stage 1 — deleted three days ago. Delete here destroys nothing. */
const STAGE1 = {
  id: BIN_1,
  source_kind: 'task_attachment',
  source_id: 'task_01M0PD8DD09QVSEPMHQ7M6RN91',
  file_name: 'Statutory-audit-checklist.pdf',
  r2_key: 'org/64e7bea6-6abe-490c-a2a4-27a60c6be916/projects/team_9/checklist.pdf',
  file_url: 'https://files.example/checklist.pdf',
  size_bytes: 20182,
  deleted_by_name: 'Priya Nair',
  deleted_at: daysAgo(3),
  stage2_at: null,
  restored_at: null,
  purged_at: null,
  stage: 1,
  leaves_stage1_at: daysHence(11),
  purges_at: daysHence(87),
};

/** Stage 2 — deleted twenty days ago. Delete here ERASES the object. */
const STAGE2 = {
  id: BIN_2,
  source_kind: 'graha_document',
  source_id: '11111111-2222-3333-4444-555555555555',
  file_name: 'Unicode-Group-supply-agreement.pdf',
  r2_key: 'org/64e7bea6-6abe-490c-a2a4-27a60c6be916/crm/client_4/agreement.pdf',
  file_url: 'https://files.example/agreement.pdf',
  size_bytes: 1048576,
  deleted_by_name: 'No longer on file',
  deleted_at: daysAgo(20),
  stage2_at: null,
  restored_at: null,
  purged_at: null,
  stage: 2,
  leaves_stage1_at: daysAgo(6),
  purges_at: daysHence(70),
};

/** The server's own sentence about the quota, which the screen must not
 *  re-word — `recycle_bin.py list_bin` sends it so the bin and the Storage tab
 *  cannot end up explaining one rule two ways. */
const QUOTA_NOTE =
  'Files in the recycle bin still count towards your storage. '
  + 'The space comes back when a file is deleted permanently.';

const ENVELOPE = (rows) => ({
  data: rows,
  stage1_days: 14,
  purge_days: 90,
  quota_note: QUOTA_NOTE,
});

/** ⚠ THERE IS NO MEMBER-LIST MOCK, AND ITS ABSENCE IS AN ASSERTION.
 *
 *  The screen used to call `GET /v1/org/members` to turn an actor id into a
 *  name. It does not any more — the router resolves it. If that lookup is ever
 *  reintroduced, the mock below answers the bin envelope for EVERY url, so the
 *  member call would receive a bin payload and the actor column would break
 *  loudly rather than quietly regrow a client-side dependency. */

let binPayload = ENVELOPE([STAGE1, STAGE2]);

vi.mock('../../../lib/api', () => ({
  api: {
    get: vi.fn(() => (binPayload instanceof Error
      ? Promise.reject(binPayload)
      : Promise.resolve({ data: binPayload }))),
    post: vi.fn(() => Promise.resolve({ data: { ok: true, restored: 'a file' } })),
    delete: vi.fn(() => Promise.resolve({ data: { ok: true, stage: 2, purged: false } })),
  },
  rows: (r) => {
    const b = r?.data;
    if (Array.isArray(b)) return b;
    if (Array.isArray(b?.data)) return b.data;
    return [];
  },
}));

const { default: TabRecycleBin } = await import('../TabRecycleBin');
const { api } = await import('../../../lib/api');

let container;
let root;

const settle = async (ms = 0) => {
  await act(async () => { await new Promise(r => setTimeout(r, ms)); });
};

const until = async (check, timeout = 3000) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    try { return check(); } catch (err) {
      if (Date.now() > deadline) throw err;
      await settle(15);
    }
  }
};

const mount = async () => {
  await act(async () => {
    root.render(<ToastProvider><TabRecycleBin /></ToastProvider>);
  });
  await settle();
};

const text = () => document.body.textContent;
const click = async (el) => { await act(async () => { el.click(); }); await settle(); };

/** Buttons in the TABLE, never the dialog's — both carry the same words. */
const rowButtons = () =>
  [...container.querySelectorAll('button')].filter(b => !b.closest('.modal__foot'));
const rowButton = (label) =>
  rowButtons().find(b => b.textContent.trim() === label);

/** The dialog's confirm button — the last one in its footer. */
const confirmButton = () =>
  [...document.querySelectorAll('.modal__foot button')].pop();

/** Type into ConfirmDialog's typed-confirmation box the way React hears it. */
const typeConfirmation = async (value) => {
  const input = document.querySelector('.cd__type input');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
};

beforeEach(() => {
  binPayload = ENVELOPE([STAGE1, STAGE2]);
  api.get.mockClear();
  api.post.mockClear();
  api.delete.mockClear();
  api.post.mockResolvedValue({ data: { ok: true, restored: 'a file' } });
  api.delete.mockResolvedValue({ data: { ok: true, stage: 2, purged: false } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  document.body.innerHTML = '';
});

describe('TabRecycleBin — the two stages', () => {
  it('calls the list route the router shipped with no caller', async () => {
    await mount();
    await until(() => {
      expect(api.get.mock.calls.map(c => c[0])).toContain('/v1/recycle-bin');
    });
  });

  it('draws both stages, each under its own heading and its own count', async () => {
    await mount();
    await until(() => expect(text()).toContain(STAGE1.file_name));
    expect(text()).toContain(STAGE2.file_name);
    expect(text()).toContain('Recycle bin · 1');
    expect(text()).toContain('Second-stage recycle bin · 1');
  });

  it('says IN WORDS what deleting does in each stage', async () => {
    await mount();
    await until(() => expect(text()).toContain(STAGE1.file_name));

    // Stage 1: the sentence a reader needs before pressing Delete is that it
    // destroys nothing. A chip cannot say this.
    expect(text()).toContain('destroys nothing');
    // Stage 2: and here, that it does.
    expect(text()).toContain('erases the file');
    expect(text()).toContain('Restore still works here');
  });

  it('names where each file came from in words, never as source_kind', async () => {
    await mount();
    await until(() => expect(text()).toContain('Task attachment'));
    expect(text()).toContain('CRM document');
    // The database enum is not a label.
    expect(text()).not.toContain('task_attachment');
    expect(text()).not.toContain('graha_document');
  });

  it('renders the server\'s quota note verbatim, rather than re-wording it', async () => {
    await mount();
    await until(() => expect(text()).toContain(QUOTA_NOTE));
  });
});

describe('TabRecycleBin — no id is ever drawn', () => {
  it('draws the deleter as a NAME, from the field the server resolved', async () => {
    await mount();
    await until(() => expect(text()).toContain('Priya Nair'));
    expect(text()).not.toContain(DELETER_ID);
  });

  it("draws the server's own phrase when the person is gone from users", async () => {
    // Not "unknown person" and not a blank: somebody deleted from
    // `public.users` entirely is a REAL case, and the server says so in words
    // rather than handing back an id for the screen to cope with.
    await mount();
    await until(() => expect(text()).toContain('No longer on file'));
    expect(text()).not.toContain(GHOST_ID);
  });

  it('draws a dash, never an id, when the row carries no name at all', async () => {
    // An older server that still sends `deleted_by` and no `deleted_by_name`.
    // The `||` fallback arm is exactly where an id gets drawn — the shape
    // `check-rendered-ids` was widened to catch on `graha/ApprovalsTab.jsx` —
    // so this pins that the arm is a dash and not `row.deleted_by`.
    binPayload = ENVELOPE([
      { ...STAGE1, deleted_by_name: undefined, deleted_by: DELETER_ID },
    ]);
    await mount();
    await until(() => expect(text()).toContain(STAGE1.file_name));
    expect(text()).not.toContain(DELETER_ID);
  });

  it('is not sent a user id at all — the contract, not just the rendering', async () => {
    // The strongest form of this rule: the id cannot be drawn because it never
    // arrives. `services/recycle_bin.list_bin` selects `deleted_by_name` and
    // does NOT select `deleted_by`, so a regression that reintroduced the id
    // to the payload would fail here before any component could mis-draw it.
    for (const row of [STAGE1, STAGE2]) {
      expect(Object.keys(row)).not.toContain('deleted_by');
      expect(row.deleted_by_name).toBeTruthy();
    }
  });

  it('never draws the R2 key, which carries the org id inside it', async () => {
    await mount();
    await until(() => expect(text()).toContain(STAGE1.file_name));
    expect(text()).not.toContain(STAGE1.r2_key);
    expect(text()).not.toContain('64e7bea6-6abe-490c-a2a4-27a60c6be916');
  });
});

describe('TabRecycleBin — restore', () => {
  it('is one click with no dialog, and hits that row\'s own endpoint', async () => {
    await mount();
    await until(() => expect(rowButton('Restore')).toBeTruthy());

    await click(rowButtons().find(b => b.textContent.trim() === 'Restore'));

    // No confirmation: nothing is destroyed and one click undoes it. Same
    // decision as `ProjectsPage.jsx:199`.
    expect(document.querySelector('.modal__panel')).toBeNull();
    expect(api.post).toHaveBeenCalledWith(`/v1/recycle-bin/${BIN_1}/restore`);
  });

  it('is offered in the SECOND stage too — a bin you cannot recover from is a delay', async () => {
    binPayload = ENVELOPE([STAGE2]);
    await mount();
    await until(() => expect(rowButton('Restore')).toBeTruthy());

    await click(rowButton('Restore'));
    expect(api.post).toHaveBeenCalledWith(`/v1/recycle-bin/${BIN_2}/restore`);
  });

  it('reloads the list rather than trusting local optimism', async () => {
    await mount();
    await until(() => expect(rowButton('Restore')).toBeTruthy());
    const before = api.get.mock.calls.filter(c => c[0] === '/v1/recycle-bin').length;

    await click(rowButtons().find(b => b.textContent.trim() === 'Restore'));

    await until(() => {
      const after = api.get.mock.calls.filter(c => c[0] === '/v1/recycle-bin').length;
      expect(after).toBeGreaterThan(before);
    });
  });
});

describe('TabRecycleBin — deleting from stage 1', () => {
  it('asks first, and says the file is still recoverable', async () => {
    binPayload = ENVELOPE([STAGE1]);
    await mount();
    await until(() => expect(rowButton('Delete')).toBeTruthy());

    await click(rowButton('Delete'));

    expect(api.delete).not.toHaveBeenCalled();
    expect(text()).toContain('Move to the second-stage bin?');
    expect(text()).toContain('Nothing is destroyed');
  });

  it('does NOT demand a typed confirmation — nothing is destroyed here', async () => {
    binPayload = ENVELOPE([STAGE1]);
    await mount();
    await until(() => expect(rowButton('Delete')).toBeTruthy());
    await click(rowButton('Delete'));

    // A guard on a trivial act is how people learn to type past the guard on a
    // serious one — `TaskDrawer.jsx` records the same reasoning.
    expect(document.querySelector('.cd__type')).toBeNull();
    expect(confirmButton().disabled).toBe(false);

    await click(confirmButton());
    expect(api.delete).toHaveBeenCalledWith(`/v1/recycle-bin/${BIN_1}`);
  });
});

describe('TabRecycleBin — deleting from stage 2', () => {
  it('will not fire until the file\'s own name is typed', async () => {
    binPayload = ENVELOPE([STAGE2]);
    await mount();
    await until(() => expect(rowButton('Delete permanently')).toBeTruthy());

    await click(rowButton('Delete permanently'));

    // The dialog is open, it asks for typing, and the confirm button is inert.
    expect(document.querySelector('.cd__type')).toBeTruthy();
    expect(confirmButton().disabled).toBe(true);

    await click(confirmButton());
    expect(api.delete).not.toHaveBeenCalled();

    await typeConfirmation(STAGE2.file_name);
    expect(confirmButton().disabled).toBe(false);

    await click(confirmButton());
    expect(api.delete).toHaveBeenCalledWith(`/v1/recycle-bin/${BIN_2}`);
  });

  it('says the file is destroyed, not that it is "removed"', async () => {
    binPayload = ENVELOPE([STAGE2]);
    await mount();
    await until(() => expect(rowButton('Delete permanently')).toBeTruthy());
    await click(rowButton('Delete permanently'));

    expect(text()).toContain('Delete permanently?');
    expect(text()).toContain('erased from storage');
    expect(text()).toContain('cannot be undone');
  });

  it('is the ONLY control on the screen that asks for typing', async () => {
    await mount();
    await until(() => expect(rowButton('Restore')).toBeTruthy());

    // Restore: no dialog at all.
    await click(rowButtons().find(b => b.textContent.trim() === 'Restore'));
    expect(document.querySelector('.cd__type')).toBeNull();

    // Stage 1 delete: a dialog, but no typing.
    await click(rowButton('Delete'));
    expect(document.querySelector('.cd__type')).toBeNull();
  });
});

describe('TabRecycleBin — the states a bin spends most of its life in', () => {
  it('says the bin is empty IN WORDS, and what would be in it', async () => {
    binPayload = ENVELOPE([]);
    await mount();

    await until(() => expect(text()).toContain('The recycle bin is empty'));
    // 93 §1: an empty state is a sentence, not "No data". The two facts a
    // reader opening an empty bin needs are what lands here and for how long.
    expect(text()).toContain('task attachment');
    expect(text()).toContain('14 days');
    expect(text()).toContain('day 90');
    expect(text()).not.toContain('No data');
  });

  it('does NOT claim the bin is empty when the list simply failed to load', async () => {
    binPayload = new Error('boom');
    await mount();

    await until(() => expect(container.querySelector('.k-err')).toBeTruthy());
    // The failure mode being repaired: a swallowed rejection on THIS screen
    // tells a customer their deleted files are gone.
    expect(text()).not.toContain('The recycle bin is empty');
  });

  it('says so when one stage is empty and the other is not', async () => {
    binPayload = ENVELOPE([STAGE1]);
    await mount();
    await until(() => expect(text()).toContain(STAGE1.file_name));

    expect(text()).toContain('Second-stage recycle bin · 0');
    expect(text()).toContain('Nothing is in the second-stage bin');
  });
});
