import React, { useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTheme } from '../theme/ThemeProvider';
import { DUR, useReducedMotion } from '../theme/motion';
import { linking } from './linking';
import { navigationRef } from './navigationRef';
import BottomBar from './BottomBar';
import { withTabTransition } from './TabScene';

// ── Screens ──────────────────────────────────────────────────────────────────
import TodayScreen       from '../screens/TodayScreen';
import TasksScreen       from '../screens/TasksScreen';
import MessagesScreen    from '../screens/MessagesScreen';
import ChatScreen        from '../screens/ChatScreen';
import MentionsScreen    from '../screens/MentionsScreen';
import SearchScreen      from '../screens/SearchScreen';
import ApprovalsScreen   from '../screens/ApprovalsScreen';
import TimeScreen        from '../screens/TimeScreen';
import MoreScreen        from '../screens/MoreScreen';
import ClockScreen       from '../screens/pahchan/ClockScreen';
import EnrollScreen      from '../screens/pahchan/EnrollScreen';
import SettingsScreen    from '../screens/SettingsScreen';
import InboxScreen       from '../screens/InboxScreen';
import MeScreen          from '../screens/MeScreen';
import TaskDetailScreen  from '../screens/TaskDetailScreen';
import BoardScreen       from '../screens/BoardScreen';
import LoginScreen       from '../screens/LoginScreen';
import ClientPortalScreen from '../screens/ClientPortalScreen';
import RemindersScreen   from '../screens/RemindersScreen';
// The seven light module surfaces (17 §Screens). Each is the CHECKING view and
// states its own boundary; none of them is a stub.
import GrahaScreen       from '../screens/modules/GrahaScreen';
import GanitScreen       from '../screens/modules/GanitScreen';
import ManavScreen       from '../screens/modules/ManavScreen';
import VetanaScreen      from '../screens/modules/VetanaScreen';
import DristiScreen      from '../screens/modules/DristiScreen';
import SrijanScreen      from '../screens/modules/SrijanScreen';
import PracharScreen     from '../screens/modules/PracharScreen';
// Sahayak is NOT one of the seven light module surfaces. Those are checking
// views — read a dashboard, come back. This is a doing view: it writes, it
// spends credits, and it is the second of the two surfaces on the scoped Slate
// palette. It sits beside Srijan rather than replacing it, because Srijan's
// dashboard answers "what has the practice generated" and this answers "what
// does this client's knowledge base say", and neither is the other.
import SahayakScreen     from '../screens/SahayakScreen';
import { useAuth } from '../hooks/useAuth';
import { useNotifications } from '../context/NotificationContext';
import { useMentionUnread } from '../hooks/useLive';
import { Splash } from '../App';
import NewTaskSheet from '../components/NewTaskSheet';

// ── Param lists ───────────────────────────────────────────────────────────────
export type RootStackParamList = {
  Main:         undefined;
  TaskDetail:   { taskId: string };
  Board:        { projectId?: string; projectName?: string } | undefined;
  /**
   * One channel.
   *
   * `channelName` is OPTIONAL, and that is the change that makes a deep link to
   * a channel buildable at all. It exists so the header renders before the first
   * fetch resolves rather than flashing an empty title — but a URL cannot supply
   * it, and neither can a push payload, so requiring it made every deep-linked
   * channel unreachable. ChatScreen falls back to the name from
   * `['messaging','channels']`, then to a placeholder while that loads.
   *
   * `message` and `thread` are named for the URL's OWN query keys rather than
   * camelCased, because React Navigation passes unrecognised query params
   * through under their own names. Renaming them would need a `parse` map that
   * nothing type-checks — see `linking.ts`.
   *
   *   · `message` — the row to highlight.
   *   · `thread`  — the thread ROOT to open on. Present only when the target was
   *                 itself a reply; threads are flat, so there is no chain to
   *                 walk.
   */
  Chat:         { channelId: string; channelName?: string; message?: string; thread?: string };
  /** Every message that named me. Reached from the Messages header and More. */
  Mentions:     undefined;
  /** Pre-scoped from the ChatScreen header; undefined from a global entry. */
  Search:       { channelId?: string; channelName?: string } | undefined;
  Approvals:    undefined;
  Time:         undefined;
  Inbox:        undefined;
  Reminders:    undefined;
  Settings:     undefined;
  // The seven light module surfaces. Stack screens rather than tabs: they are
  // destinations you go to from More and come back from, not places you live.
  Graha:        undefined;
  Ganit:        undefined;
  Manav:        undefined;
  Vetana:       undefined;
  Dristi:       undefined;
  Srijan:       undefined;
  Prachar:      undefined;
  /** Sahayak · सहायक. Takes no params: the client it reads is a stored
   *  preference (`sahayak_client_id` in MMKV), not a route argument, so
   *  returning to it lands on the client you were last asking about. */
  Sahayak:      undefined;
  // Reachable from the full shell's More tab as well as being the whole app for
  // an attendance-only user, so it is a stack screen in both cases.
  Clock:        undefined;
  Enroll:       undefined;
  Login:        undefined;
  Client:       undefined;
};

