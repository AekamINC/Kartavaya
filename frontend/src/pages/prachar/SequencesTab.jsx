// Sequences — multi-step outreach.
//
// This tab was wrong in four ways that all shipped:
//
//  1 · `POST /sequences` was sent `{name, channel, status}`. `SequenceCreate`
//      (prachar.py:687) is `{name, description, exit_on_reply}` — Pydantic
//      dropped `channel` and `status` silently, and `exit_on_reply`, which
//      decides whether a contact who REPLIES keeps receiving the drip, was
//      never settable. Defaulting to true saved it; nobody could see or change
//      it.
//  2 · The list then rendered `{s.channel}` under every sequence name — a
//      column that does not exist on `prachar_sequences`, so every row read
//      "undefined". The columns that DO exist and matter — `step_count` and
//      `active_enrollments`, both computed by the list route — were unused.
//  3 · `setSequences(r.data || r)` set the state to `{data: [...]}`, so
//      `sequences.map` threw and the tab rendered blank.
//  4 · The step form offered SMS. `add_step` validates against
//      ("email","whatsapp","call_task","manual") and 400s on anything else, so
//      "Add step" with SMS selected always failed.
//
// Enrolment was a text box asking the user to type comma-separated contact
// UUIDs. It is now a picker over `/v1/graha/contacts`.
import React, { useState } from 'react';
import { Badge, BackButton } from '../../components/editorial';
import { useToast } from '../../components/ui/toast';
import useModuleWrite from '../../hooks/useModuleWrite';
import { api, rows, body, Panel, Bar, useResource, useMutate, SEQ_COLORS, STEP_CHANNELS, humanise, plural, pct, DataTable, Td } from './_shared';

