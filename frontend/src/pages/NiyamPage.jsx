import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Section, Badge } from '../components/editorial';
import ModuleHeader from '../components/module/ModuleHeader';
import { ICONS } from '../components/layout/navIcons';
import { Button, Select, Input, Textarea, Toggle, EmptyState, ErrorState, useToast } from '../components/ui';
import { Secondary } from '../components/Bilingual';
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

/** A stored step as words a person can read, for the pipeline strip.
 *
 *  Deliberately terse: this is a glance, not the editor. `days_overdue gte 3`
 *  becomes "days overdue ≥ 3" — the operator vocabulary is shared with the
 *  server, so the only thing done here is punctuation.
 */
const OP_SIGN = {
  is: 'is', is_not: 'is not', contains: 'has', not_contains: 'has no',
  one_of: 'is one of', gt: '>', gte: '≥', lt: '<', lte: '≤',
  before: 'before', after: 'after', within_days: 'within',
  is_empty: 'is empty', not_empty: 'is set',
};

function stepWords(step, fieldsByKey) {
  const c = step.config || {};
  if (step.kind === 'wait') {
    const m = Number(c.minutes) || 0;
    return m >= 60 ? `wait ${Math.round(m / 60)}h` : `wait ${m}m`;
  }
  if (step.kind === 'action') {
    if (c.verb === 'notify.send') {
      const who = (c.to || [])[0] || 'someone';
      return `notify ${who.replace('@', '')}`;
    }
    if (c.verb === 'task.set_status') return `set status ${c.status || ''}`.trim();
    return c.verb || 'action';
  }
  const label = fieldsByKey?.[c.field]?.label || c.field || '';
  const op = OP_SIGN[c.operator] || c.operator || '';
  const val = Array.isArray(c.value) ? c.value.join(' / ')
            : (c.value === null || c.value === undefined || c.value === '' ? '' : String(c.value));
  const days = c.operator === 'within_days' && val ? `${val}d` : val;
  return `${label} ${op} ${days}`.replace(/\s+/g, ' ').trim();
}

/** The pipeline as chips. Reading a rule should not require opening it. */
function Flow({ steps, fieldsByKey }) {
  if (!steps?.length) return null;
  return (
    <ul className="niyam-flow">
      {steps.map((s, i) => (
        <React.Fragment key={i}>
          {i > 0 && <li className="niyam-arrow" aria-hidden="true">→</li>}
          <li>
            <span className="niyam-node" data-kind={s.kind}
                  title={`${KIND_LABEL[s.kind]}: ${stepWords(s, fieldsByKey)}`}>
              {stepWords(s, fieldsByKey)}
            </span>
          </li>
        </React.Fragment>
      ))}
    </ul>
  );
}

/** Families, in the order they appear in the product's own navigation. */
/**
 * What each family is CALLED. Not which families exist — that is the engine's
 * answer, and it is read off the catalogue below.
 *
 * ⚠ THIS LIST USED TO BE THE FAMILIES THEMSELVES, AND IT WENT STALE TWICE.
 *
 * The first time is recorded in its own comment: "the registry grew three
 * families after the first four chips shipped; a rule filed under one of these
 * was reachable only through 'Everything'." Adding the three fixed those three
 * and left the mechanism exactly as it was — so it happened again. Suite 16.02b
 * on 2026-08-31 found **4 of the engine's 11 families with no chip**:
 *
 *     esign      4 events        marketing  2 events
 *     payroll    2 events        whatsapp   1 event
 *
 * A rule about a signature, a payslip, a campaign or a WhatsApp message could
 * be built, and was then filterable only by scrolling 'Everything'.
 *
 * So the chips are DERIVED from the catalogue now. A family the engine declares
 * gets a chip on the day it is declared, whether or not anyone remembers this
 * file. A key with no label here is title-cased rather than hidden: an ugly
 * chip is a bug someone fixes, a missing chip is a feature nobody can find.
 */
