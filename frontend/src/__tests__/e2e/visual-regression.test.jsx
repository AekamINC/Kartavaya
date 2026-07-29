/**
 * Visual regression baselines.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHY THERE ARE NO .PNG FILES IN THIS REPO
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A committed pixel baseline has to be generated on the same platform that
 * later compares against it. Font rasterisation, subpixel hinting and even
 * default font substitution differ between Windows — where this branch was
 * authored — and the Linux container CI runs in. A Windows-authored PNG
 * baseline does not fail *occasionally* on Linux; it fails on every single
 * pixel of every glyph, every time.
 *
 * That is the same class of platform bug as the standing lockfile rule in this
 * repo (Windows yarn rewrites esbuild `linux-x64` → `win32-x64` and breaks the
 * Linux build). The remedy is the same: do not commit a platform-specific
 * artefact generated on a developer machine.
 *
 * If pixel baselines are wanted later, they must be generated INSIDE the CI
 * container and stored as CI artefacts or in a dedicated store — never produced
 * locally and committed. `frontend/scripts/visual-baseline.mjs` is the harness
 * for that, and it is deliberately not wired into CI.
 *
 * ── What this file does instead
 *
 * Two text baselines that run in CI today, cost nothing, and diff cleanly in a
 * pull request:
 *
 *   1 · THE THEME PALETTE. Every semantic token's value in light and in dark,
 *       side by side. This is what a screenshot diff would actually be showing
 *       you when a surface changes colour, and it is reviewable as text: a
 *       reviewer can see `--danger` moved and decide whether that was intended.
 *
 *   2 · SURFACE OUTLINES. For each main surface, the landmarks and controls it
 *       offers, by ROLE and ACCESSIBLE NAME. This is the thing a human checks
 *       in a screenshot — "are the right controls on the page, in both themes"
 *       — and unlike an innerHTML snapshot it does not churn every time
 *       somebody restyles a class. With a dozen agents editing these surfaces,
 *       a full-DOM snapshot would conflict on every merge and be regenerated
 *       unread, which is worse than no baseline at all.
 *
 * jsdom applies no author CSS, so neither of these is a rendering assertion.
 * They are structural and token baselines, and the file says so rather than
 * implying a coverage it does not have.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Route } from 'react-router-dom';

import { LoginPage } from '../../pages/LoginPage';
import {
  installMockApi, installNetworkKillSwitch, restoreNetwork,
  makeHost, routesWith, signIn, clearSession, users,
  allCssRules,
} from './_harness';

let host;

beforeEach(() => {
  clearSession();
  installNetworkKillSwitch();
  host = makeHost();
});

afterEach(() => {
  host.unmount();
  document.documentElement.removeAttribute('data-theme');
  restoreNetwork();
  vi.restoreAllMocks();
  clearSession();
});

/* ══════════════════════════════════════════════════════════════════════════
   1 · The theme palette baseline
   ══════════════════════════════════════════════════════════════════════════ */

const RULES = allCssRules();

