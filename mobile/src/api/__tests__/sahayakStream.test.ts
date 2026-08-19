/**
 * The stream, and the four invariants it is not allowed to break.
 *
 * ── What can be tested here, and what cannot ──────────────────────────────────
 *
 * `askStreaming` takes its transport as an argument. That is not a testing
 * seam bolted on afterwards — it is what lets this suite exercise every frame
 * ordering, every truncation and every failure mode without a socket, in a
 * repository where staging and production share one database and `register.mjs`
 * stubs `api/client` specifically so no test can reach the network.
 *
 * What is NOT proven here is that `expo/fetch` delivers chunks incrementally on
 * a device. That is a claim about native code and about whether Metro injects a
 * `ReadableStream` global, and it needs a cold start on hardware this machine
 * does not have — hot reload lies. The transport degrades to reading the whole
 * body when the stream cannot be read, so the worst case is the speed the app
 * already has; the evidence for the claim is recorded in `api/sahayak.ts`.
 *
 * ── The invariants ────────────────────────────────────────────────────────────
 *
 *  1. The final frame REPLACES the accumulated deltas. Citation validation runs
 *     on the complete text, so what streamed is provisional.
 *  2. A failure after the server has run is not retried — one answer, one charge,
 *     and text already read is never rewritten.
 *  3. The debit happens once, server-side, whether or not the reader is still
 *     listening. A stop does not refund it.
 *  4. A half answer is never returned as a whole one.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import {
  createSseReader, askStreaming, StreamUnavailable, StreamFailed,
  CHAT_PATH, CHAT_STREAM_PATH,
  type OpenStream, type StreamOpened,
} from '../sahayak.ts';
import { srcPath } from '../../test/source.ts';

/* ── A transport made of strings ──────────────────────────────────────────── */

/** The body `POST /chat` returns, with every key present. */
const FINAL = {
  session_id: 'sess-1',
  message_id: 'msg-1',
  answered: true,
  message: 'Two invoices are unpaid [1].',
  work: [{ state: 'done', ok: true, label: 'Reading your invoices', fn: '', note: '', rows: 2, src: '' }],
  figs: [],
  sources: [{ ref: 1, title: 'Invoice register' }],
  evidence: null,
  refusal: '',
  refusal_detail: null,
  model: 'gemini-2.0-flash-lite',
  credits: 1,
  credits_charged: 1,
  cost_usd: 0.0001,
  language: 'en',
  read: ['invoices'],
};

/** Frames → the bytes a server would write. */
function sse(frames: { event: string; data: unknown }[]): string {
  return frames.map(f => `event: ${f.event}\ndata: ${JSON.stringify(f.data)}\n\n`).join('');
}

/**
 * A transport that replays `chunks` verbatim.
 *
 * The chunk BOUNDARIES are the interesting part: a real socket splits wherever
 * it likes, and every test that passes with one chunk per frame is a test that
 * has not exercised the reader.
 */
function transport(
  chunks: string[],
  init: Partial<Omit<StreamOpened, 'chunks'>> = {},
): { open: OpenStream; seen: { url: string; body: string }[] } {
  const seen: { url: string; body: string }[] = [];
  const open: OpenStream = async (url, i) => {
    seen.push({ url, body: i.body });
    return {
      status: init.status ?? 200,
      contentType: init.contentType ?? 'text/event-stream; charset=utf-8',
      chunks: (async function* () { for (const c of chunks) yield c; })(),
    };
  };
  return { open, seen };
}

/** Split a whole body into `n`-character pieces. */
const slice = (body: string, n: number): string[] =>
  body.match(new RegExp(`[\\s\\S]{1,${n}}`, 'g')) ?? [];

/* ── 0. Three sides, one contract ─────────────────────────────────────────── */

/** The repository root, walked up from `mobile/src` so the suite runs from
 *  either directory. A miss THROWS: a contract test that quietly stops
 *  comparing is indistinguishable from one that passes. */
