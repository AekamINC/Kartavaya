/**
 * The pane host, and the route/prop contract that lets a detail screen live in
 * one.
 *
 * The arithmetic PaneHost reads — `split`, `listWidth`, `stacked` — is unit
 * tested against the real device table in `lib/__tests__/windowClass.test.ts`.
 * What is left here is the set of §3 rules that live in a component body, and
 * every one of them fails silently:
 *
 *   · a detail screen that still reads `route.params` directly throws only when
 *     it is actually placed in a pane, which is only on a tablet
 *   · a host that reads the width CLASS instead of content width stacks an iPad
 *     Pro held upright, which looks deliberate
 *   · selection held inside the pane survives every test and dies on the one
 *     transition §6 exists for
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { readCode, readRaw } from '../../test/source.ts';

const host = () => readCode('components/PaneHost.tsx');

// ── §3 · The split rule ───────────────────────────────────────────────────────

test('the host splits on CONTENT WIDTH, never on the width class', () => {
  // `TabletScreens.jsx:132` records that tying these together WAS the bug. An
  // iPad Pro held upright is `expanded`, not `large`, and has 960dp of content —
  // more than most laptops give a mail client. Keying off `cls` would stack it.
  const code = host();
  assert.match(code, /const \{ split, listWidth, stacked \} = useWindowClass/,
    'PaneHost does not read the derived geometry');
  assert.doesNotMatch(code, /cls === '(medium|expanded|large)'/,
    'PaneHost is branching on the width class instead of the content width');
});

test('below the floor it renders ONLY the list', () => {
  // The screen keeps doing what it does on a phone — push the detail as a route.
  // Rendering a squeezed second pane instead is the "looks like a tablet layout
  // and reads like a mistake" failure §1 names.
  assert.match(host(), /if \(!split && !stack\) return <View style=\{s\.solo\}>\{list\}<\/View>;/);
});

test('stacking is opt-in and asks about HEIGHT, not width', () => {
  // "Stacking is for a SUPPORTING pane only — content that is not the detail of
  // the row above it — and Approvals is the one screen that has one."
  //
  // §9's file table implies stacking is general. `TabletScreens.jsx:274` gates it
  // on `screen === 'approvals'`, so the gate belongs at the call site.
  const code = host();
  assert.match(code, /supporting = false/, 'stacking is not opt-in');
  assert.match(code, /const stack = supporting && stacked/,
    'stacking is not the conjunction of the caller opting in AND a tall window');
});

// ── §6 · Selection lives above the layout ─────────────────────────────────────

test('the host holds no selection and does not navigate', () => {
  // "Selection lives above the layout, never inside a pane." Drag an iPad app
  // into Slide Over and the detail becomes the full window ON THE SAME RECORD;
  // drag it back and the panes return with that record still selected.
  // Selection kept in here would be unmounted by the transition it must survive.
  const code = host();
  assert.doesNotMatch(code, /useState/, 'PaneHost holds state — selection must live above it');
  assert.doesNotMatch(code, /useNavigation|navigationRef/, 'PaneHost navigates');
});

// ── The route/prop contract ───────────────────────────────────────────────────

const DETAILS = [
  ['screens/TaskDetailScreen.tsx', 'taskId'],
  ['screens/ChatScreen.tsx', 'channelId'],
] as const;

test('a detail screen takes its identity from a prop OR the route', () => {
  // In a pane the screen is NOT the focused route — the list is — so
  // `useRoute()` returns the list's route and the old
  // `const { taskId } = route.params` threw on undefined. The prop wins; the
  // route is the fallback.
  for (const [file, key] of DETAILS) {
    const code = readCode(file);
    assert.match(
      code, new RegExp(`${key}Prop`),
      `${file} has no prop for ${key} — it cannot be rendered into a pane`,
    );
    assert.match(
      code, new RegExp(`${key}\\s*=\\s*${key}Prop \\?\\? route\\.params\\?\\.${key}`),
      `${file} does not fall back from the prop to the route`,
    );
  }
});

test('NO detail screen reads route.params without optional chaining', () => {
  // THE CRASH. In a pane the params object belongs to the list, so reading a
  // missing key off it has to be `undefined` rather than a throw. This is the
  // one that only fails on a tablet, which is the one nobody tests on.
  for (const [file] of DETAILS) {
    const raw = readCode(file);
    const bare = [...raw.matchAll(/route\.params(?!\?)[.[]/g)].map(m => m[0]);
    assert.deepEqual(
      bare, [],
      `${file} reads route.params without \`?.\` — throws when rendered in a pane`,
    );
    assert.doesNotMatch(
      raw, /const \{[^}]*\} = route\.params;/,
      `${file} still destructures route.params directly`,
    );
  }
});

test('back is resolved once, and a pane can override it', () => {
  // Pushed, back pops the navigator. In a pane there is nothing to pop — the
  // list is still on screen — so the owner clears its selection instead.
  // Resolved once so the affordances cannot drift: TaskDetailScreen has THREE.
  const task = readCode('screens/TaskDetailScreen.tsx');
  assert.match(task, /const close\s*=\s*onClose \?\? \(\(\) => nav\.goBack\(\)\)/);
  assert.equal(
    [...task.matchAll(/onBack=\{close\}/g)].length, 3,
    'not every back affordance goes through the resolved handler',
  );
  assert.doesNotMatch(task, /onBack=\{\(\) => nav\.goBack\(\)\}/,
    'a back affordance still pops the navigator directly');

  assert.match(readCode('screens/ChatScreen.tsx'), /onClose \?\? \(\(\) => nav\.goBack\(\)\)/);
});

// ── §3 · The empty pane is designed ───────────────────────────────────────────

test('the empty pane says what the pane is FOR, not that nothing is selected', () => {
  // "A grey *no item selected* wastes the larger half of the screen." It carries
  // the screen's own icon and a sentence. The jaali ground is deliberately
  // absent — it is a CSS background-image on the web and RN has no equivalent
  // without shipping an asset; the low surface stands in for it.
  const code = host();
  assert.match(code, /export function EmptyPane/);
  assert.match(code, /icon: keyof typeof Ionicons\.glyphMap/, 'the empty pane takes no icon');
  assert.match(code, /body: string/, 'the empty pane has no explanatory line');
  assert.doesNotMatch(readRaw('components/PaneHost.tsx'), /No item selected|Nothing selected/i);
});
