// @vitest-environment node
//
// NODE, not jsdom, and it is load-bearing rather than a preference: this file
// parses source with esbuild, and esbuild refuses to start under jsdom —
// jsdom's TextEncoder does not produce a real Uint8Array, which esbuild asserts
// on at import ("Invariant violation… your JavaScript environment is broken").
// There is no DOM in this file to want jsdom for.
/**
 * The org drawer shows a COUNT, never a roster.
 *
 * The owner's rule, stated directly:
 *
 *   "no one should be able to see any other org data even god mode users — such
 *    as org members list or what their cap is. God mode can only see the NUMBER
 *    OF USERS count under an org, can INVITE AN ORG ADMIN if needed, and can
 *    CHANGE THE ORG EMAIL ADDRESS."
 *
 * `GET /v1/admin/orgs/{id}` stopped returning the roster, the seat cap, the
 * plan, the credit allowance, the markup, the monthly price and the UPI payee —
 * `routers/admin_orgs.py:ORG_PUBLIC_FIELDS` is that rule and is pinned by
 * `backend/tests/test_cross_org_console_surface.py`. This file pins the other
 * half: that the SCREEN reads the count the server sends rather than deriving
 * one from an array, and that it has not kept a reader for any of the fields
 * that went away.
 *
 * ── Why the source is parsed rather than grepped ────────────────────────────
 *
 * Every identifier asserted on below — `members`, `member_count`, `upi_vpa` —
 * also appears in the prose explaining why it is or is not there, several times
 * over. A grep over the raw file is satisfied by its own commentary and stays
 * green when the code it guards is deleted; this repo has shipped four checks
 * with exactly that hole. `esbuild.transformSync` is a real parser and drops
 * comments, so what is searched here is only what runs.
 *
 * It is scoped to `OrgDetailPanel` because the page's LIST half legitimately
 * still reads `monthly_price` — `GET /v1/admin/orgs` returns it and the
 * headline tile adds it up. The drawer is the read that crosses into one
 * customer, and it is the one the rule is about.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { transformSync } from 'esbuild';
import { describe, it, expect } from 'vitest';

const SRC = fileURLToPath(new URL('../pages/AdminOrgsPage.jsx', import.meta.url));

/** The page with comments and JSX removed — only what executes. */
const CODE = transformSync(readFileSync(SRC, 'utf8'), { loader: 'jsx' }).code;

/**
 * Just the drawer.
 *
 * Sliced between two top-level declarations rather than by line number, so
 * moving the component up or down the file does not silently empty the haystack
 * — an empty string would pass every "must not contain" assertion below.
 */
function drawerSource() {
  const start = CODE.indexOf('function OrgDetailPanel');
  const end = CODE.indexOf('function AdminOrgsPage');
  expect(start, 'OrgDetailPanel is no longer a top-level function').toBeGreaterThan(-1);
  expect(end, 'AdminOrgsPage is no longer a top-level function').toBeGreaterThan(start);
  return CODE.slice(start, end);
}

describe('admin org drawer · what may cross an organisation boundary', () => {
  it('reads the count the server sent', () => {
    expect(drawerSource()).toContain('member_count');
  });

  it('never derives the count from an array of people', () => {
    const src = drawerSource();
    // The two shapes the old code used: destructuring `members` off the
    // response, and taking its length. A count computed from a list the
    // endpoint also returns is not a count — the list is the leak.
    expect(src).not.toMatch(/members\s*[:=]/);
    expect(src).not.toContain('members.length');
    expect(src).not.toContain('memberRows');
    expect(src).not.toContain('member_modules');
  });

  it.each([
    ['upi_vpa', 'the UPI payee'],
    ['upi_payee_name', 'the payee name'],
    ['max_users', 'the seat cap'],
    ['markup_pct', 'the margin'],
    ['monthly_credits', 'the credit allowance'],
    ['monthly_price', 'the monthly price'],
    ['plan_name', 'the plan'],
    ['owner_email', "the owner's address"],
    ['storage_used_bytes', 'how much data the customer holds'],
  ])('does not read %s — %s', field => {
    expect(drawerSource()).not.toContain(field);
  });

  it('offers the two writes the rule permits, and no third', () => {
    const src = drawerSource();
    // Invite an org admin, and change the point of contact.
    expect(src).toContain('contact-email');
    // Quote style is esbuild's, not the source's — match either.
    expect(src).toMatch(/["']org_admin["']/);
    // Removing somebody from another organisation is not on the owner's list,
    // and the drawer no longer has a user id to aim at anyway.
    expect(src).not.toMatch(/members\/\$\{/);
  });
});
