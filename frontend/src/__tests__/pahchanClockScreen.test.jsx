import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

/**
 * The Clock tab — what it refuses to do, and what it refuses to refuse.
 *
 * The whole point of this screen is a rule with two halves that pull against
 * each other, so both halves are asserted here:
 *
 *   · The selfie is MANDATORY — there is no control that submits a punch
 *     without one while the camera is working.
 *   · §2 still holds — after repeated camera failures the screen offers to
 *     record the punch flagged rather than take the shift away.
 *
 * A change that satisfies one of those and quietly drops the other is the
 * failure this file exists to catch.
 */

const mockGet = vi.fn();
const mockPost = vi.fn();
const pushToast = vi.fn();

vi.mock('../lib/api', () => ({
  api: { get: (...a) => mockGet(...a), post: (...a) => mockPost(...a) },
  body: (r) => r?.data ?? {},
  rows: (r) => r?.data?.data ?? [],
}));

vi.mock('../components/ui/toast', () => ({
  useToast: () => ({ pushToast }),
}));

const IMPORT_CLOCK = () => import('../pages/pahchan/Clock');

/** `/me` for somebody who has read the notice and is linked to a personnel row. */
function meBody(overrides = {}) {
  return {
    data: {
      employee: { id: 'emp-1' },
      punches: [],
      retention: null,
      rules: null,
      notice: { version: 'v', acknowledged_at: '2026-08-01T00:00:00Z' },
      ...overrides,
    },
  };
}

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  pushToast.mockReset();
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('Clock tab', () => {
  it('shows the notice before the camera when it has not been read', async () => {
    mockGet.mockResolvedValue(meBody({ notice: { version: 'v', acknowledged_at: null } }));
    const { default: Clock } = await IMPORT_CLOCK();
    render(<Clock />);
    // 07 §9: what is held and for how long, BEFORE the first capture.
    await waitFor(() => expect(screen.getByText(/Before your first clock-in/i)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /^Clock in$/i })).toBeNull();
  });

  it('says so plainly when the account has no employee record', async () => {
    // `create_punch` answers 409 for these accounts, and today that is most of
    // them. A button that always fails is worse than a sentence.
    mockGet.mockResolvedValue(meBody({ employee: null }));
    const { default: Clock } = await IMPORT_CLOCK();
    render(<Clock />);
    await waitFor(() =>
      expect(screen.getByText(/not linked to an employee record/i)).toBeTruthy());
  });

  it('offers no way to punch without a photo before the camera has failed', async () => {
    mockGet.mockResolvedValue(meBody());
    const { default: Clock } = await IMPORT_CLOCK();
    render(<Clock />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Clock in/i })).toBeTruthy());
    // THE MANDATE. No skip, no "without a photo", nothing that submits early.
    expect(screen.queryByRole('button', { name: /without a photo/i })).toBeNull();
  });

  it('offers "Clock out" when an "in" was already recorded today', async () => {
    mockGet.mockResolvedValue(meBody({
      punches: [{ direction: 'in', captured_at: new Date().toISOString() }],
    }));
    const { default: Clock } = await IMPORT_CLOCK();
    render(<Clock />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Clock out/i })).toBeTruthy());
  });

  it('surfaces a load failure with a retry rather than an empty panel', async () => {
    mockGet.mockRejectedValue(Object.assign(new Error('nope'), { response: { status: 500 } }));
    const { default: Clock } = await IMPORT_CLOCK();
    render(<Clock />);
    await waitFor(() =>
      expect(screen.getByText(/Could not load your attendance/i)).toBeTruthy());
  });

  it('offers a punch without a photo once the camera has failed three times', async () => {
    // The other half of the mandate, and the one a well-meaning change is most
    // likely to remove: ClockScreen.tsx hid the shutter after three failures and
    // "three camera errors in a dark doorway locked someone out of clocking in
    // entirely". Mandatory must not become a lockout.
    mockGet.mockResolvedValue(meBody());
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: () => Promise.reject(new Error('denied')) },
    });
    const { default: Clock } = await IMPORT_CLOCK();
    render(<Clock />);

    const punch = await screen.findByRole('button', { name: /Clock in/i });
    for (let i = 0; i < 3; i += 1) {
      fireEvent.click(punch);
      // Each rejection lands in its own microtask; the counter has to settle
      // before the next click or all three read as one failure.
      await waitFor(() => expect(screen.getByText(/camera could not be opened/i)).toBeTruthy());
    }

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /without a photo/i })).toBeTruthy());
  });

  it('never sends a punch merely by rendering', async () => {
    mockGet.mockResolvedValue(meBody());
    const { default: Clock } = await IMPORT_CLOCK();
    render(<Clock />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Clock in/i })).toBeTruthy());
    expect(mockPost).not.toHaveBeenCalled();
  });
});