const FAMILY_LABELS = {
  task:      'Tasks',
  approval:  'Approvals',
  invoice:   'Invoices',
  crm:       'Leads',
  sales:     'Sales & stock',
  hr:        'People',
  analytics: 'Alerts',
  esign:     'Signatures',
  payroll:   'Payroll',
  marketing: 'Campaigns',
  whatsapp:  'WhatsApp',
};

const titleCase = (key) =>
  key.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** 'Everything', then every family the engine actually declares.
 *
 *  Ordered by `FAMILY_LABELS`' own key order, so the chips do not reshuffle
 *  when the catalogue's event order changes; anything not named there follows,
 *  alphabetically, rather than landing wherever the registry happened to put
 *  it. Rules and templates are read as sources as well as events, because a
 *  rule can outlive the event it was filed under and must stay filterable.
 */
function familiesFrom(...lists) {
  const seen = new Set();
  lists.forEach((list) => (list || []).forEach((x) => {
    if (x?.family) seen.add(x.family);
  }));
  const known = Object.keys(FAMILY_LABELS).filter((k) => seen.has(k));
  const extra = [...seen].filter((k) => !(k in FAMILY_LABELS)).sort();
  return [
    { key: 'all', label: 'Everything' },
    ...[...known, ...extra].map((key) => ({
      key,
      label: FAMILY_LABELS[key] || titleCase(key),
    })),
  ];
}

/** A step with nothing filled in yet, per kind. */
function blankStep(kind, catalogEvent) {
  if (kind === 'condition') {
    const f = catalogEvent?.fields?.[0];
    return { kind, config: { field: f?.key || '', operator: f?.operators?.[0] || '', value: '' } };
  }
  if (kind === 'wait') return { kind, config: { minutes: 60 } };
  return { kind, config: { verb: 'notify.send', channel: 'inapp', to: ['@assignees'], title: '', body: '' } };
}

/**
 * ⚠ THE ACTION EDITOR OFFERED SIX VERBS AND COULD CONFIGURE TWO.
 *
 * `ActionCard` rendered fields for `notify.send` and `task.set_status` and
 * nothing at all for the other four. Two of those four are correct with no
 * fields — `report.send` reads everything off the schedule row the event names
 * and `validate.py` REFUSES a stray key on it, and `invoice.remind_customer`
 * takes no settings either. But an empty box says "this is broken", not "this
 * needs nothing", so they now say which.
 *
 * The other two were genuinely unbuildable from this screen (suite 16.03,
 * 2026-08-31). `validate_steps` refuses both without configuration a person
 * had no field to enter:
 *
 *     task.add_comment   "A comment needs something to say."   (body)
 *     task.create        "A task needs a title."               (title)
 *                        "Choose which project the task…"      (team_id)
 *
 * So picking either verb produced a rule that could not be saved, with an
 * error naming a field that was not on screen.
 *
 * ── THE FAILURE MODE, NOT ONLY THE FOUR INSTANCES ────────────────────────
 * `cfg.verb === '…' && (…)` is what let four verbs ship with no editor: adding
 * a verb to the engine changes nothing on this screen, and NOTHING SAYS SO —
 * the card simply renders less. The per-verb blocks stay (they are readable,
 * and each verb's fields differ too much to table), but `ActionCard` now ends
 * with a fallback that names any verb it has no branch for. A gap is then
 * visible on screen instead of looking like a verb that needs nothing.
 */
const NO_SETTINGS = 'This action takes no settings — it reads what it needs '
  + 'from the event that triggered it.';

const ACTION_HELP = {
  'report.send': NO_SETTINGS,
  'invoice.remind_customer': NO_SETTINGS,
};

