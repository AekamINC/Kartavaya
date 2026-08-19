/**
 * Sahayak, streaming — the four rules at the top of `SahayakTab.jsx`, pinned.
 *
 * The measured defects these guard, all of them real on 2026-08-17:
 *
 *   · Nothing streamed. `POST /v1/hub/chat` returned one finished dict after
 *     every read and every token, so the surface showed a lotus for the whole of
 *     it and never named one thing it was doing.
 *   · The request carried NO TIMEOUT. A connection the backend accepted and
 *     never answered held the composer for the life of the tab, and there was no
 *     control that could end it.
 *   · The composer was cleared BEFORE the post, so a send that failed took the
 *     typed question with it and the person retyped from memory.
 *
 * Two of the assertions here are about what must NOT happen and are the reason
 * this file exists at all: that `final` REPLACES the streamed text rather than
 * being appended to it (the streamed copy can carry citation markers the server
 * strips from the finished answer), and that once a single frame has arrived the
 * fallback to `POST /v1/hub/chat` is OFF — re-asking would be a second answer, a
 * second debit, and text the reader has already read being rewritten.
 *
 * `createRoot` + `act` rather than @testing-library/react: it is installed but
 * its @testing-library/dom peer is not, so importing it throws. Same shape as
 * `sahayak.test.jsx`, which records the same constraint.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let posted = [];
let handlers = {};

function route(url) {
  const u = String(url);
  if (/\/messages$/.test(u)) return handlers.messages;
  if (/\/hub\/chat$/.test(u)) return handlers.send;
  if (/\/chat\/sessions$/.test(u)) return handlers.sessions;
  if (u.includes('/org-client')) return handlers.orgClient;
  return {};
}

/**
 * `defaults.baseURL` is the whole reason this mock is not the one in
 * `sahayak.test.jsx`. `streamUrl()` reads it, and with nothing there the stream
 * is not attempted at all — which is correct in production (a relative fetch
 * would hit the origin serving the SPA) and is exactly what makes the older
 * suite exercise the non-streaming route unchanged.
 */
vi.mock('../../../lib/api', () => ({
  api: {
    defaults: { baseURL: 'https://api.test/api' },
    get: vi.fn((url) => Promise.resolve({ data: route(url) ?? {} })),
    post: vi.fn((url, body, config) => {
      posted.push([String(url), body, config]);
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
const {
  default: SahayakTab, parseFrames, streamUrl, STREAM_PATH, ASK_TIMEOUT_MS, ASK_MAX_CHARS,
} = await import('../SahayakTab');

let container = null;
let root = null;
let fetchCalls = [];
let copiedText = [];

const ORG_CLIENT = { client: { id: 'cl-1', name: 'Unicode Group' }, brand: null };

/** One SSE frame, exactly as the contract writes it. */
const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const abortError = () => {
  const e = new Error('aborted');
  e.name = 'AbortError';
  return e;
};

/**
 * A reader the test drives by hand, so that the DOM can be asserted BETWEEN
 * frames. A canned array would only ever prove the end state, and every rule in
 * this file is about an intermediate one.
 */
function makeStream() {
  const q = [];
  let pending = null;
  let closed = false;
  let failure = null;
  const enc = new TextEncoder();
  const settleWaiter = () => {
    if (!pending) return null;
    const p = pending;
    pending = null;
    return p;
  };
  return {
    push(s) {
      const item = { done: false, value: enc.encode(s) };
      const p = settleWaiter();
      if (p) p.resolve(item);
      else q.push(item);
    },
    close() {
      closed = true;
      const p = settleWaiter();
      if (p) p.resolve({ done: true, value: undefined });
    },
    fail(err) {
      failure = err;
      const p = settleWaiter();
      if (p) p.reject(err);
    },
    reader: {
      read() {
        return new Promise((resolve, reject) => {
          if (q.length) { resolve(q.shift()); return; }
          if (failure) { reject(failure); return; }
          if (closed) { resolve({ done: true, value: undefined }); return; }
          pending = { resolve, reject };
        });
      },
      cancel() { closed = true; return Promise.resolve(); },
    },
  };
}

/** A `fetch` that answers with a live stream the test pushes into. */
function serveStream({ status = 200, ctype = 'text/event-stream', errorBody = null } = {}) {
  const stream = makeStream();
  globalThis.fetch = vi.fn((url, init) => {
    fetchCalls.push({ url: String(url), init });
    init?.signal?.addEventListener?.('abort', () => stream.fail(abortError()));
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: k => (String(k).toLowerCase() === 'content-type' ? ctype : null) },
      body: { getReader: () => stream.reader },
      text: () => Promise.resolve(errorBody ? JSON.stringify(errorBody) : ''),
    });
  });
  return stream;
}

/**
 * A `fetch` whose promise REJECTS — the request left and nothing came back.
 *
 * Named for what it is rather than for what it used to cause: this was the
 * fallback case, and that is the double charge. `credits.spend` runs while the
 * server primes the generator, before the response head exists, so a rejection
 * here proves nothing about whether the org was billed.
 */
function serveDroppedConnection() {
  globalThis.fetch = vi.fn((url, init) => {
    fetchCalls.push({ url: String(url), init });
    return Promise.reject(new TypeError('Failed to fetch'));
  });
}

/** A `fetch` that answers a plain HTTP status with no stream behind it. */
function serveStatus(status, errorBody = null) {
  globalThis.fetch = vi.fn((url, init) => {
    fetchCalls.push({ url: String(url), init });
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => 'application/json' },
      text: () => Promise.resolve(errorBody ? JSON.stringify(errorBody) : ''),
    });
  });
}

