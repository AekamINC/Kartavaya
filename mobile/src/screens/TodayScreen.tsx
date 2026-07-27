import React, { useMemo, useCallback, useState } from 'react';
import {
  View, Text, SectionList, ScrollView,
  TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl, Platform,
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
import type { Task } from '../api/types';
import type { RootStackParamList } from '../nav/RootStack';

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

  const { data: tasks = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['tasks', 'mine'],
    queryFn:  () => tasksApi.list(),
    staleTime: 60_000,
  });

  const allSections = useMemo(
    () => user ? bucketTasks(tasks, user.user_id) : [],
    [tasks, user?.user_id]
  );

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

  return (
    <View style={[s.root, { backgroundColor: t.bg }]}>
      <SectionList
        sections={sections}
        keyExtractor={item => item.task_id}
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={
          <RefreshControl
            refreshing={isFetching && !isLoading}
            onRefresh={refetch}
            tintColor={t.primary}
          />
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

            {isLoading && (
              <View style={{ padding: 40, alignItems: 'center' }}>
                <ActivityIndicator color={t.primary} />
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          !isLoading ? (
            <View style={s.empty}>
              <Text style={[s.emptyTitle, { color: t.ink }]}>All clear!</Text>
              <Text style={[s.emptyBody, { color: t.ink3 }]}>No tasks for this filter.</Text>
            </View>
          ) : null
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
            <TaskCard task={item} onPress={() => openTask(item.task_id)} />
          </View>
        )}
      />
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
    fontFamily: IS_ANDROID ? undefined : 'Newsreader',
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
    fontFamily: 'SpaceMono',
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
