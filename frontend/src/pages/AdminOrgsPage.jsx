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
  EmptyState, ErrorState, errorKind, SkeletonPage, ConfirmDialog, Modal,
  StatTile, useToast,
  Table, TableHead, TableBody, Row, Cell, HeadCell,
} from '../components/ui';
import { currentUser } from '../lib/auth';
import { inr, grouped } from '../lib/inr';
import OrgTable, { ORG_FILTERS, selectOrgs, formatBytes } from './admin/OrgTable';
import SlideOver from './admin/SlideOver';
import { canSuspendOrg, canManageBilling, canSeeCost } from './admin/platformRoles';
import BillingLinesBlock from './admin/BillingLinesBlock';
import { refusalMessage } from './admin/BillingLineRow';
import TopUpDialog from './admin/TopUpDialog';
import '../styles/admin.css';

/* Module codes as `require_module(...)` spells them, with the sensitive set
   marked. START-HERE, decision 2: Vetana, Ganit and Manav default to no access
   BY ROLE — the marking here is so an operator switching a module on for a
   whole org knows which ones carry employee and financial records.

   `wired: false` is the four codes `role_tiers.ALL_MODULES` knows about but
   `routers/admin_orgs.py:812` does not. That endpoint validates against its own
   eight-code list and 400s on anything else, so before this flag Sanvaad,
   Varta, eSign and Pahchan were four toggles that failed with "Unknown module".
   They are still listed — an operator has to be able to see that a module
   exists and is not switchable here — and they are not clickable. */
const ENDPOINT_MODULES = ['graha', 'ganit', 'manav', 'vikray', 'vetana', 'dristi', 'prachar', 'srijan'];

const ALL_MODULES = [
  { code: 'graha', label: 'Graha · CRM' },
  { code: 'vikray', label: 'Vikray · Sales' },
  { code: 'prachar', label: 'Prachar · Marketing' },
  { code: 'srijan', label: 'Srijan · AI' },
  { code: 'dristi', label: 'Dristi · Analytics' },
  { code: 'sanvaad', label: 'Sanvaad · Messaging' },
  { code: 'varta', label: 'Varta · WhatsApp' },
  { code: 'esign', label: 'eSign' },
  { code: 'pahchan', label: 'Pahchan · Attendance', sensitive: true },
  { code: 'ganit', label: 'Ganit · Invoicing', sensitive: true },
  { code: 'manav', label: 'Manav · HRMS', sensitive: true },
  { code: 'vetana', label: 'Vetana · Payroll', sensitive: true },
].map(m => ({ ...m, wired: ENDPOINT_MODULES.includes(m.code) }));

const PLANS = [
  { code: 'free', label: 'Free' },
  { code: 'starter', label: 'Starter' },
  { code: 'growth', label: 'Growth' },
  { code: 'scale', label: 'Scale' },
];

/* Price, credits and seats start EMPTY. They are negotiated per org and typed
   by Aekam; a prefilled figure is a number nobody decided that ships on a real
   contract the first time someone tabs past the field. Nothing in this console
   may carry a tier price or a seat count as a default, a placeholder or an
   example. */
const EMPTY_ORG = {
  name: '', owner_email: '', plan_code: '',
  markup_pct: 0.3, monthly_credits: '', monthly_price: '', max_users: '',
};
const EMPTY_R2 = { account_id: '', access_key_id: '', secret_access_key: '', bucket_name: 'kartavya-storage' };

/* An empty box must reach the API as null, not as 0 — 0 is a real contracted
   value and "not yet agreed" is not. */
const numOrNull = v => (v === '' || v === null || v === undefined ? null : Number(v));

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
      const payload = {
        ...form,
        monthly_credits: numOrNull(form.monthly_credits),
        monthly_price: numOrNull(form.monthly_price),
        max_users: numOrNull(form.max_users),
      };
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
            <Select {...p} value={form.plan_code} onChange={e => setForm(f => ({ ...f, plan_code: e.target.value }))}>
              <option value="">— Select a plan —</option>
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
        {/* `step` is 1 / any, never a sales increment. A step of 5 on seats with
            a min of 1 makes a negotiated 12 fail HTML constraint validation —
            the field would reject the exact case the console exists to allow. */}
        <Field label="Monthly credits" htmlFor="co-credits" hint="Agreed with the customer. No default.">
          {p => <Input {...p} type="number" min="0" step="1" value={form.monthly_credits} onChange={e => setForm(f => ({ ...f, monthly_credits: e.target.value }))} />}
        </Field>
        <Field label="Monthly price ₹" htmlFor="co-price" hint="Negotiated per organisation. No default.">
          {p => <Input {...p} type="number" min="0" step="any" value={form.monthly_price} onChange={e => setForm(f => ({ ...f, monthly_price: e.target.value }))} />}
        </Field>
        <Field
          label="Seats"
          htmlFor="co-seats"
          hint="Any negotiated number is typable — this field imposes no increment."
        >
          {p => <Input {...p} type="number" min="1" step="1" value={form.max_users} onChange={e => setForm(f => ({ ...f, max_users: e.target.value }))} />}
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