function serve({ sessions = [], messages = [], send = {} } = {}) {
  handlers = {
    orgClient: ORG_CLIENT,
    sessions: { data: sessions },
    messages: { data: messages },
    send,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  posted = [];
  handlers = {};
  fetchCalls = [];
  copiedText = [];
  window.localStorage.clear();
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: t => { copiedText.push(String(t)); return Promise.resolve(); } },
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
  window.localStorage.clear();
  delete globalThis.fetch;
});

const mount = el => act(() => root.render(
  <MemoryRouter><ToastProvider>{el}</ToastProvider></MemoryRouter>,
));
const settle = async (rounds = 10) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};
const text = () => container.textContent;
const all = sel => [...container.querySelectorAll(sel)];
const one = sel => container.querySelector(sel);
const click = async (el) => { await act(async () => { el.click(); }); await settle(); };
const byText = (sel, t) => all(sel).find(el => el.textContent.trim() === t);
const live = () => one('p.sr-only[role="status"]')?.textContent ?? null;
const box = () => one('.sh__cp textarea');

/** Type into the composer the way the browser does — the value setter React
 *  listens through, not the property, which React's own descriptor swallows. */
async function type(value) {
  const el = box();
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')
      .set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
}

async function ask(value = 'what is open') {
  await type(value);
  await click(byText('.sh__cp-foot button', 'Ask'));
}

const FINAL = {
  session_id: 's-new',
  message_id: '11111111-2222-4333-8444-555555555555',
  message: 'Two invoices are open.',
  sources: [], work: [], figs: [], evidence: null, refusal: '', refusal_detail: null,
  model: 'gemini', credits: 2, credits_charged: 2, read: [], answered: true,
};

/* ── 1 · The frame parser ─────────────────────────────────────────────────── */

describe('the SSE parser', () => {
  it('holds a frame back until its blank line arrives', () => {
    const a = parseFrames('event: step\ndata: {"label":"Reading');
    expect(a.frames).toEqual([]);
    const b = parseFrames(`${a.rest} your invoices"}\n\nevent: delta\n`);
    expect(b.frames).toEqual([{ event: 'step', data: '{"label":"Reading your invoices"}' }]);
    expect(b.rest).toBe('event: delta\n');
  });

  it('reads CRLF, and a cut between the \\r and the \\n of one', () => {
    const a = parseFrames('event: delta\r\ndata: {"text":"hi"}\r\n\r');
    expect(a.frames).toEqual([{ event: 'delta', data: '{"text":"hi"}' }]);
    // The other half of that CRLF opens the next chunk and must not become a
    // frame of its own.
    const b = parseFrames(`${a.rest}\nevent: final\ndata: {}\n\n`);
    expect(b.frames).toEqual([{ event: 'final', data: '{}' }]);
  });

  it('ignores heartbeat comments and joins a repeated data field', () => {
    const { frames } = parseFrames(': ping\n\nevent: delta\ndata: one\ndata: two\n\n');
    expect(frames).toEqual([{ event: 'delta', data: 'one\ntwo' }]);
  });

  it('builds the stream URL from the axios base, and only from it', () => {
    expect(streamUrl()).toBe(`https://api.test/api${STREAM_PATH}`);
    expect(STREAM_PATH).toBe('/v1/hub/chat/stream');
  });
});

