import React, { useState } from 'react';
import { Button, Input, Select, Textarea, Avatar } from '../../components/ui';
import {
  ModuleGrantList, defaultGrantsFor, setLevelIn, toggleGrantIn,
} from '../org/ModuleGrantEditor';
import { moduleLabel } from '../org/catalogue';
import { EMAIL_RE } from './data';
import { Cross } from './icons';

/**
 * The org roles, by the codes `staging.user_roles` actually stores — which is
 * also what the reference uses verbatim (`Onboarding.jsx`: `OB_ROLES =
 * [['org_member','Member'],['org_admin','Admin']]`).
 *
 * These used to be `member` / `admin`, which are `users.role` account types
 * from a different ladder entirely. `POST /v1/org/invites` validates against
 * `INVITABLE_ROLES` — `org_owner`, `org_admin`, `org_member` — so the old
 * values would have been rejected with "Invalid role: member".
 */
const ROLES = [['org_member', 'Member'], ['org_admin', 'Admin']];

/**
 * Step 4 — invite the team.
 *
 * Accepts a single address or a pasted list split on `[,\s\n;]+`, validates
 * each, names the duplicate rather than counting it, and shows an honest empty
 * state instead of nagging. Working alone is a normal answer.
 *
 * The invites are sent by the wizard footer, not here — this step only builds
 * the list, so nothing goes out until the user presses the button that says it
 * will.
 *
 * ── Each invitation carries its module grants ───────────────────────────────
 * It did not, and that was the whole first-run experience of every colleague
 * anybody ever invited. `POST /v1/org/invites` has taken
 * `module_grants: [{code, role}]` since it was written; this step posted
 * `{email, org_role}`, so `accept_invite` wrote zero `org_member_modules` rows,
 * `_module_grants` returned `[]`, and `navConfig.js` hid every nav entry
 * carrying `module:`. The person the owner had just welcomed signed in to core
 * PM and nothing else, and the owner found out when they said so.
 *
 * The picker is the SAME control as Organisation ▸ Members ▸ Edit access — see
 * `ModuleGrantEditor` — down to the SENSITIVE tag and the Vetana admin/approver
 * sentence. Two editors for one decision is how the separated-duty rule ends up
 * stated correctly in only one of them.
 *
 * It opens per person rather than once for the list. Roles already vary by
 * person here, and the accountant and the designer are precisely the pair that
 * must not receive the same grant set — but it stays COLLAPSED, because the
 * default is already the right answer for most rows and a wizard step that
 * opens as twelve checkboxes times four invitees is a step people skip.
 */
