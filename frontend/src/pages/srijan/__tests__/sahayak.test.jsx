/**
 * Sahayak — reachability first, then the four things the layout promises.
 *
 * The defect this file guards is not a rendering one. The chatbot was finished,
 * metered, grounded and billed, and NO ORG USER COULD REACH IT: `OrgSrijanPage`
 * had six tabs and none of them was the assistant. A test that only mounted
 * `SahayakTab` would have passed the whole time the product was broken, so the
 * first describe block mounts the PAGE and asserts the tab exists and is where
 * a bare `/hub/org` lands.
 *
 * The second block is about authorisation rather than markup. `hub_chat.py` has
 * no `/org/…` chat route; list and create are keyed to a `hub_clients` row
 * because `hub_chat_sessions.client_id` is NOT NULL (migration 017). The only
 * legitimate join is `GET /v1/hub/org-client`, which resolves the org's own
 * internal client. So the assertion is on the URLs that reach the server — that
 * the org client is resolved first, and that the agency's client DIRECTORY is
 * never asked for, because a client org has no directory to choose from.
 *
 * `createRoot` + `act` rather than @testing-library/react: it is installed but
 * its @testing-library/dom peer is not, so importing it throws. Same shape as
 * `contentTable.test.jsx`, which records the same constraint.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Every URL the component asked for, in order. */
let got = [];
let posted = [];
/** What each route answers with, set per test. */
let handlers = {};

/**
 * Routed most-specific-first, deliberately.
 *
 * A substring map keyed on `/chat/sessions` and `/messages` looks fine and is
 * not: `/v1/hub/chat/sessions/s1/messages` contains BOTH, so whichever key was
 * declared first wins and the thread quietly renders the session list. That is
 * a harness that lies about the component, which is worse than one that fails.
 */
function route(url) {
  const u = String(url);
  if (/\/messages$/.test(u)) return handlers.messages;
  if (/\/send$/.test(u)) return handlers.send;
  if (/\/chat\/sessions$/.test(u)) return handlers.sessions;
  if (u.includes('/org-client')) return handlers.orgClient;
  if (u.includes('/org/credits')) return handlers.credits;
  return {};
}

vi.mock('../../../lib/api', () => ({
  api: {
    get: vi.fn((url) => {
      got.push(String(url));
      return Promise.resolve({ data: route(url) ?? {} });
    }),
    post: vi.fn((url, body) => {
      posted.push([String(url), body]);
      return Promise.resolve({ data: route(url) ?? {} });
    }),
    put: vi.fn(() => Promise.resolve({ data: {} })),
    patch: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
  },
  rows: (r) => {
    const b = r?.data;
    if (Array.isArray(b)) return b;
    if (Array.isArray(b?.data)) return b.data;
    return [];
  },
  body: (r) => r?.data ?? {},
}));

vi.mock('../../../lib/auth', () => ({
  currentUser: () => ({
    user_id: 'u1',
    org_roles: [{ role_code: 'org_owner', org_name: 'Unicode Group' }],
  }),
}));

const { ToastProvider } = await import('../../../components/ui/toast');
const { default: SahayakTab } = await import('../SahayakTab');
const { default: OrgSrijanPage } = await import('../../OrgSrijanPage');
const { toCards } = await import('../sahayak/AnswerCards');
const { parseSources, provenanceOf, sourceFoot } = await import('../sahayak/sources');

let container = null;
let root = null;

beforeEach(() => {
  vi.clearAllMocks();
  got = [];
  posted = [];
  handlers = {};
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
});

const mount = (el) => act(() => root.render(
  <MemoryRouter><ToastProvider>{el}</ToastProvider></MemoryRouter>,
));

const settle = async (rounds = 8) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};
const text = () => container.textContent;
const all = sel => [...container.querySelectorAll(sel)];
const click = async (el) => { await act(async () => { el.click(); }); await settle(); };

/* The shapes the two endpoints really answer with. */
const ORG_CLIENT = { client: { id: 'cl-1', name: 'Unicode Group' }, brand: null };
const session = (id, over = {}) => ({
  id, title: `Chat ${id}`, message_count: 4,
  updated_at: new Date().toISOString(), ...over,
});
/** A knowledge-base source: numbered, because it was numbered into the prompt. */
const kbSource = (ref, title) => ({
  ref, chunk_id: `c${ref}`, title, source_type: 'file', similarity: 0.91,
});
/** A grounded web page: no `ref`, because nothing numbered it. */
const webSource = (url) => ({ title: 'CBIC', url, type: 'web' });