/* ── 2 · Work, then text, then the answer ─────────────────────────────────── */

describe('the answer arrives in pieces', () => {
  it('names each step as it happens, then writes the answer into the turn', async () => {
    serve({ sessions: [] });
    const s = serveStream();
    await mount(<SahayakTab />);
    await settle();
    await ask();

    // Before anything arrives: the lotus and one honest line, as before.
    expect(one('.sh__wait').textContent).toContain('Reading your records');
    expect(all('.sh__work-r')).toHaveLength(0);

    await act(async () => { s.push(frame('step', { label: 'Reading your invoices' })); });
    await settle();
    expect(all('.sh__work-r').map(r => r.textContent)).toEqual(['Reading your invoices']);
    expect(one('.sh__work-r').className).toContain('now');

    await act(async () => { s.push(frame('step', { label: 'Searching the web' })); });
    await settle();
    expect(all('.sh__work-r')).toHaveLength(2);
    // The step that has been overtaken is done; the newest is the live one.
    expect(all('.sh__work-r')[0].className).toContain('done');
    expect(all('.sh__work-r')[1].className).toContain('now');

    await act(async () => { s.push(frame('delta', { text: 'Two invoices ' })); });
    await settle();
    expect(text()).toContain('Two invoices');
    // Text means the work is behind us: no row is still pulsing.
    expect(all('.sh__work-r').every(r => r.className.includes('done'))).toBe(true);

    await act(async () => { s.push(frame('delta', { text: 'are open.' })); });
    await settle();
    expect(one('.sh__p').textContent).toBe('Two invoices are open.');
  });

  it('REPLACES what streamed with final.answer, never appends to it', async () => {
    serve({ sessions: [] });
    const s = serveStream();
    await mount(<SahayakTab />);
    await settle();
    await ask();

    // The streamed copy carries a marker the server strips: `strip_invalid_refs`
    // runs on the complete text and cannot run a token at a time, so a client
    // that kept its own accumulation would leave `[3]` on screen for ever.
    await act(async () => { s.push(frame('delta', { text: 'Two invoices are open [3].' })); });
    await settle();
    expect(text()).toContain('[3]');

    await act(async () => {
      s.push(frame('final', FINAL));
      s.close();
    });
    await settle();

    expect(text()).not.toContain('[3]');
    expect(one('.sh__p').textContent).toBe('Two invoices are open.');
    // One copy of the answer, not the streamed one with the final one after it.
    expect(all('.sh__p').filter(p => p.textContent.includes('Two invoices'))).toHaveLength(1);
    // And the pending turn is gone: Ask is back in the footer.
    expect(byText('.sh__cp-foot button', 'Ask')).toBeTruthy();
  });

  it('adopts the conversation the server opened and reports what was spent', async () => {
    serve({ sessions: [] });
    const spent = vi.fn();
    const s = serveStream();
    await mount(<SahayakTab onSpent={spent} />);
    await settle();
    await ask();
    await act(async () => { s.push(frame('final', FINAL)); s.close(); });
    await settle();

    expect(spent).toHaveBeenCalledTimes(1);
    // The second question lands in the thread the first one opened.
    await ask('and after that');
    expect(fetchCalls).toHaveLength(2);
    expect(JSON.parse(fetchCalls[1].init.body).session_id).toBe('s-new');
  });

  /**
   * The complaint that started this work was markers printing literally. After
   * the first cut of it the BROWSER was the surface printing them: the pending
   * turn split the deltas on blank lines and drew each as plain text, so a
   * reader watched `## Overdue invoices` and `**Total:**` arrive character by
   * character and reflow into markup only when `final` landed — while the phone
   * rendered the same bytes as a heading and as bold text as they came.
   */
  it('draws the answer as it is written, not as its markers', async () => {
    serve({ sessions: [] });
    const s = serveStream();
    await mount(<SahayakTab />);
    await settle();
    await ask();
    await act(async () => {
      s.push(frame('delta', { text: '## Overdue invoices\n\n**Total:** ' }));
    });
    await settle();

    const head = one('.sh__a-b h3');
    expect(head, 'the provisional draw printed the hashes').toBeTruthy();
    expect(head.textContent).toBe('Overdue invoices');
    expect(byText('.sh__a-b b', 'Total:'), 'the asterisks were printed').toBeTruthy();
    expect(text()).not.toContain('**');
    expect(text()).not.toContain('## ');
  });

  it('carries the same auth and tenant headers every other call carries', async () => {
    window.localStorage.setItem('auth_token', 'tok-1');
    window.localStorage.setItem('Kartavaya_active_org', 'org-9');
    serve({ sessions: [] });
    serveStream();
    await mount(<SahayakTab />);
    await settle();
    await ask();

    const { url, init } = fetchCalls[0];
    expect(url).toBe('https://api.test/api/v1/hub/chat/stream');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.headers.Accept).toBe('text/event-stream');
    expect(init.headers.Authorization).toBe('Bearer tok-1');
    expect(init.headers['X-Org-Id']).toBe('org-9');
  });
});