export default function StepInvite({ value, onChange, activeCodes = null }) {
  const list = value.invites;
  const [draft, setDraft] = useState('');
  const [bulk, setBulk] = useState(false);
  const [err, setErr] = useState(null);
  /** Which invitee's module picker is open. One at a time; by email, not index,
   *  so removing a row above does not re-open the picker on a different person. */
  const [openFor, setOpenFor] = useState(null);

  const add = () => {
    const parts = draft.split(/[,\s\n;]+/).map((x) => x.trim()).filter(Boolean);
    if (!parts.length) return;
    const bad = parts.filter((p) => !EMAIL_RE.test(p));
    if (bad.length) {
      setErr(bad.length === 1 ? `${bad[0]} is not a valid email address` : `${bad.length} addresses are not valid`);
      return;
    }
    const dupe = parts.find((p) => list.some((x) => x.email === p));
    setErr(dupe ? `${dupe} is already on the list` : null);
    const fresh = parts.filter((p) => !list.some((x) => x.email === p));
    // `grants` is seeded, not left empty: the default is the org's active
    // modules minus the sensitive three, which is exactly what the server hands
    // a member added through `POST /v1/org/members` without a grant list. The
    // two doors into an org should not disagree about what an ordinary
    // colleague starts with.
    onChange({
      ...value,
      invites: [...list, ...fresh.map((email) => ({
        email, role: 'org_member', grants: defaultGrantsFor(activeCodes),
      }))],
    });
    setDraft('');
  };

  const drop = (i) => onChange({ ...value, invites: list.filter((_, j) => j !== i) });
  const setRole = (i, role) => onChange({ ...value, invites: list.map((x, j) => (j === i ? { ...x, role } : x)) });

  /** Rewrite one person's grants, leaving everyone else's alone. */
  const editGrants = (email, fn) => onChange({
    ...value,
    invites: list.map((x) => (x.email === email ? { ...x, grants: fn(x.grants || []) } : x)),
  });

  return (
    <>
      <div className="ob__head">
        <h2 className="ob__h2">Invite your team</h2>
        {/* This used to end "Module access is granted separately — an invitation
            on its own opens nothing sensitive." Half of that was true: nothing
            sensitive is included. The other half described a gap as if it were a
            policy — access was not granted separately, it was not granted at
            all, and the colleague signed in to an empty rail. */}
        <p className="ob__sub">
          Each person gets an emailed link that expires in seven days. What you
          set here is what they can reach the moment they accept — payroll, the
          books and personnel files are never included unless you tick them.
        </p>
      </div>

      <div className="ob__invite">
        <div className="ob__inviterow">
          {bulk ? (
            <Textarea
              rows="3"
              style={{ flex: 1 }}
              value={draft}
              onChange={(e) => { setDraft(e.target.value); setErr(null); }}
              placeholder={'aanya@aekam.co\nrohan@aekam.co\npriya@aekam.co'}
              aria-label="Email addresses, one per line"
            />
          ) : (
            <Input
              style={{ flex: 1 }}
              value={draft}
              onChange={(e) => { setDraft(e.target.value); setErr(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
              placeholder="name@company.com"
              aria-label="Email address"
            />
          )}
          <Button variant="fill" onClick={add}>Add</Button>
        </div>
        <div className="ob__bar">
          {err
            ? <span className="ob__err" role="alert">{err}</span>
            : <span className="ob__muted">{bulk ? 'One per line, or comma-separated.' : 'Press Enter to add. Paste a list to add several at once.'}</span>}
          <button type="button" className="au__link" onClick={() => { setBulk(!bulk); setDraft(''); setErr(null); }}>
            {bulk ? 'Single email' : 'Paste multiple'}
          </button>
        </div>
      </div>

      {list.length > 0 ? (
        <div className="ob__list">
          {list.map((x, i) => {
            const grants = x.grants || [];
            const open = openFor === x.email;
            return (
              <div key={x.email} className={`ob__item${open ? ' open' : ''}`}>
                <div className="ob__row">
                  <Avatar name={x.email.split('@')[0].replace(/[._]/g, ' ')} size={28} />
                  <span className="ob__row-e">{x.email}</span>
                  {/* The count, not the list: the row is one line and the names
                      are one press away. The empty case says what it means
                      rather than "0 modules" — somebody who reaches only
                      projects and tasks is a real choice, and the person making
                      it should see it in words. */}
                  <button
                    type="button"
                    className="ob__mods"
                    aria-expanded={open}
                    onClick={() => setOpenFor(open ? null : x.email)}
                  >
                    {grants.length
                      ? `${grants.length} module${grants.length === 1 ? '' : 's'}`
                      : 'Projects only'}
                  </button>
                  <Select
                    value={x.role}
                    onChange={(e) => setRole(i, e.target.value)}
                    aria-label={`Role for ${x.email}`}
                    style={{ width: 118 }}
                  >
                    {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                  <button type="button" className="ob__x" onClick={() => drop(i)} aria-label={`Remove ${x.email}`}>
                    <Cross width={14} height={14} />
                  </button>
                </div>
                {open && (
                  <div className="ob__grants">
                    <ModuleGrantList
                      draft={grants}
                      codes={activeCodes}
                      onToggle={(code) => editGrants(x.email, (g) => toggleGrantIn(g, code))}
                      onLevel={(code, level) => editGrants(x.email, (g) => setLevelIn(g, code, level))}
                    />
                    <p className="ob__muted ob__grants-f">
                      {grants.length
                        ? `${x.email.split('@')[0]} arrives with ${grants.map((g) => moduleLabel(g.code)).join(', ')}.`
                        : 'They will reach projects and tasks only until someone grants a module.'}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="ob__empty">
          <span className="ob__empty-t">No one invited yet</span>
          <span className="ob__empty-d">
            Working alone for now is completely normal. You can invite people from
            Settings whenever you like.
          </span>
        </div>
      )}
    </>
  );
}