/**
 * Today · Tasks · ＋ · Messages · More, per 17-mobile-app.md. Messages takes the
 * fourth slot because messaging is the highest-frequency mobile action; Inbox
 * moves under More and keeps its badge there.
 *
 * `Create` is a stub. Its tab press opens the sheet instead of navigating,
 * because the ＋ is an action and pushing a screen for it breaks the back stack —
 * Android hardware back would pop to a screen the user never chose to visit.
 */
export type MainTabParamList = {
  Today:    undefined;
  Tasks:    undefined;
  Create:   undefined;
  Messages: undefined;
  More:     undefined;
};

/**
 * The attendance-only shell (07-pahchan.md §9, 17 §attendance-only shell).
 *
 * Some employees' entire relationship with Kartavaya is clocking in. A driver or
 * a site worker does not need five tabs, a board or an inbox.
 *
 * Not a second app and not a stripped build: same account, same permissions,
 * same API. A user promoted out of an attendance-only role gets the full shell
 * on next sign-in with no migration and no reinstall — which is only true
 * because the shell is chosen from the ROLE, never from a build flag or a
 * per-device setting. A flag becomes a variant nobody tests.
 */
export type PahchanTabParamList = {
  Clock: undefined;
  Me:    undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab   = createBottomTabNavigator<MainTabParamList>();
const PahchanTab = createBottomTabNavigator<PahchanTabParamList>();

/**
 * Never rendered. `Create` exists only so the ＋ occupies a tab slot; BottomBar
 * intercepts its press and opens the sheet. Returning null rather than pointing
 * at a real screen means an accidental navigation shows nothing instead of a
 * duplicate Today.
 */
const CreateStub = () => null;

/**
 * Each tab screen wrapped once, at module scope.
 *
 * Wrapping inline in the render — `component={withTabTransition(TodayScreen)}` —
 * would build a NEW component type on every render of MainTabs, and React
 * remounts on a changed type. Every tab would lose its scroll position and
 * refetch its list each time the badge count changed.
 */
const TodayTab    = withTabTransition(TodayScreen);
const TasksTab    = withTabTransition(TasksScreen);
const MessagesTab = withTabTransition(MessagesScreen);
const MoreTab     = withTabTransition(MoreScreen);
const ClockTab    = withTabTransition(ClockScreen);
const MeTab       = withTabTransition(MeScreen);

// ── Main tabs ─────────────────────────────────────────────────────────────────
function MainTabs() {
  const { unread } = useNotifications();
  /**
   * The Messages badge counts MENTIONS, not unread messages.
   *
   * Deliberate, and it is the difference between a badge that is read and one
   * that is dismissed. Total unread in a busy org is a permanent two-digit
   * number that says nothing about whether anything needs you; a mention is
   * somebody typing your name. `More` keeps the Inbox notification count it
   * already had.
   *
   * The number comes from the single `/live` poll in `LiveProvider`, which is
   * mounted above this navigator in `App.tsx`. If it ever stops being mounted
   * there, `useLive` returns its empty payload and this badge silently reads
   * zero forever — there is no crash to notice, so that mount is the thing to
   * check first if mentions stop appearing here.
   */
  const mentionUnread = useMentionUnread();
  const [showNewTask, setShowNewTask] = useState(false);

  return (
    <>
      <Tab.Navigator
        screenOptions={{ headerShown: false }}
        tabBar={(props) => (
          <BottomBar
            {...props}
            actionRoute="Create"
            onAction={() => setShowNewTask(true)}
            // The keys are ROUTE NAMES — `BottomBar` reads
            // `badges?.[route.name] ?? 0`, so a typo here fails by rendering
            // nothing at all rather than by throwing.
            badges={{ More: unread, Messages: mentionUnread }}
          />
        )}
      >
        <Tab.Screen name="Today"    component={TodayTab} />
        <Tab.Screen name="Tasks"    component={TasksTab} />
        <Tab.Screen name="Create"   component={CreateStub} />
        <Tab.Screen name="Messages" component={MessagesTab} />
        <Tab.Screen name="More"     component={MoreTab} />
      </Tab.Navigator>
      <NewTaskSheet visible={showNewTask} onClose={() => setShowNewTask(false)} />
    </>
  );
}

/**
 * Attendance-only shell: Clock · Me, no More, no ＋.
 *
 * `Me` here is NOT a reduced Settings. 07 §9 is specific: it carries the
 * employee's own reference pair, their register, and the retention promise in
 * plain words — three things the full shell buries under More → Settings, and
 * the only three this user needs.
 */
function PahchanTabs() {
  return (
    <PahchanTab.Navigator
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <BottomBar {...props} />}
    >
      {/* Clock is the attendance-only user's whole app: 07 §9. 
          Me is not a reduced Settings — it carries their own reference pair,
          their register, and the retention promise in plain words. */}
      <PahchanTab.Screen name="Clock" component={ClockTab} />
      <PahchanTab.Screen name="Me"    component={MeTab} />
    </PahchanTab.Navigator>
  );
}