function serve({ sessions = [], messages = [], send = {} } = {}) {
  handlers = {
    orgClient: ORG_CLIENT,
    sessions: { data: sessions },
    messages: { data: messages },
    send,
    credits: { org_balance: { balance: 300, plan_credits: 1000, used: 12 } },
  };
}

/* ── 1 · It is reachable at all ──────────────────────────────────────────── */

describe('Sahayak is reachable from the org page', () => {
  it('puts a Sahayak tab on the strip, and opens on it', async () => {
    serve({ sessions: [] });
    await mount(<OrgSrijanPage />);
    await settle();

    const tabs = all('[role="tab"]').map(t => t.textContent.toLowerCase());
    expect(tabs.some(t => t.includes('sahayak'))).toBe(true);

    const selected = all('[role="tab"]').find(t => t.getAttribute('aria-selected') === 'true');
    expect(selected.textContent.toLowerCase()).toContain('sahayak');
  });

  it('mounts the assistant, not a placeholder — it resolves the org workspace', async () => {
    serve({ sessions: [] });
    await mount(<OrgSrijanPage />);
    await settle();
    expect(got.some(u => u.includes('/v1/hub/org-client'))).toBe(true);
    expect(text()).toContain('आपका सहायक — आपके काम का साथी');
  });

  it('keeps every existing deep link working', async () => {
    serve({ sessions: [] });
    await mount(<OrgSrijanPage />);
    await settle();
    const ids = all('[role="tab"]').map(t => t.id);
    for (const t of ['sahayak', 'skills', 'content', 'generate', 'data catalog', 'data runs', 'credits']) {
      expect(ids).toContain(`mt-tab-${t}`);
    }
  });
});

/* ── 2 · The endpoints an org user is actually authorised to hit ──────────── */

describe('it calls only routes an org member may call', () => {
  it('resolves the org internal client first, then lists that client’s sessions', async () => {
    serve({ sessions: [session('s1')] });
    await mount(<SahayakTab />);
    await settle();

    const orgClientAt = got.findIndex(u => u.includes('/v1/hub/org-client'));
    const sessionsAt = got.findIndex(u => u.includes('/v1/hub/clients/cl-1/chat/sessions'));
    expect(orgClientAt).toBeGreaterThanOrEqual(0);
    expect(sessionsAt).toBeGreaterThan(orgClientAt);
  });

  it('never asks for the agency client directory — a client org has none', async () => {
    serve({ sessions: [session('s1')] });
    await mount(<SahayakTab />);
    await settle();
    // `GET /v1/hub/clients` is the agency's own list of the orgs it works for.
    // Reaching for it here is the shape of the bug this whole surface replaces.
    expect(got.some(u => /\/v1\/hub\/clients(\?|$)/.test(u))).toBe(false);
  });

  it('says so plainly when the server returns no workspace', async () => {
    serve({});
    handlers.orgClient = { client: null };
    await mount(<SahayakTab />);
    await settle();
    expect(text()).toContain('no workspace to answer from yet');
    // And it does NOT go on to ask for `/clients/null/chat/sessions`.
    expect(got.some(u => u.includes('null'))).toBe(false);
  });
});

/* ── 3 · Memory: it holds the previous conversation ───────────────────────── */

describe('it holds the previous conversation rather than starting cold', () => {
  it('opens the most recent session and shows what was said', async () => {
    serve({
      sessions: [session('s-new', { title: 'GST deadlines' }), session('s-old')],
      messages: [
        { id: 'm1', role: 'user', content: 'Does Sanchay file monthly?' },
        { id: 'm2', role: 'assistant', content: 'Quarterly — Sanchay is on QRMP.', sources: [] },
      ],
    });
    await mount(<SahayakTab />);
    await settle();

    // The list comes back ORDER BY updated_at DESC, so the head is where the
    // person left off.
    expect(got.some(u => u.includes('/chat/sessions/s-new/messages'))).toBe(true);
    expect(text()).toContain('Does Sanchay file monthly?');
    expect(text()).toContain('Quarterly — Sanchay is on QRMP.');
    // Not the welcome screen — that is the empty state of a CONVERSATION.
    expect(text()).not.toContain('आपका सहायक — आपके काम का साथी');
  });

  it('shows the welcome screen, with its settled copy, when there is nothing to resume', async () => {
    serve({ sessions: [] });
    await mount(<SahayakTab />);
    await settle();
    expect(text()).toContain('आपका सहायक — आपके काम का साथी');
    expect(text()).toContain("What's due this month?");
    // Six openers in the DOM; the grid hides the tail per breakpoint rather
    // than reflowing it, so all six ship and CSS decides how many are seen.
    expect(all('.sh-op__b')).toHaveLength(6);
  });
});

