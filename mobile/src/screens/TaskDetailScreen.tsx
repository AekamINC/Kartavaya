/**
 * TaskDetailScreen — orchestrator
 * All state, mutations, and data-fetching live here.
 * UI atoms are in ./taskdetail/
 */
import React, { useState, useRef, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, KeyboardAvoidingView,
  Platform, Linking, Keyboard, StyleSheet,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import AttachmentSourceSheet, { type PickedFile } from '../components/AttachmentSourceSheet';
import { format, isToday, isPast } from 'date-fns';
import { useTheme } from '../theme/ThemeProvider';
import { useAuth } from '../hooks/useAuth';
import { tasksApi } from '../api/tasks';
import { projectsApi } from '../api/projects';
import { timeApi } from '../api/time';
import { getRunningTimer, setRunningTimer, clearRunningTimer } from '../lib/runningTimer';
import { PRIORITY_COLORS, BRAND_GRADIENT_2, withAlpha } from '../theme/tokens';
import type { Task, Comment, TeamMember, Priority, Subtask, Attachment } from '../api/types';
import type { RootStackParamList } from '../nav/RootStack';

import { s } from './taskdetail/styles';
import { SafeHeader }           from './taskdetail/SafeHeader';
import { Divider }              from './taskdetail/Divider';
import { Section }              from './taskdetail/Section';
import { SubtaskRow }           from './taskdetail/SubtaskRow';
import { CommentRow }           from './taskdetail/CommentRow';
import { ApprovalBanner }       from './taskdetail/ApprovalBanner';
import { ApprovalModal }        from './taskdetail/ApprovalModal';
import { AssigneePickerModal }  from './taskdetail/AssigneePickerModal';
import { MoveModal }            from './taskdetail/MoveModal';
import { Avatar }               from './taskdetail/Avatar';

type Route = RouteProp<RootStackParamList, 'TaskDetail'>;
type Nav   = NativeStackNavigationProp<RootStackParamList, 'TaskDetail'>;

// ── helpers ────────────────────────────────────────────────────────────────────
function memberId(m: TeamMember): string { return (m.user_id ?? m.member_id) ?? ''; }
function memberName(m: TeamMember): string { return m.display_name ?? m.full_name ?? m.name ?? m.email; }
function userName(u: { name?: string; full_name?: string; email?: string }): string {
  return u.name ?? u.full_name ?? u.email ?? '?';
}

/** Clients cannot log time — `/time/start` 403s for them, so the section is hidden. */
function isClientRole(role?: string | null): boolean { return role === 'client'; }

/** "2h 14m". Never a bare minute count, which reads as an id. */
function fmtMinutes(mins: number): string {
  const m = Math.max(0, Math.round(mins));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

const PRI_ICONS: Record<Priority, string> = {
  urgent: 'flame',
  high:   'arrow-up-circle',
  medium: 'remove-circle-outline',
  low:    'arrow-down-circle-outline',
};

// ═══════════════════════════════════════════════════════════════════════════════
export default function TaskDetailScreen() {
  const { t, scheme } = useTheme();
  const { user } = useAuth();
  const route    = useRoute<Route>();
  const nav      = useNavigation<Nav>();
  const qc       = useQueryClient();
  const { taskId } = route.params;

  // ── Data ────────────────────────────────────────────────────────────────────
  const { data: task, isLoading, isError } = useQuery<Task>({
    queryKey: ['task', taskId],
    queryFn:  () => tasksApi.get(taskId),
  });

  const { data: comments = [], refetch: refetchComments } = useQuery<Comment[]>({
    queryKey: ['comments', taskId],
    queryFn:  () => tasksApi.getComments(taskId),
    enabled:  !!task,
  });

  const { data: members = [] } = useQuery<TeamMember[]>({
    queryKey: ['members', task?.team_id ?? ''],
    queryFn:  () => projectsApi.members(task!.team_id),
    enabled:  !!task?.team_id,
  });

  const { data: columns = [] } = useQuery({
    queryKey: ['columns', task?.team_id ?? ''],
    queryFn:  () => projectsApi.columns(task!.team_id),
    enabled:  !!task?.team_id,
  });

  // ── Local UI state ───────────────────────────────────────────────────────────
  const [editingTitle,   setEditingTitle]   = useState(false);
  const [titleDraft,     setTitleDraft]     = useState('');
  const [editingDesc,    setEditingDesc]    = useState(false);
  const [descDraft,      setDescDraft]      = useState('');
  const [commentText,    setCommentText]    = useState('');
  const [editingComment, setEditingComment] = useState<Comment | null>(null);
  const [newSubtask,     setNewSubtask]     = useState('');
  const [showAssignee,   setShowAssignee]   = useState(false);
  const [showMove,       setShowMove]       = useState(false);
  const [approvalAction, setApprovalAction] = useState<'request' | 'approve' | 'reject' | 'client' | 'client_approve' | 'client_reject' | null>(null);
  const [uploadingFile,  setUploadingFile]  = useState(false);
  const [showAttachPicker, setShowAttachPicker] = useState(false);
  const [mentionQuery,   setMentionQuery]   = useState<string | null>(null);
  const composerRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);

  // ── Time ─────────────────────────────────────────────────────────────────────
  // 17-mobile-app.md lists time among the things the drawer has to carry at
  // 393px. It was the one item missing, which also left TimeScreen reading a
  // running-timer record that nothing ever wrote.
  const [runningTimer, setRunningTimerState] = useState(() => getRunningTimer());
  const [timerBusy, setTimerBusy] = useState(false);

  const { data: taskTime } = useQuery({
    queryKey: ['time', 'task', taskId],
    queryFn:  () => timeApi.forTask(taskId),
    enabled:  !isClientRole(user?.role),
  });

  const timerRunsThisTask = runningTimer?.task_id === taskId;

  const toggleTimer = async () => {
    if (timerBusy) return;
    setTimerBusy(true);
    try {
      if (timerRunsThisTask) {
        await timeApi.stop();
        clearRunningTimer();
        setRunningTimerState(null);
      } else {
        // `/start` auto-stops any other running timer server-side, so the local
        // record is replaced rather than merged — two running timers cannot
        // exist and the app must not imply otherwise.
        const res = await timeApi.start(taskId);
        const next = {
          entry_id:   res.entry_id,
          task_id:    taskId,
          task_title: task?.title ?? 'Task',
          started_at: res.started_at,
        };
        setRunningTimer(next);
        setRunningTimerState(next);
      }
      qc.invalidateQueries({ queryKey: ['time'] });
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 404 && timerRunsThisTask) {
        // Already stopped elsewhere. Clear the stale note instead of stranding a
        // stop button that can never succeed.
        clearRunningTimer();
        setRunningTimerState(null);
      } else {
        Alert.alert('Timer', e instanceof Error ? e.message : 'Could not update the timer.');
      }
    } finally {
      setTimerBusy(false);
    }
  };

  // ── Mutations ────────────────────────────────────────────────────────────────
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['task', taskId] });
    qc.invalidateQueries({ queryKey: ['tasks'] });
  };

  const updateTask = useMutation({
    mutationFn: (body: Partial<Task>) => tasksApi.update(taskId, body),
    onSuccess:  () => invalidate(),
    onError:    (e: any) => Alert.alert('Error', e.message),
  });

  const toggleSubtask = useMutation({
    mutationFn: (subtaskId: string) => tasksApi.toggleSubtask(taskId, subtaskId),
    onMutate: async (subtaskId) => {
      await qc.cancelQueries({ queryKey: ['task', taskId] });
      const prev = qc.getQueryData<Task>(['task', taskId]);
      qc.setQueryData<Task>(['task', taskId], (old: Task | undefined) => old ? {
        ...old,
        subtasks: old.subtasks.map((s: Subtask) =>
          s.subtask_id === subtaskId ? { ...s, is_done: !s.is_done } : s
        ),
      } : old);
      return { prev };
    },
    onError: (_e, _v, ctx: any) => { if (ctx?.prev) qc.setQueryData(['task', taskId], ctx.prev); },
    onSettled: () => invalidate(),
  });

  const addSubtask = useMutation({
    mutationFn: (title: string) => tasksApi.addSubtask(taskId, title),
    onSuccess:  () => { setNewSubtask(''); invalidate(); },
    onError:    (e: any) => Alert.alert('Error', e.message),
  });

  const deleteSubtask = useMutation({
    mutationFn: (subtaskId: string) => tasksApi.deleteSubtask(taskId, subtaskId),
    onSuccess:  () => invalidate(),
  });

  const addComment = useMutation({
    mutationFn: (body: string) => tasksApi.addComment(taskId, body),
    onMutate: async (body: string) => {
      await qc.cancelQueries({ queryKey: ['comments', taskId] });
      const prev = qc.getQueryData<Comment[]>(['comments', taskId]) ?? [];
      const optimistic: Comment = {
        comment_id: `__opt_${Date.now()}`,
        task_id:    taskId,
        user_id:    user?.user_id ?? '',
        body,
        created_at: new Date().toISOString(),
        user_name: userName(user ?? {}),
      } as Comment;
      qc.setQueryData<Comment[]>(['comments', taskId], [...prev, optimistic]);
      setCommentText('');
      Keyboard.dismiss();
      return { prev };
    },
    onSuccess:  () => { refetchComments(); },
    onError:    (e: any, _body, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(['comments', taskId], ctx.prev);
      Alert.alert('Error', e.message);
    },
  });

  const editComment = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => tasksApi.editComment(taskId, id, body),
    onMutate: async ({ id, body }) => {
      await qc.cancelQueries({ queryKey: ['comments', taskId] });
      const prev = qc.getQueryData<Comment[]>(['comments', taskId]) ?? [];
      qc.setQueryData<Comment[]>(['comments', taskId],
        prev.map(c => c.comment_id === id ? { ...c, body } : c));
      setEditingComment(null);
      return { prev };
    },
    onSuccess:  () => { refetchComments(); },
    onError:    (_e, _v, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(['comments', taskId], ctx.prev);
    },
  });

  const deleteComment = useMutation({
    mutationFn: (id: string) => tasksApi.deleteComment(taskId, id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['comments', taskId] });
      const prev = qc.getQueryData<Comment[]>(['comments', taskId]) ?? [];
      qc.setQueryData<Comment[]>(['comments', taskId], prev.filter(c => c.comment_id !== id));
      return { prev };
    },
    onSuccess:  () => { refetchComments(); },
    onError:    (_e, _v, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(['comments', taskId], ctx.prev);
    },
  });

  const moveTask = useMutation({
    mutationFn: (colId: string) => tasksApi.move(taskId, colId),
    onSuccess:  () => { setShowMove(false); invalidate(); },
    onError:    (e: any) => Alert.alert('Error', e.message),
  });

  const handleApprovalConfirm = async (notes: string, extra?: { client_email?: string }) => {
    try {
      if (approvalAction === 'request') {
        await tasksApi.requestApproval(taskId, notes || undefined);
      } else if (approvalAction === 'approve') {
        await tasksApi.reviewApproval(taskId, 'approved', { notes });
      } else if (approvalAction === 'reject') {
        await tasksApi.reviewApproval(taskId, 'rejected', { notes });
      } else if (approvalAction === 'client') {
        // Sending to the client is an APPROVAL with send_to_client set, not a
        // status of its own — the server rejects any status that is not
        // "approved" or "rejected" (server.py:1188). Mirrors the web's
        // confirmApproveWithClient.
        await tasksApi.reviewApproval(taskId, 'approved', {
          notes, send_to_client: true, client_email: extra?.client_email,
        });
      } else if (approvalAction === 'client_approve') {
        await tasksApi.clientApprove(taskId);
      } else if (approvalAction === 'client_reject') {
        await tasksApi.clientReject(taskId, notes);
      }
      setApprovalAction(null);
      invalidate();
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  const handleFilePicked = async (files: PickedFile[]) => {
    setUploadingFile(true);
    try {
      for (const f of files) {
        const fd = new FormData();
        fd.append('file', { uri: f.uri, name: f.name, type: f.type } as unknown as Blob);
        await tasksApi.uploadAttachment(taskId, fd);
      }
      invalidate();
    } catch (e: unknown) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Could not upload file.');
    } finally {
      setUploadingFile(false);
    }
  };

  const toggleAssignee = (uid: string) => {
    if (!task) return;
    const current = task.assignee_user_ids ?? [];
    const updated  = current.includes(uid)
      ? current.filter((id: string) => id !== uid)
      : [...current, uid];
    updateTask.mutate({ assignee_user_ids: updated });
  };

  const saveTitle = () => {
    setEditingTitle(false);
    if (titleDraft.trim() && titleDraft.trim() !== task?.title) {
      updateTask.mutate({ title: titleDraft.trim() });
    }
  };
  const saveDesc = () => {
    setEditingDesc(false);
    if (descDraft !== (task?.description ?? '')) {
      updateTask.mutate({ description: descDraft });
    }
  };

  const onCommentLongPress = (c: Comment) => {
    const isMine = c.user_id === user?.user_id;
    if (!isMine) return;
    Alert.alert('Comment', c.body.slice(0, 80), [
      { text: 'Edit',   onPress: () => { setEditingComment(c); setCommentText(c.body); } },
      { text: 'Delete', style: 'destructive', onPress: () => deleteComment.mutate(c.comment_id) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const dueDisplay = useMemo(() => {
    if (!task?.due_at) return null;
    const d = new Date(task.due_at);
    const isLate = isPast(d) && !isToday(d);
    return { label: format(d, 'd MMM yyyy'), isLate };
  }, [task?.due_at]);

  // ── Loading / error ──────────────────────────────────────────────────────────
  if (isLoading) return (
    <View style={[s.root, { backgroundColor: t.bg }]}>
      <SafeHeader onBack={() => nav.goBack()} title="" t={t} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={t.primary} size="large" />
      </View>
    </View>
  );

  if (isError || !task) return (
    <View style={[s.root, { backgroundColor: t.bg }]}>
      <SafeHeader onBack={() => nav.goBack()} title="Task" t={t} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <Ionicons name="alert-circle-outline" size={48} color={t.error} />
        <Text style={{ color: t.ink3, fontSize: 14 }}>Could not load task.</Text>
      </View>
    </View>
  );

  const isClient        = user?.role === 'client';
  const canEdit         = !isClient && (user?.role === 'admin' || user?.role === 'owner' || task.created_by_user_id === user?.user_id);
  // Scheme-aware. PRIORITY_COLOR (no S) is the deprecated light-only map: in dark
  // mode it returned a red mixed for the cream canvas. 00 §9 flips these.
  const priColor        = PRIORITY_COLORS[scheme][task.priority] ?? t.ink3;
  const assignedMembers = members.filter((m: TeamMember) => (task.assignee_user_ids ?? []).includes(memberId(m)));

  return (
    <View style={[s.root, { backgroundColor: t.bg }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>

        <SafeHeader
          onBack={() => nav.goBack()}
          title={task.team_name ?? ''}
          t={t}
          rightActions={
            canEdit ? (
              <TouchableOpacity onPress={() => setShowMove(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="git-branch-outline" size={22} color={t.ink3} />
              </TouchableOpacity>
            ) : null
          }
        />

        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ══ TITLE ══ */}
          {editingTitle ? (
            <TextInput
              style={[s.titleInput, { color: t.ink, borderBottomColor: t.primary }]}
              value={titleDraft}
              onChangeText={setTitleDraft}
              onBlur={saveTitle}
              autoFocus
              multiline
              returnKeyType="done"
              blurOnSubmit
            />
          ) : (
            <TouchableOpacity
              onPress={() => { if (canEdit) { setTitleDraft(task.title); setEditingTitle(true); } }}
              activeOpacity={canEdit ? 0.7 : 1}
            >
              <Text style={[s.titleText, { color: t.ink }]}>{task.title}</Text>
            </TouchableOpacity>
          )}

          {/* ══ META CHIPS ══ */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.metaRow} contentContainerStyle={{ gap: 8, paddingRight: 16 }}>
            <TouchableOpacity
              disabled={!canEdit}
              onPress={() => {
                const next: Priority[] = ['urgent', 'high', 'medium', 'low'];
                const idx = next.indexOf(task.priority);
                updateTask.mutate({ priority: next[(idx + 1) % 4] });
              }}
              style={[s.metaChip, { backgroundColor: withAlpha(priColor, 0.13), borderColor: priColor }]}
            >
              <Ionicons name={PRI_ICONS[task.priority as Priority] as any} size={12} color={priColor} />
              <Text style={[s.metaChipText, { color: priColor }]}>{task.priority}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              disabled={!canEdit}
              onPress={() => {
                const opts: Task['status'][] = ['todo', 'in_progress', 'in_review', 'done'];
                const idx = opts.indexOf(task.status);
                updateTask.mutate({ status: opts[(idx + 1) % opts.length] });
              }}
              style={[s.metaChip, { backgroundColor: t.surfaceLow, borderColor: t.outline }]}
            >
              <Ionicons name="ellipse" size={8} color={task.status === 'done' ? t.success : t.ink3} />
              <Text style={[s.metaChipText, { color: t.ink2 }]}>{task.status.replace('_', ' ')}</Text>
            </TouchableOpacity>

            {dueDisplay && (
              <View style={[s.metaChip, { backgroundColor: dueDisplay.isLate ? t.errorBg : t.surfaceLow, borderColor: dueDisplay.isLate ? t.error : t.outline }]}>
                <Ionicons name="calendar-outline" size={12} color={dueDisplay.isLate ? t.error : t.ink3} />
                <Text style={[s.metaChipText, { color: dueDisplay.isLate ? t.error : t.ink2 }]}>{dueDisplay.label}</Text>
              </View>
            )}
          </ScrollView>

          <Divider t={t} />

          {/* ══ DESCRIPTION ══ */}
          <Section label="DESCRIPTION" t={t}>
            {editingDesc ? (
              <TextInput
                style={[s.descInput, { color: t.ink, borderColor: t.outline, backgroundColor: t.surfaceLow }]}
                value={descDraft}
                onChangeText={setDescDraft}
                onBlur={saveDesc}
                autoFocus
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                returnKeyType="default"
              />
            ) : (
              <TouchableOpacity
                onPress={() => { if (canEdit) { setDescDraft(task.description ?? ''); setEditingDesc(true); } }}
                activeOpacity={0.7}
              >
                <Text style={[s.descText, { color: task.description ? t.ink2 : t.ink4 }]}>
                  {task.description || (canEdit ? 'Tap to add description…' : '—')}
                </Text>
              </TouchableOpacity>
            )}
          </Section>

          <Divider t={t} />

          {/* ══ ASSIGNEES ══ */}
          <Section
            label="ASSIGNEES"
            t={t}
            action={canEdit ? { icon: 'person-add-outline', onPress: () => setShowAssignee(true), label: 'Add assignee' } : undefined}
          >
            {assignedMembers.length === 0 ? (
              <TouchableOpacity onPress={() => canEdit && setShowAssignee(true)}>
                <Text style={[s.emptyHint, { color: t.ink4 }]}>{canEdit ? 'Tap to assign…' : 'Unassigned'}</Text>
              </TouchableOpacity>
            ) : (
              <View style={s.assigneeRow}>
                {assignedMembers.map((m: TeamMember) => {
                  const uid = memberId(m);
                  const nm  = memberName(m);
                  return (
                    <TouchableOpacity key={uid} onPress={() => canEdit && setShowAssignee(true)} style={s.assigneeChip}>
                      <Avatar uid={uid} name={nm} size={28} />
                      <Text style={[s.assigneeChipName, { color: t.ink2 }]}>{nm.split(' ')[0]}</Text>
                    </TouchableOpacity>
                  );
                })}
                {canEdit && (
                  <TouchableOpacity onPress={() => setShowAssignee(true)} style={[s.assigneeAdd, { backgroundColor: t.surfaceLow, borderColor: t.outline }]}>
                    <Ionicons name="add" size={16} color={t.ink3} />
                  </TouchableOpacity>
                )}
              </View>
            )}
          </Section>

          <Divider t={t} />

          {/* ══ SUBTASKS ══ */}
          <Section
            label={`SUBTASKS  ${task.subtasks.length > 0 ? `${task.subtasks.filter((s: Subtask) => s.is_done).length}/${task.subtasks.length}` : ''}`}
            t={t}
          >
            {task.subtasks.length > 0 && (
              <View style={[s.subtaskProgress, { backgroundColor: t.outline }]}>
                <View style={[s.subtaskProgressFill, {
                  width: `${(task.subtasks.filter((s: Subtask) => s.is_done).length / task.subtasks.length) * 100}%`,
                  backgroundColor: task.subtasks.every((s: Subtask) => s.is_done) ? t.success : t.primary,
                }]} />
              </View>
            )}

            {task.subtasks.map((sub: Subtask) => (
              <SubtaskRow
                key={sub.subtask_id}
                sub={sub}
                t={t}
                members={members}
                canEdit={canEdit}
                onToggle={() => toggleSubtask.mutate(sub.subtask_id)}
                onDelete={() => Alert.alert('Delete subtask', `"${sub.title}"?`, [
                  { text: 'Delete', style: 'destructive', onPress: () => deleteSubtask.mutate(sub.subtask_id) },
                  { text: 'Cancel', style: 'cancel' },
                ])}
              />
            ))}

            {canEdit && (
              <View style={s.addSubtaskRow}>
                <TextInput
                  style={[s.addSubtaskInput, { color: t.ink, borderColor: t.outline, backgroundColor: t.surfaceLow }]}
                  value={newSubtask}
                  onChangeText={setNewSubtask}
                  placeholder="Add subtask…"
                  placeholderTextColor={t.ink4}
                  returnKeyType="done"
                  onSubmitEditing={() => { if (newSubtask.trim()) addSubtask.mutate(newSubtask.trim()); }}
                />
                <TouchableOpacity
                  onPress={() => { if (newSubtask.trim()) addSubtask.mutate(newSubtask.trim()); }}
                  disabled={!newSubtask.trim()}
                  style={[s.addSubtaskBtn, { opacity: newSubtask.trim() ? 1 : 0.4, backgroundColor: t.primaryContainer }]}
                >
                  <Ionicons name="add" size={18} color={t.primary} />
                </TouchableOpacity>
              </View>
            )}
          </Section>

          <Divider t={t} />

          {/* ══ APPROVAL ══ */}
          <Section label="APPROVAL" t={t}>
            <ApprovalBanner
              task={task}
              userRole={user?.role ?? 'member'}
              userId={user?.user_id ?? ''}
              onAction={a => setApprovalAction(a)}
            />
          </Section>

          <Divider t={t} />

          {/* ══ ATTACHMENTS ══ */}
          <Section
            label="ATTACHMENTS"
            t={t}
            action={canEdit ? {
              icon: uploadingFile ? 'hourglass-outline' : 'attach-outline',
              onPress: () => setShowAttachPicker(true),
              label: uploadingFile ? 'Uploading attachment' : 'Add attachment',
            } : undefined}
          >
            {task.attachments.length === 0 && !uploadingFile && (
              <Text style={[s.emptyHint, { color: t.ink4 }]}>{canEdit ? 'Tap + to attach files' : 'No attachments'}</Text>
            )}
            {uploadingFile && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}>
                <ActivityIndicator size="small" color={t.primary} />
                <Text style={{ color: t.ink3, fontSize: 12 }}>Uploading…</Text>
              </View>
            )}
            <View style={s.attachGrid}>
              {task.attachments.map((a: Attachment, i: number) => {
                const isImage = /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(a.name);
                return (
                  <TouchableOpacity
                    key={a.key ?? i}
                    style={[s.attachChip, { backgroundColor: t.surfaceLow, borderColor: t.outline }]}
                    onPress={() => {
                      if (!/^https?:\/\//i.test(a.url)) {
                        Alert.alert('Invalid link', 'This attachment URL is not a valid https link.');
                        return;
                      }
                      Linking.openURL(a.url);
                    }}
                    onLongPress={() => canEdit && a.key && Alert.alert('Remove attachment', `"${a.name}"?`, [
                      { text: 'Remove', style: 'destructive', onPress: async () => {
                        await tasksApi.deleteAttachment(taskId, a.key!);
                        invalidate();
                      }},
                      { text: 'Cancel', style: 'cancel' },
                    ])}
                  >
                    <Ionicons name={isImage ? 'image-outline' : 'document-outline'} size={14} color={t.primary} />
                    <Text style={[s.attachName, { color: t.ink2 }]} numberOfLines={1}>{a.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Section>

          <Divider t={t} />

          {/* ══ TIME ══ */}
          {!isClient && (
            <>
              <Section label={`TIME  ${taskTime?.total_minutes ? fmtMinutes(taskTime.total_minutes) : ''}`} t={t}>
                <TouchableOpacity
                  onPress={toggleTimer}
                  disabled={timerBusy}
                  accessibilityRole="button"
                  accessibilityLabel={timerRunsThisTask ? 'Stop timer' : 'Start timer on this task'}
                  accessibilityState={{ disabled: timerBusy }}
                  style={[
                    s.metaChip,
                    {
                      alignSelf: 'flex-start',
                      backgroundColor: timerRunsThisTask ? t.errorBg : t.primaryContainer,
                      borderColor: timerRunsThisTask ? t.error : t.primary,
                      paddingVertical: 8,
                      paddingHorizontal: 14,
                    },
                  ]}
                >
                  {timerBusy ? (
                    <ActivityIndicator size="small" color={timerRunsThisTask ? t.error : t.onPrimaryContainer} />
                  ) : (
                    <Ionicons
                      name={timerRunsThisTask ? 'stop-circle' : 'play-circle'}
                      size={16}
                      color={timerRunsThisTask ? t.error : t.onPrimaryContainer}
                    />
                  )}
                  <Text style={[s.metaChipText, {
                    color: timerRunsThisTask ? t.error : t.onPrimaryContainer,
                    fontWeight: '700',
                  }]}>
                    {timerRunsThisTask ? 'Stop timer' : 'Start timer'}
                  </Text>
                </TouchableOpacity>

                {/* A timer on ANOTHER task is worth saying out loud: /start would
                    silently close it, and someone would lose the minutes they
                    thought they were still logging. */}
                {runningTimer && !timerRunsThisTask && (
                  <Text style={[s.emptyHint, { color: t.ink3, marginTop: 8 }]}>
                    A timer is running on “{runningTimer.task_title}”. Starting one here stops that one.
                  </Text>
                )}

                {taskTime?.entries?.length
                  ? (
                    <Text style={[s.emptyHint, { color: t.ink4, marginTop: 8 }]}>
                      {taskTime.entries.length} {taskTime.entries.length === 1 ? 'entry' : 'entries'} · {fmtMinutes(taskTime.total_minutes)} total
                    </Text>
                  )
                  : (
                    <Text style={[s.emptyHint, { color: t.ink4, marginTop: 8 }]}>No time logged yet.</Text>
                  )}
              </Section>

              <Divider t={t} />
            </>
          )}

          {/* ══ COMMENTS ══ */}
          <Section label={`COMMENTS  ${comments.length > 0 ? comments.length : ''}`} t={t}>
            {comments.length === 0 && (
              <Text style={[s.emptyHint, { color: t.ink4 }]}>No comments yet.</Text>
            )}
            {comments.map((c: Comment) => (
              <CommentRow
                key={c.comment_id}
                comment={c}
                isMine={c.user_id === user?.user_id}
                t={t}
                onLongPress={() => onCommentLongPress(c)}
              />
            ))}
          </Section>

          <View style={{ height: 80 }} />
        </ScrollView>

        {/* ── Comment composer ── */}
        <View style={[s.composer, { backgroundColor: t.surface, borderTopColor: t.outline }]}>
          {/* Mention suggestions */}
          {mentionQuery !== null && (
            <View style={[mentionStyles.list, { backgroundColor: t.surface, borderColor: t.outline }]}>
              {members
                .filter((m: TeamMember) => {
                  const n = memberName(m).toLowerCase();
                  const e = (m.email ?? '').toLowerCase();
                  const q = mentionQuery.toLowerCase();
                  return q === '' || n.includes(q) || e.includes(q);
                })
                .slice(0, 6)
                .map((m: TeamMember) => (
                  <TouchableOpacity
                    key={memberId(m)}
                    style={[mentionStyles.row, { borderBottomColor: t.outline }]}
                    onPress={() => {
                      const display = memberName(m).replace(/\s+/g, '_');
                      const atIdx = commentText.lastIndexOf('@');
                      const before = commentText.slice(0, atIdx);
                      const after  = commentText.slice(atIdx + 1 + mentionQuery.length);
                      setCommentText(before + '@' + display + ' ' + after);
                      setMentionQuery(null);
                      composerRef.current?.focus();
                    }}
                  >
                    <Avatar uid={memberId(m)} name={memberName(m)} size={24} />
                    <Text style={[mentionStyles.name, { color: t.ink }]}>{memberName(m)}</Text>
                    {m.email ? <Text style={[mentionStyles.email, { color: t.ink3 }]}>{m.email}</Text> : null}
                  </TouchableOpacity>
                ))}
              {members.filter((m: TeamMember) => {
                const n = memberName(m).toLowerCase();
                const e = (m.email ?? '').toLowerCase();
                const q = mentionQuery.toLowerCase();
                return q === '' || n.includes(q) || e.includes(q);
              }).length === 0 && (
                <Text style={[mentionStyles.empty, { color: t.ink3 }]}>No members found</Text>
              )}
            </View>
          )}
          {editingComment && (
            <View style={[s.editingBanner, { backgroundColor: t.primaryContainer }]}>
              <Text style={[s.editingBannerText, { color: t.primary }]}>Editing comment</Text>
              <TouchableOpacity onPress={() => { setEditingComment(null); setCommentText(''); }}>
                <Ionicons name="close" size={16} color={t.primary} />
              </TouchableOpacity>
            </View>
          )}
          <View style={s.composerRow}>
            {user && <Avatar uid={user.user_id} name={userName(user)} size={30} />}
            <TextInput
              ref={composerRef}
              style={[s.composerInput, { backgroundColor: t.bg, borderColor: t.outline, color: t.ink }]}
              value={commentText}
              onChangeText={text => {
                setCommentText(text);
                // Detect @mention trigger
                const atIdx = text.lastIndexOf('@');
                if (atIdx !== -1) {
                  const afterAt = text.slice(atIdx + 1);
                  // Only trigger if @ is at start or preceded by whitespace
                  const charBefore = atIdx > 0 ? text[atIdx - 1] : ' ';
                  if (/\s/.test(charBefore) || atIdx === 0) {
                    // No space in partial query
                    if (!/\s/.test(afterAt)) {
                      setMentionQuery(afterAt);
                      return;
                    }
                  }
                }
                setMentionQuery(null);
              }}
              placeholder="Add a comment… (type @ to mention)"
              placeholderTextColor={t.ink4}
              multiline
              maxLength={2000}
            />
            <TouchableOpacity
              disabled={!commentText.trim() || addComment.isPending || editComment.isPending}
              onPress={() => {
                if (!commentText.trim()) return;
                setMentionQuery(null);
                if (editingComment) {
                  editComment.mutate({ id: editingComment.comment_id, body: commentText.trim() });
                } else {
                  addComment.mutate(commentText.trim());
                }
              }}
              style={[s.sendBtn, { opacity: commentText.trim() ? 1 : 0.4 }]}
            >
              <LinearGradient colors={BRAND_GRADIENT_2} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.sendGrad}>
                <Ionicons name="send" size={14} color="#fff" />
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* ── Modals ── */}
      <AssigneePickerModal
        visible={showAssignee}
        members={members}
        selectedIds={task.assignee_user_ids ?? []}
        onToggle={toggleAssignee}
        onClose={() => setShowAssignee(false)}
      />

      <MoveModal
        visible={showMove}
        columns={columns}
        currentColId={task.column_id}
        onMove={colId => moveTask.mutate(colId)}
        onClose={() => setShowMove(false)}
      />

      <ApprovalModal
        visible={!!approvalAction}
        action={approvalAction}
        onClose={() => setApprovalAction(null)}
        onConfirm={handleApprovalConfirm}
      />

      <AttachmentSourceSheet
        visible={showAttachPicker}
        onClose={() => setShowAttachPicker(false)}
        onPicked={handleFilePicked}
        maxFiles={5 - (task?.attachments?.length ?? 0)}
      />
    </View>
  );
}

const mentionStyles = StyleSheet.create({
  list: {
    borderTopWidth: 1,
    maxHeight: 220,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  name: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  email: {
    fontSize: 11,
  },
  empty: {
    padding: 14,
    textAlign: 'center',
    fontSize: 13,
  },
});
