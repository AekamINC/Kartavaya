/**
 * The client portal's leak tests.
 *
 * These now RUN. `vitest.config.js` was anchored at `src/__tests__/**`, so this
 * file was written, passing, and never executed by `npm test`; the glob is
 * `src/**\/__tests__/**\/*.test.{js,jsx,ts,tsx}` on this branch and it is picked
 * up. A test that does not run is not a test.
 *
 * ── What it locks
 *
 * Most assertions here are one of 19's never-see rules, tested against the real
 * payload shape the API returns today — which includes `assignee_names`,
 * `assignee_emails` and `estimated_minutes` on every task, and the firm's own
 * internal approval queue with staff emails on `/client/approvals`. The
 * filtering that keeps those off the screen lives in `clientShape.js`, and
 * these are the tests that say it works. Delete them only alongside a real
 * client serializer in the API.
 *
 * The rest lock the three fixes: the fluid left-aligned container, the two
 * prohibitions that survive the client role's promotion to collaborator (never
 * logs time, never deletes), and the path routes the portal is built for.
 *
 * Rendered with react-dom directly: @testing-library/react is installed but its
 * @testing-library/dom peer is not, so importing it throws — `pageHeader.test.jsx`
 * carries the same note and the same workaround.
 */
import React from 'react';
import { act } from 'react';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { api } from '../../../lib/api';
import { ToastProvider } from '../../../components/ui';
import { ClientProjectsPage, ClientProjectBoardPage, viewFromLocation } from '../../ClientPages';
import { sizeLabel } from '../clientShape';

/**
 * The stylesheet as text.
 *
 * Not `import ... from '.../client.css?raw'`: Vite's CSS plugin claims the
 * request before the raw loader sees it and hands back an empty string, so the
 * assertions below passed against nothing. And not `new URL(..., import.meta.url)`
 * either — `environmentOptions.jsdom.url` makes `import.meta.url` an http:// URL
 * that `fileURLToPath` rejects. Resolved from the run directory instead.
 */
const CLIENT_CSS = (() => {
  const here = ['src/styles/client.css', 'frontend/src/styles/client.css']
    .map(p => path.resolve(process.cwd(), p))
    .find(existsSync);
  if (!here) throw new Error('client.css not found from ' + process.cwd());
  return readFileSync(here, 'utf8');
})();

const ME = { user_id: 'u_me', full_name: 'Riya Patel', email: 'riya@acme.in', role: 'client' };

const TASKS = [
  { task_id: 'task_aaaaaabbbbbb', team_id: 't1', title: 'File GSTR-3B for June', description: 'Ready for sign-off',
    status: 'in_review', priority: 'high', approval_status: 'pending_client', created_by_user_id: 'u_staff',
    created_by_name: 'Aanya Mehta', assignee_user_ids: ['u_staff'], assignee_names: ['Aanya Mehta'],
    assignee_emails: ['aanya@firm.in'], estimated_minutes: 240, updated_at: '2026-07-24T10:00:00Z',
    created_at: '2026-07-20T10:00:00Z', due_at: '2026-08-02T10:00:00Z',
    attachments: [{ name: 'gstr3b.pdf', url: 'https://r2/gstr3b.pdf', is_private: false, visible_to: [] },
                  { name: 'internal-margin.xlsx', url: 'https://r2/margin.xlsx', is_private: true, visible_to: ['u_staff'] }] },
  { task_id: 'task_ccccccdddddd', team_id: 't1', title: 'Someone else work', status: 'todo',
    created_by_user_id: 'u_other', assignee_user_ids: ['u_other'], assignee_names: ['Other Person'],
    updated_at: '2026-07-23T10:00:00Z', attachments: [] },
  { task_id: 'task_eeeeeeffffff', team_id: 't1', title: 'Audit pack', status: 'done',
    created_by_user_id: 'u_me', assignee_user_ids: [], approval_status: 'approved', approved_by: 'u_me',
    approval_decided_at: '2026-07-10T09:00:00Z', updated_at: '2026-07-10T09:00:00Z', attachments: [] },
];

