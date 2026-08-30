import React from 'react';
import { View, StyleSheet } from 'react-native';

import { useWindowClass } from '../hooks/useWindowClass';
import { useTheme } from '../theme/ThemeProvider';
import { useAuth } from '../hooks/useAuth';
import { useNotifications } from '../context/NotificationContext';
import { useMentionUnread } from '../hooks/useLive';
import { useQueueStatus, agoLabel } from '../hooks/useQueueStatus';
import type { Platform } from '../lib/windowClass';
import NavRail from './NavRail';
import NavDrawer from './NavDrawer';
import { navigationRef } from './navigationRef';
import { destinationKeyFor, IMMERSIVE_ROUTES, type Destination } from './destinations';

/**
 * The shell — which navigation this window gets.
 *
 * 31-tablet.md §2, three forms of one thing:
 *
 *   compact              the phone's bottom bar (rendered by MainTabs, not here)
 *   medium · expanded    the rail, 72 on iPadOS / 80 on Android
 *   large                the expanded drawer, 280
 *
 * ── WHY THIS WRAPS THE STACK RATHER THAN REPLACING THE TAB BAR ──────────────
 *
 * The obvious implementation is a `tabBar` renderer that draws a rail instead of
 * a bar. Two things rule it out.
 *
 * First, `@react-navigation/bottom-tabs` v6 has no `tabBarPosition` — it lays the
 * bar out BELOW the scene in a column, so a rail rendered there would be a
 * horizontal strip at the bottom wearing a rail's styling.
 *
 * Second and more important, the rail has NINETEEN destinations and the tab
 * navigator has five routes. Fifteen of them are stack screens. A tabBar can
 * only address its own navigator's routes, so a rail built as one could not
 * reach CRM, or Settings, or the module surfaces — which is most of what §2
 * says the rail is FOR.
 *
 * So the frame sits outside the navigator and navigates through `navigationRef`.
 * The rail persists across pushes, which is the tablet behaviour anyway: opening
 * a task on an iPad should not hide the way back to Messages.
 *
 * ── §6 · IT IS A RESIZE, NOT A REMOUNT ──────────────────────────────────────
 *
 * "No refetch, no scroll reset, no keyboard dismissal. This is what breaks when
 * window state is read once at launch."
 *
 * Nothing here unmounts the navigator. Dragging an iPad app from full screen to
 * Slide Over changes which sibling renders beside the SAME `<Stack.Navigator>`
 * element — the rail disappears, the bottom bar returns, and every screen keeps
 * its state because none of them were touched. A shell that swapped one
 * navigator for another on resize would lose all of it, silently, and only on a
 * device.
 *
 * ── §5 · Pahchan owns the window ────────────────────────────────────────────
 *
 * The capture screens render with no rail and no drawer at any class. See
 * `IMMERSIVE_ROUTES`.
 */

interface Props {
  platform: Platform;
  /** The focused stack route, lifted from NavigationContainer's onStateChange. */
  routeName?: string;
  /** The focused tab within `Main`, when that is the route. */
  tabName?: string;
  /** Opens the new-task sheet. The rail's FAB and the drawer's button. */
  onAdd: () => void;
  children: React.ReactNode;
}

