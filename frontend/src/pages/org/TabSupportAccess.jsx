import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import {
  Button, Card, CardBody, CardHead, ConfirmDialog, Field, Select, Table,
  TableBody, TableHead, HeadCell, Row, Cell, Tag, Textarea, useToast,
} from '../../components/ui';
import { currentUser } from '../../lib/auth';
import {
  MODULE_LABEL, STATE_LABEL, STATE_TONE, TTL_CHOICES,
  byRecency, listSessions, remaining, sessionState,
} from '../admin/supportSessions';
import useColumnPrefs from '../../hooks/useColumnPrefs';
import { ColumnsButton } from '../../components/ui/CustomizeColumns';

/**
 * TabSupportAccess — the CUSTOMER's half of support access.
 *
 * Who is in my organisation, why they said they needed to be, until when, and
 * one button that ends it now. `08-rbac-screens.md` §"One rule worth
 * restating" is the whole brief:
 *
 *   Support access is never silent. It appears in the customer's own audit log
 *   with the operator's name and stated reason, it emails the owner, and the
 *   violet banner sits in the chrome for the whole session. There is no quiet
 *   mode, no "read-only so it doesn't count", and no config flag to suppress
 *   the banner.
 *
 * ── This screen is not the operator's screen with different buttons ─────────
 * `pages/admin/SupportSessionsPage.jsx` is where an Aekam account ASKS. This is
 * where the answer is given. They deliberately do not look alike and they do
 * not share a component: an approve control and a request control rendered in
 * one visual language is how somebody eventually approves their own request.
 *
 * There is no Request control here at all, and no way for a customer to invite
 * support in. That is not an omission — a grant that a customer can create
 * without being asked is a grant an operator can talk them into creating over
 * the phone, and the record afterwards shows the customer's own hand on it.
 *
 * ── SELF-APPROVAL ──────────────────────────────────────────────────────────
 * The requester may not be the approver. The server enforces it; this screen
 * refuses to draw the button, and SAYS WHY rather than leaving a row that
 * looks broken. It is a real case rather than a theoretical one: Aekam Inc is
 * itself an organisation in this database, so a platform admin can hold
 * `org_admin` in the org they are requesting into.
 *
 * ── Absent when there is nothing ────────────────────────────────────────────
 * `staging.platform_support_sessions` does not exist on the live database —
 * `to_regclass` returned NULL on 6 August 2026 and migration 111 is
 * deliberately unapplied. The endpoint 404s, `listSessions` answers dormant,
 * and this component renders NOTHING: no error, no empty state, no console
 * noise. A settings page that grew a "Support access — none" panel because a
 * migration has not run is worse than the panel being absent.
 *
 * When there is nothing but HISTORY — everything ended, declined or expired —
 * the live panel is absent and the record stays, because "nobody is in here
 * now" and "nobody has ever been in here" are different facts and the customer
 * is entitled to tell them apart.
 */

/** Everything a customer can act on, and everything they can only read. */
const LIVE_STATES = new Set(['requested', 'active']);

const fmtWhen = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

/**
 * What the customer is being asked to allow, in their words rather than in
 * the schema's. `access_level` is `viewer`/`editor` in the database and neither
 * word tells an accountant in Surat what is about to happen to their books.
 */
const levelPhrase = (lvl) => (lvl === 'editor' ? 'look at and change' : 'look at, without changing');

/**
 * What the customer sees about Aekam's access to their data, declared once.
 *
 * `fixed` on Who and on the decision cell in the live list: the customer's
 * whole question is "who is in my data and what do I do about it", and an
 * arrangement that hid either half would leave a table that answers neither.
 * The history list has no verb, so only its Reference is pinned — that is the
 * string a customer reads out on the phone, and the one handle on a session
 * that is not a UUID.
 */
const LIVE_SESSION_COLUMNS = [
  { id: 'who', label: 'Who', fixed: true },
  { id: 'why', label: 'Why' },
  { id: 'reach', label: 'What they can reach' },
  { id: 'state', label: 'State' },
  { id: 'until', label: 'Until' },
  { id: 'decision', label: 'Decision', sr: true, fixed: true },
];

const PAST_SESSION_COLUMNS = [
  { id: 'ref', label: 'Reference', fixed: true },
  { id: 'who', label: 'Who' },
  { id: 'why', label: 'Why' },
  { id: 'outcome', label: 'Outcome' },
  { id: 'asked', label: 'Asked' },
];

