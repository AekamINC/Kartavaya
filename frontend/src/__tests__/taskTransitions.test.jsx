/**
 * The task state machine on the client, and the switch that arms it.
 *
 * TWO THINGS ARE UNDER TEST AND THEY ARE ONE FEATURE:
 *
 *  1. `pages/approvals/transitions.js` — the mirror of
 *     `backend/services/task_transitions.py`. Its job is to stop the UI
 *     offering a status the server refuses. The cross-language check that the
 *     two lists agree lives on the PYTHON side
 *     (`test_task_transitions.py::TestVocabulary`), because that is where the
 *     authority is; what is checked here is that the mirror says the same thing
 *     about `rejected` and `requested` that the server does.
 *
 *  2. `pages/approvals/PolicyPanel.jsx` — the control that sets
 *     `teams.requires_approval`. Without it the gate is a column nobody can
 *     turn on, which is precisely what `tasks.requires_approval` already was:
 *     read by four code paths, written by none, unreachable from any screen.
 *
 * THE STATE THAT MATTERS MOST IS `available:false`. There is one database and
 * production writes to it, so migration 117 is written and NOT applied — unapplied
 * is the state this panel ships in. It must render no switch at all and name the
 * migration. A switch that flips and changes nothing would be a worse lie than
 * the column it replaces, because someone would believe it.
 *
 * `createRoot` + `act` rather than @testing-library/react: that is the house
 * pattern (orgSenders.test.jsx, orgSettingsTabs.test.jsx) and RTL is NOT
 * installed — its @testing-library/dom peer is missing, so importing it throws.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ToastProvider } from '../components/ui/toast';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let getPayload;
let patchBehaviour;
const patches = [];

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(() => (getPayload instanceof Error
      ? Promise.reject(getPayload)
      : Promise.resolve({ data: getPayload }))),
    patch: vi.fn((url, payload) => {
      patches.push({ url, payload });
      return patchBehaviour instanceof Error
        ? Promise.reject(patchBehaviour)
        : Promise.resolve({ data: payload });
    }),
  },
  body: (r) => r?.data ?? {},
  rows: (r) => (Array.isArray(r?.data) ? r.data : []),
}));

const {
  TASK_STATUSES, LINE, SETTABLE_STATUSES, GATED_STATUS,
  isSettableStatus, needsApproval,
} = await import('../pages/approvals/transitions');
const { default: PolicyPanel } = await import('../pages/approvals/PolicyPanel');

const two = (overrides = {}) => ({
  available: true,
  projects: [
    { team_id: 'team_a', name: 'Aekam Inc', requires_approval: false },
    { team_id: 'team_b', name: 'Keval To Do', requires_approval: true },
  ],
  ...overrides,
});

let container;
let root;

const settle = async (ms = 0) => {
  await act(async () => { await new Promise(r => setTimeout(r, ms)); });
};

/** Poll rather than sleep a fixed span — these run beside other suites. */
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
    root.render(<ToastProvider><PolicyPanel /></ToastProvider>);
  });
  await settle();
};

const switches = () => [...container.querySelectorAll('[role="switch"]')];
const text = () => container.textContent || '';

beforeEach(() => {
  getPayload = two();
  patchBehaviour = null;
  patches.length = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.clearAllMocks();
});


// ── The mirror ───────────────────────────────────────────────────────────────

describe('the status vocabulary the client offers', () => {
  it('has five statuses and rejected is not one of them', () => {
    expect(TASK_STATUSES).toEqual(['todo', 'in_progress', 'in_review', 'done', 'requested']);
    expect(TASK_STATUSES).not.toContain('rejected');
  });

  it('never offers requested as something a person can pick', () => {
    // A task in `requested` is a client's ASK, not a task. Declining the ask
    // deletes the row, so a task hand-set to that status becomes deletable by
    // an approval decision that has nothing to do with it.
    expect(SETTABLE_STATUSES).toEqual(LINE);
    expect(isSettableStatus('requested')).toBe(false);
    expect(isSettableStatus('rejected')).toBe(false);
  });

  it('offers every pipeline status', () => {
    for (const s of ['todo', 'in_progress', 'in_review', 'done']) {
      expect(isSettableStatus(s)).toBe(true);
    }
  });

  it('gates the destination, not one edge', () => {
    // todo -> done skips the review just as thoroughly as in_review -> done.
    expect(needsApproval('todo', 'done')).toBe(true);
    expect(needsApproval('in_progress', 'done')).toBe(true);
    expect(needsApproval('in_review', 'done')).toBe(true);
    expect(GATED_STATUS).toBe('done');
  });

  it('leaves everything below done alone, including reopening', () => {
    expect(needsApproval('todo', 'in_progress')).toBe(false);
    expect(needsApproval('in_progress', 'in_review')).toBe(false);
    expect(needsApproval('in_review', 'in_progress')).toBe(false);
    expect(needsApproval('done', 'todo')).toBe(false);
    expect(needsApproval('done', 'done')).toBe(false);
  });
});