const APPROVALS = [
  { approval_id: 'approval_internal1', team_id: 't1', status: 'pending', requested_by: 'u_staff',
    requested_by_name: 'Internal Person', requested_by_email: 'internal@firm.in', created_at: '2026-07-24T10:00:00Z' },
  { approval_id: 'task_approval--task_aaaaaabbbbbb', task_id: 'task_aaaaaabbbbbb', task_title: 'File GSTR-3B for June',
    approval_status: 'pending_client', team_id: 't1', requested_by_name: 'Aanya Mehta',
    requested_by_email: 'aanya@firm.in', created_at: '2026-07-24T10:00:00Z',
    request_data: { title: 'File GSTR-3B for June', description: 'Please confirm the input credit figure.' } },
];

let container = null;
let root = null;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.setItem('Kartavaya_user', JSON.stringify(ME));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(api, 'get').mockImplementation((url) => {
    if (url === '/client/tasks') return Promise.resolve({ data: TASKS });
    if (url === '/client/approvals') return Promise.resolve({ data: APPROVALS });
    if (url === '/client/projects') return Promise.resolve({ data: [{ team_id: 't1', name: 'Acme Pvt Ltd' }] });
    if (url === '/v1/org/profile') return Promise.resolve({ data: { name: 'Sharma & Co', logo_url: '' } });
    return Promise.reject(new Error('unexpected ' + url));
  });
  vi.spyOn(api, 'post').mockResolvedValue({ data: { ok: true } });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

/**
 * The route table the portal is BUILT FOR — the shape `App.jsx` needs to
 * declare. `/client/approvals` and `/client/files` do not exist in `App.jsx` on
 * this branch, which is why two of the three views were unreachable; they are
 * declared here so the contract is executable rather than a paragraph in a
 * report. Note there is no layout wrapper: each page renders `ClientShell`
 * itself, so a parent layout route would paint two headers.
 */
async function mount(el, path) {
  await act(async () => {
    root.render(
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/client" element={el} />
            <Route path="/client/approvals" element={el} />
            <Route path="/client/files" element={el} />
            <Route path="/client/project/:projectId" element={el} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );
  });
  await act(async () => { await Promise.resolve(); });
}

const text = () => container.textContent;
const byText = (s) => [...container.querySelectorAll('button, a, summary')].find(n => n.textContent.trim() === s);

describe('client portal', () => {
  it('overview: firm name, the lead, my work only, no forbidden field', async () => {
    await mount(<ClientProjectsPage />, '/client');
    expect(text()).toContain('Sharma & Co');
    expect(text()).toContain('One thing needs your approval');
    expect(text()).toContain('File GSTR-3B for June');
    expect(text()).toContain('#bbbbbb');
    // Never: another member's task, an assignee name, a team email, an estimate.
    expect(text()).not.toContain('Someone else work');
    expect(text()).not.toContain('Aanya Mehta');
    expect(text()).not.toContain('aanya@firm.in');
    expect(text()).not.toContain('240');
    // No internal status vocabulary — three states only.
    expect(text()).not.toContain('In Review');
    expect(text()).toContain('With you');
  });

  it('approvals: internal rows and private files filtered, note required', async () => {
    await mount(<ClientProjectsPage />, '/client?view=approvals');
    expect(text()).toContain('Please confirm the input credit figure.');
    expect(text()).toContain('Aanya Mehta');           // who asked — allowed
    expect(text()).not.toContain('Internal Person');   // the firm's own queue
    expect(text()).not.toContain('internal@firm.in');
    expect(text()).not.toContain('internal-margin.xlsx');

    await act(async () => { byText('Request changes').click(); });
    expect(text()).toContain('Add a note first');
    expect(byText('Send').disabled).toBe(true);

    const ta = container.querySelector('.cl-note');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, 'Wrong figure');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(byText('Send').disabled).toBe(false);
    await act(async () => { byText('Send').click(); });
    expect(api.post).toHaveBeenCalledWith('/tasks/task_aaaaaabbbbbb/client-reject', { notes: 'Wrong figure' });
    expect(text()).toContain('You asked for changes');
  });

  it('approve is one click, no confirm, and leaves a record', async () => {
    await mount(<ClientProjectsPage />, '/client?view=approvals');
    await act(async () => { byText('Approve').click(); });
    expect(api.post).toHaveBeenCalledWith('/tasks/task_aaaaaabbbbbb/client-approve', { notes: null });
    expect(text()).toContain('You approved this');
    expect(container.querySelector('[aria-live="polite"]')).toBeTruthy();
  });

  it('files: client-visible only, download, no delete', async () => {
    await mount(<ClientProjectsPage />, '/client?view=files');
    expect(text()).toContain('gstr3b.pdf');
    expect(text()).not.toContain('internal-margin.xlsx');
    expect(byText('Download')).toBeTruthy();
    expect(text().toLowerCase()).not.toContain('delete');
  });

  it('project view renders, no kanban, no other member work', async () => {
    await mount(<ClientProjectBoardPage />, '/client/project/t1');
    expect(text()).toContain('Acme Pvt Ltd');
    expect(text()).not.toContain('Someone else work');
    expect(container.querySelector('.kb')).toBeNull();
  });

  it('a project the client is not on reads as missing, not denied', async () => {
    await mount(<ClientProjectBoardPage />, '/client/project/t-nope');
    expect(text()).toContain('Back to your work');
    expect(text().toLowerCase()).not.toContain('access');
  });
});