export default function TabSupportAccess() {
  const me = currentUser();
  const toast = useToast();

  const [rows, setRows] = useState([]);
  const [hidden, setHidden] = useState(true);      // absent until proven otherwise
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(null);
  const [decide, setDecide] = useState(null);      // the row being approved/declined
  const [grantTtl, setGrantTtl] = useState(2);
  const [denyReason, setDenyReason] = useState('');
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async () => {
    const res = await listSessions(api, 'customer');
    // A dormant endpoint and a genuine failure both end here as "show nothing"
    // — with one difference that matters: a failure is not swallowed silently
    // into a reassuring screen. There is no screen to reassure with, because
    // the section is absent, so the customer is never told "nobody is in your
    // data" on the strength of a request that did not answer.
    setRows(res.error ? [] : res.data);
    setHidden(res.dormant || !!res.error || res.data.length === 0);
  }, []);

  useEffect(() => { load(); }, [load]);

  /**
   * A REAL clock. The customer's whole reason for reading this row is "how
   * much longer", and a number that only moves on refresh answers a different
   * question. Thirty seconds is the finest the label resolves to.
   */
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  /* Above the `hidden` return: this whole tab is absent until a session exists,
     and a component that renders no hooks on that path and six on the next one
     is a crash on the first request landing. */
  const liveCols = useColumnPrefs('org.support_access', LIVE_SESSION_COLUMNS);
  const pastCols = useColumnPrefs('org.support_access_history', PAST_SESSION_COLUMNS);

  if (hidden) return null;

  const live = rows.filter(s => LIVE_STATES.has(sessionState(s, now))).sort(byRecency);
  const past = rows.filter(s => !LIVE_STATES.has(sessionState(s, now))).sort(byRecency);

  /**
   * May THIS person decide THIS request?
   *
   * The server is the authority and sends `can_approve`; this is the second
   * opinion, and it is deliberately the more restrictive of the two. When the
   * server said nothing we fall back to the one rule that can be checked from
   * here — the requester is never the approver — rather than to permission.
   */
  const mayApprove = (s) => {
    if (s.can_approve === false) return false;
    return s.requested_by !== me?.user_id;
  };

  const approve = async () => {
    if (!decide) return;
    setBusy(decide.id);
    try {
      await api.post(`/v1/support-sessions/${decide.id}/approve`, {
        granted_ttl_hours: grantTtl,
      });
      // The mail to the owner and the row in the audit log are part of the
      // approval, not a follow-up: migration 111's
      // `pss_approval_and_owner_email_are_one_act` will not let the row commit
      // without both. So a success here means all three happened.
      toast.success(`${decide.ref} approved. Your owner has been emailed and it is in your audit log.`);
      setDecide(null);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'That approval did not go through. Nothing was granted.');
    } finally {
      setBusy(null);
    }
  };

  const deny = async () => {
    if (!decide) return;
    setBusy(decide.id);
    try {
      await api.post(`/v1/support-sessions/${decide.id}/deny`, { reason: denyReason.trim() });
      toast.success(`${decide.ref} declined.`);
      setDecide(null); setDenyReason('');
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'That could not be recorded.');
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (s) => {
    setBusy(s.id);
    try {
      // `customer` — kept separate from who pressed it, because the identity
      // does not say which of the three parties ended the session.
      await api.delete(`/v1/support-sessions/${s.id}`, { data: { party: 'customer' } });
      toast.success(`${s.ref} revoked. Their access ended immediately.`);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Could not revoke that session.');
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };

  return (
    <Card>
      <CardHead
        title="Support access"
        sanskrit="सहायता"
      />
      <CardBody>
        <p className="apg__lede">
          Aekam staff have no standing access to your data. When they need to look at
          something to help you, they ask here, you decide, and it ends on a clock you
          set. Every session is written to your own audit log and your owner is emailed
          the moment one opens.
        </p>

        {live.length > 0 && (
          <>
          <div className="tbl__abar">
            <ColumnsButton cols={liveCols} />
          </div>
          <Table>
            <TableHead>
              {liveCols.columns.map(c => (
                <HeadCell
                  key={c.id}
                  width={c.width}
                  onResize={w => liveCols.setWidth(c.id, w)}
                >
                  {c.sr ? <span className="sr-only">{c.label}</span> : c.label}
                </HeadCell>
              ))}
            </TableHead>
            <TableBody>
              {live.map(s => {
                const state = sessionState(s, now);
                const left = remaining(s.expires_at, now);
                const mods = (s.modules || []).map(m => MODULE_LABEL[m] || m).join(', ');
                return (
                  <Row key={s.id}>
                    {liveCols.cells({
                    who: (
                    <Cell>
                      <b>{s.requested_by_name || s.requested_by}</b>
                      {/* The reference the customer reads out on the phone.
                          A UUID cannot be dictated and will not be checked. */}
                      <br />
                      <span className="omt__e">{s.ref}</span>
                    </Cell>
                    ),
                    why: <Cell>{s.reason}</Cell>,
                    reach: (
                    <Cell>
                      {mods || 'nothing'}
                      <br />
                      <span className="omt__e">— {levelPhrase(s.access_level)}</span>
                    </Cell>
                    ),
                    state: <Cell><Tag color={STATE_TONE[state]}>{STATE_LABEL[state]}</Tag></Cell>,
                    until: (
                    <Cell>
                      {state === 'requested'
                        ? `asked for ${s.requested_ttl_hours === 0 ? 'no time limit' : `${s.requested_ttl_hours}h`}`
                        : (left ? `ends in ${left}` : 'until you revoke it')}
                    </Cell>
                    ),
                    decision: (
                    <Cell>
                      {state === 'requested' && mayApprove(s) && (
                        <>
                          <Button
                            variant="tonal"
                            size="sm"
                            onClick={() => { setDecide(s); setGrantTtl(s.requested_ttl_hours ?? 2); }}
                          >
                            Decide
                          </Button>
                        </>
                      )}
                      {state === 'requested' && !mayApprove(s) && (
                        /* Named, not hidden. A row that silently loses its
                           buttons reads as broken; this reads as a rule. */
                        <span className="omt__e">
                          You raised this request, so somebody else here must decide it.
                        </span>
                      )}
                      {state === 'active' && (
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={busy === s.id}
                          onClick={() => setConfirm(s)}
                        >
                          Revoke now
                        </Button>
                      )}
                    </Cell>
                    ),
                    })}
                  </Row>
                );
              })}
            </TableBody>
          </Table>
          </>
        )}

        {past.length > 0 && (
          <>
            <p className="apg__lede">
              {live.length === 0
                ? 'Nobody from Aekam is in your data right now. What follows is what has happened before.'
                : 'Earlier sessions.'}
            </p>
            <div className="tbl__abar">
              <ColumnsButton cols={pastCols} />
            </div>
            <Table>
              <TableHead>
                {pastCols.columns.map(c => (
                  <HeadCell
                    key={c.id}
                    width={c.width}
                    onResize={w => pastCols.setWidth(c.id, w)}
                  >
                    {c.label}
                  </HeadCell>
                ))}
              </TableHead>
              <TableBody>
                {past.map(s => (
                  <Row key={s.id}>
                    {pastCols.cells({
                      ref: <Cell>{s.ref}</Cell>,
                      who: <Cell>{s.requested_by_name || s.requested_by}</Cell>,
                      why: <Cell>{s.reason}</Cell>,
                      outcome: (
                        <Cell>
                          <Tag color={STATE_TONE[sessionState(s, now)]}>
                            {STATE_LABEL[sessionState(s, now)]}
                          </Tag>
                        </Cell>
                      ),
                      asked: <Cell>{fmtWhen(s.requested_at)}</Cell>,
                    })}
                  </Row>
                ))}
              </TableBody>
            </Table>
          </>
        )}

        {/* ── The decision ────────────────────────────────────────────────── */}
        {decide && (
          <Card>
            <CardHead title={`${decide.ref} — ${decide.requested_by_name || decide.requested_by}`} />
            <CardBody>
              <p className="apg__lede">{decide.reason}</p>
              <p className="apg__lede">
                They asked to {levelPhrase(decide.access_level)}{' '}
                <strong>{(decide.modules || []).map(m => MODULE_LABEL[m] || m).join(', ') || 'nothing'}</strong>.
                Payroll, HR records and attendance cannot be asked for at all.
              </p>

              <Field
                label="For how long"
                htmlFor="ssa-ttl"
                hint="You may shorten what they asked for. There is no extension afterwards — if they need longer they must ask again, and you get to read a new reason."
              >
                <Select id="ssa-ttl" value={String(grantTtl)} onChange={e => setGrantTtl(Number(e.target.value))}>
                  {TTL_CHOICES.map(c => (
                    <option key={c.hours} value={String(c.hours)}>{c.label}</option>
                  ))}
                </Select>
              </Field>

              <Field
                label="Or decline, and say why"
                htmlFor="ssa-deny"
                hint="They see this. A declined request can be asked again with a better reason."
              >
                <Textarea
                  id="ssa-deny"
                  rows={2}
                  value={denyReason}
                  onChange={e => setDenyReason(e.target.value)}
                />
              </Field>

              <div className="apg__acts">
                <Button variant="fill" disabled={busy === decide.id} onClick={approve}>
                  {busy === decide.id ? 'Approving…' : 'Approve'}
                </Button>
                <Button
                  variant="danger"
                  disabled={busy === decide.id || denyReason.trim().length === 0}
                  onClick={deny}
                >
                  Decline
                </Button>
                <Button variant="text" onClick={() => { setDecide(null); setDenyReason(''); }}>
                  Not now
                </Button>
              </div>
            </CardBody>
          </Card>
        )}

        <ConfirmDialog
          state={confirm ? {
            title: `Revoke ${confirm.ref}?`,
            message: `${confirm.requested_by_name || confirm.requested_by} loses access to your data immediately. Nothing they have already seen is undone, and the session stays in your audit log.`,
            confirmLabel: 'Revoke now',
            intent: 'danger',
            onConfirm: () => revoke(confirm),
          } : null}
          onClose={() => setConfirm(null)}
        />
      </CardBody>
    </Card>
  );
}