// ── The panel ────────────────────────────────────────────────────────────────

describe('PolicyPanel', () => {
  it('renders one switch per project, reflecting the stored setting', async () => {
    await mount();
    await until(() => expect(switches()).toHaveLength(2));
    expect(switches()[0].getAttribute('aria-checked')).toBe('false');
    expect(switches()[1].getAttribute('aria-checked')).toBe('true');
    expect(text()).toContain('Aekam Inc');
    expect(text()).toContain('Keval To Do');
  });

  it('says what the switch actually does', async () => {
    await mount();
    await until(() => expect(text()).toMatch(/only a project owner or admin/i));
    expect(text()).toMatch(/To do, In progress\s+and In review are unaffected/i);
  });

  it('renders NO switch and names the migration when 117 is not applied', async () => {
    // The state this ships in. A dead toggle here would be a worse lie than the
    // column it replaces.
    getPayload = two({ available: false, projects: [] });
    await mount();
    await until(() => expect(text()).toContain('117_project_requires_approval.sql'));
    expect(switches()).toHaveLength(0);
    expect(text()).toMatch(/not switched on for this database yet/i);
  });

  it('does not render a switch on an unapplied migration even if projects come back', async () => {
    getPayload = two({ available: false });
    await mount();
    await until(() => expect(text()).toContain('117_project_requires_approval.sql'));
    expect(switches()).toHaveLength(0);
  });

  it('shows a failed load as a failure, never as "nothing requires approval"', async () => {
    const err = new Error('boom');
    err.response = { status: 500 };
    getPayload = err;
    await mount();
    await until(() => expect(text()).toMatch(/broke on our side/i));
    expect(switches()).toHaveLength(0);
    expect(text()).not.toMatch(/anyone on the project can mark/i);
  });

  it('sends the change to the project it was made on', async () => {
    await mount();
    await until(() => expect(switches()).toHaveLength(2));
    await act(async () => { switches()[0].click(); });
    await settle();
    expect(patches).toHaveLength(1);
    expect(patches[0].url).toBe('/approvals/policy/team_a');
    expect(patches[0].payload).toEqual({ requires_approval: true });
    expect(switches()[0].getAttribute('aria-checked')).toBe('true');
  });

  it('turns the requirement back off', async () => {
    await mount();
    await until(() => expect(switches()).toHaveLength(2));
    await act(async () => { switches()[1].click(); });
    await settle();
    expect(patches[0].url).toBe('/approvals/policy/team_b');
    expect(patches[0].payload).toEqual({ requires_approval: false });
  });

  it('puts the switch back when the server refuses', async () => {
    // Optimism without rollback is how a screen ends up disagreeing with the
    // database it is describing.
    const err = new Error('nope');
    err.response = { status: 403, data: { detail: 'Only a project owner or admin can change the approval requirement.' } };
    patchBehaviour = err;
    await mount();
    await until(() => expect(switches()).toHaveLength(2));
    await act(async () => { switches()[0].click(); });
    await settle(30);
    await until(() => expect(switches()[0].getAttribute('aria-checked')).toBe('false'));
  });

  it('shows the server sentence verbatim rather than a generic failure', async () => {
    const detail = 'Only a project owner or admin can change the approval requirement.';
    const err = new Error('nope');
    err.response = { status: 403, data: { detail } };
    patchBehaviour = err;
    await mount();
    await until(() => expect(switches()).toHaveLength(2));
    await act(async () => { switches()[0].click(); });
    await settle(30);
    await until(() => expect(document.body.textContent).toContain(detail));
  });

  it('explains an empty list instead of implying no project is gated', async () => {
    getPayload = two({ projects: [] });
    await mount();
    await until(() => expect(text()).toMatch(/owner or admin of a project/i));
    expect(switches()).toHaveLength(0);
  });
});
