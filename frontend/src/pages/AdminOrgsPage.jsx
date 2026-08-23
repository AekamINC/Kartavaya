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
 * account_finance · developer · sahayak_admin`. As of today's role tiers:
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
/* `formatBytes` is no longer imported: the drawer's Storage tile is gone with
   the rest of what `GET /v1/admin/orgs/{id}` stopped returning. OrgTable still
   exports and uses it for the list. */
import OrgTable, { ORG_FILTERS, selectOrgs } from './admin/OrgTable';
import SlideOver from './admin/SlideOver';
import OrgRoleGrant from './admin/OrgRoleGrant';
import { canSuspendOrg, canManageBilling, canSeeCost } from './admin/platformRoles';
import BillingLinesBlock from './admin/BillingLinesBlock';

import useColumnPrefs from '../hooks/useColumnPrefs';
import { ColumnsButton } from '../components/ui/CustomizeColumns';
import TopUpDialog from './admin/TopUpDialog';
import '../styles/admin.css';
import { Secondary } from '../components/Bilingual';

/* Module codes as `require_module(...)` spells them, with the sensitive set
   marked. Vetana, Ganit and Manav default to no access BY ROLE — the marking
   here is so an operator switching a module on for a whole org knows which
   ones carry employee and financial records. */
const ALL_MODULES = [
  { code: 'graha', label: 'Graha · CRM' },
  { code: 'vikray', label: 'Vikray · Sales' },
  { code: 'prachar', label: 'Prachar · Marketing' },
  { code: 'sahayak', label: 'Sahayak · AI' },
  { code: 'dristi', label: 'Dristi · Analytics' },
  { code: 'sanvaad', label: 'Sanvaad · Messaging' },
  { code: 'varta', label: 'Varta · WhatsApp' },
  { code: 'esign', label: 'eSign' },
  { code: 'pahchan', label: 'Pahchan · Attendance', sensitive: true },
  { code: 'ganit', label: 'Ganit · Invoicing', sensitive: true },
  { code: 'manav', label: 'Manav · HRMS', sensitive: true },
  { code: 'vetana', label: 'Vetana · Payroll', sensitive: true },
  { code: 'kray', label: 'Kray · Procurement', sensitive: true },
];

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

/* What "verified" actually proved. A bucket-scoped token — Cloudflare's own
   least-privilege recommendation — cannot enumerate buckets, so counting them
   described the token rather than the storage. Report the bucket instead, and
   say plainly when it does not exist yet: that is a normal new-org state, not
   a bad credential.

   The server now also WRITES a nine-byte probe object, reads it back and
   deletes it, so "verified" means the upload path works rather than that a
   permission was granted. `d.error` carries the sentence for every state that
   is valid-but-degraded — a token that cannot write, or writes and cannot read
   back — and those are the ones worth saying out loud. */
function r2VerifyMessage(d) {
  const where = d.scope === 'bucket' ? 'bucket-scoped token' : 'account-scoped token';
  if (d.error) return `${where} — ${d.error}`;
  if (d.bucket && d.bucket_exists === false) {
    return `${where} — bucket "${d.bucket}" does not exist yet and will be created.`;
  }
  if (d.bucket && d.probe_round_trip) {
    return `${where} — a test file was written to "${d.bucket}", read back and removed.`;
  }
  if (d.bucket && d.bucket_exists) return `${where} — bucket "${d.bucket}" is reachable.`;
  return `${where} — ${d.buckets?.length ?? 0} bucket(s) reachable.`;
}

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
      const d = res.data || {};
      setVerified(Boolean(d.valid));
      pushToast(d.valid
        ? { type: 'success', title: 'R2 credentials verified', message: r2VerifyMessage(d) }
        : { type: 'error', title: 'R2 credentials rejected', message: d.error });
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
      /* The org is created either way — the server does not refuse one over a
         storage credential — so a failed verify is reported here rather than
         hidden behind a plain success. */
      const d = res.data || {};
      const orgLabel = d.name || form.name;
      if (d.r2_verified === false) {
        pushToast({ type: 'error', title: `${orgLabel} created — but its R2 credentials did not verify`,
          message: 'Storage will refuse uploads. Re-enter the credentials on the org.' });
      } else if (d.owner_invite) {
        pushToast({ type: 'success', title: `${orgLabel} created`,
          message: `Owner invitation sent to ${d.owner}. They become org owner on acceptance.` });
      } else if (d.owner_invite_error) {
        pushToast({ type: 'error', title: `${orgLabel} created — but the owner invitation failed`,
          message: `${d.owner_invite_error}. Invite them manually from the org drawer.` });
      } else {
        pushToast({ type: 'success', title: `${orgLabel} created`,
          message: `${d.owner} is now the org owner. Plan: ${d.plan}` });
      }
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
      subtitle="The owner becomes the point of contact and org owner. If they have no account yet, an invitation is sent."
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
        <Field label="Owner email" htmlFor="co-owner" hint="Becomes the org owner and point of contact. Invited if not yet registered.">
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

/* ── Credits and the two buckets ───────────────────────────────────────────── */
const MEMBER_CAP_COLUMNS = [
  { id: 'person', label: 'Person', fixed: true },
  { id: 'spent', label: 'Spent', num: true },
  { id: 'cap', label: 'Ceiling' },
  { id: 'remaining', label: 'Remaining' },
];

function OrgCreditsSection(props) {
  // One line, for scripts/check-write-gates.mjs.
  const { canWrite, reason } = props;
  const { orgId, orgName, canRead } = props;

  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [toppingUp, setToppingUp] = useState(false);

  const load = useCallback(() => {
    if (!canRead) return Promise.resolve();
    return api.get(`/v1/billing/orgs/${orgId}/balance`)
      .then(r => { setData(r.data); setErr(null); })
      .catch(setErr);
  }, [orgId, canRead]);

  useEffect(() => { load(); }, [load]);

  const cols = useColumnPrefs('admin.org_member_caps', MEMBER_CAP_COLUMNS);

  const balance = data?.balance || null;
  const commitment = data?.commitment || null;

  /* Read off the BALANCE now, not off the org row: `is_platform_org` was one of
     the commercial columns `GET /v1/admin/orgs/{id}` stopped returning.

     It is `false` until the balance loads, and for a caller who may not read a
     balance at all it stays `false`. That only softens copy in the two dialogs —
     both still refuse and both still say why — and the alternative was keeping a
     column on the org read purely to decorate a warning. */
  const isPlatformOrg = Boolean(balance?.is_platform_org);

  /* The ceiling rows the BALANCE endpoint itself returns, and nothing else.
     This used to be the org's full roster left-joined onto them, so somebody
     with no ceiling and no spend still appeared and could be given a first one.
     That roster came from `GET /v1/admin/orgs/{id}`, which no longer carries it
     — the owner's rule is that a platform account sees a member COUNT and never
     the list. So a person with neither a ceiling nor any spend is not shown at
     all, which the note below says out loud rather than leaving the operator to
     infer from a short table.

     `spend()` upserts a row on the first spend, so every person who has spent
     anything is here. */
  const rows = (data?.members || []).map(m => ({
    user_id: m.user_id,
    name: m.name || m.email || m.user_id,
    email: m.email,
    cap: m.cap ?? null,
    spent: m.spent ?? 0,
    remaining: m.remaining ?? null,
  })).sort((a, b) => b.spent - a.spent);

  const totalSpent = rows.reduce((s, r) => s + (r.spent || 0), 0);

  return (
    <>
      <section className="apg__sec">
        <div className="apg__sech">
          <h3 className="apg__sect">
            Credits &amp; ceilings
            <Secondary className="apg__hi" value="श्रेय" />
          </h3>
          <ColumnsButton cols={cols} />
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
            Reading this organisation's balance needs platform owner or account/finance access,
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
              /* NOT "no members". An empty table here means nobody in this
                 organisation has a ceiling or has spent a credit — it says
                 nothing about how many people are in it, and this console
                 cannot ask. The People section above carries the count. */
              <p className="apg__secn">
                Nobody in this organisation has a ceiling or has spent a credit yet.
                Only people who have one or the other are listed — this console cannot
                read the member list.
              </p>
            ) : (
              <Table>
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
                <TableBody>
                  {rows.map(r => {
                    const capped = r.cap !== null && r.cap !== undefined;
                    const pct = capped && r.cap > 0
                      ? Math.min(100, Math.round((r.spent / r.cap) * 100))
                      : 0;
                    return (
                      <Row key={r.user_id}>
                        {cols.cells({
                          person: (
                            <Cell>
                              <span className="adm-name__c">
                                <b>{r.name}</b>
                                <i>{r.email}</i>
                              </span>
                            </Cell>
                          ),
                          spent: <Cell num>{grouped(r.spent)}</Cell>,
                          cap: (
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
                          ),
                          remaining: <Cell>{capped ? grouped(r.remaining ?? 0) : 'Uncapped'}</Cell>,
                        })}
                      </Row>
                    );
                  })}
                </TableBody>
              </Table>
            )}

            {/* Both figures now come from the same set — every ceiling row the
                balance endpoint returned — so they should agree. They are still
                shown together when they do not, because a disagreement is then
                a real fact about the server rather than the roster mismatch it
                used to be, and a total that does not add up with nothing on
                screen to explain it is a support call. */}
            <p className="apg__secn">
              {grouped(totalSpent)} credits spent this period by the people listed above.
              {commitment && commitment.spent_this_period !== totalSpent
                ? ` The organisation's own counter reads ${grouped(commitment.spent_this_period)}.`
                : ''}
            </p>
          </>
        )}
      </section>

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

