/**
 * ClockScreen — the retake counter and the queue-before-network order.
 *
 * ── SOURCE-CONTRACT. Read this before trusting any of it ─────────────────────
 *
 * `ClockScreen.tsx` is JSX and Node's type-stripping does not transform JSX, so
 * this file CANNOT render it, mount it, press the shutter, or observe React
 * state. Everything below reads the source as text.
 *
 * That is a real limitation and it is not disguised: these tests prove the code
 * that implements each rule is present and shaped correctly, and they go red
 * when it is deleted (each was verified by reverting the fix — the A/B is in
 * `swarm-reports/mobile-test-coverage.md`). They do NOT prove the screen behaves
 * correctly when a finger touches it.
 *
 * The half that IS tested for real lives next door in
 * `offline/__tests__/punchQueue.test.ts`: that `retry_count` reaches the wire
 * verbatim, that a punch is queued before any network call can fail it, and
 * that nothing is ever dropped. Those run the actual module.
 *
 * ── The rules, which these encode rather than re-decide ──────────────────────
 *
 * RETAKES: 3, then FLAGGED FOR A MANAGER. `RETRY_FLAG_THRESHOLD = 3` in
 * `backend/routers/pahchan.py`. The shutter is NEVER hidden and the punch is
 * never refused — §2 of the screen's own header: "No condition here returns
 * early without recording." A test asserting the shutter disappears would be
 * asserting the defect.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { readCode, readRaw, readSkeleton } from '../../../test/source.ts';

const CLOCK = 'screens/pahchan/ClockScreen.tsx';
/** Comments stripped. String literals kept, because most rules are about copy. */
const code = readCode(CLOCK);
/** Comments AND string contents stripped, for counting language structure. */
const skeleton = readSkeleton(CLOCK);

// ── Retakes ───────────────────────────────────────────────────────────────────

test('the retake threshold is 3, matching RETRY_FLAG_THRESHOLD on the server', () => {
  const m = /const MAX_RETAKES\s*=\s*(\d+)/.exec(code);
  assert.ok(m, 'MAX_RETAKES not found');
  assert.equal(Number(m![1]), 3);
});

test('THE RETAKE DEFECT — the counter is reset once a capture lands', () => {
  // `retakes` only ever incremented. After three failures in a dark doorway,
  // every LATER punch — a clean first-try clock-out an hour afterwards — still
  // sent retry_count: 3 and was flagged for a manager, and the red banner stayed
  // up for the life of the screen.
  assert.match(
    code, /setRetakes\(0\)/,
    'ClockScreen never resets the retake counter, so a spent failure count '
    + 'follows the employee onto every later punch',
  );

  // The reset must happen AFTER the punch is enqueued: retry_count belongs to
  // the punch that just landed, not to the next one. Resetting first would send 0.
  const enqueue = code.indexOf('enqueuePunch(');
  const reset = code.indexOf('setRetakes(0)');
  assert.ok(enqueue !== -1 && reset !== -1);
  assert.ok(
    reset > enqueue,
    'setRetakes(0) runs before enqueuePunch, so the count is spent before it is recorded',
  );
});

test('the count is incremented only on a failed capture', () => {
  assert.match(code, /setRetakes\(n => n \+ 1\)/, 'no increment on the failure path');
  // The increment lives in the catch block, after the failure notice.
  const catchIdx = code.lastIndexOf('} catch {');
  const incIdx = code.indexOf('setRetakes(n => n + 1)');
  assert.ok(incIdx > catchIdx, 'the increment must be on the capture-failure path');
});

test('retakes is passed to the queue as retry_count, and is a real dependency', () => {
  assert.match(
    code, /retry_count:\s*retakes/,
    'the failed-capture count is not reported to the server',
  );
  // It was read into retry_count without being declared, and stayed correct only
  // because `phase` happened to rebuild the closure alongside it — a
  // payroll-visible value kept right by an unrelated dependency.
  const deps = /\}, \[([^\]]*)\]\);/g;
  const all = [...code.matchAll(deps)].map(m => m[1]);
  assert.ok(
    all.some(d => d.includes('retakes')),
    'retakes is not in any dependency array, so the submit closure can capture a stale count',
  );
});

