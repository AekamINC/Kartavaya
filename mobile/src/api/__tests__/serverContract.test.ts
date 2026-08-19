/**
 * Names the client and the server have to spell identically.
 *
 * Every check here compares this app against the CURRENT TEXT OF `backend/`,
 * the way `pushRegistration.test.ts` compares it against the installed
 * expo-constants. Nothing below pins a literal this repo chose; each one reads
 * both sides and asserts they agree.
 *
 * ── Why a test and not a comment ──────────────────────────────────────────────
 *
 * All three contracts were, until now, recorded as PROSE on both sides — a
 * paragraph in `deepLink.ts` naming `MENTION_URL_THREAD_PARAM`, a paragraph in
 * `MentionInput.tsx` naming `channel_id`, a paragraph in
 * `usePushNotifications.ts` naming the task-id shape. Prose agrees right up
 * until one side is edited, and then it agrees just as confidently while being
 * wrong. `tsc` cannot help: the server is Python, so every one of these is a
 * string on one side and a string on the other.
 *
 * The task-id check is the one with a body count. `usePushNotifications`
 * gated its task branch on `/^[0-9a-f-]{32,36}$/i` — a uuid — while the backend
 * has always built task ids as `f"task_{uuid.uuid4().hex[:12]}"`. That regex
 * could not match a real id ever, so every task, approval and reminder push
 * missed the branch and told the reader their app was out of date. It survived
 * three review rounds and a green suite, because nothing compared the two sides.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { srcPath, readCode } from '../../test/source.ts';
import { parseSanvaadUrl, isSanvaadUrl } from '../../lib/deepLink.ts';

/* ── Locating the server ─────────────────────────────────────────────────── */

/**
 * The `backend/` directory of this repository.
 *
 * Walked up from `mobile/src` so it resolves whether the suite is invoked from
 * `mobile/` or the repository root. A miss THROWS rather than skips: a contract
 * test that quietly stops comparing is indistinguishable from one that passes,
 * and that is the exact failure mode these checks exist to end.
 */
function backendDir(): string {
  let dir = srcPath('..');
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, 'backend');
    if (existsSync(path.join(candidate, 'server.py'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    'Could not locate backend/ from mobile/src. These are client↔server contract '
    + 'tests; without the server there is nothing to compare against and passing '
    + 'would mean nothing.',
  );
}

const BACKEND = backendDir();
const py = (rel: string): string => readFileSync(path.join(BACKEND, rel), 'utf8');

/* ── 1. The task push ────────────────────────────────────────────────────── */

/**
 * Every task-id shape the server can mint, as a sample id.
 *
 * Read out of the f-strings rather than listed, so a fifth call site with a
 * different length is covered the day it is written.
 */
function serverTaskIdSamples(): { id: string; where: string }[] {
  const out: { id: string; where: string }[] = [];
  for (const rel of ['server.py', 'routers/templates.py']) {
    const src = py(rel);
    for (const m of src.matchAll(/f"task_\{uuid\.uuid4\(\)\.hex\[:(\d+)\]\}"/g)) {
      const n = Number(m[1]);
      // hex, so the worst case for a charset test is all letters.
      out.push({ id: 'task_' + 'abcdef'.repeat(11).slice(0, n), where: `${rel} hex[:${n}]` });
      out.push({ id: 'task_' + '0123456789'.repeat(7).slice(0, n), where: `${rel} hex[:${n}]` });
    }
  }
  return out;
}

/** The `SAFE_ID` literal the tap handler actually gates on. */
function safeIdRegex(): RegExp {
  const code = readCode('hooks/usePushNotifications.ts');
  const m = /const\s+SAFE_ID\s*=\s*\/((?:\\.|\[(?:\\.|[^\]])*\]|[^/\\])+)\/([a-z]*)/.exec(code);
  assert.ok(m, 'usePushNotifications.ts no longer declares a SAFE_ID regex — the '
    + 'task branch is gated on something this test cannot see.');
  return new RegExp(m[1], m[2]);
}

test('every task id the server can mint passes the tap handler’s SAFE_ID', () => {
  const samples = serverTaskIdSamples();
  assert.ok(
    samples.length >= 2,
    'found no `f"task_{uuid.uuid4().hex[:N]}"` in the backend. Either the id '
    + 'format moved and this test must follow it, or the parse broke — and a '
    + 'broken parse here passes for the wrong reason.',
  );

  const SAFE_ID = safeIdRegex();
  for (const { id, where } of samples) {
    assert.ok(
      SAFE_ID.test(id),
      `SAFE_ID rejects ${id}, which ${where} produces. The tap falls through to `
      + `parseSanvaadUrl, which returns null for a /tasks/ url, so the push opens `
      + `nothing. This is the exact shape of the defect that shipped: a uuid `
      + `pattern gating ids that are not uuids.`,
    );
  }
});

