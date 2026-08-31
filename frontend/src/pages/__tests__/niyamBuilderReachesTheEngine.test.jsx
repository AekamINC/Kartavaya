/**
 * The Niyam builder must be able to build what the Niyam engine can run.
 *
 * ── THREE FINDINGS, SUITE 16 ON 2026-08-31 ─────────────────────────────────
 *
 * Every one of these is the same shape: the ENGINE grew a capability, the
 * SCREEN did not, and nothing failed. The rule stayed valid, the API stayed
 * correct, and a person simply could not get there.
 *
 *  16.02b  4 of the engine's 11 families had no filter chip — esign (4 events),
 *          marketing (2), payroll (2), whatsapp (1). A rule about a signature,
 *          a payslip, a campaign or a WhatsApp message was filterable only by
 *          scrolling "Everything". ⚠ `FAMILIES` recorded this as ALREADY FIXED
 *          ONCE in its own comment ("the registry grew three families after the
 *          first four chips shipped") — fixed by adding three literals, which
 *          left the mechanism intact and let it recur.
 *
 *  16.03   Verbs offered with no configuration at all. `ACTIONS` holds six;
 *          `ActionCard` rendered fields for two. Two of the remaining four are
 *          correct with none (`report.send` REFUSES a stray key;
 *          `invoice.remind_customer` takes no settings) — but `task.create` and
 *          `task.add_comment` are refused by `validate.py` WITHOUT config the
 *          screen offered no way to enter. Picking either produced a rule that
 *          could not be saved, with an error naming a field that was not there.
 *
 *  16.03b  `blankStep()` hardcoded `channel: 'inapp'` and no control existed,
 *          so no rule built on this screen could send email or push —
 *          `send.CHANNELS` has held all three since email graduated on
 *          2026-08-18 and `PLANNED_CHANNELS` is empty. This is also why quiet
 *          hours had no drivable path: they apply to the channels that
 *          INTERRUPT, and in-app is deliberately exempt, so every rule the UI
 *          could build was exempt by construction.
 *
 *  16.03c  The recipient picker offered `@assignees` and `@creator`.
 *          `actions.DB_TOKENS` also defines `@org_admins`, the engine resolves
 *          it against the database, and SIX shipped templates use it
 *          (metric-alert, stock-low, attendance-summary, invoice-paid,
 *          invoice-large, invoice-cancelled). Opening one of those showed a
 *          dropdown whose value was not among its options — the rule said
 *          "tell the org admins", the screen said "whoever it is assigned to".
 *
 * ── WHAT THESE TESTS ASSERT ────────────────────────────────────────────────
 *
 * Not "the chip list has eleven entries" — that is the assertion that passed
 * while four families were missing, because it was written against the list
 * rather than against the engine. Each test below drives the real page with a
 * catalogue and requires the SCREEN to cover what the CATALOGUE declares.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const get = vi.fn();
vi.mock('../../lib/api', () => ({
  api: {
    get: (...a) => get(...a),
    post: vi.fn(() => Promise.resolve({ data: {} })),
    put: vi.fn(() => Promise.resolve({ data: {} })),
    patch: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));
vi.mock('../../components/ui', async (orig) => {
  const real = await orig();
  return { ...real, useToast: () => ({ pushToast: vi.fn() }) };
});
vi.mock('react-router-dom', () => ({ Link: ({ children }) => <a href="#">{children}</a> }));

import NiyamPage from '../NiyamPage';

/** The engine's eleven families, with an event in each — counted off
 *  `services/niyam/registry.py` on 2026-08-31. The four that had no chip are
 *  last, and are the point of the file. */
const FAMILIES = [
  'task', 'approval', 'invoice', 'crm', 'sales', 'hr', 'analytics',
  'esign', 'payroll', 'marketing', 'whatsapp',
];

