/**

 * NewTaskModal.jsx — global "New task" modal. k-* design system.

 * Opened from the top-bar "+ New task" button (AppShell).

 */

import React, { useState, useEffect, useRef } from 'react';

import { api } from '../lib/api';

import { AVATAR_COLORS, PRIORITY_COLOR, userInitials, logger } from '../lib/utils';

import { currentUser } from '../lib/auth';

import ReminderPicker, { DEFAULT_REMINDERS } from './ReminderPicker';



const PRIORITY_DOTS = {

  low:    { color: PRIORITY_COLOR.low,    label: 'Low',    hi: 'लघु' },

  medium: { color: PRIORITY_COLOR.medium, label: 'Medium', hi: 'मध्यम' },

  high:   { color: PRIORITY_COLOR.high,   label: 'High',   hi: 'उच्च' },

  urgent: { color: PRIORITY_COLOR.urgent, label: 'Urgent', hi: 'अत्यावश्यक' },

};



export default function NewTaskModal({ open, onClose, onCreated, defaultProjectId = '', defaultDueAt = '', defaultColumnId = null }) {

  const isClient = currentUser()?.role === 'client';

  const [title,       setTitle]       = useState('');

  const [projectId,   setProjectId]   = useState('');

  const [status,      setStatus]      = useState('todo');

  const [priority,    setPriority]    = useState('medium');

  const [dueAt,       setDueAt]       = useState('');

  const [description, setDescription] = useState('');

  const [assignees,   setAssignees]   = useState([]);

  const [files,          setFiles]          = useState([]);

  const [uploading,      setUploading]      = useState(false);

  const [uploadProgress, setUploadProgress] = useState(0);

  const [uploadError,    setUploadError]    = useState('');

  const [projects,    setProjects]    = useState([]);

  const [members,     setMembers]     = useState([]);

  const [saving,      setSaving]      = useState(false);

  const [titleError,  setTitleError]  = useState(false);

  const [reminders,          setReminders]          = useState([]);
  const [assigneeOpen,       setAssigneeOpen]       = useState(false);
  const [templates,          setTemplates]          = useState([]);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [subtasks,           setSubtasks]           = useState([]);



  const [dragOver,         setDragOver]         = useState(false);
  const [previewFile,      setPreviewFile]      = useState(null);
  const dragCounter = useRef(0);

  const titleRef    = useRef(null);

  const fileRef     = useRef(null);
  const videoRef    = useRef(null);

  const assigneeRef = useRef(null);



  useEffect(() => {

    if (!open) return;

    setTitle(''); setProjectId(defaultProjectId || ''); setStatus('todo'); setPriority('medium');

    const dateOnly = defaultDueAt ? defaultDueAt.split('T')[0] : '';
    setDueAt(dateOnly); setReminders(dateOnly ? DEFAULT_REMINDERS : []); setDescription(''); setAssignees([]); setFiles([]);

    setTitleError(false); setAssigneeOpen(false); setTemplates([]); setSubtasks([]); setShowTemplatePicker(false); setUploadError('');

    api.get('/teams').then(r => setProjects(Array.isArray(r.data) ? r.data : [])).catch(() => {});

    setTimeout(() => titleRef.current?.focus(), 80);

  }, [open]);



  // Fetch members + templates when project changes

  useEffect(() => {

    if (!projectId) { setMembers([]); setTemplates([]); setAssignees([]); return; }
    setAssignees([]);

    api.get(`/teams/${projectId}`)
      .then(r => setMembers(Array.isArray(r.data?.members) ? r.data.members : []))
      .catch(() => setMembers([]));
    api.get('/templates/tasks', { params: { team_id: projectId } })
      .then(r => setTemplates(Array.isArray(r.data) ? r.data : []))
      .catch(() => setTemplates([]));
  }, [projectId]);

  const applyTemplate = (tmpl) => {
    let cfg;
    try {
      cfg = typeof tmpl.config === 'string' ? JSON.parse(tmpl.config) : (tmpl.config || {});
    } catch {
      cfg = {};
    }
    // Always replace all fields — don't append or conditionally skip
    if (cfg.title)       setTitle(cfg.title);
    if (cfg.description) setDescription(cfg.description);
    if (cfg.priority)    setPriority(cfg.priority);
    setReminders(cfg.reminders || []);
    setSubtasks((cfg.subtasks || []).map(s => ({ ...s, is_done: false })));
    setFiles((cfg.attachments || []).map(a => ({ name: a.name, url: a.url, key: a.key || null })));
    setShowTemplatePicker(false);
    setTimeout(() => titleRef.current?.focus(), 50);
  };



  // Close assignee dropdown on outside click

  useEffect(() => {

    if (!assigneeOpen) return;

    const handler = (e) => {

      if (assigneeRef.current && !assigneeRef.current.contains(e.target)) setAssigneeOpen(false);

    };

    document.addEventListener('mousedown', handler);

    return () => document.removeEventListener('mousedown', handler);

  }, [assigneeOpen]);



  const toggleAssignee = (uid) => {

    setAssignees(prev => prev.includes(uid) ? prev.filter(x => x !== uid) : [...prev, uid]);

  };



  const handleFileChange = async (e) => {

    const picked = Array.from(e.target.files);

    if (!picked.length) return;

    setUploading(true);
    setUploadProgress(0);
    setUploadError('');

    try {

      for (let i = 0; i < picked.length; i++) {
        const file = picked[i];
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
                setUploadProgress(Math.round(((i + filePct) / picked.length) * 100));
              }
            },
          });
          clearTimeout(stallTimer);
          setFiles(prev => [...prev, { name: file.name, url: res.data.url, key: res.data.key || null }]);
          setUploadProgress(Math.round(((i + 1) / picked.length) * 100));
        } catch (err) {
          clearTimeout(stallTimer);
          if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') {
            setUploadError('Upload got stuck — no data transferred for 30 s. Check your connection and try again.');
          } else {
            setUploadError(err?.response?.data?.detail || 'Upload failed — please try again.');
          }
          return;
        }
      }

    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileRef.current)  fileRef.current.value  = '';
      if (videoRef.current) videoRef.current.value = '';
    }

  };



  const handleSubmit = async () => {

    if (!title.trim()) { setTitleError(true); titleRef.current?.focus(); return; }

    if (saving) return;

    setSaving(true);

    try {

      const payload = {

        title: title.trim(),

        status,

        priority,

        description: description.trim() || null,

      };

      if (projectId)        payload.team_id           = projectId;

      if (defaultColumnId)  payload.column_id         = defaultColumnId;

      if (dueAt) {
        // date-only input ("2026-06-20") → treat as 16:00 IST (UTC+5:30)
        payload.due_at = new Date(dueAt + 'T16:00:00+05:30').toISOString();
        if (reminders.length) {
          payload.reminders = reminders.map(r => ({
            offset_minutes: r.offset_minutes,
            channels: Object.entries(r.channels || {}).filter(([, v]) => v).map(([k]) => k),
          }));
        }
      }

      if (assignees.length) payload.assignee_user_ids  = assignees;

      if (files.length)     payload.attachments        = files.map(f => ({ name: f.name, url: f.url, key: f.key || null }));
      if (subtasks.length)  payload.subtasks           = subtasks;

      const res = await (isClient ? api.post('/client/tasks/request', payload) : api.post('/tasks', payload));

      onCreated?.(res.data);

      onClose();

    } catch (err) {

      logger.error('Task creation failed', err);

    }

    finally { setSaving(false); }

  };



  const handleKeyDown = (e) => {

    if (e.key === 'Escape') onClose();

    if (e.key === 'Enter' && e.target === titleRef.current) { e.preventDefault(); handleSubmit(); }

  };



  if (!open) return null;



  const selectedMembers = members.filter(m => assignees.includes(m.user_id));



  return (

    <div

      className="k-modal-scrim"

      style={{ zIndex: 300 }}

      onClick={e => e.target === e.currentTarget && onClose()}

      onKeyDown={handleKeyDown}

    >

      <div className="k-modal">



        {/* Header */}

        <div style={{ padding: '20px 24px 0', flexShrink: 0 }}>

          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>

            <div>

              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--k-primary)', marginBottom: 2 }}>

                {isClient ? 'REQUEST TASK' : 'NEW TASK'} · <span style={{ fontFamily: 'var(--font-hindi)', textTransform: 'none', letterSpacing: 0 }}>{isClient ? 'अनुरोध' : 'नया कार्य'}</span>

              </div>

              <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 400, color: 'var(--ink)' }}>

                What needs doing?

              </div>

            </div>

            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--ink-3)', lineHeight: 1, padding: 4, marginTop: -2 }}>×</button>

          </div>

          <div style={{ height: 1, background: 'var(--rule-soft)', margin: '16px 0 0' }} />

        </div>



        {/* Body */}

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>




          {/* Template picker */}
          {projectId && templates.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              {showTemplatePicker ? (
                <div style={{ background: 'var(--bg-soft)', borderRadius: 'var(--r-md)', border: '1px solid var(--rule)', padding: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink-3)', marginBottom: 8 }}>
                    PICK A TEMPLATE · साँचा
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {templates.map(t => (
                      <button key={t.template_id} onClick={() => applyTemplate(t)}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
                          borderRadius: 99, border: '1.5px solid var(--rule)',
                          background: 'var(--surface)', cursor: 'pointer', fontSize: 13,
                          fontWeight: 500, color: 'var(--ink-2)' }}>
                        <span>{t.icon || '📋'}</span>
                        {t.name}
                        {t.is_default && (
                          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--k-primary)',
                            background: 'color-mix(in srgb, var(--k-primary) 12%, transparent)',
                            padding: '1px 5px', borderRadius: 99 }}>DEFAULT</span>
                        )}
                      </button>
                    ))}
                    <button onClick={() => setShowTemplatePicker(false)}
                      style={{ padding: '6px 10px', borderRadius: 99, border: '1px solid var(--rule)',
                        background: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--ink-3)' }}>
                      ✕ Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setShowTemplatePicker(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600,
                    color: 'var(--k-primary)', background: 'color-mix(in srgb, var(--k-primary) 8%, transparent)',
                    border: '1px dashed var(--k-primary)', borderRadius: 'var(--r-md)',
                    padding: '5px 12px', cursor: 'pointer' }}>
                  📋 Use a template
                </button>
              )}
            </div>
          )}

          {/* Title */}

          <div style={{ marginBottom: 20 }}>

            <input

              ref={titleRef}

              value={title}

              onChange={e => { setTitle(e.target.value); if (e.target.value.trim()) setTitleError(false); }}

              placeholder="Write a clear, action-first title…"

              style={{ width: '100%', border: 'none', borderBottom: `2px solid ${titleError ? '#dc2626' : 'var(--rule)'}`, outline: 'none', fontSize: 20, fontFamily: 'var(--font-display)', color: 'var(--ink)', background: 'transparent', paddingBottom: 10, fontWeight: 400 }}

            />

            {titleError && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 5 }}>Title is required.</div>}

          </div>



          {/* PROJECT + STATUS */}

          <div style={{ display: 'grid', gridTemplateColumns: isClient ? '1fr' : '1fr 1fr', gap: 16, marginBottom: 16 }}>

            <div>

              <FieldLabel>PROJECT · परियोजना</FieldLabel>

              <select className="k-select" style={{ width: '100%' }} value={projectId} onChange={e => setProjectId(e.target.value)}>

                <option value="">Personal task</option>

                {projects.map(p => <option key={p.team_id} value={p.team_id}>{p.name}</option>)}

              </select>

            </div>

            {!isClient && (

            <div>

              <FieldLabel>STATUS · स्थिति</FieldLabel>

              <select className="k-select" style={{ width: '100%' }} value={status} onChange={e => setStatus(e.target.value)}>

                <option value="todo">To do</option>

                <option value="in_progress">In progress</option>

                <option value="in_review">In review</option>

                <option value="done">Done</option>

              </select>

            </div>

            )}

          </div>



          {/* PRIORITY */}

          <div style={{ marginBottom: 16 }}>

            <FieldLabel>PRIORITY · प्राथमिकता</FieldLabel>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>

              {Object.entries(PRIORITY_DOTS).map(([key, { color, label }]) => (

                <button key={key} onClick={() => setPriority(key)}

                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 99, border: `1.5px solid ${priority === key ? color : 'var(--rule)'}`, background: priority === key ? `${color}18` : 'transparent', color: priority === key ? color : 'var(--ink-3)', cursor: 'pointer', fontSize: 13, fontWeight: priority === key ? 700 : 400, transition: 'all 0.15s' }}>

                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }} />

                  {label}

                </button>

              ))}

            </div>

          </div>




          {/* Subtasks from template */}
          {subtasks.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>
                SUBTASKS · उप-कार्य
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {subtasks.map((s, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                    background: 'var(--bg-soft)', borderRadius: 'var(--r-md)', border: '1px solid var(--rule-soft)' }}>
                    <input type="checkbox" checked={s.is_done} onChange={e => setSubtasks(prev => prev.map((x, j) => j === i ? { ...x, is_done: e.target.checked } : x))} />
                    <span style={{ fontSize: 13, color: s.is_done ? 'var(--ink-faint)' : 'var(--ink)', textDecoration: s.is_done ? 'line-through' : 'none', flex: 1 }}>
                      {s.title}
                    </span>
                    <button onClick={() => setSubtasks(prev => prev.filter((_, j) => j !== i))}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', fontSize: 14 }}>×</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* DUE + ASSIGNEES */}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>

            <div>

              <FieldLabel>DUE · नियत तिथि</FieldLabel>

              <input
                type="date"
                className="k-input"
                style={{ width: '100%' }}
                value={dueAt}
                onChange={e => {
                  const val = e.target.value;
                  setDueAt(val);
                  if (!val) setReminders([]);
                  else if (reminders.length === 0) setReminders(DEFAULT_REMINDERS);
                }}
              />
              {dueAt && (
                <div style={{ marginTop: 8 }}>
                  <ReminderPicker value={reminders} onChange={setReminders} disabled={!dueAt} />
                </div>
              )}

            </div>



            {/* Assignee dropdown */}

            <div ref={assigneeRef} style={{ position: 'relative' }}>

              <FieldLabel>ASSIGNEES · नियुक्त</FieldLabel>

              <button

                type="button"

                onClick={() => setAssigneeOpen(v => !v)}

                style={{

                  width: '100%', display: 'flex', alignItems: 'center', gap: 8,

                  background: 'var(--bg-soft)', border: '1px solid var(--rule)',

                  borderRadius: 'var(--r-md)', padding: '7px 10px', cursor: 'pointer',

                  fontFamily: 'var(--font-ui)', fontSize: 13,

                  color: selectedMembers.length ? 'var(--ink)' : 'var(--ink-faint)',

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

                        <span key={m.user_id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--side-active)', borderRadius: 20, padding: '2px 8px 2px 4px', fontSize: 12, fontWeight: 500 }}>

                          <span style={{ width: 18, height: 18, borderRadius: '50%', fontSize: 9, fontWeight: 700, background: AVATAR_COLORS[i % AVATAR_COLORS.length], color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>

                            {userInitials(name)}

                          </span>

                          {name.split(' ')[0]}

                        </span>

                      );

                    })}

                    {selectedMembers.length > 3 && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>+{selectedMembers.length - 3}</span>}

                  </div>

                )}

                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ flexShrink: 0, color: 'var(--ink-3)' }}>

                  <path d="M2 4l4 4 4-4"/>

                </svg>

              </button>



              {assigneeOpen && (

                <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 100, background: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: 'var(--r-md)', boxShadow: '0 8px 24px rgba(0,0,0,0.18)', maxHeight: 220, overflowY: 'auto' }}>

                  {members.length === 0 ? (

                    <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--ink-3)', fontStyle: 'italic' }}>

                      {projectId ? 'No members found' : 'Select a project first'}

                    </div>

                  ) : (

                    members.map((m, i) => {

                      const uid     = m.user_id;

                      const name    = m.display_name || m.full_name || m.name || '';

                      if (!name) return null; // skip email-only members

                      const jobTitle = m.member_role || m.position || m.job_title || '';

                      const checked = assignees.includes(uid);

                      return (

                        <button

                          key={uid}

                          type="button"

                          onClick={() => toggleAssignee(uid)}

                          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: checked ? 'var(--side-active)' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', borderBottom: i < members.length - 1 ? '1px solid var(--rule-soft)' : 'none' }}

                        >

                          <span style={{ width: 30, height: 30, borderRadius: '50%', fontSize: 11, fontWeight: 700, background: AVATAR_COLORS[i % AVATAR_COLORS.length], color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>

                            {userInitials(name)}

                          </span>

                          <div style={{ flex: 1, minWidth: 0 }}>

                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', fontFamily: 'var(--font-ui)' }}>{name}</div>

                            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '2px 6px', marginTop: 2 }}>

                              {jobTitle && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{jobTitle}</span>}

                              {jobTitle && m.company_name && <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>·</span>}

                              {m.company_name && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{m.company_name}</span>}

                              {m.receives_approval_emails && (

                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 700, color: '#05b7aa', background: '#05b7aa18', borderRadius: 4, padding: '1px 5px', marginTop: 1 }}>

                                  <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="#05b7aa" strokeWidth="2"><path d="M1.5 5l3 3 4-4"/></svg>

                                  {m.role === 'client' ? 'Client Approver' : 'Internal Approver'}

                                </span>

                              )}

                            </div>

                          </div>

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



          {/* DESCRIPTION */}

          <div style={{ marginBottom: 16 }}>

            <FieldLabel>DESCRIPTION · विवरण</FieldLabel>

            <textarea

              className="k-input"

              rows={3}

              style={{ resize: 'vertical', width: '100%', lineHeight: 1.6 }}

              value={description}

              onChange={e => setDescription(e.target.value)}

              placeholder="Acceptance criteria, context, links…"

            />

          </div>



          {/* ATTACHMENTS */}
          <div
            onDragEnter={e => { e.preventDefault(); e.stopPropagation(); dragCounter.current++; setDragOver(true); }}
            onDragLeave={e => { e.preventDefault(); e.stopPropagation(); dragCounter.current--; if (dragCounter.current <= 0) { dragCounter.current = 0; setDragOver(false); } }}
            onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={e => {
              e.preventDefault(); e.stopPropagation();
              dragCounter.current = 0; setDragOver(false);
              const dt = e.dataTransfer;
              if (!dt?.files?.length || files.length >= 10) return;
              handleFileChange({ target: { files: dt.files, value: '' } });
            }}
            style={{ position: 'relative' }}
          >
            <FieldLabel>ATTACHMENTS · संलग्नक</FieldLabel>
            <input ref={fileRef} type="file" multiple accept=".jpg,.jpeg,.png,.gif,.heic,.heif,.pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt" style={{ display: 'none' }} onChange={handleFileChange} />
            <input ref={videoRef} type="file" multiple accept="video/*,.mov,.mp4,.webm,.avi,.mkv,.m4v,.3gp,.flv,.wmv,.ogv,.ts" style={{ display: 'none' }} onChange={handleFileChange} />

            {/* Drop overlay */}
            {dragOver && files.length < 10 && (
              <div style={{
                position: 'absolute', inset: 0, zIndex: 50,
                background: 'var(--k-primary-dim, rgba(0,130,198,0.08))',
                border: '2px dashed var(--k-primary)',
                borderRadius: 10,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                pointerEvents: 'none',
              }}>
                <div style={{ textAlign: 'center' }}>
                  <svg width="24" height="24" viewBox="0 0 16 16" fill="none" stroke="var(--k-primary)" strokeWidth="1.5" style={{ marginBottom: 4 }}><path d="M8 12V4M4 8l4-4 4 4"/><path d="M2 14h12"/></svg>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--k-primary)' }}>Drop files here</div>
                </div>
              </div>
            )}

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
            {files.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                {files.map((f, i) => {
                  const n = f.name || '';
                  const isImg = /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i.test(n);
                  const isVid = /\.(mov|mp4|webm|avi|mkv|m4v|3gp|3gpp|flv|wmv|asf|ogv|ts|mts|m2ts)$/i.test(n);
                  const isPdf = /\.pdf$/i.test(n);
                  const isDoc = /\.(doc|docx|xls|xlsx|ppt|pptx)$/i.test(n);
                  const canPreview = isImg || isVid || isPdf || isDoc;
                  return (
                    <div key={i} style={{ borderRadius: 8, background: 'var(--bg)', border: '1px solid var(--rule)', fontSize: 13, overflow: 'hidden' }}>
                      {/* Image thumbnail */}
                      {isImg && f.url && (
                        <div onClick={() => setPreviewFile(f)} style={{ cursor: 'pointer', background: 'var(--rule-soft)', borderBottom: '1px solid var(--rule)' }}>
                          <img src={f.url} alt={n} style={{ display: 'block', width: '100%', maxHeight: 140, objectFit: 'cover' }} loading="lazy" />
                        </div>
                      )}
                      {/* Video thumbnail */}
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
                      {/* Doc preview banner */}
                      {(isPdf || isDoc) && f.url && (
                        <div onClick={() => setPreviewFile(f)} style={{ cursor: 'pointer', padding: '12px 16px', background: 'var(--bg-soft)', borderBottom: '1px solid var(--rule)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="var(--k-primary)" strokeWidth="1.5"><path d="M9 1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5L9 1z"/><path d="M9 1v4h4"/></svg>
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--k-primary)' }}>Click to preview</span>
                        </div>
                      )}
                      {/* File info row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px' }}>
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="var(--k-primary)" strokeWidth="1.5"><path d="M9 1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5L9 1z"/><path d="M9 1v4h4"/></svg>
                        <a href={f.url} target="_blank" rel="noreferrer" style={{ flex: 1, color: 'var(--ink-2)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n}</a>
                        {canPreview && (
                          <button onClick={() => setPreviewFile(f)} title="Preview" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', padding: 0, display: 'flex', flexShrink: 0 }}>
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="3"/><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/></svg>
                          </button>
                        )}
                        <button onClick={() => setFiles(p => p.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
                      </div>
                    </div>
                  );
                })}
                {files.length < 10 && !uploading && (
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
            {files.length === 0 && !uploading && (
              <div style={{ display: 'flex', gap: 8, width: '100%', boxSizing: 'border-box' }}>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '18px 10px', borderRadius: 10, border: `1.5px dashed ${dragOver ? 'var(--k-primary)' : 'var(--rule-strong)'}`, background: dragOver ? 'var(--k-primary-dim, rgba(0,130,198,0.06))' : 'transparent', color: 'var(--ink-3)', cursor: 'pointer', fontFamily: 'var(--font-ui)', transition: 'border-color 0.15s, background 0.15s' }}
                >
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 12V4M4 8l4-4 4 4"/><path d="M2 14h12"/></svg>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)' }}>Files & Images</span>
                  <span style={{ fontSize: 10, lineHeight: 1.5, textAlign: 'center', color: 'var(--ink-3)' }}>PDF, Word, Excel<br/>max 25 MB</span>
                </button>
                <button
                  type="button"
                  onClick={() => videoRef.current?.click()}
                  disabled={uploading}
                  style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '18px 10px', borderRadius: 10, border: `1.5px dashed ${dragOver ? 'var(--k-primary)' : '#c4b5fd'}`, background: dragOver ? 'var(--k-primary-dim, rgba(0,130,198,0.06))' : 'transparent', color: '#8b5cf6', cursor: 'pointer', fontFamily: 'var(--font-ui)', transition: 'border-color 0.15s, background 0.15s' }}
                >
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="#8b5cf6" strokeWidth="1.5"><polygon points="4,2 14,8 4,14" fill="none"/></svg>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Video</span>
                  <span style={{ fontSize: 10, lineHeight: 1.5, textAlign: 'center' }}>Any format<br/>max 50 MB</span>
                </button>
              </div>
            )}
          </div>
        </div>



        {/* Footer */}

        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--rule-soft)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>

          <span style={{ fontSize: 11, color: 'var(--ink-faint)', flex: 1 }}>↵ to create · Esc to close</span>

          <button className="k-btn k-btn--ghost k-btn--sm" onClick={onClose}>Cancel</button>

          <button className="k-btn k-btn--primary k-btn--sm" onClick={handleSubmit} disabled={saving}>

            {saving ? (isClient ? 'Submitting…' : 'Creating…') : (isClient ? 'Submit request' : 'Create task')}

          </button>

        </div>

      </div>

      {/* Preview lightbox */}
      {previewFile && <PreviewOverlay file={previewFile} onClose={() => setPreviewFile(null)} />}

    </div>

  );

}

function PreviewOverlay({ file, onClose }) {
  const n = file.name || '';
  const isImg = /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i.test(n);
  const isVid = /\.(mov|mp4|webm|avi|mkv|m4v|3gp|3gpp|flv|wmv|asf|ogv|ts|mts|m2ts)$/i.test(n);
  const isPdf = /\.pdf$/i.test(n);
  const isDoc = /\.(doc|docx|xls|xlsx|ppt|pptx)$/i.test(n);
  const isHttp = /^https?:\/\//i.test(file.url || '');
  const officeUrl = isDoc && isHttp ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(file.url)}` : null;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh', width: (isPdf || isDoc) ? '90vw' : undefined, height: (isPdf || isDoc) ? '90vh' : undefined }}>
        <button onClick={onClose} style={{ position: 'absolute', top: -14, right: -14, zIndex: 10, width: 32, height: 32, borderRadius: '50%', background: '#fff', border: 'none', cursor: 'pointer', fontSize: 18, fontWeight: 700, color: '#333', boxShadow: '0 2px 8px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>

        {isImg && <img src={file.url} alt={n} style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 8, display: 'block', objectFit: 'contain' }} />}

        {isVid && <video src={file.url} controls autoPlay style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 8, display: 'block' }} />}

        {isPdf && isHttp && (
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

        {((!isImg && !isVid && !isPdf && !isDoc) || ((isPdf || isDoc) && !isHttp)) && (
          <div style={{ background: 'var(--surface, #fff)', borderRadius: 12, padding: 32, textAlign: 'center' }}>
            <div style={{ fontSize: 14, marginBottom: 12 }}>{(isPdf || isDoc) && !isHttp ? 'Preview requires a public URL — this file was stored differently' : 'Preview not available for this file type'}</div>
            <a href={file.url} target="_blank" rel="noreferrer" style={{ color: 'var(--k-primary)', fontWeight: 600 }}>Open in new tab</a>
          </div>
        )}
      </div>
    </div>
  );
}

function FieldLabel({ children }) {

  return (

    <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6, fontFamily: 'var(--font-ui)' }}>

      {children}

    </div>

  );

}

