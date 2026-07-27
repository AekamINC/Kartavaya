import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import {
  Button, Checkbox, ConfirmDialog, ErrorState, Sheet, SkeletonTable, useToast,
} from '../../components/ui';
import MemberTable from './MemberTable';
import AccessMatrix from './AccessMatrix';
import { Lock } from './ModuleCard';
import { ORG_MODULES, orgModuleColor } from './catalogue';
import {
  DEFAULT_GRANT_LEVEL, isSeparatedDuty, levelLabel, validLevels,
} from './levels';

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

/** One module row inside the grant sheet: on/off, then at what level. */
function GrantRow({ mod, grant, levelsEditable, onToggle, onLevel }) {
  const on = Boolean(grant);
  const level = grant?.level || DEFAULT_GRANT_LEVEL;
  const levels = validLevels(mod.code);

  return (
    <div className={`ogr__r${on ? ' on' : ''}`} style={{ '--c': orgModuleColor(mod.code) }}>
      <Checkbox
        checked={on}
        label={`${mod.label} access`}
        onChange={() => onToggle(mod.code)}
      />
      <span className="ogr__n">
        {mod.label}
        <span className="ogr__hi" lang="hi">{mod.hi}</span>
        <span className="of__h"> {mod.en}</span>
      </span>

      {mod.sensitive && <span className="omod__lock">{Lock} SENSITIVE</span>}

      <span className="ogr__lv" role="group" aria-label={`${mod.label} level`}>
        {levels.map(l => (
          <button
            key={l}
            type="button"
            className={`ogr__b${on && level === l ? ' on' : ''}`}
            disabled={!on || !levelsEditable}
            aria-pressed={on && level === l}
            onClick={() => onLevel(mod.code, l)}
          >
            {levelLabel(l)}
          </button>
        ))}
      </span>

      {/* Stated on the row it applies to, not in a footnote — and stated whether
          or not the module is currently on, because the moment it matters is
          while you are deciding to grant it, not after.

          The sentence deliberately no longer ends "grant both if one person does
          both". `staging.org_member_modules` is UNIQUE (user_id, org_id,
          module_code), so a second grant row on the same module CANNOT EXIST —
          sending admin and approver for one module in the same save violates the
          unique index. The role model allows holding both; the schema does not
          yet represent it. Promising it here would be a promise this screen
          cannot keep. See the report. */}
      {isSeparatedDuty(mod.code) && (
        <span className="ogr__note">
          <strong>Admin does not include Approver here.</strong>
          {on && (
            <> Admin is breadth — salary structures, chart of accounts. Approver is
              depth — releasing payments, closing periods. Whoever sets what people
              are paid must not also be the one who releases the money, so pick the
              one this person actually does. One grant per module is all this
              stores today.</>
          )}
        </span>
      )}
    </div>
  );
}

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

  const [editing, setEditing] = useState(null);   // { member, draft: [{code, level}] }
  const [savingGrants, setSavingGrants] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const [addEmail, setAddEmail] = useState('');
  const [addMobile, setAddMobile] = useState('');
  const [addRole, setAddRole] = useState('org_member');
  const [adding, setAdding] = useState(false);

  // Invitations sent but not yet accepted. They occupy a seat, so they belong
  // beside the member list rather than on a screen of their own — an org at its
  // limit needs to see why without going looking.
  const [invites, setInvites] = useState([]);

  // `null` means "not looked up", which is what the matrix needs to tell apart
  // from "nothing is subscribed". Fetched on the first switch to the matrix
  // rather than on mount: the list view does not use it, and a parallel request
  // whose result is never rendered is the exact defect 10 §"What's wrong today"
  // opens with.
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

  // Mounting straight onto the matrix has to fetch what the click that never
  // happened would have fetched, or `/settings/roles` opens with all twelve
  // columns dimmed and reads as "nothing is subscribed".
  useEffect(() => {
    if (defaultView === 'matrix') loadActiveModules();
  }, [defaultView, loadActiveModules]);

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
      pushToast({ type: 'error', title: err?.response?.data?.detail || 'Failed to update role' });
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
        pushToast({ type: 'error', title: err?.response?.data?.detail || 'Failed to remove member' });
      }
    },
  });

  /**
   * Add if they already have an account, invite if they do not.
   *
   * `POST /v1/org/members` refuses an email with no account, and until now that
   * was the end of the road: the only invite endpoint was Aekam's platform
   * console, so bringing in a genuinely new person meant asking Aekam. The 404
   * is the signal that this is a new person, not an error to report.
   *
   * The two outcomes are told apart in the toast, because they are genuinely
   * different — one person can sign in now, the other has mail waiting.
   */
  const addMember = async () => {
    if (!addEmail.trim()) return;
    setAdding(true);
    try {
      const res = await api.post('/v1/org/members', {
        email: addEmail.trim(), role: addRole, mobile_number: addMobile.trim(),
      });
      pushToast({ type: 'success', title: `${addEmail} added as ${String(res.data.role).replace('_', ' ')}` });
      setAddEmail(''); setAddMobile('');
      load();
      loadInvites();
    } catch (err) {
      if (err?.response?.status !== 404) {
        pushToast({ type: 'error', title: err?.response?.data?.detail || 'Failed to add member' });
        setAdding(false);
        return;
      }
      try {
        await api.post('/v1/org/invites', { email: addEmail.trim(), org_role: addRole });
        pushToast({ type: 'success', title: `Invitation sent to ${addEmail}` });
        setAddEmail(''); setAddMobile('');
        loadInvites();
      } catch (inviteErr) {
        pushToast({
          type: 'error',
          title: inviteErr?.response?.data?.detail || 'Failed to invite',
        });
      }
    } finally { setAdding(false); }
  };

  const revokeInvite = async (inv) => {
    try {
      await api.delete(`/v1/org/invites/${inv.invite_id}`);
      pushToast({ type: 'success', title: `Invitation to ${inv.email} revoked` });
      loadInvites();
    } catch (err) {
      pushToast({ type: 'error', title: err?.response?.data?.detail || 'Failed to revoke' });
    }
  };

  const openGrants = (m) => setEditing({ member: m, draft: m.grants.map(g => ({ ...g })) });

  const toggleGrant = (code) => setEditing(e => {
    const has = e.draft.some(g => g.code === code);
    return {
      ...e,
      draft: has
        ? e.draft.filter(g => g.code !== code)
        // A grant starts at the least it can be and is raised deliberately —
        // Kartavya has no viewer, so validLevels decides the floor, not a
        // constant.
        : [...e.draft, { code, level: validLevels(code)[0] || DEFAULT_GRANT_LEVEL }],
    };
  });

  const setGrantLevel = (code, level) => setEditing(e => ({
    ...e,
    draft: e.draft.map(g => (g.code === code ? { ...g, level } : g)),
  }));

  const saveGrants = async () => {
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
      pushToast({ type: 'error', title: err?.response?.data?.detail || 'Failed to update modules' });
    } finally { setSavingGrants(false); }
  };

  if (loading) return <SkeletonTable rows={5} columns={4} />;
  if (failed) {
    return <ErrorState kind="server" detail="Couldn’t load the member list." onRetry={() => { setLoading(true); load(); }} />;
  }

  return (
    <div>
      <section className="st__group">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          <h2 className="st__gt" style={{ marginBottom: 0 }}>Members · {members.length}</h2>
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
        <p className="of__h" style={{ marginBottom: 12 }}>
          If they already have a Kartavaya account they join straight away. If they
          do not, we send them an invitation. Either way they arrive with no module
          access until you grant it.
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
          <div className="of__f" style={{ justifyContent: 'flex-end' }}>
            <Button variant="fill" onClick={addMember} disabled={adding || !addEmail.trim()}>
              {adding ? 'Working…' : 'Add or invite'}
            </Button>
          </div>
        </div>
      </section>

      {/* Pending invitations sit beside the members because they OCCUPY A SEAT.
          An org at its limit needs to see the three unaccepted invitations that
          are holding places, without going to look for them. */}
      {invites.length > 0 && (
        <section className="st__group">
          <h2 className="st__gt">Invited · {invites.length}</h2>
          <p className="of__h" style={{ marginBottom: 12 }}>
            Sent but not yet accepted. Each one holds a seat until it is accepted
            or revoked.
          </p>
          <div className="of">
            {invites.map(inv => (
              <div key={inv.invite_id} className="of__f"
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{inv.email}</div>
                  <div className="of__h" style={{ margin: 0 }}>
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
        title={editing ? `Module access — ${editing.member.full_name || editing.member.email}` : ''}
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
            {editing.member.role_code === 'org_admin' && (
              <p className="opend" style={{ marginBottom: 12 }}>
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
              <p className="opend" style={{ marginBottom: 12 }}>
                {Info}
                <span>
                  This server is running a build from before levels were stored, so every
                  grant here is <strong>viewer</strong> whatever you pick. Turning a module
                  on or off works normally. Levels apply once it is updated.
                </span>
              </p>
            )}

            <div className="ogr">
              {ORG_MODULES.map(mod => (
                <GrantRow
                  key={mod.code}
                  mod={mod}
                  grant={editing.draft.find(g => g.code === mod.code)}
                  levelsEditable={grantsCarryLevels}
                  onToggle={toggleGrant}
                  onLevel={setGrantLevel}
                />
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <Button variant="fill" onClick={saveGrants} disabled={savingGrants}>
                {savingGrants ? 'Saving…' : 'Save access'}
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
