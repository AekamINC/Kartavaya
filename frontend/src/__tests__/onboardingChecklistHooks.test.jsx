/**
 * Finishing onboarding must not crash the product.
 *
 * `OnboardingChecklist` had a React hooks-order violation, and the trigger was
 * the worst one available: `allDone` — the moment a firm completes all four
 * setup steps.
 *
 *   line  67   if (dismissed) return null;
 *   line 119   useEffect(() => { if (allDone && !closing) dismiss(); }, …)
 *
 * The effect set `dismissed`; the next render took the early return above it;
 * React saw a render with fewer hooks than the one before and threw "Rendered
 * fewer hooks than expected". That is a crash, not a warning.
 *
 * And it is mounted by `AppShell` at `:484` — OUTSIDE the page-scoped
 * ErrorBoundary that wraps `<Outlet>` — so it escaped to the root boundary and
 * replaced the whole product, sidebar and all, with a reload button. Every new
 * customer would have hit it days after signing up.
 *
 * ── Why these are source assertions rather than a render ──────────────────
 * The defect is structural: a hook below an early return. Reproducing it at
 * runtime needs the component driven through the exact state flip, behind a
 * 220ms timer, with `currentUser`, the router and three API reads all stubbed —
 * and a test that elaborate fails for reasons of its own long before it fails
 * for this one. I tried it; it timed out on harness plumbing, not on the bug.
 *
 * Reading the source proves the property directly and cannot flake. The trade
 * is stated rather than hidden: this catches the shape, not every possible
 * hooks violation, and it is deliberately blunt so that the next person adding
 * a hook to this file is stopped here rather than on a customer's screen.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const FILE = path.resolve(__dirname, '../components/OnboardingChecklist.jsx');
const text = fs.readFileSync(FILE, 'utf8');
const body = text.slice(text.indexOf('export default function OnboardingChecklist'));

const HOOK = /(useState|useEffect|useCallback|useMemo|useRef|useReducer|useContext|useNavigate|useOutletContext)\s*\(/;

describe('OnboardingChecklist · hooks order', () => {
  it('has an early return, so this guard is not vacuous', () => {
    expect(body.search(/^ {2}if \(.*\) return null;/m)).toBeGreaterThan(0);
  });

  it('declares every hook ABOVE the first early return', () => {
    const firstReturn = body.search(/^ {2}if \(.*\) return null;/m);
    const after = body.slice(firstReturn);

    const offenders = [];
    for (const line of after.split('\n')) {
      const stripped = line.replace(/\/\/.*$/, '');
      if (stripped.trimStart().startsWith('*')) continue;   // docblock prose
      const m = stripped.match(HOOK);
      if (m) offenders.push(`${m[1]} — ${line.trim().slice(0, 72)}`);
    }

    expect(
      offenders,
      'These hooks sit AFTER an early return. React counts hooks per render, so ' +
      'the render that takes the return declares fewer than the one before it ' +
      'and throws "Rendered fewer hooks than expected". This component is ' +
      'mounted outside the page ErrorBoundary, so that crash takes the whole ' +
      'app down:\n  ' + offenders.join('\n  '),
    ).toEqual([]);
  });

  it('computes allDone from steps, which is what the visible list is built from', () => {
    // The fix derives `allDone` from `steps` so its effect can live above the
    // early returns, while the rendered list is still built below. They are the
    // same predicate; this catches them drifting apart, which would let the
    // banner claim "done" while still showing an outstanding row, or dismiss
    // itself while a step is unfinished.
    expect(body).toMatch(/const allDone = loaded && Object\.values\(steps\)\.every\(Boolean\)/);

    const stepKeys = (body.match(/useState\(\{\s*project: false[^}]*\}/) || [''])[0];
    for (const k of ['project', 'invite', 'task', 'org']) {
      expect(stepKeys, `\`${k}\` left the steps object`).toContain(`${k}:`);
      expect(body, `the rendered list has no entry for \`${k}\``).toContain(`key: '${k}'`);
    }
  });

  it('still dismisses itself once every step is done', () => {
    // Guard against "fixing" the crash by deleting the behaviour: the banner
    // is supposed to disappear when setup is complete.
    expect(body).toMatch(/if \(allDone && !closing\) dismiss\(\);/);
    expect(body).toMatch(/if \(allDone\) return null;/);
  });
});
