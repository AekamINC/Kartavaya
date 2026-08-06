/**
 * Sahayak — reachability, authorisation, and the structure the prototype draws.
 *
 * The defect the first block guards is not a rendering one. The chatbot was
 * finished, metered, grounded and billed, and NO ORG USER COULD REACH IT:
 * `OrgSahayakPage` had six tabs and none of them was the assistant. A test that
 * only mounted `SahayakTab` would have passed the whole time the product was
 * broken, so the first describe block mounts the PAGE.
 *
 * The rest is about the surface being the one `design-reference/Kartavaya
 * Redesign/sahayak.css` draws, not the one that shipped before it. Those two
 * share a three-letter prefix and agree on almost no class name, so asserting
 * "a reply rendered" would pass on either. The assertions below are on the
 * prototype's own vocabulary — `.sh__turn`, `.sh__you`, `.sh__a-av--mark`,
 * `.sh__p`, `.sh__side`, `.sh--wide`, `.sh__cp-box` — and on the two structural
 * facts that are easy to regress silently: that the panel is PRESENT rather than
 * behind a button, and that `.sh--wide` is what its absence looks like.
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
const { default: SahayakTab, toTurns, atLabel } = await import('../SahayakTab');
const { default: OrgSahayakPage } = await import('../../OrgSahayakPage');
const { blocksOf, costLine } = await import('../assistant/AnswerBody');
const { parseSources, sourceFoot } = await import('../assistant/sources');

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
const one = sel => container.querySelector(sel);
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
    await mount(<OrgSahayakPage />);
    await settle();

    const tabs = all('[role="tab"]').map(t => t.textContent.toLowerCase());
    expect(tabs.some(t => t.includes('sahayak'))).toBe(true);

    const selected = all('[role="tab"]').find(t => t.getAttribute('aria-selected') === 'true');
    expect(selected.textContent.toLowerCase()).toContain('sahayak');
  });

  it('mounts the assistant, not a placeholder — it resolves the org workspace', async () => {
    serve({ sessions: [] });
    await mount(<OrgSahayakPage />);
    await settle();
    expect(got.some(u => u.includes('/v1/hub/org-client'))).toBe(true);
    expect(one('.sh')).not.toBeNull();
    expect(one('.sh__cp-box')).not.toBeNull();
  });

  it('keeps every existing deep link working', async () => {
    serve({ sessions: [] });
    await mount(<OrgSahayakPage />);
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

/* ── 3 · The surface is the prototype's, not the one it replaced ──────────── */

