/**
 * Graha tabs — a failed fetch is never an empty state.
 *
 * The single most common defect in this codebase is `catch { toast }` followed
 * by a `length === 0` check: the request fails, the array stays `[]`, and the
 * panel renders its "nothing here" copy. On a CRM that is not a blank screen,
 * it is a false statement about the customer's business — "No contacts yet" on
 * a list that may be full, "No duplicates found" on data nobody checked, "No
 * pending requests" on an approval queue that did not load. The toast that says
 * otherwise is gone in four seconds and leaves no trace.
 *
 * Thirteen of the seventeen Graha tabs did exactly this. This asserts, for
 * every one of them, that a rejected load renders an error with a retry and
 * that the tab's own empty-state sentence is absent.
 *
 * Rendered with react-dom directly, not @testing-library/react: its
 * @testing-library/dom peer is not installed, so importing it throws.
 * `kanbanTab.test.jsx` and `pageHeader.test.jsx` record the same constraint.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

// Only the transport is mocked; `rows()` / `body()` stay real. See the note in
// kanbanTab.test.jsx — a bare factory leaves them undefined and every tab that
// unwraps through them throws on render.
vi.mock('../../../lib/api', async (importOriginal) => ({
  ...(await importOriginal()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { api } from '../../../lib/api';
import { ToastProvider } from '../../../components/ui/toast';

import ContactsTab from '../ContactsTab';
import ClientsTab from '../ClientsTab';
import DealsTab from '../DealsTab';
import ReportsTab from '../ReportsTab';
import DedupeTab from '../DedupeTab';
import ApprovalsTab from '../ApprovalsTab';
import DocumentsTab from '../DocumentsTab';
import FollowUpsTab from '../FollowUpsTab';
import LabelsTab from '../LabelsTab';
import AutomationsTab from '../AutomationsTab';
import WebFormsTab from '../WebFormsTab';
import TerritoriesTab from '../TerritoriesTab';
import CustomFieldsTab from '../CustomFieldsTab';
import ActivitiesTab from '../ActivitiesTab';
import TodayTab from '../TodayTab';

/**
 * Each tab, and the sentence it must NOT print when its load fails. These are
 * the exact strings the empty branches render, so a regression that reinstates
 * the old behaviour fails here rather than passing quietly.
 */
const TABS = [
  ['ContactsTab', ContactsTab, ['No contacts yet']],
  ['ClientsTab', ClientsTab, ['No clients yet']],
  ['DealsTab', DealsTab, ['No deals yet']],
  ['ReportsTab', ReportsTab, ['Nothing to report yet']],
  ['DedupeTab', DedupeTab, ['No duplicates found', 'No merges yet']],
  ['ApprovalsTab', ApprovalsTab, ['No approval rules defined', 'No pending requests']],
  ['DocumentsTab', DocumentsTab, ['No documents found']],
  ['FollowUpsTab', FollowUpsTab, ['No follow-ups']],
  ['LabelsTab', LabelsTab, ['No labels yet']],
  ['AutomationsTab', AutomationsTab, ['No automations yet']],
  ['WebFormsTab', WebFormsTab, ['No web forms yet']],
  ['TerritoriesTab', TerritoriesTab, ['No territories yet']],
  ['CustomFieldsTab', CustomFieldsTab, ['No custom fields yet']],
  ['ActivitiesTab', ActivitiesTab, ['No activities logged']],
  ['TodayTab', TodayTab, ['No overdue follow-ups', 'All deals are active']],
];

let container = null;
let root = null;

beforeEach(() => {
  vi.clearAllMocks();
  // Every failing load pushes a toast, and a toast schedules its own dismiss and
  // removal timers. Under real timers those fire after the test that created
  // them has finished — React reports each one as an update outside `act()`,
  // and the suite goes green while stderr fills with them. The baseline suite
  // has zero such warnings and this file must not be the one that adds 58.
  // Fake timers keep them pending until they are drained inside `act()` below.
  vi.useFakeTimers();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { vi.runOnlyPendingTimers(); });
  act(() => root.unmount());
  vi.useRealTimers();
  container.remove();
  container = null;
});

