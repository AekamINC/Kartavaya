/**
 * The Sahayak screen, read as source.
 *
 * ── Why source and not render ─────────────────────────────────────────────────
 *
 * Node's type-stripping does not transform JSX, so no `.tsx` in this repository
 * can be imported by `node --test` at all. Everything that lives in a component
 * body is reachable by reading or not at all — the same instrument, and the same
 * limits, as `falseEmpty.test.ts` and `devanagari.test.ts`.
 *
 * The LOGIC these assertions guard is covered for real elsewhere and with no
 * source reading: `api/__tests__/answerMarkdown.test.ts` executes the grammar,
 * `api/__tests__/sahayakStream.test.ts` executes the stream and its four
 * invariants. What is left for this file is the wiring — that the screen
 * actually reaches them, which is the failure `CardList` already demonstrated
 * once: a correct module with no consumers passes every test it has and changes
 * nothing on screen.
 *
 * Nothing here can prove the screen renders, that a touch target is 44pt, or
 * that a stream arrives incrementally on a device. Those need hardware and a
 * COLD start — hot reload lies.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { readCode, srcPath } from '../../test/source.ts';

const SCREEN = 'screens/SahayakScreen.tsx';
const code = readCode(SCREEN);

/**
 * A file of `backend/`, verbatim.
 *
 * One assertion below is about a sentence this screen prints concerning the
 * SERVER's books, so the server is the thing to check it against — the same
 * instrument `api/__tests__/serverContract.test.ts` uses, and for the reason
 * its header gives: prose on two sides agrees right up until one is edited,
 * and then it agrees just as confidently while being wrong.
 *
 * Read raw. `stripComments` understands JavaScript comments, and Python's are
 * not those. A miss THROWS rather than skips: a contract check that quietly
 * stops comparing passes for the wrong reason.
 */
