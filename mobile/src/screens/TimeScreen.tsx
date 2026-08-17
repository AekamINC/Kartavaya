import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { hindi } from '../theme/fonts';
import { a11yButton } from '../components/a11y';
import Refresher from '../components/Refresher';
import PulseDot from '../components/PulseDot';
import { getRunningTimer, clearRunningTimer, type RunningTimer } from '../lib/runningTimer';
import { timeApi, type TimeEntry } from '../api/time';
import { withAlpha } from '../theme/tokens';
import type { RootStackParamList } from '../nav/RootStack';

/**
 * Time — live timer, entries, weekly bars (17-mobile-app.md).
 *
 * ── Why the running timer is held locally ─────────────────────────────────────
 *
 * There is no endpoint that returns the caller's running timer.
 * `time_entries.py` queries `ended_at IS NULL` only inside `/start` and `/stop`;
 * `/report` explicitly filters running entries OUT. So the app cannot ask the
 * server what is running.
 *
 * Rather than invent a timer that silently disagrees with the server, the screen
 * remembers the one IT started, in MMKV so it survives a cold start, and says
 * plainly that a timer started on the web will not appear here. Stopping still
 * works either way, because `/stop` closes whatever is open for that user
 * server-side — so the honest local state can never strand a real timer.
 *
 * The elapsed figure is derived from the stored `started_at` on every tick, not
 * accumulated in a counter. A counter drifts whenever the JS thread is busy or
 * the app is backgrounded, and a timer that loses minutes while the phone is in
 * a pocket is a timer that under-bills.
 */

type Nav = NativeStackNavigationProp<RootStackParamList, 'Time'>;