/**
 * Flush the microtask queue and any state updates it produced.
 *
 * Eight rounds rather than four: several of these tabs run TWO independent
 * loads — the list, plus an enrichment behind its own `Promise.all` — and the
 * second settles a few ticks after the first. Timers are faked, so this stays
 * purely microtask work and no toast timer fires mid-assertion.
 */
const settle = async (rounds = 8) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};

/**
 * Mount inside an ASYNC `act`.
 *
 * A synchronous `act(() => root.render(…))` returns before the mount effects'
 * promises resolve, so the first `setState` from a rejected load lands outside
 * `act()` and React warns. The async form keeps the scope open across the
 * microtask checkpoint, which is what these tabs need — every one of them
 * starts a fetch in `useEffect`.
 */
const mount = async (Tab) => {
  await act(async () => {
    root.render(<MemoryRouter><ToastProvider><Tab /></ToastProvider></MemoryRouter>);
  });
};

/** A 500 with a response — `errorKind` classifies this as `server`. */
const serverError = () => Object.assign(new Error('boom'), {
  isAxiosError: true,
  response: { status: 500, data: { detail: 'boom' } },
});

describe('Graha tabs · a failed load renders an error, not an empty state', () => {
  TABS.forEach(([name, Tab, forbidden]) => {
    it(`${name} shows an error with a retry and never claims to be empty`, async () => {
      api.get.mockRejectedValue(serverError());

      await mount(Tab);
      await settle();

      const text = container.textContent;

      // The error is announced, not just toasted.
      expect(container.querySelector('[role="alert"]')).toBeTruthy();
      // And it offers a way out. A dead end is not an error state.
      expect(text).toContain('Try again');

      // The whole point: none of the "nothing here" copy may appear.
      forbidden.forEach(phrase => {
        expect(text).not.toContain(phrase);
      });
    });
  });
});

describe('Graha tabs · an error is distinguished from an outage', () => {
  it('classifies a rejection with no response as offline, not as a server fault', async () => {
    api.get.mockRejectedValue(Object.assign(new Error('network'), { isAxiosError: true }));

    await mount(ContactsTab);
    await settle();

    expect(container.querySelector('[role="alert"]').dataset.kind).toBe('offline');
  });

  it('names a denied grant rather than reporting a generic failure', async () => {
    api.get.mockRejectedValue(Object.assign(new Error('denied'), {
      isAxiosError: true,
      response: { status: 403, data: { detail: 'no' } },
    }));

    await mount(ContactsTab);
    await settle();

    expect(container.querySelector('[role="alert"]').dataset.kind).toBe('denied');
  });
});

describe('ActivitiesTab · the tab renders its own list', () => {
  it('calls the activities endpoint that the build never used', async () => {
    api.get.mockResolvedValue({ data: { data: [] } });

    await mount(ActivitiesTab);
    await settle();

    // It used to render a form and a sentence telling you to look elsewhere.
    const urls = api.get.mock.calls.map(c => c[0]);
    expect(urls.some(u => u.startsWith('/v1/graha/activities'))).toBe(true);
  });

  it('renders the rows the endpoint returns', async () => {
    api.get.mockImplementation((url) => {
      if (url.startsWith('/v1/graha/activities')) {
        return Promise.resolve({
          data: { data: [{ id: 'a1', activity_type: 'call', title: 'Called Wipro about renewal', is_completed: false, created_at: '2026-07-01T10:00:00Z' }] },
        });
      }
      return Promise.resolve({ data: { data: [] } });
    });

    await mount(ActivitiesTab);
    await settle();

    expect(container.textContent).toContain('Called Wipro about renewal');
  });
});