/* ── 3 · Degrading to exactly yesterday ───────────────────────────────────── */

describe('a stream that cannot start', () => {
  it('asks the route that has always worked, and the answer is unchanged', async () => {
    serve({ sessions: [], send: FINAL });
    serveStatus(404, { detail: 'Not Found' });
    await mount(<SahayakTab />);
    await settle();
    await ask();

    const sent = posted.find(([u]) => /\/hub\/chat$/.test(u));
    expect(sent, 'the composer never fell back to POST /v1/hub/chat').toBeTruthy();
    expect(sent[1].message).toBe('what is open');
    expect(one('.sh__p').textContent).toBe('Two invoices are open.');
  });

  /**
   * THE DOUBLE CHARGE, pinned from both sides.
   *
   * `sahayak_chat_stream` primes its generator with `__anext__` before FastAPI
   * has a response to write, and `credits.spend` is inside that priming — so by
   * the time this browser can observe ANYTHING, the org may already have been
   * billed, a `hub_ai_logs` row written and an answer stored. The old boundary
   * was "did a frame arrive", and a laptop that dropped its Wi-Fi at the wrong
   * moment therefore silently bought the same answer twice, on two
   * `session_id`s, and put two threads in the rail for one question.
   */
  it('does NOT re-ask when the connection dropped with nothing read', async () => {
    serve({ sessions: [], send: FINAL });
    serveDroppedConnection();
    const spent = vi.fn();
    await mount(<SahayakTab onSpent={spent} />);
    await settle();
    await ask();

    expect(posted.some(([u]) => /\/hub\/chat$/.test(u))).toBe(false);
    // And it does not claim the question was undelivered, which is a statement
    // about a server this browser never heard from.
    expect(one('.sh__fail').textContent).toContain('Sent, but no answer came back');
    expect(one('.sh__fail').textContent).toContain('a second ask pays for a second answer');
    // The balance may have moved and nothing here knows: read it again.
    expect(spent).toHaveBeenCalled();
  });

  it('does NOT re-ask when a proxy answered with something that is not a stream', async () => {
    serve({ sessions: [], send: FINAL });
    serveStream({ ctype: 'text/html' });
    await mount(<SahayakTab />);
    await settle();
    await ask();
    // A 200 that is not an event stream is a route that RAN: the status line is
    // spent, the answer was written and stored, and only its delivery failed.
    expect(posted.some(([u]) => /\/hub\/chat$/.test(u))).toBe(false);
    expect(text()).toContain('not as a stream this browser could read');
  });

  /**
   * A 401 is the one refusal that is re-asked, and not because a second ask can
   * succeed. `lib/api`'s response interceptor is the only code that ends a
   * session — it clears the token and redirects to `/login?expired=1` — and a
   * raw `fetch` never reaches it. Posting through axios is how the expiry gets
   * to the handler that signs the reader out, instead of leaving them on an
   * authenticated-looking page whose every send fails with backend wording.
   */
  it('takes an expired session to the axios instance that ends it', async () => {
    serve({ sessions: [], send: FINAL });
    serveStatus(401, { detail: 'Invalid or expired token' });
    await mount(<SahayakTab />);
    await settle();
    await ask();

    const sent = posted.find(([u]) => /\/hub\/chat$/.test(u));
    expect(sent, 'a 401 never reached the interceptor that signs the reader out').toBeTruthy();
    expect(sent[1].message).toBe('what is open');
  });

  it('gives the fallback the timeout the route never had', async () => {
    serve({ sessions: [], send: FINAL });
    serveStatus(404);
    await mount(<SahayakTab />);
    await settle();
    await ask();

    const sent = posted.find(([u]) => /\/hub\/chat$/.test(u));
    expect(sent[2].timeout).toBe(ASK_TIMEOUT_MS);
    expect(sent[2].signal).toBeTruthy();
    expect(ASK_TIMEOUT_MS).toBeGreaterThan(0);
  });

  /**
   * There is nothing to abort on the plain route: uvicorn does not cancel a
   * non-streaming handler when the client disconnects, so a Stop there would
   * draw a stopped fragment over an answer the server goes on to finish, charge
   * for and store. Mobile has never offered one; neither does this.
   */
  it('offers no Stop while the non-streaming route is in flight', async () => {
    serve({ sessions: [], send: FINAL });
    let release = null;
    const held = new Promise((r) => { release = r; });
    serveStatus(404);
    const { api } = await import('../../../lib/api');
    api.post.mockImplementationOnce((url, body, config) => {
      posted.push([String(url), body, config]);
      return held.then(() => ({ data: FINAL }));
    });
    await mount(<SahayakTab />);
    await settle();
    await ask();

    expect(posted.some(([u]) => /\/hub\/chat$/.test(u))).toBe(true);
    expect(byText('.sh__cp-foot button', 'Stop')).toBeFalsy();
    const askBtn = byText('.sh__cp-foot button', 'Ask');
    expect(askBtn, 'the footer lost its send control entirely').toBeTruthy();
    expect(askBtn.hasAttribute('disabled')).toBe(true);

    await act(async () => { release(); });
    await settle();
    expect(one('.sh__p').textContent).toBe('Two invoices are open.');
  });

  it('does NOT fall back once a frame has arrived', async () => {
    serve({ sessions: [], send: FINAL });
    const s = serveStream();
    await mount(<SahayakTab />);
    await settle();
    await ask();

    await act(async () => { s.push(frame('step', { label: 'Reading your invoices' })); });
    await settle();
    await act(async () => { s.push(frame('error', { detail: 'The model refused mid-answer.' })); });
    await settle();

    // Asking again here would be a second answer and a second debit for one
    // question. The server's sentence is shown instead.
    expect(posted.some(([u]) => /\/hub\/chat$/.test(u))).toBe(false);
    expect(text()).toContain('The model refused mid-answer.');
    // And the QUESTION is not blamed: a step came back, so it reached the
    // server and was worked on.
    expect(one('.sh__fail')).toBeNull();
    // Nor is the READER blamed. They touched nothing; the provider died.
    expect(one('.sh-none b').textContent).toBe('Interrupted');
  });

  it('does not fall back on a refusal the second route would only repeat', async () => {
    serve({ sessions: [], send: FINAL });
    serveStream({ status: 402, ctype: 'application/json', errorBody: { detail: 'This answer costs 2 credits; the org has 0.' } });
    await mount(<SahayakTab />);
    await settle();
    await ask();

    expect(posted.some(([u]) => /\/hub\/chat$/.test(u))).toBe(false);
    expect(one('.sh__fail').textContent).toContain('This answer costs 2 credits; the org has 0.');
  });
});

