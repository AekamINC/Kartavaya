/**
 * The assistant SHELL — the five things the owner said were missing.
 *
 * Verbatim, on a screenshot of this surface: "why full page where is the option
 * of switching view? and where the sidemenu to see previous chat?"
 *
 * `sahayak.test.jsx` guards the prototype's geometry and the answer contract.
 * This file guards the shell around them, and every block below corresponds to
 * one thing that was demonstrably absent or unreachable before 2026-08-06:
 *
 *   1. the conversation rail did not survive a reload, and neither did the
 *      conversation you were reading — it always reopened the newest
 *   2. there was no view switch at all
 *   3. `.sh__fb` was declared, styled, and held in the orphan baseline with no
 *      consumer: no answer could be marked right or wrong
 *   4. the evidence pane had no switch
 *   5. `sahayak.css` set `display: none` on `.sh__side` below 768px, so on a
 *      phone no answer could point at where it came from
 *
 * `createRoot` + `act` rather than @testing-library/react — installed, but its
 * @testing-library/dom peer is not, so importing it throws. Same constraint the
 * two sibling suites record.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let got = [];
let posted = [];
let handlers = {};

/** Most-specific-first, for the reason sahayak.test.jsx spells out: a substring
 *  map lets `/chat/sessions/s1/messages` be routed as the session list. */
function route(url) {
  const u = String(url);
  if (/skills\/feedback$/.test(u)) return handlers.feedback;
  if (/\/messages$/.test(u)) return handlers.messages;
  if (/\/hub\/chat$/.test(u)) return handlers.send;
  if (/\/chat\/sessions$/.test(u)) return handlers.sessions;
  if (u.includes('/org-client')) return handlers.orgClient;
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
      if (/skills\/feedback$/.test(String(url)) && handlers.feedbackFails) {
        return Promise.reject({ response: { status: 500 } });
      }
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
const { default: SahayakTab, newestFirst, lastTouched } = await import('../SahayakTab');
const { isServerAnswer, feedbackBody, FEEDBACK_PATH } = await import('../assistant/feedback');
const { readShell, writeShell, railDefault, viewOf, sessionOf, evidenceOf } =
  await import('../assistant/prefs');

let container = null;
let root = null;

beforeEach(() => {
  vi.clearAllMocks();
  got = [];
  posted = [];
  handlers = {};
  // A preference suite that inherits the previous test's storage is a suite that
  // passes for the wrong reason exactly once and then never again.
  window.localStorage.clear();
  delete window.matchMedia;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
  window.localStorage.clear();
  delete window.matchMedia;
});

const tree = (el) => <MemoryRouter><ToastProvider>{el}</ToastProvider></MemoryRouter>;
const mount = (el) => act(() => root.render(tree(el)));
const settle = async (rounds = 8) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};
/** A reload: the component goes away, localStorage does not. */
const reload = async (el) => {
  await act(async () => { root.unmount(); });
  root = createRoot(container);
  await mount(el);
  await settle();
};
const all = sel => [...container.querySelectorAll(sel)];
const one = sel => container.querySelector(sel);
const click = async (el) => { await act(async () => { el.click(); }); await settle(); };
const byText = (sel, s) => all(sel).find(e => e.textContent.trim() === s);

/** A viewport wide enough for the rail to be a track rather than an overlay. */
function widthIs(wide) {
  window.matchMedia = (q) => ({
    matches: wide && String(q).includes('1280'),
    media: String(q),
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
  });
}

const ORG_CLIENT = { client: { id: 'cl-1', name: 'Unicode Group' }, brand: null };
const DAY = 86400000;
const session = (id, title, ageDays = 0) => ({
  id, title, message_count: 4,
  updated_at: new Date(Date.now() - ageDays * DAY).toISOString(),
});
/** Real ids are UUIDs, because Postgres made them. The screen also mints
 *  `local-…` and `reply-…` ids, which are the ones feedback must refuse. */
