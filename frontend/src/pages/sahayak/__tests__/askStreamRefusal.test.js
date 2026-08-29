/**
 * What the assistant says when the answer is refused — and the bare status code
 * it used to say instead.
 *
 * ── WHAT WAS BROKEN, MEASURED ON THE DEPLOYED SERVICE ────────────────────────
 *
 * Proposal 93 Suite 14 asked Sahayak a question on an organisation whose wallet
 * held zero credits, 2026-08-29. `POST /v1/hub/chat/stream` answered 402 with
 * the sentence the credits service composes:
 *
 *   {"detail":{"error":"org_credits_exhausted","message":"This needs 2 credits.
 *    Your organisation has 0 (0 allowance + 0 purchased). Allowance resets on
 *    1 September 2026. Contact Aekam to top up.", "needed":2, …}}
 *
 * `detailOf` handled a STRING `detail` and an ARRAY `detail` and nothing else.
 * `services/credits.CreditError` writes a DICT — the third FastAPI shape, the
 * one `lib/apiError.js` exists for — so it returned `''`, `askStream` threw
 * `status 402`, and the thread read:
 *
 *   Not delivered — status 402
 *
 * A bare status is the one thing a reader can do nothing with, and an empty
 * wallet is the most common reason an answer never arrives.
 *
 * `askStream` is the export; `detailOf` is private and is exercised through it,
 * which is also the honest level — what matters is the sentence that reaches
 * `.sh__fail`, not the shape of an internal helper.
 *
 * `createRoot` is not needed here: this is the network half of the surface.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../lib/api', () => ({
  api: { defaults: { baseURL: 'https://example.invalid/api' } },
}));
vi.mock('../../../lib/auth', () => ({
  getActiveOrg: () => 'org-1',
  currentUser: () => ({ user_id: 'u1' }),
}));

const ORG_EXHAUSTED = {
  error: 'org_credits_exhausted',
  message:
    'This needs 2 credits. Your organisation has 0 (0 allowance + 0 purchased). '
    + 'Allowance resets on 1 September 2026. Contact Aekam to top up.',
  needed: 2,
  org_total: 0,
  next_period_start: '2026-09-01',
};

const CAP_EXCEEDED = {
  error: 'member_cap_exceeded',
  message:
    'This needs 2 credits. You have 0 of your 20 monthly credits left. Your '
    + 'organisation has 480 credits available (480 allowance + 0 purchased) — '
    + 'ask an org admin to raise your limit.',
  member_cap: 20,
};

/** A `fetch` that answers one refusal and nothing else. */
function refusing(status, detail) {
  return vi.fn(async () => ({
    ok: false,
    status,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify({ detail }),
  }));
}

let askStream;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  ({ askStream } = await import('../SahayakTab'));
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

async function ask() {
  try {
    await askStream({ url: 'https://example.invalid/api/v1/hub/chat/stream', body: { message: 'hi' } });
  } catch (err) {
    return err;
  }
  throw new Error('askStream resolved on a refusal');
}

describe('askStream — a refusal keeps the sentence the server composed', () => {
  it('names the shortfall and the remedy when the org wallet is empty', async () => {
    globalThis.fetch = refusing(402, ORG_EXHAUSTED);
    const err = await ask();
    expect(err.message).toContain('2 credits');
    expect(err.message).toContain('Contact Aekam to top up');
    expect(err.message).not.toMatch(/^status \d+$/);
    expect(err.response?.status).toBe(402);
  });

  it('sends a capped member to their own admin, not to Aekam', async () => {
    globalThis.fetch = refusing(402, CAP_EXCEEDED);
    const err = await ask();
    expect(err.message).toContain('ask an org admin to raise your limit');
  });

  it('tells the two refusals apart, which is the whole reason there are two', async () => {
    globalThis.fetch = refusing(402, ORG_EXHAUSTED);
    const a = (await ask()).message;
    globalThis.fetch = refusing(402, CAP_EXCEEDED);
    const b = (await ask()).message;
    expect(a).not.toBe(b);
  });

  it('a string detail still passes through untouched', async () => {
    globalThis.fetch = refusing(403, 'Sahayak is not enabled for this organisation');
    const err = await ask();
    expect(err.message).toBe('Sahayak is not enabled for this organisation');
  });

  it('a 422 length rejection still says it in the product’s own words', async () => {
    globalThis.fetch = refusing(422, [
      { loc: ['body', 'message'], msg: 'String should have at most 4000 characters',
        type: 'string_too_long' },
    ]);
    const err = await ask();
    expect(err.message).toMatch(/longer than Sahayak takes/);
  });

  it('a body with nothing usable in it still falls back to the status', async () => {
    globalThis.fetch = refusing(409, {});
    const err = await ask();
    expect(err.message).toBe('status 409');
  });
});