export default function ShellFrame({ platform, routeName, tabName, onAdd, children }: Props) {
  const { t } = useTheme();
  const { cls } = useWindowClass(platform);
  const { user } = useAuth();
  const { unread } = useNotifications();
  const mentions = useMentionUnread();
  const { changes, anyPending } = useQueueStatus();

  /**
   * The last route that WAS a destination.
   *
   * Pushing a task detail or a chat should not un-light the list it came from —
   * `destinationKeyFor` returns null for those, and blanking the selection every
   * time you opened something would make the rail flicker its way through a
   * normal session.
   */
  const key = destinationKeyFor(routeName, tabName);
  const [current, setCurrent] = React.useState('today');
  React.useEffect(() => { if (key) setCurrent(key); }, [key]);

  const immersive = !!routeName && IMMERSIVE_ROUTES.has(routeName);
  const showRail   = cls === 'medium' || cls === 'expanded';
  const showDrawer = cls === 'large';

  /**
   * ⚠ SIGNED OUT MEANS NO NAVIGATION, AND THIS SHELL DID NOT KNOW THAT.
   *
   * `RootStack` mounts `<ShellFrame>` OUTSIDE `Stack.Navigator` — it has to,
   * because the rail addresses stack routes the tab navigator knows nothing
   * about (`RootStack.tsx:336`). The auth gate is INSIDE that navigator
   * (`{!user ? <Login/> : …}`), so the shell was rendered whether or not there
   * was a user.
   *
   * On a phone this is invisible: `compact` shows no rail, so there is nothing
   * to see. On a TABLET it drew the full nineteen-destination rail — Today,
   * Tasks, Messages, Boards, Inbox, Mentions, Approvals, Attendance, Time,
   * Reminders, CRM, Invoicing, HR, Payslips, Analytics, Content, More — plus
   * the Create button and a "SYNCED" status dot, in a column beside the SIGN IN
   * FORM. Screenshotted on `Tab_A11_Plus` by Suite 21, 2026-08-29.
   *
   * It is not an auth bypass: the stack holds only `Login` at that point, so
   * the taps go nowhere. It is worse in a quieter way — the sign-in screen of a
   * product that gates modules per organisation was listing every module, to
   * anybody holding the tablet, before they proved who they were. And it is
   * exactly the class of defect §11 predicted: "the tablet has a separate
   * layout and NOTHING has ever exercised it."
   *
   * `user` was already in scope and already read three lines below, for the
   * name on the rail — the shell knew who was signed in and drew itself anyway.
   */
  const chrome = !!user && !immersive && (showRail || showDrawer);

  const go = (d: Destination) => {
    // `isReady` because the rail can only be pressed after the container has
    // mounted, but a deep link can drive this path before it has.
    if (!navigationRef.isReady()) return;
    if (d.tab) navigationRef.navigate('Main', { screen: d.tab });
    else navigationRef.navigate(d.route as never);
  };

  const badges = { unread, mentions };

  return (
    <View style={[s.row, { backgroundColor: t.bg }]}>
      {chrome && showRail && (
        <NavRail
          platform={platform}
          current={current}
          onSelect={go}
          // The rail overflows into More only when the window is too short for
          // nineteen. More is still a real tab inside `Main`, so this is a
          // navigation like any other rather than a special case.
          onMore={() => navigationRef.navigate('Main', { screen: 'More' })}
          onAdd={onAdd}
          badges={badges}
          pending={anyPending}
          userName={user?.full_name ?? user?.name}
        />
      )}

      {chrome && showDrawer && (
        <NavDrawer
          platform={platform}
          current={current}
          onSelect={go}
          onAdd={onAdd}
          onClock={() => navigationRef.navigate('Clock')}
          badges={badges}
          queued={changes.count}
          oldestLabel={agoLabel(changes.oldestAt)}
          /*
           * NOT WIRED YET, and null is the honest value rather than a
           * placeholder. §3 wants the LIVE timer here — "whether you are on the
           * clock" — but that state lives in a react-query fetch inside
           * ClockScreen, and lifting it into a shell that is mounted for the
           * whole session means a poll running for every tablet user all day.
           * That is a decision about network cost, not a wiring detail, so the
           * footer currently offers "Clock in" and navigates. It is never wrong,
           * only incomplete: it does not yet say you are already clocked in.
           */
          clockedFor={null}
          userName={user?.full_name ?? user?.name}
          orgName={user?.company_name}
          userRole={user?.position ?? user?.member_role}
        />
      )}

      <View style={s.content}>{children}</View>
    </View>
  );
}

const s = StyleSheet.create({
  row:     { flex: 1, flexDirection: 'row' },
  content: { flex: 1, minWidth: 0 },
});
