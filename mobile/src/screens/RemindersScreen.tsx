import React, { useMemo, useState, useCallback } from 'react';
import {
  View, Text, SectionList, Pressable, StyleSheet,
  ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { hindi } from '../theme/fonts';
import { a11yButton, a11yToggle } from '../components/a11y';
import { useOnline } from '../hooks/useOnline';
import Sheet from '../components/Sheet';
import Refresher from '../components/Refresher';
import ScreenState, { resolveScreenState, StaleBar } from '../components/ScreenState';
import {
  tasksApi, REMINDER_OFFSETS, REMINDER_OFFSET_LABEL, REMINDER_CHANNEL_LABEL,
} from '../api/tasks';
import type { Task, TaskReminder, ReminderChannel } from '../api/types';
import { withAlpha } from '../theme/tokens';
import type { RootStackParamList } from '../nav/RootStack';

/**
 * Reminders — "snooze sheet, per-item toggles" (17-mobile-app.md §Screens).
 *
 * Endpoints:
 *   GET /api/tasks?assigned_to_me=true   the list
 *   GET /api/tasks/{id}                  the current reminder set for one task
 *   PUT /api/tasks/{id}/reminders        arm, change or clear them
 *
 * ── Why the sheet fetches, and the list does not ─────────────────────────────
 *
 * `GET /api/tasks` does not populate `reminders`. `TaskOut` defaults it to `[]`
 * and only the single-task path fills it in (server.py:2252), so an empty array
 * from the list means "not loaded" rather than "none set". Showing a bell as
 * off on that basis would be a lie on every row.
 *
 * So the list shows only what the list actually knows — due date, and whether
 * the legacy reminder has fired — and the sheet fetches the one task the user
 * opened. One request per interaction instead of one per row.
 *
 * ── Why writes go to `task_reminders` and not `reminder_at` ──────────────────
 *
 * `tasks.reminder_at` is real and does fire, via the poll endpoint. But nothing
 * ever resets `reminder_sent_at`, and the poll query requires it to be NULL —
 * so the legacy field fires exactly once per task, for all time. A snooze built
 * on it would appear to work and then silently never arrive, which is the worst
 * available outcome for a reminder. `PUT /tasks/{id}/reminders` writes rows
 * that are always re-armable and carry channels, so that is what this screen
 * uses for everything it changes.
 */

type Nav = NativeStackNavigationProp<RootStackParamList, 'Reminders'>;

/** The default set when someone arms reminders from scratch. */
const DEFAULT_OFFSETS = [1440, 120];
const DEFAULT_CHANNELS: ReminderChannel[] = ['in_app', 'push'];

const MS_DAY = 86_400_000;

interface Bucket { title: string; hi: string; data: Task[] }

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dueLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = startOfToday();
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - today) / MS_DAY);
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  if (diff === 0)  return `Today ${time}`;
  if (diff === 1)  return `Tomorrow ${time}`;
  if (diff === -1) return `Yesterday ${time}`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ` ${time}`;
}

