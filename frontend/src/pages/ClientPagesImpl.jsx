/**
 * ClientPagesImpl.jsx — client-facing page components.
 *
 * v2 capabilities:
 *  - Full task CRUD (create, edit, delete) via ClientTaskDrawer
 *  - @mention autocomplete in comments
 *  - File attachment upload + view
 *  - Mark 'ready' tasks as reviewed (approval CTA)
 *  - Full statusColor map
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { K, KLogo, KWordmark } from '../lib/brand';
import { apiLogout, approvalBadgeStyle, formatDue } from '../lib/auth';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { useToast } from '../components/ui/toast';
import MentionTextarea from '../components/MentionTextarea';
import {
  FolderKanban,
  LogOut, Paperclip, Trash2, X,
} from 'lucide-react';

// ── Status helpers ───────────────────────────────────────────────────────────
const STATUS_COLOR = {
  todo:        '#6366f1',
  in_progress: '#f59e0b',
  ready:       '#10b981',
  done:        '#22c55e',
  blocked:     '#ef4444',
  review:      '#8b5cf6',
};

const statusLabel = (s) => ({
  todo:        'To Do',
  in_progress: 'In Progress',
  ready:       'Ready for Review',
  done:        'Done',
  blocked:     'Blocked',
  review:      'In Review',
})[s] || s;

// ── ClientTaskDrawer ─────────────────────────────────────────────────────────
// Full-featured right-slide drawer for clients: create/edit/delete,
// @mention comments, file attachments.
function ClientTaskDrawer({ open, onClose, task: initialTask, categories = [], teams = [], defaultTeamId, members = [], onSaved, onDeleted }) {
  const { pushToast } = useToast();
  const fileRef  = useRef();
  const videoRef = useRef();
  const [confirmState, setConfirmState] = useState(null);

  const isNew = !initialTask;

  const [form, setForm] = useState({
    title: '', description: '', priority: 'medium',
    team_id: defaultTeamId || '', due_at: '',
  });
  const [comments,    setComments]    = useState([]);
  const [comment,     setComment]     = useState('');
  const [posting,     setPosting]     = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [uploading,   setUploading]   = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [deleting,    setDeleting]    = useState(false);
  const [tab,         setTab]         = useState('details');

  const mentionMembers = members.map(m => ({
    user_id:      m.user_id,
    display_name: m.display_name || m.full_name || m.email || 'Unknown',
  }));

  useEffect(() => {
    if (!open) return;
    setTab('details');
    setComment('');
    setComments([]);
    setAttachments([]);

    if (initialTask) {
      setForm({
        title:       initialTask.title       || '',
        description: initialTask.description || '',
        priority:    initialTask.priority    || 'medium',
        team_id:     initialTask.team_id     || defaultTeamId || '',
        due_at:      initialTask.due_at ? initialTask.due_at.slice(0, 10) : '',
      });
      // Load comments
      api.get(`/tasks/${initialTask.task_id}/comments`)
         .then(r => setComments(r.data))
         .catch(() => {});
      // Load attachments
      if (initialTask.attachments) {
        setAttachments(initialTask.attachments);
      } else {
        api.get(`/tasks/${initialTask.task_id}/attachments`)
           .catch(() => {})
           .then(r => r && setAttachments(r.data || []));
      }
    } else {
      setForm({ title: '', description: '', priority: 'medium', team_id: defaultTeamId || '', due_at: '' });
    }
  }, [open, initialTask, defaultTeamId]);

  if (!open) return null;

  const upd = (k) => (e) => setForm(f => ({ ...f, [k]: e?.target ? e.target.value : e }));

  const save = async () => {
    if (!form.title.trim()) { pushToast({ type: 'error', title: 'Title is required' }); return; }
    setSaving(true);
    const payload = {
      title:       form.title.trim(),
      description: form.description?.trim() || null,
      priority:    form.priority,
      team_id:     form.team_id || null,
      due_at:      form.due_at ? new Date(form.due_at).toISOString() : null,
    };
    try {
      const r = isNew
        ? await api.post('/tasks', payload)
        : await api.put(`/tasks/${initialTask.task_id}`, payload);
      pushToast({ type: 'success', title: isNew ? 'Task created!' : 'Task updated' });
      onSaved?.(r.data);
      if (isNew) onClose();
    } catch (e) {
      pushToast({ type: 'error', title: 'Could not save', message: e?.response?.data?.detail || 'Try again.' });
    } finally { setSaving(false); }
  };

  const deleteTask = () => {
    setConfirmState({
      message: 'Delete this task? This cannot be undone.',
      confirmLabel: 'Delete',
      onConfirm: async () => {
        setDeleting(true);
        try {
          await api.delete(`/tasks/${initialTask.task_id}`);
          pushToast({ type: 'success', title: 'Task deleted' });
          onDeleted?.();
          onClose();
        } catch (_) {
          pushToast({ type: 'error', title: 'Could not delete task' });
        } finally { setDeleting(false); }
      },
    });
  };

  const postComment = async () => {
    if (!comment.trim()) return;
    setPosting(true);
    try {
      const r = await api.post(`/tasks/${initialTask.task_id}/comments`, { body: comment.trim() });
      setComments(p => [...p, r.data]);
      setComment('');
    } catch (_) {
      pushToast({ type: 'error', title: 'Could not post comment' });
    } finally { setPosting(false); }
  };

  const uploadFile = async (file) => {
    if (!initialTask?.task_id) {
      pushToast({ type: 'error', title: 'Save the task first before attaching files.' }); return;
    }
    setUploading(true);
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
      const r = await api.post(`/tasks/${initialTask.task_id}/attachments`, fd, {
        signal: controller.signal,
        noRetry: true,
        onUploadProgress: () => kickStall(),
      });
      clearTimeout(stallTimer);
      setAttachments(p => [...p, r.data]);
      pushToast({ type: 'success', title: 'File attached' });
    } catch (err) {
      clearTimeout(stallTimer);
      if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') {
        pushToast({ type: 'error', title: 'Upload got stuck', message: 'No data transferred for 30 s. Check your connection and try again.' });
      } else {
        pushToast({ type: 'error', title: err?.response?.data?.detail || 'Upload failed — please try again.' });
      }
    } finally { setUploading(false); }
  };

  const deleteAttachment = async (attachmentId) => {
    try {
      await api.delete(`/tasks/${initialTask.task_id}/attachments/${attachmentId}`);
      setAttachments(p => p.filter(a => a.attachment_id !== attachmentId));
    } catch (_) {
      pushToast({ type: 'error', title: 'Could not remove attachment' });
    }
  };

  return (
    <div className="k-drawer-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="k-drawer">

        {/* Header */}
        <div className="k-drawer__head">
          <div>
            <div className="k-drawer__kicker">{isNew ? 'CLIENT · नया कार्य' : 'TASK · कार्य'}</div>
            <div className="k-drawer__title">{isNew ? 'New Request' : (initialTask?.title || 'Task')}</div>
          </div>
          <button className="k-iconbtn" onClick={onClose} aria-label="Close" style={{ fontSize: 20 }}>×</button>
        </div>

        {/* Tabs */}
        {!isNew && (
          <div className="k-tabs" style={{ padding: '0 24px', flexShrink: 0 }}>
            {[['details', 'Details', 'विवरण'], ['comments', 'Comments', 'टिप्पणी'], ['files', 'Files', 'फ़ाइलें']].map(([id, label, sans]) => (
              <button key={id} className={`k-tab${tab === id ? ' is-active' : ''}`} onClick={() => setTab(id)}>
                {label} <span className="k-tab__sans">{sans}</span>
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="k-drawer__body">

          {/* DETAILS */}
          {(isNew || tab === 'details') && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <label className="k-label">Title *</label>
                <input className="k-input" value={form.title} onChange={upd('title')}
                  placeholder="Task title…" autoFocus style={{ width: '100%' }} />
              </div>
              <div>
                <label className="k-label">Notes</label>
                <textarea className="k-input" value={form.description} onChange={upd('description')}
                  placeholder="Context, links, notes…" rows={3}
                  style={{ width: '100%', resize: 'vertical', minHeight: 80 }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label className="k-label">Project</label>
                  <select className="k-input" value={form.team_id} onChange={upd('team_id')} style={{ width: '100%' }}>
                    <option value="">Personal</option>
                    {teams.filter(t => t.team_id && t.name).map(t => (
                      <option key={t.team_id} value={t.team_id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="k-label">Priority</label>
                  <select className="k-input" value={form.priority} onChange={upd('priority')} style={{ width: '100%' }}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="k-label">Due date</label>
                <input className="k-input" type="date" value={form.due_at} onChange={upd('due_at')} style={{ width: '100%' }} />
              </div>
            </div>
          )}

          {/* COMMENTS */}
          {!isNew && tab === 'comments' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {/* thread */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
                {comments.length === 0 && (
                  <div className="k-empty" style={{ padding: '28px 0' }}>
                    <div className="k-empty__icon">💬</div>
                    <div className="k-empty__title">No comments yet</div>
                    <div className="k-empty__sub">Be the first to leave a note.</div>
                  </div>
                )}
                {comments.map(c => (
                  <div key={c.comment_id} style={{ display: 'flex', gap: 10 }}>
                    <div style={{
                      width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                      background: 'color-mix(in srgb, var(--k-primary) 15%, var(--bg-soft))',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 700, color: 'var(--k-primary)',
                    }}>
                      {(c.user_name?.[0] || '?').toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>{c.user_name}</span>
                        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{new Date(c.created_at).toLocaleString()}</span>
                      </div>
                      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--ink-2)', whiteSpace: 'pre-wrap' }}>
                        {c.body.split(/(@[\w.-]+)/g).map((part, i) =>
                          part.startsWith('@')
                            ? <strong key={i} style={{ color: 'var(--k-primary)' }}>{part}</strong>
                            : part
                        )}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              {/* compose */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', borderTop: '1px solid var(--rule-soft)', paddingTop: 16 }}>
                <div style={{ flex: 1 }}>
                  <MentionTextarea
                    value={comment}
                    onChange={setComment}
                    onSubmit={postComment}
                    members={mentionMembers}
                    placeholder="Add a comment… type @ to mention someone"
                    rows={2}
                  />
                </div>
                <button className="k-btn k-btn--primary k-btn--sm" onClick={postComment} disabled={posting}>
                  {posting ? '…' : 'Post'}
                </button>
              </div>
            </div>
          )}

          {/* FILES */}
          {!isNew && tab === 'files' && (
            <div>
              <input ref={fileRef} type="file" style={{ display: 'none' }}
                accept=".jpg,.jpeg,.png,.gif,.heic,.heif,.pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt"
                onChange={e => { if (e.target.files[0]) uploadFile(e.target.files[0]); if (fileRef.current) fileRef.current.value = ''; }} />
              <input ref={videoRef} type="file" style={{ display: 'none' }}
                accept="video/*,.mov,.mp4,.webm,.avi,.mkv,.m4v,.3gp,.flv,.wmv,.ogv,.ts"
                onChange={e => { if (e.target.files[0]) uploadFile(e.target.files[0]); if (videoRef.current) videoRef.current.value = ''; }} />
              <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                <button className="k-btn k-btn--ghost k-btn--sm"
                  onClick={() => fileRef.current?.click()} disabled={uploading}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Paperclip size={13} />
                  {uploading ? 'Uploading…' : 'Attach file'}
                </button>
                <button className="k-btn k-btn--ghost k-btn--sm"
                  onClick={() => videoRef.current?.click()} disabled={uploading}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#8b5cf6' }}>
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#8b5cf6" strokeWidth="1.8"><polygon points="4,2 14,8 4,14" fill="none"/></svg>
                  Attach video
                </button>
              </div>

              {attachments.length === 0 && (
                <div className="k-empty" style={{ padding: '28px 0' }}>
                  <div className="k-empty__icon">📎</div>
                  <div className="k-empty__title">No files yet</div>
                  <div className="k-empty__sub">Use the buttons above to attach files or video.</div>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {attachments.map(a => (
                  <div key={a.attachment_id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 0', borderBottom: '1px solid var(--rule-soft)',
                  }}>
                    <Paperclip size={13} style={{ color: 'var(--ink-3)', flexShrink: 0 }} />
                    <a href={a.url || a.file_url} target="_blank" rel="noreferrer"
                      style={{ flex: 1, fontSize: 13, color: 'var(--k-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.filename || a.file_name || 'Attachment'}
                    </a>
                    <button className="k-iconbtn" style={{ color: 'var(--danger)' }}
                      onClick={() => deleteAttachment(a.attachment_id)} title="Remove attachment" aria-label="Remove attachment">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="k-drawer__foot">
          <div>
            {!isNew && (
              <button className="k-btn k-btn--ghost k-btn--sm" style={{ color: 'var(--danger)' }}
                onClick={deleteTask} disabled={deleting}>
                <Trash2 size={13} /> {deleting ? 'Deleting…' : 'Delete'}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="k-btn k-btn--ghost k-btn--sm" onClick={onClose}>Cancel</button>
            <button className="k-btn k-btn--primary k-btn--sm" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : isNew ? 'Create Request' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
    <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
  );
}


// ── ClientProjectsPage ───────────────────────────────────────────────────────
export function ClientProjectsPage() {
  const [projects, setProjects] = useState([]);
  const navigate = useNavigate();
  const { pushToast } = useToast();

  useEffect(() => {
    api.get('/client/projects')
       .then(r => setProjects(r.data))
       .catch(() => pushToast({ type: 'error', title: 'Failed to load projects' }));
  }, [pushToast]);

  return (
    <div className="content-wrapper">
      <div className="page-header">
        <h1 className="page-title">My Projects</h1>
        <p className="text-sm text-muted-foreground">Projects you're assigned to</p>
      </div>
      {projects.length === 0 && (
        <div className="empty-state">
          <FolderKanban size={48} style={{ color: K.mid, opacity: 0.3 }} />
          <p style={{ marginTop: 16, fontSize: 15, color: 'var(--color-muted-foreground)' }}>No projects assigned yet</p>
        </div>
      )}
      <div className="grid-2">
        {projects.map(p => (
          <div key={p.team_id} className="elevated-card hover-lift"
            onClick={() => navigate(`/client/project/${p.team_id}`)}
            style={{ cursor: 'pointer', padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <FolderKanban size={18} style={{ color: K.teal }} />
              <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{p.name}</h3>
            </div>
            {p.description && <p style={{ fontSize: 13, color: 'var(--color-muted-foreground)', margin: 0 }}>{p.description}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}


// ── ClientProjectBoardPage ───────────────────────────────────────────────────
export function ClientProjectBoardPage() {
  const { projectId } = useParams();
  const navigate      = useNavigate();
  const { pushToast } = useToast();
  const [project,    setProject]    = useState(null);
  const [tasks,      setTasks]      = useState([]);
  const [columns,    setColumns]    = useState([]);
  const [categories, setCategories] = useState([]);
  const [members,    setMembers]    = useState([]);
  const [drawer,     setDrawer]     = useState({ open: false, task: null });

  const reload = () =>
    api.get('/tasks', { params: { team_id: projectId } }).then(r => setTasks(r.data));

  useEffect(() => {
    Promise.all([
      api.get(`/teams/${projectId}`).then(r => setProject(r.data)),
      api.get('/tasks', { params: { team_id: projectId } }).then(r => setTasks(r.data)),
      api.get(`/projects/${projectId}/columns`).then(r => setColumns(r.data)),
      api.get('/categories').then(r => setCategories(r.data)),
      api.get(`/teams/${projectId}/members`).then(r => setMembers(r.data)).catch(() => {}),
    ]).catch(() => { pushToast({ type: 'error', title: 'Failed to load project' }); navigate('/client/projects'); });
  }, [projectId, navigate, pushToast]);

  const grouped = useMemo(() => {
    const g = {};
    columns.forEach(c => (g[c.column_id] = []));
    tasks.forEach(t => { if (g[t.column_id]) g[t.column_id].push(t); });
    return g;
  }, [tasks, columns]);

  const priorityStyle = (p) => ({
    low:    { background: '#10b98122', color: '#10b981' },
    medium: { background: '#f59e0b22', color: '#f59e0b' },
    high:   { background: '#ef444422', color: '#ef4444' },
    urgent: { background: '#9333ea22', color: '#9333ea' },
  }[p] || { background: '#88888822', color: '#888' });

  const catName = (cid) => categories.find(c => c.category_id === cid)?.name || '';

  const markReviewed = async (e, t) => {
    e.stopPropagation();
    try {
      await api.patch(`/tasks/${t.task_id}`, { approval_status: 'approved' });
      pushToast({ type: 'success', title: 'Marked as reviewed!' });
      reload();
    } catch (_) { pushToast({ type: 'error', title: 'Could not update task' }); }
  };

  return (
    <div className="k-screen">
      <div className="k-pageh">
        <div className="k-pageh__left">
          <button className="k-link" style={{ fontSize: 13 }} onClick={() => navigate('/client/projects')}>← Projects</button>
          <h1 className="k-pageh__title">{project?.name || '…'}</h1>
        </div>
        <div className="k-pageh__right">
          <button className="k-btn k-btn--primary k-btn--sm" onClick={() => setDrawer({ open: true, task: null })}>+ New Task</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 16 }}>
        {columns.map(col => (
          <div key={col.column_id} className="k-card"
            style={{ minWidth: 260, maxWidth: 280, flexShrink: 0, padding: 0, overflow: 'hidden', borderTopWidth: 3, borderTopColor: col.color || 'var(--k-primary)' }}>
            <div className="k-card__head" style={{ padding: '12px 16px' }}>
              <div className="k-card__titles">
                <h3 className="k-card__title" style={{ fontSize: 14 }}>{col.name}</h3>
                <span className="k-segctrl__count">{(grouped[col.column_id] || []).length}</span>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 12px 12px', maxHeight: 600, overflowY: 'auto' }}>
              {(grouped[col.column_id] || []).map(t => {
                const isReady = t.status === 'ready' || col.name?.toLowerCase() === 'ready';
                const ps = priorityStyle(t.priority);
                const abs = t.approval_status ? approvalBadgeStyle(t.approval_status) : null;
                return (
                  <div key={t.task_id}
                    onClick={() => setDrawer({ open: true, task: t })}
                    style={{ background: 'var(--bg-soft)', borderRadius: 'var(--r-md)', padding: '10px 14px', border: '1px solid var(--rule-soft)', cursor: 'pointer' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.4 }}>{t.title}</div>
                        {t.description && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{t.description}</div>}
                      </div>
                      {t.priority && <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: ps.background, color: ps.color, fontWeight: 600, flexShrink: 0 }}>{t.priority}</span>}
                    </div>
                    {t.category_id && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-3)' }}>{catName(t.category_id)}</div>}
                    {abs && <div style={{ marginTop: 6 }}><span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: abs.bg, color: abs.color, fontWeight: 500 }}>{abs.label}</span></div>}
                    {t.due_at && <div style={{ marginTop: 6, fontSize: 11, fontWeight: 500, color: new Date(t.due_at) < new Date() ? 'var(--danger)' : 'var(--ink-2)' }}>{formatDue(t.due_at)}</div>}
                    {t.attachments?.length > 0 && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-3)' }}>{t.attachments.length} file{t.attachments.length !== 1 ? 's' : ''}</div>}
                    {(t.subtasks || []).length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--ink-3)', marginBottom: 4 }}>
                          <span>Subtasks</span>
                          <span>{t.subtasks.filter(s => s.is_done).length}/{t.subtasks.length}</span>
                        </div>
                        <div className="progress-bar">
                          <div className="progress-bar__fill" style={{ width: `${(t.subtasks.filter(s => s.is_done).length / t.subtasks.length) * 100}%`, background: col.color }} />
                        </div>
                      </div>
                    )}
                    {isReady && t.approval_status !== 'approved' && (
                      <button onClick={(e) => markReviewed(e, t)} className="k-btn k-btn--ghost k-btn--sm"
                        style={{ marginTop: 10, width: '100%', color: '#10b981', borderColor: '#10b98140', background: '#10b98112' }}>
                        Mark as Reviewed
                      </button>
                    )}
                  </div>
                );
              })}
              {(grouped[col.column_id] || []).length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--ink-faint)', fontStyle: 'italic', padding: '4px 2px' }}>Empty</div>
              )}
            </div>
          </div>
        ))}
      </div>

      <ClientTaskDrawer
        open={drawer.open}
        onClose={() => setDrawer({ open: false, task: null })}
        task={drawer.task}
        categories={categories}
        teams={[{ team_id: projectId, name: project?.name }]}
        defaultTeamId={projectId}
        members={members}
        onSaved={() => reload()}
        onDeleted={() => reload()}
      />
    </div>
  );
}


// ── ClientPortal (legacy dark portal) ────────────────────────────────────────
export function ClientPortal() {
  const { pushToast } = useToast();
  const navigate      = useNavigate();
  const [tasks,    setTasks]    = useState([]);
  const [selected, setSelected] = useState(null);
  const [comments, setComments] = useState([]);
  const [comment,  setComment]  = useState('');
  const [posting,  setPosting]  = useState(false);
  const [marking,  setMarking]  = useState(null);
  const [members,  setMembers]  = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const user = (() => { try { return JSON.parse(localStorage.getItem('Kartavaya_user') || 'null'); } catch { return null; } })();

  const reloadTasks = () =>
    api.get('/client/tasks').then(r => setTasks(r.data)).catch(() => {});

  useEffect(() => { reloadTasks(); }, []);

  // Load members when a task is selected (for @mentions)
  useEffect(() => {
    if (!selected?.team_id) return;
    api.get(`/teams/${selected.team_id}/members`)
       .then(r => setMembers(r.data))
       .catch(() => {});
  }, [selected?.team_id]);

  useEffect(() => {
    if (!selected) return;
    api.get(`/tasks/${selected.task_id}/comments`)
       .then(r => setComments(r.data))
       .catch(() => {});
  }, [selected]);

  const mentionMembers = members.map(m => ({
    user_id:      m.user_id,
    display_name: m.display_name || m.full_name || m.email || 'Unknown',
  }));

  const postComment = async () => {
    if (!comment.trim()) return;
    setPosting(true);
    try {
      const r = await api.post(`/tasks/${selected.task_id}/comments`, { body: comment.trim() });
      setComments(p => [...p, r.data]);
      setComment('');
    } catch (_) {
      pushToast({ type: 'error', title: 'Could not post comment' });
    } finally { setPosting(false); }
  };

  const markReviewed = async (t) => {
    setMarking(t.task_id);
    try {
      await api.patch(`/tasks/${t.task_id}`, { approval_status: 'approved' });
      pushToast({ type: 'success', title: '✓ Marked as reviewed' });
      reloadTasks();
      if (selected?.task_id === t.task_id) setSelected(prev => ({ ...prev, approval_status: 'approved' }));
    } catch (_) {
      pushToast({ type: 'error', title: 'Could not update task' });
    } finally { setMarking(null); }
  };

  return (
    <div style={{ minHeight: '100vh', background: K.dark, fontFamily: "'Nunito',sans-serif", padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><KLogo size={36} /><KWordmark dark /></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: '#8aa5be' }}>Hi, {user?.full_name || user?.name}</span>
          <button onClick={async () => { await apiLogout(); navigate('/login'); }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8aa5be', background: 'none', border: 'none', cursor: 'pointer' }}>
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 420px' : '1fr', gap: 20, maxWidth: 1200, margin: '0 auto' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 2.5, textTransform: 'uppercase', color: K.teal, marginBottom: 16 }}>Your Updates</div>
          {tasks.length === 0 && <div style={{ color: '#8aa5be', fontSize: 14 }}>No tasks shared with you yet.</div>}
          {tasks.map(t => {
            const color   = STATUS_COLOR[t.status] || K.teal;
            const isReady = t.status === 'ready';
            return (
              <div key={t.task_id}
                onClick={() => setSelected(selected?.task_id === t.task_id ? null : t)}
                style={{ background: selected?.task_id === t.task_id ? K.card : 'rgba(255,255,255,.04)', border: `1px solid ${selected?.task_id === t.task_id ? K.blue : 'rgba(255,255,255,.08)'}`, borderRadius: 16, padding: '16px 20px', marginBottom: 10, cursor: 'pointer', transition: 'all .15s' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: '#fff', marginBottom: 4 }}>{t.title}</div>
                    {t.description && <div style={{ fontSize: 12, color: '#8aa5be', lineHeight: 1.5 }}>{t.description}</div>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', color, background: color + '22', padding: '3px 8px', borderRadius: 6 }}>
                      {statusLabel(t.status)}
                    </span>
                    {t.due_at && <span style={{ fontSize: 11, color: '#8aa5be' }}>Due {formatDue(t.due_at)}</span>}
                  </div>
                </div>
                {isReady && t.approval_status !== 'approved' && (
                  <button
                    onClick={(e) => { e.stopPropagation(); markReviewed(t); }}
                    disabled={marking === t.task_id}
                    style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6, background: '#10b98118', border: '1px solid #10b98140', borderRadius: 10, padding: '7px 14px', fontSize: 12, fontWeight: 600, color: '#10b981', cursor: 'pointer', opacity: marking === t.task_id ? 0.6 : 1 }}>
                    ✓ {marking === t.task_id ? 'Updating…' : 'Mark as Reviewed'}
                  </button>
                )}
                {isReady && t.approval_status === 'approved' && (
                  <div style={{ marginTop: 10, fontSize: 11, color: '#10b981', fontWeight: 500 }}>✓ Reviewed</div>
                )}
              </div>
            );
          })}
        </div>

        {/* Comments side-panel — now with @mention textarea */}
        {selected && (
          <div style={{ background: K.card, border: '1px solid rgba(255,255,255,.08)', borderRadius: 20, padding: 20, display: 'flex', flexDirection: 'column', maxHeight: '80vh' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase', color: K.teal }}>Comments</div>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8aa5be' }}><X size={14} /></button>
            </div>
            <div style={{ fontSize: 14, fontWeight: 500, color: '#fff', marginBottom: 16, borderBottom: '1px solid rgba(255,255,255,.08)', paddingBottom: 12 }}>{selected.title}</div>
            <div style={{ flex: 1, overflowY: 'auto', marginBottom: 16 }}>
              {comments.length === 0 && <div style={{ color: '#8aa5be', fontSize: 13 }}>No comments yet.</div>}
              {comments.map(c => (
                <div key={c.comment_id} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <div style={{ width: 22, height: 22, borderRadius: '50%', background: K.gradD, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 600, color: '#fff' }}>
                      {(c.user_name || '?')[0].toUpperCase()}
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 500, color: '#fff' }}>{c.user_name}</span>
                    <span style={{ fontSize: 10, color: '#8aa5be' }}>{new Date(c.created_at).toLocaleString()}</span>
                  </div>
                  <div style={{ fontSize: 13, color: '#c8dcea', lineHeight: 1.6, paddingLeft: 30 }}>
                    {c.body.split(/(@[\w.-]+)/g).map((part, i) =>
                      part.startsWith('@')
                        ? <strong key={i} style={{ color: K.teal }}>{part}</strong>
                        : part
                    )}
                  </div>
                </div>
              ))}
            </div>
            {/* @mention textarea for dark portal */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <MentionTextarea
                  value={comment}
                  onChange={setComment}
                  onSubmit={postComment}
                  members={mentionMembers}
                  placeholder="Add a comment… type @ to mention"
                  rows={2}
                  darkMode
                />
              </div>
              <button onClick={postComment} disabled={posting}
                style={{ padding: '9px 16px', background: K.gradD, border: 'none', borderRadius: 10, fontSize: 12, fontWeight: 600, color: '#fff', cursor: 'pointer', opacity: posting ? 0.6 : 1 }}>
                Post
              </button>
            </div>
          </div>
        )}
      </div>
      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  );
}
