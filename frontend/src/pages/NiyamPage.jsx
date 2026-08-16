import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader, Section, Badge } from '../components/editorial';
import { Button, Select, Input, Toggle, EmptyState, ErrorState, useToast } from '../components/ui';
import { api } from '../lib/api';

import '../styles/niyam.css';

/**
 * NiyamPage — the automation builder.
 *
 * ── Why a card list and not a canvas ────────────────────────────────────────
 *
 * A rule is an ORDERED LINEAR PIPELINE of condition / action / wait. There is
 * no branching, so there is no graph to draw — and there is no flow library in
 * package.json, so a Jira-style canvas is weeks of drag, edge routing and
 * layout persistence before a single rule runs. Cards in a column say the same
 * thing and can be read on a phone.
 *
 * ── Everything offerable comes from the server ──────────────────────────────
 *
 * The field list, the operators for each field, the option list for each
 * select, and the action verbs all arrive from `GET /v1/niyam/catalog`. Nothing
 * about what a rule may say is decided in this file.
 *
 * That is not tidiness, it is the whole design. The estate this replaces had a
 * builder offering `priority` and `assignee` conditions against an engine whose
 * events carried neither — so those rules were unevaluable, the engine
 * correctly refused to fire, and the UI displayed them as Active for ever. A
 * second copy of the field list in the frontend is how that happens. There is
 * one list, it lives with the engine, and this page renders what it is given.
 *
 * ── Two switches, and a third that can veto both ────────────────────────────
 *
 * `enabled` is "is this rule live at all". `is_armed` is "may it ACT" — an
 * enabled, unarmed rule still runs, evaluates real conditions against real
 * events, and records what it WOULD have done. Above both sits the engine's
 * master switch, which the API reports as `effective_mode`.
 *
 * A UI that showed only the rule's own toggles would tell somebody their rule
 * is live while the engine is off. So when the master switch vetoes, the card
 * says so in the same place the toggle is, not in a banner somewhere else.
 *
 * ── "0 of 0" is not a broken rule ───────────────────────────────────────────
 *
 * The preview replays against real recorded events. Early on there are none,
 * and "0 of the last 0 events would have matched" reads like a failure. The
 * server sends a sentence for that case and this page shows it instead of the
 * numbers.
 */

const KIND_LABEL = { condition: 'Only if', action: 'Then', wait: 'Wait' };

/** A step with nothing filled in yet, per kind. */
function blankStep(kind, catalogEvent) {
  if (kind === 'condition') {
    const f = catalogEvent?.fields?.[0];
    return { kind, config: { field: f?.key || '', operator: f?.operators?.[0] || '', value: '' } };
  }
  if (kind === 'wait') return { kind, config: { minutes: 60 } };
  return { kind, config: { verb: 'notify.send', channel: 'inapp', to: ['@assignees'], title: '', body: '' } };
}

