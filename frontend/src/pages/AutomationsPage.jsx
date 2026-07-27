/**
 * AutomationsPage.jsx — k-* design system.
 * Props:
 *   teamId   — pre-selected project (from board embed)
 *   embedded — when true, strips k-screen wrapper + PageHeader (used inside ProjectBoardPage)
 */
import React, { useState, useEffect, useCallback } from 'react';
import { api, rows as asRows, body as asBody } from '../lib/api';
import { PageHeader } from '../components/editorial';
import { ErrorState, errorKind, EmptyState, SkeletonText } from '../components/ui';
import { Card, CardHead, CardBody } from '../components/ui/Card';
import { Field, Input, Select } from '../components/ui/Field';
import Button from '../components/ui/Button';
import { useToast } from '../components/ui/toast';
import ConfirmDialog from '../components/ui/ConfirmDialog';

const TRIGGERS = [
  { value: 'task_created',            label: 'Task created' },
  { value: 'status_changed',          label: 'Status changed' },
  { value: 'field_changed',           label: 'Field changed' },
  { value: 'assigned',                label: 'Task assigned' },
  { value: 'due_date_approaching',    label: 'Due date approaching' },
  { value: 'task_overdue',            label: 'Task overdue' },
  { value: 'comment_added',           label: 'Comment added' },
  { value: 'approval_status_changed', label: 'Approval status changed' },
];

const ACTIONS = [
  { value: 'send_email',        label: 'Send email' },
  { value: 'send_notification', label: 'Send in-app notification' },
  { value: 'set_field',         label: 'Set a field' },
  { value: 'change_status',     label: 'Change status' },
  { value: 'assign_to',         label: 'Assign to user' },
  { value: 'post_comment',      label: 'Post a comment' },
];

const CONDITION_FIELDS = [
  { value: 'status',   label: 'Status' },
  { value: 'priority', label: 'Priority' },
  { value: 'assignee', label: 'Assignee' },
];
const CONDITION_OPS  = [{ value: 'equals', label: '=' }, { value: 'not_equals', label: '≠' }];
const STATUS_OPTS    = ['todo','in_progress','in_review','done'];
const PRIORITY_OPTS  = ['low','medium','high','urgent'];

const TRIGGER_SANS = {
  task_created: 'नया कार्य', status_changed: 'स्थिति', field_changed: 'क्षेत्र',
  assigned: 'नियुक्त', task_overdue: 'विलंबित', comment_added: 'टिप्पणी',
  due_date_approaching: 'समय', approval_status_changed: 'अनुमोदन',
};

const EMPTY_CONDITION = { field: 'status', op: 'equals', value: 'done' };
const EMPTY_FORM = { name: '', trigger_event: 'status_changed', action_type: 'send_notification', action_config: '', conditions: [] };