/* ── Credits, ceilings and the two buckets ─────────────────────────────────── */

/**
 * The console-side ceiling editor (BUILD SPEC §4.5; A6 owns the org-facing one).
 *
 * ABSOLUTE, never additive. `allocate_user_credits` used to do
 * `allocated = allocated + EXCLUDED.allocated`, so a ceiling could only ever go
 * up — an admin who typed 200 twice gave the member 400 with no way back. The
 * input therefore shows the CURRENT value and replaces it.
 */
function CeilingDialog(props) {
  // One line, for scripts/check-write-gates.mjs — see admin/BillingLineRow.jsx.
  const { canWrite, reason } = props;
  const { open, orgId, member, isPlatformOrg, onClose, onSaved } = props;

  const [value, setValue] = useState('');
  const [busy, setBusy] = useState('');
  const [refusal, setRefusal] = useState('');

  useEffect(() => {
    if (!open) return;
    setValue(member?.cap === null || member?.cap === undefined ? '' : String(member.cap));
    setRefusal('');
  }, [open, member]);

  const run = async (tag, fn) => {
    setBusy(tag);
    setRefusal('');
    try {
      await fn();
      onSaved?.();
      onClose?.();
    } catch (e) {
      // `InvalidCapValue` already says what is wrong and what 0 means. Rendered,
      // never parsed.
      setRefusal(refusalMessage(e, 'The ceiling was not changed.'));
    } finally { setBusy(''); }
  };

  const typed = value.trim();
  const cap = typed === '' ? null : Math.floor(Number(typed));
  const valid = typed !== '' && Number.isFinite(cap) && cap >= 0;

  return (
    <Modal
      open={open}
      onOpenChange={v => { if (!v) onClose?.(); }}
      title={`Ceiling · ${member?.name || member?.email || 'member'}`}
      dataTestId="ceiling"
      size="sm"
      footer={(
        <>
          <Button
            variant="fill"
            disabled={!canWrite || !valid || Boolean(busy)}
            title={canWrite ? undefined : reason || undefined}
            onClick={() => run('set', () => api.put(
              `/v1/billing/orgs/${orgId}/members/${member.user_id}/cap`, { cap },
            ))}
          >
            {busy === 'set' ? 'Saving…' : 'Set ceiling'}
          </Button>
          <Button
            variant="danger"
            disabled={!canWrite || member?.cap === null || member?.cap === undefined || Boolean(busy)}
            title={canWrite ? undefined : reason || undefined}
            onClick={() => run('clear', () => api.delete(
              `/v1/billing/orgs/${orgId}/members/${member.user_id}/cap`,
            ))}
          >
            {busy === 'clear' ? 'Removing…' : 'Remove ceiling'}
          </Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </>
      )}
    >
      <div className="mcap__form">
        <Field
          label="Ceiling, in credits"
          htmlFor="mcap-value"
          hint="Replaces the current value — it is not added to it. 0 refuses every spend by this member."
        >
          {p => (
            <Input
              {...p}
              type="number" inputMode="numeric" min="0" step="1"
              value={value}
              disabled={!canWrite || Boolean(busy)}
              title={canWrite ? undefined : reason || undefined}
              onChange={e => setValue(e.target.value)}
            />
          )}
        </Field>
        <p className="mcap__note">
          A ceiling limits this person’s share of the shared organisation balance. It does not
          give them their own credits.
          {member?.spent ? ` They have spent ${grouped(member.spent)} credits this period.` : ''}
          {isPlatformOrg && ' Balance is unlimited here; ceilings still bind.'}
        </p>
        {refusal && <p className="inb__note" role="alert">{refusal}</p>}
      </div>
    </Modal>
  );
}

