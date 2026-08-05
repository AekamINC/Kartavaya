/**
 * What the automation builder writes.
 *
 * The page used to collect ONE text box per rule and file it under `message`,
 * `status` or `value`. backend/services/automation_engine.py reads `to`,
 * `user_ids`, `field_id`+`value`, `status`, `user_ids` and `body`. Only
 * change_status ever agreed, and nothing could tell: a `.get()` that misses
 * returns a default, so the action did nothing and reported success, and the
 * rules list showed a rising run count on rules that had never worked.
 *
 * These assert the RULE — which keys come out for which action — not the
 * markup, so rearranging the form cannot make them pass while the keys drift
 * again. The cross-language half of the same check (this table against the
 * engine's actual `cfg.get(...)` calls) is
 * backend/tests/test_automation_config_parity.py.
 *
 * MUTATION-CHECKED. Confirmed red by breaking what each covers:
 *   · post_comment emitting `message` instead of `body`
 *   · `required.includes(key)` dropped from buildActionConfig
 *   · the set_field `keepBlank` exception removed
 */
import { describe, it, expect } from 'vitest';
import {
  ACTION_CONFIG_KEYS,
  ACTION_REQUIRED_KEYS,
  buildActionConfig,
  configProblems,
  describeAction,
} from '../actionConfig';

/* The six, written out literally rather than derived from the table under
   test. A list computed from the thing being checked cannot notice that thing
   gaining or losing an entry. */
const ACTIONS = ['send_email', 'send_notification', 'set_field', 'change_status', 'assign_to', 'post_comment'];

describe('the key vocabulary', () => {
  it('covers exactly the six actions the router accepts', () => {
    expect(Object.keys(ACTION_CONFIG_KEYS).sort()).toEqual([...ACTIONS].sort());
    expect(Object.keys(ACTION_REQUIRED_KEYS).sort()).toEqual([...ACTIONS].sort());
  });

  it('never emits the three keys the old form used, except where the engine reads them', () => {
    // `message` survives on send_notification alone — the engine really does
    // read cfg["message"] there. `status` survives on change_status, the one
    // action that always worked. Everywhere else the old vocabulary is gone.
    expect(ACTION_CONFIG_KEYS.post_comment).not.toContain('message');
    expect(ACTION_CONFIG_KEYS.send_email).not.toContain('message');
    expect(ACTION_CONFIG_KEYS.assign_to).not.toContain('value');
    expect(ACTION_CONFIG_KEYS.send_notification).toContain('message');
    expect(ACTION_CONFIG_KEYS.change_status).toEqual(['status']);
  });
});

describe('buildActionConfig', () => {
  it('writes the comment under `body`, which is what the engine reads', () => {
    expect(buildActionConfig('post_comment', { body: 'Nice work' })).toEqual({ body: 'Nice work' });
  });

  it('writes recipients as a list under `user_ids` for both actions that take one', () => {
    expect(buildActionConfig('assign_to', { user_ids: ['user_a'] })).toEqual({ user_ids: ['user_a'] });
    expect(buildActionConfig('send_notification', { user_ids: ['user_a'], message: 'hi' }))
      .toEqual({ user_ids: ['user_a'], message: 'hi' });
  });

  it('leaves change_status exactly as it was', () => {
    // The action that worked. This fix must not move it.
    expect(buildActionConfig('change_status', { status: 'done' })).toEqual({ status: 'done' });
  });

  it('drops blank optional keys instead of overwriting the engine default with ""', () => {
    // send_email's engine branch is cfg.get("subject", "Kartavaya notification").
    // Writing subject:"" would send an email with no subject line, which is not
    // what leaving the box empty means.
    const cfg = buildActionConfig('send_email', { to: 'a@b.com', subject: '', html: '' });
    expect(cfg).toEqual({ to: 'a@b.com' });
    expect('subject' in cfg).toBe(false);
  });

  it('keeps a blank REQUIRED key so the config reports missing rather than silently shrinking', () => {
    // If a blank `to` were dropped the object would be {} — indistinguishable
    // from an untouched form, and configProblems would say the same thing about
    // both. Keeping it means the value the user left blank is the value that
    // gets reported.
    expect(buildActionConfig('send_email', { to: '' })).toEqual({ to: '' });
  });

  it('keeps a falsy `value` on set_field, because clearing a field is a real instruction', () => {
    expect(buildActionConfig('set_field', { field_id: 'fld_1', value: '' }))
      .toEqual({ field_id: 'fld_1', value: '' });
    expect(buildActionConfig('set_field', { field_id: 'fld_1', value: 0 }))
      .toEqual({ field_id: 'fld_1', value: 0 });
  });

  it('ignores draft keys the action does not read', () => {
    // The form clears `config` when the action type changes; this is the belt
    // to that braces. Leftover vocabulary from a previous action type is how a
    // config ends up carrying keys nobody reads.
    expect(buildActionConfig('change_status', { status: 'done', body: 'leftover' }))
      .toEqual({ status: 'done' });
  });

  it('returns nothing for an action it does not know', () => {
    expect(buildActionConfig('delete_everything', { x: 1 })).toEqual({});
  });
});

describe('configProblems — the reason Create is blocked', () => {
  it('names what is missing in the words on the form', () => {
    expect(configProblems('assign_to', {})).toEqual(['Needs at least one person.']);
    expect(configProblems('post_comment', {})).toEqual(['Needs comment text.']);
    expect(configProblems('send_email', { to: '   ' })).toEqual(['Needs recipient.']);
  });

  it('treats an empty list as missing, which is the case that unassigned people', () => {
    // assign_to's engine branch overwrites `assignee_user_ids`. An empty list
    // reaching it used to mean "unassign everyone on this task", reported as a
    // success.
    expect(configProblems('assign_to', { user_ids: [] })).toEqual(['Needs at least one person.']);
  });

  it('passes a config that is complete', () => {
    expect(configProblems('change_status', { status: 'done' })).toEqual([]);
    expect(configProblems('set_field', { field_id: 'fld_1', value: '' })).toEqual([]);
  });
});

describe('describeAction — reading a rule already in the database', () => {
  it('flags a rule saved by the old builder', () => {
    // Verbatim what the old page stored for "post a comment when done".
    const stored = { type: 'post_comment', config: { message: 'Nice work' } };
    expect(describeAction(stored).ok).toBe(false);
  });

  it('does not flag a rule that was always fine', () => {
    expect(describeAction({ type: 'change_status', config: { status: 'done' } }).ok).toBe(true);
  });

  it('flags an action with no config at all rather than assuming a default', () => {
    expect(describeAction({ type: 'change_status' }).ok).toBe(false);
  });
});