function backend(rel: string): string {
  let dir = srcPath('..');
  for (let i = 0; i < 5; i++) {
    if (existsSync(path.join(dir, 'backend', 'server.py'))) {
      return readFileSync(path.join(dir, 'backend', rel), 'utf8');
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not locate backend/ from mobile/src to read ${rel}.`);
}

/* ── 1. The grammar the screen renders ────────────────────────────────────── */

test('the answer is drawn with the CommonMark renderer, never with Sanvaad\'s', () => {
  /**
   * `RichText` is Slack's grammar — `*bold*` with one asterisk — and pointing it
   * at model output is what made `*urgent*` bold on the phone and italic on the
   * web. It is still correct for a colleague's message and is untouched in
   * `components/`; it must not come back here.
   */
  assert.match(code, /<AnswerText/, 'the answer is no longer rendered by AnswerText');
  assert.doesNotMatch(
    code, /<RichText/,
    'SahayakScreen renders an ANSWER with Sanvaad\'s Slack grammar again — '
    + '`*urgent*` then reads bold here and italic on the web.',
  );
  assert.doesNotMatch(code, /from\s+'\.\.\/components\/RichText'/);
  assert.match(code, /parseAnswer/, 'the screen no longer uses the answer grammar at all');
});

/* ── 2. The streaming invariants, as the screen holds them ────────────────── */

test('INVARIANT 1 — the stored turn is built from the FINAL frame', () => {
  // `answerTurn` is the only place a turn's prose is set, and it must read the
  // server's finished text. A screen that stored its own accumulation would
  // show citations `strip_invalid_refs` rejected.
  assert.match(code, /content:\s*answer\.message/,
    'the answer turn no longer takes its text from the final frame');
  assert.doesNotMatch(code, /content:\s*live\b/,
    'a turn is being built from the live buffer — what streamed is provisional');
  assert.doesNotMatch(code, /content:\s*liveBuf/,
    'a turn is being built from the live buffer — what streamed is provisional');
});

test('INVARIANT 1 — text that is still streaming is parsed with NO citable set', () => {
  // The live block passes no `citable`, so every `[n]` in a partial answer stays
  // as the characters the model typed until the final frame stands behind it.
  const from = code.indexOf('const liveBlock');
  assert.notEqual(from, -1, 'the live block has moved — this check is blind');
  const live = code.slice(from, code.indexOf(') : null;', from));
  assert.ok(live.length > 0, 'the live block has moved — this check is blind');
  assert.match(live, /<AnswerText[^>]*text=\{live\.text\}/);
  assert.doesNotMatch(live, /sources=/,
    'streaming text is being given sources, so its [n] markers would become '
    + 'controls before the server has validated them');
});

test('INVARIANT 2 — only StreamUnavailable falls back to the non-streaming route', () => {
  // Anything else may already have been generated and charged for; a second ask
  // pays twice, and once text has been read it also rewrites what the reader
  // saw. The taxonomy is enforced in `api/sahayak.ts`; this is the screen
  // acting on it.
  assert.match(code, /e instanceof StreamUnavailable/);
  assert.doesNotMatch(
    code, /e instanceof StreamFailed[\s\S]{0,120}?plain\(\)/,
    'a StreamFailed is being retried on POST /chat — that is a second charge',
  );
});

test('INVARIANT 3 — a turn that ended early states the cost WITHOUT inventing a number', () => {
  const partial = code.slice(code.indexOf('a-partial-'), code.indexOf('a-partial-') + 500);
  assert.ok(partial.length > 0, 'the partial turn has moved — this check is blind');
  // No sources: the text never reached `strip_invalid_refs`.
  assert.match(partial, /sources:\s*\[\]/);
  // And no cost figure: `credits_charged` rides on the final frame this turn
  // never received, and printing a figure the server did not return is the one
  // thing this product does not do.
  assert.doesNotMatch(partial, /credits:/,
    'a partial turn is claiming a credit figure it cannot have received');
  assert.match(code, /it still cost credits/,
    'the screen no longer says that stopping does not refund the answer');
});

test('the credits claim is made only about a turn that can support it', () => {
  /**
   * THE SENTENCE WAS A CLAIM ABOUT THE SERVER'S BOOKS, AND IT WAS FALSE HALF
   * THE TIME. `hub._refund_abandoned` puts the credit BACK when the reader
   * leaves before the provider is asked — the guard runs from the charge to the
   * line before `generate_stream`, which is exactly the window the Stop button
   * makes easy to hit, during "Thinking…". A reader who stopped there was told
   * they had paid for an answer they had just been refunded for.
   *
   * The refund is read off the server rather than asserted from memory: if that
   * guard is ever removed, the honest sentence changes and this test says so.
   */
  const hub = backend('routers/hub.py');
  assert.match(hub, /_refund_abandoned\(receipt\.tx_id/,
    'the server no longer refunds a reader who left before the model — the '
    + 'conditional sentence on the phone is now the wrong one.');

  // Text having arrived is the one signal the phone can trust: a delta means
  // tokens were generated, which means the provider billed us. The claim must
  // therefore sit inside a branch on the turn's own content.
  const at = code.indexOf('it still cost credits');
  const clause = code.slice(Math.max(0, at - 400), at);
  assert.match(clause, /item\.content\s*\n?\s*\?/,
    'the credits sentence is printed unconditionally again. It is only true of '
    + 'a turn that actually received text.');
});

test('INVARIANT 4 — nothing partial is ever stored as a complete answer', () => {
  // The only assistant turns the screen builds are `answerTurn` (final frame)
  // and the partial one, which is always marked and rendered with its own
  // sentence. A third path would be a half answer with no label on it.
  const assistantTurns = code.match(/role:\s*'assistant'/g) ?? [];
  assert.equal(
    assistantTurns.length, 2,
    `the screen builds ${assistantTurns.length} kinds of assistant turn. `
    + 'There are two: the final frame, and the one that ended early.',
  );
  // And the partial one cannot be built without saying which kind it is.
  assert.match(code, /partial:\s*wasStopped\s*\?\s*'stopped'/);
});

test('a stream that DIES after delivering text keeps what arrived', () => {
  /**
   * The reader watched text arrive and then watched it vanish.
   *
   * A stop kept its partial text; a stream that failed on its own after
   * delivering some was handled identically to one that never started — the
   * buffer was read into a local, the stopped branch returned before touching
   * it, and everything below dropped the turn and showed an alert. Same bytes,
   * same fact about them (they arrived, they are not a whole answer), opposite
   * treatment.
   *
   * `sawDelta` is the discriminator, and it is the flag `api/sahayak.ts` sets
   * for exactly this: text on screen must never be rewritten or removed.
   */
  const from = code.indexOf('onError: async');
  const onError = code.slice(from, code.indexOf('const send = useCallback', from));
  assert.ok(onError.length > 0, 'onError has moved — this check is blind');

  assert.match(
    onError, /wasStopped\s*\|\|\s*\(text\s*&&\s*e instanceof StreamFailed\s*&&\s*e\.sawDelta\)/,
    'a cut-off stream no longer keeps the text it delivered',
  );
  // A failure with NO text is a different case and must still fall through to
  // the recovery path — there is nothing to keep, and inventing an empty
  // assistant turn for it would be a half answer with nothing in it.
  assert.ok(
    onError.includes('setTurns(prev => prev.filter('),
    'the recovery path that drops the optimistic question is gone',
  );
});

test('a stop cannot leak into the next turn', () => {
  /**
   * `stopped.current` was set by Stop and cleared only inside the stopped arm
   * of `onError`. A stop that landed while the stream was already resolving —
   * the abort fires, `askStreaming` has already returned — left it true for
   * ever: `onError` never ran, and the NEXT question's first failure rendered
   * as "you stopped this", truncated, with no alert and the words not handed
   * back.
   *
   * Two halves, both asserted: cleared before every turn, and read-then-cleared
   * where it is used.
   */
  const fn = code.slice(code.indexOf('mutationFn: async'), code.indexOf('onSuccess:'));
  assert.match(fn, /stopped\.current\s*=\s*false/,
    'the stop flag is not reset when a new question is sent');

  const onError = code.slice(code.indexOf('onError: async'), code.indexOf('const send = useCallback'));
  assert.match(onError, /const wasStopped = stopped\.current;\s*stopped\.current = false;/,
    'the stop flag is read without being cleared on every path');
});

test('the stream is actually reached, and it can actually be stopped', () => {
  assert.match(code, /askStreaming\(/, 'the screen never calls the streaming client');
  assert.match(code, /new AbortController\(\)/);
  assert.match(code, /signal:\s*ctrl\.signal/, 'the stream is opened without a signal to abort');
  assert.match(code, /abort\.current\?\.abort\(\)|abort\.current\.abort\(\)/);
});

/* ── 2b. The thread an answer belongs to ──────────────────────────────────── */

test('an answer cannot land in a conversation it was not asked in', () => {
  /**
   * THE CROSSING, AND WHY IT IS WORSE THAN A STRAY PARAGRAPH.
   *
   * Every control stays live during a send — only the send button is disabled —
   * so the reader can pick another client, open a stored conversation or start
   * a new one while the stream is open, and all three empty the thread. The
   * answer to the OLD question was then appended to the new one and `onSuccess`
   * moved `sessionId` with it. `_sahayak_answer` reads `client_id` back OFF the
   * session and ignores the one in the body, so the NEXT question was answered
   * out of the previous client's knowledge base while the header named the new
   * one.
   *
   * The server half is read rather than remembered: if that lookup ever starts
   * honouring `body.client_id`, the consequence changes and this says so.
   */
  const hub = backend('routers/hub.py');
  assert.match(
    hub, /if body\.session_id:[\s\S]{0,600}?client_id = str\(session\["client_id"\]\)/,
    'the server no longer derives the client from the session — the crossing this '
    + 'guard exists for has changed shape.',
  );

  // One token for what is on screen, one for what is in flight, compared before
  // anything is written.
  assert.match(code, /const thread = useRef\(0\)/, 'the thread has no identity to compare');
  assert.match(code, /const asking = useRef\(0\)/);
  assert.match(code, /asking\.current = thread\.current/,
    'the question in flight is never bound to the thread it was asked in');

  const guards = code.match(/asking\.current !== thread\.current/g) ?? [];
  assert.equal(guards.length, 2,
    `${guards.length} of the two mutation handlers drop a crossed answer. Both must: `
    + 'onSuccess appends it and moves the session, onError writes a partial turn '
    + 'and hands the question back into the composer.');

  // And the stream is closed rather than left writing into a thread nobody is
  // reading — a socket nobody reads is also a composer that stays disabled.
  const leave = code.slice(code.indexOf('const leaveThread'), code.indexOf('const [hot,'));
  assert.match(leave, /thread\.current \+= 1/);
  assert.match(leave, /abort\.current\?\.abort\(\)/, 'leaving a thread does not close its stream');

  for (const fn of ['const chooseClient', 'const openSession', 'const newConversation']) {
    const at = code.indexOf(fn);
    assert.notEqual(at, -1, `${fn} has moved — this check is blind`);
    // To the `}, [` that closes its `useCallback`, so a neighbour's call cannot
    // satisfy this one.
    const body = code.slice(at, code.indexOf('}, [', at));
    assert.ok(body.length > 0 && body.length < 1200, `${fn} has moved — this check is blind`);
    assert.match(body, /leaveThread\(\)/,
      `${fn} empties the thread without leaving the one in flight behind`);
  }
});

test('a stopped FIRST answer still finds the conversation the server opened', () => {
  /**
   * `_sahayak_answer` opens the session at step 2b and stores the question at
   * step 5, both before any delta, but `session_id` only ever rides on the
   * `final` frame — which a stopped or cut stream never receives. So the
   * follow-up went out with `session_id: null`, the server opened a SECOND
   * conversation, and its `history_text` read over the new session returned
   * nothing: the reader saw one continuous thread and asked "and for last
   * month?" against a model that had never been shown the first exchange.
   */
  // The kept-turn branch, to the line where the recovery below it begins.
  const at = code.indexOf('a-partial-');
  const branch = code.slice(at, code.indexOf('setTurns(prev => prev.filter(', at));
  assert.ok(branch.length > 0 && branch.length < 2000,
    'the partial branch has moved — this check is blind');
  assert.match(branch, /!sessionId && clientId/,
    'a thread whose first answer ended early is left with no session id');
  assert.match(branch, /sessionTitleFor\(sent\.current\)/,
    'the session is not looked up by the title the server derived from the question');
  assert.match(branch, /setSessionId\(mine\.id\)/);
});

test('the recovery refetch keeps the partial the server has no row for', () => {
  /**
   * `GET …/messages` is the authority for everything the server holds, and a
   * stopped or cut answer is exactly what it does not hold —
   * `ai_router._record_abandoned` writes no assistant row. Replacing the thread
   * wholesale therefore deleted text the reader had already read, one turn
   * after it was deliberately kept.
   */
  const onError = code.slice(code.indexOf('onError: async'), code.indexOf('const send = useCallback'));
  assert.match(onError, /withKeptPartials\(rowsToTurns\(stored\), prev\)/,
    'the recovery replaces the thread wholesale again — the kept partial goes with it');
  assert.doesNotMatch(onError, /setTurns\(rowsToTurns\(stored\)\)/);
});

/* ── 3. History ───────────────────────────────────────────────────────────── */

test('past conversations are listed, opened and continued', () => {
  // Both routes existed and were typed in `api/sahayak.ts` for months with no
  // caller at all, which is why this asserts the CALL and not the import.
  assert.match(code, /sahayakApi\.sessions\(/, 'the sessions list is never fetched');
  assert.match(code, /sahayakApi\.messages\(/, 'a stored conversation is never read back');
  // Continuing it means the session id becomes the one the next question is
  // sent with. Without this the thread would render and the next answer would
  // open a brand new conversation beside it.
  assert.match(code, /setSessionId\(id\)/);
});

test('opening a conversation sets the session AFTER its messages are in hand', () => {
  const open = code.slice(code.indexOf('const openSession'), code.indexOf('const newConversation'));
  assert.ok(open.length > 0, 'openSession has moved — this check is blind');
  assert.ok(
    open.indexOf('sahayakApi.messages(') < open.indexOf('setSessionId('),
    'the session id is set before the thread is loaded — a question sent in that '
    + 'window lands in a conversation the reader cannot see yet',
  );
});

test('the history list shows names, never ids', () => {
  // The standing rule across this product: no user, member, org — or here,
  // conversation — identifier is ever rendered. A `key` is not rendering.
  const withoutKeys = code.replace(/key=\{[^}]*\}/g, '');
  assert.doesNotMatch(withoutKeys, /\{\s*sn\.id\s*\}/, 'a session id is being rendered');
  assert.match(code, /sn\.title/, 'the history rows do not show the conversation title');
});

test('a failed history fetch does not read as an empty history', () => {
  // The false-empty defect, in the one list on this screen the screen-wide
  // sweep cannot see: it is inside a sheet, not behind `resolveScreenState`.
  const sheet = code.slice(code.indexOf('visible={historyOpen}'));
  assert.match(sheet, /sessionsQuery\.isError/, 'the history sheet never reads isError');
  assert.match(sheet, /sessionsQuery\.isLoading/);
  assert.match(sheet, /sessions\.length === 0/);
});

/* ── 4. The composer, and what it must not lose ───────────────────────────── */

test('a failed send hands the words back to the composer', () => {
  // The composer was cleared BEFORE the request and never restored, so every
  // network failure silently deleted what somebody had typed.
  const send = code.slice(code.indexOf('const send = useCallback'), code.indexOf('const stop = useCallback'));
  assert.ok(send.length > 0, 'send has moved — this check is blind');
  assert.ok(
    send.indexOf('sent.current = question') < send.indexOf("setDraft('')"),
    'the draft is cleared before it is kept — a failure then loses it',
  );
  assert.match(code, /const parked = !!draftRef\.current\.trim\(\);\s*if \(parked\) setUnsent\(sent\.current\);\s*else setDraft\(sent\.current\);/,
    'a failed send no longer restores the question');
});

test('and when it cannot, the question is parked rather than dropped', () => {
  /**
   * THE HALF THAT WAS MISSING. Restoring was guarded on the box being empty —
   * correctly, because overwriting what somebody is typing is the same defect
   * pointing the other way — and there the words went on the floor. A reader
   * who asked a question, started typing the next one while they waited, and
   * hit a network failure lost the first one outright with nothing on screen
   * about it.
   *
   * Losing what someone typed is the worst thing a chat can do, so BOTH texts
   * survive: one in the box, one in a row above it, and the tap between them is
   * a swap so the recovery cannot itself lose anything.
   */
  assert.match(code, /const \[unsent, setUnsent\] = useState\(''\)/,
    'there is nowhere for an unrestorable question to go');
  assert.match(code, /setDraft\(unsent\);\s*setUnsent\(held\.trim\(\) \? held : ''\)/,
    'the recovery overwrites the composer instead of swapping with it');

  // And it is a recovery, not a second charge: filling the box is where it
  // stops, exactly like an opener card.
  const bar = code.slice(code.indexOf('{!!unsent &&'), code.indexOf('{!!unsent &&') + 900);
  assert.ok(bar.length > 0, 'the unsent row has moved — this check is blind');
  assert.doesNotMatch(bar, /send\(\)|ask\.mutate/,
    'restoring an unsent question re-sends it, which spends credits without a tap on send');
});

test('the draft is read from a ref, not from the closure a send started in', () => {
  // `onError` runs after a round trip. The `draft` it closed over is the value
  // from the render that started the send — empty, always — so deciding whether
  // the box is occupied off that copy is deciding it off a stale answer, which
  // is how the restore came to overwrite what had been typed since.
  assert.match(code, /const draftRef = useRef\(''\)/);
  assert.match(code, /useEffect\(\(\) => \{ draftRef\.current = draft; \}, \[draft\]\)/,
    'the draft mirror is no longer kept in step with the state it mirrors');
});

/* ── 6. What a screen reader is told ──────────────────────────────────────── */

test('a streaming answer is not re-announced on every token', () => {
  /**
   * The live block was `accessibilityLiveRegion="polite"` wrapped around the
   * answer text. A live region is a promise to re-read the region whenever its
   * contents change, and these contents change on every publish — every 60ms
   * while text is arriving. A sighted reader saw an answer growing; a TalkBack
   * user heard it restarted from the top some sixty times and could never reach
   * the end of it.
   */
  const from = code.indexOf('const liveBlock');
  const live = code.slice(from, code.indexOf(') : null;', from));
  assert.ok(live.length > 0, 'the live block has moved — this check is blind');
  assert.doesNotMatch(live, /accessibilityLiveRegion=\{?['"]polite/,
    'the streaming answer is a polite live region again — it will be read from '
    + 'the beginning on every token');
  assert.match(live, /accessibilityLiveRegion="none"/,
    'the explicit "none" is the record of that defect; it must stay');
});

test('the arrival and the completion are each announced ONCE', () => {
  // What the live region was right about — that something is happening — said
  // at the two moments it is worth saying, and at no others. The completion
  // cannot be a region at all: the live block unmounts when the turn lands.
  const onDelta = code.slice(code.indexOf('onDelta: (text) =>'), code.indexOf('{ signal: ctrl.signal }'));
  assert.match(onDelta, /if \(!b\.text\) announce\(/,
    'the arrival is announced per delta, which is the interruption the live '
    + 'region was removed for');

  const onSuccess = code.slice(code.indexOf('onSuccess:'), code.indexOf('onError: async'));
  assert.match(onSuccess, /announce\(/, 'a finished answer is never announced');

  const onError = code.slice(code.indexOf('onError: async'), code.indexOf('const send = useCallback'));
  assert.match(onError, /announce\(wasStopped \?/,
    'the two ways an answer can end early are not announced');
});

/* ── 7. Links a model wrote ───────────────────────────────────────────────── */

test('a link shows where it goes, and only the choke point can open one', () => {
  /**
   * The label is written by a MODEL repeating a web-search result, so it is
   * untrusted text over an attacker-choosable target: `[the Income Tax
   * portal](…)` rendered as a live control with no destination anywhere on
   * screen. A browser answers this with a status bar and then an address bar; a
   * tap here hands straight to another app and the first thing the reader sees
   * is the page.
   */
  const at = code.indexOf("case 'a': {");
  assert.notEqual(at, -1, 'the link leaf has moved — this check is blind');
  const link = code.slice(at, at + 1200);
  assert.match(link, /hrefHost\(n\.href\)/, 'a link no longer shows its host');
  assert.match(link, /accessibilityLabel=\{host \? `\$\{n\.text\}, link to \$\{host\}`/,
    'a screen reader is told the label and not the destination — and it has no '
    + 'status bar to fall back on');

  // And the allowlist is applied where the URL is opened, not only where it is
  // parsed: `Linking.openURL('tel:…')` places a call.
  const open = code.slice(code.indexOf('const openHref ='), code.indexOf('const openHref =') + 220);
  assert.match(open, /safeHref\(href\)/,
    'openHref opens whatever it is handed. It is the one function on this '
    + 'screen that can reach Linking.openURL.');
});

/* ── 5. The read-only rules ───────────────────────────────────────────────── */

test('nothing on this screen navigates anywhere but back', () => {
  /**
   * eSign is web-only and mobile invoices are read-only. An answer that names an
   * invoice is prose about an invoice — the moment a citation, a figure or an
   * evidence row becomes a link into a document, this screen has quietly become
   * a route to both.
   */
  const navCalls = code.match(/nav\.\w+\(/g) ?? [];
  assert.deepEqual(
    [...new Set(navCalls)], ['nav.goBack('],
    `SahayakScreen now calls ${navCalls.join(', ')}. It may only go back.`,
  );
  assert.doesNotMatch(code, /esign|e-sign/i, 'eSign is not a mobile destination');
});

test('the only thing that spends credits is the send button', () => {
  // The opener cards FILL the composer; they do not send. The mobile app is the
  // easiest place in the product to fire a paid model call by accident.
  const openers = code.slice(code.indexOf('{OPENERS.map'), code.indexOf('{OPENERS.map') + 600);
  assert.ok(openers.length > 0, 'the opener cards have moved — this check is blind');
  assert.match(openers, /onPress=\{\(\) => setDraft\(o\.prompt\)\}/);
  assert.doesNotMatch(openers, /send\(\)|ask\.mutate/, 'an opener card is sending on tap');
});
