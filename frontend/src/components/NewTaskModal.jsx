/**

 * NewTaskModal.jsx — global "New task" modal. k-* design system.

 * Opened from the top-bar "+ New task" button (AppShell).

 */

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import FocusTrap from './ui/FocusTrap';
import { api } from '../lib/api';

import { PRIORITY_COLOR, logger } from '../lib/utils';
// `Avatar` rather than a hand-rolled circle: `AVATAR_COLORS` is the legacy list
// and still carries the retired `#0082c6`, `#8b5cf6` and `#f59e0b` (00 §9), and
// both call sites keyed it off the array INDEX — so a person's colour changed
// whenever someone above them was filtered out of the list (the `!name` skip
// below does exactly that). `Avatar` hashes the name, so the same person is the
// same colour here, on the board and in the drawer.
import { Avatar } from './ui/Avatar';

// `PRIORITY_COLOR` holds `var(--pr-*)` REFERENCES, not hexes. The old tint here
// was `${color}18` — a hex-alpha suffix, which on a var() reference evaluates to
// the string "var(--pr-high)18". That is not a colour, so CSS dropped the whole
// declaration and the selected priority pill rendered with no background at all.
import { mixAlpha } from '../lib/statusColors';

import { currentUser } from '../lib/auth';

import { navContext } from './layout/navConfig';

import ReminderPicker, { DEFAULT_REMINDERS } from './ReminderPicker';



const PRIORITY_DOTS = {

  low:    { color: PRIORITY_COLOR.low,    label: 'Low',    hi: 'लघु' },

  medium: { color: PRIORITY_COLOR.medium, label: 'Medium', hi: 'मध्यम' },

  high:   { color: PRIORITY_COLOR.high,   label: 'High',   hi: 'उच्च' },

  urgent: { color: PRIORITY_COLOR.urgent, label: 'Urgent', hi: 'अत्यावश्यक' },

};



