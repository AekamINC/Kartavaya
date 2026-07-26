import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import {
  Button, Checkbox, ConfirmDialog, ErrorState, Sheet, SkeletonTable, useToast,
} from '../../components/ui';
import MemberTable from './MemberTable';
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

      {mod.sensitive && <span className="omod__lock">SENSITIVE</span>}

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

      {/* Stated on the row it applies to, not in a footnote. On Vetana and Ganit
          admin is breadth and approver is depth — admin alone cannot release a
          payment or close a period, and a person who needs both holds both. */}
      {on && isSeparatedDuty(mod.code) && (
        <span className="of__h" style={{ flexBasis: '100%' }}>
          Admin does not include Approver here — whoever sets what people are paid
          must not also release the money. Grant both if one person does both.
        </span>
      )}
    </div>
  );
}

export default function TabMembers({ isOwner, selfUserId }) {
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

  useEffect(() => { load(); }, [load]);

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
    } catch (err) {
      pushToast({ type: 'error', title: err?.response?.data?.detail || 'Failed to add member' });
    } finally { setAdding(false); }
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
        <h2 className="st__gt">Members · {members.length}</h2>
        <MemberTable
          members={members}
          isOwner={isOwner}
          selfUserId={selfUserId}
          onEditGrants={openGrants}
          onChangeRole={changeRole}
          onRemove={removeMember}
        />
      </section>

      <section className="st__group">
        <h2 className="st__gt">Add a member</h2>
        <p className="of__h" style={{ marginBottom: 12 }}>
          They need a Kartavaya account already. Adding them here places them in this
          organisation with no module access until you grant it.
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
              {adding ? 'Adding…' : 'Add member'}
            </Button>
          </div>
        </div>
      </section>

      <Sheet
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing ? `Module access — ${editing.member.full_name || editing.member.email}` : ''}
      >
        {editing && (
          <>
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