const A1 = '3f6c0c9e-1a2b-4c3d-8e4f-5a6b7c8d9e0f';
const Q1 = '9e0f5a6b-7c8d-4e4f-8c3d-1a2b3f6c0c9e';
const kbSource = (ref, title) => ({
  ref, chunk_id: `c${ref}`, title, source_type: 'file', similarity: 0.91,
});
const EVIDENCE = {
  cols: ['Invoice', 'Client', 'Amount'],
  rows: [['INV-2101', 'Unicode Group', '48000'], ['INV-2102', 'Unicode Group', '12500']],
  src: 'ganit.invoices', truncated: false, total: 2,
};

function serve({ sessions = [], messages = [], send = {}, feedbackFails = false } = {}) {
  handlers = {
    orgClient: ORG_CLIENT,
    sessions: { data: sessions },
    messages: { data: messages },
    send,
    feedback: { status: 'recorded', id: 'fb-1' },
    feedbackFails,
  };
}

/** One answered question, reloaded from the server, with a real message id. */
const ANSWERED = [
  { id: Q1, role: 'user', content: 'What is due this month?', created_at: '2026-08-01T10:00:00Z' },
  {
    id: A1, role: 'assistant', content: 'Two filings are due [1].',
    sources: [kbSource(1, 'GSTR-1 calendar')], model_used: 'gemini-flash',
    created_at: '2026-08-01T10:00:04Z',
  },
];

/* ── 1 · The rail is findable, and it stays where it was put ─────────────── */

describe('the conversation rail persists', () => {
  it('opens itself where it is a track and costs the thread nothing', async () => {
    widthIs(true);
    serve({ sessions: [session('s1', 'Filings')] });
    await mount(<SahayakTab />);
    await settle();

    expect(one('.sh--rail')).not.toBeNull();
    expect(one('.sh__rail')).not.toBeNull();
    // The new-chat affordance is in the rail, not hidden behind a menu.
    expect(one('.sh__new')).not.toBeNull();
  });

  it('leaves it shut where it would be an overlay over the thread', async () => {
    widthIs(false);
    serve({ sessions: [session('s1', 'Filings')] });
    await mount(<SahayakTab />);
    await settle();
    expect(one('.sh--rail')).toBeNull();
  });

  it('remembers that it was opened, across a reload', async () => {
    widthIs(false);
    serve({ sessions: [session('s1', 'Filings')] });
    await mount(<SahayakTab />);
    await settle();
    expect(one('.sh__rail')).toBeNull();

    await click(one('.sh__hist'));
    expect(one('.sh__rail')).not.toBeNull();

    await reload(<SahayakTab />);
    expect(one('.sh__rail')).not.toBeNull();
    expect(readShell().rail).toBe(true);
  });

  it('remembers that it was CLOSED, even on a screen that would open it', async () => {
    widthIs(true);
    serve({ sessions: [session('s1', 'Filings')] });
    await mount(<SahayakTab />);
    await settle();
    expect(one('.sh__rail')).not.toBeNull();

    await click(one('.sh__rail-x'));
    expect(one('.sh__rail')).toBeNull();

    await reload(<SahayakTab />);
    expect(one('.sh__rail')).toBeNull();
  });

  it('lists conversations newest first even when the server does not', async () => {
    widthIs(true);
    serve({
      sessions: [
        session('s-old', 'Last week', 6),
        session('s-new', 'This morning', 0),
        session('s-mid', 'Tuesday', 2),
      ],
    });
    await mount(<SahayakTab />);
    await settle();

    expect(all('.sh-si__t').map(e => e.textContent))
      .toEqual(['This morning', 'Tuesday', 'Last week']);
  });

  it('reopens the conversation that was being READ, not merely the newest', async () => {
    widthIs(true);
    writeShell({ session: 's-old' });
    serve({ sessions: [session('s-new', 'This morning', 0), session('s-old', 'Last week', 6)] });
    await mount(<SahayakTab />);
    await settle();

    expect(got.some(u => u.includes('/chat/sessions/s-old/messages'))).toBe(true);
    expect(got.some(u => u.includes('/chat/sessions/s-new/messages'))).toBe(false);
  });

  it('falls back to the newest when the remembered one is gone', async () => {
    widthIs(true);
    writeShell({ session: 's-deleted' });
    serve({ sessions: [session('s-new', 'This morning', 0), session('s-old', 'Last week', 6)] });
    await mount(<SahayakTab />);
    await settle();

    expect(got.some(u => u.includes('/chat/sessions/s-new/messages'))).toBe(true);
    expect(got.some(u => u.includes('s-deleted'))).toBe(false);
  });

  it('orders with no timestamp at all rather than throwing the list about', () => {
    const rows = [{ id: 'a' }, { id: 'b', updated_at: '2026-08-05T00:00:00Z' }, { id: 'c', updated_at: 'nonsense' }];
    expect(newestFirst(rows).map(r => r.id)).toEqual(['b', 'a', 'c']);
    expect(lastTouched(undefined)).toBe(0);
    // It does not mutate what the resource hook is holding.
    expect(rows.map(r => r.id)).toEqual(['a', 'b', 'c']);
  });
});