/**
 * One organisation, as much of it as may cross an organisation boundary.
 *
 * ── What this drawer stopped showing, and why ────────────────────────────────
 *
 * The owner's rule, stated directly:
 *
 *   "no one should be able to see any other org data even god mode users — such
 *    as org members list or what their cap is. God mode can only see the NUMBER
 *    OF USERS count under an org, can INVITE AN ORG ADMIN if needed, and can
 *    CHANGE THE ORG EMAIL ADDRESS — so that if someone leaves that org there is
 *    a new point of contact."
 *
 * `GET /v1/admin/orgs/{id}` used to answer with every member's name, email, org
 * roles and per-module grants, plus the seat cap, plan, credit allowance,
 * markup, monthly price and UPI payee. It now returns the organisation's
 * identity, its point of contact, a member COUNT and the module switches —
 * `routers/admin_orgs.py:ORG_PUBLIC_FIELDS` is the rule and the argument.
 *
 * So three blocks changed here rather than merely losing their data:
 *
 *   · The member TABLE is a COUNT. A count computed from an array the endpoint
 *     also returns is not a count, so the number arrives as a number and the
 *     roster never reaches the browser. The people themselves are managed by
 *     that organisation's own admin, at Settings → Organisation → Members.
 *   · The commercial form — markup, monthly credits, UPI payee — is gone. Those
 *     fields are not in the response any more, and a form that renders blank
 *     and posts null is how a negotiated term gets silently cleared.
 *     `PATCH /v1/admin/orgs/{id}/settings` is untouched and still accepts them.
 *   · A POINT OF CONTACT editor is new. It is the third thing the owner's
 *     sentence permits and it was the one with no endpoint anywhere: the only
 *     writer of `staging.organisations.email` in the product was the
 *     organisation's OWN admin — precisely the person described as having left.
 */