describe('the frame is the prototype’s two-column grid', () => {
  it('has no in-surface chrome bar and no Focus/Workbench toggle', async () => {
    serve({ sessions: [session('s1')] });
    await mount(<SahayakTab />);
    await settle();

    // Every one of these is a class from the build this replaces. The prototype
    // puts the module header in the tab shell above `.sh` and has one layout.
    for (const dead of ['.sh__chrome', '.sh__modes', '.sh__mode', '.sh__body', '.sh-ac', '.sh-cite', '.sh-foot']) {
      expect(all(dead)).toHaveLength(0);
    }
    expect(one('.sh__main')).not.toBeNull();
    expect(one('.sh__thread')).not.toBeNull();
  });

  it('draws the empty state as the prototype does — lotus, wordmark, seeds', async () => {
    serve({ sessions: [] });
    await mount(<SahayakTab />);
    await settle();

    // 29 §6: the lotus is the only waiting state, and it is the empty state too.
    expect(one('.sh__hero-mark .bl')).not.toBeNull();
    expect(one('.sh__hero-hi').textContent).toBe('सहायक');
    expect(one('.sh__hero-hi').getAttribute('lang')).toBe('hi');
    expect(all('.sh__seed')).toHaveLength(6);
    // 24-bilingual-devanagari.md: `lang` is what stops a screen reader
    // announcing Hindi with English phonemes.
    const dev = all('.sh__seed--dev b');
    expect(dev).toHaveLength(2);
    expect(dev.every(b => b.getAttribute('lang') === 'hi')).toBe(true);
  });

  it('groups each question with the reply it produced, in one .sh__turn', async () => {
    serve({
      sessions: [session('s-new', { title: 'GST deadlines' })],
      messages: [
        { id: 'm1', role: 'user', content: 'Does Sanchay file monthly?', created_at: '2026-08-06T06:08:00Z' },
        { id: 'm2', role: 'assistant', content: 'Quarterly — Sanchay is on QRMP.', sources: [] },
      ],
    });
    await mount(<SahayakTab />);
    await settle();

    // The list comes back ORDER BY updated_at DESC, so the head is where the
    // person left off.
    expect(got.some(u => u.includes('/chat/sessions/s-new/messages'))).toBe(true);

    const turns = all('.sh__turn');
    expect(turns).toHaveLength(1);
    expect(turns[0].querySelector('.sh__you').textContent).toBe('Does Sanchay file monthly?');
    expect(turns[0].querySelector('.sh__a-b .sh__p').textContent)
      .toContain('Quarterly — Sanchay is on QRMP.');
    // The reply is prose on the canvas, not a provenance-coloured card.
    expect(turns[0].querySelector('.sh-ac')).toBeNull();
    // The lotus sits at rest beside the finished reply — one per answer, and it
    // is BrandLoader rather than a second spinner drawn for this screen.
    expect(turns[0].querySelectorAll('.sh__a-av--mark .bl')).toHaveLength(1);
    // Not the welcome screen — that is the empty state of a CONVERSATION.
    expect(one('.sh__hero')).toBeNull();
  });

  it('stamps the question with the time the server stored it', async () => {
    serve({
      sessions: [session('s1')],
      messages: [{ id: 'm1', role: 'user', content: 'Hi', created_at: '2026-08-06T06:08:00Z' }],
    });
    await mount(<SahayakTab />);
    await settle();
    const at = one('.sh__me-l');
    expect(at).not.toBeNull();
    expect(at.textContent).toBe(atLabel('2026-08-06T06:08:00Z'));
    expect(at.textContent).toMatch(/\d/);
  });

  it('pairs a question with two consecutive replies rather than orphaning one', () => {
    const turns = toTurns([
      { id: 'a', role: 'user' }, { id: 'b', role: 'assistant' }, { id: 'c', role: 'assistant' },
      { id: 'd', role: 'user' },
    ]);
    expect(turns).toHaveLength(2);
    expect(turns[0].answers.map(m => m.id)).toEqual(['b', 'c']);
    expect(turns[1].answers).toEqual([]);
    // A thread whose first stored row is an answer still renders it.
    expect(toTurns([{ id: 'z', role: 'assistant' }])[0].answers.map(m => m.id)).toEqual(['z']);
  });
});

/* ── 4 · The panel is permanent, and .sh--wide is its absence ─────────────── */