/**
 * The routes. Two of the three built views had no route in `App.jsx`, so the
 * app's catch-all sent a client asking for their own approvals to /dashboard.
 * The portal resolves its view from the pathname and keeps the query form
 * working, so links already sent to clients survive the route move.
 */
describe('client portal · routing', () => {
  it('resolves the view from the pathname', () => {
    expect(viewFromLocation('/client', '')).toBe('overview');
    expect(viewFromLocation('/client/approvals', '')).toBe('approvals');
    expect(viewFromLocation('/client/files', '')).toBe('files');
    // Mounted as children of a /client parent rather than absolutely.
    expect(viewFromLocation('approvals', '')).toBe('approvals');
    expect(viewFromLocation('/client/files/', '')).toBe('files');
  });

  it('falls back to ?view= so already-sent links keep working', () => {
    expect(viewFromLocation('/client', '?view=approvals')).toBe('approvals');
    expect(viewFromLocation('/client', '?view=files')).toBe('files');
    // Anything unrecognised lands on Overview rather than a blank screen.
    expect(viewFromLocation('/client', '?view=timesheet')).toBe('overview');
    expect(viewFromLocation('/client/projects', '')).toBe('overview');
  });

  it('/client/approvals renders Approvals, not Overview', async () => {
    await mount(<ClientProjectsPage />, '/client/approvals');
    expect(text()).toContain('Needs your approval');
    expect(text()).toContain('Please confirm the input credit figure.');
    expect(byText('Approve')).toBeTruthy();
  });

  it('/client/files renders Files', async () => {
    await mount(<ClientProjectsPage />, '/client/files');
    expect(text()).toContain('gstr3b.pdf');
    expect(byText('Download')).toBeTruthy();
  });

  it('the nav points at paths, and marks exactly one tab current', async () => {
    await mount(<ClientProjectsPage />, '/client/approvals');
    const tabs = [...container.querySelectorAll('.cl-nav a')];
    expect(tabs.map(a => a.getAttribute('href')))
      .toEqual(['/client', '/client/approvals', '/client/files']);
    expect(tabs.filter(a => a.getAttribute('aria-current') === 'page')).toHaveLength(1);
    expect(tabs[1].getAttribute('aria-current')).toBe('page');
  });
});

/**
 * Tier 3: a client CONTRIBUTES work and can be an approval GATE. Two
 * prohibitions survive that promotion and are absolute — a client never logs
 * time and never deletes. This asserts it across every view rather than in the
 * one file where somebody might add a control.
 */