/* ── 4 · Stop ─────────────────────────────────────────────────────────────── */

describe('stopping an answer', () => {
  it('keeps what arrived and marks it as a fragment, not an answer', async () => {
    serve({ sessions: [] });
    const s = serveStream();
    await mount(<SahayakTab />);
    await settle();
    await ask();

    await act(async () => { s.push(frame('delta', { text: 'Two invoices are ' })); });
    await settle();

    const stopBtn = byText('.sh__cp-foot button', 'Stop');
    expect(stopBtn, 'there is no Stop control while an answer is in flight').toBeTruthy();
    expect(stopBtn.getAttribute('aria-label')).toBe('Stop this answer');
    await click(stopBtn);

    // What arrived is still on screen…
    expect(text()).toContain('Two invoices are');
    // …and is labelled for what it is.
    expect(one('.sh-none b').textContent).toBe('Stopped');
    expect(one('.sh-none p').textContent).toContain('not a finished one');
    // A fragment has no verdict, no sources panel and no evidence switch: there
    // is no stored message for any of them to be about.
    expect(one('.sh__fb')).toBeNull();
    expect(one('.sh__side')).toBeNull();
    // And the composer is usable again.
    expect(byText('.sh__cp-foot button', 'Ask')).toBeTruthy();
  });

  /**
   * The debit is the server's and it is not refunded, so a stop that said
   * nothing about it left the credit strip above this tab showing a balance the
   * wallet no longer held — while the phone told the reader plainly, for the
   * same action, on the same account.
   */
  it('says the fragment was charged for, and re-reads the balance', async () => {
    serve({ sessions: [] });
    const spent = vi.fn();
    const s = serveStream();
    await mount(<SahayakTab onSpent={spent} />);
    await settle();
    await ask();
    await act(async () => { s.push(frame('delta', { text: 'Two invoices are ' })); });
    await settle();
    await click(byText('.sh__cp-foot button', 'Stop'));

    expect(one('.sh-none p').textContent).toContain('It was charged for');
    // No figure: `credits` rides on `final`, which a fragment never receives.
    expect(one('.sh-none p').textContent).not.toMatch(/\d+\s*credit/);
    expect(spent).toHaveBeenCalled();
  });

  it('says it even when the stop landed before the first frame', async () => {
    serve({ sessions: [] });
    const spent = vi.fn();
    serveStream();
    await mount(<SahayakTab onSpent={spent} />);
    await settle();
    await ask();
    // Not one frame has arrived — but the 200 text/event-stream head has, and
    // the route reaches that only after `credits.spend` has returned.
    await click(byText('.sh__cp-foot button', 'Stop'));

    expect(one('.sh-none p').textContent).toContain('Nothing had arrived');
    expect(one('.sh-none p').textContent).toContain('It was charged for');
    expect(spent).toHaveBeenCalled();
  });

  it('claims nothing about money when the head never came back', async () => {
    serve({ sessions: [] });
    const spent = vi.fn();
    serveDroppedConnection();
    await mount(<SahayakTab onSpent={spent} />);
    await settle();
    await ask();

    // The balance is re-read because nobody here knows — but the screen states
    // nothing it cannot support.
    expect(text()).not.toContain('It was charged for');
    expect(spent).toHaveBeenCalled();
  });

  it('aborts the request rather than merely hiding it', async () => {
    serve({ sessions: [] });
    const s = serveStream();
    await mount(<SahayakTab />);
    await settle();
    await ask();
    await act(async () => { s.push(frame('delta', { text: 'part' })); });
    await settle();

    expect(fetchCalls[0].init.signal.aborted).toBe(false);
    await click(byText('.sh__cp-foot button', 'Stop'));
    expect(fetchCalls[0].init.signal.aborted).toBe(true);
  });

  it('says what happened when the stream closed without a final', async () => {
    serve({ sessions: [], send: FINAL });
    const s = serveStream();
    await mount(<SahayakTab />);
    await settle();
    await ask();
    await act(async () => { s.push(frame('delta', { text: 'Two invoices are ' })); });
    await settle();
    await act(async () => { s.close(); });
    await settle();

    // Not "No response from the server" and not the 500 sentence that ends
    // "Nothing was changed" — half an answer was written and charged for.
    expect(text()).toContain('The answer ended before it was finished.');
    expect(text()).toContain('Two invoices are');
    expect(posted.some(([u]) => /\/hub\/chat$/.test(u))).toBe(false);
  });

  it('does not re-ask a stream that opened and then sent nothing', async () => {
    serve({ sessions: [], send: FINAL });
    const s = serveStream();
    await mount(<SahayakTab />);
    await settle();
    await ask();
    await act(async () => { s.close(); });
    await settle();

    // The 200 text/event-stream head is written only once `__anext__` has taken
    // the pipeline through `credits.spend`, so this question was charged for
    // wherever it got to. Asking again would buy a second answer, and the old
    // "the stream closed empty" branch did exactly that.
    expect(posted.some(([u]) => /\/hub\/chat$/.test(u))).toBe(false);
    // Delivered, so the question is not blamed — and not "Stopped", because
    // nobody stopped it.
    expect(one('.sh__fail')).toBeNull();
    expect(one('.sh-none b').textContent).toBe('Interrupted');
    expect(one('.sh-none p').textContent).toContain('None of the answer arrived');
    expect(one('.sh-none p').textContent).toContain('It was charged for');
  });

  it('says so when nothing had arrived at all', async () => {
    serve({ sessions: [] });
    const s = serveStream();
    await mount(<SahayakTab />);
    await settle();
    await ask();
    await act(async () => { s.push(frame('step', { label: 'Reading your invoices' })); });
    await settle();

    await click(byText('.sh__cp-foot button', 'Stop'));
    expect(one('.sh-none p').textContent).toContain('Nothing had arrived');
    // Not "not delivered": the question reached the server and was worked on.
    expect(one('.sh__fail')).toBeNull();
  });
});

