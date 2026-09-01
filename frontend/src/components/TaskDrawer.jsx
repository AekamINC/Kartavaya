import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api, rows } from '../lib/api';
import { sharedGet } from '../lib/sharedGet';
import { currentUser } from '../lib/auth';
import { navContext } from './layout/navConfig';
import ConfirmDialog from './ui/ConfirmDialog';
import FocusTrap from './ui/FocusTrap';
import FieldRenderer from './fields/FieldRenderer';
import ActivityList from './ActivityList';
import { useToast, TOAST_LIFE_MS } from './ui/toast';
import { useSheetSnap } from './ui/BottomSheet';
import useMediaQuery from '../hooks/useMediaQuery';
import { logger } from '../lib/utils';
import { oversizeMessage } from '../lib/uploadLimits';

import DrawerHeader      from './drawer/DrawerHeader';
import DrawerTitle       from './drawer/DrawerTitle';
import StatusPipeline    from './drawer/StatusPipeline';
import DrawerMeta        from './drawer/DrawerMeta';
import DrawerTabs        from './drawer/DrawerTabs';
import DrawerSubtasks    from './drawer/DrawerSubtasks';
import DrawerComments    from './drawer/DrawerComments';
import DrawerAttachments from './drawer/DrawerAttachments';
import DrawerTimeEntries from './drawer/DrawerTimeEntries';
import DrawerApproval    from './drawer/DrawerApproval';
import Lbl               from './drawer/DrawerLabel';
import useAutosave       from './drawer/useAutosave';
import { apiErrorText } from '../lib/apiError';

/**
 * TaskDrawer — ORCHESTRATION ONLY (03 §5).
 *
 * It owns the task's data and the requests that change it. Everything that
 * draws is a component under `drawer/`: `StatusPipeline`, `DrawerTitle` and
 * `DrawerTabs` came out of here, and the autosave timer moved to
 * `useAutosave`.
 *
 * The exit animation is the reason `open` is not simply `if (!open) return
 * null`. A drawer that unmounts instantly never plays `dmDrawerOut`, and 26 §6
 * is explicit that the exit is a step faster than the entrance rather than
 * absent. `requestClose` sets `.is-closing` and the panel's own `animationend`
 * calls the parent's `onClose` — the animation's real duration, not a literal
 * copy of it, which is what `EXIT_FALLBACK_MS` below is about. Under
 * `prefers-reduced-motion` it closes immediately, because a stall with no
 * animation to justify it is just lag.
 */

const MAX_FILES    = 10;
/* The size caps are the SERVER's and are imported, not restated. This file
   claimed 25 MB for a document and 50 MB for video against `uploads.py`'s 10
   and 25 — so a 40 MB clip was accepted here, uploaded in full, and refused on
   arrival. See `lib/uploadLimits`. */
/* A BACKSTOP, not the schedule. The unmount is driven by `animationend` on the
   panel, which is the only thing that knows how long `dmDrawerOut` actually
   ran: `--dur-base` is `calc(220ms * var(--ix))`, and `--ix` is .5 at
   Animations = Reduced and .001 at None. A fixed 220ms held the drawer mounted
   at `opacity: 0` for 110ms after it finished at Reduced, and for the whole
   219.78ms at None — a fifth of a second of an invisible panel over an
   unclickable board, delivered to the user who asked for no animation.
   MOTION-SPEC §1: never write a literal duration.

   The timer stays because `animationend` does not fire if the node is hidden,
   the animation is cancelled, or the tab is backgrounded mid-exit, and a drawer
   that never unmounts is worse than one that unmounts late. 420ms clears the
   longest real exit (220ms) with room for a slow frame. */
const EXIT_FALLBACK_MS = 420;

/**
 * The shape an attachment is SAVED in — written once because it was written
 * three times and one field went missing from all three.
 *
 * ⚠ `size` USED TO BE DROPPED HERE, and it is why 53 of the 59 attachment
 * elements in this database carry no size at all. `handleFileChange` reads it
 * off the upload response and holds it in state; every one of these maps then
 * rebuilt the object without it, so the value was thrown away on the very save
 * that persisted the file. `server.py`'s own `Attachment` model records the
 * other half of this: "TaskDrawer.jsx has been sending `size` at upload all
 * along, where the model silently discarded it." The model was fixed; this was
 * not, so the field went on vanishing one layer up.
 *
 * It stopped being cosmetic when the recycle bin landed. `deleted_files.size_bytes`
 * is what the quota is credited by at purge — so a file saved without its size
 * is one an org can never get its space back for, and the bin would report a
 * successful permanent delete that freed nothing.
 *
 * `uploaded_by` is deliberately NOT carried: it is a user_id, it is INTERNAL,
 * and the model's comment says it must never reach a client.
 */