/* ── 4 · Sources, in every shape they arrive in ───────────────────────────── */

describe('sources degrade gracefully and open one panel', () => {
  it('offers no Sources button for an answer that cited nothing', async () => {
    serve({
      sessions: [session('s1')],
      messages: [{ id: 'm2', role: 'assistant', content: 'An ungrounded answer.', sources: [] }],
    });
    await mount(<SahayakTab />);
    await settle();
    expect(all('.sh-foot__b--src')).toHaveLength(0);
  });

  it('reads a sources column that arrived as a JSON string', async () => {
    // db.py:82 warns rather than raises when PgBouncer drops the codec
    // handshake, and then asyncpg hands jsonb back as text. `GET …/messages`
    // returns the column straight from the row, so this is a real shape.
    serve({
      sessions: [session('s1')],
      messages: [{
        id: 'm2', role: 'assistant', content: 'Quarterly [1].',
        sources: JSON.stringify([kbSource(1, 'client-notes-sanchay.pdf')]),
      }],
    });
    await mount(<SahayakTab />);
    await settle();
    expect(all('.sh-foot__b--src')).toHaveLength(1);
    expect(container.querySelector('.sh-foot__b--src').textContent).toContain('1');
  });

  it('opens the split panel with the source an inline [1] names', async () => {
    serve({
      sessions: [session('s1')],
      messages: [{
        id: 'm2', role: 'assistant', content: 'On the 22nd [1], not the 20th.',
        sources: [kbSource(1, 'client-notes-sanchay.pdf'), webSource('https://www.cbic.gov.in/n/14')],
      }],
    });
    await mount(<SahayakTab />);
    await settle();

    expect(container.querySelector('.sh__src')).toBeNull();
    const cite = container.querySelector('.sh-cite');
    expect(cite).not.toBeNull();
    await click(cite);

    expect(container.querySelector('.sh__src')).not.toBeNull();
    const hot = all('.sh-sc.on');
    expect(hot).toHaveLength(1);
    expect(hot[0].textContent).toContain('client-notes-sanchay.pdf');
    // The panel opens as a THIRD column, not as an overlay on the thread.
    expect(container.querySelector('.sh__body').getAttribute('data-src')).toBe('1');
  });

  it('leaves a [9] with nothing behind it as text, not as a dead button', async () => {
    serve({
      sessions: [session('s1')],
      messages: [{
        id: 'm2', role: 'assistant', content: 'See [9] for more.',
        sources: [kbSource(1, 'notes.pdf')],
      }],
    });
    await mount(<SahayakTab />);
    await settle();
    expect(all('.sh-cite')).toHaveLength(0);
    expect(text()).toContain('See [9] for more.');
  });

  it('never gives a web source a citation number it was not cited by', () => {
    const parsed = parseSources([kbSource(1, 'a.pdf'), webSource('https://cbic.gov.in/x')]);
    expect(parsed[0].ref).toBe(1);
    expect(parsed[1].ref).toBeNull();
    expect(parsed[1].kind).toBe('web');
    expect(sourceFoot(parsed[1])).toBe('WEB · cbic.gov.in');
    expect(sourceFoot(parsed[0])).toBe('KB · file · 91% match');
  });

  it('survives every shape of nothing', () => {
    expect(parseSources(null)).toEqual([]);
    expect(parseSources('')).toEqual([]);
    expect(parseSources('not json')).toEqual([]);
    expect(parseSources('{}')).toEqual([]);
    expect(parseSources([null, 3, 'x'])).toEqual([]);
  });
});

/* ── 5 · One card ships; three need no rewrite ────────────────────────────── */

describe('answer cards', () => {
  it('renders exactly one card while the model returns prose', () => {
    const cards = toCards({ content: 'One block of prose.', sources: [] });
    expect(cards).toHaveLength(1);
    expect(cards[0].body).toBe('One block of prose.');
  });

  it('colours that one card by what actually grounded it', () => {
    expect(toCards({ content: 'x', sources: parseSources([kbSource(1, 'a')]) })[0].kind).toBe('files');
    expect(toCards({ content: 'x', sources: parseSources([webSource('https://a.b')]) })[0].kind).toBe('web');
    expect(toCards({ content: 'x', sources: [] })[0].kind).toBe('answer');
    expect(provenanceOf([])).toBe('answer');
  });

  it('renders three the day the model returns sections, with no rewrite', () => {
    const cards = toCards({
      content: 'ignored once sections exist',
      sources: [],
      sections: [
        { kind: 'files', title: 'Quarterly', body: 'GSTR-3B falls on the 22nd.' },
        { kind: 'web', body: 'The date moved in notification 2026/14.' },
        { kind: 'notice', body: 'Two other clients are on QRMP.' },
      ],
    });
    expect(cards.map(c => c.kind)).toEqual(['files', 'web', 'notice']);
    expect(cards[0].title).toBe('Quarterly');
  });

  it('degrades a kind it has never seen to a readable card rather than an unstyled one', () => {
    const cards = toCards({ content: 'x', sections: [{ kind: 'forecast', body: 'y' }] });
    expect(cards[0].kind).toBe('answer');
  });
});