export default function NiyamPage() {
  const toast = useToast();
  const [catalog, setCatalog] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [rules, setRules] = useState([]);
  const [flags, setFlags] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(true);

  const [editing, setEditing] = useState(null);   // {rule_id?, name, event_type, steps}
  const [preview, setPreview] = useState(null);
  const [history, setHistory] = useState(null);
  const [fieldError, setFieldError] = useState(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [c, t, r] = await Promise.all([
        api.get('/v1/niyam/catalog'),
        api.get('/v1/niyam/templates'),
        api.get('/v1/niyam/rules'),
      ]);
      setCatalog(c.data);
      setTemplates(t.data.templates || []);
      setRules(r.data.rules || []);
      setFlags(r.data.flags || c.data.flags);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const eventsByType = useMemo(() => {
    const m = {};
    (catalog?.events || []).forEach((e) => { m[e.event_type] = e; });
    return m;
  }, [catalog]);

  const currentEvent = editing ? eventsByType[editing.event_type] : null;

  // ── mutations ─────────────────────────────────────────────────────────────

  async function save() {
    setFieldError(null);
    const body = {
      name: editing.name,
      event_type: editing.event_type,
      steps: editing.steps.map((s) => ({ kind: s.kind, config: s.config })),
    };
    try {
      if (editing.rule_id) {
        await api.patch(`/v1/niyam/rules/${editing.rule_id}`, { name: body.name, steps: body.steps });
      } else {
        await api.post('/v1/niyam/rules', body);
      }
      toast.success('Rule saved. It is off until you turn it on.');
      setEditing(null);
      load();
    } catch (e) {
      // The API answers 422 with {error, step_no, field} so the message can be
      // shown against the card that caused it rather than as a banner the
      // author has to map back onto their own pipeline.
      const d = e?.response?.data?.detail;
      if (d?.error) setFieldError(d);
      else setError(e);
    }
  }

  async function toggle(rule, key, value) {
    try {
      await api.patch(`/v1/niyam/rules/${rule.rule_id}`, { [key]: value });
      load();
    } catch (e) {
      const msg = e?.response?.data?.detail?.error;
      if (msg) toast.error(msg);           // e.g. "arm a rule that has never run"
      else setError(e);
    }
  }

  async function runPreview(ruleId) {
    setPreview({ loading: true });
    try {
      const { data } = await api.post(`/v1/niyam/rules/${ruleId}/preview`);
      setPreview({ ...data, rule_id: ruleId });
    } catch (e) { setPreview(null); setError(e); }
  }

  async function openHistory(ruleId) {
    setHistory({ loading: true, rule_id: ruleId });
    try {
      const { data } = await api.get(`/v1/niyam/rules/${ruleId}/runs`);
      setHistory({ runs: data.runs || [], rule_id: ruleId });
    } catch (e) { setHistory(null); setError(e); }
  }

  async function cloneTemplate(id) {
    try {
      await api.post(`/v1/niyam/rules/from-template/${id}`);
      toast.success('Copied. It is off until you turn it on.');
      load();
    } catch (e) { setError(e); }
  }

  // ── render ────────────────────────────────────────────────────────────────

  if (error) return <ErrorState error={error} onRetry={load} />;

  const engineDry = flags && !flags.engine_armed;

  return (
    <div className="k-page niyam">
      <PageHeader
        title="Niyam"
        subtitle="Rules that run themselves — नियम"
        actions={
          <Button onClick={() => setEditing({ name: '', event_type: catalog?.events?.[0]?.event_type, steps: [] })}>
            New rule
          </Button>
        }
      />

      {/* The master switch, stated once and plainly. Every card repeats the
          consequence rather than relying on the reader remembering this. */}
      {engineDry && (
        <div className="niyam-master" role="status">
          <strong>Nothing is being sent.</strong> The automation engine is in dry
          run, so every rule below records what it would have done and does not
          do it. That is deliberate — it is how a rule is judged before it is
          trusted.
        </div>
      )}

      <Section title="Your rules">
        {busy && <p className="niyam-muted">Loading…</p>}

        {!busy && rules.length === 0 && (
          <EmptyState
            title="No rules yet"
            body="Start from one of the examples below — each is a real rule you can read before you turn it on."
          />
        )}

        <div className="niyam-rules">
          {rules.map((r) => (
            <article className="niyam-rule" key={r.rule_id}>
              <header>
                <h3>{r.name}</h3>
                <Badge>{r.event_type}</Badge>
              </header>

              <dl className="niyam-counts">
                <div><dt>Runs</dt><dd>{r.runs_total}</dd></div>
                <div><dt>Last 7 days</dt><dd>{r.runs_7d}</dd></div>
                <div>
                  <dt>Last run</dt>
                  <dd>{r.last_run_at ? new Date(r.last_run_at).toLocaleString() : 'never'}</dd>
                </div>
              </dl>

              <div className="niyam-switches">
                <label>
                  <Toggle checked={r.enabled} onChange={(v) => toggle(r, 'enabled', v)} />
                  <span>On</span>
                </label>
                <label>
                  <Toggle checked={r.is_armed} onChange={(v) => toggle(r, 'is_armed', v)} />
                  <span>Allowed to act</span>
                </label>
              </div>

              {/* The rule's own switches can both be on while nothing happens.
                  Said here, beside them, rather than left to a banner. */}
              {r.is_armed && r.effective_mode === 'dry' && (
                <p className="niyam-veto">
                  This rule is armed, but the engine is in dry run — so it still
                  will not act.
                </p>
              )}
              {r.enabled && !r.is_armed && (
                <p className="niyam-note">
                  Running and recording what it would do. Nothing is sent.
                </p>
              )}

              <footer>
                <Button variant="ghost" onClick={() => runPreview(r.rule_id)}>Preview</Button>
                <Button variant="ghost" onClick={() => openHistory(r.rule_id)}>History</Button>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    const { data } = await api.get(`/v1/niyam/rules/${r.rule_id}`);
                    setEditing({ rule_id: r.rule_id, name: data.rule.name,
                                 event_type: data.rule.event_type, steps: data.steps });
                  }}
                >Edit</Button>
              </footer>
            </article>
          ))}
        </div>
      </Section>

      <Section title="Start from an example">
        <div className="niyam-templates">
          {templates.map((t) => (
            <article className="niyam-template" key={t.id}>
              <h4>{t.name}</h4>
              <p>{t.why}</p>
              <Button variant="ghost" onClick={() => cloneTemplate(t.id)}>Use this</Button>
            </article>
          ))}
        </div>
      </Section>

      {editing && (
        <RuleEditor
          editing={editing}
          setEditing={setEditing}
          catalog={catalog}
          currentEvent={currentEvent}
          fieldError={fieldError}
          onSave={save}
          onClose={() => { setEditing(null); setFieldError(null); }}
        />
      )}

      {preview && <PreviewPanel preview={preview} onClose={() => setPreview(null)} />}
      {history && <HistoryPanel history={history} onClose={() => setHistory(null)} />}
    </div>
  );
}