/* ── 2 · The view switch ─────────────────────────────────────────────────── */

describe('the view switch', () => {
  it('offers both views, and Reading paints no class at all', async () => {
    serve({ sessions: [] });
    await mount(<SahayakTab />);
    await settle();

    expect(one('.sh__view')).not.toBeNull();
    expect(all('.sh__view-b').map(b => b.textContent)).toEqual(['Reading', 'Compact']);
    expect(byText('.sh__view-b', 'Reading').getAttribute('aria-pressed')).toBe('true');
    expect(one('.sh--compact')).toBeNull();
  });

  it('switches to compact, and back', async () => {
    serve({ sessions: [] });
    await mount(<SahayakTab />);
    await settle();

    await click(byText('.sh__view-b', 'Compact'));
    expect(one('.sh--compact')).not.toBeNull();
    expect(byText('.sh__view-b', 'Compact').getAttribute('aria-pressed')).toBe('true');

    await click(byText('.sh__view-b', 'Reading'));
    expect(one('.sh--compact')).toBeNull();
  });

  it('keeps the chosen view across a reload', async () => {
    serve({ sessions: [] });
    await mount(<SahayakTab />);
    await settle();
    await click(byText('.sh__view-b', 'Compact'));

    await reload(<SahayakTab />);
    expect(one('.sh--compact')).not.toBeNull();
    expect(viewOf(readShell())).toBe('compact');
  });
});

/* ── 3 · A verdict on an answer ──────────────────────────────────────────── */