/**
 * Credits, the two buckets, and who may spend how much of them.
 *
 * The buckets are shown separately everywhere they appear. One combined number
 * hides the only distinction that matters to a client who has paid: purchased
 * credits carry over indefinitely, the monthly allowance does not.
 *
 * TWO DIFFERENT GATES, and the asymmetry is the spec's, not a mistake here:
 * reading a balance is FINANCE_CONSOLE_ROLES (god mode + finance), while setting
 * a ceiling is BILLING_CONSOLE_ROLES (which also admits platform_manager). A
 * manager can therefore raise a ceiling without being able to read the balance
 * it is drawn against, so this refuses the READ in words rather than rendering
 * an empty table that looks like an org with no members.
 */
function OrgCreditsSection(props) {
  // One line, for scripts/check-write-gates.mjs.
  const { canWrite, reason } = props;
  const { orgId, orgName, members = [], isPlatformOrg, canRead } = props;

  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [target, setTarget] = useState(null);
  const [toppingUp, setToppingUp] = useState(false);

  const load = useCallback(() => {
    if (!canRead) return Promise.resolve();
    return api.get(`/v1/billing/orgs/${orgId}/balance`)
      .then(r => { setData(r.data); setErr(null); })
      .catch(setErr);
  }, [orgId, canRead]);

  useEffect(() => { load(); }, [load]);

  const balance = data?.balance || null;
  const commitment = data?.commitment || null;

  /* Every member of the org, left-joined onto the ceiling rows. A member with
     no row is uncapped and has spent nothing — `spend()` upserts the row on the
     first spend, so an absent row is a fact, not a gap. */
  const capBy = Object.fromEntries((data?.members || []).map(m => [m.user_id, m]));
  const rows = members.map(m => ({
    user_id: m.user_id,
    name: m.full_name || m.email,
    email: m.email,
    cap: capBy[m.user_id]?.cap ?? null,
    spent: capBy[m.user_id]?.spent ?? 0,
    remaining: capBy[m.user_id]?.remaining ?? null,
  })).sort((a, b) => b.spent - a.spent);

  const totalSpent = rows.reduce((s, r) => s + (r.spent || 0), 0);

  return (
    <>
      <section className="apg__sec">
        <div className="apg__sech">
          <h3 className="apg__sect">
            Credits &amp; ceilings
            <span className="apg__hi" lang="hi" aria-hidden="true">श्रेय</span>
          </h3>
          <Button
            variant="out" size="sm"
            disabled={!canWrite}
            title={canWrite ? undefined : reason || undefined}
            onClick={() => setToppingUp(true)}
          >
            Top up credits
          </Button>
        </div>

        {!canRead && (
          <p className="obl__note">
            Reading this organisation’s balance needs platform owner or account/finance access,
            so the buckets and the ceilings are not shown — a ceiling means nothing without the
            balance it is drawn against. Topping up still works: writing credits and reading a
            balance are different grants.
          </p>
        )}

        {canRead && err && (
          <ErrorState
            kind={errorKind(err)}
            grant="finance access to this organisation"
            onRetry={() => { load(); }}
          />
        )}

        {canRead && !err && !balance && <p className="apg__secn">Loading credits…</p>}

        {canRead && balance && (
          <>
            <div className="crb">
              <div className="crb__b">
                <span className="crb__k">Allowance</span>
                <b className="crb__v">{grouped(balance.allowance ?? 0)}</b>
                <span className="crb__n">resets on the 1st, no carry-over</span>
              </div>
              <div className="crb__b">
                <span className="crb__k">Purchased</span>
                <b className="crb__v">{grouped(balance.purchased ?? 0)}</b>
                <span className="crb__n">carries over — what Aekam sold and invoiced</span>
              </div>
              <div className="crb__b">
                <span className="crb__k">Total</span>
                <b className="crb__v">{grouped(balance.total ?? 0)}</b>
                <span className="crb__n">
                  {balance.is_platform_org
                    ? 'unlimited — spend is recorded, never deducted'
                    : 'what every spend is checked against'}
                </span>
              </div>
            </div>

            {commitment && (
              <p className="mcap__note">
                {commitment.capped_members} of {commitment.capped_members + commitment.uncapped_members} people
                have a ceiling. Ceilings total {grouped(commitment.sum_of_caps)} credits against a balance
                of {grouped(commitment.org_total)}.
                {balance.is_platform_org && ' Balance is unlimited here; ceilings still bind.'}
              </p>
            )}

            {commitment?.over_committed_by > 0 && (
              <div className="adm-actions">
                <Tag color="var(--warn)">
                  Ceilings exceed the balance by {grouped(commitment.over_committed_by)} credits —
                  they are limits, not reservations.
                </Tag>
              </div>
            )}

            {rows.length === 0 ? (
              <p className="apg__secn">No members, so no ceilings.</p>
            ) : (
              <Table>
                <TableHead>
                  <HeadCell>Person</HeadCell>
                  <HeadCell num>Spent</HeadCell>
                  <HeadCell>Ceiling</HeadCell>
                  <HeadCell>Remaining</HeadCell>
                  <HeadCell><span className="k-sr-only">Actions</span></HeadCell>
                </TableHead>
                <TableBody>
                  {rows.map(r => {
                    const capped = r.cap !== null && r.cap !== undefined;
                    const pct = capped && r.cap > 0
                      ? Math.min(100, Math.round((r.spent / r.cap) * 100))
                      : 0;
                    return (
                      <Row key={r.user_id}>
                        <Cell>
                          <span className="adm-name__c">
                            <b>{r.name}</b>
                            <i>{r.email}</i>
                          </span>
                        </Cell>
                        <Cell num>{grouped(r.spent)}</Cell>
                        <Cell>
                          {!capped && '—'}
                          {capped && r.cap === 0 && <Tag color="var(--danger)">Blocked</Tag>}
                          {capped && r.cap > 0 && (
                            <>
                              <span className="mcap__cap">{grouped(r.cap)}</span>
                              <span className="mcap__mtr">
                                <span
                                  className={`mcap__mtrf${pct >= 100 ? ' over' : ''}`}
                                  style={{ '--pct': `${pct}%` }}
                                />
                              </span>
                            </>
                          )}
                        </Cell>
                        <Cell>{capped ? grouped(r.remaining ?? 0) : 'Uncapped'}</Cell>
                        <Cell>
                          <Button
                            size="sm" variant="out"
                            disabled={!canWrite}
                            title={canWrite ? undefined : reason || undefined}
                            onClick={() => setTarget(r)}
                          >
                            Set ceiling
                          </Button>
                        </Cell>
                      </Row>
                    );
                  })}
                </TableBody>
              </Table>
            )}

            {/* The two figures are computed over different sets and are allowed
                to differ: this row sums the org's CURRENT members, while
                `commitment.spent_this_period` sums every ceiling row, including
                user ids that have since been removed from the org. Saying so is
                cheaper than a support call about a total that does not add up. */}
            <p className="apg__secn">
              {grouped(totalSpent)} credits spent by current members this period.
              {commitment && commitment.spent_this_period !== totalSpent
                ? ` The organisation's counter reads ${grouped(commitment.spent_this_period)} — the difference was spent by user ids that are no longer members.`
                : ''}
            </p>
          </>
        )}
      </section>

      <CeilingDialog
        open={Boolean(target)}
        orgId={orgId}
        member={target}
        isPlatformOrg={isPlatformOrg}
        canWrite={canWrite}
        reason={reason}
        onClose={() => setTarget(null)}
        onSaved={load}
      />

      <TopUpDialog
        open={toppingUp}
        orgId={orgId}
        orgName={orgName}
        isPlatformOrg={isPlatformOrg}
        canWrite={canWrite}
        reason={reason}
        onClose={() => setToppingUp(false)}
        onDone={load}
      />
    </>
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
  /* BILLING_CONSOLE_ROLES writes lines, ceilings and top-ups;
     FINANCE_CONSOLE_ROLES is the narrower set that may READ a balance. Both
     mirror the server, and neither is the enforcement. */
  const mayBill = canManageBilling(me?.platform_roles);
  const maySeeBalance = canSeeCost(me?.platform_roles);
  /* Every field the Billing section writes goes through PATCH /settings, which
     is BILLING_CONSOLE_ROLES — so `platform_staff`, who may open this drawer,
     was being offered a Save that 403s on submit. `admin_orgs.py:107-117` names
     that exact defect on the create path and fixed it there; this is the same
     one on the amend path, and the payee joins the fields behind the same gate
     rather than inventing a second. */
  const billReason = mayBill
    ? undefined
    : 'Commercial terms and the payee need platform owner, platform manager or account/finance access.';

  const load = useCallback(() => api
    .get(`/v1/admin/orgs/${orgId}`)
    .then(r => {
      setData(r.data);
      const o = r.data?.org || {};
      /* `?? ''` and not `?? 0`. A price nobody has agreed yet is blank; showing
         it as ₹0 states a contracted figure that does not exist.

         `price` is gone from this form. It is the mirror of the open `platform`
         billing line now, and two editors for one number is how they drift —
         `v_org_platform_line_drift` has to stay at zero rows. It is displayed
         below, read-only, and edited from the Platform fee line.

         The payee seeds to '' when the read does not carry it — either because
         nobody has set one or because this deploy's `GET /v1/admin/orgs/{id}`
         does not select the two columns yet. Neither case may be allowed to
         CLEAR a payee, so the save below sends these keys only when they differ
         from what was read; see `vpaChanged`. */
      setBilling({
        markup: Math.round((o.markup_pct ?? 0.3) * 100),
        credits: o.monthly_credits ?? '',
        vpa: o.upi_vpa ?? '',
        payee: o.upi_payee_name ?? '',
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

  /* Renamed off `grouped`, which now shadows `lib/inr`'s digit grouper — the
     credit figures in this file are read through it, and a local of the same
     name is one edit away from a page that will not render. */
  const memberRows = Object.values(members.reduce((acc, m) => {
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

  /* ── The payee, and why it is only ever sent when it was typed in ──────────
   *
   * PATCH /settings reads these two with `in body` and not `is not None`, so a
   * key present and null CLEARS the payee — that is deliberate, clearing one is
   * a thing an operator means. It also means an unconditional send is a
   * data-loss bug waiting for its moment: an operator amends a markup against a
   * read taken before someone else set the address, the blank box goes up as
   * null, and the org is unpayable again with nothing on screen having said so.
   * So each key is included only when what is typed differs from what was read.
   */
  const vpaTyped = (billing?.vpa ?? '').trim();
  const payeeTyped = (billing?.payee ?? '').trim();
  const vpaChanged = Boolean(billing) && vpaTyped !== (org.upi_vpa ?? '');
  const payeeChanged = Boolean(billing) && payeeTyped !== (org.upi_payee_name ?? '');

  /* `_clean_vpa`'s rule, transcribed: exactly one `@`, both halves non-empty, no
     spaces. The server is the enforcement and refuses in a fuller sentence than
     this one — checking here only saves a round trip, and the field keeps its
     format hint alongside the error rather than swapping one for the other. */
  const vpaMalformed = vpaTyped !== '' && !/^[^@ ]+@[^@ ]+$/.test(vpaTyped);

  const billingChanged = billing && (
    billing.markup !== Math.round((org.markup_pct ?? 0.3) * 100)
    || numOrNull(billing.credits) !== (org.monthly_credits ?? null)
    || vpaChanged
    || payeeChanged
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
              {p => <Input {...p} type="number" min="0" max="100" step="1" value={billing.markup} disabled={!mayBill} title={billReason} onChange={e => setBilling(b => ({ ...b, markup: Number(e.target.value) }))} />}
            </Field>
            <Field label="Monthly credits" htmlFor="ob-credits">
              {p => <Input {...p} type="number" min="0" step="1" value={billing.credits} disabled={!mayBill} title={billReason} onChange={e => setBilling(b => ({ ...b, credits: e.target.value }))} />}
            </Field>
            {/* Read-only, and not a disabled input: a greyed box invites the
                click that does nothing. The figure is the mirror of the open
                platform line, which is the thing that is actually billed. */}
            <div className="fld">
              <span className="fld__l">Monthly price ₹</span>
              <p className="obl__mirror">{org.monthly_price ? inr(org.monthly_price) : 'Not set'}</p>
              <span className="fld__hint">Set by the Platform fee line below.</span>
            </div>
            {/* No placeholder on either box, for the reason EMPTY_ORG states: a
                payment address shown as an example is a value nobody decided,
                sitting where a decided one goes. The format lives in the hint. */}
            <Field
              label="UPI address"
              htmlFor="ob-vpa"
              hint="Reads name@bank. Empty removes the payee."
              error={vpaMalformed ? 'One @, both halves filled, no spaces.' : undefined}
            >
              {p => (
                <Input
                  {...p}
                  value={billing.vpa}
                  disabled={!mayBill}
                  title={billReason}
                  autoComplete="off" spellCheck="false"
                  onChange={e => setBilling(b => ({ ...b, vpa: e.target.value }))}
                />
              )}
            </Field>
            <Field
              label="Payee name"
              htmlFor="ob-payee"
              hint="Shown beside the address. Left empty, the company profile’s account name is used, then the organisation’s name."
            >
              {p => (
                <Input
                  {...p}
                  value={billing.payee}
                  disabled={!mayBill}
                  title={billReason}
                  onChange={e => setBilling(b => ({ ...b, payee: e.target.value }))}
                />
              )}
            </Field>
          </div>

          {/* WHICH ROW IS THE PAYEE, said on the screen and not only in the
              backend docstring. `_platform_payee` selects `WHERE
              o.is_platform_org` — the payee on an invoice Aekam raises is always
              Aekam's own row, never the customer's. A field that saves happily
              on every org and is read on exactly one is the mistake this
              paragraph exists to stop: the operator sets it on the client being
              billed, sees it saved, and the invoice still goes out unpayable. */}
          <p className="obl__note">
            {org.is_platform_org
              ? 'This is the platform organisation, so this address is the payee on every invoice Aekam raises. Issuing an invoice copies the payee onto it, so changing this later never rewrites one already sent. Left empty, the UPI ID from Settings → Organisation → Company Profile is used instead — and if that is empty too, invoices go out with no way to pay them.'
              : 'Only the platform organisation’s payee reaches an invoice: Aekam is paid on every invoice Aekam raises, never the customer being billed. Nothing reads this address today, so setting it here does not make this organisation’s invoices payable — set it on the platform organisation.'}
          </p>

          {!mayBill && <p className="apg__secn">{billReason}</p>}

          {billingChanged && (
            <div className="adm-actions">
              {/* A disabled control says why it is disabled, and the two reasons
                  this one has are different sentences. */}
              <Button
                variant="fill" size="sm"
                disabled={!mayBill || vpaMalformed || busy === 'billing'}
                title={billReason || (vpaMalformed ? 'The UPI address is not in the name@bank form.' : undefined)}
                onClick={() => act('billing', () => api.patch(`/v1/admin/orgs/${orgId}/settings`, {
                  markup_pct: billing.markup / 100,
                  monthly_credits: numOrNull(billing.credits),
                  ...(vpaChanged ? { upi_vpa: vpaTyped || null } : {}),
                  ...(payeeChanged ? { upi_payee_name: payeeTyped || null } : {}),
                }))}
              >
                {busy === 'billing' ? 'Saving…' : 'Save billing'}
              </Button>
            </div>
          )}
        </section>

        {/* What the org is charged, as rows. `monthly_price` above is the
            mirror; these are the record. */}
        <BillingLinesBlock
          orgId={orgId}
          monthlyPrice={org.monthly_price ?? null}
          canWrite={mayBill}
          reason={mayBill ? null : 'Billing lines need platform owner, platform manager or account/finance access.'}
          onChanged={() => { load(); onChanged?.(); }}
        />

        <OrgCreditsSection
          orgId={orgId}
          orgName={org.name}
          members={memberRows}
          isPlatformOrg={Boolean(org.is_platform_org)}
          canRead={maySeeBalance}
          canWrite={mayBill}
          reason={mayBill ? null : 'Credits and ceilings need platform owner, platform manager or account/finance access.'}
        />

        <section className="apg__sec">
          <div className="apg__sech">
            <h3 className="apg__sect">Modules</h3>
            <span className="apg__secn">{enabled.length} of {ALL_MODULES.length}</span>
          </div>
          <div className="adm-mods">
            {ALL_MODULES.map(m => {
              const on = enabled.includes(m.code);
              const cls = [
                'adm-mod',
                on ? 'on' : '',
                m.sensitive ? 'is-sensitive' : '',
                m.wired ? '' : 'is-unwired',
              ].filter(Boolean).join(' ');
              return (
                <button
                  key={m.code}
                  type="button"
                  className={cls}
                  aria-pressed={on}
                  disabled={!m.wired || busy === m.code}
                  title={m.wired ? undefined : 'This module is not in the activation endpoint’s list yet — switching it here would fail.'}
                  onClick={() => act(m.code, () => (on
                    ? api.delete(`/v1/admin/orgs/${orgId}/modules/${m.code}`)
                    : api.post(`/v1/admin/orgs/${orgId}/modules/${m.code}`)))}
                >
                  {m.label}
                  {m.sensitive && <span className="adm-mod__s">Sensitive</span>}
                  {!m.wired && <span className="adm-mod__s is-quiet">Not wired</span>}
                </button>
              );
            })}
          </div>
          {ALL_MODULES.some(m => !m.wired) && (
            <p className="apg__secn">
              Sanvaad, Varta, eSign and Pahchan are live modules but are not in the
              activation endpoint’s accepted list, so they cannot be switched from here
              yet. Use the Billing console, which activates against a different table.
            </p>
          )}
        </section>

        <section className="apg__sec">
          <div className="apg__sech">
            <h3 className="apg__sect">Members</h3>
            <span className="apg__secn">{memberRows.length}</span>
          </div>

          {memberRows.length === 0 && (
            <EmptyState
              title={{ en: 'No members yet', hi: 'कोई सदस्य नहीं' }}
              description="The owner is added when the organisation is created; everyone else is added here."
            />
          )}

          {memberRows.map(m => {
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

  /* ── The headline figure, and why it is a subtotal that says so ────────────
   *
   * This was `mrr: sum of monthly_price`, rendered as "Contracted monthly ·
   * sum of per-org price". Migration 096 demotes `monthly_price` to a
   * denormalised mirror of the single OPEN `platform` line: nothing charges
   * from it, and the support plan, the integration setup and the ongoing
   * support are lines of their own that NEVER touch that column. So the sum is
   * the platform fee and nothing else. The first support plan Aekam sells makes
   * a tile calling this MRR quietly short by the whole of it, with nothing on
   * screen to say so — and a headline number that is wrong in a direction
   * nobody can see is the kind that gets quoted into a board pack.
   *
   * TRUE MRR IS NOT COMPUTABLE FROM WHAT THIS PAGE CAN READ, and inventing it
   * is the worse of the two available options. `GET /v1/admin/orgs` returns
   * `monthly_price` and no line data at all. The only endpoint that totals
   * lines is `GET /v1/billing/orgs/{id}/lines`, which answers for ONE org and
   * returns that org's `monthly_total` — so deriving the headline means one
   * request per organisation on every load of this page, for a tile, and reads
   * zero for every org until 096 is applied. If a cross-org recurring total is
   * wanted it belongs in the list endpoint's SELECT, next to `monthly_price`,
   * as one aggregate. Until it is there, the tile is labelled as what it
   * actually holds and the note under the grid names what it leaves out.
   *
   * SUSPENDED ORGS ARE EXCLUDED AND THEIR TOTAL IS DISCLOSED, not dropped.
   * `PATCH /v1/admin/orgs/{id}/deactivate` sets `is_active=FALSE` and cancels
   * the subscription, but it does not zero `monthly_price` and does not end the
   * platform line — so a suspended org went on inflating this figure with a fee
   * nobody is collecting. Left out here, stated below. Same rule as the rest of
   * the money surfaces in this console: nothing is forgiven silently and
   * nothing is counted silently either. */
  const totals = useMemo(() => {
    const fee = o => Number(o.monthly_price) || 0;
    return {
      orgs: orgs.length,
      active: orgs.filter(o => o.is_active).length,
      suspended: orgs.filter(o => !o.is_active).length,
      platformFees: orgs.reduce((s, o) => s + (o.is_active ? fee(o) : 0), 0),
      suspendedFees: orgs.reduce((s, o) => s + (o.is_active ? 0 : fee(o)), 0),
    };
  }, [orgs]);

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
        {/* Named for what it holds. See the `totals` block above for why it is
            not called MRR and cannot be made into it from this page. */}
        <StatTile label="Platform fees" value={inr(totals.platformFees)} sub="per month, active orgs — not MRR" />
      </div>

      <p className="obl__note">
        Platform fees is the platform line of every active organisation, added up. It is
        not monthly recurring revenue: support plans and ongoing support recur too, are
        billed as lines of their own, and are not in this figure — so read it as a floor,
        never as the total. An organisation’s real recurring total is on its own billing
        lines, in its drawer.
        {totals.suspendedFees > 0 && (
          ` A further ${inr(totals.suspendedFees)} a month sits on the ${totals.suspended} suspended `
          + `organisation${totals.suspended === 1 ? '' : 's'}. Suspending cancels the subscription `
          + `but does not end the platform line, so that amount is left out here rather than `
          + `counted as revenue nobody is collecting.`
        )}
      </p>

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
