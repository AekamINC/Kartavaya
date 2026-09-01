/**
 * Pahchan → My photos: an employee can enroll themselves, on the web.
 *
 * ── THE STATE THIS SCREEN ENDS ──────────────────────────────────────────────
 *
 * `POST /v1/pahchan/enrollment` has accepted `source='self_capture'` since it
 * shipped, and refuses anybody enrolling a face other than their own. That rule
 * was written for a screen that did not exist: `EnrollQueue.jsx` reviews
 * self-captures, and nothing in `frontend/src` could make one. The mobile screen
 * that can has no iOS build. Read from production:
 *
 *     0 enrollment photos product-wide, 14 of 14 punches flagged `noref`.
 *
 * So every punch this product has ever recorded is unverifiable — not because
 * the comparison is hard, but because there is nothing to compare against.
 *
 * ── WHAT THESE TESTS HOLD ───────────────────────────────────────────────────
 *
 * Three properties, and all three fail SILENTLY if broken:
 *
 *  1. The two calls happen in the right order with the returned KEY. A screen
 *     that uploaded bytes and never attached them would look identical to one
 *     that worked — the toast fires either way — and the slot would stay empty.
 *  2. `source` is `self_capture`. Sending `hr_upload` would mark the photo
 *     approved-on-arrival, which is the module's verification model inverted:
 *     the person being checked would be vouching for themselves.
 *  3. A failed attach is NOT reported as success. The bytes are in the bucket
 *     and the slot is still empty; saying "saved" there is how somebody comes to
 *     believe they are enrolled while every punch stays flagged.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import Enroll from '../Enroll';
import {
  installMockApi, installNetworkKillSwitch, restoreNetwork, makeHost, settle, httpError,
} from '../../../__tests__/e2e/_harness';

const ME = 'GET /v1/pahchan/me';
const ENROLLMENT = 'GET /v1/pahchan/enrollment/emp-1';
const PHOTO = 'POST /v1/pahchan/punch/photo';
const ENROLL = 'POST /v1/pahchan/enrollment';

const EMPLOYEE = { id: 'emp-1', name: 'Priya Deshmukh' };
const ME_BODY = { employee: EMPLOYEE, punches: [], notice: { acknowledged_at: '2026-08-06T00:00:00Z' } };

const EMPTY = { photos: [], complete: false, pending_approval: 0 };
const ONE_PENDING = {
  photos: [{ id: 'p1', slot: 1, source: 'self_capture', approved_at: null }],
  complete: false,
  pending_approval: 1,
};
const BOTH_APPROVED = {
  photos: [
    { id: 'p1', slot: 1, source: 'self_capture', approved_at: '2026-08-30T00:00:00Z' },
    { id: 'p2', slot: 2, source: 'self_capture', approved_at: '2026-08-30T00:00:00Z' },
  ],
  complete: true,
  pending_approval: 0,
};

let host;
let mock;

/**
 * A camera that yields one frame.
 *
 * ⚠ `compressCapture` is stubbed, not driven. jsdom has no `HTMLCanvasElement.toBlob`
 * and no video decoder, so a real capture cannot happen here — driving it would
 * assert that jsdom is jsdom. What these tests are about is what the screen does
 * WITH a frame once it has one, which is where all three defects live.
 */
function installCamera() {
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] };
  navigator.mediaDevices = { getUserMedia: vi.fn().mockResolvedValue(stream) };
  return { stop, stream };
}

vi.mock('../../../lib/pahchanClock', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, compressCapture: vi.fn(async () => new Blob(['x'], { type: 'image/jpeg' })) };
});

beforeEach(() => {
  installNetworkKillSwitch();
  host = makeHost();
  installCamera();
  global.URL.createObjectURL = vi.fn(() => 'blob:fake');
  global.URL.revokeObjectURL = vi.fn();
});

afterEach(async () => {
  await host.unmount();
  restoreNetwork();
  vi.restoreAllMocks();
});

const text = () => host.container.textContent;
const buttons = () => [...host.container.querySelectorAll('button')];
const byLabel = (label) =>
  buttons().find((b) => b.textContent.trim().toLowerCase().startsWith(label.toLowerCase()));

/** Open the camera and take the one frame the stub yields. */
async function captureAFrame() {
  await act(async () => { byLabel('Take photo 1 of 2').click(); });
  await settle();
  await act(async () => { byLabel('Take the photo').click(); });
  await settle();
}

