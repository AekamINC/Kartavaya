/**
 * NewTaskSheet — bottom-sheet task creation.
 * Matches web NewTaskModal field-for-field.
 * Client role: header = "Request task", hides Status + Assignees,
 * routes to POST /client/tasks/request instead of POST /tasks.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Platform, ActivityIndicator, Pressable,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../theme/ThemeProvider';
import { useAuth } from '../hooks/useAuth';
import { apiClient } from '../api/client';
import Sheet from './Sheet';
import { a11yButton, a11yInput, a11ySelected, a11yToggle, hitSlopTo } from './a11y';
import AttachmentSourceSheet, { type PickedFile } from './AttachmentSourceSheet';
import { File as FsFile } from 'expo-file-system';
import { oversizeMessage } from '../lib/uploadLimits';
import { enqueueMutation } from '../offline/mutationQueue';
import NetInfo from '@react-native-community/netinfo';
import { templatesApi } from '../api/templates';
import type { TeamMember, TaskTemplate } from '../api/types';
import { AVATAR_COLORS, PRIORITY_COLORS, withAlpha } from '../theme/tokens';
import BiLabel from '../theme/BiLabel';
import { display } from '../theme/fonts';

const MAX_ATTACHMENTS = 5;
/* The size caps come from `lib/uploadLimits`, which states the server's. The
   `MAX_MB = 5` that stood here was never read by anything, so nothing on this
   sheet stopped a 90-second 4K clip: it uploaded over mobile data for as long
   as that took and the server refused it on arrival. */

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * Priority is a key and a label here; the COLOUR comes from PRIORITY_COLORS at
 * render time.
 *
 * These four used to carry literal hexes, which made this the tenth independent
 * priority map in the product and froze it to light mode — 00 §9's --pr-* tokens
 * flip with the theme, so the light-mode urgent red was being drawn on the dark
 * sheet.
 */
const PRIORITY = [
  { key: 'urgent', label: 'Urgent' },
  { key: 'high',   label: 'High'   },
  { key: 'medium', label: 'Medium' },
  { key: 'low',    label: 'Low'    },
] as const;

type Priority = typeof PRIORITY[number]['key'];