/** "2h 14m", or "0m" — never a bare minute count, which reads as a task id. */
function fmtMinutes(mins: number): string {
  const m = Math.max(0, Math.round(mins));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

/** Live elapsed, as h:mm:ss. Seconds matter only while something is running. */
function fmtElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Monday-based week index, matching how Indian firms report a working week. */
function weekdayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export default function TimeScreen() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const qc = useQueryClient();

  const [running, setRunning] = useState<RunningTimer | null>(() => getRunningTimer());
  const [now, setNow] = useState(() => Date.now());
  const [stopping, setStopping] = useState(false);

  /**
   * Re-read on focus. A timer started from TaskDetail is written to MMKV by that
   * screen, and this one is often already mounted behind it — without this the
   * card would stay on "no timer running" until a remount.
   */
  useFocusEffect(
    useCallback(() => {
      setRunning(getRunningTimer());
      setNow(Date.now());
    }, []),
  );

  // One interval, only while something is running.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['time', 'report'],
    queryFn: () => timeApi.report(),
  });

  const entries = data?.entries ?? [];

  /**
   * This week's totals, bucketed by weekday.
   *
   * Bucketed on `started_at` rather than `ended_at`: a session that runs past
   * midnight belongs to the day the work started, which is how a person
   * remembers it and how a timesheet reads.
   */
  const week = useMemo(() => {
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - weekdayIndex(today));
    monday.setHours(0, 0, 0, 0);

    const buckets = new Array(7).fill(0) as number[];
    for (const e of entries) {
      const started = new Date(e.started_at);
      if (Number.isNaN(started.getTime()) || started < monday) continue;
      const idx = weekdayIndex(started);
      buckets[idx] += e.minutes ?? 0;
    }
    const peak = Math.max(...buckets, 1);
    return { buckets, peak, total: buckets.reduce((a, b) => a + b, 0), todayIdx: weekdayIndex(today) };
  }, [entries]);

  const stop = useCallback(async () => {
    if (!running || stopping) return;
    setStopping(true);
    try {
      const res = await timeApi.stop();
      clearRunningTimer();
      setRunning(null);
      qc.invalidateQueries({ queryKey: ['time'] });
      Alert.alert('Timer stopped', `${fmtMinutes(res.minutes)} logged.`);
    } catch (e: unknown) {
      // A 404 means the server has no open entry — the local record is stale, so
      // clearing it is the correct repair rather than leaving a ghost running.
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 404) {
        clearRunningTimer();
        setRunning(null);
        qc.invalidateQueries({ queryKey: ['time'] });
        Alert.alert('No timer running', 'That timer had already been stopped elsewhere.');
      } else {
        Alert.alert('Could not stop', e instanceof Error ? e.message : 'Try again.');
      }
    } finally {
      setStopping(false);
    }
  }, [running, stopping, qc]);

  const renderEntry = ({ item }: { item: TimeEntry }) => {
    const started = new Date(item.started_at);
    const when = Number.isNaN(started.getTime())
      ? ''
      : started.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    return (
      <Pressable
        onPress={() => nav.navigate('TaskDetail', { taskId: item.task_id })}
        accessibilityRole="button"
        accessibilityLabel={`${item.task_title ?? 'Task'}, ${fmtMinutes(item.minutes ?? 0)} on ${when}`}
        style={({ pressed }) => [
          s.entry,
          { backgroundColor: pressed ? t.surface2 : t.surface, borderColor: t.outlineVar },
        ]}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[s.entryTitle, { color: t.ink }]} numberOfLines={1}>
            {item.task_title ?? 'Untitled task'}
          </Text>
          <Text style={[s.entryMeta, { color: t.ink3 }]} numberOfLines={1}>
            {when}
            {item.description ? ` · ${item.description}` : ''}
          </Text>
        </View>
        <Text style={[s.entryMins, { color: t.primaryText }]}>{fmtMinutes(item.minutes ?? 0)}</Text>
      </Pressable>
    );
  };

  const header = (
    <>
      {/* ── Running timer ── */}
      {running ? (
        <View style={[s.timerCard, { backgroundColor: t.primaryContainer, borderColor: t.primary }]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={s.timerLabelRow}>
              {/* MOTION-SPEC §4's timer dot, which this card did not have. A
                  ticking elapsed figure and a frozen one look the same in the
                  hand; the pulse is what says the number is still moving. */}
              <PulseDot color={t.primary} size={9} label="Timer running" />
              <Text style={[s.timerLabel, { color: t.onPrimaryContainer }]}>RUNNING</Text>
            </View>
            <Text style={[s.timerTask, { color: t.onPrimaryContainer }]} numberOfLines={1}>
              {running.task_title}
            </Text>
            <Text style={[s.timerElapsed, { color: t.onPrimaryContainer }]}>
              {fmtElapsed(now - new Date(running.started_at).getTime())}
            </Text>
          </View>
          <Pressable
            onPress={stop}
            disabled={stopping}
            {...a11yButton('Stop timer')}
            style={[s.stopBtn, { backgroundColor: t.error }]}
          >
            {stopping
              ? <ActivityIndicator size="small" color={t.onError} />
              : <Ionicons name="stop" size={18} color={t.onError} />}
          </Pressable>
        </View>
      ) : (
        <View style={[s.idleCard, { backgroundColor: t.surface, borderColor: t.outlineVar }]}>
          <Ionicons name="timer-outline" size={18} color={t.ink3} />
          <Text style={[s.idleText, { color: t.ink3 }]}>
            No timer running. Start one from a task.
          </Text>
        </View>
      )}

      {/* ── Weekly bars ── */}
      <View style={s.sectionHead}>
        <Text style={[s.sectionLabel, { color: t.ink3 }]}>THIS WEEK</Text>
        <Text style={[s.sectionHi, { color: t.ink4 }]}>इस सप्ताह</Text>
        <Text style={[s.sectionTotal, { color: t.primaryText }]}>{fmtMinutes(week.total)}</Text>
      </View>

      <View
        style={[s.bars, { backgroundColor: t.surface, borderColor: t.outlineVar }]}
        accessibilityLabel={`This week, ${fmtMinutes(week.total)} logged`}
      >
        {week.buckets.map((mins, i) => (
          <View key={i} style={s.barCol}>
            <View style={s.barTrack}>
              <View
                style={[
                  s.barFill,
                  {
                    height: `${Math.round((mins / week.peak) * 100)}%`,
                    backgroundColor: i === week.todayIdx ? t.primary : withAlpha(t.primary, 0.4),
                  },
                ]}
              />
            </View>
            <Text style={[s.barDay, { color: i === week.todayIdx ? t.primaryText : t.ink4 }]}>
              {DAY_LABELS[i]}
            </Text>
          </View>
        ))}
      </View>

      <View style={s.sectionHead}>
        <Text style={[s.sectionLabel, { color: t.ink3 }]}>ENTRIES</Text>
        <Text style={[s.sectionHi, { color: t.ink4 }]}>प्रविष्टियाँ</Text>
      </View>
    </>
  );

  return (
    <View style={[s.root, { backgroundColor: t.bg, paddingTop: insets.top }]}>
      <View style={s.header}>
        <Pressable onPress={() => nav.goBack()} hitSlop={10} {...a11yButton('Back')}>
          <Ionicons name="chevron-back" size={24} color={t.ink2} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[s.title, { color: t.ink }]}>Time</Text>
          <Text style={[s.titleHi, { color: t.primaryText }]}>काल</Text>
        </View>
      </View>

      {isLoading ? (
        <View style={s.centre}><ActivityIndicator color={t.primary} /></View>
      ) : isError ? (
        <View style={[s.centre, { paddingHorizontal: 32 }]}>
          <Ionicons name="cloud-offline-outline" size={30} color={t.ink3} />
          <Text style={[s.emptyTitle, { color: t.ink }]}>Couldn't load time</Text>
          <Text style={[s.emptyBody, { color: t.ink3 }]}>Pull down to retry.</Text>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={e => e.entry_id}
          renderItem={renderEntry}
          ListHeaderComponent={header}
          contentContainerStyle={s.listPad}
          refreshControl={<Refresher refreshing={isRefetching} onRefresh={refetch} />}
          ListEmptyComponent={
            <View style={[s.centre, { paddingVertical: 40 }]}>
              <Ionicons name="time-outline" size={28} color={t.ink3} />
              <Text style={[s.emptyTitle, { color: t.ink }]}>No time logged yet</Text>
              <Text style={[s.emptyBody, { color: t.ink3 }]}>
                Start a timer on a task and it shows up here.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },

  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: 6, paddingBottom: 10 },
  title: { fontSize: 24, fontWeight: '700', letterSpacing: -0.4 },
  titleHi: { fontSize: 13, marginTop: 1, ...hindi() },

  listPad: { paddingHorizontal: 16, paddingBottom: 40, gap: 8 },

  timerCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 4,
  },
  timerLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  timerLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  timerTask: { fontSize: 14.5, fontWeight: '700', marginTop: 3 },
  timerElapsed: { fontSize: 26, fontWeight: '800', marginTop: 4, fontVariant: ['tabular-nums'] },
  stopBtn: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },

  idleCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 4,
  },
  idleText: { flex: 1, fontSize: 13, lineHeight: 18 },

  sectionHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 20, marginBottom: 8 },
  sectionLabel: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.3 },
  sectionHi: { fontSize: 11.5, ...hindi() },
  sectionTotal: { marginLeft: 'auto', fontSize: 13, fontWeight: '800' },

  bars: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    borderWidth: 1, borderRadius: 12, padding: 12, height: 132,
  },
  barCol: { flex: 1, alignItems: 'center', gap: 6, height: '100%' },
  barTrack: { flex: 1, width: 14, justifyContent: 'flex-end' },
  barFill: { width: 14, borderRadius: 4, minHeight: 3 },
  barDay: { fontSize: 10.5, fontWeight: '700' },

  entry: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderRadius: 12, padding: 12,
  },
  entryTitle: { fontSize: 14, fontWeight: '600' },
  entryMeta: { fontSize: 11.5, marginTop: 2 },
  entryMins: { fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },

  emptyTitle: { fontSize: 15, fontWeight: '700', marginTop: 4 },
  emptyBody: { fontSize: 13, textAlign: 'center', lineHeight: 19 },
});