const attachmentForSave = (f) => ({
  name: f.name,
  url: f.url,
  key: f.key || null,
  size: typeof f.size === 'number' ? f.size : null,
  is_private: f.is_private || false,
  visible_to: f.visible_to || [],
});

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
  /** This caller's role ON THIS PROJECT, from `GET /teams/{id}.your_role`. */
  const [myRole,      setMyRole]     = useState(null);
  const [categories,  setCategories] = useState([]);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [scrolled,     setScrolled]   = useState(false);
  const bodyRef = useRef(null);
  const [saving,       setSaving]     = useState(false);
  const [closing,      setClosing]    = useState(false);
  const [deletingTask, setDeletingTask] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  const closeTimer = useRef(null);
  const fileRef    = useRef(null);
  const videoRef   = useRef(null);

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
  // `null` when the log loaded, an error when it did not — the two are
  // different facts and the panel says so.
  const [timeErr,    setTimeErr]    = useState(null);
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

  const handleBodyScroll = useCallback(() => {
    setScrolled((bodyRef.current?.scrollTop ?? 0) > 32);
  }, []);

  const mentionSource = teamMembers.length > 0 ? teamMembers : members;
  /* THE LADDER MUST NOT REACH AN EMAIL, and here that is two rules at once.
     The owner's (2026-08-23): a person is named by their name, and an address
     used as a label is a contact detail rendered as an identity — the backend's
     `display_name()` was fixed for exactly this and ends at 'Unnamed member'.
     And the mechanical one: the composer INSERTS whatever it shows, and the
     resolver MATCHES on what `display_name()` produces. A rung the two do not
     share is a mention that is offered, picked, inserted — and then resolves to
     nobody, silently, which is the failure this whole item is about.
     MEASURED: 0 of 35 accounts have neither name, so this changes nothing on
     screen today; it stops the two sides drifting the first time one does. */
  const mentionMembers = mentionSource.map(m => ({
    user_id:      m.user_id,
    display_name: m.display_name || m.full_name || m.name || 'Unnamed member',
  }));

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const finishClose = useCallback(() => { setClosing(false); onClose(); }, [onClose]);

  const requestClose = useCallback(() => {
    if (typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
      onClose();
      return;
    }
    setClosing(true);
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(finishClose, EXIT_FALLBACK_MS);
  }, [onClose, finishClose]);

  /* Fired by `animationend` on the panel. Guarded on the animation NAME and on
     `closing`: `.dr` also runs `dmDrawerIn` on open, and its animationend
     bubbles to the same element — without the guard, opening the drawer closes
     it. `animationName` is the resolved keyframe name, so it survives the
     token indirection. */
  const handleExitEnd = useCallback((e) => {
    if (!closing || e.target !== e.currentTarget) return;
    // Two exits, because there are two forms of this panel. Under 768px `.dr`
    // is a bottom sheet and leaves with `dmSheetOut`; above it, a right-anchored
    // drawer leaving with `dmDrawerOut`. Listing only the drawer's name meant
    // that on a phone the guard never matched, the `animationend` was ignored,
    // and the close fell through to the EXIT_FALLBACK_MS timer — so every
    // dismissal on the device where the sheet lives was 420ms of dead panel
    // instead of the animation's own length.
    if (e.animationName !== 'dmDrawerOut' && e.animationName !== 'dmSheetOut') return;
    clearTimeout(closeTimer.current);
    finishClose();
  }, [closing, finishClose]);

  /* ── The drawer as a bottom sheet, under 768px ───────────────────────────
     MOTION-SPEC §5: "Task drawer — desktop `min(560px, 92vw)`, touch: sheet,
     snap 58% / 94%". The panel below was `position: fixed; inset 0 right` at
     every width, so on a 390px phone it covered the entire screen with no
     handle, no snap points and nothing to swipe — the one interaction
     IxDrawer.jsx calls "the most-used in the product".

     ONE component, two forms, and deliberately not two components: the sheet
     is the same DOM with a different geometry (drawer.css §12) and a pointer
     gesture on top. A separate mobile drawer would be a second place for every
     tab, every picker and every autosave path to diverge.

     `enabled` is false on desktop, so `useSheetSnap` attaches no pointer
     handlers at all there rather than attaching live ones and guarding them. */
  const isSheet = useMediaQuery('(max-width: 767px)');
  /* NOT `&& !closing`. The height comes from `[data-snap]`, so dropping the
     attribute the instant a close starts would take the height with it and
     collapse the panel to its content height for the whole of its exit — a
     sheet that shrinks and then slides away. The gesture handlers are harmless
     during the exit because `.dr.is-closing` is `pointer-events: none`. */
  const sheet = useSheetSnap({ enabled: isSheet && open, onDismiss: requestClose });

  // ── Load task on open ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !taskId) return;
    setScrolled(false);
    setClosing(false);
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    setTask(null); setFields([]); setFValues({});
    setComments([]); setActivity([]); setEntries([]); setTimer(null); setTimeErr(null); setAttachments([]);
    setMembers([]); setMyRole(null); setActLoad(false);

    sharedGet('/categories').then(r => setCategories(Array.isArray(r.data) ? r.data : [])).catch(() => {});

    Promise.all([
      api.get(`/tasks/${taskId}`),
      api.get(`/tasks/${taskId}/comments`),
      api.get(`/activity/task/${taskId}`).catch(() => ({ data: [] })),
      // A rejection is NOT an empty log. Swallowing it into `{ entries: [] }`
      // rendered "No time logged yet." over a 403 — measured live on a task
      // belonging to another org, where the API refused every read and the
      // drawer reported the task simply had no time against it. The same
      // mistake `errorKind`/ErrorState exists to stop everywhere else.
      api.get(`/time/task/${taskId}`).catch(e => ({ data: null, __err: e })),
    ]).then(([tRes, cRes, actRes, timeRes]) => {
      setActivity(Array.isArray(actRes.data) ? actRes.data : []);
      setTimeErr(timeRes.__err || null);
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
        // `your_role` comes back on this SAME response and was being thrown
        // away. It is the server's own answer to "what may this caller do on
        // this project", which is the question the permission block at the foot
        // of this file has to answer — see the note there.
        api.get(`/teams/${t.team_id}`).then(r => {
          setMembers(Array.isArray(r.data?.members) ? r.data.members : []);
          setMyRole(r.data?.your_role || null);
        }).catch(() => {});
        // These two were the only reads in this effect with no rejection
        // handler — every sibling above has one. A 403 or a 500 on either
        // therefore became an Unhandled Rejection, and the custom-field section
        // just stayed empty rather than saying it had failed. `rows()` also
        // makes them indifferent to whether the route answers a bare array
        // (which `fields.py` does today) or a `{"data": […]}` envelope.
        api.get(`/fields/team/${t.team_id}`).then(r => {
          setFields(rows(r).map(f =>
            f.type === 'person' ? { ...f, config: { ...f.config, members: mentionMembers } } : f
          ));
        }).catch(logger.error);
        api.get(`/fields/task/${taskId}/values`).then(r => {
          const vals = {};
          rows(r).forEach(v => { vals[v.field_id] = v.value; });
          setFValues(vals);
        }).catch(logger.error);
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
      return res.data;
    } catch (e) { logger.error('Save failed', e); throw e; }
    finally { setSaving(false); }
  }, [taskId, onSaved]);

  /**
   * The description autosaves on a 800ms debounce and flushes on blur.
   * It used to save on blur ONLY, which loses the edit entirely if the drawer
   * is closed with the field still focused — the scrim swallows the click, the
   * component unmounts, and no blur ever fires.
   */
  // The unchanged-check belongs HERE, not at the keystroke. Guarding `schedule`
  // instead leaves a stale intermediate value queued when the user types and
  // then undoes back to the original — the queue would still flush the middle
  // of the edit on blur.
  const descSave = useCallback(v => {
    if ((v || '') === (task?.description || '')) return undefined;
    return saveTask({ description: v });
  }, [saveTask, task]);
  const desc = useAutosave(descSave);
  useEffect(() => { desc.reset(); }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  /**
   * The multi Picker hands back the whole list, so this replaces the old
   * one-id-at-a-time toggle. Same optimistic update, one fewer round trip when
   * two people are added in a row.
   */
  const setAssignees = useCallback(async next => {
    setTask(t => ({ ...t, assignee_user_ids: next }));
    try { await api.put(`/tasks/${taskId}`, { assignee_user_ids: next }); }
    catch (e) { logger.error(e); }
  }, [taskId]);

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
          pushToast({ type: 'error', title: apiErrorText(e, 'Could not delete task') });
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

  /**
   * Deferred deletes, keyed by comment id: `{ comment, index, handle }`.
   *
   * A ref and not state — nothing renders from it, and the commit has to be
   * callable from an unmount cleanup, where a state read would be stale.
   */
  const pendingCommentDeletes = useRef(new Map());

  /**
   * Delete a comment with undo — Interaction Catalogue 3.5.
   *
   * "Destructive-but-cheap actions get an undo, not a confirmation. The dialog
   * interrupts everyone to protect the rare mistake; the toast interrupts no
   * one and still fixes it."
   *
   * The old body was two lines: DELETE, then filter it out of state. No
   * confirmation, no toast, no way back — a mis-click on an 11px icon destroyed
   * the comment with no acknowledgement that anything had happened.
   *
   * 3.5's handler note is the design: "DELETE is deferred until the toast
   * expires, so undo is a client-side revert and costs no request." So the row
   * leaves immediately (the UI is honest about intent), the request is held for
   * exactly the toast's life, and Undo cancels the request rather than sending
   * a compensating one. `TOAST_LIFE_MS` is imported rather than a local 4000 so
   * the two cannot drift.
   *
   * Deviation from 3.5, deliberate: the spec says only one delete toast exists
   * at a time and a second delete commits the first. Each pending delete here
   * keeps its own timer and its own undo instead, because the spec's rule is a
   * demo simplification — under it, deleting two comments quickly makes the
   * first one unrecoverable for no reason the user can see.
   */
  /** Re-insert a removed comment where it was. Clamped: the list may have grown. */
  const restoreComment = useCallback((commentId, comment, index) => {
    setComments(prev => {
      if (prev.some(c => c.comment_id === commentId)) return prev;
      const next = [...prev];
      next.splice(Math.min(index, next.length), 0, comment);
      return next;
    });
  }, []);

  /**
   * Send the deferred DELETE. On failure the row goes back — it is already off
   * the screen, and a delete that failed silently is a comment the user believes
   * is gone and the next reader still sees. 12.4: an API error is a toast with
   * Retry, and Retry here is a straight re-send, not a second undo window: the
   * user has already spent theirs.
   */
  const commitCommentDelete = useCallback(async (commentId, comment, index) => {
    const pending = pendingCommentDeletes.current.get(commentId);
    if (pending) { clearTimeout(pending.handle); pendingCommentDeletes.current.delete(commentId); }
    try {
      await api.delete(`/tasks/${taskId}/comments/${commentId}`);
    } catch (e) {
      restoreComment(commentId, comment, index);
      pushToast({
        type: 'error',
        title: 'Could not delete comment',
        message: apiErrorText(e, e?.message || ''),
        action: {
          label: 'Retry',
          onAction: () => {
            setComments(prev => prev.filter(c => c.comment_id !== commentId));
            commitCommentDelete(commentId, comment, index);
          },
        },
      });
    }
  }, [taskId, pushToast, restoreComment]);

  const deleteComment = useCallback(commentId => {
    const index = comments.findIndex(c => c.comment_id === commentId);
    if (index < 0) return;
    const comment = comments[index];

    setComments(prev => prev.filter(c => c.comment_id !== commentId));
    const handle = setTimeout(
      () => commitCommentDelete(commentId, comment, index),
      TOAST_LIFE_MS.success,
    );
    pendingCommentDeletes.current.set(commentId, { comment, index, handle });

    pushToast({
      type: 'success',
      title: 'Comment deleted',
      action: {
        label: 'Undo',
        onAction: () => {
          const pending = pendingCommentDeletes.current.get(commentId);
          if (!pending) return;               // already committed; nothing to restore
          clearTimeout(pending.handle);
          pendingCommentDeletes.current.delete(commentId);
          // Back at its ORIGINAL index, not appended — 3.5: "Undo re-inserts
          // the comment at its original index."
          restoreComment(commentId, pending.comment, pending.index);
        },
      },
    });
  }, [comments, commitCommentDelete, restoreComment, pushToast]);

  /**
   * Anything still pending when the drawer goes away is committed, not dropped.
   *
   * Without this, closing the drawer inside the 4s window left the comment gone
   * from the screen and present on the server — the deferred delete would be
   * silently cancelled by unmount and reappear on the next open. A deferred
   * request is still a request the user asked for.
   */
  useEffect(() => () => {
    for (const [id, p] of pendingCommentDeletes.current) {
      clearTimeout(p.handle);
      api.delete(`/tasks/${taskId}/comments/${id}`).catch(() => {});
    }
    pendingCommentDeletes.current.clear();
  }, [taskId]);

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

    // Names the file, its size and the limit that applies to it. "…exceed the
    // file size limit" told someone who had picked eight files neither which
    // ones nor what the limit was.
    const tooBig = oversizeMessage(toUpload);
    if (tooBig) {
      pushToast({ type: 'error', title: 'That file is too large to upload', message: tooBig });
      if (fileRef.current)  fileRef.current.value  = '';
      if (videoRef.current) videoRef.current.value = '';
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
            pushToast({ type: 'error', title: apiErrorText(err, 'Upload failed') });
          }
          // break, NOT return. This `return` used to sit inside the per-file
          // catch, inside the loop, inside the outer try — so it jumped past the
          // persist below. Upload five files, have #3 fail: #1 and #2 were
          // already in object storage, but newFiles was discarded, saveTask
          // never ran, and the `finally` then cleared the file inputs. The user
          // saw only "Upload failed" and had to re-pick everything, including
          // the files that had actually succeeded. Stop the batch, but keep what
          // landed.
          break;
        }
      }
      if (newFiles.length) {
        const updated = [...attachments, ...newFiles];
        setAttachments(updated);
        await saveTask({ attachments: updated.map(attachmentForSave) });
        pushToast({ type: 'success', title: `${newFiles.length} file${newFiles.length > 1 ? 's' : ''} uploaded` });
      }
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileRef.current)  fileRef.current.value  = '';
      if (videoRef.current) videoRef.current.value = '';
    }
  };

  /**
   * Remove an attachment — into the org's recycle bin, and only after asking.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * ⚠ THIS USED TO BE THE SILENT ORPHAN, AND IT WAS THE ONLY PATH THE WEB USED
   * ══════════════════════════════════════════════════════════════════════════
   * It filtered the array and called `saveTask`, which is `PUT /tasks/{id}` —
   * a wholesale replace. The pointer went; the R2 object stayed in the bucket,
   * billed forever, with the key gone from the row, so it was unreachable by
   * anyone INCLUDING Aekam. One click on a bare trash icon, no confirmation,
   * no undo, no record that the file had ever existed.
   *
   * ⚠ AND WIRING THE BIN INTO `DELETE /tasks/{id}/attachments/{key}` ALONE
   * WOULD HAVE FIXED ALMOST NOTHING. That route existed already — and the web
   * app never called it. Its only caller in the whole product is mobile
   * (`mobile/src/api/tasks.ts:143`). Every deletion a customer makes in a
   * browser came through here, so a bin behind the other door would have
   * captured mobile deletions and quietly missed all the rest, while the
   * feature reported itself built.
   *
   * So this now calls the same route mobile does. One door, one bin, and the
   * server records what it kept before the pointer is dropped.
   *
   * ── THE CONFIRMATION IS NEW, AND IT IS THE OWNER'S FIRST DECISION ─────────
   * "Delete asks for confirmation." It says the file is recoverable, because it
   * now is, and for how long — a warning that overstates the consequence
   * teaches people to click through it.
   *
   * ⚠ NO `confirmText` TYPED GUARD HERE, deliberately, and this is the one
   * place this file departs from `ProjectsPage`. That guard scales with blast
   * radius (`BulkBar.jsx:97` applies it past four rows); one recoverable
   * attachment does not earn it, and a guard on a trivial act is how people
   * learn to type past the guard on a serious one.
   */
  const removeAttachment = idx => {
    const file = attachments[idx];
    if (!file) return;
    const label = file.name || 'this file';
    setConfirmState({
      title: 'Move to recycle bin?',
      // ⚠ The wording differs by whether the file CAN be recovered. 16 of the
      // attachment elements in this database carry no `key` at all — legacy
      // pointers at something the product can no longer address — and for
      // those there is genuinely nothing to put in a bin. Saying "you can
      // restore it" over one of them would be a promise the server cannot keep.
      message: file.key
        ? `"${label}" moves to your organisation's recycle bin. An owner or admin can restore it for 14 days.`
        : `"${label}" will be removed. This file has no stored reference, so it cannot be recovered.`,
      confirmLabel: 'Move to bin',
      intent: 'danger',
      onConfirm: async () => {
        try {
          if (file.key) {
            // The route that bins. The server writes the bin row BEFORE it
            // drops the pointer, and refuses the whole delete if it cannot.
            const res = await api.delete(
              `/tasks/${taskId}/attachments/${encodeURIComponent(file.key)}`,
            );
            // The list comes back from the row that was actually written
            // rather than from local optimism — the failure mode being
            // repaired here is exactly a screen that showed a delete the
            // database had not agreed to.
            setTask(res.data);
            setAttachments(res.data?.attachments || []);
            onSaved?.(res.data);
          } else {
            // ⚠ NO KEY, SO THERE IS NOTHING TO BIN — and the delete route
            // addresses attachments BY key, so it cannot reach this one at
            // all. These are legacy pointers at something the product can no
            // longer address; `deleted_files.r2_key` is NOT NULL precisely
            // because a bin row without a key is an entry nobody can restore.
            //
            // The old array-replace path is CORRECT for these and only these.
            // Routing them through it deliberately, rather than leaving them
            // unremovable, which is what addressing everything by key alone
            // would have done.
            const updated = attachments.filter((_, i) => i !== idx);
            setAttachments(updated);
            await saveTask({
              attachments: updated.map(attachmentForSave),
            });
          }
          pushToast({
            type: 'success',
            title: file.key ? `"${label}" moved to the recycle bin` : `"${label}" removed`,
          });
        } catch (e) {
          logger.error('Remove attachment failed', e);
          pushToast({
            type: 'error',
            title: apiErrorText(e, 'Could not remove that file'),
          });
        }
      },
    });
  };

  const handlePrivacyChange = async (idx, updatedFile) => {
    const updated = attachments.map((f, i) => i === idx ? updatedFile : f);
    setAttachments(updated);
    await saveTask({ attachments: updated.map(attachmentForSave) });
  };

  // ── Time actions ──────────────────────────────────────────────────────────
  //
  // All four report failure. None of them did: every one awaited a request and
  // ignored the rejection, so a refusal left the panel exactly as it was and the
  // person was told nothing at all. Measured live on a task belonging to another
  // org — `POST /time/manual` answered 403, the Log button had been enabled, and
  // pressing it changed nothing on screen. Work that looks logged and is not is
  // worse than work that visibly failed to log.
  //
  // The server's own sentence wins where it has one; `_assert_task_access`
  // explains the refusal better than any generic string here could.
  const timeFailed = (e, fallback) =>
    pushToast({ type: 'error', title: apiErrorText(e, fallback) });

  const startTimer = async () => {
    try { const res = await api.post(`/time/start?task_id=${taskId}`); setTimer(res.data); }
    catch (e) { timeFailed(e, 'Could not start the timer'); }
  };
  const stopTimer  = async () => {
    try { const res = await api.post('/time/stop'); setTimer(null); setEntries(prev => [res.data, ...prev]); }
    catch (e) { timeFailed(e, 'Could not stop the timer — it is still running'); }
  };
  const addManual  = async () => {
    const mins = parseInt(manualMin);
    if (!mins || mins < 1) return;
    // `started_at` is REQUIRED on `TimeEntryCreate` (routers/time_entries.py) and
    // was never sent, so every manual entry 422'd — the feature had not worked
    // once. Sent as "now" rather than back-dated by `mins`: the entry is only
    // ever ordered and reported on by this column, and back-dating a long entry
    // logged just after midnight would file it against the previous day.
    try {
      const res = await api.post('/time/manual', {
        task_id: taskId,
        started_at: new Date().toISOString(),
        minutes: mins,
        description: manualDesc,
      });
      setEntries(prev => [res.data, ...prev]);
      // Cleared only on success. Wiping the fields after a failed save throws
      // away what the person typed and leaves them nothing to retry with.
      setManualMin(''); setManualDesc('');
    } catch (e) { timeFailed(e, 'Could not log that time'); }
  };
  const deleteEntry = async id => {
    try { await api.delete(`/time/${id}`); setEntries(prev => prev.filter(e => e.entry_id !== id)); }
    catch (e) { timeFailed(e, 'Could not delete that entry'); }
  };

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
      pushToast({ type: 'error', title: apiErrorText(e, 'Could not send approval request') });
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
      pushToast({ type: 'error', title: apiErrorText(e, 'Could not approve task') });
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
      pushToast({ type: 'error', title: apiErrorText(e, 'Could not reject task') });
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
  /**
   * ⚠ NOT `users.role`. That column is a single GLOBAL string and cannot say
   * "client of org A, org_admin of org B" — and on the live database it does
   * not even agree with `staging.user_roles`.
   *
   * MEASURED 2026-08-29, read-only:
   *
   *     org_admin + users.role='client'   2 grants
   *     org_admin + users.role='member'   8
   *     org_owner + users.role='member'   2
   *     ── 12 of the 18 (user, role_code) GRANTS ──
   *
   * ⚠ RE-MEASURED 2026-08-29 and stated precisely, because the first pass
   * conflated two units. Those are GRANT rows, and an account can hold
   * `org_admin` in one org and `org_owner` in another, so the same 18 rows are
   * only 15 DISTINCT accounts — of which 10, not 12, carry a legacy
   * `users.role` that says neither admin nor owner. Both framings say the
   * majority; only one of them is a number you can check.
   *
   * Every one of those ten opened a task in their OWN organisation and got
   * a drawer with no Approve, no Reject, no Archive and no Delete; the two on
   * `'client'` also lost the Time tab entirely and were shown the CLIENT
   * approve/reject panel instead of the administrator's.
   *
   * The backend already fixed exactly this, and named these same two accounts
   * while doing it — `middleware/roles.is_portal_client`: "two accounts carry
   * `users.role='client'` while holding `org_admin`. Both are org
   * administrators who were shown an empty comment list and no files on their
   * own organisation's tasks, because every client gate believed the column."
   * `navConfig.navContext` is the client-side twin of that repair and has been
   * correct since it was written; this file was the last staff surface still
   * reading the column directly.
   *
   * Each predicate below is the CLIENT-SIDE MIRROR of the server rule that
   * actually decides, so no control is offered that the server would refuse:
   *
   *   isClient        `is_portal_client` — role='client' AND no org role at all
   *   isSystemAdmin   `is_org_admin(user, active_org)` — the comment-moderation
   *                   and delete escape hatch (`server.delete_task`)
   *   isOwnerAdmin    `is_project_owner(team) OR is_org_admin(user)` —
   *                   `approvals_router.approve_task` / `reject_task`
   *   canDeleteTask   the same pair, `server.delete_task`
   *
   * `myRole` is the SERVER's answer for this project (`GET /teams/{id}` →
   * `your_role`), not a role guessed from a member row: `members[].member_role`
   * is a JOB TITLE ("ORG Test Account") and reading it as a permission would be
   * worse than reading the legacy column.
   */
  const nav           = navContext(me);
  const isSystemAdmin = nav.isOrgAdmin;
  const isProjectLead = ['owner', 'admin'].includes(myRole || '')
    || !!teamMembers.find(m => m.user_id === me?.user_id && (m.role === 'admin' || m.role === 'owner'));
  const isOwnerAdmin  = isSystemAdmin || isProjectLead;
  const isClient      = nav.isClient;
  const canDeleteTask = isSystemAdmin || (task && isProjectLead);

  if (!open) return null;

  const stages = columns
    .filter(c => !(c.name || '').toLowerCase().includes('approval'))
    .map(c => ({ value: c.column_id, label: c.name }));

  const details = task && (
    <>
      <div className="dr__sec">
        <Lbl hi="विवरण">
          Description
        </Lbl>
        <textarea
          className="dr__ta"
          aria-label="Task description"
          placeholder="Add a description…"
          rows={5}
          value={draft.description || ''}
          onChange={e => {
            const v = e.target.value;
            setDraft(d => ({ ...d, description: v }));
            desc.schedule(v);
          }}
          onBlur={desc.flush}
        />
        <span className={`dr__auto${desc.status === 'error' ? ' dr__auto--error' : ''}`} role="status">
          {desc.status === 'saving' ? 'Saving…' : desc.status === 'saved' ? 'Saved' : desc.status === 'error' ? 'Not saved' : ''}
        </span>
      </div>

      <DrawerSubtasks
        task={task} members={members}
        newSubtask={newSubtask} setNewSubtask={setNewSubtask}
        addingSubtask={addingSubtask}
        addSubtask={addSubtask} toggleSubtask={toggleSubtask}
        deleteSubtask={deleteSubtask} updateSubtaskAssignee={updateSubtaskAssignee}
      />

      {fields.length > 0 && (
        <div className="dr__sec">
          <Lbl>Custom fields</Lbl>
          <div className="dr__props dr__props--flush">
            {fields.map(f => (
              <div className="dr__prop" key={f.field_id}>
                <Lbl>{f.name}</Lbl>
                <FieldRenderer field={f} value={fValues[f.field_id] ?? null} onChange={v => saveFieldValue(f.field_id, v)} />
              </div>
            ))}
          </div>
        </div>
      )}

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
    </>
  );

  return (
    <>
      <div
        className={`dr__scrim${closing ? ' is-closing' : ''}`}
        role="presentation"
        onClick={e => e.target === e.currentTarget && requestClose()}
      >
        {/* The drawer was the last overlay with no focus trap — modal,
            ConfirmDialog and CommandPalette all have one. Tab walked straight
            out of the open drawer into the board behind the scrim, and closing
            dropped focus at <body> instead of returning it to the card that
            opened it. Trap wraps the panel, not the scrim. */}
        <FocusTrap active>
          <div
            className={`dr${closing ? ' is-closing' : ''}`}
            onAnimationEnd={handleExitEnd}
            role="dialog"
            aria-modal="true"
            aria-label={task?.title ? `Task: ${task.title}` : 'Task details'}
            /* Escape closes the drawer. `useDismiss` stops Escape at the
               document in the capture phase while a picker or a menu is open,
               so this handler never sees it — closing two layers on one
               keypress is the usual bug here. */
            onKeyDown={e => { if (e.key === 'Escape') requestClose(); }}
            {...sheet.sheetProps}
          >
            {/* Only on touch. A grab handle on a right-anchored desktop panel
                is an affordance for a gesture that surface does not have. */}
            {isSheet && <div className="dr__grab" {...sheet.grabProps}><i /></div>}
            <DrawerHeader
              task={task} draft={draft} saving={saving}
              canDeleteTask={canDeleteTask} deletingTask={deletingTask}
              onClose={requestClose} onDeleteTask={handleDeleteTask}
              onArchiveTask={!isClient ? handleArchiveTask : undefined}
              onUnarchiveTask={!isClient ? handleUnarchiveTask : undefined}
              scrolled={scrolled}
            />

            <div className="dr__body" ref={bodyRef} onScroll={handleBodyScroll}>
              <div className="dr__sticky-top">
                <DrawerTitle task={task} draft={draft} setDraft={setDraft} saveTask={saveTask} />

                {task && stages.length > 0 && (
                  <div className="dr__pipe-wrap">
                    <StatusPipeline stages={stages} current={task.column_id} onStageClick={onColumnChange} />
                  </div>
                )}
              </div>

              <DrawerMeta
                task={task} draft={draft} setDraft={setDraft} saveTask={saveTask}
                saveReminders={saveReminders}
                onColumnChange={onColumnChange}
                columns={columns} members={members} categories={categories}
                assignees={task?.assignee_user_ids || []} setAssignees={setAssignees}
              />
              {!task && (
                <div className="dr__skel">
                  <i style={{ width: '65%' }} />
                  <i style={{ width: '40%' }} />
                  <i style={{ width: '80%' }} />
                  <i style={{ width: '40%' }} />
                </div>
              )}

              {task && (
                <DrawerTabs
                  showTime={!isClient}
                  detailsCount={(task.subtasks?.length || 0) + fields.length}
                  details={details}
                  commentCount={comments.length}
                  comments={
                    <DrawerComments
                      comments={comments} comment={comment} setComment={setComment}
                      postComment={postComment} deleteComment={deleteComment}
                      editingComment={editingComment} editBody={editBody} setEditBody={setEditBody}
                      startEditComment={startEditComment} saveEditComment={saveEditComment}
                      me={me} isSystemAdmin={isSystemAdmin} mentionMembers={mentionMembers}
                    />
                  }
                  fileCount={attachments.length}
                  files={
                    <DrawerAttachments
                      attachments={attachments} uploading={uploading} uploadProgress={uploadProgress}
                      fileRef={fileRef} videoRef={videoRef} handleFileChange={handleFileChange}
                      removeAttachment={removeAttachment}
                      onPrivacyChange={handlePrivacyChange}
                      members={members}
                      currentUserId={me?.user_id}
                    />
                  }
                  timeCount={entries.length}
                  time={
                    <DrawerTimeEntries
                      timer={timer} entries={entries}
                      manualMin={manualMin} setManualMin={setManualMin}
                      manualDesc={manualDesc} setManualDesc={setManualDesc}
                      timeErr={timeErr}
                      startTimer={startTimer} stopTimer={stopTimer}
                      addManual={addManual} deleteEntry={deleteEntry}
                    />
                  }
                  activityCount={activity.length}
                  activity={<ActivityList events={activity} loading={actLoad} />}
                />
              )}
            </div>
          </div>
        </FocusTrap>
      </div>

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </>
  );
}
