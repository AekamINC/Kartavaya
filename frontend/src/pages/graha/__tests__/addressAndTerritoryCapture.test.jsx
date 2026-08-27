/**
 * Phase 7.0 — a contact can carry an address and a sales patch, and a territory
 * can be corrected after it is created.
 *
 * ── What was actually broken ────────────────────────────────────────────────
 *
 * Three separate faults, all of them "the column is live and nothing can reach
 * it", measured against the database on 2026-08-27:
 *
 *   1. `graha_contacts.billing_address` is a live jsonb column and both API
 *      models have always accepted it. THE CREATE FORM HAD NO ADDRESS FIELDS AT
 *      ALL. E2E Test & Associates: 0 of 235 contacts carry a pincode.
 *   2. `graha_contacts.territory_id` (migration 023) was unreachable from every
 *      API path — absent from `ContactCreate`, from `ContactUpdate`, and from
 *      both the INSERT and the PATCH SET-build. `graha_deals.territory_id`, the
 *      column added in the SAME migration, was always writable. 0 of 289
 *      contacts and 0 of 162 deals are routed.
 *   3. `PATCH /v1/graha/territories/{id}` had ZERO CALLERS, so a pincode list
 *      could be created and deleted but never corrected.
 *
 * ── The `{}` trap, which is why the assertions are shaped this way ──────────
 *
 * All 235 of E2E's contacts have `billing_address IS NOT NULL`. Every one of
 * them is `{}`. A test — or an acceptance query — that checks for null passes on
 * day zero and measures nothing. What matters is whether a KEY carrying a value
 * arrives, so that is what is asserted: the body posted by the form, read down
 * to `billing_address.pincode`.
 *
 * Rendered with react-dom directly, not @testing-library/react: its
 * @testing-library/dom peer is not installed, so importing it throws. Same
 * constraint `grahaTabStates.test.jsx` and `kanbanTab.test.jsx` record.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../lib/api', async (importOriginal) => ({
  ...(await importOriginal()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { api } from '../../../lib/api';
import { ToastProvider } from '../../../components/ui/toast';
import ContactsTab from '../ContactsTab';
import TerritoriesTab from '../TerritoriesTab';

let host, root;

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function mount(node) {
  await act(async () => {
    root.render(<MemoryRouter><ToastProvider>{node}</ToastProvider></MemoryRouter>);
  });
}

/** React tracks the DOM value itself, so a plain assignment is discarded. */
function typeInto(el, value) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function pick(el, value) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** The label text above a field, back to the control it labels. */
function byLabel(text) {
  const label = [...host.querySelectorAll('label')].find(
    (l) => l.querySelector('.gr__fl')?.textContent.trim() === text);
  return label ? label.querySelector('input, select, textarea') : null;
}

function buttonSaying(text) {
  return [...host.querySelectorAll('button')].find(
    (b) => b.textContent.trim() === text);
}

async function submitForm() {
  await act(async () => {
    host.querySelector('form').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }));
  });
}

// ── Contacts ────────────────────────────────────────────────────────────────

describe('a contact can be given an address and a territory', () => {
  const TERRITORIES = [
    { id: 't-gujarat', name: 'Gujarat', rules: { pincodes: [] }, assigned_users: [] },
    { id: 't-mumbai', name: 'Mumbai Metro', rules: { pincodes: [] }, assigned_users: [] },
  ];

  beforeEach(() => {
    api.get.mockImplementation((url) => {
      if (url.startsWith('/v1/graha/territories')) {
        return Promise.resolve({ data: { data: TERRITORIES } });
      }
      return Promise.resolve({ data: { data: [] } });
    });
    api.post.mockResolvedValue({ data: { status: 'created' } });
  });

  it('THE FAULT — the create form now has address fields at all', async () => {
    await mount(<ContactsTab />);
    await act(async () => { buttonSaying('+ Add Contact').click(); });
    // Named one by one rather than counted, because "some address input exists"
    // would pass on a form that captures a city and drops the pincode — and the
    // pincode is the only one of the five that routes a lead.
    for (const label of ['Address line 1', 'Address line 2', 'City', 'State', 'Pincode']) {
      expect(byLabel(label), `${label} is missing from the create form`).toBeTruthy();
    }
  });

  it('posts the pincode INSIDE billing_address, under the key the invoice reads', async () => {
    await mount(<ContactsTab />);
    await act(async () => { buttonSaying('+ Add Contact').click(); });
    typeInto(byLabel('Name *'), 'Rohan Shah');
    typeInto(byLabel('Pincode'), '395002');
    typeInto(byLabel('City'), 'Surat');
    await submitForm();

    expect(api.post).toHaveBeenCalledTimes(1);
    const [url, sent] = api.post.mock.calls[0];
    expect(url).toBe('/v1/graha/contacts');
    // `services/invoice_pdf.py:123` reads exactly these keys off the jsonb. A
    // form that wrote `pin`, or that flattened the address onto the body, would
    // be invisible to every invoice.
    expect(sent.billing_address.pincode).toBe('395002');
    expect(sent.billing_address.city).toBe('Surat');
  });

  it('posts territory_id, and the picker never draws the id on screen', async () => {
    await mount(<ContactsTab />);
    await act(async () => { buttonSaying('+ Add Contact').click(); });
    const picker = byLabel('Territory');
    expect(picker, 'there is no territory picker on the create form').toBeTruthy();
    // The NAME is what a person reads; the id lives only in `value`. This is the
    // shape `scripts/check-rendered-ids.mjs` admits, and the rule is the
    // owner's: never render a user, member or org id.
    expect(picker.textContent).toContain('Gujarat');
    expect(picker.textContent).not.toContain('t-gujarat');

    typeInto(byLabel('Name *'), 'Rohan Shah');
    pick(picker, 't-mumbai');
    await submitForm();
    expect(api.post.mock.calls[0][1].territory_id).toBe('t-mumbai');
  });

  it('a contact with no address typed posts an EMPTY address, not an invented one', async () => {
    // The counterpart of the `{}` trap above: the form must not make keys up.
    await mount(<ContactsTab />);
    await act(async () => { buttonSaying('+ Add Contact').click(); });
    typeInto(byLabel('Name *'), 'Rohan Shah');
    await submitForm();

    const sent = api.post.mock.calls[0][1];
    expect(Object.values(sent.billing_address).every((v) => v === '')).toBe(true);
    expect(sent.territory_id).toBe('');
  });
});

