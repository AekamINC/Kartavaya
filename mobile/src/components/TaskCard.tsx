import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format, isToday, isPast, isTomorrow } from 'date-fns';
import { useTheme } from '../theme/ThemeProvider';
// PRIORITY_COLOR was imported here but never indexed — TaskCard derives its due
// chip from the theme directly. Dropping it leaves the deprecated light-only map
// with no consumers at all.
import { projectColor, AVATAR_COLORS } from '../theme/tokens';
import { FAMILY } from '../theme/fonts';
import { a11yButton } from './a11y';
import type { Task } from '../api/types';

export interface TaskCardProps {
  task:         Task;
  onPress:      () => void;
  showProject?: boolean;
  syncing?:     boolean;
  /**
   * This row is the one open in the detail pane beside the list.
   *
   * Only ever true in a two-pane layout. On a phone the detail COVERS the list,
   * so there is nothing to indicate — but beside it, a list with no marked row
   * leaves the user unable to tell which of twenty cards produced the pane they
   * are reading. 31-tablet.md §3 assumes this without naming it: "Beside the
   * list it stops being a modal, and you keep your place in it" is only true if
   * your place is visible.
   */
  selected?:    boolean;
}

function dueDateLabel(due: string): { label: string; danger: boolean; warn: boolean } {
  const d = new Date(due);
  if (isPast(d) && !isToday(d)) return { label: format(d, 'd MMM'), danger: true,  warn: false };
  if (isToday(d))               return { label: 'Today',             danger: false, warn: true  };
  if (isTomorrow(d))            return { label: 'Tomorrow',          danger: false, warn: false };
  return { label: format(d, 'd MMM'), danger: false, warn: false };
}

const IS_ANDROID = Platform.OS === 'android';

