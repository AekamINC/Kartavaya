// Automations — a trigger, and the thing it does.
//
// ── THIS COMPONENT IS DELIBERATELY NOT MOUNTED ─────────────────────────────
//
// `PracharPage.jsx` no longer lists it in TABS, and `POST
// /v1/prachar/automations` answers 501. Nothing in the backend fires a Prachar
// automation: the seven trigger names below — contact_created,
// contact_converted, deal_won, deal_lost, label_added, score_above, manual —
// appear nowhere in `backend/` except the five CRUD statements that store them.
// A row created here would sit with `run_count` at 0 for ever, under a form
// whose own note promises it "will run when …".
//
// Graha's automations are a different system that genuinely does fire, over a
// different table with a different trigger vocabulary, so this cannot be fixed
// by pointing one at the other. Six of the seven triggers above are CRM events,
// which means building this is new call sites inside Graha.
//
// The file is kept because it is the screen this feature needs on the day that
// engine exists, and because `staging.prachar_automations` holds 0 rows — there
// was nothing to migrate and there is nothing to lose. To bring it back: build
// the engine, lift the 501, re-add `['automations', AutomationsTab]` to TABS
// and restore the `automations` entry in that file's `counts`.
//
// ── Three defects carried over from the single-file version ────────────────
//
//  · `setAutomations(r.data)` on a `{"data": [...]}` body, so `.map` threw and
//    the tab was blank for anyone who had automations. Fixed by `rows()`.
//  · `PATCH /automations/{id}` accepts `is_active`, and the list rendered
//    `is_active` nowhere and offered no way to set it. The only control was a
//    bare "Delete" — so pausing an automation meant destroying it and typing it
//    in again.
//  · `save()` was an unguarded `await api.post(...)`. A validation failure left
//    the panel open with no message.
import React, { useState } from 'react';
import { Badge, BackButton } from '../../components/editorial';
import { useToast } from '../../components/ui/toast';
import { api, rows, Panel, Bar, useResource, useMutate, humanise, plural, DataTable, Td } from './_shared';
import useModuleWrite from '../../hooks/useModuleWrite';

// The enums `prachar.py` writes. Each carries the sentence that says what it
// actually does — "Score above" is not self-explanatory to the person choosing
// it, and a dropdown of raw enum values is a quiz.
const TRIGGERS = [
  ['contact_created', 'A contact is created', 'Fires once, when the contact first appears in CRM.'],
  ['contact_converted', 'A contact converts', 'Fires when a lead becomes a customer.'],
  ['deal_won', 'A deal is won', 'Fires on the deal moving to Won.'],
  ['deal_lost', 'A deal is lost', 'Fires on the deal moving to Lost.'],
  ['label_added', 'A label is added', 'Fires each time that label is attached.'],
  ['score_above', 'Lead score crosses a threshold', 'Fires once per contact, on the crossing.'],
  ['manual', 'Someone runs it by hand', 'Never fires on its own.'],
];

const ACTIONS = [
  ['send_email', 'Send an email', 'Uses the template you pick.'],
  ['add_label', 'Add a label', 'Tags the contact in CRM.'],
  ['update_score', 'Change the lead score', 'Adds to or subtracts from the score.'],
  ['create_follow_up', 'Create a follow-up', 'Puts a dated task on the owner’s list.'],
  ['notify_owner', 'Notify the owner', 'Sends the record’s owner a notification.'],
];

const label = (pairs, id) => pairs.find((p) => p[0] === id)?.[1] || humanise(id);
const why = (pairs, id) => pairs.find((p) => p[0] === id)?.[2] || '';

