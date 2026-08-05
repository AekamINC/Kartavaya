/**
 * The action form collects what the engine reads.
 *
 * actionConfig.test.js asserts the key TABLE; this asserts the FORM — that the
 * inputs a person actually types into are wired to those keys. The two are
 * separable and both were wrong: the old page rendered ONE text box and
 * relabelled it ("Target status", "User email", "Field value", "Message"), so
 * even a corrected key table would have had nothing to fill `field_id` AND
 * `value`, or a list of `user_ids`, from a single string.
 *
 * Rendered with react-dom directly — @testing-library/react is installed but
 * its @testing-library/dom peer is NOT, so importing it throws. Same reason as
 * pageHeader.test.jsx and moduleTabs.test.jsx.
 *
 * MUTATION-CHECKED: returning null from ActionConfigFields for send_notification
 * makes the multi-input assertions red; dropping the `multiple` attribute from
 * UserPicker makes the list assertion red.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import ActionConfigFields from '../ActionConfigFields';

const MEMBERS = [
  { user_id: 'user_a', display_name: 'Asha', email: 'asha@example.com' },
  { user_id: 'user_b', display_name: 'Bhavin', email: 'bhavin@example.com' },
];
const FIELDS = [{ field_id: 'fld_1', name: 'Client code' }];

let container = null;
let root = null;

beforeEach(() => {
  // Same flag the other react-dom suites set (outboundLog, grahaTabStates,
  // kanbanTab). Without it React logs "not configured to support act(...)" on
  // every render and the real output gets lost in the noise.
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

function render(props) {
  act(() => {
    root.render(
      <ActionConfigFields
        members={MEMBERS}
        fields={FIELDS}
        config={{}}
        onChange={() => {}}
        {...props}
      />,
    );
  });
}

describe('every action gets inputs for the keys the engine reads', () => {
  it('send_email asks for a recipient, and offers only project members', () => {
    // The engine refuses to mail anyone outside the workspace
    // (automation_engine.py checks team_members before send_email), so a free
    // text box would invite an address that is guaranteed to be rejected.
    render({ actionType: 'send_email' });
    const to = container.querySelector('#aut-cfg-to');
    expect(to).toBeTruthy();
    expect(to.tagName).toBe('SELECT');
    expect([...to.options].map(o => o.value)).toContain('asha@example.com');
    expect(container.querySelector('#aut-cfg-subject')).toBeTruthy();
    expect(container.querySelector('#aut-cfg-html')).toBeTruthy();
  });

  it('send_notification asks for recipients as a LIST, not a string', () => {
    render({ actionType: 'send_notification' });
    const users = container.querySelector('#aut-cfg-users');
    expect(users.tagName).toBe('SELECT');
    expect(users.multiple).toBe(true);      // user_ids is an array on both sides
    expect(container.querySelector('#aut-cfg-title')).toBeTruthy();
    expect(container.querySelector('#aut-cfg-message')).toBeTruthy();
  });

  it('set_field asks for BOTH halves — the id and the value', () => {
    // The single text box could only ever supply one of these, which is why
    // set_field could not have been made to work by renaming a key.
    render({ actionType: 'set_field' });
    expect(container.querySelector('#aut-cfg-field')).toBeTruthy();
    expect(container.querySelector('#aut-cfg-value')).toBeTruthy();
  });

  it('assign_to asks for a list of people, not one email', () => {
    render({ actionType: 'assign_to' });
    const picker = container.querySelector('#aut-cfg-assignees');
    expect(picker.multiple).toBe(true);
    expect([...picker.options].map(o => o.value)).toEqual(['user_a', 'user_b']);
  });

  it('post_comment asks for the comment', () => {
    render({ actionType: 'post_comment' });
    expect(container.querySelector('#aut-cfg-body')).toBeTruthy();
  });

  it('change_status still asks for one status, and now constrains it', () => {
    // The action that worked. It keeps its single input; the only change is
    // that a blank is no longer silently defaulted to "todo" by the engine, so
    // the control is a select with an explicit empty option rather than a text
    // box that could be left meaning something it did not say.
    render({ actionType: 'change_status' });
    const sel = container.querySelector('#aut-cfg-status');
    expect(sel.tagName).toBe('SELECT');
    expect([...sel.options].map(o => o.value)).toEqual(['', 'todo', 'in_progress', 'in_review', 'done']);
  });
});

describe('the pickers degrade instead of blocking', () => {
  it('falls back to a text input when the member list could not be loaded', () => {
    // A builder that cannot be used at all is worse than one that asks you to
    // paste an id. `/teams/{id}/members` is allowed to fail on its own.
    render({ actionType: 'assign_to', members: [] });
    const input = container.querySelector('#aut-cfg-assignees');
    expect(input.tagName).toBe('INPUT');
  });

  it('falls back to a text input when the project has no custom fields', () => {
    render({ actionType: 'set_field', fields: [] });
    expect(container.querySelector('#aut-cfg-field').tagName).toBe('INPUT');
  });
});

describe('reading a config back', () => {
  it('shows the stored values in the inputs that produced them', () => {
    render({ actionType: 'post_comment', config: { body: 'Nice work' } });
    expect(container.querySelector('#aut-cfg-body').value).toBe('Nice work');
  });

  it('renders a stored user_ids list as the selected options', () => {
    render({ actionType: 'assign_to', config: { user_ids: ['user_b'] } });
    const picker = container.querySelector('#aut-cfg-assignees');
    expect([...picker.selectedOptions].map(o => o.value)).toEqual(['user_b']);
  });
});