// ── The shutter is never hidden ───────────────────────────────────────────────

test('THE SHUTTER IS NEVER HIDDEN — past the limit the punch still goes through', () => {
  // This used to hide the shutter entirely, which locked someone out of clocking
  // in after three camera failures. The only route back was asking a manager to
  // type the time by hand — the exact payroll dispute §2 exists to prevent,
  // caused by the app rather than by the employee.
  const flag = /const willBeFlaggedForRetries\s*=\s*retakes >= MAX_RETAKES/;
  assert.match(code, flag, 'the retake flag is not computed as expected');

  // The flag may gate the WARNING, and must not gate the shutter.
  assert.doesNotMatch(
    code, /willBeFlaggedForRetries\s*\?\s*null/,
    'the retake flag hides something by rendering null — the shutter must never be hidden',
  );
  assert.doesNotMatch(
    code, /!willBeFlaggedForRetries\s*&&\s*\(?\s*<Animated\.View/,
    'the shutter is conditional on the retake count',
  );
  assert.doesNotMatch(
    code, /if\s*\(\s*willBeFlaggedForRetries\s*\)\s*return/,
    'an early return on the retake count would refuse the punch',
  );

  // The shutter's own disabled prop must depend only on phase and the refetch,
  // never on the retake count.
  const disabled = /disabled=\{([^}]*)\}/.exec(code);
  assert.ok(disabled, 'the shutter has no disabled prop');
  assert.ok(
    !disabled![1].includes('retake') && !disabled![1].includes('Retries'),
    `the shutter is disabled by the retake count: "${disabled![1].trim()}"`,
  );
});

test('the retake warning tells the employee to punch anyway', () => {
  // Being flagged is not being blocked, and the copy has to say so — otherwise
  // someone reads a red banner and stops.
  const warn = /The camera has failed \{MAX_RETAKES\} times\.[\s\S]{0,120}?Punch anyway/;
  assert.match(readRaw(CLOCK), warn, 'the retake warning no longer says the punch will still be recorded');
});

test('no condition returns early without recording the punch', () => {
  // §2: location off, weak accuracy, outside the geofence, no reference pair —
  // all flag, none block. The only early return in `submit` is the one where the
  // camera gave back no frame at all, and there is nothing to record then.
  // Counted on the skeleton: the string 'The camera did not return a photo'
  // contains the word and would read as a third exit path.
  const submitStart = skeleton.indexOf('const submit = useCallback');
  const submitEnd = skeleton.indexOf('}, [direction, phase, qc', submitStart);
  assert.ok(submitStart !== -1 && submitEnd !== -1, 'submit() not found');
  const submit = skeleton.slice(submitStart, submitEnd);

  const earlyReturns = [...submit.matchAll(/\breturn\b/g)].length;
  assert.ok(
    earlyReturns <= 2,
    `submit() has ${earlyReturns} return statements — every added one is a path that `
    + 'can refuse a punch. Expected only the guard and the no-frame case.',
  );
  assert.doesNotMatch(submit, /if\s*\([^)]*accuracy[^)]*\)\s*\{?\s*return/, 'weak accuracy must not block');
  assert.doesNotMatch(submit, /if\s*\([^)]*geofence[^)]*\)\s*\{?\s*return/, 'the geofence must not block');
  assert.doesNotMatch(submit, /if\s*\([^)]*enrollment[^)]*\)\s*\{?\s*return/, 'a missing reference pair must not block');
});

// ── Queue before network ──────────────────────────────────────────────────────

test('the punch is QUEUED before anything on the network is touched', () => {
  // The queue write is synchronous and local; the upload and the POST are not.
  // So the record exists before anything can fail, and captured_at is the moment
  // the button was pressed rather than the moment a network appeared.
  const enqueue = code.indexOf('enqueuePunch(');
  const upload = code.indexOf('uploadPhoto(');
  const flush = code.indexOf('flushPunches(');

  assert.ok(enqueue !== -1, 'enqueuePunch is not called');
  assert.ok(upload !== -1 && flush !== -1, 'the network calls were not found');
  assert.ok(enqueue < upload, 'the photo is uploaded before the punch is queued');
  assert.ok(enqueue < flush, 'the queue is flushed before the punch is in it');
});

