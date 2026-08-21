/**
 * WHAT THE CLIENT OFFERS AS A TASK STATUS.
 *
 * `taskTransitions.test.jsx` has a describe block titled "the status vocabulary
 * the client offers". It proves things about `pages/approvals/transitions.js` —
 * and MEASURED across `src/` at the time this file was written, every symbol it
 * tested (`TASK_STATUSES`, `SETTABLE_STATUSES`, `isSettableStatus`,
 * `needsApproval`) was imported by exactly two files: transitions.js itself and
 * that test. The single export that escaped was `GATED_STATUS`, into
 * PolicyPanel, to render the word "Done".
 *
 * So the mirror was correct and wired to nothing, and the components that
 * actually offered a status built their menus somewhere else:
 *
 *   BulkBar.jsx     `Object.entries(STATUS_LABELS)` — all SIX keys, including
 *                   `rejected` and `requested`, straight into
 *                   `patchAll({status: id})`.
 *   DrawerMeta.jsx  a hand-written array of THREE, missing `in_review`.
 *
 * Two menus, three vocabularies, none of them the state machine's. This file
 * tests the thing the other one is named after: not what transitions.js says,
 * but what a person can actually pick.
 *
 * WHY BOTH A MOUNT AND A SOURCE SCAN. The mount is the real evidence — it opens
 * the menu and reads the rows. The scan generalises it: a THIRD status menu
 * added next month gets no mount test from this file, but enumerating the label
 * map to build a writer is the specific mistake that produced both bugs above,
 * and that is catchable everywhere at once.
 *
 * `createRoot` + `act`, not @testing-library/react — the house pattern; RTL's
 * @testing-library/dom peer is not installed and importing it throws.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(() => Promise.resolve({ data: {} })),
    patch: vi.fn(() => Promise.resolve({ data: { results: [] } })),
    delete: vi.fn(() => Promise.resolve({ data: { results: [] } })),
  },
  body: (r) => r?.data ?? {},
  rows: (r) => (Array.isArray(r?.data) ? r.data : []),
}));

const { ToastProvider } = await import('../components/ui/toast');
const { default: BulkBar } = await import('../components/views/BulkBar');
const { SETTABLE_STATUSES, TASK_STATUSES } = await import('../pages/approvals/transitions');
const { STATUS_LABELS } = await import('../lib/statusColors');

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let container;
let root;

const settle = async () => { await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  // The Menu portals onto document.body; an unmounted test must not leave rows
  // behind for the next one to read.
  document.querySelectorAll('[role="menu"]').forEach(n => n.remove());
  vi.clearAllMocks();
});


// ── The menu a person actually opens ─────────────────────────────────────────

describe('the "Set status" menu on the selection bar', () => {
  const openStatusMenu = async () => {
    await act(async () => {
      root.render(
        <ToastProvider>
          <BulkBar ids={['task_a', 'task_b']} columns={[]} teamMembers={[]} />
        </ToastProvider>,
      );
    });
    await settle();
    const trigger = [...container.querySelectorAll('[role="button"]')]
      .find(n => n.getAttribute('aria-label') === 'Set status');
    expect(trigger, 'the bar renders a Set status trigger').toBeTruthy();
    await act(async () => { trigger.click(); });
    await settle();
    const menu = document.querySelector('[role="menu"]');
    expect(menu, 'the menu opened').toBeTruthy();
    return [...menu.querySelectorAll('[role="menuitem"]')].map(n => n.textContent.trim());
  };

  it('offers exactly the four statuses the server accepts', async () => {
    const labels = await openStatusMenu();
    expect(labels).toEqual(SETTABLE_STATUSES.map(s => STATUS_LABELS[s]));
    expect(labels).toEqual(['To do', 'In progress', 'In review', 'Done']);
  });

  it('never offers Requested — declining a request DELETEs the row', async () => {
    // server.py review_approval: DELETE FROM tasks WHERE task_id=$1 AND
    // status='requested'. A task bulk-set to that status is destroyed by an
    // approval decision that has nothing to do with it.
    const labels = await openStatusMenu();
    expect(labels).not.toContain(STATUS_LABELS.requested);
  });

  it('never offers Declined — it is not a task status at all', async () => {
    // Only `approval_status` is ever 'rejected'. No backend path writes the task
    // value and nothing reads it, so a task set to it falls out of the
    // vocabulary every board query and colour map speaks.
    const labels = await openStatusMenu();
    expect(labels).not.toContain(STATUS_LABELS.rejected);
    expect(TASK_STATUSES).not.toContain('rejected');
  });
});


// ── The generalisation ───────────────────────────────────────────────────────

/** Every .js/.jsx under src/, minus tests and node_modules. */
function sourceFiles(dir = SRC, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      sourceFiles(full, out);
    } else if (/\.jsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const rel = f => path.relative(SRC, f).split(path.sep).join('/');

describe('no component builds a status WRITER out of the label map', () => {
  /**
   * Files allowed to enumerate STATUS_LABELS, each with the reason.
   *
   * The distinction is WRITE vs READ. STATUS_LABELS must keep all six keys —
   * a row already carrying `requested` has to render as "Requested" and not as
   * a raw enum, and the filter builder has to be able to FIND those rows. What
   * none of them may do is offer a sixth value as something to set.
   */
  const MAY_ENUMERATE = {
    'components/views/FilterBuilder.jsx':
      'filter options — reads rows, never writes one; a status you cannot set can still exist',
  };

  it('only the filter builder enumerates it, and it does not write', () => {
    // MATCHED ON THE IMPORT, NOT ON THE NAME.
    //
    // This used to flag any file containing `Object.entries(STATUS_LABELS)`,
    // whatever that identifier referred to. `pages/manav/DscTab.jsx` declares
    // its OWN `STATUS_LABELS` — usable / not-in-possession / not-yet-valid /
    // expired / revoked, the states of a digital signature TOKEN — and reads it
    // to render a zero-filled count strip. It shares a name with the task
    // status map and nothing else, and it went red for it.
    //
    // The rule this file exists to enforce is about THE label map in
    // `lib/statusColors`: no component may build a status WRITER out of it. A
    // local constant that happens to share the identifier is not that map, and
    // flagging it teaches the next reader that the gate cries wolf. So the file
    // must actually import the shared name before its enumeration counts —
    // which is stricter about WHAT it means and unchanged about what it forbids.
    const importsSharedMap = src =>
      /import\s*\{[^}]*STATUS_LABELS[^}]*\}\s*from\s*['"][^'"]*statusColors['"]/
        .test(src);

    const enumerating = sourceFiles()
      .filter((f) => {
        const src = fs.readFileSync(f, 'utf8');
        return importsSharedMap(src)
          && /Object\.(entries|keys|values)\(\s*STATUS_LABELS|\.\.\.STATUS_LABELS/.test(src);
      })
      .map(rel);

    for (const f of enumerating) {
      expect(
        Object.keys(MAY_ENUMERATE),
        `${f} enumerates STATUS_LABELS. If it writes a status, build the menu from `
        + 'SETTABLE_STATUSES in pages/approvals/transitions.js; if it only reads, '
        + 'add it to MAY_ENUMERATE with the reason.',
      ).toContain(f);
    }
  });

  it('nothing that enumerates it also patches a status', () => {
    // The allowlist is not a permanent excuse: a file on it that grows a write
    // is the original bug wearing an exemption.
    for (const f of Object.keys(MAY_ENUMERATE)) {
      const src = fs.readFileSync(path.join(SRC, f), 'utf8');
      expect(/status:\s*(id|s|key|v|next)\b/.test(src), `${f} now writes a status`).toBe(false);
    }
  });

  it('every status menu is built from the state machine', () => {
    // The two that offer one today. Named explicitly rather than sniffed: a
    // regex that guesses which files are "menus" would go quiet the moment one
    // is renamed, and quiet is the failure mode this whole file exists for.
    for (const f of ['components/views/BulkBar.jsx', 'components/drawer/DrawerMeta.jsx']) {
      const src = fs.readFileSync(path.join(SRC, f), 'utf8');
      expect(src, `${f} must take its status vocabulary from transitions.js`)
        .toMatch(/SETTABLE_STATUSES/);
    }
  });
});
