import React, { useMemo, useState } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { tasksApi } from '../api/tasks';
import { TaskCard } from '../components/TaskCard';
import type { RootStackParamList } from '../nav/RootStack';
import type { Task } from '../api/types';

/**
 * Tasks — the second tab. 17-mobile-app.md gives it a Boards segment and
 * swipe-right-to-complete; the swipe lands with SwipeRow, which 17 requires be
 * written once and shared with approvals and messages rather than three times.
 *
 * The segments filter client-side on an already-fetched list rather than
 * refetching per segment. The list is the user's own tasks, which is small, and
 * a refetch per tab makes switching feel like loading.
 */

type Nav = NativeStackNavigationProp<RootStackParamList, 'Main'>;

type Segment = 'open' | 'today' | 'done';

const SEGMENTS: { id: Segment; en: string; hi: string }[] = [
  { id: 'open',  en: 'Open',  hi: 'खुले' },
  { id: 'today', en: 'Today', hi: 'आज' },
  { id: 'done',  en: 'Done',  hi: 'पूर्ण' },
];

const isDone = (task: Task) =>
  String(task.status ?? '').toLowerCase() === 'done' ||
  String(task.status ?? '').toLowerCase() === 'completed';

function isDueToday(task: Task): boolean {
  if (!task.due_at) return false;
  const d = new Date(task.due_at);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
}

export default function TasksScreen() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const [segment, setSegment] = useState<Segment>('open');

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['tasks', 'mine'],
    queryFn: () => tasksApi.list(),
  });

  const tasks = useMemo(() => {
    const all = data ?? [];
    if (segment === 'done')  return all.filter(isDone);
    if (segment === 'today') return all.filter((task: Task) => !isDone(task) && isDueToday(task));
    return all.filter((task: Task) => !isDone(task));
  }, [data, segment]);

  const counts = useMemo(() => {
    const all = data ?? [];
    return {
      open:  all.filter((task: Task) => !isDone(task)).length,
      today: all.filter((task: Task) => !isDone(task) && isDueToday(task)).length,
      done:  all.filter(isDone).length,
    };
  }, [data]);

  return (
    <View style={[s.root, { backgroundColor: t.bg, paddingTop: insets.top }]}>
      <View style={s.header}>
        <Text style={[s.title, { color: t.ink }]}>Tasks</Text>
        <Text style={[s.titleHi, { color: t.primaryText }]}>कर्तव्य</Text>
      </View>

      <View style={[s.segs, { backgroundColor: t.surface3 }]} accessibilityRole="tablist">
        {SEGMENTS.map(seg => {
          const on = seg.id === segment;
          return (
            <Pressable
              key={seg.id}
              onPress={() => setSegment(seg.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${seg.en}, ${counts[seg.id]} tasks`}
              style={[s.seg, on && { backgroundColor: t.surface }]}
            >
              <Text style={[s.segText, { color: on ? t.ink : t.ink3 }]}>{seg.en}</Text>
              <Text style={[s.segCount, { color: on ? t.primaryText : t.ink4 }]}>
                {counts[seg.id]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {isLoading ? (
        <View style={s.centre}><ActivityIndicator color={t.primary} /></View>
      ) : isError ? (
        <View style={[s.centre, { paddingHorizontal: 32 }]}>
          <Ionicons name="cloud-offline-outline" size={30} color={t.ink3} />
          <Text style={[s.emptyTitle, { color: t.ink }]}>Couldn't load tasks</Text>
          <Text style={[s.emptyBody, { color: t.ink3 }]}>Pull down to retry.</Text>
        </View>
      ) : (
        <FlatList
          data={tasks}
          keyExtractor={(task) => task.task_id}
          contentContainerStyle={[s.listPad, tasks.length === 0 && s.listGrow]}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={t.primary} />
          }
          ListEmptyComponent={
            <View style={s.centre}>
              <Ionicons
                name={segment === 'done' ? 'checkmark-done-outline' : 'sunny-outline'}
                size={30}
                color={t.ink3}
              />
              <Text style={[s.emptyTitle, { color: t.ink }]}>
                {segment === 'done' ? 'Nothing completed yet'
                  : segment === 'today' ? 'Nothing due today'
                  : 'No open tasks'}
              </Text>
              <Text style={[s.emptyBody, { color: t.ink3 }]}>
                {segment === 'open'
                  ? 'Tap ＋ to create one.'
                  : 'Switch segment to see the rest.'}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <TaskCard
              task={item}
              onPress={() => nav.navigate('TaskDetail', { taskId: item.task_id })}
            />
          )}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 },
  title: { fontSize: 26, fontWeight: '700', letterSpacing: -0.4 },
  titleHi: { fontSize: 14, marginTop: 2 },
  segs: {
    flexDirection: 'row', marginHorizontal: 16, marginBottom: 12,
    borderRadius: 10, padding: 3, gap: 3,
  },
  seg: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 7, borderRadius: 8,
  },
  segText:  { fontSize: 13, fontWeight: '600' },
  segCount: { fontSize: 11.5, fontWeight: '700' },
  listPad: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  listGrow: { flexGrow: 1 },
  emptyTitle: { fontSize: 15, fontWeight: '700', marginTop: 4 },
  emptyBody: { fontSize: 13, textAlign: 'center', lineHeight: 19 },
});