/* ── the editor ─────────────────────────────────────────────────────────── */

function RuleEditor({ editing, setEditing, catalog, currentEvent, fieldError, onSave, onClose }) {
  const set = (patch) => setEditing({ ...editing, ...patch });
  const setStep = (i, config) => {
    const steps = editing.steps.slice();
    steps[i] = { ...steps[i], config };
    set({ steps });
  };

  return (
    <div className="niyam-editor">
      <header>
        <h2>{editing.rule_id ? 'Edit rule' : 'New rule'}</h2>
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </header>

      <Input
        label="What is this rule called?"
        value={editing.name}
        onChange={(e) => set({ name: e.target.value })}
        placeholder="When a task is finished, tell whoever asked for it"
      />

      <Select
        label="When this happens"
        value={editing.event_type}
        onChange={(e) => set({ event_type: e.target.value, steps: [] })}
      >
        {(catalog?.events || []).map((ev) => (
          <option key={ev.event_type} value={ev.event_type}>{ev.event_type}</option>
        ))}
      </Select>

      <ol className="niyam-steps">
        {editing.steps.map((s, i) => (
          <li key={i} className={fieldError?.step_no === i ? 'is-bad' : ''}>
            <span className="niyam-steplabel">{KIND_LABEL[s.kind]}</span>

            {s.kind === 'condition' && (
              <ConditionCard
                step={s} event={currentEvent}
                onChange={(cfg) => setStep(i, cfg)}
              />
            )}
            {s.kind === 'wait' && (
              <Input
                type="number" label="Minutes"
                value={s.config.minutes}
                onChange={(e) => setStep(i, { minutes: Number(e.target.value) })}
              />
            )}
            {s.kind === 'action' && (
              <ActionCard step={s} catalog={catalog} onChange={(cfg) => setStep(i, cfg)} />
            )}

            {fieldError?.step_no === i && <p className="niyam-error">{fieldError.error}</p>}

            <Button variant="ghost"
              onClick={() => set({ steps: editing.steps.filter((_, j) => j !== i) })}
            >Remove</Button>
          </li>
        ))}
      </ol>

      <div className="niyam-add">
        {['condition', 'action', 'wait'].map((k) => (
          <Button key={k} variant="ghost"
            onClick={() => set({ steps: [...editing.steps, blankStep(k, currentEvent)] })}
          >Add {KIND_LABEL[k].toLowerCase()}</Button>
        ))}
      </div>

      {fieldError && fieldError.step_no == null && (
        <p className="niyam-error">{fieldError.error}</p>
      )}

      <footer>
        <Button onClick={onSave}>Save</Button>
        <span className="niyam-muted">A new rule is saved switched off.</span>
      </footer>
    </div>
  );
}

