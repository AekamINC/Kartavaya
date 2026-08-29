import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import {
  Button, ConfirmDialog, ErrorState, Sheet, SkeletonTable, useToast,
} from '../../components/ui';
import MemberTable from './MemberTable';
import AccessMatrix from './AccessMatrix';
import { moduleLabel, sensitiveGrantMessage, sensitiveGrantRaises } from './catalogue';
import {
  ModuleGrantList, defaultGrantsFor, setLevelIn, toWireGrants, toggleGrantIn,
} from './ModuleGrantEditor';
import { DEFAULT_GRANT_LEVEL, levelLabel } from './levels';
import { apiErrorText } from '../../lib/apiError';

/**
 * TabMembers — who is in the org, and what each of them can reach.
 *
 * ── The state of Tier 4 in the running system, stated plainly ────────────────
 * Tier 4 is end-to-end as of 40124fb. `staging.org_member_modules.role` exists
 * (migration 066), `middleware/role_tiers.level_satisfies` reads it, and the API
 * in between now carries it: `GET /v1/org/members` returns `module_grants` as
 * `[{code, role}]`, and `PUT /v1/org/members/{id}/modules` writes the level
 * instead of dropping it on the column default.
 *
 * That last part was the defect. The endpoint DELETEd every grant row and
 * re-INSERTed without naming `role`, so re-saving a member's modules to change
 * one checkbox silently demoted every other grant they held to viewer. It was
 * fixed while `org_member_modules` still held zero rows, so nothing had to be
 * migrated and nobody was demoted on the way.
 *
 * `grantsCarryLevels` is kept rather than replaced with `true`. It reads the
 * response, so if this page is ever served by an older backend the control
 * disables itself instead of writing a level that will be discarded — the same
 * reason it was written that way when the gap was the other way round.
 *
 * Verified end to end against the live schema, 2026-07-26:
 * `staging.org_member_modules.role` is `TEXT NOT NULL DEFAULT 'viewer'` with
 * `org_member_modules_role_check` and `org_member_modules_level_is_meaningful`
 * both present, and the second is character-for-character what `validLevels()`
 * computes — so the picker and the CHECK constraint cannot disagree.
 *
 * ── Two things this screen must keep saying out loud ────────────────────────
 * · `UNIQUE (user_id, org_id, module_code)` means a member holds exactly ONE
 *   level per module. The role model allows holding admin AND approver on
 *   Vetana; the table cannot store it, and sending both in one save would
 *   violate the unique index rather than fail cleanly. The grant row says so.
 * · `require_module` admits any org_admin without consulting a grant row, so an
 *   admin's grants are intent and not yet a limit. The sheet says so on admin
 *   rows.
 *
 * ── The grant editor now serves the invitation too ──────────────────────────
 * `GrantRow` moved to `ModuleGrantEditor.jsx` and this screen imports it back,
 * because the same control has to sit in the ADD form as well as in the member
 * sheet. Until now the only moment an admin could decide what a colleague
 * reaches was after that colleague had already accepted and landed on an empty
 * module rail. The add form asks first, and posts the answer as
 * `module_grants` — which `POST /v1/org/members` has accepted the whole time
 * (`AddMemberBody.module_grants`) and no screen ever sent.
 */

const ROLE_OPTIONS = [
  { code: 'org_member', label: 'Org member' },
  { code: 'org_admin', label: 'Org admin' },
];

/**
 * Accepts both shapes the endpoint might return — today's `["graha"]` and the
 * `[{module_code, role}]` it needs to return — so this file does not have to be
 * edited again when the backend catches up.
 */
function normaliseGrants(mods) {
  return (mods || []).map(m => (typeof m === 'string'
    ? { code: m, level: null }
    : { code: m.module_code || m.code, level: m.role || m.level || null }));
}

const Info = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.6v.1" />
  </svg>
);

/**
 * `defaultView` is which of the two halves this mount opens on.
 *
 * The design splits them across two destinations and says so in as many words
 * (`SetOrg.jsx:130`): "The full permission matrix lives in Roles & access. This
 * tab is the roster; that one is the grid." Both are this one wired component,
 * so `/settings/roles` mounts it on `matrix` and Organisation ▸ Members mounts
 * it on `list`. A second copy of a screen that adds, invites, revokes and
 * regrants would be two code paths for one set of writes.
 */
