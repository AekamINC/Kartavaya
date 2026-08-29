/**
 * TemplatesPage.jsx — project and task templates (`/templates`).
 *
 * 621 lines and 60 inline styles before this, the largest of them a 200-line
 * task-template editor and a 73-line hand-rolled modal. Split into
 * `pages/templates/` on the `pages/ganit/` precedent: the route file keeps its
 * path, the parts move out.
 *
 * DEFECTS FIXED, beyond the styling:
 *
 *  · `Promise.all` over three endpoints. One rejection threw the whole load
 *    away, so a failing `/teams` — which this page only needs to populate a
 *    dropdown — hid every template the firm had. `allSettled`, per the pattern
 *    GanitPage.jsx:66 already establishes for exactly this reason.
 *
 *  · `catch { toast }` with no error state, and NO empty state at all on the
 *    project tab: a failed load rendered an empty grid with a "Save current
 *    project as template" card in it, which reads as "you have no templates".
 *
 *  · The task tab's empty state was a hand-rolled `k-empty` div with an emoji;
 *    it is `EmptyState` now, and it no longer claims emptiness on failure.
 *
 * RESPONSE SHAPES (backend/routers/templates.py:69, :151; server.py:1904):
 * all three are bare arrays — `rows()` covers those and the envelope both.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, rows as asRows, body } from '../lib/api';
import { useToast } from '../components/ui/toast';
import { PageHeader } from '../components/editorial';
import { Card, CardHead, CardBody } from '../components/ui/Card';
import { Field, Input, Select } from '../components/ui/Field';
import Button from '../components/ui/Button';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState, errorKind } from '../components/ui/ErrorState';
import { SkeletonCardGrid } from '../components/ui/Skeleton';
import { avatarBg } from '../components/ui/Avatar';
import TemplateCard from './templates/TemplateCard';
import TaskTemplateForm from './templates/TaskTemplateForm';
import ApplyTemplateModal from './templates/ApplyTemplateModal';
import { useLanguage } from '../components/CustomizePanel';
import { secondaryOf } from '../lib/labels';
import { Secondary } from '../components/Bilingual';

const EMPTY_TASK_TMPL = {
  name: '', icon: '📋', is_default: false, team_id: '',
  config: { title: '', description: '', priority: 'medium', subtasks: [], attachments: [], tags: [], custom_fields: {} },
};

const KICKER_SANS = ['राजस्व', 'स्वागत', 'विपणन', 'कार्यालय', 'विधि', 'सेवा', 'परियोजना'];

const parseCfg = (raw) => {
  if (!raw) return {};
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
};

const kickerFor = (t) => ((t.description || t.name || '').split(/\s+/)[0] || '').slice(0, 10).toUpperCase();

/**
 * The Devanagari half of a tab label, decided by the language layer.
 *
 * A component so the language stays a plain argument inside the `.map` — no
 * hook is called per tab.
 */
function TabIn({ hi, lang }) {
  const { secondary, script } = secondaryOf(hi, lang);
  return secondary
    ? <Secondary className="k-tmpl-tab__sans" value={secondary} script={script} />
    : null;
}

