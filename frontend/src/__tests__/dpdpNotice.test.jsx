import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { AttendanceNotice } from '../pages/pahchan/Notice';
import {
  PAHCHAN_NOTICE_VERSION, NOTICE_TITLE, NOTICE_LEDE, NOTICE_ACK, NOTICE_LEGAL,
  noticeLines, RETENTION_FALLBACK,
} from '../lib/pahchanNotice';

/**
 * The DPDP notice — transcription fidelity, and the two places it is allowed to
 * differ from the prototype.
 *
 * ── WHY THIS SUITE READS FILES OFF DISK ───────────────────────────────────────
 *
 * This is a legal notice. The thing that can go wrong with it is not a crash —
 * it is a word. Somebody "tightens" a sentence, or adds a reassuring clause, and
 * the product now makes a claim nobody checked. So the assertions are against
 * the SPECIFICATION ITSELF: `design-reference/Kartavaya Redesign/PahchanClock.jsx`,
 * the prototype's `PhNotice`, parsed as text. An edit to any of the six lines
 * turns this red, and the fix is either to revert it or to change the prototype
 * and have counsel confirm it (07 §8: "Not a legal opinion — have counsel
 * confirm before launch").
 *
 * The mirror is checked the same way: `mobile/src/screens/pahchan/noticeCopy.ts`
 * is read as text and compared line for line. The two copies exist because
 * `mobile/` has its own tsconfig and no path into `frontend/src`; this is what
 * stops them drifting. A FAILED READ FAILS THE TEST — it does not skip — because
 * "the file moved" and "the file agrees" must not look the same from here.
 */

const REPO = resolve(__dirname, '..', '..', '..');
const PROTOTYPE = resolve(REPO, 'design-reference', 'Kartavaya Redesign', 'PahchanClock.jsx');
const MOBILE_COPY = resolve(REPO, 'mobile', 'src', 'screens', 'pahchan', 'noticeCopy.ts');

/** Read, or fail loudly with the path. Never returns null. */
function readOrFail(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(
      `Could not read ${path}. This suite compares the shipped copy against it, so a `
      + `missing file is a failure and not a skip. Original error: ${err.message}`,
    );
  }
}

/**
 * The prototype's six `['key', 'text']` pairs.
 *
 * Every string in that array is single-quoted and contains no escaped quote, so
 * a non-greedy `[^']+` is exact rather than approximate. If that ever stops
 * being true the count assertion below fails rather than the parse silently
 * returning five.
 */
function prototypeLines() {
  const src = readOrFail(PROTOTYPE);
  const out = [];
  const re = /\[\s*'([^']+)',\s*'([^']+)'\s*\],/g;
  let m;
  while ((m = re.exec(src)) !== null) out.push({ key: m[1], text: m[2] });
  return out;
}

