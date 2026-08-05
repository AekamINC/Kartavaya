/**
 * ActionConfigFields — the inputs for ONE automation action.
 *
 * Split out of AutomationsPage.jsx because the shape of this form is the fix.
 * The page used to render a single text box for every action type and relabel
 * it ("Target status", "User email", "Field value", "Message"), then fold
 * whatever was typed into one of three config keys. The engine reads six
 * different sets of keys, and three of the actions need more than one value —
 * so the old form could not have produced a working config for them however
 * the key names were spelled. Each action now collects exactly the keys
 * backend/services/automation_engine.py reads for it, named identically.
 *
 * The pickers degrade rather than block: if the members or fields fetch failed
 * the control falls back to a text input, because a builder that cannot be used
 * at all is worse than one that asks you to paste an id.
 */
import React from 'react';
import { Field, Input, Select, Textarea } from '../../components/ui/Field';

/** <select multiple> → array of values, which is what `user_ids` is. */
const pickMany = (e) => Array.from(e.target.selectedOptions).map(o => o.value);

function UserPicker({ id, label, hint, members, value, onChange }) {
  const selected = Array.isArray(value) ? value : [];
  if (members.length === 0) {
    return (
      <Field label={label} htmlFor={id} required hint="Comma-separated user ids — the project member list could not be loaded.">
        <Input
          id={id}
          value={selected.join(', ')}
          placeholder="usr_abc123, usr_def456"
          onChange={e => onChange(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
        />
      </Field>
    );
  }
  return (
    <Field label={label} htmlFor={id} required hint={hint}>
      <select
        id={id}
        multiple
        className="inp aut-multi"
        value={selected}
        onChange={e => onChange(pickMany(e))}
      >
        {members.map(m => (
          <option key={m.user_id} value={m.user_id}>{m.display_name || m.email || m.user_id}</option>
        ))}
      </select>
    </Field>
  );
}

export default function ActionConfigFields({ actionType, config = {}, members = [], fields = [], onChange }) {
  const set = (key) => (e) => onChange({ [key]: e.target.value });

  if (actionType === 'send_email') {
    return (
      <>
        <div className="aut-grid3">
          <Field label="To" htmlFor="aut-cfg-to" required
                 hint="Must be a member of this project — the engine refuses to send anywhere else.">
            {members.length > 0 ? (
              <Select id="aut-cfg-to" value={config.to || ''} onChange={set('to')}>
                <option value="">Select a recipient…</option>
                {members.filter(m => m.email).map(m => (
                  <option key={m.user_id} value={m.email}>{m.display_name || m.email}</option>
                ))}
              </Select>
            ) : (
              <Input id="aut-cfg-to" value={config.to || ''} placeholder="name@example.com" onChange={set('to')} />
            )}
          </Field>
          <Field label="Subject" htmlFor="aut-cfg-subject">
            <Input id="aut-cfg-subject" value={config.subject || ''} placeholder="Kartavaya notification" onChange={set('subject')} />
          </Field>
        </div>
        <Field label="Body" htmlFor="aut-cfg-html">
          <Textarea id="aut-cfg-html" rows={3} value={config.html || ''} placeholder="Message body…" onChange={set('html')} />
        </Field>
      </>
    );
  }

  if (actionType === 'send_notification') {
    return (
      <>
        <UserPicker
          id="aut-cfg-users"
          label="Notify"
          hint="Hold Ctrl (Cmd on Mac) to pick more than one."
          members={members}
          value={config.user_ids}
          onChange={v => onChange({ user_ids: v })}
        />
        <div className="aut-grid3">
          <Field label="Title" htmlFor="aut-cfg-title">
            <Input id="aut-cfg-title" value={config.title || ''} placeholder="Automation" onChange={set('title')} />
          </Field>
          <Field label="Message" htmlFor="aut-cfg-message">
            <Input id="aut-cfg-message" value={config.message || ''} placeholder="What happened…" onChange={set('message')} />
          </Field>
        </div>
      </>
    );
  }

  if (actionType === 'set_field') {
    return (
      <div className="aut-grid3">
        <Field label="Field" htmlFor="aut-cfg-field" required
               hint={fields.length === 0 ? 'No custom fields on this project yet.' : undefined}>
          {fields.length > 0 ? (
            <Select id="aut-cfg-field" value={config.field_id || ''} onChange={set('field_id')}>
              <option value="">Select a field…</option>
              {fields.map(f => (
                <option key={f.field_id} value={f.field_id}>{f.name || f.label || f.field_id}</option>
              ))}
            </Select>
          ) : (
            <Input id="aut-cfg-field" value={config.field_id || ''} placeholder="fld_abc123" onChange={set('field_id')} />
          )}
        </Field>
        <Field label="Value" htmlFor="aut-cfg-value"
               hint="An empty value is a real instruction here — it clears the field.">
          <Input id="aut-cfg-value" value={config.value ?? ''} onChange={set('value')} />
        </Field>
      </div>
    );
  }

  if (actionType === 'change_status') {
    /* The one action whose key was always right: the builder wrote `status`
       and the engine read `status`. It is a <select> now rather than a free
       text box only because the engine used to default a blank one to "todo" —
       a rule that quietly moved tasks backwards. It no longer defaults, so a
       blank here is refused instead. */
    return (
      <Field label="Target status" htmlFor="aut-cfg-status" required>
        <Select id="aut-cfg-status" value={config.status || ''} onChange={set('status')}>
          <option value="">Select a status…</option>
          {['todo', 'in_progress', 'in_review', 'done'].map(s => <option key={s} value={s}>{s}</option>)}
        </Select>
      </Field>
    );
  }

  if (actionType === 'assign_to') {
    /* Required, and required hard: `assignee_user_ids` is an array column and
       the engine's UPDATE overwrites it. An empty list here used to mean
       "unassign everyone on this task", reported as a success. */
    return (
      <UserPicker
        id="aut-cfg-assignees"
        label="Assign to"
        hint="Replaces the task's assignees. Hold Ctrl (Cmd on Mac) to pick more than one."
        members={members}
        value={config.user_ids}
        onChange={v => onChange({ user_ids: v })}
      />
    );
  }

  if (actionType === 'post_comment') {
    return (
      <Field label="Comment" htmlFor="aut-cfg-body" required
             hint="Posted as the system user on the task that triggered the rule.">
        <Textarea id="aut-cfg-body" rows={3} value={config.body || ''} placeholder="Comment text…" onChange={set('body')} />
      </Field>
    );
  }

  return null;
}