describe('thumbs up and thumbs down', () => {
  it('draws both, on an answer the server stored', async () => {
    serve({ sessions: [session('s1', 'Filings')], messages: ANSWERED });
    await mount(<SahayakTab />);
    await settle();

    expect(one('.sh__acts')).not.toBeNull();
    const fb = one('.sh__fb');
    expect(fb).not.toBeNull();
    expect(fb.querySelectorAll('button').length).toBe(2);
    expect([...fb.querySelectorAll('button')].map(b => b.getAttribute('aria-label')))
      .toEqual(['This answer was right', 'This answer was wrong']);
  });

  it('posts the verdict to the endpoint that already exists', async () => {
    serve({ sessions: [session('s1', 'Filings')], messages: ANSWERED });
    await mount(<SahayakTab />);
    await settle();

    await click(one('.sh__fb button'));
    const call = posted.find(([u]) => u.includes('/skills/feedback'));
    expect(call).toBeTruthy();
    expect(call[0]).toBe('/v1/hub/skills/feedback');
    expect(call[1]).toEqual({ accepted: true, message_id: A1 });
    expect(one('.sh__fb button').className).toBe('on');
  });

  it('sends accepted:false for the down thumb', async () => {
    serve({ sessions: [session('s1', 'Filings')], messages: ANSWERED });
    await mount(<SahayakTab />);
    await settle();

    await click(all('.sh__fb button')[1]);
    const call = posted.find(([u]) => u.includes('/skills/feedback'));
    expect(call[1]).toEqual({ accepted: false, message_id: A1 });
    expect(all('.sh__fb button')[1].getAttribute('aria-pressed')).toBe('true');
  });

  it('does not mark the answer when the server refused the row', async () => {
    serve({ sessions: [session('s1', 'Filings')], messages: ANSWERED, feedbackFails: true });
    await mount(<SahayakTab />);
    await settle();

    await click(one('.sh__fb button'));
    expect(posted.some(([u]) => u.includes('/skills/feedback'))).toBe(true);
    // The fill is a claim about what the server holds. It holds nothing.
    expect(one('.sh__fb button').className).toBe('');
    expect(one('.sh__fb button').getAttribute('aria-pressed')).toBe('false');
  });

  it('does not post twice for the same verdict', async () => {
    serve({ sessions: [session('s1', 'Filings')], messages: ANSWERED });
    await mount(<SahayakTab />);
    await settle();

    await click(one('.sh__fb button'));
    await click(one('.sh__fb button'));
    expect(posted.filter(([u]) => u.includes('/skills/feedback')).length).toBe(1);
  });

  it('draws no verdict buttons on an answer with no server id', async () => {
    serve({
      sessions: [session('s1', 'Filings')],
      messages: [{ role: 'assistant', content: 'An imported reply with no id.' }],
    });
    await mount(<SahayakTab />);
    await settle();
    expect(one('.sh__fb')).toBeNull();
  });

  it('knows which ids the endpoint can actually take', () => {
    expect(isServerAnswer(A1)).toBe(true);
    expect(isServerAnswer('local-1754500000000')).toBe(false);
    expect(isServerAnswer('reply-1754500000000')).toBe(false);
    expect(isServerAnswer('m1')).toBe(false);
    expect(isServerAnswer(null)).toBe(false);
    expect(feedbackBody(A1, 'up')).toEqual({ accepted: true, message_id: A1 });
    expect(feedbackBody(A1, 'down')).toEqual({ accepted: false, message_id: A1 });
    expect(FEEDBACK_PATH).toBe('/v1/hub/skills/feedback');
  });
});

/* ── 4 · The split-evidence switch ───────────────────────────────────────── */

describe('the evidence pane has a switch', () => {
  /** Evidence only arrives on the ANSWER route — `GET …/messages` returns no
   *  structure until migration 119 is applied, which it deliberately is not. */
  async function ask() {
    serve({
      sessions: [],
      send: {
        session_id: 's-new', message_id: A1, message: 'Two invoices are open.',
        sources: [kbSource(1, 'Ledger')], evidence: EVIDENCE, credits: 0,
      },
    });
    await mount(<SahayakTab />);
    await settle();
    const box = one('.sh__cp textarea');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value',
      ).set;
      setter.call(box, 'what is open');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(byText('.sh__cp-foot button', 'Ask'));
  }

  it('shows the rows, and a control that hides them', async () => {
    await ask();
    expect(one('table.sh-ev')).not.toBeNull();

    const tog = one('.sh__act');
    expect(tog).not.toBeNull();
    expect(tog.getAttribute('aria-expanded')).toBe('true');

    await click(tog);
    expect(one('table.sh-ev')).toBeNull();
    expect(one('.sh__act').getAttribute('aria-expanded')).toBe('false');
    // The sources it cited are still there — hiding the table is not hiding
    // the provenance.
    expect(one('.sh-src')).not.toBeNull();
  });

  it('brings them back, and remembers the choice', async () => {
    await ask();
    await click(one('.sh__act'));
    expect(one('table.sh-ev')).toBeNull();
    expect(evidenceOf(readShell())).toBe(false);

    await click(one('.sh__act'));
    expect(one('table.sh-ev')).not.toBeNull();
    expect(evidenceOf(readShell())).toBe(true);
  });
});

/* ── 5 · The sources sheet on a phone ────────────────────────────────────── */

