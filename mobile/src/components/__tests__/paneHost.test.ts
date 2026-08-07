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

// ── §3.2 · The board ──────────────────────────────────────────────────────────

const board = () => readCode('screens/BoardScreen.tsx');

test('the board changes shape from 600dp up, not at the split floor', () => {
  // §3.2: "From 600dp up — every tablet, not only the ones that split into two
  // panes." The board is ONE pane at every size (§3); what changes is the
  // arrangement inside it, so this keys on leaving `compact` rather than on the
  // 660dp content floor that decides whether a SECOND pane exists.
  const code = board();
  assert.match(code, /const boardIsTablet = cls !== 'compact'/,
    'the board is keyed on the wrong threshold');
  assert.doesNotMatch(code, /boardIsTablet = split/,
    'the board is using the two-pane floor to decide its arrangement');
});

test('portrait stacks collapsible groups; landscape keeps full-height lanes', () => {
  // "In portrait each status becomes a full-width collapsible group ...
  // Landscape keeps the columns and makes them full-height lanes — all five
  // visible, each scrolling independently."
  const code = board();
  assert.match(code, /const boardPortrait = winH > winW/, 'the board does not read orientation');
  assert.match(code, /if \(boardPortrait\) \{/, 'portrait does not take a different arrangement');
  assert.match(code, /const \[shutCols, setShutCols\]/, 'the groups do not collapse');
  assert.match(code, /s\.tbdLanes/, 'there are no landscape lanes');
});

test('the phone column tabs are DROPPED on a tablet', () => {
  // "The phone's column tabs and snap paging are dropped at both orientations;
  // they exist because 393px holds one column." On a tablet every column is on
  // screen, so a tab strip is navigation to somewhere you are already looking.
  assert.match(
    board(), /view === 'Board' && !boardIsTablet && columns\.length > 0/,
    'the column tabs still render on a tablet',
  );
});

test('the phone board path is untouched', () => {
  // The conversion must not change what a phone does. The original renderer is
  // kept whole and merely renamed; the tablet arrangement is a sibling.
  const code = board();
  assert.match(code, /const renderBoardPhone = useCallback/, 'the phone renderer is gone');
  assert.match(code, /const renderBoard = boardIsTablet \? renderBoardTablet : renderBoardPhone/,
    'the two arrangements are not selected by the class');
  assert.match(code, /activeColId/, 'the phone board lost its active-column state');
});

test('cards flow rather than stacking one per row in a portrait group', () => {
  // `repeat(auto-fill, minmax(206px, 1fr))` from tablet.css, done arithmetically
  // because React Native has no grid. A single column of cards across a 700dp
  // group is the "phone layout that happens to be wide" failure §3 names.
  const code = board();
  assert.match(code, /Math\.floor\(\(winW - pad\) \/ 206\)/, 'the card flow is gone');
  assert.match(code, /width: `\$\{100 \/ perRow\}%`/, 'cards do not share a row');
});

// ── §4 · A sheet becomes a form sheet above compact ───────────────────────────

test('the sheet is centred and capped above compact', () => {
  // "A bottom sheet is a phone pattern: it is near the thumb because on a phone
  // the thumb is at the bottom. Pinned to the bottom edge of a 1376pt screen it
  // is a long reach from wherever you were reading. On tablets the new-task
  // sheet is centred, ~520pt wide, with the same field set."
  //
  // SAME FIELD SET is the operative half — a presentation change and nothing
  // else, which is why the switch is here and no caller knows about it.
  const code = readCode('components/Sheet.tsx');
  assert.match(code, /const formSheet = cls !== 'compact'/, 'the sheet never becomes a form sheet');
  assert.match(code, /formSheet \? s\.centre : s\.root/, 'the frame is not re-anchored');
  assert.match(code, /maxWidth: 520/, 'the form sheet is not capped');
});

test('the form sheet rises 8pt, not its own height', () => {
  // MOTION-SPEC §3's Modal row is `scale(.96)→1 + translateY(8px)`. A panel that
  // climbs 300pt into the middle of the screen reads as a sheet that overshot.
  assert.match(
    readCode('components/Sheet.tsx'),
    /amplitude\(formSheet \? 8 : panelH, reduced\)/,
    'the travel is still the panel height on a tablet',
  );
});

// ── §3 · The card flow ────────────────────────────────────────────────────────

test('CardList distributes but does not define the thresholds', () => {
  // One definition of 640/1040, in the file that is unit tested for them.
  const code = readCode('components/CardList.tsx');
  assert.match(code, /useWindowClass/, 'CardList does not read the shared geometry');
  assert.doesNotMatch(code, /content >= 1040/, 'CardList re-derives the window thresholds');
});

test('CardList returns children untouched at one column', () => {
  // The phone is not a grid. Wrapping single-column children would impose a
  // gutter their own margins already handle.
  assert.match(readCode('components/CardList.tsx'), /if \(columns === 1\) return <>\{items\}<\/>;/);
});

test('CardList takes an explicit width, because a pane is not the window', () => {
  // A list pane is 280–400dp. Measured against the window it would be told it
  // has room for three columns inside 300 points.
  const code = readCode('components/CardList.tsx');
  assert.match(code, /width\?: number/, 'CardList cannot be told its own width');
  assert.match(code, /width === undefined/, 'CardList ignores the width it was given');
});

test('the More grid auto-fills instead of always being three columns', () => {
  // §3: "the module grid moves from a fixed 3 columns to
  // `repeat(auto-fill, minmax(112px, 1fr))`." A fixed 31% is three columns at
  // EVERY width — on a 1200dp window that is a row of three billboards.
  const code = readCode('screens/MoreScreen.tsx');
  assert.match(code, /minWidth: 112, flexGrow: 1, flexBasis: 112/);
  assert.doesNotMatch(code, /width: '31%'/, 'the tile is still pinned to three columns');
});

// ── §5 · Pahchan owns the window at every size ────────────────────────────────

test('ACCEPTANCE 5 — Pahchan capture shows no rail, drawer or bottom bar', () => {
  // §10 acceptance 5, and §5: "The capture screen owns the window. No rail, no
  // drawer, no panes, in any class, in either orientation."
  //
  // Checked at the SHELL rather than on the screen, because that is where the
  // chrome is decided — ClockScreen cannot suppress something it does not render.
  const shell = readCode('nav/ShellFrame.tsx');
  assert.match(shell, /const immersive = !!routeName && IMMERSIVE_ROUTES\.has\(routeName\)/);
  assert.match(shell, /const chrome = !immersive &&/, 'immersive does not suppress the chrome');

  // And both capture routes are in the set. Enroll is the face-enrolment camera;
  // it is the same full-bleed capture as the clock and needs the same treatment.
  assert.match(
    readCode('nav/destinations.ts'),
    /IMMERSIVE_ROUTES = new Set\(\['Clock', 'Enroll'\]\)/,
    'a capture route has lost its immersive treatment',
  );

  // The bottom bar is a separate suppressor — it lives in MainTabs, not the
  // shell — and Pahchan is a STACK route, so it is never inside MainTabs at all.
  // Asserted so that moving Clock into the tab navigator later cannot quietly
  // put a bar under the camera.
  const root = readCode('nav/RootStack.tsx');
  assert.match(root, /<Stack\.Screen name="Clock"/, 'Clock is no longer a stack route');
});