describe('the six lines are the prototype’s, verbatim', () => {
  const proto = prototypeLines();

  it('the prototype still contains exactly six disclosure lines', () => {
    expect(proto).toHaveLength(6);
  });

  it('the keys are the prototype’s keys, in the prototype’s order', () => {
    expect(noticeLines(null).map(l => l.key)).toEqual(proto.map(l => l.key));
  });

  it.each([0, 1, 2, 4, 5])('line %i is byte-for-byte the prototype’s', (i) => {
    // Every line except index 3, "How long", which is the one deliberate
    // deviation and is asserted separately below.
    expect(noticeLines(null)[i].text).toBe(proto[i].text);
  });

  it('"How long" differs from the prototype ONLY in the two retention numbers', () => {
    const ours = noticeLines(RETENTION_FALLBACK).find(l => l.key === 'How long').text;
    const theirs = proto.find(l => l.key === 'How long').text;
    // The fallback figures ARE the prototype's hardcoded 90 and 45, so rendered
    // against them the sentence must be identical. That is what proves the
    // deviation is a substitution and not a rewrite.
    expect(ours).toBe(theirs);
  });

  it('"How long" carries no number for the record itself', () => {
    // The prototype says "kept for as long as the law requires your employer to
    // keep it". `record_retention_years` is the org's CONFIGURED window, which is
    // not the same claim, and a notice must never state the stronger one.
    const line = noticeLines({ record_retention_years: 7 }).find(l => l.key === 'How long').text;
    expect(line).toContain('as long as the law requires your employer to keep it');
    expect(line).not.toContain('7');
  });

  it('the title, lede, button and legal footer are the prototype’s', () => {
    const src = readOrFail(PROTOTYPE);
    expect(src).toContain(NOTICE_TITLE.en);
    expect(src).toContain(NOTICE_TITLE.hi);
    expect(src).toContain(NOTICE_LEDE);
    expect(src).toContain(NOTICE_ACK);
    expect(src).toContain(NOTICE_LEGAL);
  });

  it('the notice classifies itself as a notice and not as consent', () => {
    // The sentence that decides what this surface legally is. If it goes, the
    // product is silently claiming a different legal basis.
    expect(NOTICE_LEGAL).toContain('not a consent form');
    expect(NOTICE_LEGAL).toContain('legitimate use for employment');
  });

  it('the line nobody had written anywhere before is present', () => {
    // "Data Protection Board" was absent from frontend/src, mobile/src and
    // backend/ entirely. It is the only route an employee has to complain, and
    // a notice without it is not a DPDP notice.
    const rights = noticeLines(null).find(l => l.key === 'Your rights').text;
    expect(rights).toContain('Data Protection Board of India');
  });
});

describe('the retention figures are the org’s, never a constant', () => {
  it('renders the numbers it is given', () => {
    const line = noticeLines({ punch_photo_days: 30, reference_photo_grace_days: 7 })
      .find(l => l.key === 'How long').text;
    expect(line).toContain('deleted after 30 days');
    expect(line).toContain('deleted 7 days after you leave');
    expect(line).not.toContain('90');
    expect(line).not.toContain('45');
  });

  it('falls back per key, not wholesale', () => {
    // A server that gains a figure and drops none must not blank a sentence.
    const line = noticeLines({ punch_photo_days: 30 }).find(l => l.key === 'How long').text;
    expect(line).toContain('30 days');
    expect(line).toContain('45 days after you leave');
  });
});

/**
 * THE JOIN. Both halves of this were tested and the join was not, and that is
 * precisely where it broke.
 *
 * The two tests above feed `noticeLines` a hand-written CLIENT-shaped dict. The
 * backend had its own tests. Nothing anywhere fed this function the dict the
 * endpoint actually sends — and until 6 August 2026 `GET /v1/pahchan/me`
 * answered in two shapes: the employee branch in the names below, and the
 * no-employee branch in the raw `pahchan_policy` row, whose column is
 * `punch_photo_retention_days`.
 *
 * That branch was the one EVERY caller took (0 of 81 employee rows carried a
 * `user_id`; live 2026-08-27 it is 14 of 109, so it is now the common branch
 * rather than the only one — which does not weaken this test, because the
 * ninety-five unlinked accounts still take it). The merge in `noticeLines` is
 * per key, so the unknown name was silently the fallback and every notice served
 * said 90 days regardless of what the org had configured. No error, no console
 * warning, no failing test.
 *
 * `RETENTION_FALLBACK` exists for the moment BEFORE the request lands. It must
 * never be what a settled screen is showing.
 */