export default function RemindersScreen() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const online = useOnline();

  const list = useQuery({
    queryKey: ['tasks', 'reminders'],
    // assigned_to_me is a real server filter (server.py:716). A reminders screen
    // showing the whole team's due dates would be a workload report, not a
    // to-do list — nobody snoozes someone else's reminder.
    queryFn:  () => tasksApi.list({ assigned_to_me: true }),
  });

  const [openTask, setOpenTask] = useState<Task | null>(null);

  // Annotated, not inferred: useQuery(...).data is `any` here — see api/modules.ts.
  const all: Task[] = list.data ?? [];

  const sections: Bucket[] = useMemo(() => {
    const today = startOfToday();
    const overdue: Task[] = [], todayT: Task[] = [], week: Task[] = [], later: Task[] = [];

    for (const task of all) {
      if (task.status === 'done' || !task.due_at) continue;
      const due = new Date(task.due_at);
      if (Number.isNaN(due.getTime())) continue;
      const day = new Date(due); day.setHours(0, 0, 0, 0);
      const diff = Math.round((day.getTime() - today) / MS_DAY);
      if (diff < 0)      overdue.push(task);
      else if (diff === 0) todayT.push(task);
      else if (diff <= 7)  week.push(task);
      else                 later.push(task);
    }

    const byDue = (a: Task, b: Task) =>
      new Date(a.due_at ?? 0).getTime() - new Date(b.due_at ?? 0).getTime();

    return [
      { title: 'OVERDUE',    hi: 'विलंबित', data: overdue.sort(byDue) },
      { title: 'TODAY',      hi: 'आज',      data: todayT.sort(byDue) },
      { title: 'THIS WEEK',  hi: 'इस सप्ताह', data: week.sort(byDue) },
      { title: 'LATER',      hi: 'बाद में',  data: later.sort(byDue) },
    ].filter(sec => sec.data.length > 0);
  }, [all]);

  const total = sections.reduce((a, sec) => a + sec.data.length, 0);

  const status = resolveScreenState({
    isLoading: list.isLoading,
    isError:   list.isError,
    error:     list.error,
    online,
    hasData:   list.data !== undefined,
    isEmpty:   list.data !== undefined && total === 0,
  });

  return (
    <View style={[s.root, { backgroundColor: t.bg, paddingTop: insets.top }]}>
      <View style={s.header}>
        <Pressable onPress={() => nav.goBack()} hitSlop={10} {...a11yButton('Back')}>
          <Ionicons name="chevron-back" size={24} color={t.ink2} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[s.title, { color: t.ink }]} accessibilityRole="header">Reminders</Text>
          <Text style={[s.titleHi, { color: t.primaryText }]}>स्मरण</Text>
        </View>
      </View>

      {status !== 'ready' && status !== 'empty' ? (
        <ScreenState status={status} onRetry={() => list.refetch()} />
      ) : status === 'empty' ? (
        <ScreenState
          status="empty"
          icon="alarm-outline"
          title="Nothing due"
          body="Tasks assigned to you with a due date show up here, so you can arm a reminder before it lands."
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={task => task.task_id}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={[s.listPad, { paddingBottom: insets.bottom + 40 }]}
          /* refreshControl removed — any RefreshControl blanks the whole list on
           this build. See components/Refresher.tsx. */
          ListHeaderComponent={
            list.data !== undefined && !online
              ? <View style={{ marginBottom: 8 }}>
                  <StaleBar label="Offline — this list is the last one downloaded, and a reminder cannot be changed until you reconnect." />
                </View>
              : null
          }
          renderSectionHeader={({ section }) => (
            <View style={s.sectionHead}>
              <Text style={[
                s.sectionLabel,
                { color: section.title === 'OVERDUE' ? t.error : t.ink3 },
              ]}>
                {section.title}
              </Text>
              <Text style={[s.sectionHi, { color: t.ink4 }]}>{section.hi}</Text>
              <Text style={[s.sectionCount, { color: t.ink4 }]}>{section.data.length}</Text>
            </View>
          )}
          renderItem={({ item, section }) => (
            <TaskRow
              task={item}
              overdue={section.title === 'OVERDUE'}
              onOpenTask={() => nav.navigate('TaskDetail', { taskId: item.task_id })}
              onEditReminder={() => setOpenTask(item)}
            />
          )}
        />
      )}

      <ReminderSheet
        task={openTask}
        online={online}
        onClose={() => setOpenTask(null)}
      />
    </View>
  );
}

// ── One task ────────────────────────────────────────────────────────────────