export default function NewTaskModal({ open, onClose, onCreated, defaultProjectId = '', defaultDueAt = '', defaultColumnId = null }) {

  // The SAME predicate as the route guard. This modal is only ever mounted by
  // staff screens (`BoardsPage`, `TasksListPage`, the board views), all of
  // which a portal client is redirected away from; bare `role === 'client'`
  // also caught staff carrying the client flag beside an org role, and sent
  // their task straight to `/client/tasks/request` — an approval queue they do
  // not belong in. A portal client asks for work through
  // `pages/client/RequestWork.jsx`.
  const isClient = navContext(currentUser()).isClient;

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

    // A client must never see the firm's staff list. `GET /teams/{id}` returns
    // every member of the team — names, job titles, companies and who holds
    // approver rights — and the only consumer of it in this modal is the
    // assignee picker, which a client does not get (see the render). Not
    // fetching it at all is the fix: hiding the control while still pulling the
    // roster into React state leaves the whole list one devtools panel away.
    // The STATUS select was already gated on `isClient`; the assignee control
    // was not, so a client could also hand work to a named member of staff.
    // The server must gate this too — see the report.
    if (isClient) setMembers([]);
    else {
      api.get(`/teams/${projectId}`)
        .then(r => setMembers(Array.isArray(r.data?.members) ? r.data.members : []))
        .catch(() => setMembers([]));
    }

    api.get('/templates/tasks', { params: { team_id: projectId } })
      .then(r => setTemplates(Array.isArray(r.data) ? r.data : []))
      .catch(() => setTemplates([]));
  }, [projectId, isClient]);

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

      // `!isClient` as well as `assignees.length`: the control is not rendered
      // for a client, so this can only ever be non-empty through a stale state
      // read — and a request that names an assignee is one the server should
      // reject rather than one we should send.
      if (!isClient && assignees.length) payload.assignee_user_ids = assignees;

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

      {/* role/aria-modal/aria-labelledby: this is the product's primary create
          surface — AppShell's `n`, the mobile FAB, the command palette and
          three board pages all open it — and it was rendering as an anonymous
          <div>, so a screen reader kept announcing the page behind it and never
          said a dialog had opened.

          The FocusTrap below closes the gap this comment used to describe: Tab
          walked out of the panel into the board underneath, so a keyboard user
          was editing a row they could not see, inside a modal they had no way
          to tell they were still in. Wrapping the `.k-modal` div — not the
          scrim — is FocusTrap's own contract, and its display:contents wrapper
          means the panel does not move by a pixel.

          The preview lightbox stays OUTSIDE this trap deliberately. It portals
          to document.body, so it is not a DOM descendant of the panel; a trap
          around it here would rebuild its focusable list from a subtree the
          lightbox is not in and strand focus. It carries its own trap. */}
      <FocusTrap active>
      <div className="k-modal" role="dialog" aria-modal="true" aria-labelledby="ntm-title">



        {/* Header */}

        <div style={{ padding: '20px 24px 0', flexShrink: 0 }}>

          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>

            <div>

              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--primary)', marginBottom: 2 }}>

                {isClient ? 'REQUEST TASK' : 'NEW TASK'} · <span lang="hi" style={{ fontFamily: 'var(--font-indic)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{isClient ? 'अनुरोध' : 'नया कार्य'}</span>

              </div>

              <div id="ntm-title" style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 400, color: 'var(--on-surface)' }}>

                What needs doing?

              </div>

            </div>

            {/* The glyph is a multiplication sign, which a screen reader reads
                as "times". aria-label names the action instead. */}
            <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--on-surface-3)', lineHeight: 1, padding: 4, marginTop: -2 }}>×</button>

          </div>

          <div style={{ height: 1, background: 'color-mix(in srgb, var(--outline-variant) 60%, transparent)', margin: '16px 0 0' }} />

        </div>



        {/* Body */}

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>




          {/* Template picker */}
          {projectId && templates.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              {showTemplatePicker ? (
                <div style={{ background: 'var(--s-low)', borderRadius: 'var(--r-md)', border: '1px solid var(--outline-variant)', padding: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--on-surface-3)', marginBottom: 8 }}>
                    PICK A TEMPLATE ·{" "}
                    <span style={{ fontFamily: "var(--font-indic)", fontSize: 12, fontWeight: 400, letterSpacing: 0, textTransform: "none" }}>साँचा</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {templates.map(t => (
                      <button key={t.template_id} onClick={() => applyTemplate(t)}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
                          borderRadius: "var(--r-pill)", border: '1.5px solid var(--outline-variant)',
                          background: 'var(--surface)', cursor: 'pointer', fontSize: 13,
                          fontWeight: 500, color: 'var(--on-surface-2)' }}>
                        <span>{t.icon || '📋'}</span>
                        {t.name}
                        {t.is_default && (
                          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--primary)',
                            background: 'color-mix(in srgb, var(--primary) 12%, transparent)',
                            padding: '1px 5px', borderRadius: "var(--r-pill)" }}>DEFAULT</span>
                        )}
                      </button>
                    ))}
                    <button onClick={() => setShowTemplatePicker(false)}
                      style={{ padding: '6px 10px', borderRadius: "var(--r-pill)", border: '1px solid var(--outline-variant)',
                        background: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--on-surface-3)' }}>
                      ✕ Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setShowTemplatePicker(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600,
                    color: 'var(--primary)', background: 'color-mix(in srgb, var(--primary) 8%, transparent)',
                    border: '1px dashed var(--primary)', borderRadius: 'var(--r-md)',
                    padding: '5px 12px', cursor: 'pointer' }}>
                  📋 Use a template
                </button>
              )}
            </div>
          )}

          {/* Title */}

          <div style={{ marginBottom: 20 }}>

            {/* A placeholder is not a label: it disappears the moment the field
                has content, so it names the control only while the control is
                empty. The field carries no visible label at all here, so the
                name has to come from aria-label. */}
            <input

              ref={titleRef}

              aria-label="Task title"

              aria-invalid={titleError ? 'true' : undefined}

              aria-describedby={titleError ? 'ntm-title-err' : undefined}

              value={title}

              onChange={e => { setTitle(e.target.value); if (e.target.value.trim()) setTitleError(false); }}

              placeholder="Write a clear, action-first title…"

              style={{ width: '100%', border: 'none', borderBottom: `2px solid ${titleError ? 'var(--danger)' : 'var(--outline-variant)'}`, outline: 'none', fontSize: 20, fontFamily: 'var(--font-display)', color: 'var(--on-surface)', background: 'transparent', paddingBottom: 10, fontWeight: 400 }}

            />

            {/* role="alert" so the failure is spoken. Submit was rejecting the
                form with a red hairline and a line of 11px text that a screen
                reader had no reason to revisit — the user pressed Create and
                nothing appeared to happen. */}
            {titleError && <div id="ntm-title-err" role="alert" style={{ fontSize: 11, color: 'var(--danger)', marginTop: 5 }}>Title is required.</div>}

          </div>



          {/* PROJECT + STATUS */}

          <div style={{ display: 'grid', gridTemplateColumns: isClient ? '1fr' : '1fr 1fr', gap: 16, marginBottom: 16 }}>

            <div>

              <FieldLabel id="ntm-lbl-project" hi="परियोजना">PROJECT</FieldLabel>

              <select aria-labelledby="ntm-lbl-project" className="k-select" style={{ width: '100%' }} value={projectId} onChange={e => setProjectId(e.target.value)}>

                <option value="">Personal task</option>

                {projects.map(p => <option key={p.team_id} value={p.team_id}>{p.name}</option>)}

              </select>

            </div>

            {!isClient && (

            <div>

              <FieldLabel id="ntm-lbl-status" hi="स्थिति">STATUS</FieldLabel>

              <select aria-labelledby="ntm-lbl-status" className="k-select" style={{ width: '100%' }} value={status} onChange={e => setStatus(e.target.value)}>

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

            <FieldLabel id="ntm-lbl-priority" hi="प्राथमिकता">PRIORITY</FieldLabel>

            {/* Which priority is chosen was carried by border colour, fill and
                font weight and by nothing else — invisible to a screen reader
                and, per 00 §12's own note about 1-in-12 users, unreliable for
                colour-blind users too. aria-pressed states it. Toggle buttons
                do not take a roving tabindex; that belongs to radio groups,
                and these are already individually reachable. */}
            <div role="group" aria-labelledby="ntm-lbl-priority" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>

              {Object.entries(PRIORITY_DOTS).map(([key, { color, label }]) => (

                <button key={key} type="button" aria-pressed={priority === key} onClick={() => setPriority(key)}

                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 'var(--r-pill)', border: `1.5px solid ${priority === key ? color : 'var(--outline-variant)'}`, background: priority === key ? mixAlpha(color, 12) : 'transparent', color: priority === key ? color : 'var(--on-surface-3)', cursor: 'pointer', fontSize: 13, fontWeight: priority === key ? 700 : 400, transition: `background var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard)` }}>

                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }} />

                  {label}

                </button>

              ))}

            </div>

          </div>




          {/* Subtasks from template */}
          {subtasks.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--on-surface-3)', marginBottom: 6 }}>
                SUBTASKS ·{" "}
                <span style={{ fontFamily: "var(--font-indic)", fontSize: 12, fontWeight: 400, letterSpacing: 0, textTransform: "none" }}>उप-कार्य</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {subtasks.map((s, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                    background: 'var(--s-low)', borderRadius: 'var(--r-md)', border: '1px solid color-mix(in srgb, var(--outline-variant) 60%, transparent)' }}>
                    <input type="checkbox" aria-label={s.title} checked={s.is_done} onChange={e => setSubtasks(prev => prev.map((x, j) => j === i ? { ...x, is_done: e.target.checked } : x))} />
                    <span style={{ fontSize: 13, color: s.is_done ? 'var(--on-surface-3)' : 'var(--on-surface)', textDecoration: s.is_done ? 'line-through' : 'none', flex: 1 }}>
                      {s.title}
                    </span>
                    <button onClick={() => setSubtasks(prev => prev.filter((_, j) => j !== i))}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--on-surface-3)', fontSize: 14 }}>×</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* DUE + ASSIGNEES */}

          <div style={{ display: 'grid', gridTemplateColumns: isClient ? '1fr' : '1fr 1fr', gap: 16, marginBottom: 16 }}>

            <div>

              <FieldLabel id="ntm-lbl-due" hi="नियत तिथि">DUE</FieldLabel>

              <input
                aria-labelledby="ntm-lbl-due"
                type="date"
                className="inp"
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



            {/* Assignee dropdown — internal users only.
                A client requesting work names WHAT, never WHO: the roster this
                control is fed from is the firm's own staff list, and letting a
                client assign work would also let them route it around whoever
                owns the engagement. The STATUS select above carries the same
                guard and always did; this one did not. */}

            {!isClient && (
            <div ref={assigneeRef} style={{ position: 'relative' }}>

              <FieldLabel id="ntm-lbl-assignees" hi="नियुक्त">ASSIGNEES</FieldLabel>

              <button

                type="button"

                aria-labelledby="ntm-lbl-assignees"

                aria-expanded={assigneeOpen}

                aria-haspopup="listbox"

                onClick={() => setAssigneeOpen(v => !v)}

                style={{

                  width: '100%', display: 'flex', alignItems: 'center', gap: 8,

                  background: 'var(--s-low)', border: '1px solid var(--outline-variant)',

                  borderRadius: 'var(--r-md)', padding: '7px 10px', cursor: 'pointer',

                  fontFamily: 'var(--font-ui)', fontSize: 13,

                  color: selectedMembers.length ? 'var(--on-surface)' : 'var(--on-surface-3)',

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

                        <span key={m.user_id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--primary-container)', borderRadius: "var(--r-pill)", padding: '2px 8px 2px 4px', fontSize: 12, fontWeight: 500 }}>

                          <Avatar name={name} size={18} />

                          {name.split(' ')[0]}

                        </span>

                      );

                    })}

                    {selectedMembers.length > 3 && <span style={{ fontSize: 12, color: 'var(--on-surface-3)' }}>+{selectedMembers.length - 3}</span>}

                  </div>

                )}

                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ flexShrink: 0, color: 'var(--on-surface-3)' }}>

                  <path d="M2 4l4 4 4-4"/>

                </svg>

              </button>



              {assigneeOpen && (

                <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 100, background: 'var(--surface)', border: '1px solid var(--outline-variant)', borderRadius: 'var(--r-md)', boxShadow: "var(--shadow-3)", maxHeight: 220, overflowY: 'auto' }}>

                  {members.length === 0 ? (

                    <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--on-surface-3)', fontStyle: 'italic' }}>

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

                          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: checked ? 'var(--primary-container)' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', borderBottom: i < members.length - 1 ? '1px solid color-mix(in srgb, var(--outline-variant) 60%, transparent)' : 'none' }}

                        >

                          <Avatar name={name} size={30} />

                          <div style={{ flex: 1, minWidth: 0 }}>

                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--on-surface)', fontFamily: 'var(--font-ui)' }}>{name}</div>

                            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '2px 6px', marginTop: 2 }}>

                              {jobTitle && <span style={{ fontSize: 11, color: 'var(--on-surface-3)' }}>{jobTitle}</span>}

                              {jobTitle && m.company_name && <span style={{ fontSize: 11, color: 'var(--on-surface-3)' }}>·</span>}

                              {m.company_name && <span style={{ fontSize: 11, color: 'var(--on-surface-3)' }}>{m.company_name}</span>}

                              {m.receives_approval_emails && (

                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 700, color: "var(--primary-text)", background: mixAlpha("var(--primary)", 12), borderRadius: "var(--r-xs)", padding: '1px 5px', marginTop: 1 }}>

                                  <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="var(--primary-text)" strokeWidth="2"><path d="M1.5 5l3 3 4-4"/></svg>

                                  {m.role === 'client' ? 'Client Approver' : 'Internal Approver'}

                                </span>

                              )}

                            </div>

                          </div>

                          {checked && (

                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--primary)" strokeWidth="2" style={{ flexShrink: 0 }}>

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
            )}

          </div>



          {/* DESCRIPTION */}

          <div style={{ marginBottom: 16 }}>

            <FieldLabel id="ntm-lbl-desc" hi="विवरण">DESCRIPTION</FieldLabel>

            <textarea

              aria-labelledby="ntm-lbl-desc"

              className="inp"

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
            <FieldLabel id="ntm-lbl-attachments" hi="संलग्नक">ATTACHMENTS</FieldLabel>
            <input ref={fileRef} aria-labelledby="ntm-lbl-attachments" type="file" multiple accept=".jpg,.jpeg,.png,.gif,.heic,.heif,.pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt" style={{ display: 'none' }} onChange={handleFileChange} />
            <input ref={videoRef} type="file" multiple accept="video/*,.mov,.mp4,.webm,.avi,.mkv,.m4v,.3gp,.flv,.wmv,.ogv,.ts" style={{ display: 'none' }} onChange={handleFileChange} />

            {/* Drop overlay */}
            {dragOver && files.length < 10 && (
              <div style={{
                position: 'absolute', inset: 0, zIndex: 50,
                background: 'color-mix(in srgb, var(--primary) 8%, transparent)',
                border: '2px dashed var(--primary)',
                borderRadius: "var(--r-md)",
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                pointerEvents: 'none',
              }}>
                <div style={{ textAlign: 'center' }}>
                  <svg width="24" height="24" viewBox="0 0 16 16" fill="none" stroke="var(--primary)" strokeWidth="1.5" style={{ marginBottom: 4 }}><path d="M8 12V4M4 8l4-4 4 4"/><path d="M2 14h12"/></svg>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--primary)' }}>Drop files here</div>
                </div>
              </div>
            )}

            {uploading && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--on-surface-3)', fontSize: 13, marginBottom: 6 }}>
                  <div className="k-spinner" style={{ width: 14, height: 14, flexShrink: 0 }} />
                  <span>Uploading{uploadProgress > 0 ? ` ${uploadProgress}%` : '…'}</span>
                </div>
                <div style={{ height: 4, background: 'var(--outline-variant)', borderRadius: "var(--r-xs)", overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${uploadProgress || 0}%`, background: 'var(--primary)', borderRadius: "var(--r-xs)", transition: 'width 0.25s ease', minWidth: uploadProgress > 0 ? undefined : '15%' }} />
                </div>
              </div>
            )}
            {uploadError && (
              <div style={{ fontSize: 12, color: 'var(--danger)', background: "var(--danger-container)", border: '1px solid color-mix(in srgb, var(--danger) 40%, transparent)', borderRadius: "var(--r-sm)", padding: '8px 12px', marginBottom: 8 }}>
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
                    <div key={i} style={{ borderRadius: "var(--r-sm)", background: "var(--s-lowest)", border: '1px solid var(--outline-variant)', fontSize: 13, overflow: 'hidden' }}>
                      {/* Image thumbnail */}
                      {isImg && f.url && (
                        <div onClick={() => setPreviewFile(f)} style={{ cursor: 'pointer', background: 'color-mix(in srgb, var(--outline-variant) 60%, transparent)', borderBottom: '1px solid var(--outline-variant)' }}>
                          <img src={f.url} alt={n} style={{ display: 'block', width: '100%', maxHeight: 140, objectFit: 'cover' }} loading="lazy" />
                        </div>
                      )}
                      {/* Video thumbnail */}
                      {isVid && f.url && (
                        <div onClick={() => setPreviewFile(f)} style={{ cursor: 'pointer', background: "var(--ink-fixed)", borderBottom: '1px solid var(--outline-variant)', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 80 }}>
                          <video src={f.url} preload="metadata" muted style={{ display: 'block', width: '100%', maxHeight: 140, objectFit: 'cover' }} />
                          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: "color-mix(in srgb, var(--ink-fixed) 34%, transparent)" }}>
                            <div style={{ width: 32, height: 32, borderRadius: '50%', background: "var(--s-lowest)", display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--tertiary)" strokeWidth="1.8"><polygon points="5,3 13,8 5,13"/></svg>
                            </div>
                          </div>
                        </div>
                      )}
                      {/* Doc preview banner */}
                      {(isPdf || isDoc) && f.url && (
                        <div onClick={() => setPreviewFile(f)} style={{ cursor: 'pointer', padding: '12px 16px', background: 'var(--s-low)', borderBottom: '1px solid var(--outline-variant)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="var(--primary)" strokeWidth="1.5"><path d="M9 1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5L9 1z"/><path d="M9 1v4h4"/></svg>
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--primary)' }}>Click to preview</span>
                        </div>
                      )}
                      {/* File info row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px' }}>
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="var(--primary)" strokeWidth="1.5"><path d="M9 1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5L9 1z"/><path d="M9 1v4h4"/></svg>
                        <a href={f.url} target="_blank" rel="noreferrer" style={{ flex: 1, color: 'var(--on-surface-2)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n}</a>
                        {canPreview && (
                          <button onClick={() => setPreviewFile(f)} title="Preview" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--on-surface-3)', padding: 0, display: 'flex', flexShrink: 0 }}>
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="3"/><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/></svg>
                          </button>
                        )}
                        <button onClick={() => setFiles(p => p.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--on-surface-3)', fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
                      </div>
                    </div>
                  );
                })}
                {files.length < 10 && !uploading && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" onClick={() => fileRef.current?.click()} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: "var(--r-sm)", border: '1.5px dashed var(--outline)', background: 'transparent', color: 'var(--on-surface-3)', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-ui)' }}>
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M8 3v10M3 8h10"/></svg>
                      Add files
                    </button>
                    <button type="button" onClick={() => videoRef.current?.click()} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: "var(--r-sm)", border: '1.5px dashed var(--outline)', background: 'transparent', color: "var(--tertiary)", cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-ui)' }}>
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="var(--tertiary)" strokeWidth="1.8"><polygon points="5,3 13,8 5,13"/></svg>
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
                  style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '18px 10px', borderRadius: "var(--r-md)", border: `1.5px dashed ${dragOver ? 'var(--primary)' : 'var(--outline)'}`, background: dragOver ? 'color-mix(in srgb, var(--primary) 6%, transparent)' : 'transparent', color: 'var(--on-surface-3)', cursor: 'pointer', fontFamily: 'var(--font-ui)', transition: 'border-color 0.15s, background 0.15s' }}
                >
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 12V4M4 8l4-4 4 4"/><path d="M2 14h12"/></svg>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--on-surface-2)' }}>Files & Images</span>
                  <span style={{ fontSize: 10, lineHeight: 1.5, textAlign: 'center', color: 'var(--on-surface-3)' }}>PDF, Word, Excel<br/>max 10 MB</span>
                </button>
                <button
                  type="button"
                  onClick={() => videoRef.current?.click()}
                  disabled={uploading}
                  style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '18px 10px', borderRadius: "var(--r-md)", border: `1.5px dashed ${dragOver ? 'var(--primary)' : "color-mix(in srgb, var(--tertiary) 45%, transparent)"}`, background: dragOver ? 'color-mix(in srgb, var(--primary) 6%, transparent)' : 'transparent', color: "var(--tertiary)", cursor: 'pointer', fontFamily: 'var(--font-ui)', transition: 'border-color 0.15s, background 0.15s' }}
                >
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="var(--tertiary)" strokeWidth="1.5"><polygon points="4,2 14,8 4,14" fill="none"/></svg>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Video</span>
                  <span style={{ fontSize: 10, lineHeight: 1.5, textAlign: 'center' }}>Any format<br/>max 25 MB</span>
                </button>
              </div>
            )}
          </div>
        </div>



        {/* Footer */}

        <div style={{ padding: '14px 24px', borderTop: '1px solid color-mix(in srgb, var(--outline-variant) 60%, transparent)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>

          <span style={{ fontSize: 11, color: 'var(--on-surface-3)', flex: 1 }}>↵ to create · Esc to close</span>

          <button className="k-btn k-btn--ghost k-btn--sm" onClick={onClose}>Cancel</button>

          <button className="k-btn k-btn--primary k-btn--sm" onClick={handleSubmit} disabled={saving}>

            {saving ? (isClient ? 'Submitting…' : 'Creating…') : (isClient ? 'Submit request' : 'Create task')}

          </button>

        </div>

      </div>
      </FocusTrap>

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
  const isImg = /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i.test(n);
  const isVid = /\.(mov|mp4|webm|avi|mkv|m4v|3gp|3gpp|flv|wmv|asf|ogv|ts|mts|m2ts)$/i.test(n);
  const isPdf = /\.pdf$/i.test(n);
  const isDoc = /\.(doc|docx|xls|xlsx|ppt|pptx)$/i.test(n);
  const isHttp = /^https?:\/\//i.test(file.url || '');
  const officeUrl = isDoc && isHttp ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(file.url)}` : null;
  const canPreviewDoc = isPdf || (isDoc && isHttp);

  return (
    // z-index 620 is the mobile-sheet/lightbox rung of the 26 §4 ladder — 200
    // drawer · 340 picker · 420 modal · 520 toast · 620 sheet. The old 9999 sat
    // above the toast layer, so an upload error raised behind the lightbox was
    // invisible until it was dismissed.
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 620, background: 'color-mix(in srgb, var(--ink-fixed) 88%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh', width: canPreviewDoc ? '90vw' : undefined, height: canPreviewDoc ? '90vh' : undefined }}>
        <button onClick={onClose} aria-label="Close preview" style={{ position: 'absolute', top: -14, right: -14, zIndex: 10, width: 32, height: 32, borderRadius: '50%', background: 'var(--s-lowest)', border: 'none', cursor: 'pointer', fontSize: 18, fontWeight: 700, color: 'var(--on-surface)', boxShadow: 'var(--shadow-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>

        {isImg && !imgError && <img src={file.url} alt={n} onError={() => setImgError(true)} style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 'var(--r-md)', display: 'block', objectFit: 'contain' }} />}

        {isVid && <video src={file.url} controls autoPlay style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 'var(--r-md)', display: 'block' }} />}

        {isPdf && (
          <object data={file.url} type="application/pdf" style={{ width: '100%', height: '100%', borderRadius: 'var(--r-md)', border: 'none' }}>
            <iframe src={file.url} style={{ width: '100%', height: '100%', border: 'none', borderRadius: 'var(--r-md)' }} title={n} />
          </object>
        )}

        {isDoc && officeUrl && (
          <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <iframe src={officeUrl} style={{ flex: 1, width: '100%', border: 'none', borderRadius: 'var(--r-md)' }} title={n} />
            <div style={{ textAlign: 'center', marginTop: 10 }}>
              {/* On the lightbox scrim, which is --ink-fixed in BOTH themes, so
                  the label is --ink-fixed-dark rather than --on-surface. */}
              <a href={file.url} target="_blank" rel="noreferrer" style={{ color: 'var(--ink-fixed-dark)', fontSize: 13, textDecoration: 'underline' }}>Open in new tab</a>
            </div>
          </div>
        )}

        {((isImg && imgError) || (!isImg && !isVid && !canPreviewDoc)) && (
          <div style={{ background: 'var(--surface)', borderRadius: 'var(--r-lg)', padding: 32, textAlign: 'center' }}>
            <div style={{ fontSize: 14, color: 'var(--on-surface)', marginBottom: 16 }}>{imgError ? 'Image could not be loaded' : 'Preview not available for this file type'}</div>
            <a href={file.url} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--on-primary)', fontSize: 13, fontWeight: 600, background: 'var(--primary)', borderRadius: 'var(--r-sm)', padding: '10px 20px', textDecoration: 'none' }}>Open in new tab</a>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The English label with its Devanagari apposition — the same pair the drawer
 * draws through `.dr__lbl` / `.dr__lbl-hi`, so the two surfaces read alike.
 *
 * The Devanagari was previously part of the label STRING ("PROJECT · परियोजना")
 * inside a `--font-ui` block that was also uppercased and tracked at .12em.
 * Devanagari has no case, so `text-transform: uppercase` is a no-op on it, but
 * the Latin letterforms of the fallback font are what actually rendered: the
 * sub-label never reached `--font-indic` at all. Splitting it into its own span
 * is what puts it in the Indic face and drops the tracking, which on Devanagari
 * breaks the conjuncts apart.
 */
/**
 * `id` is not cosmetic. This renders a <div>, not a <label>, so nothing here
 * associates it with the control it sits above — every select, date field and
 * textarea in this modal was reaching the accessibility tree unnamed. The
 * controls now point at it with `aria-labelledby={id}`, which keeps the
 * accessible name identical to the visible one (WCAG 2.5.3) instead of
 * inventing a second string in an aria-label.
 *
 * A <label htmlFor> would be better still and is the fix to make when this file
 * is next open for layout: <label> is display:inline, so the swap needs a
 * `display:block` beside it and that is a style change, not an ARIA one.
 *
 * The separator moved inside the aria-hidden span deliberately — left outside,
 * the accessible name ended on a stray "·".
 */
function FieldLabel({ children, hi, id }) {

  return (

    <div id={id} style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--on-surface-3)', marginBottom: 6, fontFamily: 'var(--font-ui)' }}>

      {children}

      {hi && (
        <span aria-hidden="true" style={{ fontFamily: 'var(--font-indic)', fontSize: 12, fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{' · '}{hi}</span>
      )}

    </div>

  );

}

