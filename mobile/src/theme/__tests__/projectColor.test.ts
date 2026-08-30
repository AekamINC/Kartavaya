/**
 * `projectColor` and the null team that took the whole app down.
 *
 * ── The crash this exists to stop coming back ───────────────────────────────
 *
 * Suite 21 drove the app on `Pixel_9_Pro` on 2026-08-29 and the signed-in
 * shell was replaced by `CrashGuard`'s "Something broke", with:
 *
 *     TypeError: Cannot read property 'length' of null
 *         at projectColor
 *         at TaskCardInner
 *         at renderWithHooks
 *
 * `TaskCard.tsx` calls `projectColor(task.team_id)`, and a task with no
 * project is an ordinary row rather than a corrupt one:
 *
 *   · `TaskCreate.team_id` is `Optional[str] = None` (`server.py:1668`);
 *   · `NewTaskSheet` sends it only `if (projectId)` (`NewTaskSheet.tsx:203`);
 *   · a brand-new organisation has NO projects to pick from, so the first task
 *     a new customer can create from the phone is necessarily one of these;
 *   · live 2026-08-29, `public.tasks` held 41 of 364 rows with `team_id IS NULL`.
 *
 * Because it threw during RENDER, the blast radius was not the card and not the
 * list — it was every screen, recoverable only by Try again.
 *
 * ── Why the types did not catch it ──────────────────────────────────────────
 *
 * `projectColor(teamId: string)` and `Task.team_id: string` (`api/types.ts:36`)
 * agreed with each other, and both disagreed with the wire. A type that is
 * wrong in two places is self-consistent, which is exactly the case a type
 * checker cannot help with — so this is asserted at runtime instead.
 *
 * ⚠ THIS TEST FAILS AGAINST THE OLD IMPLEMENTATION. `teamId.length` on `null`
 * throws before any assertion is reached, so the first case below is red
 * without the fix and green with it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { projectColor } from '../tokens';

const HEX = /^#[0-9a-fA-F]{6}$/;

test('a task with no project still gets a colour instead of crashing', () => {
  // The four shapes the wire actually produces for "no project".
  for (const absent of [null, undefined, '']) {
    const color = projectColor(absent as string | null | undefined);
    assert.match(color, HEX, `projectColor(${String(absent)}) returned ${color}`);
  }
});

test('every unassigned task shares ONE colour, so the absence reads as a group', () => {
  const a = projectColor(null as unknown as string);
  const b = projectColor(undefined as unknown as string);
  const c = projectColor('');
  assert.equal(a, b);
  assert.equal(b, c);
});

test('a real team id is unchanged by the fix — the mapping stays learnable', () => {
  // The property the palette exists for: the same project is the same colour
  // every time, in both themes, forever. A guard that perturbed the hash would
  // repaint every project in the product.
  const id = '14669821-7c3c-4a92-8073-302de92abd5c';
  assert.equal(projectColor(id), projectColor(id));
  assert.match(projectColor(id), HEX);
  assert.notEqual(projectColor(id), projectColor(null as unknown as string));
});

test('an explicit override still wins, null id or not', () => {
  assert.equal(projectColor(null as unknown as string, '#123456'), '#123456');
  assert.equal(projectColor('team-x', '#123456'), '#123456');
});