describe('client portal · the client is a collaborator, not a reader', () => {
  const FORBIDDEN = [
    'delete', 'remove', 'archive', 'discard',
    'log time', 'time entry', 'timesheet', 'start timer', 'hours', 'hourly',
    'billable', 'rate', 'estimate', 'assign to', 'assignee',
  ];

  for (const path of ['/client', '/client/approvals', '/client/files']) {
    it(`${path}: no delete affordance and no time control`, async () => {
      await mount(<ClientProjectsPage />, path);
      const body = text().toLowerCase();
      for (const word of FORBIDDEN) expect(body).not.toContain(word);
      // Not a label anywhere, and not a control anywhere either.
      const controls = [...container.querySelectorAll('button, a, input, select, textarea')];
      for (const el of controls) {
        const probe = `${el.textContent} ${el.getAttribute('aria-label') || ''} ${el.className || ''}`.toLowerCase();
        for (const word of FORBIDDEN) expect(probe).not.toContain(word);
      }
    });
  }

  it('request work: reachable, blocked until it says something, no staff fields', async () => {
    await mount(<ClientProjectsPage />, '/client');
    const open = byText('Request work');
    expect(open).toBeTruthy();
    await act(async () => { open.click(); });

    expect(text()).toContain('What do you need?');
    // The disabled control says why, the same rule as Request changes.
    expect(text()).toContain('Add a line saying what you need.');
    expect(byText('Send request').disabled).toBe(true);
    // No status, no assignee, no time estimate — the firm decides those.
    expect(text().toLowerCase()).not.toContain('assignee');
    expect(text().toLowerCase()).not.toContain('estimate');
    expect(text().toLowerCase()).not.toContain('status');

    const input = container.querySelector('.cl-form input');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'Need the TDS return filed');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(byText('Send request').disabled).toBe(false);

    await act(async () => { byText('Send request').click(); });
    expect(api.post).toHaveBeenCalledWith('/client/tasks/request', {
      title: 'Need the TDS return filed',
      description: null,
      team_id: 't1',
      priority: 'medium',
    });
  });

  it('a row waiting on the client offers the way to answer it', async () => {
    await mount(<ClientProjectsPage />, '/client');
    const go = container.querySelector('.cl-item__go');
    expect(go).toBeTruthy();
    expect(go.getAttribute('href')).toBe('/client/approvals');
  });
});

/**
 * The API now builds the client shape itself — `/client/tasks` is
 * `List[ClientTaskOut]` and `/client/approvals` is `List[ClientApprovalOut]`
 * (server.py:968, 1031), both allow-lists, with private attachments filtered
 * before the URLs are re-signed. The portal has to render that payload, and has
 * to keep rendering the legacy one for the window where the two halves of the
 * repo are deployed apart. Everything above this block runs against the legacy
 * shape; this block runs the same screens against the new one.
 */
describe('client portal · the server-shaped payload', () => {
  const SHAPED_TASKS = [
    { taskId: 'task_aaaaaabbbbbb', ref: '#bbbbbb', title: 'File GSTR-3B for June',
      note: 'Ready for sign-off', state: 'with_you', expectedAt: '2026-08-02T10:00:00Z',
      updatedAt: '2026-07-24T10:00:00Z', createdAt: '2026-07-20T10:00:00Z',
      requestedBy: 'Aanya Mehta', projectId: 't1',
      files: [{ name: 'gstr3b.pdf', url: 'https://r2/gstr3b.pdf', size: 412000,
                sharedBy: 'Aanya Mehta', sharedAt: '2026-07-24T09:00:00Z' }],
      decision: null, awaitingMe: true },
    { taskId: 'task_eeeeeeffffff', ref: '#ffffff', title: 'Audit pack', note: '',
      state: 'done', updatedAt: '2026-07-10T09:00:00Z', requestedBy: 'Aanya Mehta',
      projectId: 't1', files: [],
      decision: { outcome: 'approved', note: '', at: '2026-07-10T09:00:00Z' },
      awaitingMe: false },
  ];
  const SHAPED_APPROVALS = [
    // The client's OWN Request work row: pending on the firm, not on them.
    { approvalId: 'approval_myrequest', taskId: 'task_gggggghhhhhh', ref: '#hhhhhh',
      title: 'Please file the TDS return', ask: 'By the 7th', requestedBy: 'Riya Patel',
      requestedAt: '2026-07-25T10:00:00Z' },
    { approvalId: 'task_approval--task_aaaaaabbbbbb', taskId: 'task_aaaaaabbbbbb',
      ref: '#bbbbbb', title: 'File GSTR-3B for June',
      ask: 'Please confirm the input credit figure.', requestedBy: 'Aanya Mehta',
      requestedAt: '2026-07-24T10:00:00Z' },
  ];

  beforeEach(() => {
    api.get.mockImplementation((url) => {
      if (url === '/client/tasks') return Promise.resolve({ data: SHAPED_TASKS });
      if (url === '/client/approvals') return Promise.resolve({ data: SHAPED_APPROVALS });
      if (url === '/client/projects') return Promise.resolve({ data: [{ team_id: 't1', name: 'Acme Pvt Ltd' }] });
      if (url === '/v1/org/profile') return Promise.resolve({ data: { name: 'Sharma & Co', logo_url: '' } });
      return Promise.reject(new Error('unexpected ' + url));
    });
  });

  it('overview renders the shaped list rather than an empty portal', async () => {
    await mount(<ClientProjectsPage />, '/client');
    expect(text()).toContain('File GSTR-3B for June');
    expect(text()).toContain('#bbbbbb');
    expect(text()).toContain('With you');
    expect(text()).toContain('1 finished item');
    // Exactly one approval is waiting on the reader — their own request is not.
    expect(text()).toContain('One thing needs your approval');
  });

  it('a client is never asked to approve their own request', async () => {
    await mount(<ClientProjectsPage />, '/client/approvals');
    expect(text()).toContain('Please confirm the input credit figure.');
    expect(text()).not.toContain('Please file the TDS return');
    expect(container.querySelectorAll('.cl-appr')).toHaveLength(1);
  });

  it('files show name, size, who shared it and when', async () => {
    await mount(<ClientProjectsPage />, '/client/files');
    expect(text()).toContain('gstr3b.pdf');
    expect(text()).toContain('412 KB');
    expect(text()).toContain('Shared by Aanya Mehta');
    expect(text().toLowerCase()).not.toContain('delete');
  });

  it('a decision made earlier still reads back', async () => {
    await mount(<ClientProjectsPage />, '/client/approvals');
    expect(text()).toContain('Your decisions');
    expect(text()).toContain('You approved');
  });
});