describe('Pahchan — an employee enrolls their own reference photos', () => {
  it('asks for the first slot when nothing is enrolled', async () => {
    mock = installMockApi({ [ME]: ME_BODY, [ENROLLMENT]: EMPTY });
    await host.mount(<Enroll />);
    await settle();

    expect(text()).toContain('0 of 2 taken');
    expect(text()).toContain('Look straight at the camera');
    expect(byLabel('Take photo 1 of 2')).toBeTruthy();
  });

  it('moves to the second slot, with a different instruction', async () => {
    mock = installMockApi({ [ME]: ME_BODY, [ENROLLMENT]: ONE_PENDING });
    await host.mount(<Enroll />);
    await settle();

    // The second angle is the point of the pair — a screen that repeated the
    // frontal instruction would collect two photographs worth one.
    expect(text()).toContain('Now turn slightly to one side');
    expect(text()).not.toContain('Look straight at the camera');
    expect(byLabel('Take photo 2 of 2')).toBeTruthy();
  });

  it('uploads the frame, then attaches the RETURNED key to the slot', async () => {
    mock = installMockApi({
      [ME]: ME_BODY,
      [ENROLLMENT]: EMPTY,
      [PHOTO]: { photo_key: 'pahchan/org-1/enroll/abc.jpg' },
      [ENROLL]: { status: 'created' },
    });
    await host.mount(<Enroll />);
    await settle();
    await captureAFrame();

    await act(async () => { byLabel('Use this as photo 1').click(); });
    await settle();

    const attached = mock.calledWith('POST', '/pahchan/enrollment');
    expect(attached.length).toBe(1);
    // The key from the upload, not a path this screen invented.
    expect(attached[0].body.object_key).toBe('pahchan/org-1/enroll/abc.jpg');
    expect(attached[0].body.employee_id).toBe('emp-1');
    expect(attached[0].body.slot).toBe(1);
  });

  it('marks the capture as self_capture so it lands pending', async () => {
    mock = installMockApi({
      [ME]: ME_BODY,
      [ENROLLMENT]: EMPTY,
      [PHOTO]: { photo_key: 'k' },
      [ENROLL]: { status: 'created' },
    });
    await host.mount(<Enroll />);
    await settle();
    await captureAFrame();
    await act(async () => { byLabel('Use this as photo 1').click(); });
    await settle();

    // `hr_upload` is approved on arrival. Sending it from here would let the
    // person being verified vouch for themselves.
    expect(mock.calledWith('POST', '/pahchan/enrollment')[0].body.source).toBe('self_capture');
  });

  it('does not claim a slot was saved when the attach failed', async () => {
    mock = installMockApi({
      [ME]: ME_BODY,
      [ENROLLMENT]: EMPTY,
      [PHOTO]: { photo_key: 'k' },
      [ENROLL]: httpError(409, 'This employee has declined biometric attendance'),
    });
    await host.mount(<Enroll />);
    await settle();
    await captureAFrame();
    await act(async () => { byLabel('Use this as photo 1').click(); });
    await settle();

    // Still on the review step with the frame in hand, not returned to a
    // "0 of 2" screen that has quietly thrown the capture away.
    expect(byLabel('Use this as photo 1')).toBeTruthy();
    expect(byLabel('Retake')).toBeTruthy();
  });

  it('says a photo is not a reference until HR approves it', async () => {
    mock = installMockApi({ [ME]: ME_BODY, [ENROLLMENT]: ONE_PENDING });
    await host.mount(<Enroll />);
    await settle();

    // Without this sentence an employee who took two photographs and still saw
    // flagged punches would conclude the feature was broken.
    expect(text()).toContain('waiting for HR to approve');
    expect(text()).toContain('only once HR has approved it');
    expect(text()).toContain('your punches stay flagged');
  });

  it('stops asking once both slots are approved', async () => {
    mock = installMockApi({ [ME]: ME_BODY, [ENROLLMENT]: BOTH_APPROVED });
    await host.mount(<Enroll />);
    await settle();

    expect(text()).toContain('Both photographs are approved');
    expect(byLabel('Take photo')).toBeFalsy();
  });

  it('offers no file picker anywhere', async () => {
    mock = installMockApi({ [ME]: ME_BODY, [ENROLLMENT]: EMPTY });
    await host.mount(<Enroll />);
    await settle();
    await act(async () => { byLabel('Take photo 1 of 2').click(); });
    await settle();

    // The security property of the whole module: a reference photo chosen from
    // disk lets somebody enroll a face that is not theirs, and every later
    // comparison confirms the substitution rather than catching it.
    expect(host.container.querySelector('input[type="file"]')).toBeNull();
  });

  it('says so plainly when the account has no employee record', async () => {
    mock = installMockApi({ [ME]: { employee: null, punches: [] } });
    await host.mount(<Enroll />);
    await settle();

    expect(text()).toContain('not linked to an employee record');
    expect(byLabel('Take photo')).toBeFalsy();
    // And it must not have asked for an enrollment it has no id for.
    expect(mock.calledWith('GET', '/pahchan/enrollment/').length).toBe(0);
  });
});
