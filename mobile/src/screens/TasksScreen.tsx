import React, { useMemo, useState } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { hindi } from '../theme/fonts';
import { tasksApi } from '../api/tasks';
import { TaskCard } from '../components/TaskCard';
import SwipeRow from '../components/SwipeRow';
import Refresher from '../components/Refresher';
import { useOfflineMutation } from '../hooks/useOfflineMutation';
import { useQueueStatus } from '../hooks/useQueueStatus';
import { queuedEntityIds } from '../offline/mutationQueue';
import type { RootStackParamList } from '../nav/RootStack';
import type { Task } from '../api/types';
import PaneHost, { EmptyPane } from '../components/PaneHost';
import TaskDetailScreen from './TaskDetailScreen';
import { useWindowClass } from '../hooks/useWindowClass';
import { devicePlatform } from '../nav/platform';

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
  const platform = devicePlatform();
  const { split } = useWindowClass(platform);
  /**
   * Which task the detail pane is showing.
   *
   * Held HERE, above `PaneHost`, because §6 requires selection to outlive the
   * layout: drag the window narrow and the detail becomes the full view on the
   * same record; widen it again and the two panes return with that record still
   * selected. Kept inside the pane it would be unmounted by that transition.
   */
  const [selected, setSelected] = useState<string | null>(null);

  const qc = useQueryClient();

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['tasks', 'mine'],
    queryFn: () => tasksApi.list(),
  });

  /**
   * Swipe right to complete, through the offline queue rather than a plain
   * mutation. A task ticked off on a site with no signal has to survive the trip
   * home — the optimistic update makes the row move immediately either way, and
   * the queue replays the PUT when the device reconnects.
   */
  const complete = useOfflineMutation<{ taskId: string }>({
    method: 'PUT',
    urlBuilder: ({ taskId }) => `/tasks/${taskId}`,
    bodyBuilder: () => ({ status: 'done' }),
    mutationFn: ({ taskId }) => tasksApi.update(taskId, { status: 'done' } as Partial<Task>),
    entity_type: 'task',
    entityId: ({ taskId }) => taskId,
    // Dedup key, so swiping the same row twice before the first call lands does
    // not enqueue two identical PUTs.
    optimisticId: ({ taskId }) => `task_${taskId}_complete`,
    snapshotKey: () => ['tasks', 'mine'],
    optimisticUpdate: ({ taskId }, client) => {
      client.setQueryData<Task[]>(['tasks', 'mine'], (prev: Task[] | undefined) =>
        (prev ?? []).map((task: Task) =>
          task.task_id === taskId ? { ...task, status: 'done' } as Task : task,
        ),
      );
    },
    rollback: (_vars, snapshot, client) => {
      if (snapshot) client.setQueryData(['tasks', 'mine'], snapshot);
    },
    onlineOptions: {
      onSettled: () => { void qc.invalidateQueries({ queryKey: ['tasks'] }); },
    },
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

  /**
   * Which of these rows has an unsent write against it.
   *
   * A swipe-to-complete on a train moves the row immediately — that is what the
   * optimistic update is for — and then the row looks exactly like one the
   * server has already accepted. §7.1: never lie about state. The amber clock
   * the reference draws at `Mobile.jsx:45` is the difference between "done" and
   * "done here, not yet there".
   *
   * `changes.count` drives the recompute rather than the set itself: MMKV pushes
   * the queue write, `useQueueStatus` turns it into a count, and the ids are
   * re-read whenever that count moves.
   */
  const { changes } = useQueueStatus();
  const queuedTaskIds = useMemo(() => queuedEntityIds('task'), [changes.count]);

  /**
   * THE PANE OPENS THE FIRST TASK RATHER THAN SITTING EMPTY.
   *
   * §3: "on Tasks it never appears, because the pane opens the first task. A
   * second pane that arrives empty is 750pt of nothing on an 11-inch iPad in
   * landscape. Selecting a task has no side effect, so there is no reason to
   * make the user do it."
   *
   * MESSAGES DELIBERATELY DOES NOT DO THIS, and the difference is the whole
   * rule: "opening a conversation marks it read, and a side effect the user did
   * not ask for is worse than a placeholder." Opening a task marks nothing.
   *
   * DERIVED rather than stored, so that changing segment — or the open task
   * leaving the filtered list, which a swipe-to-complete does immediately —
   * falls back to the first row instead of leaving the pane showing a task that
   * is no longer in front of the user.
   */
  const openId = (selected && tasks.some(x => x.task_id === selected))
    ? selected
    : tasks[0]?.task_id ?? null;

  /**
   * Below the split floor this is a navigation; above it, a selection. The list
   * does not know which — it calls this and the layout decides.
   *
   * Named `openTask` and not `open` because `open` is a global. Shadowing it
   * would work, but failing to shadow it resolves to `window.open` and does
   * something silently useless instead of failing.
   */
  const openTask = (taskId: string) => {
    if (split) setSelected(taskId);
    else nav.navigate('TaskDetail', { taskId });
  };

  const list = (
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
            <Refresher refreshing={isRefetching} onRefresh={refetch} />
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
          renderItem={({ item }) => {
            const card = (
              <TaskCard
                task={item}
                onPress={() => openTask(item.task_id)}
                selected={split && item.task_id === openId}
                syncing={queuedTaskIds.has(item.task_id)}
              />
            );
            // An already-done task has nothing to complete, so it gets no swipe
            // rather than a swipe that silently does nothing.
            if (isDone(item)) return card;
            return (
              <SwipeRow
                accessibilityLabel={item.title}
                right={{
                  label: 'Complete',
                  icon: 'checkmark',
                  color: t.success,
                  onColor: t.onPrimary,
                  onTrigger: () => complete.mutate({ taskId: item.task_id }),
                }}
              >
                {card}
              </SwipeRow>
            );
          }}
        />
      )}
    </View>
  );

  return (
    <PaneHost
      platform={platform}
      list={list}
      /*
       * `openId` is non-null whenever the list has a row, so EmptyPane is
       * reached only by an empty list — where "no task open" is honest and the
       * list beside it is already saying the same thing.
       */
      detail={openId
        ? <TaskDetailScreen taskId={openId} onClose={() => setSelected(null)} />
        : <EmptyPane
            icon="checkbox-outline"
            title="No task open"
            body="Pick a task on the left. It opens here instead of covering the list, so you keep your place in it."
          />}
    />
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 },
  title: { fontSize: 26, fontWeight: '700', letterSpacing: -0.4 },
  titleHi: { fontSize: 14, marginTop: 2, ...hindi() },
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