function TaskRow({ task, overdue, onOpenTask, onEditReminder }: {
  task: Task; overdue: boolean; onOpenTask: () => void; onEditReminder: () => void;
}) {
  const { t } = useTheme();

  // What the LIST can honestly say. `reminders` is not populated here, so the
  // only reminder fact available is whether the legacy one has already fired.
  const fired = !!task.reminder_sent_at;

  return (
    <View style={[
      s.row,
      { backgroundColor: t.surface, borderColor: t.outlineVar },
      overdue ? { borderLeftWidth: 3, borderLeftColor: t.error } : null,
    ]}>
      <Pressable style={s.rowMain} onPress={onOpenTask} {...a11yButton(task.title, 'Opens the task')}>
        <Text style={[s.rowTitle, { color: t.ink }]} numberOfLines={2}>{task.title}</Text>
        <View style={s.rowMeta}>
          <Ionicons
            name={overdue ? 'alert-circle-outline' : 'time-outline'}
            size={13}
            color={overdue ? t.error : t.ink3}
          />
          <Text style={[s.rowDue, { color: overdue ? t.error : t.ink3 }]}>
            {task.due_at ? dueLabel(task.due_at) : ''}
          </Text>
          {fired && (
            <Text style={[s.rowFired, { color: t.ink4 }]}>· already notified</Text>
          )}
        </View>
      </Pressable>

      <Pressable
        onPress={onEditReminder}
        hitSlop={8}
        {...a11yButton(`Reminders for ${task.title}`, 'Opens the reminder sheet')}
        style={({ pressed }) => [
          s.bell,
          { backgroundColor: pressed ? t.primaryContainer : 'transparent', borderColor: t.outlineVar },
        ]}
      >
        <Ionicons name="notifications-outline" size={18} color={t.primaryText} />
      </Pressable>
    </View>
  );
}

// ── The sheet ───────────────────────────────────────────────────────────────