/** Who a notification can name.
 *
 *  ⚠ `@org_admins` WAS MISSING AND SIX SHIPPED TEMPLATES USE IT. The engine
 *  defines it (`actions.DB_TOKENS`), resolves it against the database, and the
 *  metric-alert, stock-low, attendance-summary, invoice-paid, invoice-large
 *  and invoice-cancelled templates all notify it. Opening one of those in this
 *  editor showed a recipient dropdown whose value was not among its options —
 *  the rule said "tell the org admins" and the screen said "whoever it is
 *  assigned to". The screen was wrong, and one touch of that control made the
 *  rule agree with the screen.
 *
 *  It is also the only correct answer for the org-shaped events: a product
 *  running low and a day's attendance have no creator and no assignee, so
 *  every other token resolves to nobody.
 */
const RECIPIENTS = [
  { value: '@assignees',  label: 'whoever it is assigned to' },
  { value: '@creator',    label: 'whoever created it' },
  { value: '@org_admins', label: "the organisation's admins" },
];

export default function NiyamPage() {
  const toast = useToast();
  const [catalog, setCatalog] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [rules, setRules] = useState([]);
  const [flags, setFlags] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(true);

  const [editing, setEditing] = useState(null);   // {rule_id?, name, event_type, steps}
  const [confirmDelete, setConfirmDelete] = useState(null);   // rule_id awaiting the second press
  const [preview, setPreview] = useState(null);
  const [history, setHistory] = useState(null);
  const [fieldError, setFieldError] = useState(null);
  const [family, setFamily] = useState('all');
  const [openTemplate, setOpenTemplate] = useState(null);

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

  /** field key -> field, per event type. Labels the pipeline chips without
   *  the frontend keeping its own copy of the field list. */
  const fieldsByEvent = useMemo(() => {
    const m = {};
    (catalog?.events || []).forEach((e) => {
      m[e.event_type] = Object.fromEntries((e.fields || []).map((f) => [f.key, f]));
    });
    return m;
  }, [catalog]);

  const shown = (list) => (family === 'all' ? list : list.filter((x) => x.family === family));

  // The chips, from what the engine declares rather than from a list kept by
  // hand. Templates and rules are read too: a rule filed under a family whose
  // last event was retired still has to be findable.
  const families = useMemo(
    () => familiesFrom(catalog?.events, templates, rules),
    [catalog, templates, rules],
  );

  // A chip that has just stopped existing must not leave the page filtered to
  // nothing with no way back — that state is unreachable from the UI, which is
  // the same class of defect as the missing chip itself.
  useEffect(() => {
    if (family !== 'all' && !families.some((f) => f.key === family)) {
      setFamily('all');
    }
  }, [families, family]);

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

  async function remove(ruleId) {
    setConfirmDelete(null);
    try {
      await api.delete(`/v1/niyam/rules/${ruleId}`);
      toast.success('Rule deleted. Its run history goes with it.');
      load();
    } catch (e) { setError(e); }
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
      <ModuleHeader
        module="niyam"
        kick="section.settings"
        en="Automations"
        hi="नियम"
        sub="Rules that run themselves."
        icon={ICONS.automations}
        actions={
          <Button onClick={() => setEditing({ name: '', event_type: catalog?.events?.[0]?.event_type, steps: [] })}>
            New rule
          </Button>
        }
      />

      {/* The master switch, stated once and plainly. Every card repeats the
          consequence rather than relying on the reader remembering this. */}
      {engineDry && (
        <div className="niyam-pane niyam-master" role="status">
          <strong>Nothing is being sent.</strong> The automation engine is in dry
          run, so every rule below records what it would have done and does not
          do it. That is deliberate — it is how a rule is judged before it is
          trusted.
        </div>
      )}

      {/* The console's own figures, derived from what this page already
          loaded — proposal 65 S6's "stats strip", no second endpoint. The
          deeper numbers (events this week, per-step outcomes) live one click
          away in each rule's History — and the real analytics (trends, the
          failure rate, rules that never fired) live on Dristi's cross-module
          surface as the Automation preset, behind the door beside the strip.
          Niyam gets no analytics tab of its own (owner, 2026-08-18). */}
      {!busy && (
        <div className="niyam-striprow">
          {rules.length > 0 && (
            <dl className="niyam-strip">
              <div><dt>Rules</dt><dd>{rules.length}</dd></div>
              <div><dt>On</dt><dd>{rules.filter((r) => r.enabled).length}</dd></div>
              <div><dt>Allowed to act</dt><dd>{rules.filter((r) => r.is_armed).length}</dd></div>
              <div><dt>Runs, last 7 days</dt><dd>{rules.reduce((s, r) => s + (Number(r.runs_7d) || 0), 0)}</dd></div>
            </dl>
          )}
          <span className="niyam-striprow__sp" />
          <Link
            className="k-btn k-btn--ghost k-btn--sm"
            to="/dristi?tab=analytics&preset=automation"
            aria-label="Automation analytics, in Dristi"
            title="Rules fired, actions and failure rate — opens Dristi analytics"
          >
            {/* The same bilingual run Sanvaad's door carries — the three
                doors are one affordance and must read as one. Secondary is
                absent under EN and aria-hidden otherwise, so the aria-label
                above stays the whole accessible name. */}
            Analytics <Secondary value="विश्लेषण" /> <span aria-hidden="true">↗</span>
          </Link>
        </div>
      )}

      {/* Filter by what a rule is ABOUT. Same four families the colours
          encode, so the control and the palette teach each other. */}
      <div className="niyam-filters" role="group" aria-label="Filter by what the rule is about">
        {families.map((f) => (
          <button
            key={f.key}
            type="button"
            className="niyam-chip"
            data-family={f.key === 'all' ? undefined : f.key}
            aria-pressed={family === f.key}
            onClick={() => setFamily(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Section title="Your rules">
        {busy && <p className="niyam-muted">Loading…</p>}

        {!busy && shown(rules).length === 0 && (
          <EmptyState
            title={rules.length ? 'Nothing in this group' : 'No rules yet'}
            body={rules.length
              ? 'You have rules, just not about this. Choose Everything to see them.'
              : 'Start from one of the examples below — each is a real rule you can read before you turn it on.'}
          />
        )}

        <div className="niyam-grid">
          {shown(rules).map((r) => (
            <article className="niyam-pane niyam-card" key={r.rule_id} data-family={r.family}>
              <div className="niyam-head">
                {/* The trigger in words, never `task.status_changed`. The label
                    comes from the server beside the field list, so the picker
                    and the card cannot disagree about what a trigger is. */}
                <span className="niyam-trigger">{r.label || r.event_type}</span>
                {r.temporal && <span className="niyam-clock">on a timer</span>}
              </div>
              <h3>{r.name}</h3>

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

              <div className="niyam-actions">
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
                {/* Confirm-in-place, not a dialog: the second press is the
                    consent, and Escape-by-clicking-anywhere-else resets it.
                    The API existed all along; only this control was missing. */}
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (confirmDelete !== r.rule_id) { setConfirmDelete(r.rule_id); return; }
                    remove(r.rule_id);
                  }}
                  onBlur={() => setConfirmDelete((c) => (c === r.rule_id ? null : c))}
                >{confirmDelete === r.rule_id ? 'Really delete?' : 'Delete'}</Button>
              </div>
            </article>
          ))}
        </div>
      </Section>

      <Section title="Start from an example">
        <div className="niyam-grid">
          {shown(templates).map((t) => (
            <article className="niyam-pane niyam-card niyam-template" key={t.id} data-family={t.family}>
              <div className="niyam-head">
                <span className="niyam-trigger">{t.label || t.event_type}</span>
                {t.temporal && <span className="niyam-clock">on a timer</span>}
              </div>
              <h4>{t.name}</h4>
              <p className="niyam-why">{t.why}</p>

              {/* Read the rule BEFORE cloning it. A template you have to accept
                  in order to inspect is a template nobody reads. */}
              <button
                type="button"
                className="niyam-disclose"
                aria-expanded={openTemplate === t.id}
                onClick={() => setOpenTemplate(openTemplate === t.id ? null : t.id)}
              >
                {openTemplate === t.id ? 'Hide what it does' : 'See what it does'}
              </button>
              {openTemplate === t.id && (
                <Flow steps={t.steps} fieldsByKey={fieldsByEvent[t.event_type]} />
              )}

              <div className="niyam-actions">
                <Button variant="ghost" onClick={() => cloneTemplate(t.id)}>Use this</Button>
              </div>
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
    <div className="niyam-pane niyam-editor">
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
        // The trigger is the rule's identity — the API's PATCH deliberately
        // has no event_type field, and this control used to offer a change it
        // then silently threw away. Locked when editing; the honest path to a
        // different trigger is a new rule.
        disabled={Boolean(editing.rule_id)}
        title={editing.rule_id
          ? 'A rule’s trigger cannot change — its conditions are written against this event’s fields. Build a new rule for a different trigger.'
          : undefined}
      >
        {(catalog?.events || []).map((ev) => (
          // The label, not the dotted type — the server serves both precisely
          // so no screen has to show `task.status_changed` to a human.
          <option key={ev.event_type} value={ev.event_type}>{ev.label || ev.event_type}</option>
        ))}
      </Select>
      {Boolean(editing.rule_id) && (
        <p className="niyam-muted">
          The trigger is fixed once a rule exists. To react to something else,
          build a new rule.
        </p>
      )}

      <ol className="niyam-steps" data-family={currentEvent?.family}>
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
        aria-label="Condition field"
        /* aria-label, not a visible caption: these three read as ONE
           sentence — [field] [operator] [value] — and a stacked label
           above each would break the line they are meant to form.
           Suite 16.02c: all ten editor controls had no name at all. */
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
        aria-label="Condition operator"
        value={step.config.operator}
        onChange={(e) => onChange({ ...step.config, operator: e.target.value })}
      >
        {operators.map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
      </Select>

      {needsValue && (field?.options?.length ? (
        <Select
          aria-label="Condition value"
          value={step.config.value ?? ''}
          onChange={(e) => onChange({ ...step.config, value: e.target.value })}
        >
          <option value="">Choose…</option>
          {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </Select>
      ) : (
        <Input
          aria-label="Condition value"
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
  const set = (patch) => onChange({ ...cfg, ...patch });

  // Switching verb must not carry the old verb's keys across. `report.send`
  // refuses a stray key outright ("report.send takes no settings — remove: …"),
  // so a rule that had been a notification and was changed to a report send was
  // unsaveable with an error about a field the author could no longer see.
  const setVerb = (verb) => onChange(
    verb === cfg.verb ? { ...cfg, verb } : { ...blankStep('action').config, verb },
  );

  const known = new Set(['notify.send', 'task.set_status',
                         'task.create', 'task.add_comment',
                         'report.send', 'invoice.remind_customer']);

  return (
    <div className="niyam-action">
      <Select aria-label="What this rule does" value={cfg.verb}
              onChange={(e) => setVerb(e.target.value)}>
        {(catalog?.actions || []).map((a) => <option key={a} value={a}>{a}</option>)}
      </Select>

      {cfg.verb === 'notify.send' && (
        <>
          <Select
            label="Who is notified"
            value={(cfg.to || [])[0] || '@assignees'}
            onChange={(e) => set({ to: [e.target.value] })}
          >
            {/* Stored as a QUESTION, not a person: the answer differs for every
                event, and "tell whoever asked for it" is meaningless as an id. */}
            {RECIPIENTS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </Select>
          {/* ⚠ THE CHANNEL WAS HARDCODED `inapp` IN `blankStep` AND HAD NO
              CONTROL, so no rule built on this screen could ever send an email
              or a push — `send.CHANNELS` has carried all three since email
              graduated on 2026-08-18, and `PLANNED_CHANNELS` is now empty.
              It is also why quiet hours had no drivable path: they apply to the
              channels that INTERRUPT, and in-app is deliberately exempt (it is
              a row in a list, not a thing that wakes anyone), so every rule the
              UI could build was exempt by construction. */}
          <Select
            label="How"
            value={cfg.channel || 'inapp'}
            onChange={(e) => set({ channel: e.target.value })}
            hint="Push and email respect the org's quiet hours. In-app does not
                  — it waits in the list rather than interrupting."
          >
            <option value="inapp">in the app</option>
            <option value="push">as a push notification</option>
            <option value="email">by email</option>
          </Select>
          <Input label="Title" value={cfg.title || ''}
            onChange={(e) => set({ title: e.target.value })} />
          <Input label="Message" value={cfg.body || ''}
            onChange={(e) => set({ body: e.target.value })} />
        </>
      )}

      {cfg.verb === 'task.set_status' && (
        <Input label="Set status to" value={cfg.status || ''}
          onChange={(e) => set({ status: e.target.value })} />
      )}

      {cfg.verb === 'task.create' && (
        <>
          <Input label="Task title" value={cfg.title || ''}
            onChange={(e) => set({ title: e.target.value })} />
          {/* `validate.py` REQUIRES this: "Most events belong to no team, so
              the target cannot come from the event — the rule must name where
              the task goes." Without the field the verb was unsaveable. */}
          <Select
            label="In which project"
            value={cfg.team_id || ''}
            onChange={(e) => set({ team_id: e.target.value })}
          >
            <option value="">Choose a project…</option>
            {(catalog?.teams || []).map((t) => (
              <option key={t.team_id} value={t.team_id}>{t.name}</option>
            ))}
          </Select>
          <Textarea label="Description" value={cfg.description || ''}
            onChange={(e) => set({ description: e.target.value })} />
          <Select label="Priority" value={cfg.priority || 'medium'}
                  onChange={(e) => set({ priority: e.target.value })}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </Select>
        </>
      )}

      {cfg.verb === 'task.add_comment' && (
        <Textarea label="Comment" value={cfg.body || ''}
          onChange={(e) => set({ body: e.target.value })} />
      )}

      {/* The two that genuinely need nothing SAY so. An empty card reads as a
          broken screen, and a person who has just picked a verb deserves to
          know they are already finished. */}
      {ACTION_HELP[cfg.verb] && (
        <p className="niyam-muted">{ACTION_HELP[cfg.verb]}</p>
      )}

      {/* A verb the engine has grown and this editor has not. Says so rather
          than rendering nothing — the failure mode this whole card was fixed
          for. */}
      {cfg.verb && !known.has(cfg.verb) && (
        <p className="niyam-muted">
          This action has no settings on this screen yet. It may need
          configuration the rule cannot be saved without.
        </p>
      )}
    </div>
  );
}

/* ── preview and history ────────────────────────────────────────────────── */

function PreviewPanel({ preview, onClose }) {
  return (
    <div className="niyam-pane niyam-panel">
      <header><h2>What this rule would have done</h2>
        <Button variant="ghost" onClick={onClose}>Close</Button></header>

      {preview.loading ? <p className="niyam-muted">Replaying recent events…</p> : (
        <>
          {/* The server writes this sentence, because "0 of 0" reads like a
              broken rule when it actually means "nothing has happened yet". */}
          <p className="niyam-verdict">{preview.note}</p>

          {/* What a match WOULD trigger — the server sent this all along and
              the panel never drew it, so "matched" answered half the question. */}
          {(preview.would_do || []).length > 0 && (
            <p className="niyam-muted">
              On a match this rule would:{' '}
              {preview.would_do.map((a) => a.verb).filter(Boolean).join(', ')}.
            </p>
          )}

          <p className="niyam-muted">
            This changed nothing. No messages were sent and no runs were recorded.
          </p>

          <ul className="niyam-sample">
            {(preview.sample || []).map((s) => (
              <li key={s.event_id} className={`is-${s.outcome}`}>
                <span className="niyam-when">{new Date(s.occurred_at).toLocaleString()}</span>
                <span className="niyam-outcome">{s.outcome}</span>
                <span className="niyam-reason">{s.reason}</span>
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
    <div className="niyam-pane niyam-panel">
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
                        <span className="niyam-reason">
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
