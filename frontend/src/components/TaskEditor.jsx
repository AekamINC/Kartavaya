/**
 * TaskEditor.jsx — create/edit task modal. k-* design system.
 * Used by TasksListPage and ProjectBoardPage (new-task-in-column flow).
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useDismiss } from '../hooks/useDismiss';
import { createPortal } from 'react-dom';
import { api } from '../lib/api';
import { toLocal, fromLocal } from '../lib/auth';
import { useToast } from './ui/toast';
import { AVATAR_COLORS, userInitials, logger } from '../lib/utils';

const MAX_FILES    = 10;
const IMAGE_EXT    = /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i;
const VIDEO_EXT    = /\.(mov|mp4|webm|avi|mkv|m4v|3gp|3gpp|flv|wmv|asf|ogv|ts|mts|m2ts)$/i;
const DOC_ACCEPT   = '.jpg,.jpeg,.png,.gif,.heic,.heif,.pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt';
const VIDEO_ACCEPT = 'video/*,.mov,.mp4,.webm,.avi,.mkv,.m4v,.3gp,.flv,.wmv,.ogv,.ts';

export default function TaskEditor({
  open,
  onOpenChange,
  editing,
  categories = [],
  teams = [],
  defaultTeamId,
  defaultColumnId = null,
  defaultDueAt = '',
  lockToProject = false,
  onSaved,
  clientMode = false,
}) {
  const { pushToast } = useToast();
  const titleRef = useRef(null);
  const assigneeRef = useRef(null);
  const fileRef = useRef(null);
  const videoRef = useRef(null);
  const dragCounter = useRef(0);

  const [form, setForm] = useState({
    title: '', description: '', priority: 'medium',
    team_id: defaultTeamId || '', due_at: '',
    assignee_user_ids: [],
  });

  const [members, setMembers] = useState([]);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);

  // Fetch members when team changes
  useEffect(() => {
    const tid = form.team_id;
    if (!tid) { setMembers([]); return; }
    api.get(`/teams/${tid}`)
      .then(r => setMembers(Array.isArray(r.data?.members) ? r.data.members : []))
      .catch(() => setMembers([]));
  }, [form.team_id]);

  // Outside-click AND Escape — this used to be outside-click only.
  useDismiss(assigneeOpen, assigneeRef, useCallback(() => setAssigneeOpen(false), []));

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        title:              editing.title       || '',
        description:        editing.description || '',
        priority:           editing.priority    || 'medium',
        team_id:            editing.team_id     || defaultTeamId || '',
        due_at:             editing.due_at ? toLocal(editing.due_at) : '',
        assignee_user_ids:  editing.assignee_user_ids || [],
      });
    } else {
      setForm({
        title: '', description: '', priority: 'medium',
        team_id: defaultTeamId || '', due_at: defaultDueAt || '',
        assignee_user_ids: [],
      });
    }
    setAttachments([]);
    setUploadError('');
    setTimeout(() => titleRef.current?.focus(), 60);
  }, [open, editing, defaultTeamId, defaultDueAt]);

  const upd = (k) => (e) => setForm(f => ({ ...f, [k]: e?.target ? e.target.value : e }));

  const handleFileChange = async (e) => {
    const picked = Array.from(e.target.files);
    if (!picked.length) return;
    const slots = MAX_FILES - attachments.length;
    if (slots <= 0) { pushToast({ type: 'error', title: `Max ${MAX_FILES} files per task` }); return; }
    const toUpload = picked.slice(0, slots);
    if (toUpload.length < picked.length)
      pushToast({ type: 'error', title: `Only ${slots} slot(s) remaining — uploading first ${slots}` });

    setUploading(true);
    setUploadProgress(0);
    setUploadError('');
    try {
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
          const res = await api.post('/upload', fd, {
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
          setAttachments(prev => [...prev, { name: file.name, url: res.data.url, key: res.data.key || null }]);
          setUploadProgress(Math.round(((i + 1) / toUpload.length) * 100));
        } catch (err) {
          clearTimeout(stallTimer);
          if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') {
            setUploadError('Upload got stuck — no data for 30 s. Check your connection.');
          } else {
            setUploadError(err?.response?.data?.detail || 'Upload failed — please try again.');
          }
          return;
        }
      }
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileRef.current) fileRef.current.value = '';
      if (videoRef.current) videoRef.current.value = '';
    }
  };

  const toggleAssignee = (uid) => {
    setForm(f => {
      const ids = f.assignee_user_ids || [];
      return {
        ...f,
        assignee_user_ids: ids.includes(uid) ? ids.filter(x => x !== uid) : [...ids, uid],
      };
    });
  };

  const save = async () => {
    if (!form.title.trim()) { pushToast({ type: 'error', title: 'Title is required' }); return; }
    const teamId = lockToProject ? (defaultTeamId || null) : (form.team_id || null);
    const payload = {
      title:              form.title.trim(),
      description:        form.description?.trim() || null,
      priority:           form.priority,
      team_id:            teamId,
      due_at:             fromLocal(form.due_at),
      assignee_user_ids:  form.assignee_user_ids,
      attachments:        attachments.map(f => ({ name: f.name, url: f.url })),
    };
    if (!editing && defaultColumnId) payload.column_id = defaultColumnId;
    try {
      let r;
      if (editing) {
        r = await api.put(`/tasks/${editing.task_id}`, payload);
      } else if (clientMode) {
        r = await api.post('/client/tasks/request', payload);
      } else {
        r = await api.post('/tasks', payload);
      }

      pushToast({ type: 'success', title: editing ? 'Task updated' : clientMode ? 'Task submitted for approval' : 'Task created' });
      onSaved(r.data);
      onOpenChange(false);
    } catch (e) {
      pushToast({ type: 'error', title: 'Could not save', message: e?.response?.data?.detail || 'Try again.' });
    }
  };

  if (!open) return null;

  const selectedIds = form.assignee_user_ids || [];
  const selectedMembers = members.filter(m => selectedIds.includes(m.user_id || m.member_id));

  return (
    <div className="k-modal-scrim" style={{ zIndex: 400 }} onClick={e => e.target === e.currentTarget && onOpenChange(false)}>
      <div className="k-modal" style={{ maxWidth: 540 }}>
        {/* Header */}
        <div style={{ padding: '20px 24px 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--k-primary)', marginBottom: 2, fontFamily: 'var(--font-ui), var(--font-hindi)' }}>
                {editing ? 'EDIT TASK · संपादन' : clientMode ? 'REQUEST TASK · अनुरोध' : 'NEW TASK · नया कार्य'}
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 400, color: 'var(--ink)' }}>
                {editing ? 'Edit task' : 'What needs doing?'}
              </div>
            </div>
            <button onClick={() => onOpenChange(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--ink-3)', lineHeight: 1, padding: 4, marginTop: -2 }}>×</button>
          </div>
          <div style={{ height: 1, background: 'var(--rule-soft)', margin: '16px 0 0' }} />
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Title */}
          <input
            ref={titleRef}
            className="k-input"
            style={{ width: '100%', fontSize: 18, fontFamily: 'var(--font-display)', fontWeight: 400, background: 'transparent', border: 'none', borderBottom: '1px solid var(--rule)', borderRadius: 0, padding: '6px 0', color: 'var(--ink)' }}
            value={form.title}
            onChange={upd('title')}
            placeholder="Write a clear, action-first title..."
            onKeyDown={e => e.key === 'Enter' && save()}
          />

          {/* Row 1: Project + Status */}
          <div style={{ display: 'grid', gridTemplateColumns: lockToProject ? '1fr' : '1fr 1fr', gap: 12 }}>
            {!lockToProject && (
              <div>
                <label style={lbl}>PROJECT · परियोजना</label>
                <select className="k-input" style={{ width: '100%' }} value={form.team_id} onChange={upd('team_id')}>
                  <option value="">No project</option>
                  {teams.filter(t => t.team_id && t.name).map(t => (
                    <option key={t.team_id} value={t.team_id}>{t.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label style={lbl}>PRIORITY · प्राथमिकता</label>
              <select className="k-input" style={{ width: '100%' }} value={form.priority} onChange={upd('priority')}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>

          {/* Row 2: Due + Assignees */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl}>DUE · नियत तिथि</label>
              <input type="datetime-local" className="k-input" style={{ width: '100%' }} value={form.due_at} onChange={upd('due_at')} />
            </div>

            {/* Assignee picker */}
            <div ref={assigneeRef} style={{ position: 'relative' }}>
              <label style={lbl}>ASSIGNEES · नियुक्त</label>
              <button
                type="button"
                onClick={() => setAssigneeOpen(v => !v)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                  background: 'var(--bg-soft)', border: '1px solid var(--rule)',
                  borderRadius: 'var(--r-md)', padding: '7px 10px', cursor: 'pointer',
                  fontFamily: 'var(--font-ui)', fontSize: 13, color: selectedMembers.length ? 'var(--ink)' : 'var(--ink-faint)',
                  minHeight: 36,
                }}
              >
                {selectedMembers.length === 0 ? (
                  <span style={{ flex: 1, textAlign: 'left' }}>Pick team members…</span>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, flexWrap: 'wrap' }}>
                    {selectedMembers.slice(0, 3).map((m, i) => {
                      const name = m.display_name || m.full_name || m.name || '';
                      return (
                        <span key={m.user_id || m.member_id} style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          background: 'var(--side-active)', borderRadius: 20,
                          padding: '2px 8px 2px 4px', fontSize: 12, fontWeight: 500,
                        }}>
                          <span style={{
                            width: 18, height: 18, borderRadius: '50%', fontSize: 9, fontWeight: 700,
                            background: AVATAR_COLORS[i % AVATAR_COLORS.length], color: '#fff',
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                          }}>{userInitials(name)}</span>
                          {name.split(' ')[0]}
                        </span>
                      );
                    })}
                    {selectedMembers.length > 3 && (
                      <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>+{selectedMembers.length - 3}</span>
                    )}
                  </div>
                )}
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ flexShrink: 0, color: 'var(--ink-3)' }}>
                  <path d="M2 4l4 4 4-4"/>
                </svg>
              </button>

              {/* Dropdown */}
              {assigneeOpen && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 100,
                  background: 'var(--surface)', border: '1px solid var(--rule)',
                  borderRadius: 'var(--r-md)', boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
                  maxHeight: 220, overflowY: 'auto',
                }}>
                  {members.length === 0 ? (
                    <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--ink-3)', fontStyle: 'italic' }}>
                      {form.team_id ? 'No members found' : 'Select a project first'}
                    </div>
                  ) : (
                    members.map((m, i) => {
                      const uid = m.user_id || m.member_id;
                      const name = m.display_name || m.full_name || m.name || '';
                      if (!name) return null; // skip email-only members
                      const title = m.member_role || m.position || m.job_title || '';
                      const checked = selectedIds.includes(uid);
                      return (
                        <button
                          key={uid}
                          type="button"
                          onClick={() => toggleAssignee(uid)}
                          style={{
                            width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                            padding: '9px 12px', background: checked ? 'var(--side-active)' : 'transparent',
                            border: 'none', cursor: 'pointer', textAlign: 'left',
                            borderBottom: i < members.length - 1 ? '1px solid var(--rule-soft)' : 'none',
                          }}
                        >
                          {/* Avatar */}
                          <span style={{
                            width: 30, height: 30, borderRadius: '50%', fontSize: 11, fontWeight: 700,
                            background: AVATAR_COLORS[i % AVATAR_COLORS.length], color: '#fff',
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                          }}>{userInitials(name)}</span>
                          {/* Name + title */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', fontFamily: 'var(--font-ui)' }}>
                              {name}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '2px 6px', marginTop: 2 }}>
                              {title && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{title}</span>}
                              {title && m.company_name && <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>·</span>}
                              {m.company_name && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{m.company_name}</span>}
                              {m.receives_approval_emails && (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 700, color: '#05b7aa', background: '#05b7aa18', borderRadius: 4, padding: '1px 5px', marginTop: 1 }}>
                                  <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="#05b7aa" strokeWidth="2"><path d="M1.5 5l3 3 4-4"/></svg>
                                  {m.role === 'client' ? 'Client Approver' : 'Internal Approver'}
                                </span>
                              )}
                            </div>
                          </div>
                          {/* Checkmark */}
                          {checked && (
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--k-primary)" strokeWidth="2" style={{ flexShrink: 0 }}>
                              <path d="M2 7l4 4 6-6"/>
                            </svg>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Description */}
          <div>
            <label style={lbl}>DESCRIPTION · विवरण</label>
            <textarea
              className="k-input"
              rows={3}
              style={{ width: '100%', resize: 'vertical', lineHeight: 1.6 }}
              value={form.description}
              onChange={upd('description')}
              placeholder="Acceptance criteria, context, links..."
            />
          </div>

          {/* Attachments — shown for client requests and new tasks */}
          {(clientMode || !editing) && (
            <div
              onDragEnter={e => { e.preventDefault(); e.stopPropagation(); dragCounter.current++; setDragOver(true); }}
              onDragLeave={e => { e.preventDefault(); e.stopPropagation(); dragCounter.current--; if (dragCounter.current <= 0) { dragCounter.current = 0; setDragOver(false); } }}
              onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={e => {
                e.preventDefault(); e.stopPropagation();
                dragCounter.current = 0; setDragOver(false);
                const dt = e.dataTransfer;
                if (!dt?.files?.length || attachments.length >= MAX_FILES) return;
                handleFileChange({ target: { files: dt.files, value: '' } });
              }}
              style={{ position: 'relative' }}
            >
              <label style={lbl}>ATTACHMENTS · संलग्नक</label>
              <input ref={fileRef} type="file" multiple accept={DOC_ACCEPT} style={{ display: 'none' }} onChange={handleFileChange} />
              <input ref={videoRef} type="file" multiple accept={VIDEO_ACCEPT} style={{ display: 'none' }} onChange={handleFileChange} />

              {/* Drop overlay */}
              {dragOver && attachments.length < MAX_FILES && (
                <div style={{
                  position: 'absolute', inset: 0, zIndex: 50,
                  background: 'var(--k-primary-dim, rgba(0,130,198,0.08))',
                  border: '2px dashed var(--k-primary)', borderRadius: 10,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  pointerEvents: 'none',
                }}>
                  <div style={{ textAlign: 'center' }}>
                    <svg width="24" height="24" viewBox="0 0 16 16" fill="none" stroke="var(--k-primary)" strokeWidth="1.5" style={{ marginBottom: 4 }}><path d="M8 12V4M4 8l4-4 4 4"/><path d="M2 14h12"/></svg>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--k-primary)' }}>Drop files here</div>
                  </div>
                </div>
              )}

              {/* Upload progress */}
              {uploading && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink-3)', fontSize: 13, marginBottom: 6 }}>
                    <div className="k-spinner" style={{ width: 14, height: 14, flexShrink: 0 }} />
                    <span>Uploading{uploadProgress > 0 ? ` ${uploadProgress}%` : '…'}</span>
                  </div>
                  <div style={{ height: 4, background: 'var(--rule)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${uploadProgress || 0}%`, background: 'var(--k-primary)', borderRadius: 2, transition: 'width 0.25s ease', minWidth: uploadProgress > 0 ? undefined : '15%' }} />
                  </div>
                </div>
              )}
              {uploadError && (
                <div style={{ fontSize: 12, color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 12px', marginBottom: 8 }}>
                  {uploadError}
                </div>
              )}

              {/* File list with previews */}
              {attachments.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                  {attachments.map((f, i) => {
                    const n = f.name || '';
                    const isImg = IMAGE_EXT.test(n);
                    const isVid = VIDEO_EXT.test(n);
                    const isPdf = /\.pdf$/i.test(n);
                    const isDoc = /\.(doc|docx|xls|xlsx|ppt|pptx)$/i.test(n);
                    const canPreview = isImg || isVid || isPdf || isDoc;
                    return (
                      <div key={i} style={{ borderRadius: 8, background: 'var(--bg)', border: '1px solid var(--rule)', fontSize: 13, overflow: 'hidden' }}>
                        {isImg && f.url && (
                          <div onClick={() => setPreviewFile(f)} style={{ cursor: 'pointer', background: 'var(--rule-soft)', borderBottom: '1px solid var(--rule)' }}>
                            <img src={f.url} alt={n} style={{ display: 'block', width: '100%', maxHeight: 140, objectFit: 'cover' }} loading="lazy" />
                          </div>
                        )}
                        {isVid && f.url && (
                          <div onClick={() => setPreviewFile(f)} style={{ cursor: 'pointer', background: '#000', borderBottom: '1px solid var(--rule)', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 80 }}>
                            <video src={f.url} preload="metadata" muted style={{ display: 'block', width: '100%', maxHeight: 140, objectFit: 'cover' }} />
                            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.3)' }}>
                              <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#8b5cf6" strokeWidth="1.8"><polygon points="5,3 13,8 5,13"/></svg>
                              </div>
                            </div>
                          </div>
                        )}
                        {(isPdf || isDoc) && f.url && (
                          <div onClick={() => setPreviewFile(f)} style={{ cursor: 'pointer', padding: '12px 16px', background: 'var(--bg-soft)', borderBottom: '1px solid var(--rule)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="var(--k-primary)" strokeWidth="1.5"><path d="M9 1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5L9 1z"/><path d="M9 1v4h4"/></svg>
                            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--k-primary)' }}>Click to preview</span>
                          </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px' }}>
                          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="var(--k-primary)" strokeWidth="1.5"><path d="M9 1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5L9 1z"/><path d="M9 1v4h4"/></svg>
                          <a href={f.url} target="_blank" rel="noreferrer" style={{ flex: 1, color: 'var(--ink-2)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n}</a>
                          {canPreview && (
                            <button onClick={() => setPreviewFile(f)} title="Preview" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', padding: 0, display: 'flex', flexShrink: 0 }}>
                              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="3"/><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/></svg>
                            </button>
                          )}
                          <button onClick={() => setAttachments(p => p.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
                        </div>
                      </div>
                    );
                  })}
                  {attachments.length < MAX_FILES && !uploading && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button type="button" onClick={() => fileRef.current?.click()} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, border: '1.5px dashed var(--rule-strong)', background: 'transparent', color: 'var(--ink-3)', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-ui)' }}>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M8 3v10M3 8h10"/></svg>
                        Add files
                      </button>
                      <button type="button" onClick={() => videoRef.current?.click()} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, border: '1.5px dashed var(--rule-strong)', background: 'transparent', color: '#8b5cf6', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-ui)' }}>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#8b5cf6" strokeWidth="1.8"><polygon points="5,3 13,8 5,13"/></svg>
                        Add video
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Empty state — upload buttons */}
              {attachments.length === 0 && !uploading && (
                <div style={{ display: 'flex', gap: 8, width: '100%', boxSizing: 'border-box' }}>
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '18px 10px', borderRadius: 10, border: `1.5px dashed ${dragOver ? 'var(--k-primary)' : 'var(--rule-strong)'}`, background: dragOver ? 'var(--k-primary-dim, rgba(0,130,198,0.06))' : 'transparent', color: 'var(--ink-3)', cursor: 'pointer', fontFamily: 'var(--font-ui)', transition: 'border-color 0.15s, background 0.15s' }}
                  >
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 12V4M4 8l4-4 4 4"/><path d="M2 14h12"/></svg>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)' }}>Files & Images</span>
                    <span style={{ fontSize: 10, lineHeight: 1.5, textAlign: 'center', color: 'var(--ink-3)' }}>PDF, Word, Excel<br/>max 25 MB</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => videoRef.current?.click()}
                    style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '18px 10px', borderRadius: 10, border: `1.5px dashed ${dragOver ? 'var(--k-primary)' : '#c4b5fd'}`, background: dragOver ? 'var(--k-primary-dim, rgba(0,130,198,0.06))' : 'transparent', color: '#8b5cf6', cursor: 'pointer', fontFamily: 'var(--font-ui)', transition: 'border-color 0.15s, background 0.15s' }}
                  >
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="#8b5cf6" strokeWidth="1.5"><polygon points="4,2 14,8 4,14" fill="none"/></svg>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>Video</span>
                    <span style={{ fontSize: 10, lineHeight: 1.5, textAlign: 'center' }}>Any format<br/>max 50 MB</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--rule-soft)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: 'var(--ink-faint)', flex: 1 }}>↵ to create · Esc to close</span>
          <button className="k-btn k-btn--ghost k-btn--sm" onClick={() => onOpenChange(false)}>Cancel</button>
          <button className="k-btn k-btn--primary k-btn--sm" onClick={save} disabled={!form.title.trim()}>
            {editing ? 'Save changes' : clientMode ? 'Submit request' : 'Create task'}
          </button>
        </div>
      </div>

      {/* Preview lightbox — portalled to body to escape modal stacking context */}
      {previewFile && createPortal(
        <PreviewOverlay file={previewFile} onClose={() => setPreviewFile(null)} />,
        document.body,
      )}
    </div>
  );
}

function PreviewOverlay({ file, onClose }) {
  const n = file.name || '';
  const [imgError, setImgError] = useState(false);
  const isImg = IMAGE_EXT.test(n);
  const isVid = VIDEO_EXT.test(n);
  const isPdf = /\.pdf$/i.test(n);
  const isDoc = /\.(doc|docx|xls|xlsx|ppt|pptx)$/i.test(n);
  const isHttp = /^https?:\/\//i.test(file.url || '');
  const officeUrl = isDoc && isHttp ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(file.url)}` : null;
  const canPreviewDoc = isPdf || (isDoc && isHttp);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh', width: canPreviewDoc ? '90vw' : undefined, height: canPreviewDoc ? '90vh' : undefined }}>
        <button onClick={onClose} style={{ position: 'absolute', top: -14, right: -14, zIndex: 10, width: 32, height: 32, borderRadius: '50%', background: '#fff', border: 'none', cursor: 'pointer', fontSize: 18, fontWeight: 700, color: '#333', boxShadow: '0 2px 8px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>

        {isImg && !imgError && <img src={file.url} alt={n} onError={() => setImgError(true)} style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 8, display: 'block', objectFit: 'contain' }} />}
        {isVid && <video src={file.url} controls autoPlay style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 8, display: 'block' }} />}
        {isPdf && (
          <object data={file.url} type="application/pdf" style={{ width: '100%', height: '100%', borderRadius: 8, border: 'none' }}>
            <iframe src={file.url} style={{ width: '100%', height: '100%', border: 'none', borderRadius: 8 }} title={n} />
          </object>
        )}
        {isDoc && officeUrl && (
          <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <iframe src={officeUrl} style={{ flex: 1, width: '100%', border: 'none', borderRadius: 8 }} title={n} />
            <div style={{ textAlign: 'center', marginTop: 10 }}>
              <a href={file.url} target="_blank" rel="noreferrer" style={{ color: '#fff', fontSize: 13, textDecoration: 'underline', opacity: 0.8 }}>Open in new tab</a>
            </div>
          </div>
        )}
        {((isImg && imgError) || (!isImg && !isVid && !canPreviewDoc)) && (
          <div style={{ background: '#fff', borderRadius: 12, padding: 32, textAlign: 'center' }}>
            <div style={{ fontSize: 14, color: '#333', marginBottom: 16 }}>{imgError ? 'Image could not be loaded' : 'Preview not available for this file type'}</div>
            <a href={file.url} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#fff', fontSize: 13, fontWeight: 600, background: 'var(--k-primary, #0082c6)', borderRadius: 8, padding: '10px 20px', textDecoration: 'none' }}>Open in new tab</a>
          </div>
        )}
      </div>
    </div>
  );
}

/* Every call site pairs both scripts in one node ("PROJECT · परियोजना"), so the
   stack must cover both. --font-ui first keeps the Latin in the user's UI face;
   --font-hindi appended after it catches only the Devanagari, which otherwise
   fell through to the OS fallback in a different face and width. */
const lbl = {
  display: 'block',
  fontFamily: 'var(--font-ui), var(--font-hindi)',
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  marginBottom: 6,
};