export default function AutomationsPage({ teamId: propTeamId, embedded = false }) {
  const { pushToast } = useToast();

  const [automations, setAutomations] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [creating,    setCreating]    = useState(false);
  const [form,        setForm]        = useState(EMPTY_FORM);
  const [saving,      setSaving]      = useState(false);
  const [teams,       setTeams]       = useState([]);
  const [teamId,      setTeamId]      = useState(propTeamId || '');
  const [testingId,   setTestingId]   = useState(null);   // automation_id being test-run
  const [confirmState, setConfirmState] = useState(null);
  const [err,         setErr]         = useState(null);

  // ── Load teams for project picker ───────────────────────────────────────
  useEffect(() => {
    if (propTeamId) { setTeamId(propTeamId); return; }
    api.get('/teams').then(r => {
      const data = asRows(r);
      setTeams(data);
      if (data.length > 0 && !teamId) setTeamId(data[0].team_id);
    }).catch(() => setTeams([]));
  }, [propTeamId]); // eslint-disable-line

  // ── Load automations for selected project ────────────────────────────────
  /* A swallowed rejection here rendered the "No automations yet" empty state,
     which on this page is actively dangerous: it tells someone whose rules
     failed to load that they have none, and the obvious next action is to
     recreate a rule that is already live and firing. */
  const load = useCallback(() => {
    if (!teamId) { setLoading(false); return; }
    setLoading(true);
    setErr(null);
    api.get(`/automations/team/${teamId}`)
       .then(r => setAutomations(asRows(r)))
       .catch(e => { setErr(e); setAutomations([]); })
       .finally(() => setLoading(false));
  }, [teamId]);

  useEffect(() => { load(); }, [load]);

  // ── Sync propTeamId changes (e.g. navigating between boards) ────────────
  useEffect(() => { if (propTeamId) setTeamId(propTeamId); }, [propTeamId]);

  // ── Toggle enabled ───────────────────────────────────────────────────────
  const handleToggle = async (auto) => {
    await api.put(`/automations/${auto.automation_id}`, { enabled: !auto.enabled });
    setAutomations(prev => prev.map(a =>
      a.automation_id === auto.automation_id ? { ...a, enabled: !a.enabled } : a
    ));
  };

  // ── Delete ───────────────────────────────────────────────────────────────
  const handleDelete = (id) => {
    setConfirmState({
      message: 'Delete this automation?',
      confirmLabel: 'Delete',
      onConfirm: async () => {
        try {
          await api.delete(`/automations/${id}`);
          setAutomations(prev => prev.filter(a => a.automation_id !== id));
          pushToast({ type: 'success', title: 'Automation deleted' });
        } catch (err) {
          pushToast({ type: 'error', title: err?.response?.data?.detail || 'Could not delete automation' });
        }
      },
    });
  };

  // ── Test run ─────────────────────────────────────────────────────────────
  const handleTestRun = async (auto) => {
    setTestingId(auto.automation_id);
    try {
      await api.post(`/automations/${auto.automation_id}/run`, { team_id: teamId, _test: true });
      setAutomations(prev => prev.map(a =>
        a.automation_id === auto.automation_id ? { ...a, run_count: (a.run_count || 0) + 1 } : a
      ));
      pushToast({ type: 'success', title: `"${auto.name}" ran successfully` });
    } catch (err) {
      const detail = err?.response?.data?.detail || 'Test run failed';
      pushToast({ type: 'error', title: detail });
    } finally {
      setTestingId(null);
    }
  };

  // ── Conditions helpers ───────────────────────────────────────────────────
  const addCondition    = () => setForm(f => ({ ...f, conditions: [...f.conditions, { ...EMPTY_CONDITION }] }));
  const removeCondition = (i) => setForm(f => ({ ...f, conditions: f.conditions.filter((_, j) => j !== i) }));
  const updateCondition = (i, patch) => setForm(f => ({
    ...f, conditions: f.conditions.map((c, j) => j === i ? { ...c, ...patch } : c)
  }));

  // ── Create ───────────────────────────────────────────────────────────────
  const handleCreate = async (e) => {
    e.preventDefault();
    if (!teamId) { pushToast({ type: 'error', title: 'Select a project first' }); return; }
    setSaving(true);
    try {
      const actionConfig = {};
      if (form.action_config.trim()) {
        if (['post_comment','send_notification','send_email'].includes(form.action_type))
          actionConfig.message = form.action_config.trim();
        else if (form.action_type === 'change_status')
          actionConfig.status = form.action_config.trim();
        else
          actionConfig.value = form.action_config.trim();
      }
      const payload = {
        team_id: teamId,
        name: form.name,
        trigger: { event: form.trigger_event, filters: form.conditions },
        actions: [{ type: form.action_type, config: actionConfig }],
        enabled: true,
      };
      const r = await api.post('/automations/', payload);
      setAutomations(prev => [asBody(r), ...prev]);
      setCreating(false);
      setForm(EMPTY_FORM);
      pushToast({ type: 'success', title: 'Automation created' });
    } catch (err) {
      pushToast({ type: 'error', title: err?.response?.data?.detail || 'Could not create automation' });
    } finally { setSaving(false); }
  };

  // ── Project name helper ──────────────────────────────────────────────────
  const activeProject = teams.find(t => t.team_id === teamId);

  // ── Body ─────────────────────────────────────────────────────────────────
  const body = (
    <>
      {/* Project picker — always visible when not embedded (embedded gets it from board) */}
      {!propTeamId && teams.length > 0 && (
        <div className="aut-bar">
          <label className="aut-bar__l" htmlFor="aut-project">Project</label>
          <select
            id="aut-project"
            className="k-select aut-bar__sel"
            value={teamId}
            onChange={e => setTeamId(e.target.value)}
          >
            {teams.map(t => <option key={t.team_id} value={t.team_id}>{t.name}</option>)}
          </select>
          {activeProject && (
            <span className="aut-bar__n">{automations.length} rule{automations.length !== 1 ? 's' : ''}</span>
          )}
          <Button variant="fill" size="sm" className="aut-bar__sp" onClick={() => setCreating(true)}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v10M3 8h10"/></svg>
            New rule
          </Button>
        </div>
      )}

      {/* Embedded header row */}
      {propTeamId && (
        <div className="aut-head">
          <div className="aut-head__n">
            {automations.length} automation rule{automations.length !== 1 ? 's' : ''} for this project
          </div>
          {!creating && (
            <Button variant="fill" size="sm" onClick={() => setCreating(true)}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v10M3 8h10"/></svg>
              New rule
            </Button>
          )}
        </div>
      )}

      {/* Builder form */}
      {creating && (
        <Card>
          <CardHead title="New automation rule" sanskrit="नया नियम" />
          <CardBody>
            {/* A real <form>, so Enter submits and the browser runs `required`.
                Every label below is now wired to its control through Field —
                they were bare <label> elements with no htmlFor, which means a
                screen reader read nine unlabelled inputs. */}
            <form onSubmit={handleCreate} className="aut-form">
              <div className="aut-grid3">
                <Field label="Rule name" required htmlFor="aut-name">
                  <Input
                    id="aut-name"
                    required
                    value={form.name}
                    placeholder="e.g. Notify on done"
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  />
                </Field>
                <Field label="When (trigger)" htmlFor="aut-trigger">
                  <Select
                    id="aut-trigger"
                    value={form.trigger_event}
                    onChange={e => setForm(f => ({ ...f, trigger_event: e.target.value }))}
                  >
                    {TRIGGERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </Select>
                </Field>
                <Field label="Then (action)" htmlFor="aut-action">
                  <Select
                    id="aut-action"
                    value={form.action_type}
                    onChange={e => setForm(f => ({ ...f, action_type: e.target.value }))}
                  >
                    {ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </Select>
                </Field>
              </div>

              <Field
                htmlFor="aut-config"
                label={
                  form.action_type === 'change_status' ? 'Target status'
                    : form.action_type === 'assign_to' ? 'User email'
                      : form.action_type === 'set_field' ? 'Field value'
                        : 'Message'
                }
              >
                <Input
                  id="aut-config"
                  value={form.action_config}
                  onChange={e => setForm(f => ({ ...f, action_config: e.target.value }))}
                  placeholder={
                    form.action_type === 'change_status' ? 'done'
                      : form.action_type === 'assign_to' ? 'name@example.com'
                        : 'Optional message…'
                  }
                />
              </Field>

              <div>
                <div className="aut-cond__head">
                  <span className="aut-cond__t">Conditions (AND)</span>
                  <Button variant="ghost" size="sm" onClick={addCondition}>+ Add condition</Button>
                </div>
                {form.conditions.length === 0 ? (
                  <p className="aut-cond__none">No conditions — the rule fires on every trigger event.</p>
                ) : (
                  <div className="aut-cond__list">
                    {form.conditions.map((cond, i) => (
                      <div key={i} className="aut-cond__row">
                        <span className="aut-cond__and" aria-hidden={i === 0 || undefined}>
                          {i > 0 ? 'AND' : ''}
                        </span>
                        <select
                          className="k-select aut-cond__f"
                          aria-label={`Condition ${i + 1} field`}
                          value={cond.field}
                          onChange={e => updateCondition(i, { field: e.target.value })}
                        >
                          {CONDITION_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                        </select>
                        <select
                          className="k-select aut-cond__o"
                          aria-label={`Condition ${i + 1} operator`}
                          value={cond.op}
                          onChange={e => updateCondition(i, { op: e.target.value })}
                        >
                          {CONDITION_OPS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                        <select
                          className="k-select aut-cond__v"
                          aria-label={`Condition ${i + 1} value`}
                          value={cond.value}
                          onChange={e => updateCondition(i, { value: e.target.value })}
                        >
                          {(cond.field === 'priority' ? PRIORITY_OPTS : STATUS_OPTS).map(v => (
                            <option key={v} value={v}>{v}</option>
                          ))}
                        </select>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Remove condition ${i + 1}`}
                          onClick={() => removeCondition(i)}
                        >
                          ×
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="aut-acts">
                <Button type="submit" variant="fill" loading={saving} disabled={!form.name.trim()}>
                  Create rule
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => { setCreating(false); setForm(EMPTY_FORM); }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      {/* Loading */}
      {loading && (
        <div className="k-rules" aria-busy="true" aria-label="Loading automations">
          <SkeletonText width="40%" height={14} />
          <SkeletonText width="90%" height={12} />
        </div>
      )}

      {/* Failure — distinct from empty, see load() above */}
      {!loading && err && (
        <ErrorState
          kind={errorKind(err)}
          grant="access to this project's automations"
          onRetry={load}
        />
      )}

      {/* Empty state */}
      {!loading && !err && automations.length === 0 && !creating && (
        <EmptyState
          illustration="generic"
          title={{ en: 'No automations yet', hi: 'अभी कोई नियम नहीं' }}
          description="Create a rule to automate repetitive work on this project."
          action="New rule"
          onAction={() => setCreating(true)}
        />
      )}

      {/* Rules list */}
      {!loading && !err && automations.length > 0 && (
        <div className="k-rules">
          {automations.map((auto, idx) => {
            const filters  = auto.trigger?.filters || [];
            const condText = filters.length > 0
              ? filters.map(c => `${c.field} ${c.op === 'equals' ? '=' : '≠'} ${c.value}`).join(' · ')
              : 'Any condition';
            const thenText = (auto.actions || [])
              .map(a => ACTIONS.find(x => x.value === a.type)?.label || a.type).join(', ')
              || (auto.action_type ? ACTIONS.find(x => x.value === auto.action_type)?.label || auto.action_type : 'Action');
            const isTesting = testingId === auto.automation_id;

            return (
              <div key={auto.automation_id} className={'k-rule' + (!auto.enabled ? ' is-paused' : '')}>
                <div className="k-rule__head">
                  <span className="k-rule__id">AU-{idx + 1}</span>
                  <h3>{auto.name}</h3>
                  <span className={'k-rule__status k-rule__status--' + (auto.enabled ? 'on' : 'off')}>
                    <span className="k-rule__status-dot" />
                    {auto.enabled ? 'Active' : 'Paused'}
                  </span>
                  <span className="k-mute">
                    {auto.run_count > 0 ? `${auto.run_count} run${auto.run_count !== 1 ? 's' : ''}` : '0 runs'}
                  </span>
                </div>

                <div className="k-rule__flow">
                  <div className="k-rule__step k-rule__step--when">
                    <div className="k-rule__step-lbl">WHEN <span className="k-lbl__in" lang="hi">प्रसंग</span></div>
                    <div className="k-rule__step-body">{TRIGGERS.find(t => t.value === auto.trigger?.event)?.label || auto.trigger?.event || 'Trigger'}</div>
                    {TRIGGER_SANS[auto.trigger?.event] && <div className="k-rule__step-sans">{TRIGGER_SANS[auto.trigger?.event]}</div>}
                  </div>
                  <div className="k-rule__arrow">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 10h16M14 5l5 5-5 5"/></svg>
                  </div>
                  <div className="k-rule__step k-rule__step--cond">
                    <div className="k-rule__step-lbl">IF <span className="k-lbl__in" lang="hi">यदि</span></div>
                    <div className="k-rule__step-body">{condText}</div>
                  </div>
                  <div className="k-rule__arrow">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 10h16M14 5l5 5-5 5"/></svg>
                  </div>
                  <div className="k-rule__step k-rule__step--then">
                    <div className="k-rule__step-lbl">THEN <span className="k-lbl__in" lang="hi">क्रिया</span></div>
                    <div className="k-rule__step-body">{thenText}</div>
                  </div>
                </div>

                <div className="k-rule__foot">
                  {/* Test run */}
                  {/* Button's own `loading` renders `.spin` and kills pointer
                      events — the spinner the design system already owns,
                      reachable by the reduced-motion block, which an inline
                      `animation:` never was. */}
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={isTesting}
                    title="Run this automation now with a test context"
                    onClick={() => handleTestRun(auto)}
                  >
                    {isTesting ? 'Running…' : (
                      <>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M4 3l10 5-10 5V3z"/></svg>
                        Test run
                      </>
                    )}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleToggle(auto)}>
                    {auto.enabled ? 'Pause' : 'Resume'}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    className="aut-del"
                    onClick={() => handleDelete(auto.automation_id)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  if (embedded) {
    return (
      <div className="aut-embed">
        {body}
      </div>
    );
  }

  if (!teamId && teams.length === 0 && !loading) return (
    <div className="k-screen">
      <div className="k-empty">
        <div className="k-empty__icon">⚡</div>
        <div className="k-empty__title">No projects yet</div>
        <div className="k-empty__sub">Create a project first to set up automations.</div>
      </div>
    </div>
  );

  return (
    <div className="k-screen">
      <PageHeader
        kicker="OPERATIONS"
        title="Automations"
        sanskrit="स्वचालन"
        lede='"When this happens, then do that." Rules run on every event in your workspace.'
        right={
          !creating && (
            <button className="k-btn k-btn--primary k-btn--sm" onClick={() => setCreating(true)}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v10M3 8h10"/></svg>
              New rule
            </button>
          )
        }
      />
      {body}
      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  );
}
