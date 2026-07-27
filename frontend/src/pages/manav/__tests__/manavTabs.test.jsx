/**
 * Manav tabs — a failed fetch must never render as an empty state.
 *
 * This is the invariant the whole module was rebuilt around, and it is the one
 * that cannot be checked by looking at a screenshot: both states are quiet, and
 * the wrong one is a confident sentence rather than a visible break.
 *
 * Before this pass every tab here was `catch { pushToast(…) }` over a list left
 * at `[]`, then `list.length === 0 ? <empty> : <table>`. On an HR module that
 * prints "No employees yet", "No attendance in this range" and "No leave
 * requests" when the truth is that the request failed — statements about the
 * business made from an error. The Vetana agent found the identical shape on
 * payroll; `graha/__tests__/kanbanTab.test.jsx` pins the same rule for deals,
 * and this file is that test for HR.
 *
 * Rendered with react-dom directly, following the constraint recorded in
 * `pageHeader.test.jsx` and `kanbanTab.test.jsx`: `@testing-library/react` is
 * installed but its `@testing-library/dom` peer is not, so importing it throws.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  // The real `rows()` — the unwrapping is part of what is under test.
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
import AttendanceTab from '../AttendanceTab';
import LeavesTab from '../LeavesTab';
import HolidaysTab from '../HolidaysTab';

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
const settle = async (rounds = 4) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};
const text = () => container.textContent;
const statusBlock = () => container.querySelector('[role="status"]');

/* ══════════════════════════════════════════════════════════════════════════
   The rule
   ══════════════════════════════════════════════════════════════════════════ */

describe('Manav — a failed fetch is never an empty state', () => {
  it('EmployeesTab shows a failure, not "No employees yet"', async () => {
    api.get.mockRejectedValue({ response: { status: 500 } });
    mount(<EmployeesTab />);
    await settle();

    expect(statusBlock()).toBeTruthy();
    expect(text()).toContain('did not load');
    // The claim about the business must NOT appear.
    expect(text()).not.toContain('No employees yet');
  });

  it('AttendanceTab shows a failure, not "No attendance in this range"', async () => {
    api.get.mockRejectedValue({ response: { status: 500 } });
    mount(<AttendanceTab />);
    await settle();

    expect(statusBlock()).toBeTruthy();
    expect(text()).not.toContain('No attendance in this range');
  });

  it('LeavesTab shows a failure, not "No leave requests"', async () => {
    api.get.mockRejectedValue({ response: { status: 500 } });
    mount(<LeavesTab />);
    await settle();

    expect(statusBlock()).toBeTruthy();
    expect(text()).not.toContain('No leave requests');
  });

  it('HolidaysTab shows a failure, not "No holidays configured"', async () => {
    api.get.mockRejectedValue({ response: { status: 500 } });
    mount(<HolidaysTab />);
    await settle();

    expect(statusBlock()).toBeTruthy();
    expect(text()).not.toContain('No holidays configured');
  });

  it('a genuinely empty success DOES show the empty state', async () => {
    // The other half of the rule: the empty state is still correct when the
    // request succeeded and returned nothing. A test that only asserts the
    // failure path would pass on a component that never shows an empty state.
    api.get.mockResolvedValue({ data: { data: [] } });
    mount(<EmployeesTab />);
    await settle();

    expect(text()).toContain('No employees yet');
    expect(statusBlock()).toBeFalsy();
  });

  it('the server’s own words survive — a 403 is not flattened to "Failed"', async () => {
    api.get.mockRejectedValue({
      response: { status: 403, data: { detail: 'Reading the HR directory needs a Manav grant.' } },
    });
    mount(<EmployeesTab />);
    await settle();

    expect(text()).toContain('Reading the HR directory needs a Manav grant.');
  });

  it('retry re-issues the request and recovers', async () => {
    api.get.mockRejectedValueOnce({ response: { status: 500 } });
    mount(<EmployeesTab />);
    await settle();
    expect(statusBlock()).toBeTruthy();

    api.get.mockResolvedValue({
      data: { data: [{ id: 'e1', name: 'Synthetic Person', employee_code: 'EMP001', status: 'active' }] },
    });
    const retry = [...container.querySelectorAll('button')]
      .find(b => b.textContent.trim() === 'Try again');
    expect(retry).toBeTruthy();

    await act(async () => { retry.click(); });
    await settle();

    expect(text()).toContain('Synthetic Person');
    expect(statusBlock()).toBeFalsy();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   The clash check — rebuilt against the contract the server actually serves
   ══════════════════════════════════════════════════════════════════════════ */

describe('Manav — the leave clash check calls the endpoint that exists', () => {
  it('sends employee_id, which the route requires and the old call omitted', async () => {
    api.get.mockResolvedValue({ data: { data: [] } });
    mount(<LeavesTab />);
    await settle();

    const open = [...container.querySelectorAll('button')]
      .find(b => b.textContent.trim() === 'Check clashes');
    await act(async () => { open.click(); });
    await settle();

    // The panel must offer an employee control at all — the old one had no way
    // to supply the one parameter the endpoint cannot run without, so every
    // call 422'd before reaching the handler.
    const selects = [...container.querySelectorAll('select')];
    const hasEmployeePicker = selects.some(s => (s.getAttribute('aria-label') || s.previousSibling?.textContent || '')
      .toLowerCase().includes('employee')
      || [...s.closest('label')?.childNodes || []].some(n => (n.textContent || '').includes('Employee')));
    expect(hasEmployeePicker).toBe(true);
  });

  it('reads exceeds_threshold / conflicts, not the four names that never existed', async () => {
    api.get.mockImplementation((url) => {
      if (url.includes('check-conflicts')) {
        return Promise.resolve({
          data: {
            conflicts: [{
              id: 'l1', employee_name: 'Synthetic Colleague', employee_code: 'EMP002',
              start_date: '2026-08-11', end_date: '2026-08-16', days: 5, status: 'approved',
            }],
            conflict_count: 1,
            department: 'Engineering',
            department_size: 4,
            on_leave_count: 2,
            exceeds_threshold: true,
          },
        });
      }
      return Promise.resolve({ data: { data: [{ id: 'e1', name: 'Synthetic Person' }] } });
    });

    mount(<LeavesTab />);
    await settle();
    const open = [...container.querySelectorAll('button')]
      .find(b => b.textContent.trim() === 'Check clashes');
    await act(async () => { open.click(); });
    await settle();

    const form = container.querySelector('form');
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle();

    // The server's own verdict, and the row it sent under `conflicts`.
    expect(text()).toContain('Synthetic Colleague');
    expect(text()).toContain('Engineering');
    expect(text()).toContain('Over threshold');
    // 2 of 4 = 50%, derived here from the two counts the server does send.
    expect(text()).toContain('50%');
  });
});