function ReminderSheet({ task, online, onClose }: {
  task: Task | null; online: boolean; onClose: () => void;
}) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [saving, setSaving] = useState(false);
  const [draftOffsets,  setDraftOffsets]  = useState<number[] | null>(null);
  const [draftChannels, setDraftChannels] = useState<ReminderChannel[] | null>(null);

  // The one place the real set is available. Only runs while the sheet is open.
  const detail = useQuery({
    queryKey: ['task', task?.task_id, 'reminders'],
    queryFn:  () => tasksApi.get(task!.task_id),
    enabled:  !!task,
  });

  const loaded: Task | undefined = detail.data;

  // Server state, folded into a shape the toggles can use. `sent_at` rows are
  // history, not configuration — replacing the set leaves them alone, so they
  // must not show as armed.
  const serverReminders: TaskReminder[] = (loaded?.reminders ?? []).filter(r => !r.sent_at);

  const offsets: number[] = draftOffsets ?? serverReminders.map(r => r.offset_minutes);
  const channels: ReminderChannel[] =
    draftChannels
    ?? (serverReminders[0]?.channels?.length ? serverReminders[0].channels : DEFAULT_CHANNELS);

  const dirty = draftOffsets !== null || draftChannels !== null;

  const reset = useCallback(() => {
    setDraftOffsets(null);
    setDraftChannels(null);
  }, []);

  const close = useCallback(() => { reset(); onClose(); }, [reset, onClose]);

  const toggleOffset = (m: number) => {
    const next = offsets.includes(m) ? offsets.filter(x => x !== m) : [...offsets, m];
    setDraftOffsets(next);
    if (draftChannels === null) setDraftChannels(channels);
  };

  const toggleChannel = (c: ReminderChannel) => {
    const next = channels.includes(c) ? channels.filter(x => x !== c) : [...channels, c];
    // The server coerces an empty channel list to ["in_app"] rather than
    // rejecting it, so an all-off state would silently come back as in-app.
    // Refusing the last one here keeps the UI and the stored row in agreement.
    if (next.length === 0) return;
    setDraftChannels(next);
    if (draftOffsets === null) setDraftOffsets(offsets);
  };

  const save = async () => {
    if (!task || saving) return;
    if (!online) {
      Alert.alert(
        'You are offline',
        'Reminder changes are not queued — a reminder armed now and sent hours later is worse than one that was never armed. Try again once you reconnect.',
      );
      return;
    }
    if (!task.due_at && offsets.length > 0) {
      // The server returns 400 for exactly this. Saying so before the round trip
      // is more useful than relaying the error afterwards.
      Alert.alert(
        'This task has no due date',
        'Reminders fire a set time before the due date, so there is nothing to count back from. Add a due date on the task first.',
      );
      return;
    }
    setSaving(true);
    try {
      await tasksApi.setReminders(
        task.task_id,
        offsets.map(offset_minutes => ({ offset_minutes, channels })),
      );
      qc.invalidateQueries({ queryKey: ['task', task.task_id] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      close();
    } catch (e: unknown) {
      const err = e as { friendlyMessage?: string };
      Alert.alert('Could not save', err?.friendlyMessage ?? 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  const armAll = () => {
    setDraftOffsets(DEFAULT_OFFSETS);
    setDraftChannels(channels.length ? channels : DEFAULT_CHANNELS);
  };

  return (
    <Sheet
      visible={!!task}
      // Android hardware back must dismiss every sheet — 17 §platform table.
      onClose={close}
      closeLabel="Dismiss"
      panelStyle={[
        s.sheet,
        { backgroundColor: t.surface, borderColor: t.outlineVar, paddingBottom: insets.bottom + 20 },
      ]}
    >
          <View style={[s.grab, { backgroundColor: t.outline }]} />

          <Text style={[s.sheetTitle, { color: t.ink }]} numberOfLines={2}>
            {task?.title ?? ''}
          </Text>
          <Text style={[s.sheetSub, { color: t.ink3 }]}>
            {task?.due_at ? `Due ${dueLabel(task.due_at)}` : 'No due date set'}
          </Text>

          {detail.isLoading ? (
            <View style={s.sheetLoading}><ActivityIndicator color={t.primary} /></View>
          ) : detail.isError ? (
            <View style={s.sheetLoading}>
              <Text style={[s.sheetSub, { color: t.error }]}>
                {online
                  ? "Couldn't load this task's reminders."
                  : 'Offline — reminders can only be changed with a connection.'}
              </Text>
            </View>
          ) : (
            <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ gap: 4 }}>
              <View style={s.sheetHead}>
                <Text style={[s.sheetLabel, { color: t.ink3 }]}>REMIND ME</Text>
                {offsets.length === 0 && (
                  <Pressable onPress={armAll} hitSlop={6} {...a11yButton('Use the usual reminders')}>
                    <Text style={[s.sheetAction, { color: t.primaryText }]}>Use the usual</Text>
                  </Pressable>
                )}
              </View>

              {REMINDER_OFFSETS.map(m => {
                const on = offsets.includes(m);
                return (
                  <Pressable
                    key={m}
                    onPress={() => toggleOffset(m)}
                    {...a11yToggle(REMINDER_OFFSET_LABEL[m], on)}
                    style={({ pressed }) => [
                      s.optRow,
                      {
                        backgroundColor: pressed ? t.surface2 : 'transparent',
                        borderColor: on ? t.primary : t.outlineVar,
                      },
                    ]}
                  >
                    <Ionicons
                      name={on ? 'checkbox' : 'square-outline'}
                      size={19}
                      color={on ? t.primary : t.ink4}
                    />
                    <Text style={[s.optText, { color: on ? t.ink : t.ink2 }]}>
                      {REMINDER_OFFSET_LABEL[m]}
                    </Text>
                  </Pressable>
                );
              })}

              <Text style={[s.sheetLabel, { color: t.ink3, marginTop: 14 }]}>HOW</Text>
              <View style={s.chanRow}>
                {(Object.keys(REMINDER_CHANNEL_LABEL) as ReminderChannel[]).map(c => {
                  const on = channels.includes(c);
                  return (
                    <Pressable
                      key={c}
                      onPress={() => toggleChannel(c)}
                      {...a11yToggle(REMINDER_CHANNEL_LABEL[c], on)}
                      style={[
                        s.chan,
                        {
                          backgroundColor: on ? withAlpha(t.primary, 0.14) : 'transparent',
                          borderColor: on ? t.primary : t.outlineVar,
                        },
                      ]}
                    >
                      <Text style={[s.chanText, { color: on ? t.primaryText : t.ink3 }]}>
                        {REMINDER_CHANNEL_LABEL[c]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[s.note, { color: t.ink4 }]}>
                {offsets.length === 0
                  ? 'No reminders. Saving now clears any that were set.'
                  : `${offsets.length} reminder${offsets.length === 1 ? '' : 's'}, each sent by ${channels.map(c => REMINDER_CHANNEL_LABEL[c].toLowerCase()).join(' and ')}.`}
              </Text>
            </ScrollView>
          )}

          <View style={s.sheetActions}>
            <Pressable onPress={close} {...a11yButton('Cancel')} style={[s.btn, { borderColor: t.outline }]}>
              <Text style={[s.btnText, { color: t.ink2 }]}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={save}
              disabled={saving || !dirty || detail.isLoading || detail.isError}
              {...a11yButton('Save reminders')}
              style={[
                s.btn,
                {
                  backgroundColor: dirty && !saving ? t.primary : t.surface2,
                  borderColor:     dirty && !saving ? t.primary : t.outline,
                },
              ]}
            >
              {saving
                ? <ActivityIndicator size="small" color={t.onPrimary} />
                : <Text style={[s.btnText, { color: dirty ? t.onPrimary : t.inkDisabled }]}>Save</Text>}
            </Pressable>
          </View>
    </Sheet>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: 6, paddingBottom: 10 },
  title: { fontSize: 24, fontWeight: '700', letterSpacing: -0.4 },
  titleHi: { fontSize: 13, marginTop: 1, ...hindi() },

  listPad: { paddingHorizontal: 16, gap: 8 },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 16, marginBottom: 2 },
  sectionLabel: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.3 },
  sectionHi: { fontSize: 11.5, ...hindi() },
  sectionCount: { marginLeft: 'auto', fontSize: 11.5, fontWeight: '700' },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderRadius: 12, padding: 12,
  },
  rowMain:  { flex: 1, minWidth: 0, gap: 4 },
  rowTitle: { fontSize: 14, fontWeight: '600', lineHeight: 19 },
  rowMeta:  { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  rowDue:   { fontSize: 11.5, fontWeight: '700' },
  rowFired: { fontSize: 11 },
  bell: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },

  // modalRoot and scrim removed — Sheet owns both, and fades the scrim.
  sheet: {
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderWidth: 1, borderBottomWidth: 0, padding: 18, gap: 6,
  },
  grab: { width: 38, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 8 },
  sheetTitle: { fontSize: 17, fontWeight: '700', lineHeight: 23 },
  sheetSub:   { fontSize: 12.5, lineHeight: 18 },
  sheetLoading: { paddingVertical: 30, alignItems: 'center' },
  sheetHead:  { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  sheetLabel: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.3, marginBottom: 6 },
  sheetAction: { marginLeft: 'auto', fontSize: 12, fontWeight: '800' },

  optRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
  },
  optText: { fontSize: 13.5, fontWeight: '600' },

  chanRow: { flexDirection: 'row', gap: 8 },
  chan: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 9, alignItems: 'center' },
  chanText: { fontSize: 12.5, fontWeight: '800' },

  note: { fontSize: 11.5, lineHeight: 16.5, marginTop: 10 },

  sheetActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btn: {
    flex: 1, borderWidth: 1, borderRadius: 10,
    paddingVertical: 11, alignItems: 'center', justifyContent: 'center',
  },
  btnText: { fontSize: 13.5, fontWeight: '800' },
});