/**
 * Which shell this user gets. Read from the role, never from a flag.
 *
 * Deliberately a denylist-free positive check: only a role that is exactly
 * attendance-only gets the reduced shell, so a new role added later defaults to
 * the full app rather than silently losing tabs.
 */
function isAttendanceOnly(role?: string | null): boolean {
  return role === 'attendance' || role === 'pahchan_only';
}

// ── Root navigator ─────────────────────────────────────────────────────────────
export default function RootStack() {
  const { user, loading, logout } = useAuth();
  const { t, scheme }     = useTheme();
  const reduced           = useReducedMotion();

  /**
   * Screen push and pop, and the reduced-motion path they never had.
   *
   * `createNativeStackNavigator` defaults to the platform push — a full-width
   * horizontal slide on both iOS and Android — and it does NOT consult
   * `AccessibilityInfo.isReduceMotionEnabled`. (iOS dims some of its own system
   * transitions under Reduce Motion; a React Navigation native-stack push is not
   * one of them.) So every screen in the app slid the width of the display for a
   * user who had asked it not to.
   *
   * The answer is `fade`, not `none`, and `theme/motion.ts` is explicit about
   * why: `amplitude()` "removes the MOVEMENT while leaving the opacity or colour
   * change that carried the actual information". A cross-fade has no translation
   * and no scale. `none` would also be defensible, but it throws away the one
   * cue that says a NEW screen arrived rather than this one re-rendering.
   *
   * `animationDuration` is iOS-only on native-stack. `DUR.slow` is 360ms, which
   * is within a few ms of UIKit's own push and is now a token rather than the
   * platform default nobody could name.
   */
  const screenAnimation = {
    animation: (reduced ? 'fade' : 'default') as 'fade' | 'default',
    animationDuration: DUR.slow,
  };

  if (loading) return <Splash />;

  return (
    <NavigationContainer
      ref={navigationRef}
      linking={linking}
      theme={{
        dark: scheme === 'dark',
        colors: {
          primary:    t.primary,
          background: t.bg,
          card:       t.surface,
          text:       t.ink,
          border:     t.outline,
          notification: t.primary,
        },
      }}
    >
      <Stack.Navigator screenOptions={{ headerShown: false, ...screenAnimation }}>
        {!user ? (
          <Stack.Screen name="Login"  component={LoginScreen} />
        ) : user.role === 'client' ? (
          <Stack.Screen name="Client">{() => <ClientPortalScreen onLogout={logout} />}</Stack.Screen>
        ) : (
          <>
            <Stack.Screen
              name="Main"
              component={isAttendanceOnly(user.role) ? PahchanTabs : MainTabs}
            />
            {/* The one screen presented as a sheet rather than pushed, so it
                keeps `slide_from_bottom` — but reduced motion overrides it to
                the same cross-fade as everything else. The presentation style
                is unchanged; only the travel goes. */}
            <Stack.Screen name="TaskDetail" component={TaskDetailScreen}
              options={{
                presentation: 'modal',
                animation: reduced ? 'fade' : 'slide_from_bottom',
                animationDuration: DUR.sheet,
              }} />
            <Stack.Screen name="Board"     component={BoardScreen} />
            {/* `getId` keyed on the channel, so navigating to a DIFFERENT
                channel replaces the screen instead of reusing it with new
                params. Without it React Navigation keeps the mounted instance
                and its draft: tap a mention banner while half-way through
                typing in another channel and the composer arrives still holding
                that text, one send away from posting it to the wrong people.
                Same route, different conversation, is a different screen. */}
            <Stack.Screen name="Chat"      component={ChatScreen}
              getId={({ params }) => (params as { channelId?: string })?.channelId} />
            {/* Sanvaad's two reading surfaces. Both are registered here AND have
                an entry point in the product — Mentions from the Messages header
                and from More, Search from the Messages header and from a
                channel's own header. A route with no entry point is a feature
                that exists only in the router, which is exactly how pinning
                shipped invisible on the web. */}
            <Stack.Screen name="Mentions"  component={MentionsScreen} />
            <Stack.Screen name="Search"    component={SearchScreen} />
            {/* Both reached from More. Approvals and Time were tiles that showed
                a "next release" note; they are real destinations now. */}
            <Stack.Screen name="Approvals" component={ApprovalsScreen} />
            <Stack.Screen name="Time"      component={TimeScreen} />
            {/* Inbox lost its tab to Messages and is reached from More. It stays
                a stack screen so its deep link and its badge still work. */}
            <Stack.Screen name="Inbox"     component={InboxScreen} />
            <Stack.Screen name="Clock"     component={ClockScreen} />
            <Stack.Screen name="Enroll"    component={EnrollScreen} />
            <Stack.Screen name="Reminders" component={RemindersScreen} />
            <Stack.Screen name="Settings"  component={SettingsScreen} />
            {/* The seven light module surfaces. Every one of the six tiles that
                used to show a "not built yet" note is now a real destination,
                and Srijan and Prachar are added — 17 lists seven. */}
            <Stack.Screen name="Graha"   component={GrahaScreen} />
            <Stack.Screen name="Ganit"   component={GanitScreen} />
            <Stack.Screen name="Manav"   component={ManavScreen} />
            <Stack.Screen name="Vetana"  component={VetanaScreen} />
            <Stack.Screen name="Dristi"  component={DristiScreen} />
            <Stack.Screen name="Srijan"  component={SrijanScreen} />
            <Stack.Screen name="Prachar" component={PracharScreen} />
            <Stack.Screen name="Sahayak" component={SahayakScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
