/**
 * Manav → Employees: an unlinked employee must LOOK unlinked.
 *
 * `manav_employees.user_id` joins a personnel record to an account that can sign
 * in. Measured against the live database before this shipped: 81 employee
 * records across 3 organisations, 0 with a user_id. The reason nobody noticed is
 * this screen — the directory had six columns and none of them was about a
 * login, so a record nobody could sign in as rendered identically to one they
 * could, while clock-in answered "Your account is not linked to an employee
 * record" and every self-service page came back empty.
 *
 * These tests pin the visibility, not the plumbing: the badge, the count, the
 * filter reaching the request, and the panel that states the consequence. The
 * rules about which links are legal are backend-side and are proven directly in
 * `backend/tests/test_manav_employee_login_link.py` — the pool is mocked there,
 * so they live in pure functions rather than in an HTTP round trip.
 *
 * Rendered with react-dom directly, following `manavTabs.test.jsx`:
 * `@testing-library/react` is installed but its `@testing-library/dom` peer is
 * not, so importing it throws.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  rows: (r) => {
    const b = r?.data;
    if (Array.isArray(b)) return b;
    if (Array.isArray(b?.data)) return b.data;
    return [];
  },
  body: (r) => r?.data ?? {},
}));

import { api } from '../../../lib/api';
import { ToastProvider } from '../../../components/ui/toast';
import EmployeesTab from '../EmployeesTab';

let container = null;
let root = null;

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
});

const mount = (ui) => act(() => root.render(<ToastProvider>{ui}</ToastProvider>));
const settle = async (rounds = 6) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};
const text = () => container.textContent;
const urls = () => api.get.mock.calls.map(c => c[0]);

const LINKED = {
  id: 'emp-1', name: 'Priya Sharma', employee_code: 'EMP001',
  department: 'Engineering', designation: 'Developer',
  employment_type: 'full_time', status: 'active', user_id: 'user_priya01',
};
const UNLINKED = {
  id: 'emp-2', name: 'Rahul Verma', employee_code: 'EMP002',
  department: 'Sales', designation: 'Executive',
  employment_type: 'full_time', status: 'active', user_id: null,
};

/** Route the mocked GET by path, so a click into the detail view answers with
 *  the detail body rather than with the list again. */
function serve({ list = [], detail = null, candidates = null }) {
  api.get.mockImplementation((url) => {
    if (url.includes('link-candidates')) {
      if (candidates instanceof Error) return Promise.reject(candidates);
      return Promise.resolve({ data: { data: candidates || [], total: 0 } });
    }
    if (/\/employees\/[^?]+$/.test(url) && !url.includes('link-candidates')) {
      return Promise.resolve({ data: detail });
    }
    return Promise.resolve({ data: { data: list, total: list.length, truncated: false } });
  });
}

const rowFor = (name) =>
  [...container.querySelectorAll('tr')].find(tr => tr.textContent.includes(name));

/* ══════════════════════════════════════════════════════════════════════════
   The directory
   ══════════════════════════════════════════════════════════════════════════ */