export default function AutomationsTab({ onChanged }) {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change campaigns' });
  const { pushToast } = useToast();
  const { busy, go } = useMutate(pushToast);
  const [form, setForm] = useState(null);

  const { data, loading, error, reload } = useResource(
    () => api.get('/v1/prachar/automations').then(rows), [],
  );
  const list = data || [];
  const refresh = () => { reload(); onChanged?.(); };

  const save = async () => {
    if (!form.name.trim()) return pushToast({ type: 'error', title: 'An automation needs a name.' });
    const r = await go(
      () => api.post('/v1/prachar/automations', {
        name: form.name.trim(),
        trigger_type: form.trigger_type,
        trigger_config: {},
        action_type: form.action_type,
        action_config: {},
        is_active: form.is_active,
      }),
      'Automation created',
    );
    if (r.ok) { setForm(null); refresh(); }
    return undefined;
  };

  const toggle = async (a) => {
    const r = await go(
      () => api.patch(`/v1/prachar/automations/${a.id}`, { is_active: !a.is_active }),
      a.is_active ? `"${a.name}" paused` : `"${a.name}" resumed`,
    );
    if (r.ok) refresh();
  };

  const remove = async (a) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete "${a.name}"? Pausing it keeps the run history; deleting does not.`)) return;
    const r = await go(() => api.delete(`/v1/prachar/automations/${a.id}`), 'Automation deleted');
    if (r.ok) refresh();
  };

  if (form) {
    return (
      <div>
        <BackButton onClick={() => setForm(null)} label="Back to automations" />
        <div className="k-formpanel">
          <h3 className="pr__form-t">New automation</h3>
          <label className="k-formpanel__label">Name
            <input
              className="k-formpanel__input"
              placeholder="e.g. Welcome new leads"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <div className="k-formpanel__grid k-formpanel__grid--2">
            <label className="k-formpanel__label">When this happens
              <select className="k-formpanel__input" value={form.trigger_type}
                onChange={(e) => setForm({ ...form, trigger_type: e.target.value })}>
                {TRIGGERS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}
              </select>
            </label>
            <label className="k-formpanel__label">Do this
              <select className="k-formpanel__input" value={form.action_type}
                onChange={(e) => setForm({ ...form, action_type: e.target.value })}>
                {ACTIONS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}
              </select>
            </label>
          </div>

          {/* The rule, read back as one sentence before it is saved. An
              automation is the one object here that runs without anybody
              watching, so it has to be legible before it is created. */}
          <p className="note note--info pr__note">
            <b>{form.name.trim() || 'This automation'}</b> will run when{' '}
            <b>{label(TRIGGERS, form.trigger_type).toLowerCase()}</b>, and will{' '}
            <b>{label(ACTIONS, form.action_type).toLowerCase()}</b>.{' '}
            {why(TRIGGERS, form.trigger_type)}
          </p>

          <label className="k-formpanel__label pr__check">
            <input type="checkbox" checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
            Start running immediately
          </label>

          <div className="k-formpanel__actions">
            <button type="button" className="k-btn k-btn--primary k-btn--sm" onClick={save} disabled={busy || !canWrite} title={denial || undefined}>
              {busy ? 'Creating…' : 'Create automation'}
            </button>
            <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Bar title="Automations" hi="स्वचालन">
        <button
          type="button"
          className="k-btn k-btn--primary k-btn--sm"
          onClick={() => setForm({
            name: '', trigger_type: 'contact_created', action_type: 'send_email', is_active: true,
          })}
          disabled={!canWrite} title={denial || undefined}>
          + New automation
        </button>
      </Bar>

      <Panel
        loading={loading}
        error={error}
        onRetry={reload}
        empty={list.length === 0}
        emptyProps={{
          icon: '⚡',
          title: 'No automations yet',
          sub: 'An automation watches for something happening in CRM and responds without anyone pressing anything.',
          // F32. A CTA in an object literal rather than a JSX attribute, which
          // is why the static sweep walked past it and only the browser found it.
          cta: canWrite ? '+ New automation' : undefined,
          onCta: canWrite ? () => setForm({ name: '', trigger_type: 'contact_created', action_type: 'send_email', is_active: true }) : undefined,
        }}
        count={3}
      >
        <DataTable arrange="prachar.automations" columns={['Name', 'When', 'Then', { label: 'Runs', align: 'right' }, 'State', '']}>
          {list.map((a) => (
            <tr key={a.id}>
              <Td bold>{a.name}</Td>
              <td>{label(TRIGGERS, a.trigger_type)}</td>
              <td>{label(ACTIONS, a.action_type)}</td>
              <Td align="right" mono>{Number(a.run_count || 0)}</Td>
              <td>
                <Badge
                  text={a.is_active ? 'Running' : 'Paused'}
                  color={a.is_active ? 'var(--ok)' : 'var(--on-surface-3)'}
                />
              </td>
              <td>
                <div className="pr__rowact">
                  <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={() => toggle(a)} disabled={busy}>
                    {a.is_active ? 'Pause' : 'Resume'}
                  </button>
                  <button type="button" className="pr__del" onClick={() => remove(a)} disabled={busy}>Delete</button>
                </div>
              </td>
            </tr>
          ))}
        </DataTable>

        <p className="pr__step-when">
          {plural(list.filter((a) => a.is_active).length, 'automation')} running of {list.length}.
        </p>
      </Panel>
    </div>
  );
}