export default function TemplatesPage() {
  const { pushToast } = useToast();
  const navigate = useNavigate();

  const [projTemplates, setProjTemplates] = useState([]);
  const [taskTemplates, setTaskTemplates] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);
  const [tab, setTab] = useState('project');
  // ONE LABEL SHAPE — `.k-tmpl-tab__sans` is not in `[data-language="en"]`'s
  // six-name list. Read once because TABS is mapped.
  const lang = useLanguage();

  const [saveFrom, setSaveFrom] = useState('');
  const [ptName, setPtName] = useState('');
  const [ptDesc, setPtDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const [showSaveForm, setShowSaveForm] = useState(false);

  const [applyModal, setApplyModal] = useState(null);
  const [applyToProject, setApplyToProject] = useState('');
  const [applying, setApplying] = useState(false);

  const [taskTmplForm, setTaskTmplForm] = useState(EMPTY_TASK_TMPL);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [editingTmplId, setEditingTmplId] = useState(null);
  const [confirmState, setConfirmState] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    // allSettled, not all. `/teams` only feeds a dropdown; its failure must not
    // take the template lists down with it.
    const [pt, tt, pr] = await Promise.allSettled([
      api.get('/templates/projects'),
      api.get('/templates/tasks'),
      api.get('/teams'),
    ]);
    if (pt.status === 'fulfilled') setProjTemplates(asRows(pt.value));
    if (tt.status === 'fulfilled') setTaskTemplates(asRows(tt.value));
    if (pr.status === 'fulfilled') setProjects(asRows(pr.value));
    // The page has failed only if BOTH template lists failed. A missing project
    // list degrades the create forms; it does not blank the page.
    if (pt.status === 'rejected' && tt.status === 'rejected') {
      setLoadErr(errorKind(pt.reason));
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveProjectAsTemplate = async () => {
    if (!ptName.trim() || !saveFrom) return;
    setSaving(true);
    try {
      const [colR, fieldR] = await Promise.all([
        api.get(`/projects/${saveFrom}/columns`),
        api.get(`/fields/team/${saveFrom}`).catch(() => ({ data: [] })),
      ]);
      const config = {
        columns: asRows(colR).map(c => ({ name: c.name, color: c.color, is_done: c.is_done })),
        fields: asRows(fieldR).map(f => ({ name: f.name, type: f.type, config: f.config })),
        sample_tasks: [],
      };
      await api.post('/templates/projects', { name: ptName.trim(), description: ptDesc.trim() || null, config });
      pushToast({ type: 'success', title: `Template "${ptName}" saved` });
      setPtName(''); setPtDesc(''); setSaveFrom(''); setShowSaveForm(false);
      load();
    } catch {
      pushToast({ type: 'error', title: 'Could not save template' });
    } finally {
      setSaving(false);
    }
  };

  const applyProjectTemplate = async (tmplId, projectId) => {
    const pid = projectId || applyToProject;
    if (!pid) return;
    setApplying(true);
    try {
      const res = await api.post(`/templates/projects/${tmplId}/apply?team_id=${pid}`);
      const created = body(res).created || {};
      const skipped = body(res).skipped || {};
      // Apply is idempotent by name as of 2026-08-29 — a second apply used to
      // DOUBLE the board (measured: five columns twice, at the same
      // `sort_order`). Now it writes nothing, and "Applied — 0 columns created"
      // is what a customer reads as a failure. So the sentence has to be able
      // to say "already there", or the fix looks like a new bug.
      const made = created.columns ?? 0;
      const same = skipped.columns ?? 0;
      pushToast({
        type: 'success',
        title: made
          ? `Applied — ${made} column${made === 1 ? '' : 's'} created`
          : same
            ? 'Already applied — this project has these columns'
            : 'Applied',
      });
      setApplyModal(null); setApplyToProject('');
      navigate(`/projects/${pid}`);
    } catch {
      pushToast({ type: 'error', title: 'Could not apply template' });
    } finally {
      setApplying(false);
    }
  };

  const askDelete = (kind, id, name) => setConfirmState({
    title: 'Delete template?',
    message: `"${name}" will be removed. Projects and tasks already created from it are unaffected.`,
    confirmLabel: 'Delete',
    intent: 'danger',
    onConfirm: async () => {
      try {
        await api.delete(`/templates/${kind}/${id}`);
        pushToast({ type: 'success', title: 'Template deleted' });
        load();
      } catch {
        pushToast({ type: 'error', title: 'Could not delete template' });
      }
    },
  });

  const setDefault = async (id) => {
    try {
      await api.post(`/templates/tasks/${id}/set-default`);
      pushToast({ type: 'success', title: 'Set as default' });
      load();
    } catch {
      pushToast({ type: 'error', title: 'Could not set default' });
    }
  };

  const isProject = tab === 'project';
  const current = isProject ? projTemplates : taskTemplates;

  const TABS = [
    ['project', 'Project templates', 'परियोजना', projTemplates.length],
    ['task', 'Task templates', 'कार्य', taskTemplates.length],
  ];

  return (
    <div className="k-screen">
      <PageHeader
        kicker="OPERATIONS"
        title="Templates"
        sanskrit="साँचा"
        lede="Bootstrap a new project or task from something that worked before."
      />

      <div className="k-tmpl-tabs" role="tablist" aria-label="Template type">
        {TABS.map(([id, label, hi, n]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`k-tmpl-tab${tab === id ? ' is-active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
            <TabIn hi={hi} lang={lang} />
            <span className="k-tmpl-tab__count">{n}</span>
          </button>
        ))}
      </div>

      {loading && <SkeletonCardGrid count={6} columns={3} lines={3} />}

      {!loading && loadErr && <ErrorState kind={loadErr} onRetry={load} />}

      {!loading && !loadErr && (
        <>
          <div className="k-tmpl-grid">
            {current.map((t, idx) => {
              const cfg = parseCfg(t.config);
              return (
                <TemplateCard
                  key={t.template_id}
                  tmpl={t}
                  cfg={cfg}
                  kind={tab}
                  color={cfg.color || avatarBg(t.name || t.template_id || String(idx))}
                  sans={KICKER_SANS[idx % KICKER_SANS.length]}
                  kicker={kickerFor(t)}
                  applying={applying}
                  onUse={() => {
                    if (projects.length === 1) applyProjectTemplate(t.template_id, projects[0].team_id);
                    else { setApplyToProject(''); setApplyModal({ tmplId: t.template_id, tmplName: t.name }); }
                  }}
                  onPreview={() => pushToast({
                    type: 'info',
                    title: t.name,
                    message: `${(cfg.columns || []).length} columns, ${(cfg.fields || []).length} fields`,
                  })}
                  onEdit={() => {
                    setEditingTmplId(t.template_id);
                    setTaskTmplForm({
                      name: t.name,
                      icon: t.icon || '📋',
                      is_default: t.is_default || false,
                      team_id: t.team_id || '',
                      config: cfg,
                    });
                    setShowTaskForm(true);
                  }}
                  onSetDefault={() => setDefault(t.template_id)}
                  onDelete={() => askDelete(isProject ? 'projects' : 'tasks', t.template_id, t.name)}
                />
              );
            })}

            {isProject && (
              <button className="k-tmpl-card k-tmpl-card--new" onClick={() => setShowSaveForm(v => !v)}>
                <div className="k-tmpl-card__plus">+</div>
                <div className="k-tmpl-card__new-title">Save current project as template</div>
                <div className="k-tmpl-card__new-sub">Captures columns and custom fields. Tasks are not copied.</div>
              </button>
            )}
          </div>

          {/* Empty state, distinct from the failure above. The project tab had
              none at all — the "new" card stood in for one, which is not the
              same thing as saying the list is empty. */}
          {current.length === 0 && !(tab === 'task' && showTaskForm) && (
            <EmptyState
              illustration="generic"
              title={isProject
                ? { en: 'No project templates yet', hi: 'अभी कोई साँचा नहीं' }
                : { en: 'No task templates yet', hi: 'अभी कोई साँचा नहीं' }}
              description={isProject
                ? 'Save a project you have already set up, and reuse its columns and fields.'
                : 'Create reusable templates for recurring work — client briefs, filings, reviews.'}
            />
          )}

          {isProject && showSaveForm && (
            <Card>
              <CardHead title="Save as template" sanskrit="संरक्षित" />
              <CardBody>
                <div className="tpl-form">
                  <div className="tpl-grid2">
                    <Field label="Source project" required htmlFor="tpl-src">
                      <Select id="tpl-src" value={saveFrom} onChange={e => setSaveFrom(e.target.value)}>
                        <option value="">Choose project…</option>
                        {projects.map(p => <option key={p.team_id} value={p.team_id}>{p.name}</option>)}
                      </Select>
                    </Field>
                    <Field label="Template name" required htmlFor="tpl-tname">
                      <Input
                        id="tpl-tname"
                        value={ptName}
                        placeholder="e.g. Quarterly client review"
                        onChange={e => setPtName(e.target.value)}
                      />
                    </Field>
                  </div>
                  <Field label="Description" htmlFor="tpl-tdesc" hint="Optional.">
                    <Input
                      id="tpl-tdesc"
                      value={ptDesc}
                      placeholder="What is this template for?"
                      onChange={e => setPtDesc(e.target.value)}
                    />
                  </Field>
                  <div className="wf-acts">
                    <Button
                      variant="fill"
                      loading={saving}
                      disabled={!saveFrom || !ptName.trim()}
                      onClick={saveProjectAsTemplate}
                    >
                      Save template
                    </Button>
                    <Button variant="ghost" onClick={() => setShowSaveForm(false)}>Cancel</Button>
                  </div>
                </div>
              </CardBody>
            </Card>
          )}

          {!isProject && !showTaskForm && (
            <button
              className="k-tmpl-card k-tmpl-card--new"
              onClick={() => { setEditingTmplId(null); setTaskTmplForm(EMPTY_TASK_TMPL); setShowTaskForm(true); }}
            >
              <div className="k-tmpl-card__plus">+</div>
              <div className="k-tmpl-card__new-title">New task template</div>
              <div className="k-tmpl-card__new-sub">Pre-fill title, description, subtasks, priority and attachments.</div>
            </button>
          )}

          {!isProject && showTaskForm && (
            <TaskTemplateForm
              form={taskTmplForm}
              setForm={setTaskTmplForm}
              editingId={editingTmplId}
              projects={projects}
              pushToast={pushToast}
              onCancel={() => { setShowTaskForm(false); setEditingTmplId(null); }}
              onSaved={() => { setShowTaskForm(false); setEditingTmplId(null); load(); }}
            />
          )}
        </>
      )}

      <ApplyTemplateModal
        open={!!applyModal}
        onClose={() => setApplyModal(null)}
        tmplName={applyModal?.tmplName}
        projects={projects}
        value={applyToProject}
        onChange={setApplyToProject}
        applying={applying}
        onApply={() => applyProjectTemplate(applyModal.tmplId)}
      />

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  );
}
