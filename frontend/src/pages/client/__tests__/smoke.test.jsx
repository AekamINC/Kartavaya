/**
 * ⚠ THIS FILE DOES NOT RUN YET.
 *
 * `vitest.config.js` has `include: ['src/__tests__/**\/*.test.{js,jsx,ts,tsx}']`,
 * so `npm test` never sees it. One line fixes that:
 *
 *     include: ['src/**\/__tests__/**\/*.test.{js,jsx,ts,tsx}']
 *
 * `vitest.config.js` is outside this change's file ownership, so the line is in
 * the report rather than in the config. Until it lands, run this deliberately:
 *
 *     npx vitest run --config <a copy of vitest.config.js with the glob above>
 *
 * It was written and run that way, and passes 6/6.
 *
 * ── What it locks
 *
 * Every assertion here is one of 19's never-see rules, tested against the real
 * payload shape the API returns today — which includes `assignee_names`,
 * `assignee_emails` and `estimated_minutes` on every task, and the firm's own
 * internal approval queue with staff emails on `/client/approvals`. The
 * filtering that keeps those off the screen lives in `clientShape.js`, and
 * these are the tests that say it works. Delete them only alongside a real
 * client serializer in the API.
 *
 * Rendered with react-dom directly: @testing-library/react is installed but its
 * @testing-library/dom peer is not, so importing it throws — `pageHeader.test.jsx`
 * carries the same note and the same workaround.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { api } from '../../../lib/api';
import { ToastProvider } from '../../../components/ui';
import { ClientProjectsPage, ClientProjectBoardPage } from '../../ClientPages';

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

/** The same two routes App.jsx declares, so useParams resolves as it does live. */
async function mount(el, path) {
  await act(async () => {
    root.render(
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/client" element={el} />
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
