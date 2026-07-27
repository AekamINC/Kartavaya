import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  FlatList, Modal, TextInput, ActivityIndicator,
  Platform, Alert, RefreshControl, KeyboardAvoidingView, Pressable,
} from 'react-native';
import { useRoute, useNavigation, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { format, isToday, isPast } from 'date-fns';
import { useTheme } from '../theme/ThemeProvider';
import { tasksApi } from '../api/tasks';
import { projectsApi } from '../api/projects';
import { PRIORITY_COLORS, projectColor, AVATAR_COLORS, BRAND_GRADIENT_2, withAlpha } from '../theme/tokens';
import { FAMILY } from '../theme/fonts';
import BiLabel from '../theme/BiLabel';
import type { Task, ProjectColumn, TeamMember, Project } from '../api/types';
import type { RootStackParamList } from '../nav/RootStack';

type Route = RouteProp<RootStackParamList, 'Board'>;
type Nav   = NativeStackNavigationProp<RootStackParamList, 'Board'>;

const VIEWS = ['Board', 'List', 'Schedule', 'Tracker'] as const;
type ViewMode = typeof VIEWS[number];
const PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;

// ── Project picker modal ──────────────────────────────────────────────────────
function ProjectPicker({
  visible, projects, activeId, onSelect, onClose, t,
}: {
  visible: boolean; projects: Project[]; activeId: string | null;
  onSelect: (p: Project) => void; onClose: () => void; t: any;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={ps.backdrop} onPress={onClose} />
      <View style={[ps.sheet, { backgroundColor: t.surface }]}>
        <View style={[ps.handle, { backgroundColor: t.outline }]} />
        <Text style={[ps.title, { color: t.ink }]}>Switch Project</Text>
        <Text style={[ps.sub, { color: t.ink3 }]}>परियोजना चुनें</Text>
        <ScrollView style={{ maxHeight: 380 }}>
          {projects.map(p => {
            const color = projectColor(p.team_id, p.color ?? undefined);
            const isActive = p.team_id === activeId;
            return (
              <TouchableOpacity
                key={p.team_id}
                style={[ps.row, { borderBottomColor: t.outline }, isActive && { backgroundColor: t.primaryContainer }]}
                onPress={() => { onSelect(p); onClose(); }}
                activeOpacity={0.75}
              >
                <View style={[ps.dot, { backgroundColor: color }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[ps.rowName, { color: t.ink }]}>{p.name}</Text>
                  {p.description ? <Text style={[ps.rowDesc, { color: t.ink3 }]} numberOfLines={1}>{p.description}</Text> : null}
                </View>
                {isActive && <Ionicons name="checkmark" size={18} color={t.primary} />}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <TouchableOpacity onPress={onClose} style={[ps.cancelBtn, { borderColor: t.outline }]}>
          {/* fontWeight '700' on `रद्द करें` has no Tiro to apply it to, so the
              Hindi half renders in a synthesised bold or the system face. */}
          <BiLabel latinStyle={[ps.cancelText, { color: t.ink3 }]} hindiStyle={{ color: t.ink3 }} hindiSize={13}>
            Cancel · रद्द करें
          </BiLabel>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

// ── Board card ────────────────────────────────────────────────────────────────
// Was a fifth private copy of the avatar palette, led by the retired blue.
const BC_AVATAR_COLORS = AVATAR_COLORS;
const IS_ANDROID = Platform.OS === 'android';

function BoardCard({ task, col, onPress }: { task: Task; col?: ProjectColumn; onPress: () => void }) {
  const { t, scheme } = useTheme();
  // Scheme-aware: PRIORITY_COLOR (no S) is the light-only map, so a dark-mode
  // card drew a red mixed for the cream canvas. 00 §9 flips these.
  const priColor = PRIORITY_COLORS[scheme][task.priority] ?? t.ink3;
  const isLate   = task.due_at ? isPast(new Date(task.due_at)) && !isToday(new Date(task.due_at)) : false;

  // Approval chip
  let approvalBg = ''; let approvalFg = ''; let approvalLabel = '';
  if (task.approval_status === 'approved') {
    approvalBg = IS_ANDROID ? t.primaryContainer : 'rgba(5,183,170,0.16)';
    approvalFg = IS_ANDROID ? t.onPrimaryContainer : '#0A7A6E';
    approvalLabel = 'Approved';
  } else if (task.approval_status === 'pending_client') {
    approvalBg = IS_ANDROID ? t.purpleContainer : 'rgba(167,139,250,0.16)';
    approvalFg = t.purple;
    approvalLabel = 'Client review';
  } else if (task.approval_status === 'pending') {
    approvalBg = IS_ANDROID ? t.tertiaryContainer : 'rgba(255,159,10,0.18)';
    approvalFg = IS_ANDROID ? t.onTertiaryContainer : '#B06A00';
    approvalLabel = 'Owner sign-off';
  }

  // Due chip colors
  const dueBg   = isLate ? (IS_ANDROID ? t.errorBg   : 'rgba(255,69,58,0.12)') : t.surface2;
  const dueFg   = isLate ? (IS_ANDROID ? t.error     : '#FF453A')               : t.ink2;

  return (
    <TouchableOpacity
      style={[bc.card, IS_ANDROID
        ? { backgroundColor: t.surfaceLow, borderRadius: 24 }
        : { backgroundColor: t.surface,    borderRadius: 16,
            shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.05, shadowRadius: 3, elevation: 1 },
      ]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      {/* Priority dot + label + ID */}
      <View style={bc.topRow}>
        <View style={[bc.priDot, { backgroundColor: priColor, borderRadius: 99 }]} />
        <Text style={[bc.priLabel, { color: t.ink2 }]}>{task.priority}</Text>
        <Text style={[bc.taskId, { color: t.ink3 }]}>{task.task_id.slice(0, 8)}</Text>
      </View>

      {/* Title */}
      <Text style={[bc.title, { color: t.ink }]} numberOfLines={2}>{task.title}</Text>

      {/* Footer */}
      <View style={bc.footer}>
        {task.due_at && (
          <View style={[bc.chip, { backgroundColor: dueBg }]}>
            <Text style={[bc.chipText, { color: dueFg }]}>
              {format(new Date(task.due_at), 'd MMM')}
            </Text>
          </View>
        )}
        {!!approvalLabel && (
          <View style={[bc.chip, { backgroundColor: approvalBg }]}>
            <Text style={[bc.chipText, { color: approvalFg }]}>{approvalLabel.toUpperCase()}</Text>
          </View>
        )}
        <View style={{ flex: 1 }} />
        {/* Meta counts */}
        {(task.comments_count ?? 0) > 0 && (
          <View style={bc.metaItem}>
            <Ionicons name="chatbubble-outline" size={11} color={t.ink3} />
            <Text style={[bc.metaCount, { color: t.ink3 }]}>{task.comments_count}</Text>
          </View>
        )}
        {((task.attachments ?? []).length) > 0 && (
          <View style={bc.metaItem}>
            <Ionicons name="attach-outline" size={11} color={t.ink3} />
            <Text style={[bc.metaCount, { color: t.ink3 }]}>{task.attachments!.length}</Text>
          </View>
        )}
        {/* Assignee avatars */}
        {(task.assignee_names ?? []).slice(0, 3).map((name: string, i: number) => (
          <View key={i} style={[bc.avatar, {
            backgroundColor: BC_AVATAR_COLORS[i % BC_AVATAR_COLORS.length],
            marginLeft: i > 0 ? -7 : 0,
            borderColor: IS_ANDROID ? t.surfaceLow : t.surface,
          }]}>
            <Text style={bc.avatarText}>{name?.[0]?.toUpperCase() ?? '?'}</Text>
          </View>
        ))}
      </View>
    </TouchableOpacity>
  );
}

// ── New task modal ────────────────────────────────────────────────────────────
function NewTaskModal({ visible, columns, projectId, onClose, onCreated, t }: {
  visible: boolean; columns: ProjectColumn[]; projectId: string;
  onClose: () => void; onCreated: () => void; t: any;
}) {
  // `t` arrives as a prop, but the priority chips need the active scheme too —
  // 00 §9's --pr-* tokens flip, so a light-mode red on a dark sheet is wrong.
  const { scheme } = useTheme();
  const [title, setTitle]   = useState('');
  const [colId, setColId]   = useState(columns[0]?.column_id ?? '');
  const [priority, setPriority] = useState<typeof PRIORITIES[number]>('medium');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (columns.length && !colId) setColId(columns[0].column_id);
  }, [columns]);

  const create = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await tasksApi.create({
        title: title.trim(),
        column_id: colId || columns[0]?.column_id,
        team_id: projectId,
        priority,
      });
      setTitle(''); setPriority('medium');
      onCreated();
    } catch (err: unknown) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Could not create task.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <Pressable style={s.overlay} onPress={onClose} />
        <View style={[s.sheet, { backgroundColor: t.surface, borderColor: t.outline }]}>
          <View style={[s.sheetHandle, { backgroundColor: t.outline }]} />
          <Text style={[s.sheetTitle, { color: t.ink }]}>New Task</Text>
          <TextInput
            style={[s.sheetInput, { backgroundColor: t.bg, borderColor: t.outline, color: t.ink }]}
            value={title} onChangeText={setTitle}
            placeholder="Task title" placeholderTextColor={t.ink3}
            autoFocus returnKeyType="done"
          />
          <Text style={[s.sheetLabel, { color: t.ink3 }]}>COLUMN</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
            {columns.map(c => (
              <TouchableOpacity key={c.column_id} onPress={() => setColId(c.column_id)}
                style={[s.colChip, { backgroundColor: colId === c.column_id ? c.color : t.bg, borderColor: c.color }]}>
                <Text style={{ color: colId === c.column_id ? '#fff' : c.color, fontSize: 12, fontWeight: '700' }}>{c.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <Text style={[s.sheetLabel, { color: t.ink3 }]}>PRIORITY</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
            {PRIORITIES.map(p => {
              const pc = PRIORITY_COLORS[scheme][p] ?? t.ink3; const active = priority === p;
              return (
                <TouchableOpacity key={p} onPress={() => setPriority(p)}
                  style={[s.priChip, { backgroundColor: active ? pc : withAlpha(pc, 0.13), borderColor: pc }]}>
                  <Text style={{ color: active ? '#fff' : pc, fontSize: 11, fontWeight: '800', textTransform: 'capitalize' }}>{p}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={s.sheetBtns}>
            <TouchableOpacity onPress={onClose} style={[s.cancelBtn, { borderColor: t.outline }]}>
              <Text style={[s.cancelText, { color: t.ink3 }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={create} disabled={!title.trim() || saving} style={{ flex: 1 }}>
              <LinearGradient colors={BRAND_GRADIENT_2} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={[s.createBtn, (!title.trim() || saving) && { opacity: 0.5 }]}>
                {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.createText}>Create Task</Text>}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function BoardScreen() {
  const { t, scheme } = useTheme();
  const nav     = useNavigation<Nav>();
  const insets  = useSafeAreaInsets();
  const qc      = useQueryClient();

  // route params are optional — when used as Boards tab, params may be undefined
  const route = useRoute<Route>();
  const routeParams = route.params ?? {};
  const isTabMode = !routeParams.projectId;

  // ── Projects ────────────────────────────────────────────────────────────────
  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: projectsApi.list,
    staleTime: 60_000,
  });

  const [activeProjectId, setActiveProjectId] = useState<string | null>(
    routeParams.projectId ?? null
  );
  const [showPicker, setShowPicker] = useState(false);
  const [view, setView] = useState<ViewMode>('Board');
  const [adding, setAdding] = useState(false);
  const [activeCol, setActiveCol] = useState<string | null>(null);

  // Initialise to first project when loaded (tab mode only)
  useEffect(() => {
    if (!activeProjectId && projects.length > 0) {
      setActiveProjectId(projects[0].team_id);
    }
  }, [projects, activeProjectId]);

  const activeProject = projects.find((p: Project) => p.team_id === activeProjectId);
  const projectId     = activeProjectId ?? '';
  const colColor      = projectColor(projectId, activeProject?.color ?? undefined);

  // ── Data ────────────────────────────────────────────────────────────────────
  const { data: columns = [], isLoading: colsLoading } = useQuery({
    queryKey: ['columns', projectId],
    queryFn:  () => projectsApi.columns(projectId),
    enabled:  !!projectId,
  });

  const { data: tasks = [], isLoading: tasksLoading, refetch, isFetching } = useQuery({
    queryKey: ['tasks', projectId],
    queryFn:  () => tasksApi.list({ team_id: projectId }),
    enabled:  !!projectId,
  });

  const isLoading   = colsLoading || tasksLoading;
  const activeColId = activeCol ?? columns[0]?.column_id ?? null;

  const grouped = useMemo(() => {
    const m: Record<string, Task[]> = {};
    columns.forEach((c: ProjectColumn) => { m[c.column_id] = []; });
    tasks.forEach((task: Task) => {
      const key = task.column_id && m[task.column_id] !== undefined
        ? task.column_id : columns[0]?.column_id;
      if (key) { m[key] = m[key] || []; m[key].push(task); }
    });
    return m;
  }, [tasks, columns]);

  const openTask = useCallback((taskId: string) => {
    nav.navigate('TaskDetail', { taskId });
  }, [nav]);

  const onCreated = useCallback(() => {
    setAdding(false);
    qc.invalidateQueries({ queryKey: ['tasks', projectId] });
  }, [qc, projectId]);

  // ── Views ────────────────────────────────────────────────────────────────────
  const renderBoard = useCallback(() => {
    // Show single active column (swipe-style, filtered by column tab)
    const col = columns.find((c: ProjectColumn) => c.column_id === activeColId) ?? columns[0];
    if (!col) return null;
    const colCards = grouped[col.column_id] ?? [];
    const isApprovalCol = col.name?.toLowerCase().includes('approval');
    return (
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={t.primary} />}
      >
        {/* Column header kicker */}
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: 4, paddingBottom: 10 }}>
          <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: col.color }} />
          <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase', color: t.ink2 }}>
            {col.name}
          </Text>
          <Text style={{ marginLeft: 'auto', fontSize: 11, fontFamily: FAMILY.mono, color: t.ink2 }}>
            {colCards.length}
          </Text>
        </View>

        {/* Approval hint */}
        {isApprovalCol && (
          <View style={[s.approvalHint, {
            backgroundColor: IS_ANDROID ? t.tertiaryContainer : 'rgba(255,159,10,0.10)',
            marginBottom: 10,
          }]}>
            <Ionicons name="sparkles-outline" size={14} color={IS_ANDROID ? t.onTertiaryContainer : '#B06A00'} />
            <Text style={[s.approvalHintText, { color: IS_ANDROID ? t.onTertiaryContainer : '#B06A00' }]}>
              Cards here notify the project owner for sign-off.
            </Text>
          </View>
        )}

        {/* Cards */}
        {colCards.length === 0
          ? <Text style={[s.emptyCol, { color: t.ink4 }]}>No tasks in this column</Text>
          : colCards.map(item => (
              <BoardCard key={item.task_id} task={item} col={col} onPress={() => openTask(item.task_id)} />
            ))
        }

        {/* Add card */}
        <TouchableOpacity
          style={[s.addCardBtn, { borderColor: t.outline }]}
          onPress={() => setAdding(true)}
          activeOpacity={0.7}
        >
          <Ionicons name="add" size={14} color={t.ink3} />
          <Text style={[s.addCardText, { color: t.ink3 }]}>Add card to "{col.name}"</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }, [columns, grouped, t, openTask, activeColId, isFetching, isLoading, refetch]);

  const renderList = useCallback(() => (
    <FlatList
      data={tasks}
      keyExtractor={task => task.task_id}
      contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 8 }}
      ListEmptyComponent={<Text style={[s.empty, { color: t.ink3 }]}>No tasks yet.</Text>}
      refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={t.primary} />}
      renderItem={({ item }) => {
        const col = columns.find((c: ProjectColumn) => c.column_id === item.column_id);
        const pri = PRIORITY_COLORS[scheme][item.priority] ?? t.ink3;
        return (
          <TouchableOpacity style={[s.listRow, { backgroundColor: t.surface, borderColor: t.outline }]}
            onPress={() => openTask(item.task_id)} activeOpacity={0.75}>
            <View style={[s.listStatus, { backgroundColor: withAlpha(col?.color ?? t.ink4, 0.13) }]}>
              <Text style={{ color: col?.color ?? t.ink3, fontSize: 9, fontWeight: '800' }} numberOfLines={1}>{col?.name ?? '—'}</Text>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[s.listTitle, { color: t.ink }]} numberOfLines={1}>{item.title}</Text>
              {item.due_at && <Text style={[s.listDue, { color: t.ink3 }]}>{format(new Date(item.due_at), 'd MMM yyyy')}</Text>}
            </View>
            <View style={[s.priDotSm, { backgroundColor: pri }]} />
          </TouchableOpacity>
        );
      }}
    />
  ), [tasks, columns, t, isFetching, isLoading, refetch, openTask]);

  const renderSchedule = useCallback(() => {
    const sorted = [...tasks].filter(task => task.due_at).sort((a, b) => new Date(a.due_at!).getTime() - new Date(b.due_at!).getTime());
    return (
      <FlatList data={sorted} keyExtractor={task => task.task_id}
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 8 }}
        ListEmptyComponent={<Text style={[s.empty, { color: t.ink3 }]}>No tasks with due dates.</Text>}
        renderItem={({ item }) => {
          const col = columns.find((c: ProjectColumn) => c.column_id === item.column_id);
          const d = new Date(item.due_at!); const isLate = isPast(d) && !isToday(d);
          return (
            <TouchableOpacity style={[s.schedRow, { backgroundColor: t.surface, borderColor: t.outline }]}
              onPress={() => openTask(item.task_id)} activeOpacity={0.75}>
              <View style={s.schedDate}>
                <Text style={[s.schedDay, { color: isLate ? '#B42318' : (col?.color ?? '#04837A') }]}>{format(d, 'd')}</Text>
                <Text style={[s.schedMon, { color: t.ink3 }]}>{format(d, 'MMM')}</Text>
              </View>
              <View style={[s.schedBar, { backgroundColor: col?.color ?? '#04837A' }]} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[s.listTitle, { color: t.ink }]} numberOfLines={1}>{item.title}</Text>
                <Text style={{ color: col?.color ?? t.ink3, fontSize: 10, fontWeight: '700' }}>{col?.name ?? '—'}</Text>
              </View>
            </TouchableOpacity>
          );
        }}
      />
    );
  }, [tasks, columns, t, openTask]);

  const renderTracker = useCallback(() => (
    <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      {columns.map((col: ProjectColumn) => {
        const count = (grouped[col.column_id] ?? []).length;
        const pct   = tasks.length ? count / tasks.length : 0;
        return (
          <View key={col.column_id} style={{ gap: 6, marginBottom: 18 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={[s.trackerLabel, { color: col.color }]}>{col.name}</Text>
              <Text style={[s.trackerCount, { color: t.ink }]}>{count}</Text>
            </View>
            <View style={[s.trackerTrack, { backgroundColor: t.outline }]}>
              <LinearGradient colors={BRAND_GRADIENT_2} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={[s.trackerBar, { width: `${pct * 100}%` as any }]} />
            </View>
          </View>
        );
      })}
      <View style={[s.trackerTotal, { borderTopColor: t.outline }]}>
        <Text style={{ color: t.ink3, fontSize: 12, fontWeight: '700' }}>TOTAL</Text>
        <Text style={{ color: t.primary, fontSize: 28, fontWeight: '900' }}>{tasks.length}</Text>
      </View>
    </ScrollView>
  ), [columns, grouped, tasks, t]);

  // ── No projects state ────────────────────────────────────────────────────────
  if (!isLoading && projects.length === 0) {
    return (
      <View style={[s.root, { backgroundColor: t.bg }]}>
        <View style={[s.header, { backgroundColor: IS_ANDROID ? t.surface : t.bg, paddingTop: insets.top + (IS_ANDROID ? 8 : 54) }]}>
          {/* Split: `s.kicker` carries letterSpacing 1.4 and fontWeight '700',
              both of which damage Devanagari — tracking is applied after shaping
              and breaks the shirorekha and the repha in `कार्यफलक`, and there is
              no bold Tiro to weight it with. The loaded header below already
              splits these into two <Text>s; only this empty state did not. */}
          <BiLabel latinStyle={[s.kicker, { color: t.primary }]} hindiStyle={{ color: t.primary }} hindiSize={12}>
            Boards · कार्यफलक
          </BiLabel>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Ionicons name="grid-outline" size={40} color={t.ink3} />
          <Text style={[s.empty, { color: t.ink3 }]}>No projects yet.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[s.root, { backgroundColor: t.bg }]}>
      {/* ── Header ── */}
      <View style={[s.header, {
        backgroundColor: IS_ANDROID ? t.surface : t.bg,
        paddingTop: insets.top + (IS_ANDROID ? 8 : 54),
      }]}>
        {!isTabMode && (
          <TouchableOpacity onPress={() => nav.goBack()} style={s.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="chevron-back" size={24} color={t.ink} />
          </TouchableOpacity>
        )}
        <View style={s.kickerRow}>
          <Text style={[s.kicker, { color: t.primary }]}>Board</Text>
          <Text style={[s.kickerHi, { color: t.ink3 }]}>कार्यफलक</Text>
        </View>
        <Text style={[s.screenTitle, { color: t.ink }]} numberOfLines={1}>
          {activeProject?.name ?? 'Select Project'}
        </Text>

        {/* Project switcher row */}
        <TouchableOpacity
          style={[s.projectBtn, { backgroundColor: t.surface2, borderRadius: IS_ANDROID ? 20 : 14 }]}
          onPress={() => setShowPicker(true)}
          activeOpacity={0.75}
        >
          <View style={[s.projDot, { backgroundColor: colColor, borderRadius: 4 }]} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <Text style={[s.projName, { color: t.ink }]} numberOfLines={1}>
                {activeProject?.name ?? 'Select Project'}
              </Text>
            </View>
            <Text style={[s.projMeta, { color: t.ink2 }]}>
              {tasks.length} task{tasks.length !== 1 ? 's' : ''}
              {activeProject?.description ? ` · ${activeProject.description}` : ''}
            </Text>
          </View>
          <Ionicons name="chevron-down" size={16} color={t.ink2} />
        </TouchableOpacity>
      </View>

      {/* ── View switcher — M3 pill row ── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 6 }}>
        {VIEWS.map(v => {
          const active = view === v;
          return (
            <TouchableOpacity
              key={v}
              onPress={() => setView(v)}
              activeOpacity={0.7}
              style={[s.viewPill, {
                backgroundColor: active ? t.secondaryContainer : 'transparent',
                borderWidth: 1,
                borderColor: active ? 'transparent' : t.outline,
              }]}
            >
              <Text style={[s.viewPillText, {
                color: active ? t.onSecondaryContainer : t.ink2,
              }]}>{v}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* ── Column tabs (board view only) ── */}
      {view === 'Board' && columns.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 6, paddingVertical: 6 }}>
          {columns.map((col: ProjectColumn) => {
            const isActiveC = col.column_id === activeColId;
            const count     = grouped[col.column_id]?.length ?? 0;
            return (
              <TouchableOpacity
                key={col.column_id}
                onPress={() => setActiveCol(col.column_id)}
                activeOpacity={0.7}
                style={[s.colTab, {
                  backgroundColor: isActiveC ? t.surface3 : 'transparent',
                  borderColor:     isActiveC ? 'transparent' : t.outline,
                }]}
              >
                <View style={[s.colTabDot, { backgroundColor: col.color, borderRadius: 99 }]} />
                <Text style={[s.colTabText, { color: isActiveC ? t.ink : t.ink2 }]}>{col.name}</Text>
                <Text style={[s.colTabCount, { color: t.ink3 }]}>{count}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* ── Content ── */}
      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={t.primary} size="large" />
        </View>
      ) : (
        <>
          {view === 'Board'    && renderBoard()}
          {view === 'List'     && renderList()}
          {view === 'Schedule' && renderSchedule()}
          {view === 'Tracker'  && renderTracker()}
        </>
      )}

      {/* ── Project picker ── */}
      <ProjectPicker
        visible={showPicker}
        projects={projects}
        activeId={activeProjectId}
        onSelect={p => setActiveProjectId(p.team_id)}
        onClose={() => setShowPicker(false)}
        t={t}
      />

      {/* ── New task modal ── */}
      {projectId && (
        <NewTaskModal
          visible={adding}
          columns={columns}
          projectId={projectId}
          onClose={() => setAdding(false)}
          onCreated={onCreated}
          t={t}
        />
      )}
    </View>
  );
}

// ── Project picker styles ─────────────────────────────────────────────────────
const ps = StyleSheet.create({
  backdrop:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet:      { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: Platform.OS === 'ios' ? 40 : 28, paddingHorizontal: 20, shadowColor: '#000', shadowOffset: { width: 0, height: -6 }, shadowOpacity: 0.18, shadowRadius: 20, elevation: 20 },
  handle:     { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  title:      { fontSize: 17, fontWeight: '700', textAlign: 'center', marginTop: 12 },
  sub:        { fontSize: 12, textAlign: 'center', marginBottom: 16 },
  row:        { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingLeft: 8 },
  dot:        { width: 12, height: 12, borderRadius: 4, flexShrink: 0 },
  rowName:    { fontSize: 15, fontWeight: '600' },
  rowDesc:    { fontSize: 12, marginTop: 2 },
  cancelBtn:  { borderRadius: 12, borderWidth: 1, paddingVertical: 13, alignItems: 'center', marginTop: 12 },
  cancelText: { fontSize: 14, fontWeight: '600' },
});

// ── Board card styles ─────────────────────────────────────────────────────────
const bc = StyleSheet.create({
  card:         { padding: 14, paddingHorizontal: 16, marginBottom: 10 },
  topRow:       { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  priDot:       { width: 8, height: 8, flexShrink: 0 },
  priLabel:     { fontSize: 11.5, fontWeight: '600', textTransform: 'capitalize', flex: 1 },
  taskId:       { fontSize: 11, fontFamily: FAMILY.mono },
  title:        { fontSize: IS_ANDROID ? 15.5 : 15, fontWeight: '500', lineHeight: IS_ANDROID ? 21 : 20, letterSpacing: IS_ANDROID ? 0 : -0.2, marginBottom: 10 },
  footer:       { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  chip:         { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: IS_ANDROID ? 4 : 3, borderRadius: 99 },
  chipText:     { fontSize: 11, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase' },
  metaItem:     { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaCount:    { fontSize: 11, fontFamily: FAMILY.mono },
  avatar:       { width: IS_ANDROID ? 22 : 20, height: IS_ANDROID ? 22 : 20, borderRadius: 99, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  avatarText:   { fontSize: 8, fontWeight: '700', color: '#fff' },
});

// ── Screen styles ─────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:         { flex: 1 },
  // Header
  header:       { paddingHorizontal: 16, paddingBottom: 8 },
  backBtn:      { width: 32, flexShrink: 0, marginBottom: 4 },
  kickerRow:    { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 4 },
  kicker:       { fontSize: 11, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase' },
  kickerHi:     { fontSize: 12, fontFamily: FAMILY.devanagari },
  screenTitle:  { fontSize: IS_ANDROID ? 30 : 34, fontWeight: IS_ANDROID ? '500' : '400', lineHeight: IS_ANDROID ? 36 : 40, letterSpacing: -0.5, marginBottom: 10, fontFamily: IS_ANDROID ? undefined : FAMILY.display },
  projectBtn:   { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, paddingHorizontal: 14, marginBottom: 4 },
  projDot:      { width: 12, height: 12, flexShrink: 0 },
  projName:     { fontSize: 15, fontWeight: '600' },
  projMeta:     { fontSize: 12, marginTop: 2 },
  // View switcher pills
  viewPill:     { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99 },
  viewPillText: { fontSize: 13, fontWeight: '600', letterSpacing: 0.1 },
  // Column tabs
  colTab:       { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 99, borderWidth: 1, flexShrink: 0 },
  colTabDot:    { width: 7, height: 7 },
  colTabText:   { fontSize: 13, fontWeight: '600' },
  colTabCount:  { fontSize: 11, fontFamily: FAMILY.mono },
  // Approval hint (board view)
  approvalHint:     { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: IS_ANDROID ? 20 : 10, paddingHorizontal: 14, paddingVertical: 12 },
  approvalHintText: { fontSize: IS_ANDROID ? 13 : 12, lineHeight: 18, flex: 1 },
  emptyCol:         { fontSize: 13, textAlign: 'center', paddingVertical: 32 },
  addCardBtn:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: IS_ANDROID ? 14 : 12, borderWidth: 1.5, borderStyle: 'dashed', marginTop: 4 },
  addCardText:      { fontSize: IS_ANDROID ? 13.5 : 13, fontWeight: '500' },
  // Board columns (legacy horizontal mode — kept for non-board views)
  column:       { width: 270, paddingHorizontal: 10, paddingTop: 8 },
  colHeader:    { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 10, paddingHorizontal: 2 },
  colDot:       { width: 8, height: 8, borderRadius: 4 },
  colName:      { fontSize: 13, fontWeight: '800', flex: 1 },
  colBadge:     { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99 },
  // List
  listRow:      { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, padding: 12, borderWidth: 1 },
  listStatus:   { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, minWidth: 64, alignItems: 'center' },
  listTitle:    { fontSize: 13, fontWeight: '700' },
  listDue:      { fontSize: 10, marginTop: 2 },
  priDotSm:     { width: 8, height: 8, borderRadius: 4, marginTop: 4, flexShrink: 0 },
  // Schedule
  schedRow:     { flexDirection: 'row', gap: 12, alignItems: 'center', borderRadius: 12, padding: 14, borderWidth: 1 },
  schedDate:    { alignItems: 'center', width: 36 },
  schedDay:     { fontSize: 22, fontWeight: '900' },
  schedMon:     { fontSize: 9, fontWeight: '700', textTransform: 'uppercase' },
  schedBar:     { width: 3, alignSelf: 'stretch', borderRadius: 2, minHeight: 32 },
  // Tracker
  trackerLabel: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  trackerCount: { fontSize: 14, fontWeight: '900' },
  trackerTrack: { height: 10, borderRadius: 5, overflow: 'hidden' },
  trackerBar:   { height: 10, borderRadius: 5 },
  trackerTotal: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 16, borderTopWidth: 1 },
  // Modal
  overlay:      { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet:        { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, borderTopWidth: 1 },
  sheetHandle:  { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 18 },
  sheetTitle:   { fontSize: 18, fontWeight: '900', marginBottom: 16 },
  sheetInput:   { borderRadius: 11, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 13, fontSize: 14, marginBottom: 16 },
  sheetLabel:   { fontSize: 10, fontWeight: '800', letterSpacing: 2, marginBottom: 8 },
  colChip:      { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, marginRight: 8, borderWidth: 1.5 },
  priChip:      { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 99, borderWidth: 1.5 },
  sheetBtns:    { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelBtn:    { paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1 },
  cancelText:   { fontSize: 13, fontWeight: '700' },
  createBtn:    { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  createText:   { color: '#fff', fontSize: 13, fontWeight: '900', letterSpacing: 0.5 },
  empty:        { fontSize: 13, textAlign: 'center', marginTop: 40 },
  // shared
  sheetColor:   {},
});
