import React, { useMemo, useCallback, useState } from 'react';
import {
  View, Text, SectionList, ScrollView,
  TouchableOpacity, StyleSheet, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { format, isToday, isTomorrow, isThisWeek, isPast } from 'date-fns';
import { useTheme } from '../theme/ThemeProvider';
import { FAMILY } from '../theme/fonts';
import { useAuth } from '../hooks/useAuth';
import { tasksApi } from '../api/tasks';
import { TaskCard } from '../components/TaskCard';
import Refresher from '../components/Refresher';
import ScreenState, { resolveScreenState } from '../components/ScreenState';
import { useOnline } from '../hooks/useOnline';
import { useQueueStatus } from '../hooks/useQueueStatus';
import { queuedEntityIds } from '../offline/mutationQueue';
import type { Task } from '../api/types';
import type { RootStackParamList } from '../nav/RootStack';
import TodayAside from './today/TodayAside';
import { useWindowClass } from '../hooks/useWindowClass';
import { devicePlatform } from '../nav/platform';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Main'>;
type Filter = 'all' | 'today' | 'mentions' | 'approvals' | 'overdue';

const FILTER_CHIPS: Array<{ id: Filter; label: string }> = [
  { id: 'all',       label: 'All' },
  { id: 'today',     label: 'Due today' },
  { id: 'mentions',  label: 'Mentions' },
  { id: 'approvals', label: 'Approvals' },
  { id: 'overdue',   label: 'Overdue' },
];

interface Section { title: string; titleHi: string; count: number; data: Task[] }

function bucketTasks(tasks: Task[], userId: string): Section[] {
  const mine = tasks.filter(t =>
    t.created_by_user_id === userId ||
    (Array.isArray(t.assignee_user_ids) && t.assignee_user_ids.includes(userId))
  ).filter(t => t.status !== 'done');

  const overdue:   Task[] = [];
  const dueToday:  Task[] = [];
  const thisWeek:  Task[] = [];
  const later:     Task[] = [];

  mine.forEach(t => {
    if (!t.due_at) { later.push(t); return; }
    const d = new Date(t.due_at);
    if (isPast(d) && !isToday(d)) overdue.push(t);
    else if (isToday(d))          dueToday.push(t);
    else if (isThisWeek(d, { weekStartsOn: 1 })) thisWeek.push(t);
    else                          later.push(t);
  });

  const out: Section[] = [];
  if (overdue.length)  out.push({ title: 'Overdue',    titleHi: 'विलंबित',   count: overdue.length,  data: overdue });
  if (dueToday.length) out.push({ title: 'Due today',  titleHi: 'आज',        count: dueToday.length, data: dueToday });
  if (thisWeek.length) out.push({ title: 'This week',  titleHi: 'इस सप्ताह', count: thisWeek.length, data: thisWeek });
  if (later.length)    out.push({ title: 'Later',      titleHi: 'बाद में',   count: later.length,    data: later });
  return out;
}

const IS_ANDROID = Platform.OS === 'android';

export default function TodayScreen() {
  const { t }    = useTheme();
  const { user } = useAuth();
  const nav      = useNavigation<Nav>();
  const insets   = useSafeAreaInsets();
  const [filter, setFilter] = useState<Filter>('all');

  const online = useOnline();

  const query = useQuery({
    queryKey: ['tasks', 'mine'],
    queryFn:  () => tasksApi.list(),
    staleTime: 60_000,
  });
  const { isLoading, refetch, isFetching } = query;
  // `?? []` rather than a destructuring default, because the default would erase
  // the difference between "the server answered with nothing" and "the request
  // failed" — and this screen used to render "All clear!" for both.
  const tasks = query.data ?? [];

  const allSections = useMemo(
    () => user ? bucketTasks(tasks, user.user_id) : [],
    [tasks, user?.user_id]
  );

  // Same reason as TasksScreen: an optimistically-completed row is
  // indistinguishable from an acknowledged one without this. See §7.1.
  const { changes } = useQueueStatus();
  const platform = devicePlatform();
  /**
   * §3 gives Today TWO COLUMNS and no detail pane: "A summary, not a list of
   * things you open."
   *
   * Keyed on the content width — the prototype uses `contentW >= 640` for the
   * one-vs-two decision here, which is the CARD FLOW threshold rather than the
   * 660dp split floor. They are different questions: 660 asks whether a detail
   * pane would be narrower than a phone, and there is no detail pane here.
   */
  const { columns } = useWindowClass(platform);
  const twoColumn = columns > 1;
  const queuedTaskIds = useMemo(() => queuedEntityIds('task'), [changes.count]);

  const sections = useMemo(() => {
    if (filter === 'today')     return allSections.filter(s => s.title === 'Due today');
    if (filter === 'overdue')   return allSections.filter(s => s.title === 'Overdue');
    if (filter === 'approvals') {
      const data = allSections.flatMap(s =>
        s.data.filter(t => t.approval_status && t.approval_status !== 'approved')
      );
      return data.length
        ? [{ title: 'Awaiting Approval', titleHi: 'अनुमोदन', count: data.length, data }]
        : [];
    }
    if (filter === 'mentions') {
      const data = allSections.flatMap(s => s.data.filter(t => (t as any).has_mention));
      return data.length
        ? [{ title: 'Mentions', titleHi: 'उल्लेख', count: data.length, data }]
        : [];
    }
    return allSections;
  }, [allSections, filter]);

  /**
   * Loading, offline, error and empty are four different answers, and this
   * screen used to give the same one to all of them: `data` defaulted to `[]`,
   * so a failed fetch fell straight through to `ListEmptyComponent` and told
   * someone with an overdue task that they were "All clear!".
   *
   * The reference is explicit that this state exists — `Mobile.jsx`'s `MToday`
   * has a dedicated `st === 'error'` branch reading "Couldn't load today · The
   * server didn't answer. Anything you changed offline is still queued and
   * safe." The copy below keeps that promise, because it is the one thing a
   * user needs to know before they retype anything.
   */
  const status = resolveScreenState({
    isLoading,
    isError: query.isError,
    error:   query.error,
    online,
    hasData: query.data !== undefined,
    isEmpty: query.data !== undefined && sections.length === 0,
  });

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }, []);

  const todayDate = format(new Date(), 'd MMM');
  const firstName = user?.name?.split(' ')[0] ?? user?.full_name?.split(' ')[0] ?? '';

  const openTask = useCallback((taskId: string) => {
    nav.navigate('TaskDetail', { taskId });
  }, [nav]);

  const work = (
    <View style={[s.root, { backgroundColor: t.bg }]}>
      <SectionList
        sections={sections}
        keyExtractor={item => item.task_id}
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={
          <Refresher refreshing={isFetching && !isLoading} onRefresh={refetch} />
        }
        ListHeaderComponent={
          <View>
            {/* ── Screen header ─────────────────────────────────────── */}
            <View style={[s.header, {
              backgroundColor: IS_ANDROID ? t.surface : t.bg,
              paddingTop: insets.top + (IS_ANDROID ? 8 : 54),
            }]}>
              <View style={s.kickerRow}>
                <Text style={[s.kicker, { color: t.primary }]}>
                  Today · {todayDate}
                </Text>
                <Text style={[s.kickerHi, { color: t.ink3 }]}>वैशाख</Text>
              </View>
              <View style={s.titleRow}>
                <Text style={[s.screenTitle, { color: t.ink }]}>
                  {greeting}{firstName ? `, ${firstName}` : ''}
                </Text>
              </View>
            </View>

            {/* ── Filter chips ─────────────────────────────────────── */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[s.chipsRow]}
            >
              {FILTER_CHIPS.map((chip, i) => {
                const active = filter === chip.id;
                return (
                  <TouchableOpacity
                    key={chip.id}
                    onPress={() => setFilter(chip.id)}
                    activeOpacity={0.7}
                    style={[
                      s.chip,
                      IS_ANDROID
                        ? {
                            backgroundColor: active ? t.secondaryContainer : 'transparent',
                            borderColor:     active ? 'transparent'         : t.outline,
                            borderWidth:     1,
                          }
                        : {
                            backgroundColor: active ? t.primary : t.surfaceLow,
                            borderWidth:     0,
                          },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    {IS_ANDROID && active && i === 0 && (
                      <Text style={{ fontSize: 12, color: t.onSecondaryContainer, marginRight: 2 }}>✓</Text>
                    )}
                    <Text style={[
                      s.chipLabel,
                      {
                        color: IS_ANDROID
                          ? (active ? t.onSecondaryContainer : t.ink2)
                          : (active ? '#fff' : t.ink2),
                      },
                    ]}>
                      {chip.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

          </View>
        }
        ListEmptyComponent={
          status === 'ready' ? null : status === 'empty' ? (
            <View style={s.empty}>
              <Text style={[s.emptyTitle, { color: t.ink }]}>All clear!</Text>
              <Text style={[s.emptyBody, { color: t.ink3 }]}>No tasks for this filter.</Text>
            </View>
          ) : (
            <ScreenState
              status={status}
              onRetry={() => refetch()}
              {...(status === 'error'
                ? {
                    title: "Couldn't load today",
                    body:  'The server didn’t answer. Anything you changed offline is still queued and safe.',
                  }
                : {})}
            />
          )
        }
        renderSectionHeader={({ section }) => (
          <View style={s.sectionHead}>
            <Text style={[s.sectionLabel, { color: t.ink2 }]}>{section.title}</Text>
            <Text style={[s.sectionLabelHi, { color: t.ink3 }]}>{section.titleHi}</Text>
            <Text style={[s.sectionCount, { color: t.ink2 }]}>{section.count}</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <View style={s.cardWrap}>
            <TaskCard
              task={item}
              onPress={() => openTask(item.task_id)}
              syncing={queuedTaskIds.has(item.task_id)}
            />
          </View>
        )}
      />
    </View>
  );

  if (!twoColumn) return work;

  /**
   * 1.3fr / 1fr, from `tablet.css`'s `.ttoday`. The left column is the work you
   * are here to do; the right is what is waiting, what happened, and who wrote
   * to you. Not 1:1 — an even split would give the summary as much weight as
   * the tasks, and this screen is called Today because the tasks are the point.
   */
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: t.bg }}>
      <View style={{ flex: 1.3, minWidth: 0 }}>{work}</View>
      <View style={{ flex: 1, minWidth: 0, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: t.outlineVar }}>
        <TodayAside />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },

  header: {
    paddingHorizontal: 16,
    paddingBottom: IS_ANDROID ? 4 : 6,
  },
  kickerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginBottom: 4,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  kickerHi: {
    fontSize: 12,
    fontWeight: '400',
    fontFamily: FAMILY.devanagari,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  screenTitle: {
    fontSize: IS_ANDROID ? 30 : 34,
    fontWeight: IS_ANDROID ? '500' : '400',
    lineHeight: IS_ANDROID ? 36 : 40,
    letterSpacing: -0.5,
    flex: 1,
    fontFamily: IS_ANDROID ? undefined : FAMILY.display,
  },

  chipsRow: {
    paddingHorizontal: 16,
    paddingVertical: IS_ANDROID ? 12 : 8,
    gap: 8,
    paddingBottom: 4,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: IS_ANDROID ? 16 : 12,
    paddingVertical: IS_ANDROID ? 7 : 6,
    borderRadius: 99,
  },
  chipLabel: {
    fontSize: IS_ANDROID ? 13.5 : 13,
    fontWeight: '600',
    letterSpacing: IS_ANDROID ? 0.1 : -0.1,
  },

  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: IS_ANDROID ? 16 : 14,
    paddingBottom: IS_ANDROID ? 10 : 8,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  sectionLabelHi: {
    fontSize: 12,
    fontFamily: FAMILY.devanagari,
    fontWeight: '400',
    textTransform: 'none' as any,
    letterSpacing: 0,
  },
  sectionCount: {
    marginLeft: 'auto' as any,
    fontSize: 12,
    fontFamily: FAMILY.mono,
  },

  cardWrap: { paddingHorizontal: 16 },

  empty: {
    alignItems: 'center',
    paddingTop: 60,
    gap: 8,
  },
  emptyTitle: { fontSize: 17, fontWeight: '600' },
  emptyBody:  { fontSize: 13 },
});
