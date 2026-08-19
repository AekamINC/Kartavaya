/**
 * The app's upload caps, checked against the server rather than against
 * themselves.
 *
 * `NewTaskSheet` carried `const MAX_MB = 5` and never read it, so nothing on
 * the sheet stopped an oversized file: the phone uploaded a 4K clip over mobile
 * data for as long as that took and `POST /api/upload` refused it on arrival.
 * The number was also wrong twice over — half the server's document cap, a
 * fifth of its video cap.
 *
 * So the fixture is `backend/routers/uploads.py` itself, read as text. Change a
 * cap on the server and this goes red until the app follows. A FAILED READ
 * FAILS the test rather than skipping: "the file moved" and "the numbers agree"
 * must not look the same from here. `frontend/src/__tests__/uploadLimits.test.jsx`
 * holds the web half of the same contract.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { MAX_MB, MAX_MB_VIDEO, limitMbFor, isOversize, oversizeMessage } from '../uploadLimits.ts';
import { srcPath, readCode } from '../../test/source.ts';

const REPO = path.resolve(srcPath('.'), '..', '..');
const UPLOADS_PY = path.join(REPO, 'backend', 'routers', 'uploads.py');

/** `NAME = 10 * 1024 * 1024` → 10. Throws rather than guessing. */
function serverCapMb(name: string): number {
  let source: string;
  try {
    source = readFileSync(UPLOADS_PY, 'utf8');
  } catch (e) {
    throw new Error(`Could not read ${UPLOADS_PY} — ${(e as Error).message}`);
  }
  const m = new RegExp(`${name}\\s*=\\s*(\\d+)\\s*\\*\\s*1024\\s*\\*\\s*1024`).exec(source);
  if (!m) throw new Error(`${name} is no longer declared as N * 1024 * 1024 in ${UPLOADS_PY}`);
  return Number(m[1]);
}

test('MAX_MB is uploads.MAX_BYTES', () => {
  assert.equal(MAX_MB, serverCapMb('MAX_BYTES'));
});

test('MAX_MB_VIDEO is uploads.MAX_BYTES_VIDEO', () => {
  assert.equal(MAX_MB_VIDEO, serverCapMb('MAX_BYTES_VIDEO'));
});

test('the app never claims more than the server accepts', () => {
  assert.ok(MAX_MB <= serverCapMb('MAX_BYTES'));
  assert.ok(MAX_MB_VIDEO <= serverCapMb('MAX_BYTES_VIDEO'));
});

test('the cap is chosen by extension, the way uploads.py chooses it', () => {
  assert.equal(limitMbFor('scan.pdf'), MAX_MB);
  assert.equal(limitMbFor('site.MOV'), MAX_MB_VIDEO);
  assert.equal(limitMbFor('clip.mkv'), MAX_MB_VIDEO);
  assert.equal(limitMbFor(null), MAX_MB);
});

test('a video is measured against the video cap, not the document one', () => {
  assert.equal(isOversize({ name: 'walk.mov', size: (MAX_MB + 1) * 1024 * 1024 }), false);
  assert.equal(isOversize({ name: 'walk.mov', size: (MAX_MB_VIDEO + 1) * 1024 * 1024 }), true);
  assert.equal(isOversize({ name: 'walk.pdf', size: (MAX_MB + 1) * 1024 * 1024 }), true);
});

test('a file the picker did not size is never refused here', () => {
  // The server still counts the bytes. Refusing on a missing number would
  // block uploads that would have worked.
  assert.equal(isOversize({ name: 'mystery.bin' }), false);
  assert.equal(isOversize({ name: 'mystery.bin', size: null }), false);
  assert.equal(isOversize({ name: 'mystery.bin', size: Number.NaN }), false);
  assert.equal(oversizeMessage([{ name: 'mystery.bin' }]), null);
});

test('the message names the file, its size and its own limit', () => {
  const msg = oversizeMessage([{ name: 'drone.mp4', size: 41 * 1024 * 1024 }]);
  assert.ok(msg);
  assert.match(msg!, /drone\.mp4/);
  assert.match(msg!, /41\.0 MB/);
  assert.match(msg!, new RegExp(`${MAX_MB_VIDEO} MB`));
});

test('nothing over means nothing to say', () => {
  assert.equal(oversizeMessage([{ name: 'a.pdf', size: 2048 }]), null);
  assert.equal(oversizeMessage([]), null);
});

/* ── NewTaskSheet, by source ──────────────────────────────────────────────────
   The sheet is `.tsx`, and Node's type-stripping does not transform JSX, so it
   cannot be imported here — see `test/source.ts`. These pin the three decisions
   that would otherwise be deletable without a test noticing. */

test('NewTaskSheet takes its caps from lib/uploadLimits and declares none', () => {
  const code = readCode('components/NewTaskSheet.tsx');
  assert.match(code, /from '\.\.\/lib\/uploadLimits'/);
  assert.doesNotMatch(code, /^\s*const\s+MAX_MB\s*=/m);
});

test('NewTaskSheet checks the size before it uploads', () => {
  const code = readCode('components/NewTaskSheet.tsx');
  const gate = code.indexOf('oversizeMessage');
  const post = code.indexOf("apiClient.post('/upload'");
  assert.ok(gate !== -1, 'the size gate is gone');
  assert.ok(post !== -1, 'the upload call moved — re-point this assertion');
  assert.ok(gate < post, 'the size is checked after the upload, which is too late to help');
});

test('NewTaskSheet keeps the files that landed when a later one fails', () => {
  const code = readCode('components/NewTaskSheet.tsx');
  // A single try around the whole loop discarded four successful uploads
  // because the fifth failed: the files were in object storage, charged to the
  // org, and shown nowhere. The per-file catch breaks the batch and the commit
  // happens in `finally`.
  assert.match(code, /break;/);
  assert.match(code, /finally\s*\{[^}]*setAttachments/s);
});

test('NewTaskSheet keeps the storage key for every attachment', () => {
  // Without the key a stored url cannot be re-signed, and it expires in nine
  // hours.
  assert.match(readCode('components/NewTaskSheet.tsx'), /key:\s*res\.data\.key/);
});
