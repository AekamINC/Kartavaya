/**
 * The two facts about a conversation that only the phone holds.
 *
 * Both exist because the streaming contract puts `session_id` on the `final`
 * frame and nowhere else, and because `GET /chat/sessions/{id}/messages` is the
 * authority for everything EXCEPT the one thing the reader can see on screen.
 * Neither is markdown and neither is the stream, so they live here rather than
 * in `answerMarkdown.test.ts` or `sahayakStream.test.ts`.
 *
 * `sessionTitleFor` and `withKeptPartials` are in `api/sahayak.ts` rather than
 * in the screen for the reason `parseAnswer` is: `node --test` cannot load a
 * `.tsx` at all, so logic left in a component body can only be read, never run.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { sessionTitleFor, withKeptPartials } from '../sahayak.ts';
import { srcPath } from '../../test/source.ts';

/** `backend/routers/hub.py`, verbatim. A miss THROWS: a contract check that
 *  quietly stops comparing passes for the wrong reason. */
function hub(): string {
  let dir = srcPath('..');
  for (let i = 0; i < 5; i++) {
    if (existsSync(path.join(dir, 'backend', 'server.py'))) {
      return readFileSync(path.join(dir, 'backend', 'routers', 'hub.py'), 'utf8');
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate backend/ from mobile/src to read routers/hub.py.');
}

/* ── 1. Finding a session this client was never told the id of ────────────── */

test('the title is the one handle on a session opened during a stopped answer', () => {
  /**
   * The server opens the conversation at step 2b and stores the question at
   * step 5, both before the first delta; `session_id` rides on the `final`
   * frame alone. So a first answer that is stopped or cut leaves the phone with
   * a live conversation it cannot name, and the follow-up — sent with
   * `session_id: null` — opened a SECOND one whose history read returned
   * nothing. The reader saw one thread and asked "and for last month?"; the
   * model had never been shown the first exchange.
   *
   * The title is derived from the question and is therefore reproducible here.
   * It is read off the server rather than pinned, because a title the server
   * stopped writing is a lookup that silently stops matching.
   */
  const src = hub();
  assert.match(
    src, /question\[:60\] \+ \("…" if len\(question\) > 60 else ""\)/,
    'the server no longer titles a new conversation with the question — the phone '
    + 'has nothing left to find it by, and the follow-up will open a second one.',
  );

  assert.equal(sessionTitleFor('what is unpaid?'), 'what is unpaid?');
  // `body.message.strip()` on the server; the phone sends `draft.trim()`.
  assert.equal(sessionTitleFor('  what is unpaid?  '), 'what is unpaid?');
  assert.equal(sessionTitleFor(''), '');

  const long = 'a'.repeat(80);
  assert.equal(sessionTitleFor(long), `${'a'.repeat(60)}…`);
  assert.equal(sessionTitleFor('b'.repeat(60)), 'b'.repeat(60), 'exactly 60 takes no ellipsis');
});

test('the cut is by CODE POINT, because Python\'s is', () => {
  // `question[:60]` counts code points and `String.prototype.slice` counts
  // UTF-16 units. The two agree across Devanagari and Gujarati and part company
  // on the first emoji — where a title built with `slice` would also be able to
  // end on half a surrogate pair, which is not a string the server ever wrote.
  const devanagari = 'क'.repeat(70);
  assert.equal(Array.from(sessionTitleFor(devanagari)).length, 61);

  const emoji = '🙏'.repeat(70);
  const cut = sessionTitleFor(emoji);
  assert.equal(Array.from(cut).length, 61, 'a surrogate pair counted as two characters');
  assert.equal(cut, `${'🙏'.repeat(60)}…`);
});

/* ── 2. Keeping text the reader has already read ──────────────────────────── */

const U = (content: string) => ({ role: 'user' as const, content });
const A = (content: string) => ({ role: 'assistant' as const, content });
const P = (content: string) => ({ role: 'assistant' as const, content, partial: 'stopped' });

test('a recovery refetch does not delete the partial answer on screen', () => {
  /**
   * The defect this closes, in order: ask and answer (a session now exists);
   * ask again and tap Stop after text arrives (a `partial` turn is kept, with
   * its text); ask a third time and let it fail with nothing — airplane mode,
   * or the 15-second axios timeout. The recovery re-reads the stored messages,
   * which is right, and REPLACED the thread with them, which deleted the
   * stopped turn: a client that disconnects runs `ai_router._record_abandoned`
   * and no assistant row is ever written. Text appeared, was read, and vanished
   * — one turn later than the behaviour the partial turn exists to end.
   */
  const stored = [U('q1'), A('a1'), U('q2'), U('q3')];
  const local  = [U('q1'), A('a1'), U('q2'), P('half an answer'), U('q3')];
  assert.deepEqual(
    withKeptPartials(stored, local).map(t => t.content),
    ['q1', 'a1', 'q2', 'half an answer', 'q3'],
    'the kept text must come back under the question it answered, not at the end',
  );
});

test('a slot the server DID answer drops its partial rather than doubling it', () => {
  // A cut stream can have finished server-side — the socket died, the answer
  // did not — and printing the fragment above the whole answer reads as the
  // model saying the same thing twice.
  const stored = [U('q1'), A('a1'), U('q2'), A('the whole answer')];
  const local  = [U('q1'), A('a1'), U('q2'), P('the first half')];
  assert.deepEqual(
    withKeptPartials(stored, local).map(t => t.content),
    ['q1', 'a1', 'q2', 'the whole answer'],
  );
});

test('position is counted in QUESTIONS, so two partials do not slide', () => {
  // The stored list has no row for a partial, so a row index would drift by one
  // for every one of them. Every question above a partial reached the server —
  // text arrived, so it was asked and stored — which is what lines the two up.
  const stored = [U('q1'), U('q2'), U('q3'), A('a3')];
  const local  = [U('q1'), P('p1'), U('q2'), P('p2'), U('q3'), A('a3')];
  assert.deepEqual(
    withKeptPartials(stored, local).map(t => t.content),
    ['q1', 'p1', 'q2', 'p2', 'q3', 'a3'],
  );
});

test('a partial whose question the server never stored still survives', () => {
  // Nothing to anchor it to, so it goes on the end. Dropping text the reader
  // has read is the one outcome this function rules out.
  const stored = [U('q1'), A('a1')];
  const local  = [U('q1'), A('a1'), U('q2'), P('half')];
  assert.deepEqual(withKeptPartials(stored, local).map(t => t.content), ['q1', 'a1', 'half']);
});

test('with nothing to keep, the stored rows are returned untouched', () => {
  const stored = [U('q1'), A('a1')];
  assert.equal(withKeptPartials(stored, [U('q1'), A('a1')]), stored,
    'the ordinary recovery must not pay for a merge it does not need');
});