function repoRoot(): string {
  let dir = srcPath('..');
  for (let i = 0; i < 5; i++) {
    if (existsSync(path.join(dir, 'backend', 'server.py'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    'Could not locate the repository root from mobile/src. These are '
    + 'client↔server contract checks; without the other sides there is nothing '
    + 'to compare against and passing would mean nothing.',
  );
}

const ROOT = repoRoot();
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

test('the phone, the web and the server name the SAME route', () => {
  /**
   * Nothing below pins a literal this file chose. The path is read off all
   * three sides and compared, the way `serverContract.test.ts` compares the
   * task-id shape — because every one of these is a string on one side and a
   * string on the other, and `tsc` cannot help when the third is Python.
   *
   * The task-id check is the one with a body count: a regex that could not
   * match a real id survived three review rounds and a green suite, because
   * nothing compared the two sides.
   */
  const hub = read('backend/routers/hub.py');
  const prefix = /APIRouter\(prefix="([^"]+)"/.exec(hub)?.[1];
  assert.ok(prefix, 'backend/routers/hub.py declares no router prefix');
  assert.ok(
    hub.includes('@router.post("/chat/stream")'),
    'the server has no POST /chat/stream — the phone would fall back to POST /chat forever',
  );

  // The server mounts under `/api/v1/hub`; `api/client.ts` puts `/api` in the
  // axios base URL, so the client half of the path is what is left.
  assert.equal(`/api${CHAT_STREAM_PATH}`, `${prefix}/chat/stream`);
  assert.equal(`/api${CHAT_PATH}`, `${prefix}/chat`);

  const web = read('frontend/src/pages/sahayak/SahayakTab.jsx');
  assert.ok(
    web.includes(`'${CHAT_STREAM_PATH}'`),
    `the web posts somewhere other than ${CHAT_STREAM_PATH}`,
  );
});

test('all three sides spell the same four event names', () => {
  // A frame name is a string on the server and a string in two clients. Rename
  // one and the reader gets an answer with no text in it and no error either.
  const hub = read('backend/routers/hub.py');
  const mobile = readFileSync(srcPath('api/sahayak.ts'), 'utf8');
  const web = read('frontend/src/pages/sahayak/SahayakTab.jsx');

  for (const event of ['step', 'delta', 'final', 'error']) {
    // The generator yields `("step", …)` tuples and the handler turns each into
    // a frame with `_sse(*first)`, so both spellings are the server emitting it.
    assert.ok(
      new RegExp(`(?:yield\\s+|_sse\\(\\s*)["']${event}["']`).test(hub),
      `the server never emits a "${event}" frame`,
    );
    assert.ok(
      new RegExp(`['"]${event}['"]`).test(mobile),
      `this client does not handle the "${event}" frame`,
    );
    assert.ok(
      new RegExp(`['"]${event}['"]`).test(web),
      `the web does not handle the "${event}" frame`,
    );
  }
});

test('POST /chat is still there — a client that cannot stream loses nothing', () => {
  // The contract's own rule, and the reason this app keeps `sahayakApi.ask`.
  // Mobile falls back to it whenever the streaming route is not reachable.
  const hub = read('backend/routers/hub.py');
  assert.ok(hub.includes('@router.post("/chat")'), 'the non-streaming route was removed');
  const mobile = readFileSync(srcPath('api/sahayak.ts'), 'utf8');
  assert.ok(mobile.includes(`'${CHAT_PATH}'`), 'the phone no longer posts to the plain route');
});

/* ── 1. The SSE reader ────────────────────────────────────────────────────── */

test('a frame split across every possible boundary still arrives once, whole', () => {
  const body = sse([
    { event: 'step',  data: { label: 'Reading your invoices' } },
    { event: 'delta', data: { text: 'Two ' } },
    { event: 'final', data: FINAL },
  ]);

  // One character at a time is the worst case a socket can produce, and it is
  // the case a reader that carries partial FRAMES rather than partial LINES
  // gets wrong.
  for (const size of [1, 2, 7, 13, 64, body.length]) {
    const reader = createSseReader();
    const got: { event: string; data: string }[] = [];
    for (const c of slice(body, size)) got.push(...reader.push(c));
    got.push(...reader.end());
    assert.deepEqual(got.map(f => f.event), ['step', 'delta', 'final'], `at chunk size ${size}`);
    assert.equal(JSON.parse(got[2].data).message, FINAL.message, `at chunk size ${size}`);
  }
});

test('CRLF, comment lines and multi-line data all follow the protocol', () => {
  const reader = createSseReader();
  const frames = [
    ...reader.push(': keep-alive\r\n\r\n'),
    ...reader.push('event: delta\r\ndata: {"text":"a\r\ndata: b"}\r\n\r\n'),
  ];
  // The keep-alive is a comment. It must not open a frame — a reader that
  // treats it as one emits an empty event on every idle proxy tick.
  assert.equal(frames.length, 1);
  assert.equal(frames[0].event, 'delta');
  assert.equal(frames[0].data, '{"text":"a\nb"}');
});

test('an unterminated final LINE is discarded, not half-parsed', () => {
  // Invariant 4, at the byte level. The bytes stop mid-JSON.
  const reader = createSseReader();
  reader.push('event: final\ndata: {"message":"half');
  assert.deepEqual(reader.end(), [], 'a partial line must not become a frame');
});

test('a frame whose blank line never arrived is still delivered', () => {
  // Its lines are all complete; only the terminator is missing, which is what a
  // connection closing cleanly after the last frame looks like.
  const reader = createSseReader();
  reader.push('event: final\ndata: {"message":"whole"}\n');
  const [f] = reader.end();
  assert.equal(f.event, 'final');
  assert.equal(JSON.parse(f.data).message, 'whole');
});

/* ── 2. The happy path ────────────────────────────────────────────────────── */

test('steps and deltas arrive in order, and the final answer comes back', async () => {
  const body = sse([
    { event: 'step',  data: { label: 'Reading your invoices' } },
    { event: 'delta', data: { text: 'Two ' } },
    { event: 'delta', data: { text: 'invoices' } },
    { event: 'final', data: FINAL },
  ]);
  const steps: string[] = [];
  const deltas: string[] = [];
  const { open, seen } = transport(slice(body, 5));

  const out = await askStreaming(
    'what is unpaid?',
    { sessionId: 'sess-1', clientId: 'cl-1' },
    { onStep: l => steps.push(l), onDelta: t => deltas.push(t) },
    { open },
  );

  assert.deepEqual(steps, ['Reading your invoices']);
  assert.equal(deltas.join(''), 'Two invoices');
  assert.equal(out.deltas, 2);
  assert.equal(out.answer.message, FINAL.message);
  assert.equal(out.answer.credits_charged, 1);
  assert.deepEqual(out.answer.sources, FINAL.sources);

  // Same body as the non-streaming route, and the route is the same path plus
  // `/stream` — derived, so the two cannot drift apart.
  assert.equal(CHAT_STREAM_PATH, `${CHAT_PATH}/stream`);
  assert.ok(seen[0].url.endsWith(CHAT_STREAM_PATH), `posted to ${seen[0].url}`);
  assert.deepEqual(JSON.parse(seen[0].body), {
    message: 'what is unpaid?', session_id: 'sess-1', client_id: 'cl-1',
  });
});

test('INVARIANT 1 — the final frame REPLACES what streamed', async () => {
  // The server rejected `[7]` during `strip_invalid_refs`, so the finished text
  // differs from the text the reader watched arrive. A client that returned its
  // own accumulation would show a citation the server refused to stand behind.
  const body = sse([
    { event: 'delta', data: { text: 'Two invoices are unpaid [7].' } },
    { event: 'final', data: { ...FINAL, message: 'Two invoices are unpaid.' } },
  ]);
  let streamed = '';
  const out = await askStreaming(
    'q', {}, { onDelta: t => { streamed += t; } }, { open: transport(slice(body, 9)).open },
  );
  assert.equal(streamed, 'Two invoices are unpaid [7].');
  assert.equal(out.answer.message, 'Two invoices are unpaid.');
  assert.notEqual(out.answer.message, streamed);
});

test('the contract calls the prose `answer`; the body calls it `message` — both read', async () => {
  // A real seam between two agents' files. Whichever name the route ships with,
  // the authoritative text must replace the accumulation rather than the
  // accumulation surviving by accident.
  const body = sse([
    { event: 'delta', data: { text: 'provisional' } },
    { event: 'final', data: { ...FINAL, message: undefined, answer: 'authoritative' } },
  ]);
  const out = await askStreaming('q', {}, {}, { open: transport([body]).open });
  assert.equal(out.answer.message, 'authoritative');
});

/* ── 3. Failure, and what may be retried ──────────────────────────────────── */

test('INVARIANT 4 — a stream that ends without `final` THROWS', async () => {
  const body = sse([{ event: 'delta', data: { text: 'Two invoices' } }]);
  await assert.rejects(
    () => askStreaming('q', {}, {}, { open: transport(slice(body, 4)).open }),
    (e: unknown) => {
      assert.ok(e instanceof StreamFailed, 'a cut-off stream is a failure, not an answer');
      assert.equal((e as StreamFailed).sawDelta, true);
      return true;
    },
  );
});

test('a truncated `final` frame is not an answer either', async () => {
  const whole = sse([{ event: 'final', data: FINAL }]);
  const cut = whole.slice(0, whole.length - 30);
  await assert.rejects(
    () => askStreaming('q', {}, {}, { open: transport([cut]).open }),
    StreamFailed,
  );
});

test('an `error` frame ends the stream with the server\'s own sentence', async () => {
  const body = sse([
    { event: 'delta', data: { text: 'Two ' } },
    { event: 'error', data: { detail: 'The assistant lost its connection to the model.' } },
  ]);
  await assert.rejects(
    () => askStreaming('q', {}, {}, { open: transport(slice(body, 11)).open }),
    (e: unknown) => {
      assert.ok(e instanceof StreamFailed);
      assert.equal((e as Error).message, 'The assistant lost its connection to the model.');
      // INVARIANT 2's client half: text has been read, so nothing may re-ask and
      // rewrite it.
      assert.equal((e as StreamFailed).sawDelta, true);
      return true;
    },
  );
});

test('INVARIANT 2 — only a request that CANNOT have been answered is retryable', async () => {
  // 404 / 405 / 501: FastAPI's router refused before any handler ran, so no
  // credit moved. These are the only failures the screen may re-ask on.
  for (const status of [404, 405, 501]) {
    await assert.rejects(
      () => askStreaming('q', {}, {}, { open: transport([''], { status }).open }),
      StreamUnavailable,
      `${status} must be retryable`,
    );
  }

  // A route that exists and answered with something that is not a stream MAY
  // already have generated and charged for the answer. Re-asking pays twice.
  await assert.rejects(
    () => askStreaming('q', {}, {}, {
      open: transport(['<html>502</html>'], { status: 200, contentType: 'text/html' }).open,
    }),
    (e: unknown) => {
      assert.ok(e instanceof StreamFailed, 'a non-stream response must NOT be retryable');
      assert.ok(!(e instanceof StreamUnavailable));
      return true;
    },
  );

  // And a 500 from the route itself is a failure, not a free retry.
  const body = sse([{ event: 'error', data: { detail: 'Something went wrong.' } }]);
  await assert.rejects(
    () => askStreaming('q', {}, {}, { open: transport([body], { status: 500 }).open }),
    (e: unknown) => {
      assert.ok(e instanceof StreamFailed);
      assert.ok(!(e instanceof StreamUnavailable));
      return true;
    },
  );
});

test('a 404 from the HANDLER is a failure, not a missing route', async () => {
  /**
   * ONE STALE SESSION USED TO TURN STREAMING OFF FOR THE LIFE OF THE SCREEN.
   *
   * `_sahayak_answer` raises 404 twice from inside the handler — "Session not
   * found" for a session that is no longer an active row in the caller's org,
   * and "Client not found" from `_verify_client_access` — and both reach the
   * client as real HTTP statuses because `sahayak_chat_stream` primes the
   * generator outside the response body on purpose. Reading the STATUS alone
   * made those "this deployment has no streaming endpoint": `noStreamRoute`
   * latched, and every later question went down `POST /chat` with no steps, no
   * deltas and no stop button — while that route 404'd for the same reason.
   *
   * The sentences are read off the server rather than pinned here. If either is
   * reworded to something the router itself could have written, this goes red.
   */
  const hub = read('backend/routers/hub.py');
  for (const detail of ['Session not found', 'Client not found']) {
    assert.ok(
      hub.includes(`HTTPException(404, "${detail}")`),
      `the server no longer raises 404 "${detail}" — this check has gone blind`,
    );
    await assert.rejects(
      () => askStreaming('q', {}, {}, {
        open: transport([JSON.stringify({ detail })], {
          status: 404, contentType: 'application/json',
        }).open,
      }),
      (e: unknown) => {
        assert.ok(e instanceof StreamFailed, `404 "${detail}" must not be read as a missing route`);
        assert.ok(!(e instanceof StreamUnavailable));
        // The server's own sentence, because "you did not get a stream" is not
        // something anyone can act on.
        assert.equal((e as Error).message, detail);
        return true;
      },
    );
  }

  // And FastAPI's own router refusal still is one. This is what the phone must
  // keep falling back on: a deployment that has not shipped the route yet.
  for (const body of [JSON.stringify({ detail: 'Not Found' }), '<html>404</html>', '']) {
    await assert.rejects(
      () => askStreaming('q', {}, {}, {
        open: transport([body], { status: 404, contentType: 'application/json' }).open,
      }),
      StreamUnavailable,
      `a router 404 carrying ${JSON.stringify(body).slice(0, 24)} must stay retryable`,
    );
  }
});

test('INVARIANT 3 — a stop yields NO answer, so nothing can claim a cost', async () => {
  /**
   * The abort is the caller's; what this pins is the consequence. A stopped
   * stream throws, so `askStreaming` returns no `answer` and therefore no
   * `credits_charged` — which is exactly why the screen states that a stopped
   * turn still cost credits WITHOUT stating a number. The debit is the
   * server's and happened once, whether or not this reader was listening.
   */
  const ctrl = new AbortController();
  const open: OpenStream = async () => ({
    status: 200,
    contentType: 'text/event-stream',
    chunks: (async function* () {
      yield sse([{ event: 'delta', data: { text: 'Two invoices' } }]);
      ctrl.abort();
      throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
    })(),
  });

  let seen = '';
  await assert.rejects(
    () => askStreaming('q', {}, { onDelta: t => { seen += t; } }, { open, signal: ctrl.signal }),
  );
  assert.equal(seen, 'Two invoices', 'what arrived before the stop is what the reader saw');
  assert.ok(ctrl.signal.aborted);
});

test('a stop reaches the socket, through the deadline the stream now carries', async () => {
  /**
   * The transport is handed the WATCHDOG's signal rather than the caller's, so
   * that `STREAM_STALL_MS` can close the socket too. Identity is therefore the
   * wrong assertion — what has to hold is that a tap on Stop still aborts the
   * signal the transport is actually listening to. It is asserted as behaviour
   * for that reason: the chaining is what the stop button depends on, and an
   * `assert.equal` on two objects stopped being able to see it.
   */
  const ctrl = new AbortController();
  let got: AbortSignal | undefined;
  const open: OpenStream = async (_u, i) => {
    got = i.signal;
    return {
      status: 200,
      contentType: 'text/event-stream',
      chunks: (async function* () { yield sse([{ event: 'final', data: FINAL }]); })(),
    };
  };
  await askStreaming('q', {}, {}, { open, signal: ctrl.signal });
  assert.ok(got, 'the stream was opened with no signal at all');
  assert.equal(got!.aborted, false);
  ctrl.abort();
  assert.equal(got!.aborted, true, 'without this the stop button aborts nothing');
});

test('a signal that is ALREADY aborted reaches the transport aborted', async () => {
  // The screen aborts on unmount, and a mutation can start on the same tick.
  // Chaining that only listens for a future `abort` event would open a socket
  // for a screen that has gone away.
  const ctrl = new AbortController();
  ctrl.abort();
  let got: AbortSignal | undefined;
  const open: OpenStream = async (_u, i) => {
    got = i.signal;
    return {
      status: 200,
      contentType: 'text/event-stream',
      chunks: (async function* () { yield sse([{ event: 'final', data: FINAL }]); })(),
    };
  };
  await askStreaming('q', {}, {}, { open, signal: ctrl.signal });
  assert.equal(got?.aborted, true);
});

/* ── 4. The deadline ──────────────────────────────────────────────────────── */

/**
 * Settle, or fail saying why.
 *
 * A test for a DEADLINE needs one of its own. Every assertion below is about a
 * stream that has stopped producing bytes, so the thing being tested is the
 * only reason the promise ever settles — delete it and these do not go red,
 * they hang, and `node --test` has no default timeout to end them. This turns
 * that into a sentence.
 */
function within<T>(ms: number, work: Promise<T>, what: string): Promise<T> {
  let id: ReturnType<typeof setTimeout>;
  const bell = new Promise<never>((_resolve, reject) => {
    id = setTimeout(
      () => reject(new Error(`${what} never settled — the stream has no deadline.`)),
      ms,
    );
  });
  return Promise.race([work, bell]).finally(() => clearTimeout(id)) as Promise<T>;
}

test('a stream that goes silent is given up on, and says how long it waited', async () => {
  /**
   * There was NO deadline of any kind on this path: `expo/fetch` was called
   * with no timeout and nothing aborted a socket that stopped producing bytes.
   * A provider that hung mid-answer left a native task open, the composer
   * disabled and the lotus spinning until the app was killed.
   *
   * `stallMs` is the same seam as `open` — injected so the behaviour can be
   * exercised in milliseconds rather than asserted about from the source.
   */
  const open: OpenStream = async (_u, i) => ({
    status: 200,
    contentType: 'text/event-stream',
    chunks: (async function* () {
      yield sse([{ event: 'delta', data: { text: 'Two invoices' } }]);
      // Then nothing, for ever — until the watchdog closes it.
      await new Promise<void>((_resolve, reject) => {
        i.signal?.addEventListener('abort', () => reject(
          Object.assign(new Error('Aborted'), { name: 'AbortError' }),
        ), { once: true });
      });
    })(),
  });

  let seen = '';
  await assert.rejects(
    () => within(
      2_000,
      askStreaming('q', {}, { onDelta: t => { seen += t; } }, { open, stallMs: 25 }),
      'a stream that went silent',
    ),
    (e: unknown) => {
      assert.ok(e instanceof StreamFailed, 'a stall is a failure, not an answer');
      // NOT retryable. The route ran, so the answer may already be charged for.
      assert.ok(!(e instanceof StreamUnavailable));
      assert.match((e as Error).message, /stopped sending after \d+ seconds?\./);
      // Invariant 2's client half: text was read, so nothing may re-ask and
      // rewrite it.
      assert.equal((e as StreamFailed).sawDelta, true);
      return true;
    },
  );
  assert.equal(seen, 'Two invoices', 'what arrived before the stall is what the reader saw');
});

test('the deadline covers the WAIT for a response, not only the gaps in one', async () => {
  // A server that accepts the connection and never answers is the likeliest
  // stall on a phone, and it happens before the first chunk exists to time.
  const open: OpenStream = async (_u, i) => new Promise<never>((_r, reject) => {
    i.signal?.addEventListener('abort', () => reject(
      Object.assign(new Error('Aborted'), { name: 'AbortError' }),
    ), { once: true });
  });
  await assert.rejects(
    () => within(2_000, askStreaming('q', {}, {}, { open, stallMs: 25 }), 'a request nobody answered'),
    (e: unknown) => {
      assert.ok(e instanceof StreamFailed);
      assert.equal((e as StreamFailed).sawDelta, false, 'nothing had been read');
      return true;
    },
  );
});

test('every chunk restarts the clock — a slow answer is not a stalled one', async () => {
  // Idle, not total. The server flushes its held steps, then reads the brand
  // row, ten rows of history and a Serper result before the first token; a
  // wall-clock cap would cut off exactly the answers people wait for.
  const gap = () => new Promise(r => setTimeout(r, 12));
  const open: OpenStream = async (_u, i) => ({
    status: 200,
    contentType: 'text/event-stream',
    chunks: (async function* () {
      for (const text of ['Two ', 'invoices ', 'are ', 'unpaid.']) {
        await gap();
        // A REAL socket dies when the signal fires, and this one has to as
        // well: a transport that ignores the abort makes the deadline
        // unobservable, and a test that cannot observe it passes whether the
        // clock is restarted per chunk or never restarted at all.
        if (i.signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
        yield sse([{ event: 'delta', data: { text } }]);
      }
      await gap();
      if (i.signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
      yield sse([{ event: 'final', data: FINAL }]);
    })(),
  });

  // Five gaps of 12ms each is 60ms of stream, well past a 25ms window that
  // measured duration rather than silence.
  const out = await askStreaming('q', {}, {}, { open, stallMs: 25 });
  assert.equal(out.answer.message, FINAL.message);
  assert.equal(out.deltas, 4);
});

test('the watchdog is disarmed on every exit, including the failures', async () => {
  /**
   * A timer left armed keeps Node's event loop — and a phone's — alive for the
   * whole window after the answer is already on screen. `node --test` would sit
   * for a full `STREAM_STALL_MS` at the end of this file if the success path
   * leaked one, which is a slow suite rather than a red one, so it is asserted
   * directly: nothing may still be pending once the call has settled.
   */
  const before = process.getActiveResourcesInfo?.().filter(r => r === 'Timeout').length ?? 0;

  await askStreaming('q', {}, {}, {
    open: transport([sse([{ event: 'final', data: FINAL }])]).open,
  });
  await assert.rejects(
    () => askStreaming('q', {}, {}, { open: transport([''], { status: 404 }).open }),
    StreamUnavailable,
  );
  await assert.rejects(
    () => askStreaming('q', {}, {}, {
      open: transport(['<html>502</html>'], { status: 200, contentType: 'text/html' }).open,
    }),
    StreamFailed,
  );

  const after = process.getActiveResourcesInfo?.().filter(r => r === 'Timeout').length ?? 0;
  assert.equal(after, before, 'a stall timer outlived the request that armed it');
});

test('an unknown event and a malformed data line are ignored, not fatal', async () => {
  // A frame this build has never heard of must not take the answer down with
  // it; the server may grow an event before the app is updated.
  const body = [
    'event: telemetry\ndata: {"x":1}\n\n',
    'event: delta\ndata: not json\n\n',
    sse([{ event: 'delta', data: { text: 'ok' } }, { event: 'final', data: FINAL }]),
  ].join('');
  const out = await askStreaming('q', {}, {}, { open: transport([body]).open });
  assert.equal(out.deltas, 1);
  assert.equal(out.answer.message, FINAL.message);
});

test('a 402 arrives as the server\'s own sentence, not as "that was not a stream"', async () => {
  /**
   * The route raises before it yields, on purpose: an SSE response has already
   * sent `200 OK` by the time its first frame is written, so the 402 that
   * carries the price of the answer and what the org has left has to come out
   * as a status or not at all. The reader can act on "top up"; they cannot act
   * on "the server did not answer with a stream".
   */
  const detail = 'This answer costs 1 credit and your organisation has 0 left.';
  await assert.rejects(
    () => askStreaming('q', {}, {}, {
      open: transport([JSON.stringify({ detail })], {
        status: 402, contentType: 'application/json',
      }).open,
    }),
    (e: unknown) => {
      assert.ok(e instanceof StreamFailed);
      assert.equal((e as Error).message, detail);
      // And it is NOT retryable — the org must not be asked twice for a price
      // it has already been quoted.
      assert.ok(!(e instanceof StreamUnavailable));
      return true;
    },
  );
});

test('the answer is normalised the way the non-streaming path normalises it', async () => {
  // `sources` may arrive as a JSON STRING — `db.py`'s codec registration is
  // best-effort — and the three list fields must never be undefined on a turn.
  const body = sse([{
    event: 'final',
    data: { ...FINAL, sources: JSON.stringify(FINAL.sources), work: null, figs: null, read: null },
  }]);
  const out = await askStreaming('q', {}, {}, { open: transport([body]).open });
  assert.deepEqual(out.answer.sources, FINAL.sources);
  assert.deepEqual(out.answer.work, []);
  assert.deepEqual(out.answer.figs, []);
  assert.deepEqual(out.answer.read, []);
  assert.equal(out.answer.evidence, null);
});
