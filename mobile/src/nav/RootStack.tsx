import React, { useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTheme } from '../theme/ThemeProvider';
import { linking } from './linking';
import { navigationRef } from './navigationRef';
import BottomBar from './BottomBar';

// ── Screens ──────────────────────────────────────────────────────────────────
import TodayScreen       from '../screens/TodayScreen';
import TasksScreen       from '../screens/TasksScreen';
import MessagesScreen    from '../screens/MessagesScreen';
import ChatScreen        from '../screens/ChatScreen';
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
import { useAuth } from '../hooks/useAuth';
import { useNotifications } from '../context/NotificationContext';
import { Splash } from '../App';
import NewTaskSheet from '../components/NewTaskSheet';

// ── Param lists ───────────────────────────────────────────────────────────────
export type RootStackParamList = {
  Main:         undefined;
  TaskDetail:   { taskId: string };
  Board:        { projectId?: string; projectName?: string } | undefined;
  /** One channel. `channelName` is passed so the header renders before the
   *  first fetch resolves rather than flashing an empty title. */
  Chat:         { channelId: string; channelName: string };
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

// ── Main tabs ─────────────────────────────────────────────────────────────────
function MainTabs() {
  const { unread } = useNotifications();
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
            badges={{ More: unread }}
          />
        )}
      >
        <Tab.Screen name="Today"    component={TodayScreen} />
        <Tab.Screen name="Tasks"    component={TasksScreen} />
        <Tab.Screen name="Create"   component={CreateStub} />
        <Tab.Screen name="Messages" component={MessagesScreen} />
        <Tab.Screen name="More"     component={MoreScreen} />
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
      <PahchanTab.Screen name="Clock" component={ClockScreen} />
      <PahchanTab.Screen name="Me"    component={MeScreen} />
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
      <Stack.Navigator screenOptions={{ headerShown: false }}>
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
            <Stack.Screen name="TaskDetail" component={TaskDetailScreen}
              options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
            <Stack.Screen name="Board"     component={BoardScreen} />
            <Stack.Screen name="Chat"      component={ChatScreen} />
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
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
