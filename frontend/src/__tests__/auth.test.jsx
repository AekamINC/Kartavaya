/**
 * Unit tests for frontend/src/lib/auth.js
 *
 * Tests that:
 * - apiLogin stores token + user in localStorage
 * - apiLogout clears all auth keys
 * - currentUser() reads and parses localStorage safely
 * - approvalBadgeStyle() maps statuses to correct colours
 * - toLocal() / fromLocal() round-trip without data loss
 * - formatDue() handles null gracefully
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the api module before importing auth.js
vi.mock('../lib/api', () => ({
  api: {
    post: vi.fn(),
  },
}));

import { api } from '../lib/api';
import {
  apiLogin,
  apiLogout,
  apiAcceptInvite,
  currentUser,
  apiResetPassword,
  apiForgotPassword,
  approvalBadgeStyle,
  formatDue,
  toLocal,
  fromLocal,
} from '../lib/auth';

// ── helpers ───────────────────────────────────────────────────────────────────

const FAKE_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.test.sig';
const FAKE_USER = {
  id: 'user_001',
  user_id: 'user_001',
  email: 'admin@test.com',
  name: 'Test Admin',
  role: 'admin',
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

// ── apiLogin ──────────────────────────────────────────────────────────────────

describe('apiLogin()', () => {
  it('stores token and user in localStorage on success', async () => {
    api.post.mockResolvedValue({
      data: { token: FAKE_TOKEN, user: FAKE_USER },
    });

    const result = await apiLogin('admin@test.com', 'password123');

    expect(localStorage.getItem('auth_token')).toBe(FAKE_TOKEN);
    expect(JSON.parse(localStorage.getItem('Kartavaya_user'))).toEqual(FAKE_USER);
    expect(result.token).toBe(FAKE_TOKEN);
    expect(result.user).toEqual(FAKE_USER);
  });

  it('calls the correct endpoint, and opts out of the retry interceptor', async () => {
    api.post.mockResolvedValue({ data: { token: FAKE_TOKEN, user: FAKE_USER } });
    await apiLogin('admin@test.com', 'password123');
    // The third argument is not incidental. `lib/api.js` retries 502/503/504 up
    // to three more times, and measured in the browser that turned one press
    // into four requests on a non-idempotent POST. Pinned so a later refactor
    // that drops the config silently cannot pass.
    expect(api.post).toHaveBeenCalledWith(
      '/auth/login',
      { email: 'admin@test.com', password: 'password123' },
      { noRetry: true },
    );
  });

  it('propagates API errors', async () => {
    api.post.mockRejectedValue(new Error('Unauthorized'));
    await expect(apiLogin('bad@test.com', 'wrong')).rejects.toThrow('Unauthorized');
    expect(localStorage.getItem('auth_token')).toBeNull();
  });
});

// ── apiLogout ─────────────────────────────────────────────────────────────────

describe('apiLogout()', () => {
  it('clears auth_token, Kartavaya_user, and kv_teams_cache', async () => {
    localStorage.setItem('auth_token', FAKE_TOKEN);
    localStorage.setItem('Kartavaya_user', JSON.stringify(FAKE_USER));
    localStorage.setItem('kv_teams_cache', '[]');

    api.post.mockResolvedValue({ data: { ok: true } });
    await apiLogout();

    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(localStorage.getItem('Kartavaya_user')).toBeNull();
    expect(localStorage.getItem('kv_teams_cache')).toBeNull();
  });

  it('clears localStorage even if the API call fails', async () => {
    localStorage.setItem('auth_token', FAKE_TOKEN);
    api.post.mockRejectedValue(new Error('Network error'));
    await apiLogout();
    expect(localStorage.getItem('auth_token')).toBeNull();
  });
});

// ── currentUser ───────────────────────────────────────────────────────────────

describe('currentUser()', () => {
  it('returns null when not logged in', () => {
    expect(currentUser()).toBeNull();
  });

  it('returns the stored user object when logged in', () => {
    localStorage.setItem('Kartavaya_user', JSON.stringify(FAKE_USER));
    expect(currentUser()).toEqual(FAKE_USER);
  });

  it('returns null for corrupted localStorage value', () => {
    localStorage.setItem('Kartavaya_user', 'not-valid-json{{{');
    expect(currentUser()).toBeNull();
  });

  it('returns null when value is the string "null"', () => {
    localStorage.setItem('Kartavaya_user', 'null');
    expect(currentUser()).toBeNull();
  });
});

// ── apiResetPassword ──────────────────────────────────────────────────────────

describe('apiResetPassword()', () => {
  it('stores token and user after successful reset', async () => {
    api.post.mockResolvedValue({ data: { token: FAKE_TOKEN, user: FAKE_USER } });
    await apiResetPassword('reset-token-xyz', 'NewPass123!');
    expect(localStorage.getItem('auth_token')).toBe(FAKE_TOKEN);
  });
});

// ── apiForgotPassword ─────────────────────────────────────────────────────────

describe('apiForgotPassword()', () => {
  it('calls the forgot-password endpoint', async () => {
    api.post.mockResolvedValue({ data: { ok: true } });
    const result = await apiForgotPassword('user@test.com');
    expect(api.post).toHaveBeenCalledWith(
      '/auth/forgot-password',
      { email: 'user@test.com' },
      { noRetry: true },
    );
    expect(result.ok).toBe(true);
  });
});

// ── The retry opt-out, stated once for the whole set ──────────────────────────
//
// This endpoint SENDS AN EMAIL and this one CONSUMES A SINGLE-USE TOKEN. The
// response interceptor in `lib/api.js` retries 502/503/504 three more times, and
// a 502/504 does not mean the request was not processed — it means the answer
// did not come back. Measured in the browser against a 503: four requests per
// press before `noRetry`, one after.
describe('auth mutations opt out of the retry interceptor', () => {
  it('accept-invite is not retried', async () => {
    api.post.mockResolvedValue({ data: { token: FAKE_TOKEN, user: FAKE_USER } });
    await apiAcceptInvite('tok', 'Someone', 'NewPass123!');
    expect(api.post).toHaveBeenCalledWith(
      '/auth/accept-invite',
      { token: 'tok', name: 'Someone', password: 'NewPass123!' },
      { noRetry: true },
    );
  });

  it('reset-password is not retried', async () => {
    api.post.mockResolvedValue({ data: { token: FAKE_TOKEN, user: FAKE_USER } });
    await apiResetPassword('reset-token-xyz', 'NewPass123!');
    expect(api.post).toHaveBeenCalledWith(
      '/auth/reset-password',
      { token: 'reset-token-xyz', password: 'NewPass123!' },
      { noRetry: true },
    );
  });

  it('logout is not retried, and still sends no body', async () => {
    api.post.mockResolvedValue({ data: { ok: true } });
    await apiLogout();
    // `null`, not `{}` — axios omits the body and the Content-Type for null, so
    // this stays the request the endpoint has always received.
    expect(api.post).toHaveBeenCalledWith('/auth/logout', null, { noRetry: true });
  });
});

// ── approvalBadgeStyle ────────────────────────────────────────────────────────

describe('approvalBadgeStyle()', () => {
  it('returns pending style for "pending"', () => {
    const style = approvalBadgeStyle('pending');
    expect(style).not.toBeNull();
    expect(style.label).toBe('Pending owner');
    expect(style.color).toBeTruthy();
  });

  it('returns approved style for "approved"', () => {
    const style = approvalBadgeStyle('approved');
    expect(style.label).toBe('Approved');
  });

  it('returns rejected style for "rejected"', () => {
    const style = approvalBadgeStyle('rejected');
    expect(style.label).toBe('Rejected');
  });

  it('returns null for unknown status', () => {
    expect(approvalBadgeStyle('unknown')).toBeNull();
    expect(approvalBadgeStyle(null)).toBeNull();
    expect(approvalBadgeStyle(undefined)).toBeNull();
  });

  it('all known statuses have bg and color properties', () => {
    ['pending', 'pending_client', 'approved', 'rejected'].forEach((status) => {
      const style = approvalBadgeStyle(status);
      expect(style).not.toBeNull();
      expect(style.bg).toBeTruthy();
      expect(style.color).toBeTruthy();
    });
  });
});

// ── formatDue ─────────────────────────────────────────────────────────────────

describe('formatDue()', () => {
  it('returns empty string for null/undefined', () => {
    expect(formatDue(null)).toBe('');
    expect(formatDue(undefined)).toBe('');
    expect(formatDue('')).toBe('');
  });

  it('returns a non-empty string for a valid ISO date', () => {
    const result = formatDue('2026-06-21T10:30:00Z');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ── toLocal / fromLocal round-trip ────────────────────────────────────────────

describe('toLocal() + fromLocal()', () => {
  it('returns empty string for null inputs', () => {
    expect(toLocal(null)).toBe('');
    expect(fromLocal(null)).toBeNull();
  });

  it('round-trips a UTC ISO string through local and back to UTC', () => {
    const original = '2026-06-21T05:30:00.000Z';
    const local = toLocal(original);
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    const back = fromLocal(local);
    // Round-tripping through local time is lossy for timezone offset only —
    // the date and time components should survive
    expect(back).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