// ── The two fields that never existed ───────────────────────────────────────

describe('the contact edit panel no longer offers fields nothing can store', () => {
  it('Mobile and Website are gone — graha_contacts has neither column', () => {
    // Checked against the live schema in BOTH `staging` and `public` on
    // 2026-08-27: `graha_contacts` has 31 columns and neither is one of them.
    // `ContactUpdate` never listed them either, so pydantic dropped the values
    // before the SQL was built. The panel rendered two boxes, a person typed
    // into them, the toast said "Contact updated" and the value went nowhere.
    //
    // Read from SOURCE rather than by opening the panel, because reaching the
    // panel needs a contact, a row click and a detail fetch — three things that
    // can break for their own reasons and turn this into a flaky test about
    // something else entirely. Comment lines are stripped first: the file
    // explains at length why the fields are absent, and that explanation
    // necessarily contains the words.
    // Resolved from the vitest root (`frontend/`) rather than through
    // `import.meta.url`: under jsdom that is an `http://localhost` URL, not a
    // `file:` one, and `readFileSync` refuses it.
    const src = readFileSync(
      resolve(process.cwd(), 'src/pages/graha/ContactsTab.jsx'), 'utf8');
    const live = src.split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');
    expect(live).not.toMatch(/field\('Mobile'/);
    expect(live).not.toMatch(/field\('Website'/);
  });
});

// ── Territories ─────────────────────────────────────────────────────────────

describe('a territory can be corrected after it is created', () => {
  const ONE = [{
    id: 'terr-1',
    name: 'Gujarat',
    description: 'West',
    rules: { pincodes: ['395002'] },
    assigned_users: [],
    assigned: [],
  }];

  beforeEach(() => {
    api.get.mockImplementation((url) => {
      if (url.startsWith('/v1/graha/territories')) {
        return Promise.resolve({ data: { data: ONE } });
      }
      return Promise.resolve({ data: { data: [] } });
    });
    api.patch.mockResolvedValue({ data: { status: 'updated' } });
    api.post.mockResolvedValue({ data: { status: 'created' } });
  });

  it('THE FAULT — the row now has an Edit control at all', async () => {
    await mount(<TerritoriesTab />);
    expect(buttonSaying('Edit'), 'no Edit button on a territory row').toBeTruthy();
  });

  it('Edit loads the existing pincodes and saves through PATCH, not POST', async () => {
    await mount(<TerritoriesTab />);
    await act(async () => { buttonSaying('Edit').click(); });
    // The form is populated from the row, so a save does not blank the list.
    expect(host.textContent).toContain('395002');
    expect(host.textContent).toContain('Edit territory');

    await submitForm();
    expect(api.post).not.toHaveBeenCalled();
    expect(api.patch).toHaveBeenCalledTimes(1);
    const [url, sent] = api.patch.mock.calls[0];
    expect(url).toBe('/v1/graha/territories/terr-1');
    expect(sent.rules.pincodes).toEqual(['395002']);
    expect(sent.name).toBe('Gujarat');
  });

  it('cancelling an edit leaves the next New Territory blank', async () => {
    // `editingId` surviving a cancel would turn the next create into a silent
    // overwrite of whichever territory was last edited.
    await mount(<TerritoriesTab />);
    await act(async () => { buttonSaying('Edit').click(); });
    await act(async () => { buttonSaying('Cancel').click(); });
    await act(async () => { buttonSaying('+ New Territory').click(); });

    expect(host.textContent).toContain('New territory');
    expect(host.textContent).not.toContain('Edit territory');
    await submitForm();
    expect(api.patch).not.toHaveBeenCalled();
    expect(api.post).toHaveBeenCalledTimes(1);
  });
});
