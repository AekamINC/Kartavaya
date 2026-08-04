/**
 * The seven shapes `parseSanvaadUrl` has to survive.
 *
 * This is the one piece of the mention deep link that can be tested without a
 * renderer — the navigate itself lives inside a hook that imports
 * expo-notifications, which is native and cannot load in Node. So the parser is
 * pure on purpose, and everything the tap handler decides is decided here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseSanvaadUrl, isSanvaadUrl } from '../deepLink.ts';

const CHANNEL = '3f8a1c22-9d4e-4b71-8a55-0c1d2e3f4a5b';
const MESSAGE = 'b1c2d3e4-f5a6-4789-9abc-0123456789ab';
const ROOT    = '7e6d5c4b-3a29-4f18-8765-fedcba987654';

test('a plain mention url yields the channel and the message', () => {
  const t = parseSanvaadUrl(`/sanvaad?channel=${CHANNEL}&message=${MESSAGE}`);
  assert.deepEqual(t, { channelId: CHANNEL, message: MESSAGE });
});

test('&thread= is read under that exact name, and nothing else', () => {
  const t = parseSanvaadUrl(`/sanvaad?channel=${CHANNEL}&message=${MESSAGE}&thread=${ROOT}`);
  assert.deepEqual(t, { channelId: CHANNEL, message: MESSAGE, thread: ROOT });

  // The two names a client is likeliest to guess. Reading either instead is the
  // failure the server's MENTION_URL_THREAD_PARAM note exists to prevent.
  for (const wrong of ['parent', 'root']) {
    const miss = parseSanvaadUrl(`/sanvaad?channel=${CHANNEL}&message=${MESSAGE}&${wrong}=${ROOT}`);
    assert.equal(miss?.thread, undefined, `${wrong}= must not be read as the thread root`);
  }
});

test('a junk channel is refused outright — the caller has to say so', () => {
  assert.equal(parseSanvaadUrl(`/sanvaad?channel=oops&message=${MESSAGE}`), null);
  assert.equal(parseSanvaadUrl('/sanvaad?message=' + MESSAGE), null);
  // A path traversal in the id would reach the API as a url segment.
  assert.equal(parseSanvaadUrl('/sanvaad?channel=../../admin'), null);
});

test('a junk message is dropped, and the reader still lands in the room', () => {
  const t = parseSanvaadUrl(`/sanvaad?channel=${CHANNEL}&message=nonsense&thread=also-nonsense`);
  assert.deepEqual(t, { channelId: CHANNEL });
});

test('a url for another feature is not a Sanvaad target', () => {
  assert.equal(parseSanvaadUrl(`/tasks/${MESSAGE}`), null);
  assert.equal(parseSanvaadUrl(`/inbox?channel=${CHANNEL}`), null);
  assert.equal(isSanvaadUrl(`/tasks/${MESSAGE}`), false);
  // The shared `notifications.url` column carries these, which is why the
  // in-app banner asks isSanvaadUrl before it complains about anything.
  assert.equal(isSanvaadUrl('/approvals'), false);
});

test('undefined, an object and an empty string are all null, not a throw', () => {
  assert.equal(parseSanvaadUrl(undefined), null);
  assert.equal(parseSanvaadUrl(null), null);
  assert.equal(parseSanvaadUrl({} as unknown), null);
  assert.equal(parseSanvaadUrl(''), null);
  assert.equal(parseSanvaadUrl('   '), null);
  assert.equal(isSanvaadUrl(undefined), false);
});

test('the three accepted url shapes all resolve to the same room', () => {
  const expected = { channelId: CHANNEL };
  for (const url of [
    `/sanvaad?channel=${CHANNEL}`,           // what the server sends
    `sanvaad?channel=${CHANNEL}`,            // the same, leading slash dropped
    `kartavaya://sanvaad?channel=${CHANNEL}` // the word lands in the AUTHORITY slot
  ]) {
    assert.deepEqual(parseSanvaadUrl(url), expected, url);
  }
});

test('a malformed percent escape does not throw', () => {
  // decodeURIComponent('%') is a URIError. A notification that crashes the tap
  // handler is worse than one that opens the wrong room.
  assert.doesNotThrow(() => parseSanvaadUrl(`/sanvaad?channel=${CHANNEL}&message=%`));
  assert.deepEqual(
    parseSanvaadUrl(`/sanvaad?channel=${CHANNEL}&message=%`),
    { channelId: CHANNEL },
  );
});

test('a repeated parameter cannot be overwritten by a crafted second copy', () => {
  const t = parseSanvaadUrl(`/sanvaad?channel=${CHANNEL}&channel=${ROOT}`);
  assert.equal(t?.channelId, CHANNEL);
});

test('isSanvaadUrl is about the path, not about the ids being usable', () => {
  // The banner needs this distinction: the url WAS meant for Sanvaad, it just
  // cannot be used, which is worth a sentence. A task url is worth silence.
  assert.equal(isSanvaadUrl('/sanvaad?channel=oops'), true);
  assert.equal(parseSanvaadUrl('/sanvaad?channel=oops'), null);
});
