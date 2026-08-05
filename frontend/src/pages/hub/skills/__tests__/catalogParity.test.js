/**
 * The two catalogs must quote one price.
 *
 * There are two screens onto the SAME endpoint (`/v1/hub/skills/templates`):
 * `pages/hub/skills/CatalogTab.jsx`, which Aekam operators use, and
 * `pages/srijan/SkillsTab.jsx`, which is the only one a paying customer ever
 * sees. The agency side was taught to derive the price from the steps; the
 * org side was left reading `t.estimated_credits ||`. Measured on the template
 * "Festival Calendar" — `estimated_credits = 99`, written before its steps
 * were edited, live step sum 5 — the operator read `5 credits per run` and the
 * customer read `~99 credits per run`, for the identical row.
 *
 * That is why `packPrice` and `blockersFor` live in `_shared` now. This file
 * exists to make the drift impossible to reintroduce quietly: it asserts the
 * RULE, not either screen's markup, so moving either card's JSX around cannot
 * make it pass while the prices disagree again.
 *
 * MUTATION-CHECKED. Each of these was confirmed to go red by breaking the
 * thing it covers:
 *   · `listed` preferred over `live`      → "the live step sum is the price"
 *   · `stored > 0` relaxed to `>= 0`      → "a stored 0 is not a price"
 *   · `blockersFor` returning [] for null → "an unloaded capability list"
 */
import { describe, it, expect } from 'vitest';
import { packPrice, blockersFor } from '../_shared';

// `costs` is keyed by AGENT TYPE — `costs[s.agent_type]` — not by any generic
// name. Writing this table the obvious-but-wrong way is what the first run of
// this file did, and every price assertion silently became `0 === 0`.
const COSTS = { social_media: 3, blog: 8 };

const aiStep = () => ({ agent_type: 'social_media' });          // no skill_function → 'ai'
const dataStep = fn => ({ skill_function: fn });                 // has one → 'data'

describe('packPrice — one rule, both catalogs', () => {
  it('takes the price from the steps as they stand, not the stored column', () => {
    // The real Festival Calendar shape: a stale 99 against a live sum.
    const t = { estimated_credits: 99 };
    const { live, listed, stale } = packPrice(t, [aiStep(), aiStep()], COSTS);

    expect(live).toBe(6);        // 2 × ai_generation — what the wallet is charged
    expect(listed).toBe(99);     // still surfaced, but only as a note
    expect(stale).toBe(true);    // and flagged as disagreeing
  });

  it('says nothing about a stored figure that agrees', () => {
    const { stale } = packPrice({ estimated_credits: 6 }, [aiStep(), aiStep()], COSTS);
    expect(stale).toBe(false);
  });

  it('treats a stored 0 as unset, not as free', () => {
    // `estimated_credits INTEGER NOT NULL DEFAULT 0`, and routers/hub.py:1164
    // reads falsy as "compute one" — so 0 means nobody ever set it. Reporting
    // it as a price of zero would advertise a paid pack as free.
    const { listed, stale } = packPrice({ estimated_credits: 0 }, [aiStep()], COSTS);
    expect(listed).toBeNull();
    expect(stale).toBe(false);
  });

  it('lets a genuinely free pack cost nothing without going through that path', () => {
    // All data steps. The live sum is 0 — a real price, arrived at honestly.
    const { live, listed } = packPrice({ estimated_credits: 0 }, [dataStep('a'), dataStep('b')], COSTS);
    expect(live).toBe(0);
    expect(listed).toBeNull();
  });

  it('does not call a stored figure stale while the price table is still loading', () => {
    // `estimateCredits` returns null without `costs`. An earlier draft of
    // packPrice compared 99 !== null and reported every pack as disagreeing —
    // a "listed at 99" note on every card for as long as the fetch was in
    // flight. Two numbers are needed to disagree.
    const { live, listed, stale } = packPrice({ estimated_credits: 99 }, [aiStep()], null);
    expect(live).toBeNull();
    expect(listed).toBe(99);
    expect(stale).toBe(false);
  });
});

describe('blockersFor — the same reason on both screens', () => {
  const caps = {
    skill_functions: [
      { name: 'invoice_ageing', available: true },
      { name: 'gst_summary', available: false, unavailable_reason: 'needs a GSTIN on the organisation' },
    ],
    unimplemented: ['payroll_variance'],
  };

  it('distinguishes "not loaded" from "no problems"', () => {
    // null is not []. A card that renders "ready" because the capability list
    // has not arrived yet is asserting something it does not know.
    expect(blockersFor([dataStep('invoice_ageing')], null)).toBeNull();
    expect(blockersFor([dataStep('invoice_ageing')], caps)).toEqual([]);
  });

  it('names an unimplemented function as unimplemented, not as unknown', () => {
    // Order matters: an unimplemented name is ALSO absent from skill_functions,
    // so checking "unknown" first would mislabel every one of them.
    const [msg] = blockersFor([dataStep('payroll_variance')], caps);
    expect(msg).toMatch(/no implementation behind it/);
  });

  it('passes the server\'s own reason through for an unavailable function', () => {
    const [msg] = blockersFor([dataStep('gst_summary')], caps);
    expect(msg).toMatch(/needs a GSTIN on the organisation/);
  });

  it('reports one sentence when two steps share a reason', () => {
    const out = blockersFor([dataStep('payroll_variance'), dataStep('payroll_variance')], caps);
    expect(out).toHaveLength(1);
  });

  it('ignores AI steps, which have no function to be missing', () => {
    expect(blockersFor([aiStep(), aiStep()], caps)).toEqual([]);
  });
});