/** The six verbs in `services/niyam/actions.ACTIONS`. */
const ACTIONS = [
  'invoice.remind_customer', 'notify.send', 'report.send',
  'task.add_comment', 'task.create', 'task.set_status',
];

const CATALOG = {
  events: FAMILIES.map((family, i) => ({
    event_type: `${family}.thing_happened`,
    label: `Something ${family} happens`,
    family,
    temporal: false,
    fields: [{ key: 'title', label: 'Title', kind: 'text',
               options: [], operators: ['eq', 'contains'] }],
  })),
  actions: ACTIONS,
  teams: [
    { team_id: 't-1', name: 'Audit' },
    { team_id: 't-2', name: 'Tax' },
  ],
  flags: {},
};

beforeEach(() => {
  get.mockReset();
  get.mockImplementation((path) => {
    if (path.includes('/catalog')) return Promise.resolve({ data: CATALOG });
    if (path.includes('/templates')) return Promise.resolve({ data: { templates: [] } });
    if (path.includes('/rules')) return Promise.resolve({ data: { rules: [], flags: {} } });
    return Promise.resolve({ data: {} });
  });
});

async function openPage() {
  render(<NiyamPage />);
  await waitFor(() => expect(get).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
}

/** Every filter chip on screen, by its `data-family`. */
function chipKeys() {
  return [...document.querySelectorAll('.niyam-chip')]
    .map((el) => el.getAttribute('data-family') || 'all');
}

// ── 16.02b ─────────────────────────────────────────────────────────────────

describe('every family the engine declares has a chip', () => {
  it('covers all eleven, not the seven that were hardcoded', async () => {
    await openPage();
    const missing = FAMILIES.filter((f) => !chipKeys().includes(f));
    expect(missing, `families with no way to filter to them: ${missing}`)
      .toEqual([]);
  });

  it('the four 16.02b named are there BY NAME', async () => {
    await openPage();
    for (const f of ['esign', 'payroll', 'marketing', 'whatsapp']) {
      expect(chipKeys(), `${f} has no chip`).toContain(f);
    }
  });

  it('a family the engine has not declared gets NO chip', async () => {
    // The other direction. A chip list that simply printed every label this
    // file knows would pass every assertion above and offer filters that match
    // nothing.
    get.mockImplementation((path) => {
      if (path.includes('/catalog')) {
        return Promise.resolve({ data: {
          ...CATALOG,
          events: CATALOG.events.filter((e) => e.family === 'task'),
        } });
      }
      if (path.includes('/templates')) return Promise.resolve({ data: { templates: [] } });
      return Promise.resolve({ data: { rules: [], flags: {} } });
    });
    await openPage();
    expect(chipKeys().sort()).toEqual(['all', 'task']);
  });

  it('a family with no label still gets a chip, title-cased', async () => {
    // An ugly chip is a bug someone fixes; a missing chip is a feature nobody
    // can find. A new family must never be silently unreachable again.
    get.mockImplementation((path) => {
      if (path.includes('/catalog')) {
        return Promise.resolve({ data: {
          ...CATALOG,
          events: [{ event_type: 'x.y', label: 'X', family: 'supply_chain',
                     temporal: false, fields: [] }],
        } });
      }
      if (path.includes('/templates')) return Promise.resolve({ data: { templates: [] } });
      return Promise.resolve({ data: { rules: [], flags: {} } });
    });
    await openPage();
    expect(chipKeys()).toContain('supply_chain');
    expect(screen.getByText('Supply chain')).toBeInTheDocument();
  });

  it('Everything is still first', async () => {
    await openPage();
    expect(chipKeys()[0]).toBe('all');
  });
});

// ── 16.03 / 16.03b / 16.03c ────────────────────────────────────────────────

/** Open the rule builder on a new rule, add one action step, and return the
 *  verb picker. A new rule starts with no steps — "Add then" is the control
 *  that appends one, named off `KIND_LABEL.action`. */
async function openBuilder() {
  await openPage();
  fireEvent.click(screen.getByRole('button', { name: /new rule/i }));
  await waitFor(() => expect(
    screen.getByLabelText('When this happens')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: /^Add then$/i }));
  await waitFor(() => expect(
    screen.getByLabelText('What this rule does')).toBeInTheDocument());
  return screen.getByLabelText('What this rule does');
}