/* ── 6 · Asking ───────────────────────────────────────────────────────────── */

describe('the composer', () => {
  it('creates the conversation on the first send, so nobody presses New chat first', async () => {
    serve({
      sessions: [],
      send: { message: 'Because it is on QRMP.', sources: [], model: 'gemini', credits_charged: 2 },
    });
    // The POST that creates a session answers on the same route as the GET
    // that lists them, and returns the new id.
    handlers.sessions = { data: [], id: 's-fresh' };
    await mount(<SahayakTab />);
    await settle();

    await click(container.querySelector('.sh-op__b'));

    const created = posted.find(([u]) => /\/clients\/cl-1\/chat\/sessions$/.test(u));
    expect(created).toBeTruthy();
    const sent = posted.find(([u]) => u.includes('/send'));
    expect(sent[0]).toContain('/chat/sessions/s-fresh/send');
    expect(sent[1].message).toBe("What's due this month?");
    expect(text()).toContain('Because it is on QRMP.');
  });

  it('shows what the answer cost, which nothing ever did', async () => {
    serve({
      sessions: [session('s1')],
      messages: [{
        id: 'm2', role: 'assistant', content: 'An answer.',
        sources: [], model_used: 'gemini-2.5-flash',
      }],
    });
    await mount(<SahayakTab />);
    await settle();
    expect(container.querySelector('.sh-ac__m').textContent).toContain('gemini-2.5-flash');
  });

  it('does not swallow the question when the conversation itself cannot be started', async () => {
    // The composer clears the input before it does anything, so a failure
    // BEFORE the optimistic bubble exists has nowhere to land: the question
    // disappears, no error is shown, and the person retypes it. This is the
    // ordering, asserted.
    serve({ sessions: [] });
    const { api } = await import('../../../lib/api');
    api.post.mockImplementationOnce(() => Promise.reject({
      response: { status: 500, data: { detail: 'The workspace is unavailable.' } },
    }));
    await mount(<SahayakTab />);
    await settle();

    await click(container.querySelector('.sh-op__b'));
    expect(text()).toContain("What's due this month?");
    expect(text()).toContain('Not delivered');
    expect(text()).toContain('The workspace is unavailable.');
  });

  it('reports a refused send in the thread, where the person is looking', async () => {
    serve({ sessions: [session('s1')], messages: [] });
    const { api } = await import('../../../lib/api');
    api.post.mockImplementationOnce(() => Promise.reject({
      response: { status: 402, data: { detail: 'This answer costs 2 credits; the org has 0.' } },
    }));
    await mount(<SahayakTab />);
    await settle();

    await click(container.querySelector('.sh-op__b'));
    expect(text()).toContain('Not delivered');
    expect(text()).toContain('This answer costs 2 credits; the org has 0.');
  });
});

/* ── 7 · Focus / Workbench ────────────────────────────────────────────────── */

describe('Focus and Workbench are one toggle with two positions', () => {
  it('Workbench is the conversation rail — and nothing else', async () => {
    serve({ sessions: [session('s1', { title: 'GST deadlines' })] });
    await mount(<SahayakTab />);
    await settle();

    expect(container.querySelector('.sh__body').getAttribute('data-mode')).toBe('work');
    expect(container.querySelector('.sh__rail')).not.toBeNull();
    expect(text()).toContain('GST deadlines');

    // The "what I can see" capability panel was in an earlier draft and the
    // owner removed it. RBAC still runs server-side; it is not narrated.
    expect(text()).not.toMatch(/what I can see/i);
  });

  it('Focus collapses the rail and nothing else', async () => {
    serve({ sessions: [session('s1')] });
    await mount(<SahayakTab />);
    await settle();

    const focus = all('.sh__mode').find(b => b.textContent === 'Focus');
    await click(focus);

    expect(container.querySelector('.sh__body').getAttribute('data-mode')).toBe('focus');
    expect(container.querySelector('.sh__rail')).toBeNull();
    // The composer is untouched by the toggle.
    expect(container.querySelector('.sh__ta')).not.toBeNull();
  });
});
