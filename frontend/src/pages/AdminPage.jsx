/**
 * AdminPage — the platform console index at `/admin`. 11-platform-admin.md.
 *
 * ── 11's line-level surprise, and the correction ─────────────────────────────
 *
 * 11 §5 says of this file: "Platform half moves to /admin/*; project-level user
 * management to org/TabMembers.jsx. **Not read in full**." Read in full, that
 * prescription inverts.
 *
 * There is no project-level half. `GET /api/admin/users` is
 *
 *     SELECT … FROM users ORDER BY created_at DESC        invite_router.py:86
 *
 * with no org filter and no team filter, behind
 * `require_platform_role(*CONSOLE_ROLES)` — every account on the platform,
 * gated on a Tier-1 role. `/admin/invites` and `/admin/teams` are the same
 * shape. So this file was never a member list that leaked onto the console; it
 * IS the `/admin/users` screen 11 §2 asks for ("all users, slide-over detail,
 * platform role assignment"), sitting under the wrong name.
 *
 * It is therefore kept and completed rather than dismantled. The one piece that
 * genuinely did not belong has gone: `<BrandKit mode="manage" />` writes to
 * `PUT /settings`, which is the OPERATOR's own workspace. Editing your own
 * brand colours from a violet surface headed "Aekam platform" is precisely the
 * confusion 11 §1 introduces the violet to prevent. It belongs in org settings
 * (`10-org-settings.md`), where ProjectsPage already uses the same component.
 *
 * Platform role assignment arrives here from `AdminOrgsPage.jsx`, where it had
 * been filed under organisations despite granting access to the console rather
 * than to any org — and where its dropdown was two roles out of date.
 *
 * ── Why four tabs and not four routes ────────────────────────────────────────
 *
 * 11 §2 wants `/admin/dashboard`, `/admin/users`, `/admin/support`,
 * `/admin/settings`. `App.jsx` and `components/admin/adminNav.js` define four
 * admin routes and both are outside this batch's ownership, so the surfaces
 * that have no route live as tabs under the one route they can reach. Splitting
 * them is a routing change, not a rewrite of this file.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { api } from '../lib/api';
import {
  Button, Card, CardHead, CardBody, Field, Input, Select, Toggle, Tag, Tabs,
  Modal, ConfirmDialog, EmptyState, ErrorState, errorKind, SkeletonPage,
  Table, TableHead, TableBody, Row, Cell, HeadCell,
  Avatar, StatTile, useToast,
} from '../components/ui';
import { currentUser } from '../lib/auth';
import SlideOver from './admin/SlideOver';
import { ASSIGNABLE_ROLES, PLATFORM_ROLES, roleMeta, roleColor, isGodMode, canOpenConsole } from './admin/platformRoles';
import '../styles/admin.css';
import { useLanguage } from '../components/CustomizePanel';
import { secondaryOf } from '../lib/labels';
import { Secondary } from '../components/Bilingual';
import useColumnPrefs from '../hooks/useColumnPrefs';
import { ColumnsButton } from '../components/ui/CustomizeColumns';
import { apiErrorText } from '../lib/apiError';

/**
 * The four record lists on this console, declared once each.
 *
 * `fixed` is on the column that NAMES the row and on the actions cell, every
 * time. On three of these the actions cell holds the only destructive control
 * the page has — revoke a platform role, remove an account, revoke an invite —
 * and an arrangement saved months ago that hid it would leave an operator
 * staring at a row they cannot act on with no way to work out why.
 *
 * The roles list is three columns of which two are pinned, so only Roles can be
 * hidden. That is not an argument against declaring it: the WIDTHS are the
 * point on that table — a person cell carrying a name over an address, beside a
 * wrapping row of tags — and a width is as persisted as a visibility.
 */
const PLATFORM_ROLE_COLUMNS = [
  { id: 'person', label: 'Person', fixed: true },
  { id: 'roles', label: 'Roles' },
  { id: 'actions', label: 'Actions', sr: true, fixed: true },
];

const R2_PROJECT_COLUMNS = [
  { id: 'project', label: 'Project', fixed: true },
  { id: 'folder', label: 'Folder' },
  { id: 'actions', label: 'Actions', sr: true, fixed: true },
];

const ACCOUNT_COLUMNS = [
  { id: 'person', label: 'Person', fixed: true },
  { id: 'type', label: 'Account type' },
  { id: 'org', label: 'Organisation' },
  { id: 'joined', label: 'Joined' },
  { id: 'actions', label: 'Actions', sr: true, fixed: true },
];

