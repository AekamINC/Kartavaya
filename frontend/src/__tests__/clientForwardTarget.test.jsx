/**
 * WHO A TASK CAN BE FORWARDED TO.
 *
 * The server-side finding: both client-approval forward paths resolved their
 * target with a bare `SELECT … FROM users WHERE email=$1` — the whole users
 * table, no org, no project, no `role='client'` — and then wrote a
 * `task_clients` row, which conferred READ AND WRITE on the task
 * (`server.update_task` falls back to `client_can_access_task`), emailed the
 * task's title, and issued a 7-day approval JWT. Any account at any other firm
 * could be handed any task. That is fixed on the server, in
 * `services/task_actor.assert_client_of_project`, and that is where it had to
 * be fixed: the endpoint is the boundary.
 *
 * THIS FILE IS ABOUT THE OTHER HALF. The UI was already correct — it offers a
 * closed `<select>` built from `GET /api/teams/{team_id}/clients` — and being
 * already correct is exactly why nobody noticed the server was not. So the
 * property worth pinning is not "the dropdown works today", it is "no free-text
 * email target can be introduced here later without this test going red".
 *
 * A source scan as well as a mount, for the reason `statusMenus.test.jsx` gives:
 * the mount is the real evidence, and the scan generalises it to the next
 * component somebody adds.
 *
 * `createRoot` + `act`, not @testing-library/react — the house pattern.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { ApproveModal } = await import('../pages/approvals/ApprovalModals');

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APPROVALS_DIR = path.join(SRC, 'pages', 'approvals');

const CLIENTS = [
  { user_id: 'user_client001', display_name: 'Acme Ltd', email: 'client@acme.test' },
  { user_id: 'user_client002', display_name: 'Beta LLP', email: 'ops@beta.test' },
];

let container;
let root;
const settle = async () => { await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };

const renderModal = async (clients) => {
  await act(async () => {
    root.render(
      <ApproveModal
        open
        onClose={() => {}}
        notes=""
        setNotes={() => {}}
        clients={clients}
        clientUserId=""
        setClientUserId={() => {}}
        onConfirm={() => {}}
      />,
    );
  });
  await settle();
  // Modal portals onto document.body.
  return document.querySelector('[data-testid="approve-modal"]') || document.body;
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  document.querySelectorAll('[data-testid="approve-modal"]').forEach(n => n.remove());
  vi.clearAllMocks();
});


describe('the client the approval is forwarded to', () => {
  it('is chosen from a closed list, not typed', async () => {
    const scope = await renderModal(CLIENTS);
    const select = scope.querySelector('select');
    expect(select, 'the target is a <select>').toBeTruthy();

    const values = [...select.querySelectorAll('option')].map(o => o.value);
    // The empty option is "skip client approval" — a real choice, not a target.
    expect(values.filter(Boolean).sort()).toEqual(['user_client001', 'user_client002']);
  });

  it('offers no way to name a target the server did not', async () => {
    const scope = await renderModal(CLIENTS);
    const typeable = [...scope.querySelectorAll('input')].filter(
      n => !['checkbox', 'radio', 'button', 'submit'].includes((n.type || '').toLowerCase()),
    );
    expect(
      typeable.map(n => n.type || n.name || n.id),
      'a free-text field here is a free-text forward target',
    ).toEqual([]);
  });

  it('tells the reviewer what to do when the project has no clients', async () => {
    // This is now the ONLY route to a client — the server refuses anyone not on
    // this project's client list — so an empty state that only reports
    // emptiness leaves a reviewer with a dead end.
    const scope = await renderModal([]);
    expect(scope.querySelector('select')).toBeNull();
    const copy = scope.textContent;
    expect(copy).toMatch(/no clients on this project/i);
    expect(copy, 'the empty state says what to do next').toMatch(/add one as a client/i);
  });
});


describe('the approvals surface, swept', () => {
  const files = fs.readdirSync(APPROVALS_DIR).filter(f => f.endsWith('.jsx'));

  it('has approvals components to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s builds no forward target from free text', (file) => {
    const src = fs.readFileSync(path.join(APPROVALS_DIR, file), 'utf8');
    // An email-shaped input in this directory would be a second way to name a
    // forward target, and the first one is a closed list for a reason.
    expect(src, `${file} introduces a typed email target`).not.toMatch(/type=["']email["']/);
    // `client_email` is the wire field. It must be derived from the selected
    // row (ApprovalsPage does `clientList.find(...).email`), never assembled in
    // a presentational component from something a person typed.
    expect(src, `${file} assembles client_email itself`).not.toMatch(/client_email\s*:/);
  });
});