describe('the keys this file reads are the keys the server sends', () => {
  const ROUTER = resolve(REPO, 'backend', 'routers', 'pahchan.py');

  /** The keys `_retention()` builds, read out of the router itself. */
  function serverKeys() {
    const src = readOrFail(ROUTER);
    const at = src.indexOf('def _retention(');
    expect(at, 'backend/routers/pahchan.py has no _retention() helper').toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf('async def _employee_for', at));
    const keys = [...body.matchAll(/"([a-z_]+)":\s*policy\[/g)].map(m => m[1]);
    expect(keys.length, `_retention() returned no parseable keys:\n${body}`).toBe(3);
    return keys;
  }

  it('every key the endpoint emits is one this module reads', () => {
    expect(new Set(serverKeys())).toEqual(new Set(Object.keys(RETENTION_FALLBACK)));
  });

  it('the sentence renders the org’s numbers from the real payload shape', () => {
    // Built from the server's OWN key names, not from ours. If the server
    // renames one, this dict carries the new name, the merge falls back, and
    // the 90 below is what fails.
    const payload = Object.fromEntries(
      serverKeys().map((k, i) => [k, [30, 7, 8][i]]),
    );
    const line = noticeLines(payload).find(l => l.key === 'How long').text;
    expect(line).toContain('deleted after 30 days');
    expect(line).toContain('deleted 7 days after you leave');
    expect(line).not.toContain('90');
    expect(line).not.toContain('45');
  });

  it('both branches of GET /me go through the one helper', () => {
    // The defect was two dict literals, one per branch. One call site per
    // branch plus the definition is three; anything fewer means a branch is
    // building the shape by hand again.
    const src = readOrFail(ROUTER);
    expect(src.match(/_retention\(/g).length).toBeGreaterThanOrEqual(3);
    // And the policy column name must not be what leaves the endpoint.
    expect(src).not.toMatch(/"retention":\s*await\s+_policy\(/);
  });
});

describe('the rendered card', () => {
  it('shows the title in both scripts and all six keys, closed', () => {
    render(<AttendanceNotice retention={null} />);
    expect(screen.getByText(NOTICE_TITLE.en)).toBeInTheDocument();
    expect(screen.getByText(NOTICE_TITLE.hi)).toBeInTheDocument();
    for (const l of noticeLines(null)) {
      expect(screen.getByText(l.key)).toBeInTheDocument();
    }
    // Closed means hidden, NOT absent. The paragraphs stay in the DOM so
    // find-in-page and aria-controls both reach them.
    const q = screen.getByRole('button', { name: /What is captured/ });
    expect(q).toHaveAttribute('aria-expanded', 'false');
  });

  it('the Devanagari sub-title is tagged lang="hi"', () => {
    // editorial.css keys BOTH Devanagari guards off the attribute — the
    // letter-spacing reset and the ×1.18 leading the शिरोरेखा needs. A run
    // without it is unprotected and mis-led.
    render(<AttendanceNotice retention={null} />);
    expect(screen.getByText(NOTICE_TITLE.hi)).toHaveAttribute('lang', 'hi');
  });

  it('opens one line at a time', () => {
    render(<AttendanceNotice retention={null} />);
    const first = screen.getByRole('button', { name: /What is captured/ });
    const second = screen.getByRole('button', { name: /^Why$/ });

    fireEvent.click(first);
    expect(first).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(second);
    expect(second).toHaveAttribute('aria-expanded', 'true');
    expect(first).toHaveAttribute('aria-expanded', 'false');
  });

  it('every question points at the paragraph it opens', () => {
    render(<AttendanceNotice retention={null} />);
    for (const l of noticeLines(null)) {
      const q = screen.getByRole('button', { name: new RegExp(l.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
      const id = q.getAttribute('aria-controls');
      expect(id).toBeTruthy();
      expect(document.getElementById(id)).toHaveTextContent(l.text);
    }
  });

  it('shows the acknowledge button when it has not been acknowledged', () => {
    render(<AttendanceNotice retention={null} acknowledgedAt={null} onAcknowledge={() => {}} />);
    expect(screen.getByRole('button', { name: NOTICE_ACK })).toBeInTheDocument();
  });

  it('replaces the button with the date once acknowledged, and keeps the words', () => {
    // 07 §9 — it stays readable. Not hidden, and not a live button that would
    // re-post against a row that is ON CONFLICT DO NOTHING anyway.
    render(
      <AttendanceNotice
        retention={null}
        acknowledgedAt="2026-08-06T09:41:00Z"
        onAcknowledge={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: NOTICE_ACK })).toBeNull();
    expect(screen.getByText(/You read this on/)).toBeInTheDocument();
    expect(screen.getByText(NOTICE_TITLE.en)).toBeInTheDocument();
    expect(screen.getByText('Your rights')).toBeInTheDocument();
  });

  it('offers no button at all when there is nobody to acknowledge for', () => {
    // Somebody with no employee record can read every word and has no row to
    // write. The notice renders; the control does not.
    render(<AttendanceNotice retention={null} acknowledgedAt={null} />);
    expect(screen.queryByRole('button', { name: NOTICE_ACK })).toBeNull();
    expect(screen.getByText(NOTICE_LEGAL)).toBeInTheDocument();
  });

  it('always states what it legally is', () => {
    render(<AttendanceNotice retention={null} />);
    expect(screen.getByText(NOTICE_LEGAL)).toBeInTheDocument();
  });
});

describe('the mobile mirror does not drift', () => {
  const mobile = readOrFail(MOBILE_COPY);

  it('declares the same version string', () => {
    const m = /PAHCHAN_NOTICE_VERSION\s*=\s*'([^']+)'/.exec(mobile);
    expect(m, 'no PAHCHAN_NOTICE_VERSION found in the mobile copy module').toBeTruthy();
    expect(m[1]).toBe(PAHCHAN_NOTICE_VERSION);
  });

  it('carries the same title, lede, button and legal footer', () => {
    expect(mobile).toContain(NOTICE_TITLE.en);
    expect(mobile).toContain(NOTICE_TITLE.hi);
    expect(mobile).toContain(NOTICE_LEDE);
    expect(mobile).toContain(NOTICE_ACK);
    expect(mobile).toContain(NOTICE_LEGAL);
  });

  it.each(noticeLines(null).filter(l => l.key !== 'How long'))(
    'carries "$key" verbatim',
    ({ key, text }) => {
      expect(mobile).toContain(key);
      expect(mobile).toContain(text);
    },
  );

  it('interpolates the same two retention figures into "How long"', () => {
    // The one line that is a template on both sides, so it is compared by its
    // fixed fragments rather than by the whole string.
    expect(mobile).toContain('Punch photos are deleted after ${r.punch_photo_days} days.');
    expect(mobile).toContain('reference photos are deleted ${r.reference_photo_grace_days} days after you leave.');
    expect(mobile).toContain('as long as the law requires your employer to keep it.');
  });

  it('has no Gujarati arm — the bilingual shape here is {en, hi}', () => {
    expect(mobile).not.toMatch(/\bgu\s*:/);
  });
});

describe('the module page reaches it', () => {
  const page = readOrFail(resolve(__dirname, '..', 'pages', 'PahchanPage.jsx'));

  it('has a notice tab', () => {
    expect(page).toMatch(/id:\s*'notice'/);
    expect(page).toContain('What we record');
    expect(page).toMatch(/tab === 'notice'/);
  });

  it('puts it next to the other employee-facing tab, ahead of setup', () => {
    // history → notice → enrollment. The two tabs that need no reviewer role
    // belong together and ahead of the setup pair.
    const order = [...page.matchAll(/id:\s*'(\w+)'/g)].map(m => m[1]);
    expect(order.indexOf('notice')).toBe(order.indexOf('history') + 1);
    expect(order.indexOf('notice')).toBeLessThan(order.indexOf('enrollment'));
  });
});

describe('the retention facts are stated once', () => {
  const history = readOrFail(resolve(__dirname, '..', 'pages', 'pahchan', 'History.jsx'));

  it('History defers to the notice instead of restating it', () => {
    // Two independently-worded paragraphs about how long a photograph of
    // somebody's face is kept is the product saying two things the first time
    // one of them is edited.
    expect(history).toContain('noticeLines(');
    expect(history).not.toMatch(/Your clock-in photographs are deleted after/);
  });
});