const INVITE_COLUMNS = [
  { id: 'invited', label: 'Invited', fixed: true },
  { id: 'type', label: 'Account type' },
  { id: 'expires', label: 'Expires' },
  { id: 'actions', label: 'Actions', sr: true, fixed: true },
];

/** The same head, four times over — see the twin in AdminCostDashboardPage. */
function ArrangedHead({ cols }) {
  return (
    <TableHead>
      {cols.columns.map(c => (
        <HeadCell
          key={c.id}
          num={c.num}
          width={c.width}
          onResize={w => cols.setWidth(c.id, w)}
        >
          {c.sr ? <span className="k-sr-only">{c.label}</span> : c.label}
        </HeadCell>
      ))}
    </TableHead>
  );
}

const EMPTY_INVITE = { full_name: '', email: '', role: 'member', member_role: '', receives_approval_emails: true };

const ACCOUNT_TYPES = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' },
  { value: 'client', label: 'Client' },
];

const fmtDate = d => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

/* Account type is not a platform role and never was. It is coloured from the
   semantic set rather than from a private map of hexes — the previous one was
   the eighth such map, and it painted `admin` in the retired brand blue. */
const ACCOUNT_TONE = {
  admin: 'var(--warn)',
  client: 'var(--st-in-review)',
  member: 'var(--on-surface-3)',
  owner: 'var(--danger)',
};

/* ── Password reset ────────────────────────────────────────────────────────── */

function ResetLinkButton({ userId, size = 'sm' }) {
  const { pushToast } = useToast();
  const [state, setState] = useState('idle');

  const send = async () => {
    setState('sending');
    try {
      await api.post(`/admin/users/${userId}/send-reset-link`);
      setState('sent');
      pushToast({ type: 'success', title: 'Reset link sent', message: 'They will receive a password reset email.' });
      setTimeout(() => setState('idle'), 4000);
    } catch {
      setState('idle');
      pushToast({ type: 'error', title: 'Could not send the reset link' });
    }
  };

  return (
    <Button variant="out" size={size} disabled={state !== 'idle'} onClick={send}>
      {state === 'sent' ? 'Link sent' : state === 'sending' ? 'Sending…' : 'Send reset link'}
    </Button>
  );
}

/* ── Edit ──────────────────────────────────────────────────────────────────── */

function EditUserPanel({ user, onClose, onSaved }) {
  const { pushToast } = useToast();
  const [form, setForm] = useState(() => ({
    full_name: user.full_name || '',
    role: user.role || 'member',
    member_role: user.member_role || '',
    company_name: user.company_name || '',
    receives_approval_emails: user.receives_approval_emails !== false,
  }));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.patch(`/admin/users/${user.user_id}`, {
        full_name: form.full_name.trim() || null,
        role: form.role,
        member_role: form.member_role.trim() || null,
        company_name: form.company_name.trim() || null,
        receives_approval_emails: form.receives_approval_emails,
      });
      pushToast({ type: 'success', title: 'User updated' });
      onSaved(res.data);
      onClose();
    } catch (e) {
      pushToast({ type: 'error', title: apiErrorText(e, 'Could not save') });
    } finally { setSaving(false); }
  };

  return (
    <SlideOver
      open
      onClose={onClose}
      title={user.full_name || user.email}
      subtitle={user.email}
      footer={(
        <>
          <Button variant="fill" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save changes'}</Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <span className="apg__spacer" />
          <ResetLinkButton userId={user.user_id} />
        </>
      )}
    >
      <div className="adm-form">
        <Field label="Full name" htmlFor="eu-name">
          {p => <Input {...p} value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} />}
        </Field>
        <Field label="Account type" htmlFor="eu-role">
          {p => (
            <Select {...p} value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              {ACCOUNT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Job title" htmlFor="eu-title">
          {p => <Input {...p} value={form.member_role} onChange={e => setForm(f => ({ ...f, member_role: e.target.value }))} placeholder="Audit manager" />}
        </Field>
        <Field label="Company" htmlFor="eu-company">
          {p => <Input {...p} value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} />}
        </Field>
      </div>

      {form.role === 'client' && (
        <div className="fld">
          <span className="fld__l">Client approval emails</span>
          <div className="adm-actions">
            <Toggle
              checked={form.receives_approval_emails}
              label="Receives client approval emails"
              onChange={v => setForm(f => ({ ...f, receives_approval_emails: v }))}
            />
            <span className="adm-kv__v">{form.receives_approval_emails ? 'On' : 'Off'}</span>
          </div>
          <span className="fld__hint">Emailed whenever a task or project needs their sign-off.</span>
        </div>
      )}

      <div className="adm-kv">
        <div>
          <div className="adm-kv__k">Email (immutable)</div>
          <div className="adm-kv__v is-mono">{user.email}</div>
        </div>
        {/* The "User ID" row is gone, 2026-08-07. The owner's rule is that no
            user, member or org id is displayed anywhere — including on Aekam's
            own screens, and including a person's own. Nothing in the product
            asks anyone to quote it, and support looks people up by name. */}
        <div>
          <div className="adm-kv__k">Provider</div>
          <div className="adm-kv__v">{user.provider || 'local'}</div>
        </div>
        <div>
          <div className="adm-kv__k">Joined</div>
          <div className="adm-kv__v">{fmtDate(user.created_at)}</div>
        </div>
      </div>
    </SlideOver>
  );
}

