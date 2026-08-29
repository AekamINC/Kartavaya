/**
 * The sentence a customer reads when Sahayak refuses — and the one it used to
 * replace.
 *
 * ── WHAT WAS BROKEN, MEASURED ON THE DEPLOYED SERVICE ────────────────────────
 *
 * Proposal 93 Suite 14 drove Sahayak/Hub against staging on 2026-08-29 with an
 * organisation whose wallet held zero credits. Every AI path answered 402, and
 * on four separate screens — org content generation, a scraper run, a knowledge
 * document, a client chat message — the wire and the paint disagreed:
 *
 *   wire   {"detail":{"error":"org_credits_exhausted",
 *            "message":"This needs 1 credits. Your organisation has 0
 *             (0 allowance + 0 purchased). Allowance resets on 1 September 2026.
 *             Contact Aekam to top up.", "needed":1, …}}
 *   paint  "This action needs more credits than the wallet holds."
 *
 * `errText` kept `detail` only when `typeof detail === 'string'`.
 * `services/credits.CreditError` writes it as a DICT — the third shape FastAPI
 * sends, the one `lib/apiError.js` exists to unpack — so the figure, the reset
 * date and the remedy were dropped and a status-code sentence printed instead.
 *
 * It is not only vague. `services/credits.py` raises TWO exceptions on purpose,
 * and says why in its own docstring: `InsufficientOrgCredits` sends the reader
 * to Aekam, `MemberCapExceeded` sends them to their own org admin and quotes
 * the org balance "because a member who cannot see that the org has 4,000
 * credits sitting there will escalate to the wrong place". Both are 402. Both
 * rendered as the SAME line, so the distinction the service was built around
 * never reached a screen.
 *
 * These tests fail on the old version. They are written as the two refusals a
 * person actually meets, not as a shape test, because the thing that matters is
 * that the remedy survives.
 */
import { describe, it, expect } from 'vitest';
import { errText } from '../_shared';

/** An axios-shaped rejection carrying the body FastAPI actually sent. */
const err = (status, detail) => ({ response: { status, data: { detail } } });

const ORG_EXHAUSTED = {
  error: 'org_credits_exhausted',
  message:
    'This needs 2 credits. Your organisation has 0 (0 allowance + 0 purchased). '
    + 'Allowance resets on 1 September 2026. Contact Aekam to top up.',
  needed: 2,
  org_allowance: 0,
  org_purchased: 0,
  org_total: 0,
  next_period_start: '2026-09-01',
};

const CAP_EXCEEDED = {
  error: 'member_cap_exceeded',
  message:
    'This needs 2 credits. You have 0 of your 20 monthly credits left. Your '
    + 'organisation has 480 credits available (480 allowance + 0 purchased) — '
    + 'ask an org admin to raise your limit.',
  needed: 2,
  member_remaining: 0,
  member_cap: 20,
  org_total: 480,
};

describe('errText — a 402 keeps the sentence the server composed', () => {
  it('names the shortfall and the remedy when the org wallet is empty', () => {
    const said = errText(err(402, ORG_EXHAUSTED));
    expect(said).toContain('2 credits');
    expect(said).toContain('Contact Aekam to top up');
    expect(said).toMatch(/1 September 2026/);
    expect(said).not.toBe('This action needs more credits than the wallet holds.');
  });

  it('sends a capped member to their own admin, not to Aekam', () => {
    const said = errText(err(402, CAP_EXCEEDED));
    expect(said).toContain('ask an org admin to raise your limit');
    expect(said).toContain('20 monthly credits');
  });

  it('tells the two refusals apart, which is the whole reason there are two', () => {
    expect(errText(err(402, ORG_EXHAUSTED)))
      .not.toBe(errText(err(402, CAP_EXCEEDED)));
  });
});

describe('errText — the shapes it already handled still work', () => {
  it('passes a string detail through untouched', () => {
    expect(errText(err(403, 'Only org admins can see or set member credit limits')))
      .toBe('Only org admins can see or set member credit limits');
  });

  it('names the field on a 422 instead of rendering an array', () => {
    const said = errText(err(422, [
      { loc: ['body', 'amount'], msg: 'Input should be a valid integer', type: 'int_parsing' },
    ]));
    expect(typeof said).toBe('string');
    expect(said).toContain('Amount');
  });

  it('falls back to the status sentence when the body says nothing usable', () => {
    // `{}` is an object with no `message`, no `error` and no `blocking` — the
    // one case where there genuinely is nothing to quote.
    expect(errText(err(402, {})))
      .toBe('This action needs more credits than the wallet holds.');
    expect(errText(err(404, undefined))).toBe('That record no longer exists.');
    expect(errText(err(500, undefined)))
      .toBe('The server failed on this request. Nothing was changed.');
  });

  it('says the request never arrived when there is no response at all', () => {
    expect(errText(new Error('Network Error')))
      .toBe('No response from the server — check your connection.');
  });

  it('uses the caller fallback only when nothing else applies', () => {
    expect(errText({ response: { status: 418, data: {} } }, 'Could not add the document.'))
      .toBe('Could not add the document.');
  });
});