describe('clientShape · sizeLabel', () => {
  it('prints a size only when there is one', () => {
    expect(sizeLabel(null)).toBe('');
    expect(sizeLabel(undefined)).toBe('');
    expect(sizeLabel(-1)).toBe('');
    expect(sizeLabel(0)).toBe('0 B');
    expect(sizeLabel(999)).toBe('999 B');
    expect(sizeLabel(1000)).toBe('1.0 KB');
    expect(sizeLabel(412000)).toBe('412 KB');
    expect(sizeLabel(2_400_000)).toBe('2.4 MB');
    expect(sizeLabel(5_000_000_000)).toBe('5.0 GB');
  });
});

/**
 * The stylesheet. Two rules are load-bearing and invisible to a DOM assertion:
 * the container is fluid and left-aligned, and no colour is restated as a
 * literal on the surface a stranger judges the firm by.
 */
describe('client portal · stylesheet', () => {
  /** Declaration bodies only — the file's prose comments are not rules. */
  const rules = CLIENT_CSS.replace(/\/\*[\s\S]*?\*\//g, '');

  it('the stylesheet was actually read', () => {
    expect(rules).toMatch(/\.cl-shell\s*\{/);
  });

  it('.cl-main is fluid and left-aligned — no fixed-width centring', () => {
    const main = rules.match(/\.cl-main\s*\{([^}]*)\}/);
    expect(main).toBeTruthy();
    expect(main[1]).not.toMatch(/max-width/);
    expect(main[1]).not.toMatch(/margin/);
  });

  it('nothing in the portal centres itself in a fixed-width column', () => {
    expect(rules).not.toMatch(/margin\s*:\s*0\s+auto/);
    expect(rules).not.toMatch(/margin-inline\s*:\s*auto/);
    // Declarations only — `@media (max-width: 767px)` is a breakpoint, which is
    // how a fluid layout adapts rather than a place it stops being fluid.
    const decls = rules.replace(/@media[^{]*\{/g, '');
    const caps = [...decls.matchAll(/max-width\s*:\s*([^;]+);/g)].map(m => m[1].trim());
    // The only one left is the fluid cap on a preview image.
    for (const cap of caps) expect(cap).toBe('100%');
  });

  it('no hardcoded colour, and faint is not used as a text colour', () => {
    expect(rules).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(rules).not.toMatch(/\brgba?\(/);
    expect(rules).not.toMatch(/--on-surface-faint/);
  });

  it('fixed Devanagari uses --font-hindi, never --font-indic', () => {
    const hi = rules.match(/\.cl-sec__hi\s*\{([^}]*)\}/);
    expect(hi[1]).toContain('var(--font-hindi)');
    expect(rules).not.toMatch(/--font-indic/);
  });

  it('the note field clears the iOS zoom floor', () => {
    expect(rules).toMatch(/\.cl-note\s*\{[^}]*font-size:\s*16px/);
    expect(rules).toMatch(/\.cl-form\s+\.inp\s*\{[^}]*font-size:\s*16px/);
  });
});
