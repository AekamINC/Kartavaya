/**
 * AdminOrgsPage — the cross-org console. 11-platform-admin.md §1, §5.
 *
 * 11 §5: "Split; table redesign; per-org R2 credentials keep their mandatory
 * verify step."
 *
 * ── Split ────────────────────────────────────────────────────────────────────
 *
 * The page was one 39,894-byte file holding four unrelated screens stacked
 * vertically: a create form, a PLATFORM ROLE assigner, an org list, and a
 * 300-line org detail panel. Two are gone from here:
 *
 *  · Platform role assignment was never about organisations. It grants Aekam
 *    staff access to the console itself, so it moved to the people surface at
 *    `/admin` — where 11 §2 puts it ("all users… platform role assignment").
 *  · The list, the detail panel and the slide-over chrome are now
 *    `pages/admin/OrgTable.jsx` and `pages/admin/SlideOver.jsx`.
 *
 * ── The RBAC defect this page was carrying ───────────────────────────────────
 *
 * The assign dropdown offered `platform_admin · account_manager ·
 * account_finance · developer · srijan_admin`. As of today's role tiers:
 * `account_manager` is SUPERSEDED and reaches nothing, `developer` is not a
 * role code at all, and `platform_manager` and `platform_staff` — the two roles
 * an Aekam colleague should normally be given — were not offered. Granting the
 * obvious second option produced a user who could sign in and reach nothing.
 * The vocabulary now comes from `pages/admin/platformRoles.js`, transcribed
 * from `backend/middleware/role_tiers.py`.
 *
 * ── R2, and where the verify is actually mandatory ───────────────────────────
 *
 * `PUT /v1/admin/orgs/:id/r2` calls `verify_r2_credentials` and 400s on
 * failure, so the update path is safe whatever the UI does. `POST
 * /v1/admin/orgs` does NOT — it goes straight to `create_org_bucket` with
 * whatever it was handed. On the create path the client is the only gate, so
 * Create stays disabled until Verify has passed.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../lib/api';
import {
  Button, Card, CardBody, Field, Input, Select, Chip, ChipRow, Tag,
  EmptyState, ErrorState, errorKind, SkeletonPage, ConfirmDialog,
  StatTile, useToast,
} from '../components/ui';
import { currentUser } from '../lib/auth';
import { inr } from '../lib/inr';
import OrgTable, { ORG_FILTERS, selectOrgs, formatBytes } from './admin/OrgTable';
import SlideOver from './admin/SlideOver';
import { canSuspendOrg } from './admin/platformRoles';
import '../styles/admin.css';

/* Module codes as `require_module(...)` spells them, with the sensitive set
   marked. START-HERE, decision 2: Vetana, Ganit and Manav default to no access
   BY ROLE — the marking here is so an operator switching a module on for a
   whole org knows which ones carry employee and financial records. */
const ALL_MODULES = [
  { code: 'graha', label: 'Graha · CRM' },
  { code: 'vikray', label: 'Vikray · Sales' },
  { code: 'prachar', label: 'Prachar · Marketing' },
  { code: 'srijan', label: 'Srijan · AI' },
  { code: 'dristi', label: 'Dristi · Analytics' },
  { code: 'samvada', label: 'Sanvaad · Messaging' },
  { code: 'varta', label: 'Varta · WhatsApp' },
  { code: 'esign', label: 'eSign' },
  { code: 'pahchan', label: 'Pahchan · Attendance', sensitive: true },
  { code: 'ganit', label: 'Ganit · Invoicing', sensitive: true },
  { code: 'manav', label: 'Manav · HRMS', sensitive: true },
  { code: 'vetana', label: 'Vetana · Payroll', sensitive: true },
];

const PLANS = [
  { code: 'free', label: 'Free', credits: 0 },
  { code: 'starter', label: 'Starter', credits: 500 },
  { code: 'growth', label: 'Growth', credits: 1000 },
  { code: 'scale', label: 'Scale', credits: 2000 },
];