function OrgDetailPanel({ orgId, onClose, onChanged }) {
  const { pushToast } = useToast();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState('');
  const [contact, setContact] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addRole, setAddRole] = useState('org_admin');
  const [confirm, setConfirm] = useState(null);

  const me = currentUser();
  const maySuspend = canSuspendOrg(me?.platform_roles);
  /* BILLING_CONSOLE_ROLES writes lines, ceilings and top-ups;
     FINANCE_CONSOLE_ROLES is the narrower set that may READ a balance. Both
     mirror the server, and neither is the enforcement. */
  const mayBill = canManageBilling(me?.platform_roles);
  const maySeeBalance = canSeeCost(me?.platform_roles);
  /* Inviting an org admin and changing the point of contact are BOTH god mode
     on the server (`SUPERUSER_ONLY_ROLES`), and for the same reason: one hands
     somebody administrative control of a customer's organisation, the other
     redirects where that customer's mail goes. `platform_staff` — four live
     holders — could do the first until now. A control that 403s is worse than
     an absent one, so both say why they are disabled rather than discovering it
     on submit. */
  const mayActOnOrg = canSuspendOrg(me?.platform_roles);
  const godReason = mayActOnOrg
    ? undefined
    : 'Inviting an org admin and changing the point of contact are platform owner only.';

  const load = useCallback(() => api
    .get(`/v1/admin/orgs/${orgId}`)
    .then(r => {
      setData(r.data);
      setContact(r.data?.org?.email ?? '');
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

  const { org, modules = [] } = data;
  const enabled = modules.filter(m => m.is_active).map(m => m.module_code);

  /* A NUMBER, from the server. `member_count` is computed by the database and
     the rows never leave it — the whole point of the narrowing is that the
     browser is not handed an array to take `.length` of.

     `?? null` and not `?? 0`. An older deploy that does not send the key has
     not told us the organisation is empty, and rendering a confident 0 for
     "we were not told" is the shape of bug this console keeps producing. */
  const memberCount = org && typeof data.member_count === 'number' ? data.member_count : null;

  const act = async (label, fn) => {
    setBusy(label);
    try { await fn(); await load(); onChanged?.(); }
    catch (e) {
      console.error('act() error:', e);
      pushToast({ type: 'error', title: e?.response?.data?.detail || 'That did not go through' });
    }
    finally { setBusy(''); }
  };

  /* ── The point of contact ──────────────────────────────────────────────────
   *
   * Sent only when it differs from what was read, for the same reason the payee
   * fields were: an operator working from a stale read must not overwrite a
   * change somebody else made in the meantime just by having the drawer open.
   *
   * The server refuses a blank or malformed address with a 422 before its
   * handler body runs — `EmailStr` — because the whole purpose of this
   * capability is that an organisation always HAS a point of contact. Checking
   * the shape here only saves a round trip. */
  const contactTyped = contact.trim();
  const contactChanged = contactTyped !== (org.email ?? '').trim();
  const contactMalformed = contactTyped !== '' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactTyped);

  return (
    <>
      <SlideOver
        open
        onClose={onClose}
        title={org.name || 'Organisation'}
        subtitle={`${memberCount === null ? 'People not reported' : `${memberCount} ${memberCount === 1 ? 'person' : 'people'}`} · ${org.is_active ? 'Active' : 'Suspended'}`}
      >
        <div className="adm-kv">
          <div>
            <div className="adm-kv__k">Org ID</div>
            <div className="adm-kv__v is-mono">{org.id}</div>
          </div>
          <div>
            <div className="adm-kv__k">People</div>
            {/* The count, and only the count. See the component header. */}
            <div className="adm-kv__v">{memberCount === null ? '—' : memberCount}</div>
          </div>
          <div>
            <div className="adm-kv__k">Point of contact</div>
            <div className="adm-kv__v">{org.email || 'Not set'}</div>
          </div>
          <div>
            <div className="adm-kv__k">Status</div>
            <div className="adm-kv__v">{org.is_active ? 'Active' : 'Suspended'}</div>
          </div>
        </div>

        {/* ── The point of contact ────────────────────────────────────────────
            One of the three things a platform account may do across an
            organisation boundary, and until now the only one with no endpoint
            at all: `staging.organisations.email` was writable by that
            organisation's own admin and by nobody else, which is exactly the
            person this exists for. */}
        <section className="apg__sec">
          <div className="apg__sech"><h3 className="apg__sect">Point of contact</h3></div>
          <div className="adm-form adm-form--tight">
            <Field
              label="Contact email"
              htmlFor="oc-email"
              hint="Where Aekam writes to this organisation. Changing it is recorded — who changed it, from what, to what, and when."
              error={contactMalformed ? 'That is not an email address.' : undefined}
            >
              {p => (
                <Input
                  {...p}
                  type="email"
                  value={contact}
                  disabled={!mayActOnOrg}
                  title={godReason}
                  autoComplete="off" spellCheck="false"
                  onChange={e => setContact(e.target.value)}
                />
              )}
            </Field>
          </div>

          <p className="obl__note">
            This is the address Aekam uses to reach the organisation, not a person's
            login. It exists so that when whoever set it up leaves, there is still
            somewhere to write. It cannot be cleared — an organisation with no point of
            contact is the state this field exists to prevent.
          </p>

          {!mayActOnOrg && <p className="apg__secn">{godReason}</p>}

          {contactChanged && (
            <div className="adm-actions">
              <Button
                variant="fill" size="sm"
                disabled={!mayActOnOrg || contactMalformed || !contactTyped || busy === 'contact'}
                title={godReason || (contactMalformed ? 'That is not an email address.' : undefined)}
                onClick={() => act('contact', () => api.patch(
                  `/v1/admin/orgs/${orgId}/contact-email`, { email: contactTyped },
                ))}
              >
                {busy === 'contact' ? 'Saving…' : 'Change point of contact'}
              </Button>
            </div>
          )}
        </section>

        {/* What the org is charged, as rows.
            `monthlyPrice` is null now and always: `GET /v1/admin/orgs/{id}` no
            longer returns `monthly_price`, so this block's drift warning — which
            compares the denormalised scalar against the open platform line — has
            nothing to compare and stays silent, which is the behaviour its own
            header already documents for a payload that omits the scalar. The
            LINES themselves come from `/v1/billing/orgs/{id}/lines`, a different
            router behind the billing roles, and are untouched here. */}
        <BillingLinesBlock
          orgId={orgId}
          monthlyPrice={null}
          canWrite={mayBill}
          reason={mayBill ? null : 'Billing lines need platform owner, platform manager or account/finance access.'}
          onChanged={() => { load(); onChanged?.(); }}
        />

        {/* `members` is no longer passed. It used to be the roster from
            `GET /v1/admin/orgs/{id}`, left-joined onto the ceiling rows so that
            somebody with NO ceiling still appeared and could be given one. That
            roster is the leak, so the section now renders only the people
            `/v1/billing/orgs/{id}/balance` itself returns — those who already
            have a ceiling or have already spent — and says so rather than
            showing an empty table that reads as "this organisation has nobody
            in it". Setting a FIRST ceiling on somebody who has neither is the
            one thing that moved out of this drawer, and it moved because doing
            it requires knowing who they are.

            `isPlatformOrg` is gone with `is_platform_org`; the balance payload
            carries the same fact for the org it answers about. */}
        <OrgCreditsSection
          orgId={orgId}
          orgName={org.name}
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
              ].filter(Boolean).join(' ');
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

        {/* ── People: a number, and the one invitation that is permitted ──────
            This was a table of everybody in the organisation — name, email,
            roles and per-module grants — with a Remove button on each row. The
            count is what a platform account may see; the roster is not, and
            neither is removing somebody from it. Both are that organisation's
            own admin's job, at Settings → Organisation → Members. */}
        <section className="apg__sec">
          <div className="apg__sech">
            <h3 className="apg__sect">People</h3>
            <span className="apg__secn">{memberCount === null ? '—' : memberCount}</span>
          </div>

          {/* A number is not a table, so it is stated in a sentence rather than
              rendered as an empty one. `memberCount === 0` is a real answer and
              reads differently from `null`, which means this deploy did not send
              the figure at all. */}
          <p className="obl__note">
            {memberCount === null
              ? 'This deploy did not report a headcount for this organisation.'
              : memberCount === 0
                ? 'Nobody is in this organisation yet.'
                : `${memberCount} ${memberCount === 1 ? 'person is' : 'people are'} in this organisation.`}
            {' '}Who they are is not readable from here, and neither is what they can
            reach — that is the organisation's own information, and its admin manages it
            at Settings → Organisation → Members. This console can invite an org admin
            or an org owner, which is what the box below does.
          </p>

          <div className="adm-form adm-form--tight">
            <Field
              label={addRole === 'org_owner' ? 'Invite an org owner' : 'Invite an org admin'}
              htmlFor="om-email"
              hint={addRole === 'org_owner'
                ? 'They become the org owner and can manage modules, roles and payroll approval. If they don’t have an account yet, an invite email is sent.'
                : 'They become an org admin of this organisation and reach every module it has active. If they don’t have an account yet, an invite email is sent.'}
            >
              {p => (
                <Input
                  {...p} type="email" value={addEmail} placeholder="person@acme.in"
                  disabled={!mayActOnOrg}
                  title={godReason}
                  onChange={e => setAddEmail(e.target.value)}
                />
              )}
            </Field>
            <Field label="Role" htmlFor="om-role">
              {p => (
                <Select {...p} value={addRole} onChange={e => setAddRole(e.target.value)}
                  disabled={!mayActOnOrg} title={godReason}>
                  <option value="org_admin">Org Admin</option>
                  <option value="org_owner">Org Owner</option>
                </Select>
              )}
            </Field>
          </div>
          <div className="adm-actions">
            <Button
              variant="out" size="sm"
              disabled={!mayActOnOrg || !addEmail.trim() || busy === 'add'}
              title={godReason}
              onClick={() => {
                const email = addEmail.trim();
                const role  = addRole;
                setConfirm({
                  title: role === 'org_owner' ? 'Invite an org owner' : 'Invite an org admin',
                  message: role === 'org_owner'
                    ? `${email} becomes the org owner of ${org.name}. They can manage modules, roles, payroll approval and everything the organisation reaches. The org must not already have an owner.`
                    : `${email} becomes an org admin of ${org.name} and reaches every module it has active — including payroll and the books if those are on. This is recorded against the organisation.`,
                  confirmLabel: role === 'org_owner' ? 'Make org owner' : 'Make org admin',
                  confirmStyle: 'primary',
                  onConfirm: () => act('add', async () => {
                    const endpoint = role === 'org_owner'
                      ? `/v1/admin/orgs/${orgId}/owner`
                      : `/v1/admin/orgs/${orgId}/members`;
                    const body = role === 'org_owner'
                      ? { email }
                      : { email, roles: ['org_admin'] };
                    const r = await api.post(endpoint, body);
                    if (r.data?.status === 'invited') {
                      pushToast({ type: 'success', title: `Invite sent to ${email}` });
                    } else {
                      pushToast({ type: 'success', title: `${email} is now ${role === 'org_owner' ? 'the org owner' : 'an org admin'}` });
                    }
                    setAddEmail('');
                    setAddRole('org_admin');
                  }),
                });
              }}
            >
              {busy === 'add' ? 'Inviting…' : addRole === 'org_owner' ? 'Invite org owner' : 'Invite org admin'}
            </Button>
            {!mayActOnOrg && <span className="apg__secn">{godReason}</span>}
          </div>
        </section>

        {/* The other three org roles. The invite above grants `org_admin` and
            nothing else — its endpoint refuses anything else with a 400 — so
            `hr_admin`, `org_client` and `aekam_team` shipped on 2026-08-06 with
            a migration and 19 tests and could not be granted from any screen.
            This is that screen; it reads the vocabulary and the seat
            consequence from the server rather than transcribing either. */}
        <OrgRoleGrant
          orgId={orgId}
          orgName={org.name}
          canAct={mayActOnOrg}
          denyReason={godReason}
          pushToast={pushToast}
          onChanged={onChanged}
        />

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
            <Secondary className="apg__hi" value="संस्थाएँ" />
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
        never as the total. An organisation's real recurring total is on its own billing
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