function ConditionCard({ step, event, onChange }) {
  const fields = event?.fields || [];
  const field = fields.find((f) => f.key === step.config.field);
  const operators = field?.operators || [];
  const needsValue = !['is_empty', 'not_empty'].includes(step.config.operator);

  return (
    <div className="niyam-cond">
      <Select
        value={step.config.field}
        onChange={(e) => {
          const next = fields.find((f) => f.key === e.target.value);
          // Reset the operator when the field changes: the operators are a
          // property of the field's TYPE, so keeping the old one is how you get
          // "priority is after 3 days".
          onChange({ field: e.target.value, operator: next?.operators?.[0] || '', value: '' });
        }}
      >
        {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
      </Select>

      <Select
        value={step.config.operator}
        onChange={(e) => onChange({ ...step.config, operator: e.target.value })}
      >
        {operators.map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
      </Select>

      {needsValue && (field?.options?.length ? (
        <Select
          value={step.config.value ?? ''}
          onChange={(e) => onChange({ ...step.config, value: e.target.value })}
        >
          <option value="">Choose…</option>
          {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </Select>
      ) : (
        <Input
          value={step.config.value ?? ''}
          onChange={(e) => onChange({ ...step.config, value: e.target.value })}
          placeholder={field?.kind === 'date' ? 'days, or a date' : 'value'}
        />
      ))}
    </div>
  );
}

function ActionCard({ step, catalog, onChange }) {
  const cfg = step.config;
  return (
    <div className="niyam-action">
      <Select value={cfg.verb} onChange={(e) => onChange({ ...cfg, verb: e.target.value })}>
        {(catalog?.actions || []).map((a) => <option key={a} value={a}>{a}</option>)}
      </Select>

      {cfg.verb === 'notify.send' && (
        <>
          <Select
            value={(cfg.to || [])[0] || '@assignees'}
            onChange={(e) => onChange({ ...cfg, to: [e.target.value] })}
          >
            {/* Stored as a QUESTION, not a person: the answer differs for every
                event, and "tell whoever asked for it" is meaningless as an id. */}
            <option value="@assignees">whoever it is assigned to</option>
            <option value="@creator">whoever created it</option>
          </Select>
          <Input label="Title" value={cfg.title || ''}
            onChange={(e) => onChange({ ...cfg, title: e.target.value })} />
          <Input label="Message" value={cfg.body || ''}
            onChange={(e) => onChange({ ...cfg, body: e.target.value })} />
        </>
      )}

      {cfg.verb === 'task.set_status' && (
        <Input label="Set status to" value={cfg.status || ''}
          onChange={(e) => onChange({ ...cfg, status: e.target.value })} />
      )}
    </div>
  );
}

/* ── preview and history ────────────────────────────────────────────────── */

function PreviewPanel({ preview, onClose }) {
  return (
    <div className="niyam-panel">
      <header><h2>What this rule would have done</h2>
        <Button variant="ghost" onClick={onClose}>Close</Button></header>

      {preview.loading ? <p className="niyam-muted">Replaying recent events…</p> : (
        <>
          {/* The server writes this sentence, because "0 of 0" reads like a
              broken rule when it actually means "nothing has happened yet". */}
          <p className="niyam-verdict">{preview.note}</p>

          <p className="niyam-muted">
            This changed nothing. No messages were sent and no runs were recorded.
          </p>

          <ul className="niyam-sample">
            {(preview.sample || []).map((s) => (
              <li key={s.event_id} className={`is-${s.outcome}`}>
                <span className="niyam-when">{new Date(s.occurred_at).toLocaleString()}</span>
                <span className="niyam-outcome">{s.outcome}</span>
                <span className="niyam-why">{s.reason}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function HistoryPanel({ history, onClose }) {
  return (
    <div className="niyam-panel">
      <header><h2>What this rule actually did</h2>
        <Button variant="ghost" onClick={onClose}>Close</Button></header>

      {history.loading ? <p className="niyam-muted">Loading…</p> : (
        (history.runs || []).length === 0
          ? <EmptyState title="No runs yet" body="Nothing has matched this rule so far." />
          : (
            <ul className="niyam-runs">
              {history.runs.map((run) => (
                <li key={run.run_id}>
                  <header>
                    <span>{new Date(run.started_at).toLocaleString()}</span>
                    {run.dry_run && <Badge>dry run</Badge>}
                    {run.wake_at && <Badge>waiting</Badge>}
                  </header>
                  {/* Every step says what it compared. This is the answer to
                      "why did my rule not fire" — the question the old engine
                      answered into a server log nobody read. */}
                  <ol>
                    {(run.steps || []).map((s) => (
                      <li key={s.step_no} className={`is-${s.outcome}`}>
                        <span className="niyam-outcome">{s.outcome}</span>
                        <span className="niyam-why">
                          {s.detail?.reason
                            || (s.detail?.verb ? `${s.detail.verb}` : '')}
                        </span>
                      </li>
                    ))}
                  </ol>
                </li>
              ))}
            </ul>
          )
      )}
    </div>
  );
}