/* ── Remove ────────────────────────────────────────────────────────────────── */

/**
 * Removal needs a choice — who inherits their work — so it is a Modal rather
 * than a ConfirmDialog. It keeps ConfirmDialog's rule for the irreversible
 * case anyway: the name has to be typed.
 */
function RemoveUserModal({ user, others, onClose, onRemoved }) {
  const { pushToast } = useToast();
  const [reassign, setReassign] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  const name = user.full_name || user.name || user.email;
  const ready = typed.trim() === name;

  const remove = async () => {
    setBusy(true);
    try {
      await api.delete(`/admin/users/${user.user_id}${reassign ? `?reassign_to=${reassign}` : ''}`);
      pushToast({ type: 'success', title: `${name} removed` });
      onRemoved(user.user_id);
      onClose();
    } catch (e) {
      pushToast({ type: 'error', title: apiErrorText(e, 'Could not remove the user') });
    } finally { setBusy(false); }
  };

  return (
    <Modal
      open
      onOpenChange={onClose}
      size="sm"
      title={`Remove ${name}`}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="fill" disabled={!ready || busy} onClick={remove}>
            {busy ? 'Removing…' : 'Remove permanently'}
          </Button>
        </>
      )}
    >
      <p className="apg__lede">
        Tasks, comments and time entries created by <b>{name}</b> move to whoever you pick
        below, or become unassigned if you leave it blank. This cannot be undone.
      </p>
      <div className="adm-form adm-form--tight">
        <Field label="Reassign their work to" htmlFor="ru-reassign">
          {p => (
            <Select {...p} value={reassign} onChange={e => setReassign(e.target.value)}>
              <option value="">Leave unassigned</option>
              {others.map(u => (
                <option key={u.user_id} value={u.user_id}>
                  {u.full_name || u.name || u.email}{u.member_role ? ` · ${u.member_role}` : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={`Type "${name}" to confirm`} htmlFor="ru-typed">
          {p => <Input {...p} value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" />}
        </Field>
      </div>
    </Modal>
  );
}

/* ── Platform roles ────────────────────────────────────────────────────────── */

function PlatformRolesPanel() {
  const { pushToast } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('platform_staff');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const me = currentUser();
  const mayAssign = isGodMode(me?.platform_roles);

  /* Above the `!mayAssign` refusal further down: a manager who is refused has
     to render the same hooks as an owner who is not. */
  const roleCols = useColumnPrefs('admin.platform_roles', PLATFORM_ROLE_COLUMNS);

  /* `GET /roles/platform`, `/users/search`, `/roles/assign` and
     `DELETE /roles/{id}` are ALL guarded on SUPERUSER_ONLY_ROLES — a role that
     can grant roles can grant itself anything, so it is never delegated. Only
     the buttons were gated before, not the read, so a platform_manager opening
     this tab got a 403 toast and an empty table that read as "nobody holds a
     platform role" — the most misleading possible answer to that question. */
  const load = useCallback(() => {
    if (!mayAssign) { setLoading(false); return Promise.resolve(); }
    setLoading(true);
    return api.get('/v1/admin/orgs/roles/platform')
      .then(r => setRows(Array.isArray(r.data) ? r.data : []))
      .catch(() => pushToast({ type: 'error', title: 'Could not load platform roles' }))
      .finally(() => setLoading(false));
  }, [pushToast, mayAssign]);

  useEffect(() => { load(); }, [load]);

  const assign = async () => {
    if (!email.trim()) return;
    setBusy(true);
    try {
      const found = await api.get(`/v1/admin/orgs/users/search?email=${encodeURIComponent(email.trim())}`);
      const userId = found.data?.user_id;
      if (!userId) { pushToast({ type: 'error', title: 'No account with that email' }); return; }
      await api.post('/v1/admin/orgs/roles/assign', { user_id: userId, role_code: code });
      pushToast({ type: 'success', title: `${roleMeta(code).label} granted to ${email.trim()}` });
      setEmail('');
      await load();
    } catch (e) {
      pushToast({ type: 'error', title: apiErrorText(e, 'Could not assign the role') });
    } finally { setBusy(false); }
  };

  const grouped = useMemo(() => Object.values(rows.reduce((acc, r) => {
    if (!acc[r.user_id]) acc[r.user_id] = { ...r, codes: [] };
    acc[r.user_id].codes.push({ id: r.id, code: r.role_code });
    return acc;
  }, {})), [rows]);

  const selected = roleMeta(code);

  /* The vocabulary itself is not privileged — it is a static list in this
     file — so a non-owner still gets the reference table. What they do not get
     is a request that will 403 and a table that will read as empty. */
  const reference = (
    <Card>
      <CardHead title="What each role reaches" sanskrit="भूमिकाएँ" />
      <CardBody>
        <div className="adm-kv">
          {PLATFORM_ROLES.map(r => {
            const roleIn = secondaryOf(r.hi, lang);
            return (
            <div key={r.code}>
              <div className="adm-kv__k">
                {r.label}
                {roleIn.secondary && (
                  <Secondary className="adm-kv__hi" value={roleIn.secondary} />
                )}
              </div>
              <div className="adm-kv__v">{r.blurb}</div>
            </div>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );

  if (!mayAssign) {
    return (
      <div className="apg__sec">
        <ErrorState kind="denied" grant="platform owner access — role assignment is never delegated" />
        {reference}
      </div>
    );
  }

  return (
    <>
      <div className="apg__sec">
        <Card>
          <CardHead
            title="Who holds a platform role"
            sanskrit="भूमिकाएँ"
            actions={(
              <>
                <span className="apg__secn">{grouped.length}</span>
                <ColumnsButton cols={roleCols} />
              </>
            )}
          />
          <CardBody flush>
            {loading ? <SkeletonPage /> : grouped.length === 0 ? (
              <EmptyState
                title={{ en: 'Nobody holds a platform role', hi: 'कोई भूमिका नहीं' }}
                description="Platform roles reach across every customer organisation. They are granted here and nowhere else."
              />
            ) : (
              <Table>
                <ArrangedHead cols={roleCols} />
                <TableBody>
                  {grouped.map(u => (
                    <Row key={u.user_id}>
                      {roleCols.cells({
                        person: (
                          <Cell>
                            <span className="adm-name">
                              <span className="adm-name__c">
                                <b>{u.full_name || u.email}</b>
                                <i>{u.email}</i>
                              </span>
                            </span>
                          </Cell>
                        ),
                        roles: (
                          <Cell>
                            <span className="adm-actions">
                              {u.codes.map(c => {
                                const meta = roleMeta(c.code);
                                return (
                                  <Tag key={c.id} color={roleColor(c.code)} title={meta.blurb}>
                                    {meta.label}
                                  </Tag>
                                );
                              })}
                            </span>
                          </Cell>
                        ),
                        actions: (
                          <Cell>
                            <span className="adm-actions">
                              {u.codes.map(c => (
                                <Button
                                  key={c.id}
                                  size="sm"
                                  variant="danger"
                                  disabled={!mayAssign}
                                  onClick={() => setConfirm({
                                    title: 'Revoke platform role',
                                    message: `${u.email} loses ${roleMeta(c.code).label} across every organisation.`,
                                    confirmLabel: 'Revoke',
                                    onConfirm: async () => {
                                      try {
                                        await api.delete(`/v1/admin/orgs/roles/${c.id}`);
                                        pushToast({ type: 'success', title: 'Role revoked' });
                                        await load();
                                      } catch (e) {
                                        pushToast({ type: 'error', title: apiErrorText(e, 'Could not revoke') });
                                      }
                                    },
                                  })}
                                >
                                  Revoke {roleMeta(c.code).label}
                                </Button>
                              ))}
                            </span>
                          </Cell>
                        ),
                      })}
                    </Row>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHead title="Grant a platform role" />
          <CardBody>
            <div className="adm-form">
              <Field label="Aekam colleague" htmlFor="pr-email" hint="They must already have an account.">
                {p => (
                  <Input
                    {...p} type="email" value={email} placeholder="name@aekam.com"
                    onChange={e => setEmail(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') assign(); }}
                  />
                )}
              </Field>
              <Field label="Role" htmlFor="pr-role" hint={selected.blurb}>
                {p => (
                  <Select {...p} value={code} onChange={e => setCode(e.target.value)}>
                    {/* Legacy codes are revoke-only. `account_manager` is
                        superseded and reaches nothing; offering it was how an
                        operator granted access that silently did not work. */}
                    {ASSIGNABLE_ROLES.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
                  </Select>
                )}
              </Field>
            </div>
            <div className="adm-actions">
              <Button variant="fill" disabled={busy || !email.trim()} onClick={assign}>
                {busy ? 'Granting…' : 'Grant role'}
              </Button>
            </div>
          </CardBody>
        </Card>

        {reference}
      </div>

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────────── */

export default function AdminPage() {
  const { pushToast } = useToast();
  const [users, setUsers] = useState([]);
  // Both null until their own request succeeds — never `[]` on failure.
  const [invites, setInvites] = useState(null);
  const [invitesErr, setInvitesErr] = useState(null);
  const [teams, setTeams] = useState(null);
  const [teamsErr, setTeamsErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const [q, setQ] = useState('');
  const [orgFilter, setOrgFilter] = useState('');
  const [teamQ, setTeamQ] = useState('');
  const [invite, setInvite] = useState(EMPTY_INVITE);
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState('');
  // The redemption link for the invite THIS operator just created, held in
  // memory for this render only. `GET /admin/invites` no longer carries
  // `invite_link` for anyone — the token in it is a working credential, and the
  // listing was serving every unclaimed one to every console role. See
  // backend/invite_router.py::list_invites.
  const [freshInvite, setFreshInvite] = useState(null);
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const me = currentUser();
  /* `/admin/users`, `/admin/invites` and `/admin/teams` are all guarded on
     `CONSOLE_ROLES`, which excludes `account_finance`, `sahayak_admin` and
     `platform_support`. The sidebar shows this entry to all three, so without
     the gate they land here, three requests fail, and the page resolves into a
     generic error. */
  const mayOpen = canOpenConsole(me?.platform_roles);

  const load = useCallback(() => {
    if (!mayOpen) { setLoading(false); return Promise.resolve(); }
    setLoading(true);
    setInvitesErr(null);
    setTeamsErr(null);
    /* Invites and teams are swallowed relative to `users` on purpose — one of
       them failing must not blank the whole console. What they must NOT do is
       leave their own section at `[]`, because the sections below render
       "No projects yet" and "No pending invitations" off exactly that value.
       Each keeps its own null-or-error pair so its own empty state stays a
       statement about the organisation rather than about the request. */
    return Promise.all([
      api.get('/admin/users').then(r => setUsers(Array.isArray(r.data) ? r.data : [])),
      api.get('/admin/invites')
        .then(r => { setInvites(Array.isArray(r.data) ? r.data : []); })
        .catch(e => { setInvites(null); setInvitesErr(e); }),
      api.get('/admin/teams')
        .then(r => { setTeams(Array.isArray(r.data) ? r.data : []); })
        .catch(e => { setTeams(null); setTeamsErr(e); }),
    ])
      .then(() => setErr(null))
      .catch(setErr)
      .finally(() => setLoading(false));
  }, [mayOpen]);

  useEffect(() => { load(); }, [load]);

  // Null propagates: unknown invites give an unknown pending list, not zero.
  const pending = useMemo(
    () => (invites === null
      ? null
      : invites.filter(i => !i.accepted_at && new Date(i.expires_at) > new Date())),
    [invites],
  );

  const orgOptions = useMemo(() => {
    const map = new Map();
    for (const u of users) {
      if (u.org_id && u.org_name) map.set(u.org_id, u.org_name);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [users]);

  const shownUsers = useMemo(() => {
    let list = users;
    if (orgFilter) list = list.filter(u => u.org_id === orgFilter);
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter(u => [u.full_name, u.name, u.email, u.org_name, u.member_role]
      .some(f => String(f || '').toLowerCase().includes(needle)));
  }, [users, q, orgFilter]);

  const shownTeams = useMemo(() => {
    if (teams === null) return null;
    const needle = teamQ.trim().toLowerCase();
    if (!needle) return teams;
    return teams.filter(t => `${t.name} ${t.team_id}`.toLowerCase().includes(needle));
  }, [teams, teamQ]);

  const roleCounts = useMemo(
    () => users.reduce((acc, u) => { acc[u.role] = (acc[u.role] || 0) + 1; return acc; }, {}),
    [users],
  );

  /* All three sit ABOVE the `canOpen` refusal, the loading skeleton and the
     error return below. Those three paths are the ones a first paint takes, and
     a page that renders fewer hooks on them than on the landed console throws
     the moment the read lands. */
  const projectCols = useColumnPrefs('admin.r2_projects', R2_PROJECT_COLUMNS);
  const accountCols = useColumnPrefs('admin.accounts', ACCOUNT_COLUMNS);
  const inviteCols = useColumnPrefs('admin.pending_invites', INVITE_COLUMNS);

  const copy = (text, key) => {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 2000);
  };

  const sendInvite = async () => {
    if (!invite.email.trim()) return;
    setSending(true);
    try {
      const r = await api.post('/admin/invites', {
        email: invite.email.trim(),
        full_name: invite.full_name.trim() || undefined,
        role: invite.role,
        member_role: invite.member_role.trim() || undefined,
        receives_approval_emails: invite.receives_approval_emails,
      });
      setFreshInvite({ invite_id: r?.data?.invite_id, invite_link: r?.data?.invite_link });
      pushToast({ type: 'success', title: 'Invite sent', message: 'Copy the link below if the email is slow — it is shown once.' });
      setInvite(EMPTY_INVITE);
      await load();
    } catch (e) {
      pushToast({ type: 'error', title: apiErrorText(e, 'Could not send the invite') });
    } finally { setSending(false); }
  };

  if (!mayOpen) {
    return (
      <div className="apg">
        <header className="apg__head">
          <div className="apg__titles">
            <h1 className="apg__t">
              Platform
              <Secondary className="apg__hi" value="प्रशासन" />
            </h1>
          </div>
        </header>
        <ErrorState kind="denied" grant="platform owner, manager or staff access to the accounts console" />
      </div>
    );
  }

  if (loading && users.length === 0) return <SkeletonPage withStats withTable />;
  if (err && users.length === 0) {
    return <ErrorState kind={errorKind(err)} grant="platform access to the console" onRetry={load} />;
  }

  const overviewTab = (
    <div className="apg__sec">
      <div className="apg__grid">
        <StatTile label="Accounts" sanskrit="खाते" value={users.length} sub="across the platform" />
        <StatTile label="Members" sanskrit="सदस्य" value={roleCounts.member || 0} />
        <StatTile label="Clients" sanskrit="ग्राहक" value={roleCounts.client || 0} sub="portal access" />
        {/* An em dash, not 0. A tile reading "0 pending invites" over a failed
            read tells an admin there is nothing to chase, which is the same
            false statement as the empty state below, just smaller. */}
        <StatTile
          label="Pending invites"
          sanskrit="लंबित"
          value={pending === null ? '—' : pending.length}
          variant={pending?.length ? 'warn' : 'neutral'}
        />
      </div>

      <Card>
        <CardHead
          title="R2 folder map"
          sanskrit="फ़ोल्डर"
          actions={(
            <>
              <Input
                aria-label="Search projects"
                placeholder="Project or team_id…"
                value={teamQ}
                onChange={e => setTeamQ(e.target.value)}
              />
              <ColumnsButton cols={projectCols} />
            </>
          )}
        />
        <CardBody flush>
          <p className="apg__lede apg__lede--inset">
            Attachments live under <code>projects/&#123;team_id&#125;/</code>. This is the
            lookup from a folder nobody can read to the project it belongs to.
          </p>
          {teamsErr ? (
            <ErrorState kind={errorKind(teamsErr)} grant="platform access to the console" onRetry={load} />
          ) : shownTeams === null ? (
            <SkeletonPage withTable />
          ) : shownTeams.length === 0 ? (
            <EmptyState
              title={{ en: teams.length ? 'No project matches' : 'No projects yet', hi: 'कुछ नहीं' }}
              description={teams.length ? 'Clear the search to see every folder.' : 'Folders appear as projects are created.'}
            />
          ) : (
            <Table>
              <ArrangedHead cols={projectCols} />
              <TableBody>
                {shownTeams.map(t => (
                  <Row key={t.team_id}>
                    {projectCols.cells({
                      project: <Cell>{t.name}</Cell>,
                      folder: <Cell><span className="adm-kv__v is-mono">{t.r2_folder}</span></Cell>,
                      actions: (
                        <Cell>
                          <Button size="sm" variant="ghost" onClick={() => copy(t.r2_folder, t.team_id)}>
                            {copied === t.team_id ? 'Copied' : 'Copy path'}
                          </Button>
                        </Cell>
                      ),
                    })}
                  </Row>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );

  const usersTab = (
    <div className="apg__sec">
      <div className="apg__tools">
        <Input
          aria-label="Search accounts"
          placeholder="Name, email or organisation…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        <select
          className="k-select k-select--sm"
          aria-label="Filter by organisation"
          value={orgFilter}
          onChange={e => setOrgFilter(e.target.value)}
        >
          <option value="">All organisations</option>
          {orgOptions.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
        <span className="apg__spacer" />
        <span className="apg__secn">{shownUsers.length} of {users.length}</span>
        <ColumnsButton cols={accountCols} />
      </div>

      <Card>
        <CardBody flush>
          {shownUsers.length === 0 ? (
            <EmptyState
              title={{ en: 'No account matches', hi: 'कोई खाता नहीं' }}
              description="A filtered list reaching zero is not an empty one — clear the search."
              action="Clear search"
              onAction={() => setQ('')}
            />
          ) : (
            <Table className="adm-rows">
              <ArrangedHead cols={accountCols} />
              <TableBody>
                {shownUsers.map(u => {
                  const isSelf = u.user_id === me?.user_id;
                  const name = u.full_name || u.name || u.email;
                  return (
                    <Row key={u.user_id} onClick={() => setEditing(u)}>
                      {accountCols.cells({
                        person: (
                          <Cell>
                            <span className="adm-name">
                              <Avatar name={name} src={u.avatar} size={28} />
                              <span className="adm-name__c">
                                <b>{name}{isSelf ? ' (you)' : ''}</b>
                                <i>{u.email}{u.member_role ? ` · ${u.member_role}` : ''}</i>
                              </span>
                            </span>
                          </Cell>
                        ),
                        type: <Cell><Tag color={ACCOUNT_TONE[u.role] || ACCOUNT_TONE.member}>{u.role}</Tag></Cell>,
                        org: <Cell>{u.org_name || '—'}</Cell>,
                        joined: <Cell>{fmtDate(u.created_at)}</Cell>,
                        actions: (
                          <Cell>
                            {/* The stopPropagation stays on the cell: the ROW
                                opens the editor, and a Remove click that also
                                opened it was the original defect here. */}
                            <span className="adm-actions" onClick={e => e.stopPropagation()} role="presentation">
                              <Button size="sm" variant="out" onClick={() => setEditing(u)}>Edit</Button>
                              <Button
                                size="sm"
                                variant="danger"
                                disabled={isSelf}
                                title={isSelf ? 'You cannot remove yourself' : undefined}
                                onClick={() => setRemoving(u)}
                              >
                                Remove
                              </Button>
                            </span>
                          </Cell>
                        ),
                      })}
                    </Row>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );

  const invitesTab = (
    <div className="apg__sec">
      <Card>
        <CardHead title="Invite someone" sanskrit="आमंत्रण" />
        <CardBody>
          {/* Invite-only. There is no open signup — START-HERE, decision 1. */}
          <div className="adm-form">
            <Field label="Full name" htmlFor="iv-name">
              {p => <Input {...p} value={invite.full_name} onChange={e => setInvite(f => ({ ...f, full_name: e.target.value }))} placeholder="Priya Shah" />}
            </Field>
            <Field label="Email" htmlFor="iv-email">
              {p => (
                <Input
                  {...p} type="email" value={invite.email}
                  onChange={e => setInvite(f => ({ ...f, email: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') sendInvite(); }}
                  placeholder="priya@acme.in"
                />
              )}
            </Field>
            <Field label="Account type" htmlFor="iv-role">
              {p => (
                <Select {...p} value={invite.role} onChange={e => setInvite(f => ({ ...f, role: e.target.value }))}>
                  {ACCOUNT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Job title" htmlFor="iv-title">
              {p => <Input {...p} value={invite.member_role} onChange={e => setInvite(f => ({ ...f, member_role: e.target.value }))} placeholder="Project stakeholder" />}
            </Field>
          </div>

          {invite.role === 'client' && (
            <div className="fld">
              <span className="fld__l">Client approval emails</span>
              <div className="adm-actions">
                <Toggle
                  checked={invite.receives_approval_emails}
                  label="Receives client approval emails"
                  onChange={v => setInvite(f => ({ ...f, receives_approval_emails: v }))}
                />
                <span className="adm-kv__v">{invite.receives_approval_emails ? 'On' : 'Off'}</span>
              </div>
            </div>
          )}

          <div className="adm-actions">
            <Button variant="fill" disabled={sending || !invite.email.trim()} onClick={sendInvite}>
              {sending ? 'Sending…' : 'Send invite'}
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHead
          title="Pending invites"
          actions={(
            <>
              <span className="apg__secn">{pending === null ? '—' : pending.length}</span>
              <ColumnsButton cols={inviteCols} />
            </>
          )}
        />
        <CardBody flush>
          {/* "Nothing is waiting" with the reassuring tick is the most
              dangerous empty state on this page: an admin who reads it stops
              chasing invitations. It must never appear over a failed read. */}
          {invitesErr ? (
            <ErrorState kind={errorKind(invitesErr)} grant="platform access to the console" onRetry={load} />
          ) : pending === null ? (
            <SkeletonPage withTable />
          ) : pending.length === 0 ? (
            <EmptyState
              icon="check"
              tone="ok"
              title={{ en: 'Nothing is waiting', hi: 'कुछ लंबित नहीं' }}
              description="Every invite sent has been accepted or has expired."
            />
          ) : (
            <Table>
              <ArrangedHead cols={inviteCols} />
              <TableBody>
                {pending.map(iv => {
                  const days = Math.ceil((new Date(iv.expires_at) - new Date()) / 86400000);
                  return (
                    <Row key={iv.invite_id}>
                      {inviteCols.cells({
                        invited: (
                          <Cell>
                            <span className="adm-name">
                              <span className="adm-name__c">
                                <b>{iv.full_name || iv.email}</b>
                                <i>{iv.full_name ? iv.email : ''}{iv.invited_by_name ? ` · by ${iv.invited_by_name}` : ''}</i>
                              </span>
                            </span>
                          </Cell>
                        ),
                        type: <Cell><Tag color={ACCOUNT_TONE[iv.role] || ACCOUNT_TONE.member}>{iv.role}</Tag></Cell>,
                        expires: (
                          <Cell>
                            <Tag color={days <= 1 ? 'var(--danger)' : 'var(--on-surface-3)'}>
                              {days <= 0 ? 'today' : `${days}d`}
                            </Tag>
                          </Cell>
                        ),
                        actions: (
                          <Cell>
                            <span className="adm-actions">
                              {freshInvite?.invite_id === iv.invite_id && freshInvite.invite_link ? (
                                <Button size="sm" variant="ghost" onClick={() => copy(freshInvite.invite_link, iv.invite_id)}>
                                  {copied === iv.invite_id ? 'Copied' : 'Copy link'}
                                </Button>
                              ) : null}
                              <Button
                                size="sm"
                                variant="danger"
                                onClick={() => setConfirm({
                                  title: 'Revoke invite',
                                  message: `The link sent to ${iv.email} stops working immediately.`,
                                  confirmLabel: 'Revoke',
                                  onConfirm: async () => {
                                    try {
                                      await api.delete(`/admin/invites/${iv.invite_id}`);
                                      setInvites(prev => prev.filter(x => x.invite_id !== iv.invite_id));
                                      pushToast({ type: 'success', title: 'Invite revoked' });
                                    } catch {
                                      pushToast({ type: 'error', title: 'Could not revoke the invite' });
                                      load();
                                    }
                                  },
                                })}
                              >
                                Revoke
                              </Button>
                            </span>
                          </Cell>
                        ),
                      })}
                    </Row>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );

  return (
    <div className="apg">
      <header className="apg__head">
        <div className="apg__titles">
          <h1 className="apg__t">
            Platform
            <Secondary className="apg__hi" value="प्रशासन" />
          </h1>
          <p className="apg__lede">
            Accounts, invites and platform roles — every one of these reaches across
            organisations, and every one of them is audited.
          </p>
        </div>
      </header>

      <Tabs
        tabs={[
          { value: 'overview', label: 'Overview', content: overviewTab },
          { value: 'users', label: 'Accounts', count: users.length, content: usersTab },
          { value: 'invites', label: 'Invites', count: pending?.length, content: invitesTab },
          { value: 'roles', label: 'Platform roles', content: <PlatformRolesPanel /> },
        ]}
      />

      {editing && (
        <EditUserPanel
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={updated => setUsers(prev => prev.map(u => (u.user_id === updated.user_id ? updated : u)))}
        />
      )}

      {removing && (
        <RemoveUserModal
          user={removing}
          others={users.filter(u => u.user_id !== removing.user_id && u.user_id !== me?.user_id)}
          onClose={() => setRemoving(null)}
          onRemoved={id => setUsers(prev => prev.filter(u => u.user_id !== id))}
        />
      )}

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
