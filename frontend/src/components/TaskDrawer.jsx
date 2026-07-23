import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../lib/api';
import { currentUser } from '../lib/auth';
import ConfirmDialog from './ui/ConfirmDialog';
import FieldRenderer from './fields/FieldRenderer';
import ActivityList from './ActivityList';
import { useToast } from './ui/toast';
import { logger } from '../lib/utils';

import DrawerHeader      from './drawer/DrawerHeader';
import DrawerMeta        from './drawer/DrawerMeta';
import DrawerSubtasks    from './drawer/DrawerSubtasks';
import DrawerComments    from './drawer/DrawerComments';
import DrawerAttachments from './drawer/DrawerAttachments';
import DrawerTimeEntries from './drawer/DrawerTimeEntries';
import DrawerApproval    from './drawer/DrawerApproval';
import BrandKit          from './BrandKit';
import { lbl }           from './drawer/constants';

const MAX_FILES    = 5;
const MAX_MB       = 25;
const MAX_MB_VIDEO = 50;
const VIDEO_EXT    = /\.(mov|mp4|webm|avi|mkv|m4v|3gp|3gpp|flv|wmv|asf|ogv|ts|mts|m2ts)$/i;

export default function TaskDrawer({ taskId, open, onClose, onSaved, teamMembers = [] }) {
  const me = currentUser();
  const { pushToast } = useToast();

  // ── Core task data ────────────────────────────────────────────────────────
  const [task,        setTask]       = useState(null);
  const [fields,      setFields]     = useState([]);
  const [fValues,     setFValues]    = useState({});
  const [draft,       setDraft]      = useState({});
  const [columns,     setColumns]    = useState([]);
  const [members,     setMembers]    = useState([]);
  const [categories,  setCategories] = useState([]);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [scrolled,     setScrolled]   = useState(false);
  const bodyRef = useRef(null);
  const [saving,       setSaving]     = useState(false);
  const [deletingTask, setDeletingTask] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const assigneeRef = useRef(null);
  const fileRef     = useRef(null);
  const videoRef    = useRef(null);

  // ── Collapse title on scroll ──────────────────────────────────────────────
  const handleBodyScroll = useCallback(() => {
    setScrolled((bodyRef.current?.scrollTop ?? 0) > 32);
  }, []);

  // ── Comments ──────────────────────────────────────────────────────────────
  const [comments,       setComments]       = useState([]);
  const [comment,        setComment]        = useState('');
  const [editingComment, setEditingComment] = useState(null);
  const [editBody,       setEditBody]       = useState('');

  // ── Subtasks ──────────────────────────────────────────────────────────────
  const [newSubtask,    setNewSubtask]    = useState('');
  const [addingSubtask, setAddingSubtask] = useState(false);

  // ── Attachments ───────────────────────────────────────────────────────────
  const [attachments,    setAttachments]    = useState([]);
  const [uploading,      setUploading]      = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // ── Time tracking ─────────────────────────────────────────────────────────
  const [entries,    setEntries]    = useState([]);
  const [timer,      setTimer]      = useState(null);
  const [manualMin,  setManualMin]  = useState('');
  const [manualDesc, setManualDesc] = useState('');

  // ── Activity ──────────────────────────────────────────────────────────────
  const [activity, setActivity] = useState([]);
  const [actLoad,  setActLoad]  = useState(false);

  // ── Approval ──────────────────────────────────────────────────────────────
  const [approvalLoading,  setApprovalLoading]  = useState(false);
  const [approvalNotes,    setApprovalNotes]    = useState('');
  const [requestNotes,     setRequestNotes]     = useState('');
  const [rejectNote,       setRejectNote]       = useState('');
  const [clientList,       setClientList]       = useState([]);
  const [clientUserId,     setClientUserId]     = useState('');
  const [showApprovePanel, setShowApprovePanel] = useState(false);
  const [showRequestPanel, setShowRequestPanel] = useState(false);
  const [showRejectInput,  setShowRejectInput]  = useState(false);

  // ── Close assignee dropdown on outside click ──────────────────────────────
  useEffect(() => {
    if (!assigneeOpen) return;
    const handler = e => {
      if (assigneeRef.current && !assigneeRef.current.contains(e.target)) setAssigneeOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [assigneeOpen]);

  // ── Load task on open ─────────────────────────────────────────────────────
  const mentionSource = teamMembers.length > 0 ? teamMembers : members;
  const mentionMembers = mentionSource.map(m => ({
    user_id:      m.user_id,
    display_name: m.display_name || m.full_name || m.email || 'Unknown',
  }));

  useEffect(() => {
    if (!open || !taskId) return;
    setScrolled(false);
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    setTask(null); setFields([]); setFValues({});
    setComments([]); setActivity([]); setEntries([]); setTimer(null); setAttachments([]);
    setMembers([]); setAssigneeOpen(false); setActLoad(false);

    api.get('/categories').then(r => setCategories(Array.isArray(r.data) ? r.data : [])).catch(() => {});

    Promise.all([
      api.get(`/tasks/${taskId}`),
      api.get(`/tasks/${taskId}/comments`),
      api.get(`/activity/task/${taskId}`).catch(() => ({ data: [] })),
      api.get(`/time/task/${taskId}`).catch(() => ({ data: { entries: [], active_entry: null } })),
    ]).then(([tRes, cRes, actRes, timeRes]) => {
      setActivity(Array.isArray(actRes.data) ? actRes.data : []);
      setEntries(timeRes.data?.entries || []);
      setTimer(timeRes.data?.active_entry || null);
      const t = tRes.data;
      setTask(t);
      setDraft({ title: t.title, description: t.description, priority: t.priority, due_at: t.due_at, status: t.status, category_id: t.category_id || '', reminders: t.reminders || [] });
      setComments(Array.isArray(cRes.data) ? cRes.data : []);
      const att = t.attachments || [];
      setAttachments(Array.isArray(att) ? att.map(a => typeof a === 'string' ? { url: a, name: a.split('/').pop() } : a) : []);
      if (t.team_id) {
        api.get(`/projects/${t.team_id}/columns`).then(r => setColumns(Array.isArray(r.data) ? r.data : [])).catch(() => {});
        api.get(`/teams/${t.team_id}`).then(r => setMembers(Array.isArray(r.data?.members) ? r.data.members : [])).catch(() => {});
        api.get(`/fields/team/${t.team_id}`).then(r => {
          const defs = r.data.map(f =>
            f.type === 'person' ? { ...f, config: { ...f.config, members: mentionMembers } } : f
          );
          setFields(defs);
        });
        api.get(`/fields/task/${taskId}/values`).then(r => {
          const vals = {};
          r.data.forEach(v => { vals[v.field_id] = v.value; });
          setFValues(vals);
        });
      }
    }).catch(logger.error);
  }, [open, taskId]); // eslint-disable-line react-hooks/exhaustive-deps


  // ── Core task actions ─────────────────────────────────────────────────────
  const saveTask = useCallback(async patch => {
    setSaving(true);
    try {
      const res = await api.put(`/tasks/${taskId}`, patch);
      setTask(res.data);
      onSaved?.(res.data);
    } catch (e) { logger.error('Save failed', e); }
    finally { setSaving(false); }
  }, [taskId, onSaved]);

  const saveReminders = useCallback(async (reminders) => {
    setSaving(true);
    try {
      const payload = reminders.map(r => ({
        offset_minutes: r.offset_minutes,
        channels: Object.entries(r.channels).filter(([, v]) => v).map(([k]) => k),
      }));
      const res = await api.put(`/tasks/${taskId}/reminders`, payload);
      setTask(prev => ({ ...prev, reminders: res.data }));
      setDraft(prev => ({ ...prev, reminders: res.data }));
    } catch (e) { logger.error('Reminder save failed', e); }
    finally { setSaving(false); }
  }, [taskId]);

  const saveFieldValue = useCallback(async (field_id, value) => {
    setFValues(prev => ({ ...prev, [field_id]: value }));
    try { await api.put(`/fields/task/${taskId}/values`, [{ field_id, value }]); }
    catch (e) { logger.error('Field save failed', e); }
  }, [taskId]);

  const toggleAssignee = useCallback(async uid => {
    const current = task?.assignee_user_ids || [];
    const next = current.includes(uid) ? current.filter(x => x !== uid) : [...current, uid];
    setTask(t => ({ ...t, assignee_user_ids: next }));
    try { await api.put(`/tasks/${taskId}`, { assignee_user_ids: next }); }
    catch (e) { logger.error(e); }
  }, [task, taskId]);

  const onColumnChange = useCallback(async colId => {
    try {
      const res = await api.patch(`/tasks/${taskId}/move`, { column_id: colId, order: 999 });
      setTask(res.data);
      setDraft(d => ({ ...d, status: res.data.status }));
      onSaved?.(res.data);
    } catch { /* ignore */ }
  }, [taskId, onSaved]);

  const handleDeleteTask = useCallback(() => {
    setConfirmState({
      message: 'Delete this task? This cannot be undone.',
      confirmLabel: 'Delete',
      onConfirm: async () => {
        setDeletingTask(true);
        try {
          await api.delete(`/tasks/${taskId}`);
          onSaved?.(null);
          onClose();
        } catch (e) {
          logger.error(e);
          pushToast({ type: 'error', title: e?.response?.data?.detail || 'Could not delete task' });
          setDeletingTask(false);
        }
      },
    });
  }, [taskId, onSaved, onClose, pushToast]);

  const handleArchiveTask = useCallback(async () => {
    try {
      const res = await api.patch(`/tasks/${taskId}/archive`);
      setTask(res.data);
      onSaved?.(res.data);
      pushToast({ type: 'success', title: 'Task archived' });
    } catch { pushToast({ type: 'error', title: 'Could not archive task' }); }
  }, [taskId, onSaved, pushToast]);

  const handleUnarchiveTask = useCallback(async () => {
    try {
      const res = await api.patch(`/tasks/${taskId}/unarchive`);
      setTask(res.data);
      onSaved?.(res.data);
      pushToast({ type: 'success', title: 'Task restored' });
    } catch { pushToast({ type: 'error', title: 'Could not restore task' }); }
  }, [taskId, onSaved, pushToast]);

  // ── Comment actions ───────────────────────────────────────────────────────
  const postComment = async () => {
    if (!comment.trim()) return;
    const res = await api.post(`/tasks/${taskId}/comments`, { body: comment });
    setComments(prev => [...prev, res.data]);
    setComment('');
  };

  const deleteComment = async commentId => {
    await api.delete(`/tasks/${taskId}/comments/${commentId}`);
    setComments(prev => prev.filter(c => c.comment_id !== commentId));
  };

  const startEditComment = c => {
    if (!c) { setEditingComment(null); setEditBody(''); return; }
    setEditingComment(c.comment_id); setEditBody(c.body);
  };

  const saveEditComment = async commentId => {
    if (!editBody.trim()) return;
    const res = await api.put(`/tasks/${taskId}/comments/${commentId}`, { body: editBody });
    setComments(prev => prev.map(c => c.comment_id === commentId ? { ...c, body: res.data.body } : c));
    setEditingComment(null); setEditBody('');
  };

  // ── Subtask actions ───────────────────────────────────────────────────────
  const addSubtask = async () => {
    if (!newSubtask.trim()) return;
    setAddingSubtask(true);
    try {
      const res = await api.post(`/tasks/${taskId}/subtasks`, { title: newSubtask });
      setTask(res.data); setNewSubtask('');
    } catch (e) { logger.error(e); }
    finally { setAddingSubtask(false); }
  };

  const toggleSubtask = async subtaskId => {
    const res = await api.patch(`/tasks/${taskId}/subtasks/${subtaskId}`);
    setTask(res.data);
  };

  const deleteSubtask = async subtaskId => {
    const res = await api.delete(`/tasks/${taskId}/subtasks/${subtaskId}`);
    setTask(res.data);
  };

  const updateSubtaskAssignee = useCallback(async (subtaskId, uid) => {
    try {
      const res = await api.put(`/tasks/${taskId}/subtasks/${subtaskId}`, { assignee_user_id: uid || null });
      setTask(res.data);
    } catch (e) { logger.error(e); }
  }, [taskId]);

  // ── Attachment actions ────────────────────────────────────────────────────
  const handleFileChange = async e => {
    const picked = Array.from(e.target.files);
    if (!picked.length) return;

    const slots = MAX_FILES - attachments.length;
    if (slots <= 0) {
      pushToast({ type: 'error', title: `Max ${MAX_FILES} files per task` });
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    const toUpload = picked.slice(0, slots);
    if (toUpload.length < picked.length)
      pushToast({ type: 'error', title: `Only ${slots} slot(s) remaining — uploading first ${slots}` });

    const oversized = toUpload.filter(f => {
      const isVideo = VIDEO_EXT.test(f.name);
      return f.size > (isVideo ? MAX_MB_VIDEO : MAX_MB) * 1024 * 1024;
    });
    if (oversized.length) {
      pushToast({ type: 'error', title: `${oversized.map(f => f.name).join(', ')} exceed the file size limit` });
      if (fileRef.current) fileRef.current.value = '';
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    try {
      const newFiles = [];
      const teamId = task?.team_id;
      for (let i = 0; i < toUpload.length; i++) {
        const file = toUpload[i];
        const controller = new AbortController();
        let stallTimer = null;
        const kickStall = () => {
          clearTimeout(stallTimer);
          stallTimer = setTimeout(() => controller.abort('stall'), 30_000);
        };
        kickStall();
        try {
          const fd = new FormData();
          fd.append('file', file);
          const url = teamId ? `/upload?team_id=${encodeURIComponent(teamId)}` : '/upload';
          const res = await api.post(url, fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
            signal: controller.signal,
            noRetry: true,
            onUploadProgress: (ev) => {
              kickStall();
              if (ev.total) {
                const filePct = ev.loaded / ev.total;
                setUploadProgress(Math.round(((i + filePct) / toUpload.length) * 100));
              }
            },
          });
          clearTimeout(stallTimer);
          newFiles.push({ name: file.name, url: res.data.url, key: res.data.key, size: res.data.size, is_private: false, visible_to: [] });
          setUploadProgress(Math.round(((i + 1) / toUpload.length) * 100));
        } catch (err) {
          clearTimeout(stallTimer);
          if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') {
            pushToast({ type: 'error', title: 'Upload got stuck', message: 'No data transferred for 30 s. Check your connection and try again — if it keeps happening, please report it.' });
          } else {
            pushToast({ type: 'error', title: err?.response?.data?.detail || 'Upload failed' });
          }
          return;
        }
      }
      const updated = [...attachments, ...newFiles];
      setAttachments(updated);
      await saveTask({ attachments: updated.map(f => ({ name: f.name, url: f.url, key: f.key || null, is_private: f.is_private || false, visible_to: f.visible_to || [] })) });
      pushToast({ type: 'success', title: `${newFiles.length} file${newFiles.length > 1 ? 's' : ''} uploaded` });
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileRef.current)  fileRef.current.value  = '';
      if (videoRef.current) videoRef.current.value = '';
    }
  };

  const removeAttachment = async idx => {
    const updated = attachments.filter((_, i) => i !== idx);
    setAttachments(updated);
    await saveTask({ attachments: updated.map(f => ({ name: f.name, url: f.url, key: f.key || null, is_private: f.is_private || false, visible_to: f.visible_to || [] })) });
  };

  const handlePrivacyChange = async (idx, updatedFile) => {
    const updated = attachments.map((f, i) => i === idx ? updatedFile : f);
    setAttachments(updated);
    await saveTask({ attachments: updated.map(f => ({ name: f.name, url: f.url, key: f.key || null, is_private: f.is_private || false, visible_to: f.visible_to || [] })) });
  };

  // ── Time actions ──────────────────────────────────────────────────────────
  const startTimer = async () => { const res = await api.post(`/time/start?task_id=${taskId}`); setTimer(res.data); };
  const stopTimer  = async () => { const res = await api.post('/time/stop'); setTimer(null); setEntries(prev => [res.data, ...prev]); };
  const addManual  = async () => {
    const mins = parseInt(manualMin);
    if (!mins || mins < 1) return;
    const res = await api.post('/time/manual', { task_id: taskId, minutes: mins, description: manualDesc });
    setEntries(prev => [res.data, ...prev]);
    setManualMin(''); setManualDesc('');
  };
  const deleteEntry = async id => { await api.delete(`/time/${id}`); setEntries(prev => prev.filter(e => e.entry_id !== id)); };

  // ── Approval actions ──────────────────────────────────────────────────────
  const requestApproval = async () => {
    setApprovalLoading(true);
    try {
      await api.post(`/tasks/${taskId}/request-approval`, { notes: requestNotes });
      const fresh = await api.get(`/tasks/${taskId}`);
      setTask(fresh.data);
      setDraft(d => ({ ...d, status: fresh.data.status, column_id: fresh.data.column_id }));
      onSaved?.(fresh.data);
      setShowRequestPanel(false); setRequestNotes('');
      pushToast({ type: 'success', title: 'Approval request sent' });
    } catch (e) {
      logger.error(e);
      pushToast({ type: 'error', title: e?.response?.data?.detail || 'Could not send approval request' });
    }
    finally { setApprovalLoading(false); }
  };

  const openApprovePanel = () => {
    setShowApprovePanel(true);
    setClientList([]); setClientUserId('');
    if (task?.team_id) {
      api.get(`/teams/${task.team_id}/clients`)
        .then(r => setClientList(Array.isArray(r.data) ? r.data : []))
        .catch(() => {});
    }
  };

  const approveTask = async () => {
    setApprovalLoading(true);
    const selected = clientList.find(c => c.user_id === clientUserId);
    try {
      if (selected) {
        // Forward to client for their approval
        const res = await api.post(`/tasks/${taskId}/request-client-approval`, {
          client_email: selected.email,
          notes: approvalNotes,
        });
        setTask(t => ({ ...t, approval_status: res.data.approval_status }));
      } else {
        // Directly approve — reload full task so column/status refresh
        await api.post(`/tasks/${taskId}/approve`, { notes: approvalNotes });
        const fresh = await api.get(`/tasks/${taskId}`);
        setTask(fresh.data);
        setDraft(d => ({ ...d, status: fresh.data.status, column_id: fresh.data.column_id }));
        onSaved?.(fresh.data);
      }
      setShowApprovePanel(false); setApprovalNotes(''); setClientUserId('');
    } catch (e) {
      logger.error(e);
      pushToast({ type: 'error', title: e?.response?.data?.detail || 'Could not approve task' });
    }
    finally { setApprovalLoading(false); }
  };

  const rejectTask = async () => {
    if (!rejectNote.trim()) return;
    setApprovalLoading(true);
    try {
      await api.post(`/tasks/${taskId}/reject`, { notes: rejectNote });
      const fresh = await api.get(`/tasks/${taskId}`);
      setTask(fresh.data);
      setDraft(d => ({ ...d, status: fresh.data.status, column_id: fresh.data.column_id }));
      onSaved?.(fresh.data);
      setShowRejectInput(false); setRejectNote('');
    } catch (e) {
      logger.error(e);
      pushToast({ type: 'error', title: e?.response?.data?.detail || 'Could not reject task' });
    }
    finally { setApprovalLoading(false); }
  };

  const clientApproveTask = async () => {
    setApprovalLoading(true);
    try {
      await api.post(`/tasks/${taskId}/client-approve`, { notes: '' });
      setTask(t => ({ ...t, approval_status: 'approved' }));
      onSaved?.({ ...task, approval_status: 'approved' });
    } catch (e) { logger.error(e); }
    finally { setApprovalLoading(false); }
  };

  const clientRejectTask = async () => {
    if (!rejectNote.trim()) return;
    setApprovalLoading(true);
    try {
      await api.post(`/tasks/${taskId}/client-reject`, { notes: rejectNote });
      setTask(t => ({ ...t, approval_status: 'rejected' }));
      setShowRejectInput(false); setRejectNote('');
    } catch (e) { logger.error(e); }
    finally { setApprovalLoading(false); }
  };

  // ── Permission helpers ────────────────────────────────────────────────────
  const isSystemAdmin = me?.role === 'admin';
  const isOwnerAdmin  = me?.role === 'admin' || me?.role === 'owner';
  const isClient      = me?.role === 'client';
  const canDeleteTask = isSystemAdmin || (task && teamMembers.find(m => m.user_id === me?.user_id && (m.role === 'admin' || m.role === 'owner')));

  if (!open) return null;

  return (
    <>
      <div className="k-dr-scrim" onClick={e => e.target === e.currentTarget && onClose()}>
        <div className={`k-dr${scrolled ? ' is-scrolled' : ''}`}>

          <DrawerHeader
            task={task} draft={draft} setDraft={setDraft} saving={saving}
            canDeleteTask={canDeleteTask} deletingTask={deletingTask}
            onClose={onClose} onDeleteTask={handleDeleteTask} saveTask={saveTask}
            onArchiveTask={!isClient ? handleArchiveTask : undefined}
            onUnarchiveTask={!isClient ? handleUnarchiveTask : undefined}
            scrolled={scrolled}
          />

          <DrawerMeta
            task={task} draft={draft} setDraft={setDraft} saveTask={saveTask}
            saveReminders={saveReminders}
            onColumnChange={onColumnChange}
            columns={columns} members={members} categories={categories}
            assigneeOpen={assigneeOpen} setAssigneeOpen={setAssigneeOpen}
            assigneeRef={assigneeRef} toggleAssignee={toggleAssignee}
          />

          {/* Single scrollable body — all sections stacked */}
          <div className="k-dr__body" ref={bodyRef} onScroll={handleBodyScroll}>

            {!task && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {[65, 40, 80, 40].map((w, i) => (
                  <div key={i} style={{ height: 14, background: 'var(--rule-soft)', borderRadius: 4, width: `${w}%` }} />
                ))}
              </div>
            )}

            {task && (
              <>
                {/* ── Description ── */}
                <div style={{ marginBottom: 20 }}>
                  <span style={lbl}>
                    Description{' '}
                    <span style={{ fontFamily: 'var(--font-hindi)', fontSize: 12, textTransform: 'none', letterSpacing: 0, color: 'var(--ink-faint)', fontWeight: 400 }}>
                      &#x0935;&#x093F;&#x0935;&#x0930;&#x0923;
                    </span>
                  </span>
                  <textarea
                    className="k-input"
                    value={draft.description || ''}
                    onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
                    onBlur={() => draft.description !== task.description && saveTask({ description: draft.description })}
                    rows={5}
                    style={{ width: '100%', resize: 'vertical', lineHeight: 1.65, fontSize: 13 }}
                    placeholder="Add a description&hellip;"
                  />
                </div>

                {/* ── Subtasks ── */}
                <DrawerSubtasks
                  task={task} members={members}
                  newSubtask={newSubtask} setNewSubtask={setNewSubtask}
                  addingSubtask={addingSubtask}
                  addSubtask={addSubtask} toggleSubtask={toggleSubtask}
                  deleteSubtask={deleteSubtask} updateSubtaskAssignee={updateSubtaskAssignee}
                />

                {/* ── Custom fields ── */}
                {fields.length > 0 && (
                  <div style={{ marginBottom: 20 }}>
                    <span style={lbl}>Custom Fields</span>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 12 }}>
                      {fields.map(f => (
                        <div key={f.field_id}>
                          <span style={lbl}>{f.name}</span>
                          <FieldRenderer field={f} value={fValues[f.field_id] ?? null} onChange={v => saveFieldValue(f.field_id, v)} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Approval ── */}
                {task.team_id && (
                  <DrawerApproval
                    task={task}
                    isOwnerAdmin={isOwnerAdmin} isClient={isClient}
                    showApprovePanel={showApprovePanel}   setShowApprovePanel={setShowApprovePanel}
                    showRequestPanel={showRequestPanel}   setShowRequestPanel={setShowRequestPanel}
                    showRejectInput={showRejectInput}     setShowRejectInput={setShowRejectInput}
                    approvalLoading={approvalLoading}
                    approvalNotes={approvalNotes}         setApprovalNotes={setApprovalNotes}
                    requestNotes={requestNotes}           setRequestNotes={setRequestNotes}
                    rejectNote={rejectNote}               setRejectNote={setRejectNote}
                    clientList={clientList}               clientUserId={clientUserId} setClientUserId={setClientUserId}
                    requestApproval={requestApproval}     openApprovePanel={openApprovePanel}
                    approveTask={approveTask}             rejectTask={rejectTask}
                    clientApproveTask={clientApproveTask} clientRejectTask={clientRejectTask}
                  />
                )}

                {/* ── Comments ── */}
                <DrawerComments
                  comments={comments} comment={comment} setComment={setComment}
                  postComment={postComment} deleteComment={deleteComment}
                  editingComment={editingComment} editBody={editBody} setEditBody={setEditBody}
                  startEditComment={startEditComment} saveEditComment={saveEditComment}
                  me={me} isSystemAdmin={isSystemAdmin} mentionMembers={mentionMembers}
                />

                {/* ── Files ── */}
                <div className="k-dr__section">
                  <div className="k-dr__sec-hd">
                    Files <span className="k-dr__sec-hi">फ़ाइलें</span>
                    {attachments.length > 0 && <span className="k-dr__sec-count">{attachments.length}</span>}
                  </div>
                  <DrawerAttachments
                    attachments={attachments} uploading={uploading} uploadProgress={uploadProgress}
                    fileRef={fileRef} videoRef={videoRef} handleFileChange={handleFileChange}
                    removeAttachment={removeAttachment}
                    onPrivacyChange={handlePrivacyChange}
                    members={members}
                    currentUserId={me?.user_id}
                  />
                </div>

                {/* ── Activity ── */}
                <div className="k-dr__section">
                  <div className="k-dr__sec-hd">
                    Activity <span className="k-dr__sec-hi">क्रिया</span>
                  </div>
                  <ActivityList events={activity} loading={actLoad} />
                </div>

                {/* ── Time (non-client) ── */}
                {!isClient && (
                  <div className="k-dr__section">
                    <div className="k-dr__sec-hd">
                      Time <span className="k-dr__sec-hi">काल</span>
                    </div>
                    <DrawerTimeEntries
                      timer={timer} entries={entries}
                      manualMin={manualMin} setManualMin={setManualMin}
                      manualDesc={manualDesc} setManualDesc={setManualDesc}
                      startTimer={startTimer} stopTimer={stopTimer}
                      addManual={addManual} deleteEntry={deleteEntry}
                    />
                  </div>
                )}

                {/* ── Brand Kit (non-client) ── */}
                {!isClient && (
                  <div className="k-dr__section">
                    <div className="k-dr__sec-hd">
                      Brand Kit <span className="k-dr__sec-hi">ब्रांड</span>
                    </div>
                    <BrandKit mode="display" />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </>
  );
}