test('captured_at is taken before the queue write, not inside the network branch', () => {
  const captured = code.indexOf('const capturedAt = new Date().toISOString()');
  const enqueue = code.indexOf('enqueuePunch(');
  const upload = code.indexOf('uploadPhoto(');
  assert.ok(captured !== -1, 'capturedAt is no longer stamped locally');
  assert.ok(captured < enqueue, 'capturedAt must be taken before the punch is queued');
  assert.ok(captured < upload, 'capturedAt must not be stamped after a network round trip');
  assert.match(code, /captured_at:\s*capturedAt/, 'the stamped time is not the one queued');
});

test('a failed upload is reported as saved-not-sent, never as a failure to clock in', () => {
  // "Couldn't clock in" would send someone hunting for signal over a punch that
  // is already safe on the device.
  assert.ok(/saved on this device/i.test(code), 'the saved-not-sent copy is gone');
  assert.ok(
    /will send (automatically )?when you have signal/i.test(code),
    'the copy no longer promises the punch will send itself',
  );
  // Against `code`, not the raw file: the source explains this decision in a
  // comment that quotes the very phrase being banned.
  assert.ok(
    !/couldn['’]t clock (in|out)/i.test(code),
    'the failure copy claims the punch was lost when it is queued and safe',
  );
});

// ── A queued punch must be visibly distinct from a sent one ───────────────────

test('a queued punch is signalled four separate ways', () => {
  const raw = readRaw(CLOCK);

  // 1 · Fill colour — amber for queued, green only for acknowledged.
  assert.match(code, /const QUEUED_AMBER\s*=\s*'#E8A33D'/, 'the queued fill colour is gone');
  assert.match(code, /const CONFIRM_GREEN\s*=\s*'#5BD98A'/, 'the confirmed fill colour is gone');
  assert.match(
    code, /outcome === 'queued'\s*\?\s*QUEUED_AMBER\s*:\s*CONFIRM_GREEN/,
    'the shutter fill no longer distinguishes a queued punch from a sent one',
  );

  // 2 · Glyph — a tick claims delivery, so a queued punch gets the upload cloud.
  assert.match(
    code, /outcome === 'queued'\s*\?\s*'cloud-upload'\s*:\s*'checkmark'/,
    'the shutter glyph no longer distinguishes the two outcomes',
  );

  // 3 · Words — the line a screen reader reads out.
  assert.match(raw, /Saved on this phone/, 'the queued hint text is gone');

  // 4 · Haptic — Warning for queued, Success for sent. The one channel that
  //     survives sunlight, walking, and reduced motion.
  assert.match(
    code, /outcome === 'queued'[\s\S]{0,120}NotificationFeedbackType\.Warning[\s\S]{0,120}NotificationFeedbackType\.Success/,
    'the two outcomes no longer have distinguishable haptics',
  );
});

test('outcome is set before the phase, so the confirmation cannot paint a stale colour', () => {
  // Setting phase first lets the effect that reads `outcome` fire against a
  // stale null and paint a green tick over a punch still on the phone.
  const sent = code.indexOf("setOutcome(result.sent > 0 ? 'sent' : 'queued')");
  const phase = code.indexOf("setPhase('done')", sent);
  assert.ok(sent !== -1, 'the outcome is no longer derived from the flush result');
  assert.ok(sent < phase, 'setPhase runs before setOutcome');
});

test('the pending pill and the queued ring use the same amber', () => {
  // Two indicators for one condition. Two that disagree on colour are two
  // conditions to whoever is reading them.
  const styles = code.slice(code.indexOf('const s = StyleSheet.create'));
  assert.match(styles, /pendingPill:[\s\S]*?borderColor:\s*QUEUED_AMBER/);
});

test('the 72-hour window is named in the UI while it is still open', () => {
  // It was enforced silently by pruneExpired and only ever surfaced as an Alert
  // AFTER a punch had aged out, when the only option left is a regularisation.
  assert.match(code, /punches\.hoursLeft/, 'the remaining window is not shown');
  assert.match(readRaw(CLOCK), /h left/, 'the hours-left copy is gone');
});

// ── Camera-only ───────────────────────────────────────────────────────────────

test('there is no gallery picker and no gallery permission on this screen', () => {
  // With login-only auth a gallery path means one saved selfie works forever and
  // every punch after the first is a file copy. A granted permission is an
  // attack surface whether or not the UI exposes it.
  assert.doesNotMatch(code, /expo-image-picker/, 'ClockScreen imports the gallery picker');
  assert.doesNotMatch(code, /launchImageLibraryAsync/, 'ClockScreen can open the gallery');
  assert.doesNotMatch(code, /requestMediaLibraryPermissions/, 'ClockScreen asks for gallery access');
  assert.match(code, /facing="front"/, 'the front lens is no longer pinned');
});

test('the full-resolution frame is deleted once it has been resized', () => {
  // It is a second copy of the same face and the larger one, and nothing reads
  // it after the resize returns.
  assert.match(
    code, /small\.uri !== shot\.uri[\s\S]{0,160}deleteAsync\(shot\.uri/,
    'the original capture is left on the device after the resize',
  );
});

// ── The punch must not wait on a satellite ───────────────────────────────────

/**
 * "attendance not wokring not clock in can take picture but syn to online for
 * clock in" — the owner, 2026-08-07.
 *
 * Reproduced on a device: the shutter fires, the photo is captured, and the
 * screen sits on "Hold still…" indefinitely. `getCurrentPositionAsync` has no
 * timeout of its own and does not reject when the device cannot see a
 * satellite, so the await never settled and the punch never went.
 *
 * `readFix` is documented "never blocks the punch". That was true of a denied
 * permission and true of a throw, and false of the only case that actually
 * happens indoors.
 */
test('the location read is raced against a timeout', () => {
  const code = readCode('screens/pahchan/ClockScreen.tsx');

  assert.match(code, /Promise\.race\(/,
    'getCurrentPositionAsync is awaited bare — indoors this never settles and the punch never sends');
  assert.match(code, /FIX_TIMEOUT_MS/,
    'the timeout is not a named constant');
});

test('losing the race flags the punch rather than failing it', () => {
  // A timeout is not an error. It is the same shape as the other two failures —
  // a Fix carrying `problem` — because the punch must go through either way.
  const code = readCode('screens/pahchan/ClockScreen.tsx');

  assert.match(code, /if\s*\(!pos\)\s*\{[\s\S]{0,200}?problem:/,
    'a timed-out fix must return a `problem`, not throw and not send silent nulls');
  assert.match(code, /problem: 'Location took too long/,
    'the employee is not told why the punch will be flagged');
});

test('location is requested BEFORE the shutter, not after it', () => {
  /*
   * On a first punch the employee used to watch "Hold still…" while Android put
   * TWO system dialogs in front of them — the foreground-location prompt and
   * Play Services' Location Accuracy sheet — with the photo already captured
   * and a punch mid-flight. Reproduced on a device 2026-08-07.
   *
   * The camera permission was always asked up front with a screen explaining
   * why. Location arrived mid-capture, and there is no reason for the two to
   * behave differently.
   */
  const code = readCode('screens/pahchan/ClockScreen.tsx');

  // An effect that warms the permission, gated on the camera being granted so
  // the two prompts stay in a sensible order rather than landing together.
  assert.match(
    code,
    /useEffect\(\(\)\s*=>\s*\{\s*if\s*\(!permission\?\.granted\)\s*return;[\s\S]{0,200}?Location\.requestForegroundPermissionsAsync/,
    'nothing asks for location before the shutter — the prompts land mid-capture',
  );

  // `readFix` must STILL ask. The effect is a warm-up, not a replacement: it can
  // be denied, dismissed, or never run, and the punch has to behave identically.
  const fix = code.slice(code.indexOf('async function readFix'));
  assert.match(fix.slice(0, 600), /Location\.requestForegroundPermissionsAsync/,
    'readFix stopped asking — it must remain correct on its own');
});