/* ── 5 · The composer keeps what was typed ────────────────────────────────── */

describe('the composer', () => {
  it('holds the text until the server has taken it', async () => {
    serve({ sessions: [] });
    const s = serveStream();
    await mount(<SahayakTab />);
    await settle();
    await ask('what is open');

    // The request is in flight and nothing has come back. The question is still
    // in the box, because nothing has accepted it yet.
    expect(box().value).toBe('what is open');

    await act(async () => { s.push(frame('step', { label: 'Reading your invoices' })); });
    await settle();
    expect(box().value).toBe('');
  });

  it('still has it when both routes failed', async () => {
    serve({ sessions: [] });
    serveStatus(404);
    const { api } = await import('../../../lib/api');
    api.post.mockImplementationOnce(() => Promise.reject({
      response: { status: 500, data: { detail: 'The workspace is unavailable.' } },
    }));
    await mount(<SahayakTab />);
    await settle();
    await ask('what is open');

    expect(box().value).toBe('what is open');
    expect(one('.sh__fail').textContent).toContain('The workspace is unavailable.');
  });

  it('still has it when the connection dropped before anything was read', async () => {
    serve({ sessions: [] });
    serveDroppedConnection();
    await mount(<SahayakTab />);
    await settle();
    await ask('what is open');

    // Nothing accepted the question, so the box is not emptied — and with no
    // fallback there is no second route to have taken it either.
    expect(box().value).toBe('what is open');
  });

  it('will not take a question longer than the server does', async () => {
    serve({ sessions: [] });
    serveStream();
    await mount(<SahayakTab />);
    await settle();
    // The cap the composer had no opinion about: `ChatAsk.message` is
    // `max_length=4000`, and over it pydantic answers 422 before the handler.
    expect(Number(box().getAttribute('maxlength'))).toBe(ASK_MAX_CHARS);
    expect(ASK_MAX_CHARS).toBe(4000);
  });

  it('says a rejected question was too long, rather than nothing at all', async () => {
    serve({ sessions: [] });
    // Pydantic's 422 `detail` is a LIST, which every reader of `detail` as a
    // string discarded — leaving "Sahayak did not answer." over a question that
    // failed for a reason the reader could have fixed in one edit.
    serveStatus(422, {
      detail: [{
        loc: ['body', 'message'],
        msg: 'String should have at most 4000 characters',
        type: 'string_too_long',
      }],
    });
    await mount(<SahayakTab />);
    await settle();
    await ask('a very long question');

    expect(one('.sh__fail').textContent).toContain('longer than Sahayak takes');
    expect(one('.sh__fail').textContent).toContain('4,000 characters');
    // Not re-asked: a second route would reject the same body the same way.
    expect(posted.some(([u]) => /\/hub\/chat$/.test(u))).toBe(false);
  });

  it('does not empty the box for a question that never came out of it', async () => {
    serve({ sessions: [] });
    const s = serveStream();
    await mount(<SahayakTab />);
    await settle();
    await type('a half-written question');
    // A seed is a different question; it must not delete this one.
    await click(one('.sh__seed'));
    await act(async () => { s.push(frame('final', FINAL)); s.close(); });
    await settle();
    expect(box().value).toBe('a half-written question');
  });
});