export default function TabMembers({ isOwner, selfUserId, defaultView = 'list', onCount }) {
  const { pushToast } = useToast();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(null);

  // `member` null means the sheet is editing the grants for the person in the
  // ADD form, who has no member row yet — one sheet, two subjects.
  const [editing, setEditing] = useState(null);   // { member, draft: [{code, level}] }
  const [savingGrants, setSavingGrants] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const [addEmail, setAddEmail] = useState('');
  const [addMobile, setAddMobile] = useState('');
  const [addRole, setAddRole] = useState('org_member');
  const [adding, setAdding] = useState(false);
  // `null` is "the admin has not touched the picker", NOT "no modules". It
  // resolves to `defaultGrantsFor(activeModules)` at the point of use, so the
  // default keeps tracking the subscription as it lands instead of being frozen
  // by whatever was known at mount.
  const [addDraft, setAddDraft] = useState(null);

  // The redemption link for the invitation THIS press just created, held in
  // memory for this render only and never re-read from the listing. Same rule
  // as AdminPage: `GET /v1/org/invites` has no `token` field to leak one from,
  // and that is deliberate — a list endpoint that carried it would be a page of
  // live credentials.
  const [freshInvite, setFreshInvite] = useState(null);
  const [copied, setCopied] = useState('');

  // Invitations sent but not yet accepted. They occupy a seat, so they belong
  // beside the member list rather than on a screen of their own — an org at its
  // limit needs to see why without going looking.
  const [invites, setInvites] = useState([]);

  // `null` means "not looked up", which is what the matrix needs to tell apart
  // from "nothing is subscribed".
  const [view, setView] = useState(defaultView === 'matrix' ? 'matrix' : 'list');
  const [activeModules, setActiveModules] = useState(null);

  const load = useCallback(() => {
    setFailed(null);
    return api.get('/v1/org/members')
      .then(r => setMembers((Array.isArray(r.data) ? r.data : []).map(m => ({
        // module_grants carries the level; modules is the bare-code fallback the
        // endpoint still returns alongside it for older clients.
        ...m, grants: normaliseGrants(m.module_grants || m.modules),
      }))))
      .catch(err => setFailed(err))
      .finally(() => setLoading(false));
  }, []);

  // A failure leaves the list empty rather than raising: pending invites are
  // context for the member list, not the point of the screen, and an org that
  // has never invited anyone is the common case and looks identical.
  const loadInvites = useCallback(() => (
    api.get('/v1/org/invites')
      .then(r => setInvites(Array.isArray(r.data) ? r.data : []))
      .catch(() => setInvites([]))
  ), []);

  useEffect(() => { load(); loadInvites(); }, [load, loadInvites]);

  // A failure leaves it null, so the matrix draws every column at full
  // strength rather than dimming all twelve. Nothing here is worth a toast:
  // the dimming is a hint about the subscription, not about access.
  const loadActiveModules = useCallback(() => (
    api.get('/v1/subscription/current')
      .then(r => setActiveModules(r.data.active_modules || []))
      .catch(() => {})
  ), []);

  /**
   * Read on mount now, in BOTH views.
   *
   * It used to be fetched only when the matrix was opened, on the grounds that
   * "the list view does not use it, and a parallel request whose result is never
   * rendered is the exact defect 10 §What's wrong today opens with". That
   * reasoning was right and no longer applies: the add form renders it. The set
   * of modules an invitation may name IS the org's active subscription —
   * `_validate_grants` rejects the whole invitation for one module the org does
   * not have — so the picker cannot be honest without this read, and mounting
   * straight onto the matrix still needs what the click that never happened
   * would have fetched.
   */
  useEffect(() => { loadActiveModules(); }, [loadActiveModules]);

  // The tab bar wants the count and this is where the list is. Through a ref,
  // and keyed on the NUMBER rather than on the callback: parents pass an inline
  // arrow, whose identity changes every render, so a dependency on the function
  // itself would be a loop with a fresh request in it.
  const onCountRef = useRef(onCount);
  onCountRef.current = onCount;
  useEffect(() => { onCountRef.current?.(members.length); }, [members.length]);

  const showMatrix = () => {
    setView('matrix');
    if (activeModules != null) return;
    loadActiveModules();
  };

  /**
   * True once the API round-trips levels. See the header comment.
   *
   * Keyed on the PRESENCE OF THE `module_grants` KEY, not on finding a level
   * value in it. org_member_modules currently holds zero rows, so a value test
   * reports "this backend cannot store levels" on a backend that can — and
   * would show the operator a warning that is now false. An empty array still
   * proves the endpoint speaks the shape. The value test is kept as the fallback
   * for a backend predating the key entirely.
   */
  const grantsCarryLevels = useMemo(
    () => members.some(m => Array.isArray(m.module_grants) || m.grants.some(g => g.level)),
    [members],
  );

  const changeRole = async (m, role) => {
    try {
      await api.put(`/v1/org/members/${m.user_id}/role?role=${role}`);
      pushToast({ type: 'success', title: `${m.full_name || m.email} is now an ${role.replace('_', ' ')}` });
      load();
    } catch (err) {
      pushToast({ type: 'error', title: apiErrorText(err, 'Failed to update role') });
    }
  };

  const removeMember = (m) => setConfirm({
    title: 'Remove from organisation?',
    message: `${m.full_name || m.email} loses access to every module in this organisation. Their work stays; only their access is removed. You can add them back later.`,
    confirmLabel: 'Remove',
    intent: 'danger',
    onConfirm: async () => {
      try {
        await api.delete(`/v1/org/members/${m.user_id}`);
        pushToast({ type: 'success', title: `${m.email} removed` });
        load();
      } catch (err) {
        pushToast({ type: 'error', title: apiErrorText(err, 'Failed to remove member') });
      }
    },
  });

  /**
   * The modules the add form will send. `addDraft` null means untouched, and an
   * untouched picker is not "nothing" — it is the server's own default branch,
   * mirrored: every active module except the sensitive three. See
   * `defaultGrantsFor`.
   */
  const addGrants = addDraft || defaultGrantsFor(activeModules);

  /**
   * Add if they already have an account, invite if they do not — and say which.
   *
   * ── The 404 branch that used to live here ───────────────────────────────────
   * `POST /v1/org/members` used to answer 404 for an address with no account,
   * and this function read that as "new person" and posted `/v1/org/invites`
   * itself. That 404 NO LONGER EXISTS: `org_members.add_member` now calls
   * `issue_invite` on that branch and answers **200** with
   * `{status: "invited", …}`. So the fallback was unreachable, and — worse — the
   * success line above it claimed "{email} added as org member" for somebody who
   * had only been invited and would not appear in the list the toast sent them
   * to look at. The server returns a distinct `status` and a written `message`
   * precisely so this screen would not say that; it is read here now, and the
   * dead branch is gone rather than kept as a comment pretending to be code.
   *
   * ── Why the outcome is still only knowable from the response ────────────────
   * There is no "does this address have an account" endpoint to consult first,
   * and there must not be: an unauthenticated-adjacent oracle that answers that
   * question is account enumeration. One request, and the reply says which of
   * the two things happened.
   */
  const addMember = async () => {
    if (!addEmail.trim()) return;
    const email = addEmail.trim();
    const grants = toWireGrants(addGrants);
    setAdding(true);
    setFreshInvite(null);
    try {
      const res = await api.post('/v1/org/members', {
        email, role: addRole, mobile_number: addMobile.trim(),
        // Omitted entirely when empty. `add_member` reads a MISSING list as
        // "apply the org default" and an empty one the same way, but the invite
        // preflight validates every entry it is given — so sending `[]` where
        // the admin deliberately cleared the picker and sending nothing must
        // stay the same request, and the shorter one is the one already tested.
        ...(grants.length ? { module_grants: grants } : {}),
      });

      if (res.data?.status === 'invited') {
        setFreshInvite({ invite_id: res.data.invite_id, invite_link: res.data.invite_link });
        pushToast({
          type: grants.length ? 'warning' : 'success',
          title: `Invitation sent to ${email}`,
          // The server's own sentence, not a paraphrase — it is the one place
          // that knows why this became an invitation.
          message: [
            res.data.message
              || 'They have no account yet, so an invitation was sent. They join this organisation when they accept it.',
            // The one thing the reply does NOT carry. `add_member` hands
            // `issue_invite` an empty grant list on this branch, so the modules
            // picked above were not attached to the invitation and nothing will
            // write them on acceptance. Saying "invited with 6 modules" here
            // would be the same lie in a new place — grant them from this list
            // once the person accepts, or invite from Onboarding ▸ Team, which
            // posts to `/v1/org/invites` and does carry them.
            grants.length
              ? 'Module access was not attached to the invitation — grant it here once they accept.'
              : '',
          ].filter(Boolean).join(' '),
        });
        setAddEmail(''); setAddMobile(''); setAddDraft(null);
        loadInvites();
        return;
      }

      pushToast({
        type: 'success',
        title: `${email} added as ${String(res.data.role || addRole).replace('_', ' ')}`,
        message: grants.length
          ? `They can reach ${grants.length} module${grants.length === 1 ? '' : 's'} now.`
          : 'They arrive with no module access until you grant it.',
      });
      setAddEmail(''); setAddMobile(''); setAddDraft(null);
      load();
      loadInvites();
    } catch (err) {
      pushToast({ type: 'error', title: apiErrorText(err, 'Failed to add member') });
    } finally { setAdding(false); }
  };

  const copyInviteLink = async () => {
    try {
      await navigator.clipboard.writeText(freshInvite.invite_link);
      setCopied(freshInvite.invite_id);
    } catch {
      // Clipboard permission is the browser's to refuse and there is nothing
      // here to retry. The link is deliberately NOT printed on screen as a
      // fallback: it carries a working token, and a token on a settings page is
      // a credential anyone behind the operator can read.
      pushToast({
        type: 'error',
        title: 'Could not copy the link',
        message: 'The invitation email has already gone out.',
      });
    }
  };

  const revokeInvite = async (inv) => {
    try {
      await api.delete(`/v1/org/invites/${inv.invite_id}`);
      pushToast({ type: 'success', title: `Invitation to ${inv.email} revoked` });
      loadInvites();
    } catch (err) {
      pushToast({ type: 'error', title: apiErrorText(err, 'Failed to revoke') });
    }
  };

  const openGrants = (m) => setEditing({ member: m, draft: m.grants.map(g => ({ ...g })) });

  /**
   * The same sheet, opened on the person who is about to be added or invited.
   * `member: null` is what tells the save which of the two it is: one is a PUT
   * against a user_id that exists, the other is a draft that travels with the
   * next POST.
   */
  const openAddGrants = () => setEditing({
    member: null, draft: addGrants.map(g => ({ ...g })),
  });

  const toggleGrant = (code) => setEditing(e => ({ ...e, draft: toggleGrantIn(e.draft, code) }));

  const setGrantLevel = (code, level) => setEditing(e => ({
    ...e, draft: setLevelIn(e.draft, code, level),
  }));

  /**
   * Handing somebody Payroll, the books or personnel files at Approver or Admin
   * now names what they are being handed before it is handed over.
   *
   * It took two clicks and no confirmation: pick the level on the GrantRow,
   * press Save access. The row's SENSITIVE lock tag and separated-duty note are
   * labels on a control you have already decided to use, not a confirmation —
   * and `ConfirmDialog` was wired only to member REMOVAL, so the destructive
   * action on this screen was guarded and the privilege-granting one was not.
   *
   * The existing dialog, deliberately: it carries `role="alertdialog"` and the
   * focus restore is already fixed there. A second dialog that merely resembled
   * it would be a second set of both bugs.
   *
   * Mirror only. The server refuses an org_admin granting approver on
   * vetana/ganit outright (`role_tiers.refuse_grant`) and audits every sensitive
   * grant change, so cancelling here is a convenience and confirming here is not
   * an authorisation — see levels.js on why this file never enforces.
   */
  const commitGrants = async () => {
    // The add form's draft. Nothing is written here — there is no member row to
    // write against yet — so it is held until the POST that creates one, which
    // is the only request that can carry it.
    if (!editing.member) {
      setAddDraft(editing.draft);
      setEditing(null);
      return;
    }
    setSavingGrants(true);
    try {
      // {code, role} objects. UpdateModulesBody accepts these and bare strings
      // both, but sending bare strings here would land every grant back on the
      // column default — which is the demotion this whole surface exists to
      // stop. `level` is only ever null against a backend that did not return
      // one, and DEFAULT_GRANT_LEVEL matches the server's own default.
      await api.put(`/v1/org/members/${editing.member.user_id}/modules`, {
        modules: editing.draft.map(g => ({ code: g.code, role: g.level || DEFAULT_GRANT_LEVEL })),
      });
      pushToast({ type: 'success', title: 'Module access updated' });
      setEditing(null);
      load();
    } catch (err) {
      pushToast({ type: 'error', title: apiErrorText(err, 'Failed to update modules') });
    } finally { setSavingGrants(false); }
  };

  const saveGrants = () => {
    // A person who does not exist yet holds nothing, so every sensitive module
    // in the draft is a raise — which is right: an invitation that hands over
    // payroll is the same act as a grant that does, and the confirmation is the
    // same one. It is the honest baseline, not an empty-state shortcut.
    const held = editing.member ? editing.member.grants : [];
    const raises = sensitiveGrantRaises(held, editing.draft);
    if (!raises.length) return commitGrants();

    const who = editing.member
      ? (editing.member.full_name || editing.member.email)
      : (addEmail.trim() || 'this person');
    return setConfirm({
      title: raises.length === 1
        ? `Give ${who} ${raises[0].label} at ${levelLabel(raises[0].level)}?`
        : `Give ${who} access to ${raises.length} sensitive modules?`,
      message: sensitiveGrantMessage(who, raises),
      confirmLabel: 'Grant access',
      // `warn`, not `danger`. Danger is the filled red reserved for a confirmed
      // delete — this is consequential and reversible, and painting it the same
      // as "Remove from organisation" would flatten the difference between the
      // two prompts this screen can raise.
      intent: 'warn',
      onConfirm: commitGrants,
    });
  };

  if (loading) return <SkeletonTable rows={5} columns={4} />;
  if (failed) {
    return <ErrorState kind="server" detail="Couldn’t load the member list." onRetry={() => { setLoading(true); load(); }} />;
  }

  return (
    <div>
      <section className="st__group">
        <div className="ohd">
          <h2 className="st__gt">Members · {members.length}</h2>
          {/* The list answers "what can this person reach". The matrix answers
              the transpose — "who can reach payroll" — which is the question an
              audit actually asks and which three chips and a +n cannot answer. */}
          <div className="seg" role="group" aria-label="Member view">
            <button
              type="button"
              className={`seg__b${view === 'list' ? ' on' : ''}`}
              aria-pressed={view === 'list'}
              onClick={() => setView('list')}
            >
              List
            </button>
            <button
              type="button"
              className={`seg__b${view === 'matrix' ? ' on' : ''}`}
              aria-pressed={view === 'matrix'}
              onClick={showMatrix}
            >
              Access matrix
            </button>
          </div>
        </div>

        {view === 'list' ? (
          <MemberTable
            members={members}
            isOwner={isOwner}
            selfUserId={selfUserId}
            onEditGrants={openGrants}
            onChangeRole={changeRole}
            onRemove={removeMember}
          />
        ) : (
          <AccessMatrix members={members} activeCodes={activeModules} />
        )}
      </section>

      <section className="st__group">
        <h2 className="st__gt">Add or invite a member</h2>
        {/* The old sentence ended "Either way they arrive with no module access
            until you grant it." That was a description of the defect, written as
            if it were the design: the module rail of every new colleague was
            empty until an admin came back and filled it. Access is decided here
            now, before they arrive. */}
        <p className="of__h of__h--lede">
          If they already have a Kartavaya account they join straight away. If they
          do not, we send them an invitation. Choose what they can reach before
          they arrive — the sensitive three are never included by default.
        </p>
        <div className="of">
          <div className="of__f">
            <label className="of__l" htmlFor="add-email">Email</label>
            <input id="add-email" className="of__i" type="email" placeholder="user@company.com"
              value={addEmail} onChange={e => setAddEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addMember()} />
          </div>
          <div className="of__f">
            <label className="of__l" htmlFor="add-mobile">Mobile</label>
            <input id="add-mobile" className="of__i" type="tel" placeholder="Optional"
              value={addMobile} onChange={e => setAddMobile(e.target.value)} />
          </div>
          <div className="of__f">
            <label className="of__l" htmlFor="add-role">Role</label>
            <select id="add-role" className="of__i" value={addRole} onChange={e => setAddRole(e.target.value)}>
              {ROLE_OPTIONS.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
          </div>
          {/* The picker names what it is about to hand over, in full, rather
              than a count. "6 modules" is not something an admin can check; a
              list with Vetana missing from it is. */}
          <div className="of__f of__f--wide">
            <span className="of__l" id="add-grants-l">Module access</span>
            {/* `of__f` as well as the modifier: `.of__f--row` only changes the
                direction of a flex box it does not itself declare. */}
            <div className="of__f of__f--row">
              <span className="of__h of__h--flush" data-testid="add-grants-summary">
                {addGrants.length
                  ? addGrants.map(g => `${moduleLabel(g.code)} · ${levelLabel(g.level || DEFAULT_GRANT_LEVEL)}`).join(', ')
                  : 'No modules — they will reach projects and tasks only.'}
              </span>
              <Button variant="ghost" onClick={openAddGrants} aria-describedby="add-grants-l">
                Choose modules
              </Button>
            </div>
          </div>
          <div className="of__f of__f--act">
            <Button variant="fill" onClick={addMember} disabled={adding || !addEmail.trim()}>
              {adding ? 'Working…' : 'Add or invite'}
            </Button>
          </div>
        </div>

        {/* Shown once, for the invitation this operator just created, and only
            as a button — the link carries a working token. It is here rather
            than on the row below because the listing has no token to offer and
            must not grow one. */}
        {freshInvite?.invite_link && (
          <div className="of__f of__f--row">
            <span className="of__h of__h--flush">
              The invitation email is on its way. If it is slow, send the link
              yourself — it works once and expires in seven days.
            </span>
            <Button variant="ghost" onClick={copyInviteLink}>
              {copied === freshInvite.invite_id ? 'Copied' : 'Copy invite link'}
            </Button>
          </div>
        )}
      </section>

      {/* Pending invitations sit beside the members because they OCCUPY A SEAT.
          An org at its limit needs to see the three unaccepted invitations that
          are holding places, without going to look for them. */}
      {invites.length > 0 && (
        <section className="st__group">
          <h2 className="st__gt">Invited · {invites.length}</h2>
          <p className="of__h of__h--lede">
            Sent but not yet accepted. Each one holds a seat until it is accepted
            or revoked.
          </p>
          <div className="of">
            {invites.map(inv => (
              <div key={inv.invite_id} className="of__f of__f--row">
                <div>
                  <div className="oinv__e">{inv.email}</div>
                  <div className="of__h of__h--flush">
                    {String(inv.org_role || 'org_member').replace('org_', '')}
                    {inv.expires_at ? ` · expires ${new Date(inv.expires_at).toLocaleDateString()}` : ''}
                  </div>
                </div>
                <Button variant="ghost" onClick={() => revokeInvite(inv)}>Revoke</Button>
              </div>
            ))}
          </div>
        </section>
      )}

      <Sheet
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={
          editing
            ? `Module access — ${editing.member
              ? (editing.member.full_name || editing.member.email)
              : (addEmail.trim() || 'the person you are adding')}`
            : ''
        }
      >
        {editing && (
          <>
            {/* The role model says the owner decides which modules an org_admin
                may reach. The server does not implement that yet: gate 2 of
                `middleware/subscription.py` returns early for org_admin as well
                as org_owner, so these rows are stored and audited but restrict
                nothing until it reads them. Saying so is the only honest option
                — the alternative is an owner tightening an admin's access and
                believing it took effect. */}
            {(editing.member ? editing.member.role_code : addRole) === 'org_admin' && (
              <p className="opend opend--stack">
                {Info}
                <span>
                  An org admin reaches <strong>every active module by role</strong> today.
                  What you set here is stored and audited, and it is what the owner
                  intends this admin to have — but <code>require_module</code> still
                  admits any org_admin, so it does not restrict them yet.
                </span>
              </p>
            )}

            {!grantsCarryLevels && (
              <p className="opend opend--stack">
                {Info}
                <span>
                  This server is running a build from before levels were stored, so every
                  grant here is <strong>viewer</strong> whatever you pick. Turning a module
                  on or off works normally. Levels apply once it is updated.
                </span>
              </p>
            )}

            {/* Two different lists, deliberately.
                · An EXISTING member sees every module in the catalogue, because
                  a grant that outlives its subscription is exactly the row an
                  admin needs to find and turn off — same reason AccessMatrix
                  paints the lapsed column instead of hiding it.
                · Somebody being ADDED sees only what the org actually has.
                  `_validate_grants` rejects the whole request over one module
                  the org is not subscribed to, so offering it here would fail
                  the add rather than trim it. */}
            <ModuleGrantList
              draft={editing.draft}
              codes={editing.member ? null : activeModules}
              levelsEditable={editing.member ? grantsCarryLevels : true}
              onToggle={toggleGrant}
              onLevel={setGrantLevel}
            />

            <div className="ogr__acts">
              <Button variant="fill" onClick={saveGrants} disabled={savingGrants}>
                {savingGrants ? 'Saving…' : editing.member ? 'Save access' : 'Use these modules'}
              </Button>
              <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </>
        )}
      </Sheet>

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