export default function SequencesTab({ onChanged }) {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change campaigns' });
  const { pushToast } = useToast();
  const { busy, go } = useMutate(pushToast);
  const [form, setForm] = useState(null);
  const [openId, setOpenId] = useState(null);

  const { data, loading, error, reload } = useResource(
    () => api.get('/v1/prachar/sequences').then(rows), [],
  );
  const list = data || [];

  const refresh = () => { reload(); onChanged?.(); };

  const save = async () => {
    if (!form.name.trim()) return pushToast({ type: 'error', title: 'A sequence needs a name.' });
    const r = await go(
      () => api.post('/v1/prachar/sequences', {
        name: form.name.trim(),
        description: form.description,
        exit_on_reply: form.exit_on_reply,
      }),
      'Sequence created',
    );
    if (r.ok) { setForm(null); refresh(); }
    return undefined;
  };

  if (openId) {
    return (
      <SequenceDetail
        seq={list.find((s) => s.id === openId) || { id: openId }}
        onBack={() => { setOpenId(null); refresh(); }}
      />
    );
  }

  if (form) {
    return (
      <div>
        <BackButton onClick={() => setForm(null)} label="Back to sequences" />
        <div className="k-formpanel">
          <h3 className="pr__form-t">New sequence</h3>
          <label className="k-formpanel__label">Sequence name
            <input
              className="k-formpanel__input"
              placeholder="e.g. Onboarding drip"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label className="k-formpanel__label">What it is for
            <textarea
              className="k-formpanel__input"
              rows={3}
              placeholder="Optional. Why a contact would be enrolled in this."
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </label>
          {/* The field that was unreachable. It changes what happens to a
              person who writes back, which is the single most consequential
              setting on a drip sequence. */}
          <label className="k-formpanel__label pr__check">
            <input
              type="checkbox"
              checked={form.exit_on_reply}
              onChange={(e) => setForm({ ...form, exit_on_reply: e.target.checked })}
            />
            Stop sending to a contact once they reply
          </label>
          <div className="k-formpanel__actions">
            <button type="button" className="k-btn k-btn--primary k-btn--sm" onClick={save} disabled={busy || !canWrite} title={denial || undefined}>
              {busy ? 'Creating…' : 'Create sequence'}
            </button>
            <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Bar title="Sequences" hi="क्रम">
        <button
          type="button"
          className="k-btn k-btn--primary k-btn--sm"
          onClick={() => setForm({ name: '', description: '', exit_on_reply: true })}
          disabled={!canWrite} title={denial || undefined}>
          + New sequence
        </button>
      </Bar>

      <Panel
        loading={loading}
        error={error}
        onRetry={reload}
        empty={list.length === 0}
        emptyProps={{
          icon: '🔄',
          title: 'No sequences yet',
          sub: 'A sequence sends a ladder of messages spaced days apart, and stops when the contact replies.',
          // F32. A CTA in an object literal rather than a JSX attribute, which
          // is why the static sweep walked past it and only the browser found it.
          cta: canWrite ? '+ New sequence' : undefined,
          onCta: canWrite ? () => setForm({ name: '', description: '', exit_on_reply: true }) : undefined,
        }}
        count={4}
      >
        <DataTable arrange="prachar.sequences" columns={[
          'Name', 'Status',
          { label: 'Steps', align: 'right' },
          { label: 'Active', align: 'right' },
          'On reply', '',
        ]}>
          {list.map((s) => (
            <tr key={s.id}>
              <td>
                <strong>{s.name}</strong>
                {s.description && <div className="pr__step-when">{s.description}</div>}
              </td>
              <td><Badge text={humanise(s.status)} color={SEQ_COLORS[s.status]} /></td>
              <Td align="right" mono>{Number(s.step_count || 0)}</Td>
              <Td align="right" mono>{Number(s.active_enrollments || 0)}</Td>
              <td className="pr__step-when">{s.exit_on_reply ? 'Stops' : 'Keeps sending'}</td>
              <td>
                <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={() => setOpenId(s.id)}>
                  Open
                </button>
              </td>
            </tr>
          ))}
        </DataTable>
      </Panel>
    </div>
  );
}

/* ── Detail ───────────────────────────────────────────────────────────── */

function SequenceDetail({ seq, onBack }) {
  // F32 — this component owns its own write controls, so it asks
  // the same question rather than taking the answer as a prop.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change campaigns' });
  const { pushToast } = useToast();
  const { busy, go } = useMutate(pushToast);
  const [stepForm, setStepForm] = useState(null);
  const [picked, setPicked] = useState([]);

  const full = useResource(() => api.get(`/v1/prachar/sequences/${seq.id}`).then(body), [seq.id]);
  const stats = useResource(() => api.get(`/v1/prachar/sequences/${seq.id}/stats`).then(body), [seq.id]);
  // The contact list for the enroller. It is allowed to fail without taking the
  // sequence down — you can still read the steps with no CRM access.
  const contacts = useResource(() => api.get('/v1/graha/contacts').then(rows), []);

  const s = full.data?.sequence || seq;
  const steps = full.data?.steps || [];
  const totals = stats.data?.totals || {};
  const stepStats = stats.data?.steps || [];
  const enrolled = Number(totals.total || 0);

  const reloadAll = () => { full.reload(); stats.reload(); };

  const addStep = async () => {
    if (!stepForm.subject.trim() && stepForm.channel !== 'call_task' && stepForm.channel !== 'manual') {
      return pushToast({ type: 'error', title: 'An email or WhatsApp step needs a subject.' });
    }
    const r = await go(
      () => api.post(`/v1/prachar/sequences/${seq.id}/steps`, {
        step_order: Number(stepForm.step_order),
        channel: stepForm.channel,
        delay_days: Number(stepForm.delay_days),
        subject: stepForm.subject,
        body_html: stepForm.body_html,
        notes: stepForm.notes,
      }),
      'Step saved',
    );
    if (r.ok) { setStepForm(null); reloadAll(); }
    return undefined;
  };

  const removeStep = async (order) => {
    const r = await go(() => api.delete(`/v1/prachar/sequences/${seq.id}/steps/${order}`), 'Step removed');
    if (r.ok) reloadAll();
  };

  const enroll = async () => {
    if (!picked.length) return pushToast({ type: 'error', title: 'Choose at least one contact.' });
    const r = await go(
      () => api.post(`/v1/prachar/sequences/${seq.id}/enroll`, { contact_ids: picked }).then(body),
      null,
    );
    if (r.ok) {
      const out = r.out || {};
      // `rejected` is contacts the server refused because they belong to another
      // org. Reporting only the successes would leave the user wondering where
      // the rest went.
      //
      // `will_send` is the harder one. "20 contacts enrolled" was the whole of
      // the reported defect: it is TRUE — the rows are written and the table
      // draws them — and it was read as "20 people will be emailed", which was
      // false for two separate reasons. One of them is fixed behind this screen;
      // the other is that you can enrol into a sequence that is still a draft,
      // and a draft sends nothing to anybody. Say so at the moment it matters
      // rather than leaving the Enrolled table to imply otherwise.
      const notes = [];
      if (out.rejected) notes.push(`${out.rejected} were not yours and were skipped.`);
      if (out.will_send === false) {
        notes.push(`This sequence is ${humanise(out.sequence_status || 'not active').toLowerCase()}, so no messages will go out until you activate it.`);
      }
      pushToast({
        type: out.will_send === false ? 'info' : 'success',
        title: `${plural(out.enrolled || 0, 'contact')} enrolled`,
        message: notes.join(' '),
      });
      setPicked([]);
      reloadAll();
    }
    return undefined;
  };

  const pause = async () => {
    const r = await go(() => api.post(`/v1/prachar/sequences/${seq.id}/pause`), 'Sequence paused');
    if (r.ok) reloadAll();
  };

  const setStatus = async (status) => {
    const r = await go(() => api.patch(`/v1/prachar/sequences/${seq.id}`, { status }), `Sequence ${status}`);
    if (r.ok) reloadAll();
  };

  const statById = Object.fromEntries(stepStats.map((x) => [x.step_order, x]));

  return (
    <div>
      <BackButton onClick={onBack} label="Back to sequences" />

      <Panel loading={full.loading} error={full.error} onRetry={full.reload} count={3}>
        <div className="k-detail">
          <div className="k-detail__header">
            <div>
              <h3 className="k-detail__title">{s.name}</h3>
              <p className="k-detail__sub">
                {s.description || 'No description'} · {s.exit_on_reply ? 'stops on reply' : 'keeps sending after a reply'}
              </p>
            </div>
            <Badge text={humanise(s.status)} color={SEQ_COLORS[s.status]} />
          </div>
          <div className="k-detail__actions">
            {s.status !== 'active' && steps.length > 0 && (
              <button type="button" className="k-btn k-btn--primary k-btn--sm" onClick={() => setStatus('active')} disabled={busy || !canWrite} title={denial || undefined}>
                Activate
              </button>
            )}
            {s.status === 'active' && (
              <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={pause} disabled={busy}>
                Pause
              </button>
            )}
            {s.status !== 'archived' && (
              <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={() => setStatus('archived')} disabled={busy}>
                Archive
              </button>
            )}
          </div>
        </div>
      </Panel>

      <Bar title="Enrolment" hi="नामांकन" />
      <Panel
        loading={stats.loading}
        error={stats.error}
        onRetry={stats.reload}
        empty={enrolled === 0}
        emptyProps={{
          icon: '👥',
          title: 'Nobody is enrolled yet',
          sub: 'Add contacts below and they start at step one after its delay.',
        }}
        count={2}
      >
        <DataTable columns={['Outcome', { label: 'Contacts', align: 'right' }, { label: 'Share', align: 'right' }]}>
          {[
            ['Active', totals.active], ['Completed', totals.completed], ['Replied', totals.replied],
            ['Bounced', totals.bounced], ['Unsubscribed', totals.unsubscribed],
          ].map(([label, n]) => (
            <tr key={label}>
              <td>{label}</td>
              <Td align="right" mono>{Number(n || 0)}</Td>
              <Td align="right" mono>{pct(Number(n || 0), enrolled)}</Td>
            </tr>
          ))}
        </DataTable>
      </Panel>

      <Bar title="Steps" hi="चरण">
        {!stepForm && (
          <button
            type="button"
            className="k-btn k-btn--primary k-btn--sm"
            onClick={() => setStepForm({
              step_order: steps.length + 1, channel: 'email', delay_days: 1,
              subject: '', body_html: '', notes: '',
            })}
          disabled={!canWrite} title={denial || undefined}>
            + Add step
          </button>
        )}
      </Bar>

      <Panel
        loading={full.loading}
        error={full.error}
        onRetry={full.reload}
        empty={steps.length === 0 && !stepForm}
        emptyProps={{
          icon: '📋',
          title: 'This sequence has no steps',
          sub: 'A sequence with no steps sends nothing. Add the first message and the delay before it goes out.',
        }}
        count={3}
      >
        <div className="pr__steps">
          {steps.map((st, i) => {
            const t = statById[st.step_order] || {};
            return (
              <div className="pr__step" key={st.id || st.step_order}>
                <div className="pr__step-rail">
                  <span className="pr__step-n">{st.step_order}</span>
                  {i < steps.length - 1 && <span className="pr__step-line" />}
                </div>
                <div className="pr__step-b">
                  <div className="pr__step-t">{st.subject || humanise(st.channel)}</div>
                  <div className="pr__step-when">
                    {humanise(st.channel)} · {st.delay_days === 0 ? 'immediately' : `after ${plural(st.delay_days, 'day')}`}
                  </div>
                  <div className="pr__meta">
                    <span>{plural(Number(t.total_sent || 0), 'send')}</span>
                    <span>{Number(t.opened || 0)} opened</span>
                    <span>{Number(t.replied || 0)} replied</span>
                    {Number(t.bounced || 0) > 0 && (
                      <span className="tag" style={{ '--c': 'var(--danger)' }}>{t.bounced} bounced</span>
                    )}
                    <button type="button" className="pr__del pr__meta-end" onClick={() => removeStep(st.step_order)} disabled={busy}>
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      {stepForm && (
        <div className="k-formpanel">
          <h3 className="pr__form-t">Step {stepForm.step_order}</h3>
          <div className="k-formpanel__grid k-formpanel__grid--3">
            <label className="k-formpanel__label">Position
              <input className="k-formpanel__input" type="number" min="1" value={stepForm.step_order}
                onChange={(e) => setStepForm({ ...stepForm, step_order: e.target.value })} />
            </label>
            <label className="k-formpanel__label">Wait before sending
              <input className="k-formpanel__input" type="number" min="0" value={stepForm.delay_days}
                onChange={(e) => setStepForm({ ...stepForm, delay_days: e.target.value })} />
            </label>
            <label className="k-formpanel__label">Channel
              <select className="k-formpanel__input" value={stepForm.channel}
                onChange={(e) => setStepForm({ ...stepForm, channel: e.target.value })}>
                {STEP_CHANNELS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
          </div>
          <label className="k-formpanel__label">Subject
            <input className="k-formpanel__input" placeholder="Subject of this message" value={stepForm.subject}
              onChange={(e) => setStepForm({ ...stepForm, subject: e.target.value })} />
          </label>
          <label className="k-formpanel__label">Body
            <textarea className="k-formpanel__input" rows={5} value={stepForm.body_html}
              onChange={(e) => setStepForm({ ...stepForm, body_html: e.target.value })} />
          </label>
          <p className="pr__step-when">
            Saving over an existing position replaces that step rather than adding a second one at the same number.
          </p>
          <div className="k-formpanel__actions">
            <button type="button" className="k-btn k-btn--primary k-btn--sm" onClick={addStep} disabled={busy || !canWrite} title={denial || undefined}>
              {busy ? 'Saving…' : 'Save step'}
            </button>
            <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={() => setStepForm(null)}>Cancel</button>
          </div>
        </div>
      )}

      <Bar title="Add contacts" hi="संपर्क जोड़ें" />
      <Panel
        loading={contacts.loading}
        error={contacts.error}
        onRetry={contacts.reload}
        empty={(contacts.data || []).length === 0}
        emptyProps={{
          icon: '👤',
          title: 'No contacts to enrol',
          sub: 'Sequences draw from your CRM contacts. Add contacts in CRM first.',
        }}
        count={2}
      >
        <div className="pr__inline">
          {/* Was a text input asking for "Comma-separated contact IDs" — a
              request to copy UUIDs out of a database by hand. */}
          <select
            multiple
            size={6}
            className="k-formpanel__input pr__grow"
            aria-label="Contacts to enrol"
            value={picked}
            onChange={(e) => setPicked([...e.target.selectedOptions].map((o) => o.value))}
          >
            {(contacts.data || []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.email ? ` · ${p.email}` : ' · no email'}
              </option>
            ))}
          </select>
          <button type="button" className="k-btn k-btn--primary k-btn--sm" onClick={enroll} disabled={busy || !picked.length || !canWrite} title={denial || undefined}>
            {picked.length ? `Enrol ${plural(picked.length, 'contact')}` : 'Enrol'}
          </button>
        </div>
      </Panel>

      <Bar title="Enrolled" hi="नामांकित" />
      <Panel
        loading={full.loading}
        error={full.error}
        onRetry={full.reload}
        empty={(full.data?.enrollments || []).length === 0}
        emptyProps={{ icon: '👥', title: 'Nobody enrolled yet', sub: 'Contacts you add appear here with the step they are on.' }}
        count={3}
      >
        <DataTable arrange="prachar.sequence_enrollments" columns={['Contact', 'Email', { label: 'Step', align: 'right' }, 'Status', 'Next message']}>
          {(full.data?.enrollments || []).map((e) => (
            <tr key={e.id}>
              <Td bold>{e.contact_name}</Td>
              <td>{e.contact_email || '—'}</td>
              <Td align="right" mono>{e.current_step}</Td>
              <td><Badge text={humanise(e.status)} color={SEQ_COLORS[e.status] || 'var(--on-surface-3)'} /></td>
              <td className="pr__step-when">
                {e.status === 'active' && e.next_step_at
                  ? new Date(e.next_step_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
                  : '—'}
              </td>
            </tr>
          ))}
        </DataTable>
      </Panel>
    </div>
  );
}