const EMPTY_ORG = {
  name: '', owner_email: '', plan_code: 'starter',
  markup_pct: 0.3, monthly_credits: 500, monthly_price: 10000, max_users: 5,
};
const EMPTY_R2 = { account_id: '', access_key_id: '', secret_access_key: '', bucket_name: 'kartavya-storage' };

/* ── Create ────────────────────────────────────────────────────────────────── */

function CreateOrgPanel({ open, onClose, onCreated }) {
  const { pushToast } = useToast();
  const [form, setForm] = useState(EMPTY_ORG);
  const [r2, setR2] = useState(EMPTY_R2);
  const [withR2, setWithR2] = useState(false);
  const [verified, setVerified] = useState(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY_ORG); setR2(EMPTY_R2); setWithR2(false); setVerified(null);
  }, [open]);

  /* Re-verification is required after any credential edit, or a "✓ Verified"
     badge outlives the keys it was granted for. */
  const editR2 = patch => { setR2(f => ({ ...f, ...patch })); setVerified(null); };

  const verify = async () => {
    if (!r2.account_id || !r2.access_key_id || !r2.secret_access_key) {
      pushToast({ type: 'error', title: 'Fill every R2 field before verifying' });
      return;
    }
    setBusy('verify');
    try {
      const res = await api.post('/v1/admin/orgs/r2/verify', r2);
      setVerified(Boolean(res.data?.valid));
      pushToast(res.data?.valid
        ? { type: 'success', title: 'R2 credentials verified', message: `${res.data.buckets?.length ?? 0} bucket(s) reachable` }
        : { type: 'error', title: 'R2 credentials rejected', message: res.data?.error });
    } catch (e) {
      setVerified(false);
      pushToast({ type: 'error', title: e?.response?.data?.detail || 'Verification failed' });
    } finally { setBusy(''); }
  };

  const blocked = withR2 && verified !== true;

  const submit = async () => {
    if (!form.name.trim() || !form.owner_email.trim()) {
      pushToast({ type: 'error', title: 'Name and owner email are both required' });
      return;
    }
    setBusy('create');
    try {
      const payload = { ...form };
      if (withR2) payload.r2 = r2;
      const res = await api.post('/v1/admin/orgs', payload);
      pushToast({ type: 'success', title: `${res.data?.name || form.name} created`, message: `Plan: ${res.data?.plan}` });
      onCreated();
      onClose();
    } catch (e) {
      pushToast({ type: 'error', title: e?.response?.data?.detail || 'Could not create the organisation' });
    } finally { setBusy(''); }
  };

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title="New organisation"
      subtitle="The owner must already have an account — orgs are attached to a person, not created empty."
      footer={(
        <>
          <Button variant="fill" disabled={busy === 'create' || blocked} onClick={submit}>
            {busy === 'create' ? 'Creating…' : 'Create organisation'}
          </Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </>
      )}
    >
      <div className="adm-form">
        <Field label="Organisation name" htmlFor="co-name">
          {p => <Input {...p} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Acme & Co" />}
        </Field>
        <Field label="Owner email" htmlFor="co-owner" hint="Must be a registered user.">
          {p => <Input {...p} type="email" value={form.owner_email} onChange={e => setForm(f => ({ ...f, owner_email: e.target.value }))} placeholder="ca@acme.in" />}
        </Field>
        <Field label="Plan" htmlFor="co-plan">
          {p => (
            <Select
              {...p}
              value={form.plan_code}
              onChange={e => {
                const plan = PLANS.find(x => x.code === e.target.value);
                setForm(f => ({ ...f, plan_code: e.target.value, monthly_credits: plan ? plan.credits : f.monthly_credits }));
              }}
            >
              {PLANS.map(p2 => <option key={p2.code} value={p2.code}>{p2.label}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Markup %" htmlFor="co-markup" hint="Applied to metered AI and scraper cost.">
          {p => (
            <Input
              {...p} type="number" min="0" max="100" step="1"
              value={Math.round(form.markup_pct * 100)}
              onChange={e => setForm(f => ({ ...f, markup_pct: Number(e.target.value) / 100 }))}
            />
          )}
        </Field>
        <Field label="Monthly credits" htmlFor="co-credits">
          {p => <Input {...p} type="number" min="0" step="50" value={form.monthly_credits} onChange={e => setForm(f => ({ ...f, monthly_credits: Number(e.target.value) }))} />}
        </Field>
        <Field label="Monthly price ₹" htmlFor="co-price">
          {p => <Input {...p} type="number" min="0" step="500" value={form.monthly_price} onChange={e => setForm(f => ({ ...f, monthly_price: Number(e.target.value) }))} />}
        </Field>
        <Field
          label="Seats"
          htmlFor="co-seats"
          hint="Sold in fives from a floor of five, but a negotiated 12 must stay typable."
        >
          {p => <Input {...p} type="number" min="1" step="5" value={form.max_users} onChange={e => setForm(f => ({ ...f, max_users: Number(e.target.value) }))} />}
        </Field>
      </div>

      <div className="apg__sec">
        <div className="apg__sech">
          <h3 className="apg__sect">Cloudflare R2</h3>
          <Button variant="text" size="sm" onClick={() => { setWithR2(v => !v); setVerified(null); }}>
            {withR2 ? 'Skip for now' : 'Configure a per-org bucket'}
          </Button>
        </div>

        {withR2 && (
          <>
            <div className="adm-form adm-form--tight">
              <Field label="Account ID" htmlFor="r2-acct">
                {p => <Input {...p} value={r2.account_id} onChange={e => editR2({ account_id: e.target.value })} />}
              </Field>
              <Field label="Bucket name" htmlFor="r2-bucket">
                {p => <Input {...p} value={r2.bucket_name} onChange={e => editR2({ bucket_name: e.target.value })} />}
              </Field>
              <Field label="Access key ID" htmlFor="r2-key">
                {p => <Input {...p} value={r2.access_key_id} onChange={e => editR2({ access_key_id: e.target.value })} />}
              </Field>
              <Field label="Secret access key" htmlFor="r2-secret">
                {p => <Input {...p} type="password" value={r2.secret_access_key} onChange={e => editR2({ secret_access_key: e.target.value })} />}
              </Field>
            </div>
            <div className="adm-actions">
              <Button variant="out" size="sm" disabled={busy === 'verify'} onClick={verify}>
                {busy === 'verify' ? 'Verifying…' : verified === true ? 'Verified' : 'Verify credentials'}
              </Button>
              {verified === true && <Tag color="var(--ok)">Verified</Tag>}
              {verified === false && <Tag color="var(--danger)">Rejected</Tag>}
            </div>
            {/* POST /v1/admin/orgs does not verify. Saying so is more useful
                than a disabled button with no explanation. */}
            <p className="inb__note">
              Creation does not verify R2 server-side — only the update path does. Verify
              here, or the org is created pointing at a bucket nobody can write to.
            </p>
          </>
        )}
      </div>
    </SlideOver>
  );
}

/* ── Detail ────────────────────────────────────────────────────────────────── */

function OrgDetailPanel({ orgId, onClose, onChanged }) {
  const { pushToast } = useToast();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState('');
  const [billing, setBilling] = useState(null);
  const [addEmail, setAddEmail] = useState('');
  const [addRole, setAddRole] = useState('org_member');
  const [confirm, setConfirm] = useState(null);

  const me = currentUser();
  const maySuspend = canSuspendOrg(me?.platform_roles);

  const load = useCallback(() => api
    .get(`/v1/admin/orgs/${orgId}`)
    .then(r => {
      setData(r.data);
      const o = r.data?.org || {};
      setBilling({
        markup: Math.round((o.markup_pct ?? 0.3) * 100),
        credits: o.monthly_credits ?? 0,
        price: o.monthly_price ?? 0,
      });
    })
    .catch(setErr), [orgId]);

  useEffect(() => { load(); }, [load]);

  if (err) {
    return (
      <SlideOver open onClose={onClose} title="Organisation">
        <ErrorState kind={errorKind(err)} grant="platform access to this organisation" onRetry={load} />
      </SlideOver>
    );
  }
  if (!data) return <SlideOver open onClose={onClose} title="Loading…"><SkeletonPage /></SlideOver>;

  const { org, members = [], modules = [], member_modules = [] } = data;
  const enabled = modules.filter(m => m.is_active).map(m => m.module_code);

  const grouped = Object.values(members.reduce((acc, m) => {
    if (!acc[m.user_id]) acc[m.user_id] = { ...m, roles: [] };
    acc[m.user_id].roles.push(m.role_code);
    return acc;
  }, {}));

  const act = async (label, fn) => {
    setBusy(label);
    try { await fn(); await load(); onChanged?.(); }
    catch (e) { pushToast({ type: 'error', title: e?.response?.data?.detail || 'That did not go through' }); }
    finally { setBusy(''); }
  };

  const billingChanged = billing && (
    billing.markup !== Math.round((org.markup_pct ?? 0.3) * 100)
    || billing.credits !== (org.monthly_credits ?? 0)
    || billing.price !== (org.monthly_price ?? 0)
  );

  return (
    <>
      <SlideOver
        open
        onClose={onClose}
        title={org.name || 'Organisation'}
        subtitle={`${org.plan_name || 'No plan'} · ${org.owner_email || 'No owner'}`}
      >
        <div className="adm-kv">
          <div>
            <div className="adm-kv__k">Org ID</div>
            <div className="adm-kv__v is-mono">{org.id}</div>
          </div>
          <div>
            <div className="adm-kv__k">Team ID</div>
            <div className="adm-kv__v is-mono">{org.team_id || '—'}</div>
          </div>
          <div>
            <div className="adm-kv__k">Storage</div>
            <div className="adm-kv__v">
              {formatBytes(org.storage_used_bytes)} of {org.storage_limit_bytes > 0 ? formatBytes(org.storage_limit_bytes) : 'unlimited'}
            </div>
          </div>
          <div>
            <div className="adm-kv__k">R2 bucket</div>
            <div className="adm-kv__v">{org.r2_bucket_name || (org.r2_account_id ? 'Configured' : 'Not configured')}</div>
          </div>
        </div>

        <section className="apg__sec">
          <div className="apg__sech"><h3 className="apg__sect">Billing</h3></div>
          <div className="adm-form adm-form--tight">
            <Field label="Markup %" htmlFor="ob-markup">
              {p => <Input {...p} type="number" min="0" max="100" step="1" value={billing.markup} onChange={e => setBilling(b => ({ ...b, markup: Number(e.target.value) }))} />}
            </Field>
            <Field label="Monthly credits" htmlFor="ob-credits">
              {p => <Input {...p} type="number" min="0" step="50" value={billing.credits} onChange={e => setBilling(b => ({ ...b, credits: Number(e.target.value) }))} />}
            </Field>
            <Field label="Monthly price ₹" htmlFor="ob-price">
              {p => <Input {...p} type="number" min="0" step="500" value={billing.price} onChange={e => setBilling(b => ({ ...b, price: Number(e.target.value) }))} />}
            </Field>
          </div>
          {billingChanged && (
            <div className="adm-actions">
              <Button
                variant="fill" size="sm" disabled={busy === 'billing'}
                onClick={() => act('billing', () => api.patch(`/v1/admin/orgs/${orgId}/settings`, {
                  markup_pct: billing.markup / 100,
                  monthly_credits: billing.credits,
                  monthly_price: billing.price,
                }))}
              >
                {busy === 'billing' ? 'Saving…' : 'Save billing'}
              </Button>
            </div>
          )}
        </section>

        <section className="apg__sec">
          <div className="apg__sech">
            <h3 className="apg__sect">Modules</h3>
            <span className="apg__secn">{enabled.length} of {ALL_MODULES.length}</span>
          </div>
          <div className="adm-mods">
            {ALL_MODULES.map(m => {
              const on = enabled.includes(m.code);
              const cls = ['adm-mod', on ? 'on' : '', m.sensitive ? 'is-sensitive' : ''].filter(Boolean).join(' ');
              return (
                <button
                  key={m.code}
                  type="button"
                  className={cls}
                  aria-pressed={on}
                  disabled={busy === m.code}
                  onClick={() => act(m.code, () => (on
                    ? api.delete(`/v1/admin/orgs/${orgId}/modules/${m.code}`)
                    : api.post(`/v1/admin/orgs/${orgId}/modules/${m.code}`)))}
                >
                  {m.label}
                  {m.sensitive && <span className="adm-mod__s">Sensitive</span>}
                </button>
              );
            })}
          </div>
        </section>

        <section className="apg__sec">
          <div className="apg__sech">
            <h3 className="apg__sect">Members</h3>
            <span className="apg__secn">{grouped.length}</span>
          </div>

          {grouped.length === 0 && (
            <EmptyState
              title={{ en: 'No members yet', hi: 'कोई सदस्य नहीं' }}
              description="The owner is added when the organisation is created; everyone else is added here."
            />
          )}

          {grouped.map(m => {
            const mods = member_modules.filter(mm => mm.user_id === m.user_id).map(mm => mm.module_code);
            const isAdmin = m.roles.some(r => r === 'org_admin' || r === 'org_owner');
            return (
              <div className="adm-kv" key={m.user_id}>
                <div>
                  <div className="adm-kv__k">{m.full_name || m.email}</div>
                  <div className="adm-kv__v">
                    {m.roles.join(' · ')}
                    {isAdmin ? ' — reaches every enabled module' : mods.length ? ` — ${mods.join(', ')}` : ' — no module grants'}
                  </div>
                </div>
                <div className="adm-actions">
                  <Button
                    size="sm" variant="danger" disabled={busy === m.user_id}
                    onClick={() => setConfirm({
                      title: 'Remove member',
                      message: `${m.email} loses access to ${org.name} immediately. Their records stay.`,
                      confirmLabel: 'Remove',
                      onConfirm: () => act(m.user_id, () => api.delete(`/v1/admin/orgs/${orgId}/members/${m.user_id}`)),
                    })}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            );
          })}

          <div className="adm-form adm-form--tight">
            <Field label="Add a member" htmlFor="om-email">
              {p => (
                <Input
                  {...p} type="email" value={addEmail} placeholder="person@acme.in"
                  onChange={e => setAddEmail(e.target.value)}
                />
              )}
            </Field>
            <Field label="Org role" htmlFor="om-role">
              {p => (
                <Select {...p} value={addRole} onChange={e => setAddRole(e.target.value)}>
                  <option value="org_member">Org member</option>
                  <option value="org_admin">Org admin</option>
                </Select>
              )}
            </Field>
          </div>
          <div className="adm-actions">
            <Button
              variant="out" size="sm"
              disabled={!addEmail.trim() || busy === 'add'}
              onClick={() => act('add', async () => {
                await api.post(`/v1/admin/orgs/${orgId}/members`, { email: addEmail.trim(), roles: [addRole], module_grants: [] });
                setAddEmail('');
              })}
            >
              {busy === 'add' ? 'Adding…' : 'Add member'}
            </Button>
            {/* A new grant starts at the least it can be and is raised
                deliberately — role_tiers.DEFAULT_GRANT_LEVEL. */}
            <span className="apg__secn">Module grants start empty and are raised per module.</span>
          </div>
        </section>

        <section className="adm-danger">
          <div className="adm-danger__t">Aekam only</div>
          <p className="adm-danger__d">
            Suspending an organisation, deleting it and transferring its ownership moved
            off <b>org_owner</b> onto Aekam platform staff. Suspension cancels the
            subscription and locks every member out at the next request.
          </p>
          <div className="adm-actions">
            <Button
              variant="danger"
              disabled={!maySuspend || !org.is_active || busy === 'suspend'}
              onClick={() => setConfirm({
                title: `Suspend ${org.name}?`,
                message: 'Every member is locked out and the subscription is cancelled. This is reversible only in the database today — there is no un-suspend endpoint.',
                confirmLabel: 'Suspend',
                confirmText: org.name,
                onConfirm: () => act('suspend', () => api.patch(`/v1/admin/orgs/${orgId}/deactivate`)),
              })}
            >
              {org.is_active ? 'Suspend organisation' : 'Already suspended'}
            </Button>
            {!maySuspend && <span className="apg__secn">Platform owner only.</span>}
          </div>
          {/* Deletion is queued for 7 days rather than executed (START-HERE,
              decision 4) and ownership transfer is its sibling. Neither endpoint
              exists yet, and a button that 404s is worse than an absent one, so
              they are named here and not offered. */}
          <p className="adm-danger__d">
            Deletion (7-day queue) and ownership transfer are not wired: the console has
            no endpoint for either. They are the two remaining platform-only actions.
          </p>
        </section>
      </SlideOver>

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────────── */

export default function AdminOrgsPage() {
  const { pushToast } = useToast();
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState(null);
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    return api.get('/v1/admin/orgs')
      .then(r => { setOrgs(r.data?.data || []); setErr(null); })
      .catch(e => { setErr(e); pushToast({ type: 'error', title: 'Could not load organisations' }); })
      .finally(() => setLoading(false));
  }, [pushToast]);

  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => selectOrgs(orgs, { q, filter, sort }), [orgs, q, filter, sort]);

  /* 07 §7: the count of Pahchan users per org and nothing else. The column
     appears only if the payload carries the aggregate, so it is not a dead
     em-dash column until `staging.pahchan_org_usage` is wired through. */
  const showPahchan = orgs.some(o => o.pahchan_active_users != null);

  const totals = useMemo(() => ({
    orgs: orgs.length,
    active: orgs.filter(o => o.is_active).length,
    suspended: orgs.filter(o => !o.is_active).length,
    mrr: orgs.reduce((s, o) => s + (Number(o.monthly_price) || 0), 0),
  }), [orgs]);

  if (loading && orgs.length === 0) return <SkeletonPage withStats withTable />;
  if (err && orgs.length === 0) return <ErrorState kind={errorKind(err)} grant="platform access to the console" onRetry={load} />;

  return (
    <div className="apg">
      <header className="apg__head">
        <div className="apg__titles">
          <h1 className="apg__t">
            Organisations
            <span className="apg__hi" lang="hi" aria-hidden="true">संस्थाएँ</span>
          </h1>
          <p className="apg__lede">Every customer on the platform, what they pay, and what they have switched on.</p>
        </div>
        <div className="apg__acts">
          <Button variant="fill" onClick={() => setCreating(true)}>New organisation</Button>
        </div>
      </header>

      <div className="apg__grid">
        <StatTile label="Organisations" sanskrit="संस्थाएँ" value={totals.orgs} />
        <StatTile label="Active" value={totals.active} variant="ok" />
        <StatTile label="Suspended" value={totals.suspended} variant={totals.suspended ? 'danger' : 'neutral'} />
        <StatTile label="Contracted monthly" value={inr(totals.mrr)} sub="sum of per-org price" />
      </div>

      <div className="apg__tools">
        <Input
          aria-label="Search organisations"
          placeholder="Name, owner, plan or id…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        <ChipRow>
          {ORG_FILTERS.map(f => (
            <Chip key={f.id} on={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</Chip>
          ))}
        </ChipRow>
        <span className="apg__spacer" />
        <span className="apg__secn">{shown.length} of {orgs.length}</span>
      </div>

      <Card>
        <CardBody flush>
          {shown.length === 0 ? (
            <EmptyState
              title={{ en: q || filter !== 'all' ? 'No organisation matches' : 'No organisations yet', hi: 'कुछ नहीं मिला' }}
              description={q || filter !== 'all'
                ? 'A filtered list reaching zero is not the same as an empty one — clear the filters to see everything.'
                : 'Create the first one to get started.'}
              action={q || filter !== 'all' ? 'Clear filters' : undefined}
              onAction={() => { setQ(''); setFilter('all'); }}
            />
          ) : (
            <OrgTable
              orgs={shown}
              sort={sort}
              onSort={setSort}
              onSelect={o => setSelected(o.id)}
              showPahchan={showPahchan}
            />
          )}
        </CardBody>
      </Card>

      <CreateOrgPanel open={creating} onClose={() => setCreating(false)} onCreated={load} />
      {selected && (
        <OrgDetailPanel
          orgId={selected}
          onClose={() => { setSelected(null); load(); }}
          onChanged={load}
        />
      )}
    </div>
  );
}