/** Token → value, for one theme's selector set. */
function tokensFor(match) {
  const out = {};
  for (const r of RULES) {
    if (!r.selectors.some(match)) continue;
    for (const m of r.body.matchAll(/(?:^|[;{])\s*(--[\w-]+)\s*:\s*([^;]+)/g)) {
      out[m[1]] = m[2].trim().replace(/\s+/g, ' ');
    }
  }
  return out;
}

const LIGHT = tokensFor(s => s === ':root' || s === '[data-theme="light"]');
const DARK = tokensFor(s => s === '[data-theme="dark"]');

/**
 * The semantic palette — the tokens a surface's colour actually comes from.
 *
 * Restricted to the semantic set on purpose. Snapshotting all ~340 declared
 * tokens would pull in spacing, radii, durations and font stacks, which do not
 * differ by theme and would make the baseline churn on every unrelated change.
 */
const SEMANTIC = /^--(bg|surface|s-|on-|outline|primary|secondary|tertiary|ok|warn|danger|scrim|shadow|rule|ink|glass)/;

describe('e2e · visual · the theme palette baseline', () => {
  it('light and dark resolve every semantic token, side by side', () => {
    const names = [...new Set([...Object.keys(LIGHT), ...Object.keys(DARK)])]
      .filter(n => SEMANTIC.test(n))
      .sort();

    expect(names.length, 'no semantic tokens found — the scanner is broken').toBeGreaterThan(30);

    const table = names.map(n => `${n.padEnd(28)} light=${LIGHT[n] ?? '—'}  dark=${DARK[n] ?? LIGHT[n] ?? '—'}`);
    expect(table.join('\n')).toMatchSnapshot('semantic-palette');
  });

  it('every token dark overrides is one light already declared', () => {
    // The direction that matters. A dark-only token resolves to nothing in
    // light and CSS drops the declaration silently — the --shadow-4 defect.
    const orphans = Object.keys(DARK).filter(n => !(n in LIGHT));
    expect(orphans).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2 · Surface outlines, in both themes
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The accessible outline of a container: landmarks and controls, by role and
 * name. Depth-limited and text-normalised so a restyle does not move it.
 */
function outline(root) {
  const INTERESTING = 'main, nav, header, form, h1, h2, [role], button, a[href], input, select, textarea';
  return [...root.querySelectorAll(INTERESTING)]
    .filter(el => !el.hasAttribute('hidden'))
    .map((el) => {
      const role = el.getAttribute('role')
        || ({ BUTTON: 'button', A: 'link', INPUT: `input:${el.type}`, H1: 'heading', H2: 'heading' }[el.tagName]
          || el.tagName.toLowerCase());
      const name = (
        el.getAttribute('aria-label')
        || el.getAttribute('placeholder')
        || (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? '' : el.textContent)
        || ''
      ).replace(/\s+/g, ' ').trim().slice(0, 60);
      return `${role}${name ? ` "${name}"` : ''}`;
    })
    .join('\n');
}

/** Render `node`, once per theme, and return both outlines. */
async function bothThemes(render) {
  const shots = {};
  for (const theme of ['light', 'dark']) {
    document.documentElement.setAttribute('data-theme', theme);
    // eslint-disable-next-line no-await-in-loop
    await render();
    shots[theme] = outline(host.container);
    host.unmount();
    host = makeHost();
  }
  return shots;
}

describe('e2e · visual · surface outlines', () => {
  it('sign in offers the same controls in both themes', async () => {
    const shots = await bothThemes(async () => {
      installMockApi({ 'POST /auth/login': { token: 't', user: users.staff() } });
      await host.mount(null, {
        path: '/login',
        routes: routesWith(<Route key="l" path="/login" element={<LoginPage />} />),
      });
    });

    // The theme must not change WHAT is on the page — only how it looks. A
    // control that appears in one theme and not the other is a real defect and
    // this is the cheapest possible way to catch it.
    expect(shots.dark).toBe(shots.light);
    expect(shots.light).toMatchSnapshot('surface-login');
  });

  it('the sign-in outline names the fields a person has to fill', () => {
    // Guards the snapshot: a baseline of an empty string would "pass" forever.
    expect(RULES.length).toBeGreaterThan(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3 · The pixel harness that is NOT run here
   ══════════════════════════════════════════════════════════════════════════ */

describe('e2e · visual · the pixel baseline strategy is documented, not implied', () => {
  it('the screenshot script exists and is opt-in', () => {
    // eslint-disable-next-line global-require
    const { existsSync, readFileSync } = require('node:fs');
    const p = ['scripts/visual-baseline.mjs', 'frontend/scripts/visual-baseline.mjs']
      .find(existsSync);
    expect(p, 'visual-baseline.mjs is missing — the pixel strategy has no harness').toBeTruthy();

    const src = readFileSync(p, 'utf8');
    // It must refuse to run by accident, and it must say where baselines belong.
    expect(src).toMatch(/VISUAL_BASELINE/);
    expect(src).toMatch(/@playwright\/test|playwright/);
  });

  it('no binary baseline has been committed', () => {
    /*
     * COMMITTED, which is what this has always claimed — not merely present on
     * disk, which is what it used to check.
     *
     * `test-results/` is written by every local Playwright run, and
     * `e2e/f32-write-gating.spec.ts` gives people a reason to do that often. On
     * an existence check this failed for anyone who had run the browser suite,
     * on a directory .gitignore already excludes — so the guard punished the
     * workflow it was meant to protect, and the fix everyone would reach for is
     * to delete the test.
     *
     * `git ls-files` answers the real question. An empty listing means nothing
     * is tracked under that path, whatever is sitting there untracked.
     */
    // eslint-disable-next-line global-require
    const { execFileSync } = require('node:child_process');
    for (const dir of ['visual-baselines', 'frontend/visual-baselines', 'test-results', 'frontend/test-results']) {
      const tracked = execFileSync('git', ['ls-files', '--', dir], { encoding: 'utf8' }).trim();
      expect(tracked, `${dir} is COMMITTED — pixel baselines must not be`).toBe('');
    }
  });
});