/* ── 6 · Copy, and asking again ───────────────────────────────────────────── */

describe('the controls under an answer', () => {
  async function answered() {
    serve({ sessions: [] });
    const s = serveStream();
    await mount(<SahayakTab />);
    await settle();
    await ask();
    await act(async () => { s.push(frame('final', FINAL)); s.close(); });
    await settle();
  }

  it('copies the answer, and says that it did', async () => {
    await answered();
    const copy = byText('.sh__acts button', 'Copy');
    expect(copy).toBeTruthy();
    expect(copy.getAttribute('aria-label')).toBe('Copy this answer to the clipboard');

    await click(copy);
    expect(copiedText).toEqual(['Two invoices are open.']);
    expect(byText('.sh__acts button', 'Copied')).toBeTruthy();
    expect(byText('.sh__acts button', 'Copied').getAttribute('aria-label'))
      .toBe('Copied to the clipboard');
  });

  it('asks the same question again', async () => {
    await answered();
    await click(byText('.sh__acts button', 'Try again'));
    expect(fetchCalls).toHaveLength(2);
    expect(JSON.parse(fetchCalls[1].init.body).message).toBe('what is open');
  });

  it('offers Try again on the last turn only, so the reply lands where it was asked', async () => {
    serve({
      sessions: [{ id: 's1', title: 'Filings', message_count: 4, updated_at: new Date().toISOString() }],
      messages: [
        { id: 'm1', role: 'user', content: 'first' },
        { id: 'm2', role: 'assistant', content: 'first answer' },
        { id: 'm3', role: 'user', content: 'second' },
        { id: 'm4', role: 'assistant', content: 'second answer' },
      ],
    });
    serveStream();
    await mount(<SahayakTab />);
    await settle();
    expect(all('.sh__acts button').filter(b => b.textContent === 'Try again')).toHaveLength(1);
    expect(all('.sh__acts button').filter(b => b.textContent === 'Copy')).toHaveLength(2);
  });

  it('sends a failed question again, and takes the failure away with it', async () => {
    serve({ sessions: [], send: FINAL });
    serveStatus(404);
    const { api } = await import('../../../lib/api');
    api.post.mockImplementationOnce(() => Promise.reject({
      response: { status: 500, data: { detail: 'The workspace is unavailable.' } },
    }));
    await mount(<SahayakTab />);
    await settle();
    await click(one('.sh__seed'));

    expect(all('.sh__you')).toHaveLength(1);
    expect(one('.sh__you').className).toContain('sh__you--failed');

    await click(byText('.sh__fail button', 'Send it again'));
    // One question, not two: nothing was ever stored for the first attempt.
    expect(all('.sh__you')).toHaveLength(1);
    expect(one('.sh__you').className).not.toContain('sh__you--failed');
    expect(one('.sh__p').textContent).toBe('Two invoices are open.');
  });
});

