/**
 * Who gets the client portal — and who must not.
 *
 * ── THE BUG THIS WAS WRITTEN FOR ────────────────────────────────────────────
 *
 * Owner, 2026-08-07, on a Samsung A36 with the first APK that actually ran:
 * "after login i can only see one screen nothing i can screen says your updates
 * that it".
 *
 * "Your Updates" is `ClientPortalScreen`. The founder of the company was being
 * routed to the external-client portal and could reach nothing else — no tasks,
 * no projects, no navigation, because that branch of `RootStack` renders ONE
 * screen and no tab bar at all.
 *
 * `RootStack` asked `user.role === 'client'`. The web asks two things:
 *
 *     const isClient = user?.role === 'client' && orgRoles.length === 0;
 *
 * and `Protected.jsx` says why, in a comment written before this ever happened:
 * "A client flag on somebody who also holds an org role is staff who happens to
 * be marked, and confining them to the portal would LOCK A COLLEAGUE OUT OF
 * THEIR OWN WORKSPACE."
 *
 * That is precisely what mobile did. The predicate was ported at half strength
 * and the half that was dropped is the half that protects staff.
 *
 * ── WHY A PURE MODULE ───────────────────────────────────────────────────────
 *
 * So it can be tested for real rather than read as text, and so there is ONE
 * definition rather than a copy in the navigator and another wherever this is
 * next needed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isPortalOnlyClient } from '../isClient.ts';

const staff = { role: 'member' as const };

// ── The regression ───────────────────────────────────────────────────────────

test('a client flag WITH an org role is staff, not a portal user', () => {
  // The exact shape the owner's account has: flagged `client` on the legacy user
  // row, and a member of an organisation.
  assert.equal(
    isPortalOnlyClient({ role: 'client', org_roles: [{ org_id: 'o1', role_code: 'org_owner' }] }),
    false,
    'the founder is being confined to the client portal',
  );
});

test('a client flag with NO org role is a portal user', () => {
  // The genuine external client — the case the portal exists for. Fixing the
  // regression must not open the whole app to them.
  assert.equal(isPortalOnlyClient({ role: 'client', org_roles: [] }), true);
  assert.equal(isPortalOnlyClient({ role: 'client' }), true,
    'an absent org_roles must read as "no org", matching the server');
});

// ── The server's contract ────────────────────────────────────────────────────

test('org_roles is only trusted when it is actually an array', () => {
  // `_safe_user` in auth_router.py attaches `org_roles` under `if org_roles:`,
  // so ABSENT and EMPTY both mean "no org membership". Anything else on that key
  // is a payload this client does not understand, and guessing is worse than
  // treating it as no membership — which is the SAFER direction here, because
  // it sends a real client to the portal rather than a staff member.
  assert.equal(isPortalOnlyClient({ role: 'client', org_roles: null as never }), true);
  assert.equal(isPortalOnlyClient({ role: 'client', org_roles: 'yes' as never }), true);
});

test('every non-client role reaches the app, org role or not', () => {
  for (const role of ['owner', 'admin', 'member'] as const) {
    assert.equal(isPortalOnlyClient({ role }), false, `${role} was sent to the portal`);
    assert.equal(isPortalOnlyClient({ role, org_roles: [] }), false,
      `${role} with no org was sent to the portal`);
  }
});

test('no user at all is not a client', () => {
  // `RootStack` checks `!user` first, so this is unreachable there — but the
  // predicate is exported and a caller that asks before login must not get
  // `true` and route somebody into a portal they have not authenticated for.
  assert.equal(isPortalOnlyClient(null), false);
  assert.equal(isPortalOnlyClient(undefined), false);
});

test('the role comparison is exact', () => {
  // Not a prefix, not case-insensitive. `client_admin` is not a client.
  assert.equal(isPortalOnlyClient({ role: 'client_admin' as never }), false);
  assert.equal(isPortalOnlyClient({ role: 'Client' as never }), false);
  assert.equal(isPortalOnlyClient({ ...staff }), false);
});

// ── It is reached ────────────────────────────────────────────────────────────

test('RootStack routes on the predicate, not on the raw role', () => {
  // The predicate being right changes nothing if the navigator still asks the
  // question itself. This is the assertion that would have caught the original
  // defect — `CardList` already taught this lesson once by being correct and
  // wired to nothing.
  const here = dirname(fileURLToPath(import.meta.url));
  const code = readFileSync(join(here, '..', '..', 'nav', 'RootStack.tsx'), 'utf8');

  assert.match(code, /isPortalOnlyClient\(user\)/,
    'RootStack is not using the shared predicate');
  assert.doesNotMatch(code, /user\.role === 'client'/,
    'RootStack still tests the raw role — a staff member flagged client is trapped in the portal');
});