function pickVerb(select, verb) {
  fireEvent.change(select, { target: { value: verb } });
}

describe('a verb the engine offers can be configured on screen', () => {
  it('every verb in the catalogue renders SOMETHING — a field or a sentence',
     async () => {
    const select = await openBuilder();
    for (const verb of ACTIONS) {
      pickVerb(select, verb);
      const card = select.closest('.niyam-action');
      const controls = card.querySelectorAll('input, textarea, select');
      const prose = card.querySelector('.niyam-muted');
      // `select` itself is one control — the verb picker. More than that, or a
      // sentence explaining why not, is the requirement.
      expect(controls.length > 1 || prose,
             `${verb} renders an empty card: neither a field nor an explanation`)
        .toBeTruthy();
    }
  });

  it('task.create offers the title and the project validate.py demands',
     async () => {
    const select = await openBuilder();
    pickVerb(select, 'task.create');
    expect(screen.getByLabelText('Task title')).toBeInTheDocument();
    const project = screen.getByLabelText('In which project');
    // From the catalogue, not a hardcoded list — the backend now serves it.
    expect(within(project).getByText('Audit')).toBeInTheDocument();
    expect(within(project).getByText('Tax')).toBeInTheDocument();
  });

  it('task.add_comment offers the body validate.py demands', async () => {
    const select = await openBuilder();
    pickVerb(select, 'task.add_comment');
    expect(screen.getByLabelText('Comment')).toBeInTheDocument();
  });

  it('the two verbs that need nothing SAY so rather than showing an empty box',
     async () => {
    const select = await openBuilder();
    for (const verb of ['report.send', 'invoice.remind_customer']) {
      pickVerb(select, verb);
      expect(screen.getByText(/takes no settings/i),
             `${verb} shows an empty card`).toBeInTheDocument();
    }
  });

  it('switching verb does not carry the old verb\'s keys across', async () => {
    // `report.send` refuses a stray key outright — "report.send takes no
    // settings — remove: …" — so a notification changed into a report send was
    // unsaveable with an error about a field no longer on screen.
    const select = await openBuilder();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'hi' } });
    pickVerb(select, 'report.send');
    pickVerb(select, 'notify.send');
    expect(screen.getByLabelText('Title')).toHaveValue('');
  });
});

describe('a notification can name a channel and the org admins', () => {
  it('offers all three deliverable channels', async () => {
    const select = await openBuilder();
    const how = screen.getByLabelText('How');
    for (const v of ['inapp', 'push', 'email']) {
      expect([...how.options].map((o) => o.value),
             `channel ${v} cannot be chosen`).toContain(v);
    }
  });

  it('quiet hours are reachable at all — the channels they apply to exist',
     async () => {
    // Quiet hours suppress the channels that INTERRUPT. In-app is exempt by
    // design, so while `inapp` was the only buildable channel there was no rule
    // in the product that quiet hours could act on.
    await openBuilder();
    const how = screen.getByLabelText('How');
    const interrupting = [...how.options]
      .map((o) => o.value).filter((v) => v !== 'inapp');
    expect(interrupting.length).toBeGreaterThan(0);
  });

  it('offers @org_admins — six shipped templates use it', async () => {
    await openBuilder();
    const who = screen.getByLabelText('Who is notified');
    expect([...who.options].map((o) => o.value)).toContain('@org_admins');
  });

  it('still offers the two payload tokens', async () => {
    await openBuilder();
    const who = screen.getByLabelText('Who is notified');
    const values = [...who.options].map((o) => o.value);
    expect(values).toContain('@assignees');
    expect(values).toContain('@creator');
  });
});