/* ── 7 · What a screen reader is told ─────────────────────────────────────── */

describe('the live region', () => {
  it('announces the phase, and not one word of the answer', async () => {
    serve({ sessions: [] });
    const s = serveStream();
    await mount(<SahayakTab />);
    await settle();
    expect(live()).toBe('');

    await ask();
    expect(live()).toBe('Sahayak is working on your answer.');

    await act(async () => { s.push(frame('delta', { text: 'Two ' })); });
    await settle();
    await act(async () => { s.push(frame('delta', { text: 'invoices ' })); });
    await settle();
    await act(async () => { s.push(frame('delta', { text: 'are open.' })); });
    await settle();
    // Three tokens, no announcement: a region fed by the deltas would try to
    // read a four-hundred-word answer one word at a time.
    expect(live()).toBe('Sahayak is working on your answer.');

    await act(async () => { s.push(frame('final', FINAL)); s.close(); });
    await settle();
    expect(live()).toBe('Answer ready.');
  });

  it('says that a stopped answer stopped', async () => {
    serve({ sessions: [] });
    const s = serveStream();
    await mount(<SahayakTab />);
    await settle();
    await ask();
    await act(async () => { s.push(frame('delta', { text: 'part of it' })); });
    await settle();
    await click(byText('.sh__cp-foot button', 'Stop'));
    expect(live()).toBe('Answer stopped.');
  });

  it('hands focus to Stop, and gives it back to the composer', async () => {
    serve({ sessions: [] });
    const s = serveStream();
    await mount(<SahayakTab />);
    await settle();
    await type('what is open');
    await act(async () => { box().focus(); });
    await click(byText('.sh__cp-foot button', 'Ask'));

    // Disabling the box and unmounting Ask drops focus to `body`, from which
    // Tab restarts at the top of the document — so Stop takes it instead.
    expect(document.activeElement).toBe(byText('.sh__cp-foot button', 'Stop'));

    await act(async () => { s.push(frame('final', FINAL)); s.close(); });
    await settle();
    expect(document.activeElement).toBe(box());
  });

  it('leaves every new control reachable and named', async () => {
    serve({ sessions: [] });
    const s = serveStream();
    await mount(<SahayakTab />);
    await settle();
    await ask();

    const stop = byText('.sh__cp-foot button', 'Stop');
    expect(stop.tagName).toBe('BUTTON');
    expect(stop.getAttribute('type')).toBe('button');
    expect(stop.hasAttribute('disabled')).toBe(false);

    await act(async () => { s.push(frame('final', FINAL)); s.close(); });
    await settle();
    for (const b of all('.sh__acts button')) {
      expect(b.tagName).toBe('BUTTON');
      expect(b.getAttribute('type')).toBe('button');
      expect((b.getAttribute('aria-label') || b.textContent).trim()).not.toBe('');
    }
  });
});