describe('the sources panel is a column, not a disclosure', () => {
  it('is absent and the frame goes wide when the answer cited nothing', async () => {
    serve({
      sessions: [session('s1')],
      messages: [{ id: 'm2', role: 'assistant', content: 'An ungrounded answer.', sources: [] }],
    });
    await mount(<SahayakTab />);
    await settle();

    expect(one('.sh__side')).toBeNull();
    expect(one('.sh').className).toContain('sh--wide');
    // 29 §2 rule 1 — an answer that cannot point at where it came from says so.
    expect(one('.sh-none')).not.toBeNull();
    expect(text()).toContain('Nothing was cited for this answer');
  });

  it('is present, with no button to reveal it, when the answer cited records', async () => {
    serve({
      sessions: [session('s1')],
      messages: [{
        id: 'm2', role: 'assistant', content: 'On the 22nd [1], not the 20th.',
        sources: [kbSource(1, 'client-notes-sanchay.pdf'), webSource('https://www.cbic.gov.in/n/14')],
      }],
    });
    await mount(<SahayakTab />);
    await settle();

    expect(one('.sh').className).not.toContain('sh--wide');
    expect(one('.sh__side')).not.toBeNull();
    expect(all('.sh-src')).toHaveLength(2);
    // The panel never closes, so nothing opens it and nothing closes it.
    expect(one('.sh__side-x')).toBeNull();
    expect(all('.sh-src.on')).toHaveLength(0);
    // A grounded answer is not accused of citing nothing.
    expect(one('.sh-none')).toBeNull();
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
    expect(all('.sh-src')).toHaveLength(1);
    expect(one('.sh-src').textContent).toContain('client-notes-sanchay.pdf');
  });

  it('highlights the card an inline cite names, and the cite is a real control', async () => {
    serve({
      sessions: [session('s1')],
      messages: [{
        id: 'm2', role: 'assistant', content: 'On the 22nd [1], not the 20th [2].',
        sources: [kbSource(1, 'sanchay.pdf'), kbSource(2, 'circular.pdf')],
      }],
    });
    await mount(<SahayakTab />);
    await settle();

    const cites = all('.sh__p cite');
    expect(cites).toHaveLength(2);
    // A `<cite>` is neither focusable nor clickable on its own, and the whole
    // point of the marker is that it opens the record.
    expect(cites[1].getAttribute('role')).toBe('button');
    expect(cites[1].getAttribute('tabindex')).toBe('0');
    expect(cites[1].getAttribute('aria-label')).toBe('Source 2');
    expect(cites[1].getAttribute('title')).toBe('circular.pdf');

    await click(cites[1]);
    const hot = all('.sh-src.on');
    expect(hot).toHaveLength(1);
    expect(hot[0].textContent).toContain('circular.pdf');
    expect(cites[1].className).toBe('on');
  });

  it('leaves a [9] with nothing behind it as text, not as a dead control', async () => {
    serve({
      sessions: [session('s1')],
      messages: [{
        id: 'm2', role: 'assistant', content: 'See [9] for more.',
        sources: [kbSource(1, 'notes.pdf')],
      }],
    });
    await mount(<SahayakTab />);
    await settle();
    expect(all('.sh__p cite')).toHaveLength(0);
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

/* ── 5 · The answer body renders only what the server sent ────────────────── */

describe('the answer body', () => {
  it('splits the reply into one bordered block per paragraph', () => {
    const blocks = blocksOf({ content: 'First para.\n\nSecond para.\n\n\nThird.' });
    expect(blocks.map(b => b.body)).toEqual(['First para.', 'Second para.', 'Third.']);
  });

  it('takes sections the day the schema returns them, with no rewrite', () => {
    const blocks = blocksOf({
      content: 'ignored once sections exist',
      sections: [
        { title: 'Quarterly', body: 'GSTR-3B falls on the 22nd.' },
        { body: 'The date moved in notification 2026/14.' },
      ],
    });
    expect(blocks).toHaveLength(2);
    expect(blocks[0].title).toBe('Quarterly');
    expect(blocks[1].title).toBe('');
  });

  it('prints no figure the server did not return', () => {
    // 29 §8 and §3: never render a number with no provenance. Both of these
    // are dropped — one has no value, one has no route behind it.
    expect(costLine({ model: '', credits: null, sources: [] })).toBe('');
    expect(costLine({ model: 'gemini-2.5-flash', credits: 2, sources: [{}] }))
      .toBe('gemini-2.5-flash · 2 credits · 1 record read');
    expect(costLine({ model: 'x', credits: 0, sources: [] })).toBe('x');
  });

  it('draws no work steps and no figures, because the send route returns none', async () => {
    serve({
      sessions: [session('s1')],
      messages: [{ id: 'm2', role: 'assistant', content: 'An answer.', sources: [], model_used: 'gemini-2.5-flash' }],
    });
    await mount(<SahayakTab />);
    await settle();
    // The markup and the CSS are here; the fields are not, so nothing is drawn.
    // Inventing a step list or a figure would be the one thing 29 §3 forbids.
    expect(all('.sh__work')).toHaveLength(0);
    expect(all('.sh__fig')).toHaveLength(0);
    // What the answer cost IS returned, and was never shown before.
    expect(one('.sh__cost').textContent).toContain('gemini-2.5-flash');
  });

  it('draws the steps and figures it is given, when it is given them', async () => {
    serve({
      sessions: [session('s1')],
      messages: [{
        id: 'm2', role: 'assistant', content: 'Six customers are past 45 days.', sources: [],
        work: [{ state: 'done', label: 'Read overdue invoices', fn: 'find_overdue_invoices · free' }],
        figs: [
          { label: 'Past 45 days', value: '₹18.4 L', sub: 'across 6 customers', src: 'GET /v1/ganit/invoices?overdue_gt=45' },
          { label: 'No route', value: '3' },
        ],
      }],
    });
    await mount(<SahayakTab />);
    await settle();

    expect(all('.sh__work-r')).toHaveLength(1);
    expect(one('.sh__work-r code').textContent).toBe('find_overdue_invoices · free');
    // A figure with no route behind it is dropped, not shown without one.
    expect(all('.sh__fig')).toHaveLength(1);
    expect(one('.sh__fig').getAttribute('title')).toBe('GET /v1/ganit/invoices?overdue_gt=45');
    expect(one('.sh__fig-v').textContent).toBe('₹18.4 L');
  });

  it('renders model output as elements, never as HTML', async () => {
    serve({
      sessions: [session('s1')],
      messages: [{ id: 'm2', role: 'assistant', content: '<img src=x onerror=alert(1)>', sources: [] }],
    });
    await mount(<SahayakTab />);
    await settle();
    expect(one('.sh__p img')).toBeNull();
    expect(one('.sh__p').textContent).toContain('<img src=x onerror=alert(1)>');
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

    await click(one('.sh__seed'));

    const created = posted.find(([u]) => /\/clients\/cl-1\/chat\/sessions$/.test(u));
    expect(created).toBeTruthy();
    const sent = posted.find(([u]) => u.includes('/send'));
    expect(sent[0]).toContain('/chat/sessions/s-fresh/send');
    expect(sent[1].message).toBe("What's due this month?");
    expect(one('.sh__p').textContent).toContain('Because it is on QRMP.');
    expect(one('.sh__you').textContent).toBe("What's due this month?");
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

    await click(one('.sh__seed'));
    expect(one('.sh__you').textContent).toBe("What's due this month?");
    expect(one('.sh__you').className).toContain('sh__you--failed');
    expect(one('.sh__fail').textContent).toContain('The workspace is unavailable.');
  });

  it('reports a refused send in the thread, where the person is looking', async () => {
    serve({ sessions: [session('s1')], messages: [] });
    const { api } = await import('../../../lib/api');
    api.post.mockImplementationOnce(() => Promise.reject({
      response: { status: 402, data: { detail: 'This answer costs 2 credits; the org has 0.' } },
    }));
    await mount(<SahayakTab />);
    await settle();

    await click(one('.sh__seed'));
    expect(one('.sh__fail').textContent).toContain('This answer costs 2 credits; the org has 0.');
  });
});

/* ── 7 · The rail, which is the one thing here the prototype does not have ─── */

describe('the conversation rail survives, closed', () => {
  it('is closed on first paint, so the default surface is the prototype', async () => {
    serve({ sessions: [session('s1', { title: 'GST deadlines' })] });
    await mount(<SahayakTab />);
    await settle();

    expect(one('.sh__rail')).toBeNull();
    expect(one('.sh__scrim')).toBeNull();
    // It takes the slot the prototype gives `.sh__scope`, which narrates the
    // RBAC filter — 29 §2 rule 3 says not to.
    expect(one('.sh__scope')).toBeNull();
    expect(one('.sh__hist')).not.toBeNull();
    expect(one('.sh__hist').getAttribute('aria-expanded')).toBe('false');
  });

  it('opens on the composer control and still reaches every past conversation', async () => {
    serve({ sessions: [session('s1', { title: 'GST deadlines' }), session('s2')] });
    await mount(<SahayakTab />);
    await settle();

    await click(one('.sh__hist'));
    expect(one('.sh__rail')).not.toBeNull();
    expect(all('.sh-si')).toHaveLength(2);
    expect(text()).toContain('GST deadlines');
    // The session the thread is on is the marked row.
    expect(all('.sh__row.on')).toHaveLength(1);
  });

  /**
   * The rail is a leading GRID TRACK now, not a drawer floating over the
   * thread, and the track only exists while it is open. `.sh--rail` is the
   * whole mechanism: without it on `.sh` the stylesheet has two columns and the
   * rail lands wherever auto-placement puts it. Asserted here because it is a
   * class the component composes at runtime, which is exactly the kind
   * check-classes.mjs cannot see.
   */
  it('adds the third track while it is open and takes it away again', async () => {
    serve({ sessions: [session('s1')] });
    await mount(<SahayakTab />);
    await settle();

    expect(one('.sh').className).not.toContain('sh--rail');
    await click(one('.sh__hist'));
    expect(one('.sh').className).toContain('sh--rail');
    // The prototype's own two modifiers are untouched by it: this answer cited
    // nothing, so the surface is still wide.
    expect(one('.sh').className).toContain('sh--wide');

    await click(one('.sh__hist'));
    expect(one('.sh').className).not.toContain('sh--rail');
    expect(one('.sh__rail')).toBeNull();
  });

  it('closes on its own control, which is the only way out where there is no scrim', async () => {
    // Above 1280px the rail is a track and `.sh__scrim` never paints, so the
    // header control and Escape are the two ways to close it. The scrim is
    // aria-hidden and tabIndex -1, so it was never one for a keyboard.
    serve({ sessions: [session('s1')] });
    await mount(<SahayakTab />);
    await settle();

    await click(one('.sh__hist'));
    expect(one('.sh__rail-x')).not.toBeNull();
    await click(one('.sh__rail-x'));
    expect(one('.sh__rail')).toBeNull();
    expect(one('.sh__hist').getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on Escape', async () => {
    serve({ sessions: [session('s1')] });
    await mount(<SahayakTab />);
    await settle();

    await click(one('.sh__hist'));
    expect(one('.sh__rail')).not.toBeNull();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await settle();
    expect(one('.sh__rail')).toBeNull();
  });

  it('opens the conversation it was pointed at, and shuts on the way', async () => {
    // The one behaviour a restyle is most likely to break silently: the row is
    // a button, it loads that session's messages, and the rail gets out of the
    // way afterwards.
    serve({
      sessions: [session('s1', { title: 'GST deadlines' }), session('s2', { title: 'Payroll' })],
      messages: [{ id: 'm1', role: 'user', content: 'Anything on payroll?' }],
    });
    await mount(<SahayakTab />);
    await settle();

    await click(one('.sh__hist'));
    const rows = all('.sh-si');
    await click(rows[1]);
    expect(got.some(u => u.includes('/chat/sessions/s2/messages'))).toBe(true);
    expect(one('.sh__rail')).toBeNull();
    expect(one('.sh').className).not.toContain('sh--rail');
  });

  it('still asks before destroying the answers as well as the questions', async () => {
    serve({ sessions: [session('s1')] });
    await mount(<SahayakTab />);
    await settle();

    await click(one('.sh__hist'));
    await click(one('.sh-si__x'));
    expect(text()).toContain('Delete this conversation permanently?');

    const { api } = await import('../../../lib/api');
    const del = all('.sh__confirm-act .btn').find(b => b.textContent === 'Delete');
    await click(del);
    expect(api.delete).toHaveBeenCalledWith('/v1/hub/chat/sessions/s1');
  });
});
