import React, { useState } from 'react';
import { Button, Input, Select, Textarea, Avatar } from '../../components/ui';
import { EMAIL_RE } from './data';
import { Cross } from './icons';

const ROLES = [['member', 'Member'], ['admin', 'Admin']];

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
 */
export default function StepInvite({ value, onChange }) {
  const list = value.invites;
  const [draft, setDraft] = useState('');
  const [bulk, setBulk] = useState(false);
  const [err, setErr] = useState(null);

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
    onChange({ ...value, invites: [...list, ...fresh.map((email) => ({ email, role: 'member' }))] });
    setDraft('');
  };

  const drop = (i) => onChange({ ...value, invites: list.filter((_, j) => j !== i) });
  const setRole = (i, role) => onChange({ ...value, invites: list.map((x, j) => (j === i ? { ...x, role } : x)) });

  return (
    <>
      <div className="ob__head">
        <h2 className="ob__h2">Invite your team</h2>
        <p className="ob__sub">
          Each person gets an emailed link that expires in seven days. Module access is
          granted separately — an invitation on its own opens nothing sensitive.
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
          {list.map((x, i) => (
            <div key={x.email} className="ob__row">
              <Avatar name={x.email.split('@')[0].replace(/[._]/g, ' ')} size={28} />
              <span className="ob__row-e">{x.email}</span>
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
          ))}
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