function TaskCardInner({ task, onPress, showProject = true, syncing = false, selected = false }: TaskCardProps) {
  const { t } = useTheme();
  const pColor = projectColor(task.team_id);
  const done   = (task.subtasks ?? []).filter(s => s.is_done).length;
  const total  = (task.subtasks ?? []).length;
  const due    = task.due_at ? dueDateLabel(task.due_at) : null;

  // A finished task has no deadline pressure left. 17-mobile-app.md: "a completed
  // task shouldn't render an alarming red due chip" — the date is still worth
  // showing as a record of when it was due, but urgency is over, so it drops to
  // the neutral chip regardless of how overdue it was.
  const isComplete = String(task.status ?? '').toLowerCase() === 'done'
    || String(task.status ?? '').toLowerCase() === 'completed';

  // Due chip colours — Android M3 containers vs iOS flat fills.
  // The iOS literals are Apple's system red and orange, kept on purpose: on iOS
  // a due chip reads as a system affordance, and matching the platform is the
  // point. They are the one deliberate exception to tokens-only in this file.
  let dueChipBg   = IS_ANDROID ? t.surface2 : t.surfaceLow;
  let dueChipText = IS_ANDROID ? t.ink      : t.ink2;
  if (isComplete) {
    // Neutral, and deliberately first so no later branch can re-redden it.
  } else if (due?.danger) {
    dueChipBg   = IS_ANDROID ? t.errorBg  : 'rgba(255,69,58,0.12)';
    dueChipText = IS_ANDROID ? t.error    : '#FF453A';
  } else if (due?.warn || task.priority === 'high') {
    dueChipBg   = IS_ANDROID ? t.tertiaryContainer : 'rgba(255,159,10,0.14)';
    dueChipText = IS_ANDROID ? t.onTertiaryContainer : '#FF9F0A';
  } else if (due && task.priority === 'urgent') {
    dueChipBg   = IS_ANDROID ? t.errorBg : 'rgba(255,69,58,0.12)';
    dueChipText = IS_ANDROID ? t.error   : '#FF453A';
  }

  return (
    <TouchableOpacity
      style={[
        s.card,
        IS_ANDROID
          ? { backgroundColor: t.surfaceLow, borderRadius: 24 }
          : { backgroundColor: t.surface,    borderRadius: 16,
              shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
        // MOTION-SPEC §7.1, verbatim: "Optimistic UI renders at opacity .6 until
        // acknowledged, then goes solid." The reference does the same for an
        // unsent message (`.cd__m.sending`) and an in-flight upload
        // (`.fcard.up`). A swipe-completed row on a train was rendering
        // identically to one the server had accepted, which is the lie that rule
        // exists to prevent. Not animated — it is a STATE, and a card that
        // pulsed while queued would be a loop nobody asked for.
        syncing && { opacity: 0.6 },
        // The selected row, in a two-pane layout only. A BORDER rather than a
        // fill: the card already carries a surface colour that means "card", and
        // a second fill on top of it reads as a different KIND of row rather
        // than the same row in a different state.
        selected && { borderWidth: 1.5, borderColor: t.primary },
      ]}
      onPress={onPress}
      activeOpacity={0.75}
      {...a11yButton(
        task.title,
        syncing ? 'Waiting to sync. Opens task detail' : 'Opens task detail',
      )}
    >
      {/* Top row: project + task ID + sync */}
      <View style={s.topRow}>
        <View style={[s.projDot, { backgroundColor: pColor, borderRadius: 3 }]} />
        <Text style={[s.projectLabel, { color: t.ink2 }]} numberOfLines={1}>
          {task.team_name ?? '—'}
        </Text>
        <Text style={[s.taskId, { color: t.ink3 }]}>{task.task_id.slice(0, 8)}</Text>
        {/* `Mobile.jsx:45` draws the same marker in the same corner. The card
            already carries the state in its accessibilityHint, so the glyph is
            hidden from the reader rather than announced a second time as an
            unlabelled image. */}
        {syncing && (
          <Ionicons
            name="sync-outline"
            size={13}
            color="#f59e0b"
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        )}
      </View>

      {/* Title */}
      <Text style={[s.title, { color: t.ink }]} numberOfLines={2}>{task.title}</Text>

      {/* Subtask progress */}
      {total > 0 && (
        <View style={s.progressRow}>
          <View style={[s.progressTrack, { backgroundColor: t.surface2 }]}>
            <View style={[s.progressBar, {
              width: `${(done / total) * 100}%` as any,
              backgroundColor: done === total ? '#05b7aa' : t.primary,
            }]} />
          </View>
          <Text style={[s.progressText, { color: t.ink3 }]}>{done}/{total}</Text>
        </View>
      )}

      {/* Footer chips */}
      <View style={s.footer}>
        {due && (
          <View style={[s.chip, { backgroundColor: dueChipBg }]}>
            <Ionicons name="time-outline" size={11} color={dueChipText} />
            <Text style={[s.chipText, { color: dueChipText }]}>{due.label}</Text>
          </View>
        )}

        {task.approval_status && task.approval_status !== 'approved' && (
          <View style={[s.chip, { backgroundColor: IS_ANDROID ? t.tertiaryContainer : 'rgba(255,159,10,0.14)' }]}>
            <Text style={[s.chipText, { color: IS_ANDROID ? t.onTertiaryContainer : '#B06A00' }]}>APPROVAL</Text>
          </View>
        )}

        {(task as any).has_mention && (
          <View style={[s.chip, {
            backgroundColor: IS_ANDROID ? t.secondaryContainer : 'rgba(4,131,122,0.14)',
            paddingHorizontal: IS_ANDROID ? 8 : 5,
          }]}>
            <Ionicons name="at" size={12} color={IS_ANDROID ? t.onSecondaryContainer : '#0066A3'} />
            {IS_ANDROID && (
              <Text style={[s.chipText, { color: t.onSecondaryContainer }]}>Mention</Text>
            )}
          </View>
        )}

        <View style={{ flex: 1 }} />

        {/* Avatar stack */}
        {(task.assignee_user_ids ?? []).length > 0 && (
          <View style={s.avatarStack}>
            {(task.assignee_user_ids ?? []).slice(0, 3).map((uid, i) => (
              <View key={uid} style={[
                s.avatar,
                { marginLeft: i === 0 ? 0 : -7,
                  backgroundColor: AVATAR_COLORS[Math.abs(uid.charCodeAt(0)) % AVATAR_COLORS.length],
                  borderColor: IS_ANDROID ? t.surfaceLow : t.surface },
              ]}>
                <Text style={s.avatarText}>{uid.charAt(0).toUpperCase()}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}


function areEqual(prev: TaskCardProps, next: TaskCardProps): boolean {
  const p = prev.task; const n = next.task;
  return (
    p.task_id          === n.task_id          &&
    p.title            === n.title            &&
    p.status           === n.status           &&
    p.priority         === n.priority         &&
    p.due_at           === n.due_at           &&
    p.approval_status  === n.approval_status  &&
    p.subtasks?.length === n.subtasks?.length &&
    (p.subtasks ?? []).filter(s => s.is_done).length ===
    (n.subtasks ?? []).filter(s => s.is_done).length &&
    prev.showProject   === next.showProject   &&
    prev.syncing       === next.syncing        &&
    // Without this the memo swallows every selection change and the highlight
    // never moves — the list would look frozen on whichever row was open first.
    prev.selected      === next.selected
  );
}

export const TaskCard = React.memo(TaskCardInner, areEqual);

const s = StyleSheet.create({
  card: {
    padding: IS_ANDROID ? 14 : 12,
    paddingHorizontal: IS_ANDROID ? 16 : 14,
    marginBottom: IS_ANDROID ? 10 : 8,
    gap: 8,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 2,
  },
  projDot: {
    width: IS_ANDROID ? 10 : 8,
    height: IS_ANDROID ? 10 : 8,
    flexShrink: 0,
  },
  projectLabel: {
    flex: 1,
    fontSize: IS_ANDROID ? 12.5 : 12,
    fontWeight: '500',
    letterSpacing: -0.1,
  },
  taskId: {
    fontSize: IS_ANDROID ? 11 : 10.5,
    fontFamily: FAMILY.mono,
  },
  title: {
    fontSize: IS_ANDROID ? 15.5 : 15,
    fontWeight: '500',
    lineHeight: IS_ANDROID ? 21 : 20,
    letterSpacing: IS_ANDROID ? 0 : -0.2,
    marginBottom: IS_ANDROID ? 4 : 2,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  progressTrack: {
    flex: 1,
    height: IS_ANDROID ? 4 : 3,
    borderRadius: 99,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%' as any,
    borderRadius: 99,
  },
  progressText: {
    fontSize: 10,
    fontWeight: '600',
    minWidth: 28,
    textAlign: 'right',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: IS_ANDROID ? 4 : 3,
    borderRadius: 99,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  avatarStack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: IS_ANDROID ? 24 : 22,
    height: IS_ANDROID ? 24 : 22,
    borderRadius: 99,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  avatarText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '700',
  },
});