export default function NewTaskSheet({ visible, onClose }: Props) {
  const { t, scheme } = useTheme();
  const { user }   = useAuth();
  const qc         = useQueryClient();
  const isClient   = user?.role === 'client';

  const [title,      setTitle]      = useState('');
  const [projectId,  setProjectId]  = useState<string | null>(null);
  const [status,     setStatus]     = useState<string>('todo');
  const [priority,   setPriority]   = useState<Priority>('medium');
  const [dueAt,      setDueAt]      = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [description,setDescription]= useState('');
  const [assignees,  setAssignees]  = useState<string[]>([]);
  const [attachments, setAttachments] = useState<{ name: string; url: string; key: string | null }[]>([]);
  const [showAttachPicker, setShowAttachPicker] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [titleError, setTitleError] = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  const [projects,   setProjects]   = useState<{ team_id: string; name: string; color?: string }[]>([]);
  // The project row renders nothing at all when the list is empty, so a failed
  // `/teams` read was indistinguishable from an org with no projects — the
  // picker simply could not be used and never said why.
  const [projectsErr, setProjectsErr] = useState(false);
  const [members,    setMembers]    = useState<TeamMember[]>([]);
  const [templates,  setTemplates]  = useState<TaskTemplate[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);

  // Reset on open
  useEffect(() => {
    if (!visible) return;
    setTitle(''); setProjectId(null); setStatus('todo'); setPriority('medium');
    setDueAt(null); setShowDatePicker(false); setDescription(''); setAssignees([]);
    setAttachments([]); setShowAttachPicker(false); setUploadingFiles(false);
    setTitleError(false); setError(null); setTemplates([]); setShowTemplates(false);
    setProjectsErr(false);
    apiClient.get('/teams')
      .then(r => { setProjects(Array.isArray(r.data) ? r.data : []); setProjectsErr(false); })
      .catch(() => { setProjects([]); setProjectsErr(true); });
  }, [visible]);

  // Fetch members + templates when project changes
  useEffect(() => {
    if (!projectId) { setMembers([]); setTemplates([]); return; }
    apiClient.get(`/teams/${projectId}`)
      .then(r => setMembers(Array.isArray(r.data?.members) ? r.data.members : []))
      .catch(() => setMembers([]));
    templatesApi.list(projectId)
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, [projectId]);

  function applyTemplate(tmpl: TaskTemplate) {
    const cfg = tmpl.config ?? {};
    if (cfg.title)       setTitle(cfg.title);
    if (cfg.description) setDescription(cfg.description);
    if (cfg.priority)    setPriority(cfg.priority as Priority);
    setShowTemplates(false);
  }

  const toggleAssignee = (uid: string) => {
    setAssignees(prev => prev.includes(uid) ? prev.filter(x => x !== uid) : [...prev, uid]);
  };

  const handleFilePicked = useCallback(async (files: PickedFile[]) => {
    if (attachments.length >= MAX_ATTACHMENTS) return;
    const slots = MAX_ATTACHMENTS - attachments.length;
    const toUpload = files.slice(0, slots);
    setError(null);

    /* The size, from whoever knows it. `PickedFile` carries none — both pickers
       have it and neither passes it on — so the file is measured on disk
       instead. All three sources hand back a local path (the document picker
       runs with `copyToCacheDirectory`), so this normally answers. When it does
       not, the file is uploaded: an unmeasurable file is a fact about the
       device, and the server still counts the bytes. */
    const sizeOf = (f: PickedFile): number | null => {
      const declared = (f as PickedFile & { size?: number; fileSize?: number }).size
        ?? (f as PickedFile & { fileSize?: number }).fileSize;
      if (typeof declared === 'number' && Number.isFinite(declared)) return declared;
      try {
        const bytes = new FsFile(f.uri).size;
        return typeof bytes === 'number' && bytes > 0 ? bytes : null;
      } catch {
        return null;
      }
    };

    const tooBig = oversizeMessage(toUpload.map(f => ({ name: f.name, size: sizeOf(f) })));
    if (tooBig) {
      setError(tooBig);
      return;
    }

    setUploadingFiles(true);
    // Declared outside the loop so a failure part-way through keeps what
    // already landed. Uploading four of five and then discarding all four —
    // which is what a single try around the whole loop did — leaves the files
    // in object storage, charges the user for them, and shows nothing.
    const uploaded: typeof attachments = [];
    try {
      for (const f of toUpload) {
        try {
          const fd = new FormData();
          fd.append('file', { uri: f.uri, name: f.name, type: f.type } as unknown as Blob);
          const res = await apiClient.post('/upload', fd);
          uploaded.push({ name: f.name, url: res.data.url, key: res.data.key ?? null });
        } catch (err) {
          /* The server's own sentence first. `api/client.ts` rewrites anything
             mentioning file size into "Maximum size is 5 MB", which is not the
             limit — so its friendly text is the fallback, not the headline, and
             a refusal that names a missing storage variable reaches the person
             who can set it. */
          const e = err as { response?: { data?: { detail?: unknown } }; friendlyMessage?: string };
          const detail = typeof e?.response?.data?.detail === 'string' ? e.response.data.detail : null;
          setError(detail || e?.friendlyMessage || `Could not upload ${f.name}. Try again.`);
          break;
        }
      }
    } finally {
      if (uploaded.length) setAttachments(prev => [...prev, ...uploaded]);
      setUploadingFiles(false);
    }
  }, [attachments]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleSubmit = async () => {
    if (!title.trim()) { setTitleError(true); return; }
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        title:    title.trim(),
        status,
        priority,
        description: description.trim() || null,
      };
      if (projectId)           payload.team_id           = projectId;
      if (dueAt) {
        // Extract date in IST (+5:30) via arithmetic — avoids relying on ICU/Intl timezone data
        // which is not guaranteed on Hermes/Android without full ICU bundle.
        const istMs = dueAt.getTime() + 5.5 * 60 * 60 * 1000;
        const dateStr = new Date(istMs).toISOString().slice(0, 10); // "YYYY-MM-DD" in IST
        payload.due_at = new Date(dateStr + 'T16:00:00+05:30').toISOString();
      }
      if (assignees.length)    payload.assignee_user_ids  = assignees;
      if (attachments.length)  payload.attachments        = attachments;

      const endpoint = isClient ? '/client/tasks/request' : '/tasks';
      const net = await NetInfo.fetch();
      const online = !!(net.isConnected && net.isInternetReachable !== false);

      if (online) {
        await apiClient.post(endpoint, payload);
        qc.invalidateQueries({ queryKey: ['tasks'] });
      } else {
        enqueueMutation({
          method:       'POST',
          url:          endpoint,
          body:         payload,
          entity_type:  'task',
        });
      }
      handleClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not create task.');
    } finally {
      setSaving(false);
    }
  };

  const s = styles(t);

  return (
    <Sheet
      visible={visible}
      onClose={handleClose}
      closeLabel="Close new task sheet"
      panelStyle={s.sheet}
      avoidKeyboard
    >
      {/* Handle */}
      <View style={s.handle} />

          {/* Header */}
          <View style={s.header}>
            <View>
              {/* Same split as FieldLabel — `नया कार्य` inside a tracked 800
                  kicker was breaking its own shirorekha. */}
              <BiLabel
                latinStyle={s.headerKicker}
                hindiStyle={{ color: t.primaryText }}
                hindiSize={11}
                style={{ marginBottom: 2 }}
              >
                {isClient ? 'REQUEST TASK · अनुरोध' : 'NEW TASK · नया कार्य'}
              </BiLabel>
              <Text style={s.headerTitle}>What needs doing?</Text>
            </View>
            <TouchableOpacity onPress={handleClose} hitSlop={12} {...a11yButton('Close')}>
              <Ionicons name="close" size={22} color={t.ink3} accessibilityElementsHidden />
            </TouchableOpacity>
          </View>

          <ScrollView style={s.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

            {/* Title */}
            <TextInput
              value={title}
              onChangeText={v => { setTitle(v); if (v.trim()) setTitleError(false); }}
              placeholder="Write a clear, action-first title…"
              placeholderTextColor={t.ink3}
              style={[s.titleInput, { borderBottomColor: titleError ? t.error : t.outline, color: t.ink }]}
              autoFocus
              multiline
              returnKeyType="done"
              blurOnSubmit
              onSubmitEditing={handleSubmit}
              /* The error was communicated by a red underline plus a line of
                 text the input never pointed at — RN has no `aria-describedby`
                 and its AccessibilityState has no `invalid`, so the only place
                 a screen reader will reliably meet the message is the field's
                 own name. The <Text> below keeps role="alert" for the moment
                 validation fires. */
              {...a11yInput(titleError ? 'Task title, required' : 'Task title')}
            />
            {titleError && (
              <Text
                style={[s.fieldError, { color: t.error }]}
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
              >
                Title is required.
              </Text>
            )}

            {/* Project */}
            <FieldLabel t={t}>PROJECT · परियोजना</FieldLabel>
            {projectsErr && (
              <Text style={[s.fieldError, { color: t.error }]}>
                Your projects did not load, so this task can only be filed as personal.
              </Text>
            )}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipRow}>
              {projects.map(p => (
                <TouchableOpacity
                  key={p.team_id}
                  onPress={() => setProjectId(p.team_id === projectId ? null : p.team_id)}
                  style={[s.chip, projectId === p.team_id && { borderColor: t.primary, backgroundColor: t.primary + '18' }]}
                  {...a11ySelected(p.name, projectId === p.team_id)}
                >
                  {p.color && <View style={[s.projectDot, { backgroundColor: p.color }]} accessibilityElementsHidden />}
                  <Text style={[s.chipText, projectId === p.team_id && { color: t.primary }]}>{p.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Templates — shown when a project is selected and has templates */}
            {projectId && templates.length > 0 && (
              <>
                <TouchableOpacity
                  onPress={() => setShowTemplates(v => !v)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, marginBottom: showTemplates ? 8 : 0 }}
                  {...a11yButton('Use a template')}
                  accessibilityState={{ expanded: showTemplates }}
                >
                  <Ionicons name={showTemplates ? 'chevron-down' : 'copy-outline'} size={14} color={t.primary} accessibilityElementsHidden />
                  {/* The last bilingual label in this file still rendered as a
                      single <Text>, so `fontWeight: '700'` and
                      `letterSpacing: 0.5` landed on `टेम्पलेट` as well as on the
                      Latin. There is no bold Tiro for the weight to resolve to,
                      and RN applies tracking after shaping, so the spacing
                      breaks the shirorekha. Every other label here already went
                      through BiLabel; this one was missed. */}
                  <BiLabel
                    latinStyle={{ fontSize: 12, fontWeight: '700', color: t.primary, letterSpacing: 0.5 }}
                    hindiStyle={{ color: t.primaryText }}
                    hindiSize={12}
                  >
                    USE A TEMPLATE · टेम्पलेट
                  </BiLabel>
                </TouchableOpacity>
                {showTemplates && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles(t).chipRow}>
                    {templates.map(tmpl => (
                      <TouchableOpacity
                        key={tmpl.template_id}
                        onPress={() => applyTemplate(tmpl)}
                        style={[styles(t).chip, { borderColor: t.primary, backgroundColor: t.primary + '12' }]}
                        {...a11yButton(tmpl.name, 'Fill this task from the template')}
                      >
                        {tmpl.icon ? <Text style={{ fontSize: 14 }}>{tmpl.icon}</Text> : null}
                        <Text style={[styles(t).chipText, { color: t.primary }]}>{tmpl.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
              </>
            )}

            {/* Status — hidden for clients */}
            {!isClient && (
              <>
                <FieldLabel t={t}>STATUS · स्थिति</FieldLabel>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipRow}>
                  {(['todo','in_progress','in_review','done'] as const).map(s2 => {
                    const labels: Record<string, string> = { todo: 'To do', in_progress: 'In progress', in_review: 'In review', done: 'Done' };
                    return (
                      <TouchableOpacity
                        key={s2}
                        onPress={() => setStatus(s2)}
                        style={[styles(t).chip, status === s2 && { borderColor: t.primary, backgroundColor: t.primary + '18' }]}
                        {...a11ySelected(labels[s2], status === s2)}
                      >
                        <Text style={[styles(t).chipText, status === s2 && { color: t.primary }]}>{labels[s2]}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </>
            )}

            {/* Priority */}
            <FieldLabel t={t}>PRIORITY · प्राथमिकता</FieldLabel>
            <View style={s.priorityRow}>
              {PRIORITY.map(p => (
                <TouchableOpacity
                  key={p.key}
                  onPress={() => setPriority(p.key)}
                  style={[s.priorityChip, priority === p.key && { borderColor: PRIORITY_COLORS[scheme][p.key], backgroundColor: withAlpha(PRIORITY_COLORS[scheme][p.key], 0.09) }]}
                  {...a11ySelected(`${p.label} priority`, priority === p.key)}
                >
                  <View style={[s.prioDot, { backgroundColor: PRIORITY_COLORS[scheme][p.key] }]} accessibilityElementsHidden />
                  <Text style={[s.priorityLabel, priority === p.key && { color: PRIORITY_COLORS[scheme][p.key], fontWeight: '700' }]}>{p.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Due date */}
            <FieldLabel t={t}>DUE DATE · नियत तिथि</FieldLabel>
            <TouchableOpacity
              onPress={() => setShowDatePicker(true)}
              style={[s.input, { justifyContent: 'center' }]}
              {...a11yButton(
                dueAt ? `Due date, ${dueAt.toLocaleDateString('en-CA')}` : 'Due date, not set',
                'Opens the date picker',
              )}
            >
              <Text style={{ color: dueAt ? t.ink : t.ink3, fontSize: 15 }}>
                {dueAt ? dueAt.toLocaleDateString('en-CA') : 'Select date'}
              </Text>
            </TouchableOpacity>
            {showDatePicker && (
              <DateTimePicker
                value={dueAt ?? new Date()}
                mode="date"
                display={Platform.OS === 'android' ? 'calendar' : 'spinner'}
                minimumDate={new Date()}
                onChange={(_, selected) => {
                  setShowDatePicker(Platform.OS === 'ios');
                  if (selected) setDueAt(selected);
                }}
              />
            )}

            {/* Assignees — hidden for clients */}
            {!isClient && projectId && members.length > 0 && (
              <>
                <FieldLabel t={t}>ASSIGNEES · नियुक्त</FieldLabel>
                <View style={s.memberList}>
                  {members.map((m, i) => {
                    const uid  = (m.user_id ?? m.member_id) as string;
                    const name = m.display_name ?? m.full_name ?? m.name ?? m.email ?? '';
                    if (!name || !uid) return null;
                    const checked = assignees.includes(uid);
                    const initials = name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
                    const avatarColors = AVATAR_COLORS;
                    const bg = avatarColors[i % avatarColors.length];
                    return (
                      <TouchableOpacity
                        key={uid}
                        onPress={() => toggleAssignee(uid)}
                        style={[s.memberRow, checked && { backgroundColor: t.primary + '12' }]}
                        {...a11yToggle(name, checked)}
                      >
                        <View style={[s.memberAvatar, { backgroundColor: bg }]} accessibilityElementsHidden>
                          <Text style={s.memberInitials}>{initials}</Text>
                        </View>
                        <Text style={[s.memberName, { color: t.ink }]}>{name}</Text>
                        {checked && <Ionicons name="checkmark-circle" size={18} color={t.primary} accessibilityElementsHidden />}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}

            {/* Attachments */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
              <FieldLabel t={t}>ATTACHMENTS · संलग्नक</FieldLabel>
              {attachments.length < MAX_ATTACHMENTS && (
                <TouchableOpacity
                  onPress={() => setShowAttachPicker(true)}
                  disabled={uploadingFiles}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingBottom: 8 }}
                  {...a11yButton(uploadingFiles ? 'Uploading attachments' : 'Add attachment')}
                  accessibilityState={{ disabled: uploadingFiles, busy: uploadingFiles }}
                >
                  {uploadingFiles
                    ? <ActivityIndicator size="small" color={t.primary} />
                    : <Ionicons name="add-circle-outline" size={18} color={t.primary} />
                  }
                  <Text style={{ fontSize: 12, color: t.primary, fontWeight: '600' }}>
                    {uploadingFiles ? 'Uploading…' : 'Add'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            {attachments.length === 0 && !uploadingFiles && (
              <TouchableOpacity
                onPress={() => setShowAttachPicker(true)}
                style={[s.attachEmpty, { borderColor: t.outline }]}
                {...a11yButton('Add attachment', 'Camera, photos, Drive or files')}
              >
                <Ionicons name="attach-outline" size={18} color={t.ink3} accessibilityElementsHidden />
                <Text style={{ fontSize: 13, color: t.ink3 }}>Camera · Photos · Drive · Files</Text>
              </TouchableOpacity>
            )}
            {attachments.length > 0 && (
              <View style={s.attachList}>
                {attachments.map((a, i) => {
                  const isImage = /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(a.name);
                  return (
                    <View key={i} style={[s.attachRow, { backgroundColor: t.bg, borderColor: t.outline }]}>
                      <Ionicons name={isImage ? 'image-outline' : 'document-outline'} size={14} color={t.primary} accessibilityElementsHidden />
                      <Text style={[s.attachName, { color: t.ink }]} numberOfLines={1}>{a.name}</Text>
                      <TouchableOpacity
                        onPress={() => setAttachments(prev => prev.filter((_, j) => j !== i))}
                        hitSlop={hitSlopTo(16)}
                        {...a11yButton(`Remove attachment ${a.name}`)}
                      >
                        <Ionicons name="close-circle" size={16} color={t.ink3} accessibilityElementsHidden />
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            )}

            {/* Description */}
            <FieldLabel t={t}>DESCRIPTION · विवरण</FieldLabel>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Add a description, brief, or checklist…"
              placeholderTextColor={t.ink3}
              style={[s.input, s.descInput, { color: t.ink }]}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              {...a11yInput('Description')}
            />

            {error && (
              <Text
                style={[s.fieldError, { color: t.error }]}
                accessibilityRole="alert"
                accessibilityLiveRegion="assertive"
              >
                {error}
              </Text>
            )}

            <View style={{ height: 24 }} />
          </ScrollView>

          {/* Submit */}
          <View style={s.footer}>
            <TouchableOpacity
              style={[s.btn, (!title.trim() || saving) && s.btnDisabled]}
              onPress={handleSubmit}
              disabled={!title.trim() || saving}
              {...a11yButton(isClient ? 'Send request' : 'Create task')}
              accessibilityState={{ disabled: !title.trim() || saving, busy: saving }}
            >
              {saving
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={s.btnText}>{isClient ? 'Submit Request' : 'Create Task'}</Text>
              }
            </TouchableOpacity>
          </View>
      <AttachmentSourceSheet
        visible={showAttachPicker}
        onClose={() => setShowAttachPicker(false)}
        onPicked={handleFilePicked}
        maxFiles={MAX_ATTACHMENTS - attachments.length}
      />
    </Sheet>
  );
}


/**
 * Every label here is bilingual — `PROJECT · परियोजना`, `STATUS · स्थिति`, and
 * five more — and all seven went into ONE <Text> carrying
 * `{ fontWeight: '800', letterSpacing: 1.2 }`.
 *
 * `letterSpacing` is the damaging half. React Native applies tracking after the
 * shaping engine runs, so it forces space between glyphs that are required to
 * join: the shirorekha breaks into disconnected segments and conjunct clusters
 * come apart. `fontWeight: '800'` is the other half — Tiro Devanagari Hindi
 * ships one weight (verified from the binary, `OS/2.usWeightClass = 400`), so
 * Android synthesises a fake bold and iOS falls back to the system face.
 *
 * BiLabel splits on the separator and gives each script its own typography. The
 * Latin run keeps the tracked uppercase kicker it was designed as; the Hindi run
 * gets the face that has the glyphs, no tracking, no synthetic weight.
 */
function FieldLabel({ children, t }: { children: string; t: ReturnType<typeof useTheme>['t'] }) {
  return (
    <BiLabel
      style={{ marginBottom: 8, marginTop: 16 }}
      latinStyle={{ fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: t.primary }}
      hindiStyle={{ color: t.primaryText }}
      hindiSize={11}
    >
      {children}
    </BiLabel>
  );
}

const styles = (t: ReturnType<typeof useTheme>['t']) => StyleSheet.create({
  // `backdrop` and `sheetWrap` are gone. The scrim and the bottom anchoring both
  // belong to Sheet now — this file's copy was `rgba(0,0,0,0.4)`, one of five
  // different scrim opacities the app was carrying (.4, .4, .45, .45, .55, .55).
  sheet: {
    backgroundColor: t.surface,
    borderTopLeftRadius:  24,
    borderTopRightRadius: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    maxHeight: '92%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 20,
  },
  handle: {
    width: 36, height: 4,
    backgroundColor: t.outline,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10, marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.outline,
  },
  headerKicker: {
    // marginBottom moved to the BiLabel wrapper — on the inner Latin <Text> it
    // would offset only that run inside the row, not the label.
    fontSize: 10, fontWeight: '800', letterSpacing: 1.2,
    color: t.primary,
  },
  headerTitle: {
    fontSize: 20,
    color: t.ink,
    // Was `Platform.OS === 'ios' ? 'Georgia' : 'serif'` — two different system
    // typefaces on the two platforms, neither of them the brand face. Android's
    // generic `serif` resolves to Noto Serif, which is a different design from
    // Georgia, so the same sheet header looked like two different products.
    // Newsreader is bundled and loaded at the root precisely so this is one
    // face everywhere; `display()` also carries the matching real weight rather
    // than letting the platform synthesise one.
    ...display(400),
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  titleInput: {
    fontSize: 20,
    // Same substitution as headerTitle. The task title the user types must be
    // the same face as the heading above it.
    ...display(400),
    color: t.ink,
    borderBottomWidth: 2,
    paddingBottom: 10,
    marginTop: 16,
    minHeight: 36,
  },
  fieldError: {
    fontSize: 11, marginTop: 4,
  },
  chipRow: {
    flexDirection: 'row',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: t.outline,
    marginRight: 8,
    backgroundColor: t.bg,
  },
  chipText: {
    fontSize: 13, color: t.ink3, fontWeight: '600',
  },
  projectDot: {
    width: 8, height: 8, borderRadius: 2,
  },
  priorityRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
  },
  priorityChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1.5,
    borderColor: t.outline,
  },
  prioDot: {
    width: 7, height: 7, borderRadius: 99,
  },
  priorityLabel: {
    fontSize: 13, color: t.ink3, fontWeight: '500',
  },
  input: {
    borderWidth: 1,
    borderColor: t.outline,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
    backgroundColor: t.bg,
  },
  descInput: {
    minHeight: 88,
    paddingTop: 12,
  },
  memberList: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: t.outline,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.outline,
  },
  memberAvatar: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
  },
  memberInitials: {
    fontSize: 11, fontWeight: '700', color: '#fff',
  },
  memberName: {
    flex: 1, fontSize: 14, fontWeight: '500',
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.outline,
  },
  btn: {
    backgroundColor: t.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.45 },
  btnText: {
    color: '#fff', fontWeight: '700', fontSize: 15,
  },
  attachEmpty: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1.5, borderStyle: 'dashed',
    borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14,
  },
  attachList: {
    gap: 6,
  },
  attachRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 9,
    borderRadius: 8, borderWidth: 1,
  },
  attachName: {
    flex: 1, fontSize: 13, fontWeight: '500',
  },
});
