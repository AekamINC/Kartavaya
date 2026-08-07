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

// ── §3 · Tasks auto-opens, Messages does NOT ──────────────────────────────────

test('Tasks opens the first row; Messages opens nothing', () => {
  // THE ASYMMETRY IS THE POINT, and it is the thing most likely to be "tidied"
  // into consistency by someone making the two screens match.
  //
  // §3: "on Tasks it never appears, because the pane opens the first task ...
  // Selecting a task has no side effect, so there is no reason to make the user
  // do it. Messages does not auto-open, and the difference is the whole rule:
  // opening a conversation marks it read, and a side effect the user did not
  // ask for is worse than a placeholder."
  //
  // Making Messages auto-open would silently clear the unread count of whatever
  // channel happened to sort first, every time the screen mounted.
  const tasks = readCode('screens/TasksScreen.tsx');
  assert.match(
    tasks, /const openId = \(selected && tasks\.some/,
    'Tasks no longer derives an open row — its pane would arrive empty',
  );
  assert.match(tasks, /: tasks\[0\]\?\.task_id \?\? null/, 'Tasks does not fall back to the first row');

  const msgs = readCode('screens/MessagesScreen.tsx');
  assert.match(
    msgs, /useState<\{ id: string; name: string \} \| null>\(null\)/,
    'Messages does not start with NOTHING open',
  );
  assert.doesNotMatch(
    msgs, /channels\[0\]|\[0\]\?\.id/,
    'Messages auto-opens a channel — that marks it read without the user asking',
  );
});

test('the open row is derived, not stored, so a completed task cannot strand the pane', () => {
  // Swipe-to-complete removes the row from the filtered list immediately. A
  // STORED selection would leave the detail pane showing a task that is no
  // longer anywhere on the left, which reads as the list having lost it.
  const tasks = readCode('screens/TasksScreen.tsx');
  assert.match(tasks, /tasks\.some\(x => x\.task_id === selected\)/,
    'the open task is not re-validated against the current list');
});

test('a different channel REMOUNTS the chat pane', () => {
  // `RootStack` uses `getId` on the pushed Chat route for exactly this, and the
  // comment there says why: without it React Navigation keeps the mounted
  // instance and its draft, so a mention tap mid-sentence arrives with that text
  // still in the composer, one send from the wrong people. In a pane the
  // equivalent lever is `key`.
  assert.match(
    readCode('screens/MessagesScreen.tsx'), /key=\{openChat\.id\}/,
    'the chat pane is reused across channels — the draft would travel with it',
  );
});

test('both screens route their open through a handler that knows about split', () => {
  // Below the floor it must still be a navigation. A screen that always sets
  // state would make the phone stop opening tasks entirely.
  assert.match(readCode('screens/TasksScreen.tsx'),
    /if \(split\) setSelected\(taskId\);\s*else nav\.navigate\('TaskDetail'/);
  assert.match(readCode('screens/MessagesScreen.tsx'),
    /if \(split\) setOpenChat\(.*\);\s*else nav\.navigate\('Chat'/);
});

test('the selected row is marked in the list', () => {
  // A list beside a detail with no marked row leaves the user unable to tell
  // which of twenty cards produced the pane they are reading. §3's "you keep
  // your place in it" is only true if the place is visible.
  //
  // TaskCard is React.memo'd, so the comparator has to know about it or the
  // highlight never moves.
  const card = readCode('components/TaskCard.tsx');
  assert.match(card, /selected\?:\s*boolean/, 'TaskCard has no selected state');
  assert.match(card, /prev\.selected\s*===\s*next\.selected/,
    'the memo comparator ignores selection — the highlight would never move');
  assert.match(readCode('screens/TasksScreen.tsx'),
    /selected=\{split && item\.task_id === openId\}/,
    'the list does not mark the open row');
});

// ── §3 · Today is two columns, not a detail pane ──────────────────────────────

test('Today takes columns, never a PaneHost', () => {
  // "Today | two columns, no detail | A summary, not a list of things you open."
  // Giving it a detail pane would be treating a dashboard as a list.
  const code = readCode('screens/TodayScreen.tsx');
  assert.doesNotMatch(code, /PaneHost/, 'Today is using the list/detail host');
  assert.match(code, /const twoColumn = columns > 1/, 'Today does not derive its column count');
  assert.match(code, /if \(!twoColumn\) return work;/, 'Today always renders two columns');
});

test('the columns are 1.3 / 1, not an even split', () => {
  // `tablet.css` `.ttoday`: `minmax(0, 1.3fr) minmax(0, 1fr)`. An even split
  // gives the summary as much weight as the work, and this screen is called
  // Today because the tasks are the point.
  const code = readCode('screens/TodayScreen.tsx');
  assert.match(code, /flex: 1\.3/, 'the work column lost its weighting');
});

test('the aside adds no new poll and joins unread on the RAIL list', () => {
  // `LivePayload.channels` includes public channels the caller never joined and
  // archived ones — its own doc says "JOIN ON THE RAIL'S LIST; never iterate
  // these keys to build one." Iterating would present channels the user has
  // never opened as unread work waiting for them.
  const code = readCode('screens/today/TodayAside.tsx');
  assert.match(code, /useLive\(\)/, 'the aside does not read the existing live poll');
  assert.doesNotMatch(code, /Object\.keys\(live\.channels\)|Object\.entries\(live\.channels\)/,
    'the aside iterates the live payload instead of joining onto the channel list');
  assert.match(code, /rows\s*\n?\s*\.map\(ch => \(\{ ch, counts: live\.channels\[ch\.id\] \}\)\)/,
    'unread is not joined onto the rail list');
});

test('the aside reuses the approvals query key rather than adding a request', () => {
  // Same key as ApprovalsScreen, so react-query serves it from cache whenever
  // that screen has been open.
  assert.match(readCode('screens/today/TodayAside.tsx'),
    /queryKey: \['approvals', 'pending'\]/);
});

test('the channels query does not hand react-query context to `archived`', () => {
  // `messagesApi.channels(archived = false)`, and react-query calls a bare
  // queryFn with its own context object — which is truthy, so the request
  // silently returns the ARCHIVED set. MessagesScreen hit exactly this.
  const code = readCode('screens/today/TodayAside.tsx');
  assert.match(code, /queryFn: \(\) => messagesApi\.channels\(false\)/);
  assert.doesNotMatch(code, /queryFn: messagesApi\.channels\b/);
});

test('a failed activity load is not rendered as an empty feed', () => {
  // The web dashboard's own header records this defect: a swallowed error left
  // the list at [] and the page told the user nothing had happened.
  assert.match(readCode('screens/today/TodayAside.tsx'), /activity\.isError \?/,
    'the aside cannot tell a failed load from a quiet day');
});