test('SAFE_ID still refuses anything that would redirect the /tasks/ request', () => {
  // The id is interpolated into `/tasks/${taskId}` with no encoding, so the
  // charset is the whole of what stops a push from addressing another endpoint.
  const SAFE_ID = safeIdRegex();
  for (const bad of [
    '../admin', 'task_1/../../x', 'task_1%2f', 'task_1?a=b', 'task_1#f',
    'task_1.json', 'task 1', '', 'a'.repeat(65),
  ]) {
    assert.ok(!SAFE_ID.test(bad), `SAFE_ID admits ${JSON.stringify(bad)}`);
  }
});

test('the client reads the same data key the server writes for a task push', () => {
  // Server side: both senders write the id under this key.
  const senders = py('services/expo_push_service.py') + py('services/push_service.py');
  const keys = [...senders.matchAll(/["'](task[_A-Za-z]*[Ii][dD])["']\s*:/g)].map(m => m[1]);
  assert.ok(keys.length > 0, 'no task-id key found in the push senders');
  const unique = [...new Set(keys)];
  assert.deepEqual(
    unique, ['taskId'],
    `the push senders write the task id under ${unique.join(', ')}; the mobile `
    + `handler reads data.taskId and would find nothing.`,
  );

  const code = readCode('hooks/usePushNotifications.ts');
  assert.match(code, /data\.taskId\b/, 'the tap handler no longer reads data.taskId');
});

test('a task push is read as a task BEFORE it is offered to the Sanvaad parser', () => {
  // `/tasks/<id>` is not a Sanvaad url, so if the order inverted the task branch
  // would still win — but only by accident. The order is the contract: the
  // in-app banner documents the same one, and both must agree.
  const code = readCode('hooks/usePushNotifications.ts');
  const task = code.indexOf('data.taskId');
  const chat = code.indexOf('parseSanvaadUrl(data.url)');
  assert.ok(task !== -1 && chat !== -1, 'targetOf no longer has both branches');
  assert.ok(task < chat, 'the Sanvaad branch now precedes the task branch');
});

test('a task or reminder url raises no "can’t open that" — it was never Sanvaad’s', () => {
  // `data.url` is a SHARED field: `send_expo_push` defaults it to "/" and writes
  // it on EVERY send, so gating the alert on `typeof data.url === 'string'`
  // fires it for every reminder whose only destination is the home screen.
  for (const { id } of serverTaskIdSamples()) {
    assert.equal(isSanvaadUrl(`/tasks/${id}`), false);
    assert.equal(parseSanvaadUrl(`/tasks/${id}`), null);
  }
  // The two literals the server actually defaults to.
  for (const url of ['/', '/tasks']) {
    assert.equal(isSanvaadUrl(url), false, `${url} would raise the alert`);
  }

  const code = readCode('hooks/usePushNotifications.ts');
  assert.match(
    code, /if\s*\(\s*isSanvaadUrl\(data\.url\)\s*\)/,
    'the alert is no longer guarded by isSanvaadUrl. Guarding it on the presence '
    + 'of data.url alerts on every task and reminder push, because the server '
    + 'defaults that field to "/" and always sends it.',
  );
});

/* ── 2. The mention url ──────────────────────────────────────────────────── */

test('the thread query parameter is spelled the same on both sides', () => {
  const server = py('services/samvaad_mentions.py');
  const decl = /MENTION_URL_THREAD_PARAM\s*=\s*["'](\w+)["']/.exec(server);
  assert.ok(decl, 'the server no longer declares MENTION_URL_THREAD_PARAM');

  // And that the builder actually uses the constant rather than a literal.
  assert.match(
    server, /url\s*\+=\s*f"&\{MENTION_URL_THREAD_PARAM\}=/,
    '_deep_link no longer builds the thread param from the named constant',
  );

  const client = /const\s+THREAD_PARAM\s*=\s*['"](\w+)['"]/.exec(readCode('lib/deepLink.ts'));
  assert.ok(client, 'deepLink.ts no longer declares THREAD_PARAM');
  assert.equal(
    client[1], decl[1],
    `the server appends &${decl[1]}= and the client reads "${client[1]}". A client `
    + `reading the wrong name opens no thread panel and lands the reader at the `
    + `bottom of a channel with nothing highlighted.`,
  );
});

test('the channel and message parameters the server builds are the ones parsed', () => {
  // Built by hand in `_deep_link`, so the names are literals there.
  const built = /url\s*=\s*f"\/sanvaad\?([^"]+)"/.exec(py('services/samvaad_mentions.py'));
  assert.ok(built, '_deep_link no longer builds a /sanvaad url');
  const names = [...built[1].matchAll(/[?&]?(\w+)=/g)].map(m => m[1]);
  assert.deepEqual(names, ['channel', 'message'], `_deep_link now builds ${names.join(', ')}`);

  // Parsed end to end rather than by reading the parser's source.
  const t = parseSanvaadUrl(
    '/sanvaad?channel=11111111-1111-4111-8111-111111111111'
    + '&message=22222222-2222-4222-8222-222222222222'
    + '&thread=33333333-3333-4333-8333-333333333333',
  );
  assert.deepEqual(t, {
    channelId: '11111111-1111-4111-8111-111111111111',
    message:   '22222222-2222-4222-8222-222222222222',
    thread:    '33333333-3333-4333-8333-333333333333',
  });
});

/* ── 3. GET /directory ───────────────────────────────────────────────────── */

/** The query parameters `messaging.directory` accepts, excluding injections. */
function directoryServerParams(): string[] {
  const src = py('routers/messaging.py');
  const at = src.indexOf('async def directory(');
  assert.notEqual(at, -1, 'routers/messaging.py no longer defines `directory`');

  let i = src.indexOf('(', at);
  let depth = 0;
  let end = i;
  for (; end < src.length; end++) {
    if (src[end] === '(') depth++;
    else if (src[end] === ')') { depth--; if (depth === 0) break; }
  }
  const sig = src.slice(i + 1, end);

  const out: string[] = [];
  let d = 0, cur = '';
  const flush = () => {
    const t = cur.trim();
    cur = '';
    if (!t || t.startsWith('*')) return;
    if (/Depends\s*\(/.test(t)) return;          // injected, not a query param
    const m = /^(\w+)/.exec(t);
    if (m) out.push(m[1]);
  };
  for (const ch of sig + ',') {
    if ('([{'.includes(ch)) d++;
    if (')]}'.includes(ch)) d--;
    if (ch === ',' && d === 0) flush(); else cur += ch;
  }
  return out;
}

test('every parameter the client sends to /directory is one the server accepts', () => {
  const accepted = directoryServerParams();
  assert.ok(
    accepted.includes('q') && accepted.includes('limit'),
    `parse of the directory signature returned ${accepted.join(', ')} — it has `
    + `missed the ordinary parameters, so any agreement below is accidental.`,
  );

  // The `params: { … }` object the client hands axios.
  const code = readCode('api/messages.ts');
  const at = code.indexOf("'/v1/messaging/directory'");
  assert.notEqual(at, -1, 'messages.ts no longer calls /v1/messaging/directory');
  const pat = code.indexOf('params:', at);
  assert.notEqual(pat, -1, 'the directory call no longer passes a params object');
  const open = code.indexOf('{', pat);
  let d = 0, close = open;
  for (; close < code.length; close++) {
    if (code[close] === '{') d++;
    else if (code[close] === '}') { d--; if (d === 0) break; }
  }
  const sent = [...code.slice(open + 1, close).matchAll(/(?:^|[,{\s])(\w+)\s*:/g)].map(m => m[1]);
  assert.ok(sent.length > 0, 'read no parameters out of the directory call');

  for (const name of sent) {
    assert.ok(
      accepted.includes(name),
      `the client sends "${name}" to GET /directory and the server's signature `
      + `accepts [${accepted.join(', ')}]. FastAPI ignores an unknown query `
      + `parameter silently, so this does not 4xx — it just stops scoping. For `
      + `channel_id that means the mention picker offers the whole org in a `
      + `private channel, and every name past the resolver's reach posts a `
      + `mention that notifies nobody and tells the sender nothing.`,
    );
  }

  // The one that matters is genuinely there, in case `sent` ever parses empty.
  assert.ok(sent.includes('channel_id'), 'the client no longer scopes /directory by channel');
});

/* ── 4. The stored answer, on a reopened conversation ────────────────────── */

/**
 * The keys `hub.sahayak_chat_history` lifts out of `hub_chat_messages.answer`.
 *
 * Read out of the tuple rather than listed, so a key added on the server is
 * compared the day it is added and not the day somebody remembers this file.
 */
function serverReadbackKeys(): string[] {
  const src = py('routers/hub.py');
  const at = src.indexOf('_ANSWER_READBACK = (');
  assert.notEqual(at, -1, 'routers/hub.py no longer declares _ANSWER_READBACK — '
    + 'either the read-back moved or this parse broke, and a broken parse here '
    + 'passes for the wrong reason.');
  const end = src.indexOf(')', at);
  return [...src.slice(at, end).matchAll(/"(\w+)"/g)].map(m => m[1]);
}

test('the server flattens the stored answer onto the row, and does not nest it', () => {
  /**
   * THE DEFECT THIS ENDS, and it is the one this whole file was written about:
   * two sides describing the same column in prose, agreeing right up until one
   * of them was edited.
   *
   * `hub_chat_messages.answer` has held the work steps, the figures and the
   * evidence for every answer since 2026-08-07, and nothing read it back. The
   * route that reads it — `hub.sahayak_chat_history`, which shadows
   * `hub_chat.get_chat_messages` because `server.py` includes `hub_router`
   * first — POPS the column and lifts its keys onto the row, so that the blob
   * cannot disagree with the columns it repeats under other names. Its own test
   * asserts `"answer" not in rows[1]`.
   *
   * The phone read `row.answer` and found `undefined` — for ever, on every
   * deployment, with no error anywhere. A reopened conversation showed prose
   * and sources while the browser showed the same response's steps, figures and
   * evidence, and every gate on both sides was green: the field is optional, so
   * `tsc` is happy; the blob is absent, so the defensive read is happy.
   */
  const src = py('routers/hub.py');

  assert.match(
    src, /stored\s*=\s*row\.pop\("answer"/,
    'sahayak_chat_history no longer pops `answer` off the row. If it now returns '
    + 'the blob nested, `storedAnswerOf` still reads it — but the row keys it '
    + 'prefers would be gone, and this comment would be the only record of why.',
  );

  const keys = serverReadbackKeys();
  assert.ok(keys.length >= 6, `read only [${keys.join(', ')}] out of _ANSWER_READBACK`);
  for (const k of ['work', 'figs', 'evidence', 'refusal', 'refusal_detail', 'answered']) {
    assert.ok(keys.includes(k), `the server no longer lifts "${k}" onto a history row`);
  }
});

/** The body of one top-level `function name(` — braces matched, not guessed at
 *  with a character count, which runs into whatever is declared next. */
function fnBody(code: string, name: string): string {
  const at = code.indexOf(`function ${name}`);
  assert.notEqual(at, -1,
    `api/sahayak.ts no longer has ${name}. Whatever replaced it must read the `
    + 'FLAT keys the server sends; reading only `row.answer` finds nothing.');
  const open = code.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') { depth--; if (depth === 0) return code.slice(at, i + 1); }
  }
  assert.fail(`${name} has no closing brace — the parse broke`);
}

test('the phone reads the stored answer off the row, not out of a nested blob', () => {
  const body = fnBody(readCode('api/sahayak.ts'), 'storedAnswerOf');

  // The four the screen actually renders from history. Named individually so a
  // failure says which one stopped being read.
  for (const k of ['work', 'figs', 'evidence', 'refusal']) {
    assert.match(
      body, new RegExp(`m\\.${k}\\b`),
      `storedAnswerOf no longer reads m.${k}. The server sends it on the row, so `
      + `a reopened conversation loses its ${k === 'figs' ? 'figures' : k} on the `
      + `phone while the browser still shows them off the same response.`,
    );
  }

  // And the blob is still read, because it is the shape the row would carry if
  // the two routes ever swapped places — not because anything sends it today.
  assert.match(body, /normaliseAnswerBlob\(m\.answer\)/,
    'the nested shape is no longer read at all');
});

test('every key the phone lifts off a history row is one the server puts there', () => {
  // The other direction. A client reading `m.summary` off a row the server never
  // writes is the same defect pointing the other way, and it fails the same
  // silent way — undefined, no error, a turn missing something on screen.
  const body = fnBody(readCode('api/sahayak.ts'), 'storedAnswerOf');

  const keys = serverReadbackKeys();
  const read = [...new Set([...body.matchAll(/\bm\.(\w+)\b/g)].map(m => m[1]))]
    .filter(k => k !== 'answer');   // the blob itself, not one of its keys

  assert.ok(read.length > 0, 'read no row keys out of storedAnswerOf');
  for (const k of read) {
    assert.ok(
      keys.includes(k),
      `storedAnswerOf reads m.${k} off a history row and _ANSWER_READBACK lifts `
      + `[${keys.join(', ')}]. The server never puts "${k}" there, so that read `
      + `is undefined on every response.`,
    );
  }
});