describe('the directory says which employees have a login', () => {
  it('badges an unlinked record differently from a linked one', async () => {
    serve({ list: [LINKED, UNLINKED] });
    mount(<EmployeesTab />);
    await settle();

    expect(rowFor('Rahul Verma').textContent).toContain('no login');
    expect(rowFor('Priya Sharma').textContent).toContain('linked');
    // And the two must not read the same. This is the whole defect: before the
    // column existed, both rows were identical.
    expect(rowFor('Rahul Verma').textContent).not.toEqual(rowFor('Priya Sharma').textContent);
  });

  it('never leaves the login cell blank — "no login" is a state, not a gap', async () => {
    serve({ list: [UNLINKED] });
    mount(<EmployeesTab />);
    await settle();

    const cells = [...rowFor('Rahul Verma').querySelectorAll('td')];
    expect(cells.every(td => td.textContent.trim() !== '')).toBe(true);
  });

  it('names the missing login in the row label, for a screen reader', async () => {
    serve({ list: [LINKED, UNLINKED] });
    mount(<EmployeesTab />);
    await settle();

    expect(rowFor('Rahul Verma').getAttribute('aria-label')).toContain('no login linked');
    expect(rowFor('Priya Sharma').getAttribute('aria-label')).not.toContain('no login');
  });

  it('counts the unlinked records above the table', async () => {
    serve({ list: [LINKED, UNLINKED] });
    mount(<EmployeesTab />);
    await settle();

    expect(text()).toContain('1 of the 2 employees shown have no login linked');
  });

  it('says nothing when every record on screen is linked', async () => {
    serve({ list: [LINKED] });
    mount(<EmployeesTab />);
    await settle();

    expect(text()).not.toContain('no login linked');
  });

  it('does not claim anything about logins when the fetch failed', async () => {
    // The rule this module was rebuilt around, applied to the new sentence: a
    // failed request must never produce a statement about the business.
    api.get.mockRejectedValue({ response: { status: 500 } });
    mount(<EmployeesTab />);
    await settle();

    expect(text()).toContain('did not load');
    expect(text()).not.toContain('have no login linked');
  });

  it('asks the server for the unlinked ones when the filter is set', async () => {
    serve({ list: [LINKED, UNLINKED] });
    mount(<EmployeesTab />);
    await settle();

    const select = [...container.querySelectorAll('select')]
      .find(s => s.getAttribute('aria-label') === 'Filter by login');
    expect(select).toBeTruthy();

    await act(async () => {
      select.value = 'no';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();

    expect(urls().some(u => u.includes('linked=no'))).toBe(true);
  });

  it('sends no linked parameter at all when the filter is "All logins"', async () => {
    serve({ list: [LINKED] });
    mount(<EmployeesTab />);
    await settle();

    expect(urls().every(u => !u.includes('linked='))).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   One employee's file
   ══════════════════════════════════════════════════════════════════════════ */

const openDetail = async (name) => {
  await act(async () => {
    rowFor(name).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await settle();
};

describe('the employee file states the login, and can set it', () => {
  it('spells out what an unlinked employee cannot do', async () => {
    serve({
      list: [UNLINKED],
      detail: { employee: UNLINKED, leave_balances: [], login: null },
    });
    mount(<EmployeesTab />);
    await settle();
    await openDetail('Rahul Verma');

    expect(text()).toContain('No login is linked to this record');
    // The consequences, not just the state. An HR admin has no other way to
    // learn that this is why clock-in fails.
    expect(text()).toContain('clock in');
    expect(text()).toContain('payslip');
  });

  it('names the account when there is one, and offers to unlink it', async () => {
    serve({
      list: [LINKED],
      detail: {
        employee: LINKED,
        leave_balances: [],
        login: { user_id: 'user_priya01', email: 'priya@example.com', full_name: 'Priya Sharma', missing: false },
      },
    });
    mount(<EmployeesTab />);
    await settle();
    await openDetail('Priya Sharma');

    expect(text()).toContain('priya@example.com');
    expect(text()).toContain('signs in as');
    expect([...container.querySelectorAll('button')].some(b => b.textContent.includes('Unlink'))).toBe(true);
  });

  it('reports a link to a deleted account as broken, not as linked', async () => {
    serve({
      list: [LINKED],
      detail: {
        employee: LINKED,
        leave_balances: [],
        login: { user_id: 'user_gone', email: '', full_name: '', missing: true },
      },
    });
    mount(<EmployeesTab />);
    await settle();
    await openDetail('Priya Sharma');

    expect(text()).toContain('no longer exists');
  });

  it('does not fetch the organisation member list until the picker is opened', async () => {
    serve({
      list: [UNLINKED],
      detail: { employee: UNLINKED, leave_balances: [], login: null },
    });
    mount(<EmployeesTab />);
    await settle();
    await openDetail('Rahul Verma');

    expect(urls().some(u => u.includes('link-candidates'))).toBe(false);
  });

  it('lists a taken account, disabled, naming who holds it', async () => {
    serve({
      list: [UNLINKED],
      detail: { employee: UNLINKED, leave_balances: [], login: null },
      candidates: [
        { user_id: 'user_free', email: 'free@example.com', full_name: 'Amy Free', linked_employee_id: null, linked_employee_name: null },
        { user_id: 'user_taken', email: 'taken@example.com', full_name: 'Zoe Taken', linked_employee_id: 'emp-9', linked_employee_name: 'Priya Sharma' },
      ],
    });
    mount(<EmployeesTab />);
    await settle();
    await openDetail('Rahul Verma');

    const open = [...container.querySelectorAll('button')].find(b => b.textContent.includes('Link an account'));
    await act(async () => { open.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await settle();

    const options = [...container.querySelectorAll('option')];
    const taken = options.find(o => o.value === 'user_taken');
    const free = options.find(o => o.value === 'user_free');
    // Hidden, an admin cannot tell "no account" from "on the wrong record", and
    // those have opposite remedies.
    expect(taken).toBeTruthy();
    expect(taken.disabled).toBe(true);
    expect(taken.textContent).toContain('Priya Sharma');
    expect(free.disabled).toBe(false);
  });

  it('points at the invitation flow when no account is free', async () => {
    serve({
      list: [UNLINKED],
      detail: { employee: UNLINKED, leave_balances: [], login: null },
      candidates: [
        { user_id: 'user_taken', email: 't@example.com', full_name: 'Zoe Taken', linked_employee_id: 'emp-9', linked_employee_name: 'Priya Sharma' },
      ],
    });
    mount(<EmployeesTab />);
    await settle();
    await openDetail('Rahul Verma');

    const open = [...container.querySelectorAll('button')].find(b => b.textContent.includes('Link an account'));
    await act(async () => { open.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await settle();

    // The sentence that only the no-free-account branch prints. Asserting on
    // "Settings → Members" alone was not enough — BOTH branches name the
    // invitation flow, so a picker that counted the taken account as free
    // still passed. Mutation 5 in the harness caught exactly that.
    expect(text()).toContain('Every account in this organisation is already linked');
    // The remedy that already exists in the product, named — not a second
    // invitation flow built into HR.
    expect(text()).toContain('Settings → Members');
  });

  it('offers the free account instead of the invitation sentence when one exists', async () => {
    serve({
      list: [UNLINKED],
      detail: { employee: UNLINKED, leave_balances: [], login: null },
      candidates: [
        { user_id: 'user_free', email: 'free@example.com', full_name: 'Amy Free', linked_employee_id: null, linked_employee_name: null },
        { user_id: 'user_taken', email: 't@example.com', full_name: 'Zoe Taken', linked_employee_id: 'emp-9', linked_employee_name: 'Priya Sharma' },
      ],
    });
    mount(<EmployeesTab />);
    await settle();
    await openDetail('Rahul Verma');

    const open = [...container.querySelectorAll('button')].find(b => b.textContent.includes('Link an account'));
    await act(async () => { open.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await settle();

    expect(text()).not.toContain('Every account in this organisation is already linked');
  });

  it('posts the chosen account to the link endpoint', async () => {
    serve({
      list: [UNLINKED],
      detail: { employee: UNLINKED, leave_balances: [], login: null },
      candidates: [
        { user_id: 'user_free', email: 'free@example.com', full_name: 'Amy Free', linked_employee_id: null, linked_employee_name: null },
      ],
    });
    api.post.mockResolvedValue({ data: { status: 'linked', user_id: 'user_free', email: 'free@example.com' } });
    mount(<EmployeesTab />);
    await settle();
    await openDetail('Rahul Verma');

    const open = [...container.querySelectorAll('button')].find(b => b.textContent.includes('Link an account'));
    await act(async () => { open.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await settle();

    const select = container.querySelector('form select');
    await act(async () => {
      select.value = 'user_free';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle();

    expect(api.post).toHaveBeenCalledWith('/v1/manav/employees/emp-2/link', { user_id: 'user_free' });
  });

  it('shows a failure, not an empty picker, when the account list does not load', async () => {
    serve({
      list: [UNLINKED],
      detail: { employee: UNLINKED, leave_balances: [], login: null },
      candidates: new Error('boom'),
    });
    mount(<EmployeesTab />);
    await settle();
    await openDetail('Rahul Verma');

    const open = [...container.querySelectorAll('button')].find(b => b.textContent.includes('Link an account'));
    await act(async () => { open.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await settle();

    expect(text()).toContain('did not load');
    // "Every account is already linked" over a failed fetch would be the module's
    // founding defect, restated.
    expect(text()).not.toContain('Every account in this organisation');
  });
});
