/**
 * Manav → Employees — the statutory fields, and the one that must not round-trip.
 *
 * The payslip prints a provident-fund deduction and attaches an advisory
 * telling the admin to set the employee's UAN at "Manav → Employees → the
 * employee's record". This screen IS that record. Until now it had no input for
 * the UAN, the ESI number or the bank account: the columns existed, the API
 * accepted the fields, and there was nowhere to type them — so the instruction
 * on the payslip named a field that did not exist. Measured on the shared
 * database before this was built: 0 of 81 employees with a UAN, 0 with an ESI
 * number, 1 with a bank account, 720 payslips disbursed with no account on file.
 *
 * The account-number test is the one that matters most. `GET /employees/{id}`
 * returns the account MASKED, so an edit form that prefills from that read and
 * PATCHes it back writes the mask over the only copy of the number — a save
 * that reports success and surfaces at the next payroll run as a failed credit.
 *
 * Rendered with react-dom directly, following the constraint recorded in
 * `manavTabs.test.jsx`: `@testing-library/react` is installed but its
 * `@testing-library/dom` peer is not, so importing it throws.
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
const settle = async (rounds = 4) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};

/** The labelled input whose <span> label matches exactly. */
function fieldInput(label) {
  const spans = [...container.querySelectorAll('label > span')];
  const span = spans.find(s => s.textContent.trim() === label);
  return span ? span.parentElement.querySelector('input, select') : null;
}

function type(input, value) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value',
  ).set;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const clickText = (label) => {
  const el = [...container.querySelectorAll('button')]
    .find(b => b.textContent.trim() === label);
  act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  return el;
};

const submit = () => act(() => {
  container.querySelector('form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
});

const EMPLOYEE = {
  id: 'e001',
  name: 'Priya Sharma',
  employee_code: 'EMP001',
  employment_type: 'full_time',
  status: 'active',
  uan: '100123456789',
  esi_number: '3100123456',
  // As the detail endpoint returns it: MASKED.
  bank_details: { bank_name: 'HDFC Bank', ifsc: 'HDFC0001234', account_number: '••••4821' },
};

/* ══════════════════════════════════════════════════════════════════════════
   The advisory names a field. The field has to be there.
   ══════════════════════════════════════════════════════════════════════════ */

describe('the statutory block exists on the form the payslip points at', () => {
  it('the new-employee form can set UAN, ESI number and the bank account', async () => {
    api.get.mockResolvedValue({ data: { data: [] } });
    mount(<EmployeesTab />);
    await settle();
    clickText('+ Add employee');

    for (const label of ['UAN', 'ESI insurance number', 'Account number', 'IFSC', 'Bank name']) {
      expect(fieldInput(label), `no input for "${label}"`).toBeTruthy();
    }
  });

  it('what is typed is what is posted, under the column names the API uses', async () => {
    api.get.mockResolvedValue({ data: { data: [] } });
    api.post.mockResolvedValue({ data: {} });
    mount(<EmployeesTab />);
    await settle();
    clickText('+ Add employee');

    type(fieldInput('Name *'), 'Priya Sharma');
    type(fieldInput('UAN'), '100123456789');
    type(fieldInput('ESI insurance number'), '3100123456');
    type(fieldInput('Account number'), '50200041824821');
    type(fieldInput('IFSC'), 'HDFC0001234');
    submit();
    await settle();

    const [, payload] = api.post.mock.calls[0];
    expect(payload.uan).toBe('100123456789');
    expect(payload.esi_number).toBe('3100123456');
    // Nested, because that is the shape of the `bank_details` jsonb column.
    expect(payload.bank_details.account_number).toBe('50200041824821');
    expect(payload.bank_details.ifsc).toBe('HDFC0001234');
  });

  it('a refusal from the validator is shown field by field, not flattened', async () => {
    // The backend refuses a malformed identifier rather than storing it and
    // names every problem. A toast saying only "could not be added" would throw
    // away the part that tells the admin which number is wrong.
    api.get.mockResolvedValue({ data: { data: [] } });
    api.post.mockRejectedValue({
      response: {
        status: 422,
        data: {
          detail: {
            error: 'statutory_identifier_invalid',
            problems: [{
              field: 'uan', label: 'UAN',
              message: 'A UAN is exactly 12 digits; this has 3 digit(s).',
            }],
          },
        },
      },
    });
    mount(<EmployeesTab />);
    await settle();
    clickText('+ Add employee');
    type(fieldInput('Name *'), 'Priya');
    type(fieldInput('UAN'), '123');
    submit();
    await settle();

    expect(container.textContent).toContain('A UAN is exactly 12 digits');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   The masked account number must never be written back
   ══════════════════════════════════════════════════════════════════════════ */

describe('editing an existing record', () => {
  beforeEach(() => {
    api.get.mockImplementation((url) => (
      url.includes('/employees/e001')
        ? Promise.resolve({ data: { employee: EMPLOYEE, leave_balances: [] } })
        : Promise.resolve({ data: { data: [EMPLOYEE] } })
    ));
    api.patch.mockResolvedValue({ data: {} });
  });

  async function openEdit() {
    mount(<EmployeesTab />);
    await settle();
    act(() => {
      container.querySelector('tbody tr')
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await settle();
    clickText('Edit');
  }

  it('the account field starts EMPTY, never prefilled with the mask', async () => {
    await openEdit();
    const input = fieldInput('Account number');
    expect(input.value).toBe('');
    // The mask belongs in the placeholder, where it is a hint about what is on
    // file rather than a value that can be submitted.
    expect(input.placeholder).toContain('••••4821');
  });

  it('saving without touching the account does not send an account number', async () => {
    // The PATCH merges rather than replaces, so an omitted key preserves the
    // stored value. Sending the mask — or an empty string — would destroy it.
    await openEdit();
    type(fieldInput('Designation'), 'Senior Developer');
    submit();
    await settle();

    const [, payload] = api.patch.mock.calls[0];
    expect(payload.bank_details?.account_number).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('••••');
  });

  it('a retyped account number IS sent', async () => {
    // The other half of the rule. A form that never sends the account number
    // would pass the test above and still be useless.
    await openEdit();
    type(fieldInput('Account number'), '50200041824821');
    submit();
    await settle();

    const [, payload] = api.patch.mock.calls[0];
    expect(payload.bank_details.account_number).toBe('50200041824821');
  });

  it('the UAN and ESI number prefill from the record and can be corrected', async () => {
    // These are NOT masked, so prefilling them is correct — and necessary, or
    // every edit of an unrelated field would blank them.
    await openEdit();
    expect(fieldInput('UAN').value).toBe('100123456789');
    expect(fieldInput('ESI insurance number').value).toBe('3100123456');

    type(fieldInput('UAN'), '100999888777');
    submit();
    await settle();
    expect(api.patch.mock.calls[0][1].uan).toBe('100999888777');
  });
});