describe('sources are reachable on a phone', () => {
  /* Comments are stripped before matching. This file documents the rule it
     replaced, in prose, quoting it — and a checker that reads a comment as a
     declaration would be satisfied by deleting the explanation. */
  const CSS = readFileSync('src/styles/sahayak.css', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  it('no longer deletes the panel below 768px', () => {
    // The bug, stated as the stylesheet stated it. `.sh__side-x` and
    // `.sh__side-grip` are deliberately display:none — they are the sheet's own
    // chrome — so the pattern anchors on `.sh__side` followed by its brace.
    expect(/\.sh__side\s*\{[^}]*display:\s*none/.test(CSS)).toBe(false);
    // And it is a sheet, driven by a class the component sets.
    expect(CSS).toMatch(/\.sh--sheet\s+\.sh__side/);
  });

  it('gives the sheet an opener, and opens it', async () => {
    serve({ sessions: [session('s1', 'Filings')], messages: ANSWERED });
    await mount(<SahayakTab />);
    await settle();

    // The panel is in the DOM at every width — it is the CSS that presents it
    // as a column or as a sheet.
    expect(one('.sh__side')).not.toBeNull();

    const open = one('.sh__srcs');
    expect(open).not.toBeNull();
    expect(open.getAttribute('aria-expanded')).toBe('false');

    await click(open);
    expect(one('.sh--sheet')).not.toBeNull();
    expect(one('.sh__srcs').getAttribute('aria-expanded')).toBe('true');
    // The scrim comes with it, so a tap outside dismisses.
    expect(one('.sh__scrim')).not.toBeNull();
  });

  it('closes on its own control, on the scrim, and on Escape', async () => {
    serve({ sessions: [session('s1', 'Filings')], messages: ANSWERED });
    await mount(<SahayakTab />);
    await settle();

    await click(one('.sh__srcs'));
    await click(one('.sh__side-x'));
    expect(one('.sh--sheet')).toBeNull();

    await click(one('.sh__srcs'));
    await click(one('.sh__scrim'));
    expect(one('.sh--sheet')).toBeNull();

    await click(one('.sh__srcs'));
    await act(async () => {
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await settle();
    expect(one('.sh--sheet')).toBeNull();
  });

  it('offers no sheet when there is no panel to put in it', async () => {
    serve({
      sessions: [session('s1', 'Filings')],
      messages: [{ id: A1, role: 'assistant', content: 'Nothing was cited.' }],
    });
    await mount(<SahayakTab />);
    await settle();
    expect(one('.sh--wide')).not.toBeNull();
    expect(one('.sh__srcs')).toBeNull();
  });
});

/* ── 6 · The store itself ────────────────────────────────────────────────── */

describe('the preference store', () => {
  it('survives every shape of nothing', () => {
    expect(readShell()).toEqual({});
    window.localStorage.setItem('kv_sahayak_shell', 'not json');
    expect(readShell()).toEqual({});
    window.localStorage.setItem('kv_sahayak_shell', '[1,2]');
    expect(readShell()).toEqual({});
    window.localStorage.setItem('kv_sahayak_shell', 'null');
    expect(readShell()).toEqual({});
  });

  it('narrows every value it hands back', () => {
    writeShell({ view: 42, session: 7, rail: 'yes', evidence: 'no' });
    expect(viewOf(readShell())).toBe('reading');
    expect(sessionOf(readShell())).toBeNull();
    // A non-boolean `rail` is not a stored choice, so the viewport decides.
    widthIs(true);
    expect(railDefault(readShell())).toBe(true);
    // Anything that is not exactly `false` leaves the evidence pane open.
    expect(evidenceOf(readShell())).toBe(true);
  });

  it('does not take the screen down when storage throws', () => {
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new Error('SecurityError'); },
    });
    try {
      expect(readShell()).toEqual({});
      expect(() => writeShell({ view: 'compact' })).not.toThrow();
      expect(railDefault(undefined)).toBe(false);
    } finally {
      Object.defineProperty(window, 'localStorage', real);
    }
  });
});
