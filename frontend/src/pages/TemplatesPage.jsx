/**
 * TemplatesPage.jsx — editorial Templates screen.
 * Layout: tabs (Project / Task) → template card grid → Save as template form
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../lib/api';
import { useToast } from '../components/ui/toast';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/editorial';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import BrandKit from '../components/BrandKit';
import { AVATAR_COLORS } from '../lib/utils';

const ICONS = ['📋','✅','🎨','📹','📸','📊','💡','🔖','⚡','🚀','📝','🎯','🔧','📦','🌐'];
const EMPTY_TASK_TMPL = {
  name: '', icon: '📋', is_default: false, team_id: '',
  config: { title: '', description: '', priority: 'medium', subtasks: [], attachments: [], tags: [], custom_fields: {} }
};
const KICKER_SANS   = ['राज्यस्व', 'स्वागत', 'विपणन', 'कार्यालय', 'विधि', 'सेवा', 'परियोजना'];

function getKicker(t, idx) {
  // Use description first word, or template name's first word uppercased
  const word = (t.description || t.name || '').split(/\s+/)[0];
  return word.slice(0, 10).toUpperCase();
}

export default function TemplatesPage() {
  const { pushToast } = useToast();
  const navigate = useNavigate();

  const [projTemplates, setProjTemplates] = useState([]);
  const [taskTemplates, setTaskTemplates] = useState([]);
  const [projects,      setProjects]      = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [tab,           setTab]           = useState('project');

  const [saveFrom,  setSaveFrom]  = useState('');
  const [ptName,    setPtName]    = useState('');
  const [ptDesc,    setPtDesc]    = useState('');
  const [saving,    setSaving]    = useState(false);

  const [applyModal,     setApplyModal]     = useState(null); // { tmplId, tmplName }
  const [applyToProject, setApplyToProject] = useState('');
  const [applying,       setApplying]       = useState(false);
  const [confirmState,   setConfirmState]   = useState(null);

  const [showSaveForm,     setShowSaveForm]     = useState(false);
  const [taskTmplForm,     setTaskTmplForm]     = useState(EMPTY_TASK_TMPL);
  const [showTaskForm,     setShowTaskForm]     = useState(false);
  const [editingTmplId,    setEditingTmplId]    = useState(null);
  const [savingTask,       setSavingTask]       = useState(false);
  const [newSubtask,       setNewSubtask]       = useState('');
  const [showIconPicker,   setShowIconPicker]   = useState(false);
  const [tmplUploading,    setTmplUploading]    = useState(false);
  const tmplFileRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pt, tt, pr] = await Promise.all([
        api.get('/templates/projects'),
        api.get('/templates/tasks'),
        api.get('/teams'),
      ]);
      setProjTemplates(Array.isArray(pt.data) ? pt.data : []);
      setTaskTemplates(Array.isArray(tt.data) ? tt.data : []);
      setProjects(Array.isArray(pr.data) ? pr.data : []);
    } catch (_) { pushToast({ type: 'error', title: 'Could not load templates' }); }
    finally { setLoading(false); }
  }, [pushToast]);

  useEffect(() => { load(); }, [load]);

  const saveProjectAsTemplate = async () => {
    if (!ptName.trim() || !saveFrom) { pushToast({ type: 'error', title: 'Choose a project and enter a name' }); return; }
    setSaving(true);
    try {
      const [colR, fieldR] = await Promise.all([
        api.get(`/projects/${saveFrom}/columns`),
        api.get(`/fields/team/${saveFrom}`).catch(() => ({ data: [] })),
      ]);
      const config = {
        columns: colR.data.map(c => ({ name: c.name, color: c.color, is_done: c.is_done })),
        fields:  fieldR.data.map(f => ({ name: f.name, type: f.type, config: f.config })),
        sample_tasks: [],
      };
      await api.post('/templates/projects', { name: ptName.trim(), description: ptDesc.trim() || null, config });
      pushToast({ type: 'success', title: `Template "${ptName}" saved` });
      setPtName(''); setPtDesc(''); setSaveFrom(''); setShowSaveForm(false); load();
    } catch (_) { pushToast({ type: 'error', title: 'Could not save template' }); }
    finally { setSaving(false); }
  };

  const applyProjectTemplate = async (tmplId, projectId) => {
    const pid = projectId || applyToProject;
    if (!pid) { pushToast({ type: 'error', title: 'Choose a target project' }); return; }
    setApplying(true);
    try {
      const res = await api.post(`/templates/projects/${tmplId}/apply?team_id=${pid}`);
      pushToast({ type: 'success', title: `Applied — ${res.data.created.columns} columns created` });
      setApplyModal(null); setApplyToProject('');
      navigate(`/projects/${pid}`);
    } catch (_) { pushToast({ type: 'error', title: 'Could not apply template' }); }
    finally { setApplying(false); }
  };

  const deleteProjTmpl = (id, name) => {
    setConfirmState({
      message: `Delete template "${name}"?`,
      confirmLabel: 'Delete',
      onConfirm: async () => {
        try { await api.delete(`/templates/projects/${id}`); load(); pushToast({ type: 'success', title: 'Template deleted' }); }
        catch (_) { pushToast({ type: 'error', title: 'Could not delete' }); }
      },
    });
  };

  const currentTemplates = tab === 'project' ? projTemplates : taskTemplates;

  return (
    <div className="k-screen">
      <PageHeader
        kicker="OPERATIONS"
        title="Templates"
        sanskrit="साँचा"
        lede="Bootstrap a new project or task from something that worked before."
      />

      {/* Tabs */}
      <div className="k-tmpl-tabs">
        <button
          className={'k-tmpl-tab' + (tab === 'project' ? ' is-active' : '')}
          onClick={() => setTab('project')}
        >
          Project templates
          <span className="k-tmpl-tab__sans">परियोजना</span>
          <span className="k-tmpl-tab__count">{projTemplates.length}</span>
        </button>
        <button
          className={'k-tmpl-tab' + (tab === 'task' ? ' is-active' : '')}
          onClick={() => setTab('task')}
        >
          Task templates
          <span className="k-tmpl-tab__sans">कार्य</span>
          <span className="k-tmpl-tab__count">{taskTemplates.length}</span>
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--ink-3)', fontFamily: 'var(--font-display)', fontStyle: 'italic' }}>
          Loading templates…
        </div>
      ) : (
        <>
          {/* Template cards grid */}
          <div className="k-tmpl-grid">
            {currentTemplates.map((t, idx) => {
              const cfg     = typeof t.config === 'string' ? JSON.parse(t.config) : (t.config || {});
              const color   = cfg.color || AVATAR_COLORS[idx % AVATAR_COLORS.length];
              const sans    = KICKER_SANS[idx % KICKER_SANS.length];
              const kicker  = getKicker(t, idx);
              const cols    = (cfg.columns || []).length;
              const fields  = (cfg.fields  || []).length;
              const used    = t.use_count || 0;
              return (
                <div key={t.template_id} className="k-tmpl-card">
                  <div className="k-tmpl-card__head">
                    <div className="k-tmpl-card__body">
                      <div className="k-tmpl-card__kicker" style={{ color }}>{kicker}</div>
                      <div className="k-tmpl-card__name">{t.name}</div>
                      {t.description && <div className="k-tmpl-card__desc">{t.description}</div>}
                    </div>
                    <div className="k-tmpl-card__sans" style={{ color }}>{sans}</div>
                  </div>

                  {tab === 'project' && (
                    <div className="k-tmpl-card__stats">
                      <div className="k-tmpl-card__stat"><b>{cols}</b><span>COLUMNS</span></div>
                      <div className="k-tmpl-card__stat"><b>{fields}</b><span>FIELDS</span></div>
                      <div className="k-tmpl-card__stat"><b>{used}</b><span>USED</span></div>
                    </div>
                  )}

                  <div className="k-tmpl-card__foot">
                    {tab === 'project' ? (
                      <div className="k-tmpl-card__foot-row">
                        <button
                          className="k-btn k-btn--primary k-btn--sm"
                          onClick={() => {
                            if (projects.length === 1) {
                              applyProjectTemplate(t.template_id, projects[0].team_id);
                            } else {
                              setApplyToProject('');
                              setApplyModal({ tmplId: t.template_id, tmplName: t.name });
                            }
                          }}
                          disabled={applying}
                        >
                          Use template
                        </button>
                        <button
                          className="k-btn k-btn--ghost k-btn--sm"
                          onClick={() => pushToast({ type: 'info', title: `"${t.name}" — ${cols} columns, ${fields} fields` })}
                        >
                          Preview
                        </button>
                        <button
                          className="k-iconbtn"
                          style={{ marginLeft: 'auto', color: 'var(--ink-faint)' }}
                          title="Delete template"
                          aria-label="Delete template"
                          onClick={() => deleteProjTmpl(t.template_id, t.name)}
                        >
                          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                            <path d="M3 4h10M5 4V3h6v1M6 7v5M10 7v5M4 4l1 9h6l1-9"/>
                          </svg>
                        </button>
                      </div>
                    ) : (
                      <>
                        {/* Meta row */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{cfg?.priority || 'medium'} priority</span>
                          {(cfg?.subtasks || []).length > 0 && (
                            <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>· {cfg.subtasks.length} subtasks</span>
                          )}
                          {t.is_default && (
                            <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--k-primary)', background: 'color-mix(in srgb, var(--k-primary) 12%, transparent)', padding: '1px 5px', borderRadius: 99 }}>DEFAULT</span>
                          )}
                        </div>
                        {/* Action row */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <button className="k-btn k-btn--ghost k-btn--sm"
                            onClick={() => {
                              setEditingTmplId(t.template_id);
                              setTaskTmplForm({
                                name: t.name, icon: t.icon || '📋',
                                is_default: t.is_default || false,
                                team_id: t.team_id || '',
                                config: typeof t.config === 'string' ? JSON.parse(t.config) : (t.config || {}),
                              });
                              setShowTaskForm(true);
                            }}>
                            Edit
                          </button>
                          {!t.is_default && (
                            <button className="k-btn k-btn--ghost k-btn--sm"
                              onClick={async () => {
                                try {
                                  await api.post(`/templates/tasks/${t.template_id}/set-default`);
                                  load(); pushToast({ type: 'success', title: 'Set as default' });
                                } catch { pushToast({ type: 'error', title: 'Could not set default' }); }
                              }}>
                              Set default
                            </button>
                          )}
                          <button className="k-iconbtn" style={{ marginLeft: 'auto', color: 'var(--ink-faint)' }}
                            title="Delete"
                            onClick={() => setConfirmState({
                              message: `Delete template "${t.name}"?`, confirmLabel: 'Delete',
                              onConfirm: async () => {
                                try {
                                  await api.delete(`/templates/tasks/${t.template_id}`);
                                  load();
                                } catch { pushToast({ type: 'error', title: 'Could not delete template' }); }
                              },
                            })}>
                            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 4h10M5 4V3h6v1M6 7v5M10 7v5M4 4l1 9h6l1-9"/></svg>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Save as template card (project tab) */}
            {tab === 'project' && (
              <button className="k-tmpl-card k-tmpl-card--new" onClick={() => setShowSaveForm(v => !v)}>
                <div className="k-tmpl-card__plus">+</div>
                <div className="k-tmpl-card__new-title">Save current project as template</div>
                <div className="k-tmpl-card__new-sub">Captures columns and custom fields. Tasks are not copied.</div>
              </button>
            )}
          </div>

          {/* Save as template form */}
          {tab === 'project' && showSaveForm && (
            <section className="k-card">
              <div className="k-card__head">
                <div className="k-card__titles">
                  <h3 className="k-card__title">Save as template</h3>
                  <span className="k-card__sans">संरक्षित</span>
                </div>
              </div>
              <div className="k-card__body">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                  <div>
                    <label className="k-label">Source project</label>
                    <select className="k-input" style={{ width: '100%', cursor: 'pointer' }} value={saveFrom} onChange={e => setSaveFrom(e.target.value)}>
                      <option value=''>Choose project…</option>
                      {projects.map(p => <option key={p.team_id} value={p.team_id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="k-label">Template name</label>
                    <input className="k-input" value={ptName} onChange={e => setPtName(e.target.value)} placeholder="e.g. Quarterly client review" />
                  </div>
                </div>
                <div style={{ marginBottom: 20 }}>
                  <label className="k-label">Description (optional)</label>
                  <input className="k-input" style={{ width: '100%' }} value={ptDesc} onChange={e => setPtDesc(e.target.value)} placeholder="What is this template for?" />
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="k-btn k-btn--primary" disabled={saving || !saveFrom || !ptName.trim()} onClick={saveProjectAsTemplate}>
                    {saving ? 'Saving…' : 'Save template'}
                  </button>
                  <button className="k-btn k-btn--ghost" onClick={() => setShowSaveForm(false)}>Cancel</button>
                </div>
              </div>
            </section>
          )}

          {/* New task template card */}
          {tab === 'task' && !showTaskForm && (
            <button className="k-tmpl-card k-tmpl-card--new" onClick={() => { setEditingTmplId(null); setTaskTmplForm(EMPTY_TASK_TMPL); setShowTaskForm(true); }}>
              <div className="k-tmpl-card__plus">+</div>
              <div className="k-tmpl-card__new-title">New task template</div>
              <div className="k-tmpl-card__new-sub">Pre-fill title, description, subtasks, priority, and attachments.</div>
            </button>
          )}

          {/* Task template form */}
          {tab === 'task' && showTaskForm && (() => {
            const cfg = taskTmplForm.config || {};
            const setcfg = (key, val) => setTaskTmplForm(f => ({ ...f, config: { ...f.config, [key]: val } }));

            const saveTaskTemplate = async () => {
              if (!taskTmplForm.name.trim()) { pushToast({ type: 'error', title: 'Template name required' }); return; }
              setSavingTask(true);
              try {
                if (editingTmplId) {
                  await api.patch(`/templates/tasks/${editingTmplId}`, taskTmplForm);
                } else {
                  await api.post('/templates/tasks', taskTmplForm);
                }
                pushToast({ type: 'success', title: editingTmplId ? 'Template updated' : 'Template created' });
                setShowTaskForm(false); setEditingTmplId(null); load();
              } catch (_) { pushToast({ type: 'error', title: 'Could not save template' }); }
              finally { setSavingTask(false); }
            };

            return (
              <section className="k-card">
                <div className="k-card__head">
                  <div className="k-card__titles">
                    <h3 className="k-card__title">{editingTmplId ? 'Edit template' : 'New task template'}</h3>
                    <span className="k-card__sans">साँचा</span>
                  </div>
                </div>
                <div className="k-card__body" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

                  {/* Name + Icon */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 1fr', gap: 12, alignItems: 'end' }}>
                    <div>
                      <label className="k-label">Icon</label>
                      <div style={{ position: 'relative' }}>
                        <button onClick={() => setShowIconPicker(v => !v)}
                          style={{ width: 42, height: 42, fontSize: 22, borderRadius: 'var(--r-md)', border: '1px solid var(--rule)', background: 'var(--bg-soft)', cursor: 'pointer' }}>
                          {taskTmplForm.icon}
                        </button>
                        {showIconPicker && (
                          <div style={{ position: 'absolute', top: 48, left: 0, zIndex: 50, background: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: 'var(--r-md)', padding: 10, display: 'flex', flexWrap: 'wrap', gap: 6, width: 220 }}>
                            {ICONS.map(ic => (
                              <button key={ic} onClick={() => { setTaskTmplForm(f => ({ ...f, icon: ic })); setShowIconPicker(false); }}
                                style={{ fontSize: 20, background: 'none', border: 'none', cursor: 'pointer', borderRadius: 6, padding: '2px 4px' }}>
                                {ic}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="k-label">Template name *</label>
                      <input className="k-input" value={taskTmplForm.name}
                        onChange={e => setTaskTmplForm(f => ({ ...f, name: e.target.value }))}
                        placeholder="e.g. Instagram Post, Brand Video…" autoFocus />
                    </div>
                    <div>
                      <label className="k-label">Project (scope)</label>
                      <select className="k-input" style={{ width: '100%' }} value={taskTmplForm.team_id}
                        onChange={e => setTaskTmplForm(f => ({ ...f, team_id: e.target.value }))}>
                        <option value="">All projects (global)</option>
                        {projects.map(p => <option key={p.team_id} value={p.team_id}>{p.name}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Pre-filled title */}
                  <div>
                    <label className="k-label">Pre-filled title</label>
                    <input className="k-input" value={cfg.title || ''}
                      onChange={e => setcfg('title', e.target.value)}
                      placeholder="e.g. Instagram Post — {client name}" />
                    <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 4 }}>Use {'{'}placeholders{'}'} — team members fill them in when creating the task.</div>
                  </div>

                  {/* Description */}
                  <div>
                    <label className="k-label">Description / Brand guidelines</label>
                    <textarea className="k-input" rows={4} value={cfg.description || ''}
                      onChange={e => setcfg('description', e.target.value)}
                      style={{ width: '100%', resize: 'vertical', minHeight: 100 }}
                      placeholder="Include brand guidelines, tone of voice, size specs, platform rules…" />
                  </div>

                  {/* Priority + Default */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <div>
                      <label className="k-label">Default priority</label>
                      <select className="k-input" style={{ width: '100%' }} value={cfg.priority || 'medium'}
                        onChange={e => setcfg('priority', e.target.value)}>
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="urgent">Urgent</option>
                      </select>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 2 }}>
                      <label onClick={() => setTaskTmplForm(f => ({ ...f, is_default: !f.is_default }))} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none', fontSize: 13, color: 'var(--ink-2)' }}>
                        <div
                          style={{ width: 38, height: 20, borderRadius: 10, background: taskTmplForm.is_default ? 'var(--k-primary)' : 'var(--rule-soft)', position: 'relative', transition: 'background .2s', flexShrink: 0, cursor: 'pointer' }}>
                          <div style={{ position: 'absolute', top: 2, left: taskTmplForm.is_default ? 20 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
                        </div>
                        Set as default for this project
                      </label>
                    </div>
                  </div>

                  {/* Brand colors reference — managed org-wide in Admin → Brand Colors */}
                  <div>
                    <label className="k-label">Brand colors · ब्रांड रंग</label>
                    <div style={{ fontSize: 12, color: 'var(--ink-faint)', marginBottom: 10 }}>
                      Workspace palette — manage in <strong>Admin → Brand Colors</strong>.
                    </div>
                    <BrandKit mode="display" />
                  </div>

                  {/* Subtasks */}
                  <div>
                    <label className="k-label">Subtasks · उप-कार्य</label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                      {(cfg.subtasks || []).map((s, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--bg-soft)', borderRadius: 'var(--r-md)', border: '1px solid var(--rule-soft)' }}>
                          <span style={{ fontSize: 13, flex: 1, color: 'var(--ink)' }}>{s.title}</span>
                          <button onClick={() => setcfg('subtasks', cfg.subtasks.filter((_, j) => j !== i))}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', fontSize: 16 }}>×</button>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input className="k-input" value={newSubtask} onChange={e => setNewSubtask(e.target.value)}
                        placeholder="Add subtask…"
                        onKeyDown={e => {
                          if (e.key === 'Enter' && newSubtask.trim()) {
                            setcfg('subtasks', [...(cfg.subtasks || []), { title: newSubtask.trim(), is_done: false }]);
                            setNewSubtask('');
                          }
                        }} />
                      <button className="k-btn k-btn--ghost k-btn--sm"
                        onClick={() => {
                          if (!newSubtask.trim()) return;
                          setcfg('subtasks', [...(cfg.subtasks || []), { title: newSubtask.trim(), is_done: false }]);
                          setNewSubtask('');
                        }}>
                        + Add
                      </button>
                    </div>
                  </div>

                  {/* Attached files + URLs */}
                  <div>
                    <label className="k-label">Pre-attached files & links · संलग्न</label>
                    <div style={{ fontSize: 12, color: 'var(--ink-faint)', marginBottom: 10 }}>
                      Upload files or paste URLs (Google Drive, Figma, brand kit) — all auto-attach when this template is used.
                    </div>
                    {(cfg.attachments || []).length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                        {(cfg.attachments || []).map((a, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: 'var(--bg-soft)', borderRadius: 'var(--r-md)', border: '1px solid var(--rule-soft)' }}>
                            {a.key ? (
                              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="var(--k-primary)" strokeWidth="1.5"><path d="M9 1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5L9 1z"/><path d="M9 1v4h4"/></svg>
                            ) : (
                              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="var(--k-primary)" strokeWidth="1.5"><path d="M2 8a6 6 0 1 0 12 0A6 6 0 0 0 2 8z"/><path d="M8 5v3l2 2"/></svg>
                            )}
                            <a href={a.url} target="_blank" rel="noreferrer" style={{ flex: 1, fontSize: 12, color: 'var(--k-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'none' }}>{a.name}</a>
                            <button onClick={() => setcfg('attachments', cfg.attachments.filter((_, j) => j !== i))}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
                          </div>
                        ))}
                      </div>
                    )}
                    <input ref={tmplFileRef} type="file" multiple
                      accept=".jpg,.jpeg,.png,.gif,.heic,.heif,.pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt"
                      style={{ display: 'none' }}
                      onChange={async (e) => {
                        const picked = Array.from(e.target.files);
                        if (!picked.length) return;
                        setTmplUploading(true);
                        try {
                          for (const file of picked) {
                            const fd = new FormData();
                            fd.append('file', file);
                            const res = await api.post('/upload', fd);
                            const item = { name: file.name, url: res.data.url, key: res.data.key || null };
                            setTaskTmplForm(f => ({ ...f, config: { ...f.config, attachments: [...(f.config.attachments || []), item] } }));
                          }
                        } catch (_) {}
                        finally { setTmplUploading(false); e.target.value = ''; }
                      }}
                    />
                    <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                      <button className="k-btn k-btn--ghost k-btn--sm" disabled={tmplUploading}
                        onClick={() => tmplFileRef.current?.click()}
                        style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M8 12V4M4 8l4-4 4 4"/><path d="M2 14h12"/></svg>
                        {tmplUploading ? 'Uploading…' : 'Upload file'}
                      </button>
                    </div>
                    <AttachUrlRow onAdd={(item) => setcfg('attachments', [...(cfg.attachments || []), item])} />
                  </div>

                  <div style={{ display: 'flex', gap: 10, paddingTop: 4, borderTop: '1px solid var(--rule-soft)' }}>
                    <button className="k-btn k-btn--primary" onClick={saveTaskTemplate} disabled={savingTask}>
                      {savingTask ? 'Saving…' : (editingTmplId ? 'Save changes' : 'Create template')}
                    </button>
                    <button className="k-btn k-btn--ghost" onClick={() => { setShowTaskForm(false); setEditingTmplId(null); }}>Cancel</button>
                  </div>
                </div>
              </section>
            );
          })()}

          {taskTemplates.length === 0 && tab === 'task' && !showTaskForm && (
            <div className="k-empty">
              <div className="k-empty__icon">📋</div>
              <div className="k-empty__title">No task templates yet</div>
              <div className="k-empty__sub">Create reusable templates for Instagram posts, brand videos, client briefs, and more.</div>
            </div>
          )}
        </>
      )}
      {/* Apply template modal */}
      {applyModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,.45)', backdropFilter: 'blur(3px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => setApplyModal(null)}>
          <div style={{
            background: 'var(--surface)', borderRadius: 16,
            border: '1px solid var(--rule)',
            boxShadow: '0 24px 64px rgba(0,0,0,.22)',
            width: 420, padding: '28px 28px 24px',
          }} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--k-primary)', marginBottom: 4, fontFamily: 'var(--font-ui), var(--font-hindi)' }}>
                  USE TEMPLATE · साँचा
                </div>
                <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 22, color: 'var(--ink)', lineHeight: 1.2 }}>
                  {applyModal.tmplName}
                </h2>
              </div>
              <button onClick={() => setApplyModal(null)} style={{
                width: 28, height: 28, borderRadius: 7, border: '1px solid var(--rule)',
                background: 'transparent', cursor: 'pointer', fontSize: 16, color: 'var(--ink-3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>×</button>
            </div>

            {/* Project picker */}
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 8 }}>
              Apply to project
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 24 }}>
              {projects.map(p => (
                <button
                  key={p.team_id}
                  onClick={() => setApplyToProject(p.team_id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
                    border: applyToProject === p.team_id ? '1.5px solid var(--k-primary)' : '1.5px solid var(--rule)',
                    background: applyToProject === p.team_id ? 'var(--side-active)' : 'var(--bg)',
                    color: 'var(--ink)', fontFamily: 'var(--font-ui)', fontSize: 14, textAlign: 'left',
                    transition: 'border .1s, background .1s',
                  }}
                >
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: applyToProject === p.team_id ? 'var(--k-primary)' : 'var(--rule-strong)',
                    transition: 'background .1s',
                  }} />
                  {p.name}
                </button>
              ))}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                className="k-btn k-btn--primary"
                style={{ flex: 1 }}
                disabled={!applyToProject || applying}
                onClick={() => applyProjectTemplate(applyModal.tmplId)}
              >
                {applying ? 'Applying…' : 'Apply template'}
              </button>
              <button className="k-btn k-btn--ghost" onClick={() => setApplyModal(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  );
}

function AttachUrlRow({ onAdd }) {
  const [name, setName] = useState('');
  const [url,  setUrl]  = useState('');
  const add = () => {
    if (!url.trim()) return;
    const label = name.trim() || url.trim().split('/').pop().split('?')[0] || url.trim();
    onAdd({ name: label, url: url.trim(), key: null });
    setName(''); setUrl('');
  };
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
      <div style={{ flex: 1 }}>
        <input className="k-input" value={url} onChange={e => setUrl(e.target.value)}
          placeholder="Paste URL (Google Drive, Figma, Notion…)"
          onKeyDown={e => e.key === 'Enter' && add()}
          style={{ marginBottom: 6 }} />
        <input className="k-input" value={name} onChange={e => setName(e.target.value)}
          placeholder="Label (optional — e.g. Brand Kit, Figma Mockup)" />
      </div>
      <button className="k-btn k-btn--ghost k-btn--sm" onClick={add}>+ Add URL</button>
    </div>
  );
}
