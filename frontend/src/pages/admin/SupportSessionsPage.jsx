import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import {
  Button, Card, CardBody, CardHead, EmptyState, ErrorState, errorKind,
  Field, Select, Table, TableBody, TableHead, HeadCell, Row, Cell, Tag,
  Textarea, SkeletonPage, useToast,
} from '../../components/ui';
import { currentUser } from '../../lib/auth';
import {
  MODULE_LABEL, REASON_MIN, SUPPORT_READ_ONLY, STATE_LABEL, STATE_TONE,
  TTL_CHOICES, byRecency, listSessions, remaining, requestBlockers,
  requestable, sessionState,
} from './supportSessions';
import '../../styles/admin.css';
import { Secondary } from '../../components/Bilingual';

/**
 * SupportSessionsPage — the console row `11-platform-admin.md` names and the
 * build did not have. `/admin/support`.
 *
 * ── Whose screen this is ────────────────────────────────────────────────────
 * THE OPERATOR'S. It is where an Aekam account ASKS a customer for access,
 * watches the ask sit unanswered, and closes a session early when the ticket is
 * done. The customer's half — approve, decline, revoke — is a different screen
 * in the customer's own settings, and the two must not look alike, because a
 * screen that shows both an ask and an approval in the same visual language is
 * a screen on which somebody eventually approves their own request.
 *
 * The one control this page deliberately does NOT have is Approve. Not greyed
 * out, not hidden behind a role check — absent. `RBAC-SPEC` bans self-approval
 * and the server enforces it, but a button that exists and refuses teaches an
 * operator that approval is something they do; a button that was never drawn
 * teaches that it is something the customer does.
 *
 * ── The sentence at the top is the feature ──────────────────────────────────
 * "Not a membership. Time-boxed, written to their audit log, and their owner
 * was emailed when it opened." It is the same sentence the org switcher carries
 * under the support section, verbatim, and `08-rbac-screens.md` calls it the
 * rule that outranks everything else. It is placed where the operator reads it
 * at the moment they use it, which is the only placement that does any work.
 *
 * ── Dormant, and it will be for weeks ───────────────────────────────────────
 * `staging.platform_support_sessions` does not exist on the live database —
 * `to_regclass` returned NULL on 6 August 2026 — and migration 111 is
 * deliberately unapplied because there is ONE `staging` schema and production
 * writes to it. So `/v1/support-sessions` 404s today.
 *
 * That is NOT an error state here. It is "no support sessions exist", which is
 * the true answer. The page renders its header and one calm empty state, the
 * request form is not offered, and nothing is logged. What it must never do is
 * throw a 500-shaped error at an operator because a migration has not run.
 *
 * A genuine failure — a 500, a dropped connection — is shown, loudly, because
 * "nobody is in your data" is the one thing this feature may never say on the
 * strength of a request that did not answer. `isDormant` is where that line is
 * drawn and it is drawn once.
 *
 * ── No new CSS ──────────────────────────────────────────────────────────────
 * Every class here already has a rule in `styles/admin.css` or
 * `styles/components.css`. The console sets `data-surface="platform"`, so
 * `--primary` inside it IS the platform violet — a support session rendered
 * with the primary token is violet without this file naming a colour, and it
 * can never inherit a customer's accent.
 */

/** God mode. Only these two may end a colleague's session. */
const GOD = ['platform_owner', 'platform_admin'];

const fmtWhen = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

/**
 * The state chip. One word plus its tone, from the shared maps — never a
 * colour chosen here, or the five states drift into six spellings across two
 * screens and a customer reading one out over the phone is describing
 * something the operator cannot find.
 */
function StateTag({ state }) {
  if (!state) return null;
  return <Tag color={STATE_TONE[state]}>{STATE_LABEL[state]}</Tag>;
}

/**
 * The clock, as a sentence rather than a number.
 *
 * Three outcomes and they are NOT interchangeable: a running clock, an
 * open-ended grant, and one that has stopped. `remaining()` answers null for
 * both of the last two, which is why the state decides the words and the
 * number only fills them in.
 */
function Clock({ session, now }) {
  const state = sessionState(session, now);
  if (state !== 'active') return <span>—</span>;
  const left = remaining(session.expires_at, now);
  // A NULL expiry is `granted_ttl_hours = 0`, which is UNTIL REVOKED. It is a
  // live session with no clock, and it is the case most worth naming plainly:
  // it ends when somebody ends it, and not before.
  return <span>{left ? `ends in ${left}` : 'until revoked'}</span>;
}

export default function SupportSessionsPage() {
  const user = currentUser();
  const platformRoles = Array.isArray(user?.platform_roles) ? user.platform_roles : [];
  const isGod = platformRoles.some(r => GOD.includes(r)) || user?.role === 'admin';
  const toast = useToast();

  const [mine, setMine] = useState([]);
  const [all, setAll] = useState([]);
  const [orgs, setOrgs] = useState(null);      // null = never answered
  const [serverModules, setServerModules] = useState(null);
  const [dormant, setDormant] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  // Request form
  const [orgId, setOrgId] = useState('');
  const [reason, setReason] = useState('');
  const [modules, setModules] = useState([]);
  const [level, setLevel] = useState('viewer');
  const [ttl, setTtl] = useState(2);
  const [showForm, setShowForm] = useState(false);

  /**
   * The countdown is a real clock. A session that ended while this page was
   * open must stop reading as live on THIS page, without a reload — a support
   * screen that needs refreshing to tell the truth is the stale-cache failure
   * 111 refuses at the database, reintroduced in the browser.
   *
   * A minute is the resolution the label carries, so a minute is what it ticks.
   */
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    const own = await listSessions(api, 'mine');
    if (own.error) throw own.error;
    setMine(own.data);
    setDormant(own.dormant);

    if (isGod && !own.dormant) {
      const every = await listSessions(api, 'all');
      // A god-mode extra that is unavailable is not the page failing. The
      // operator's own sessions are the page; this section is a supervision
      // view over colleagues and it is allowed to be absent.
      setAll(every.error ? [] : every.data);
    } else {
      setAll([]);
    }
  }, [isGod]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    load()
      .catch(e => { if (live) setErr(e); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [load]);

  /**
   * The organisations this operator may ASK. Deliberately a separate, minimal
   * read: `platform_support` holds no console role, so `/v1/admin/orgs` refuses
   * it, and the one role this feature exists for would have no way to name the
   * customer it needs to reach.
   *
   * `/v1/support-sessions/organisations` is the purpose-built list — id and
   * name only, no plan, no spend, no counts — and it is now the ONLY source.
   *
   * THERE USED TO BE A FALLBACK TO `/v1/admin/orgs`, "to keep the form working
   * for the console roles that already hold it". Those are exactly the roles the
   * server now refuses: only `platform_support` may raise a request, because
   * every other platform role already reaches customer modules BY ROLE and a
   * session in their hands could only add authority, never cap it. The picker
   * answers 403 to them — and 403 is in `DORMANT`, so the fallback fired, filled
   * the picker from the admin list, and offered a form whose submit then 403s.
   *
   * So the fallback is gone and the rule this comment already stated is the
   * whole behaviour: if the picker does not answer, the form is not offered. A
   * control that cannot be used teaches the operator the wrong model, which is
   * the same reason `can_approve` is false on their own rows.
   */
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await api.get('/v1/support-sessions/organisations');
        if (!live) return;
        setOrgs(Array.isArray(r.data?.data) ? r.data.data : []);
        setServerModules(Array.isArray(r.data?.modules) ? r.data.modules : null);
      } catch {
        if (live) setOrgs([]);
      }
    })();
    return () => { live = false; };
  }, []);

  const moduleChoices = useMemo(() => requestable(serverModules), [serverModules]);
  const blockers = requestBlockers({ orgId, reason, modules });

  const toggleModule = (code) => {
    setModules(ms => (ms.includes(code) ? ms.filter(c => c !== code) : [...ms, code]));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (blockers.length) return;
    setBusy('request');
    try {
      await api.post('/v1/support-sessions', {
        org_id: orgId,
        reason: reason.trim(),
        modules,
        access_level: level,
        requested_ttl_hours: ttl,
      });
      // "Sent" and not "Granted". The agent holds ZERO access until an org
      // owner or admin approves, and a success message that sounds like an
      // outcome is the first place an operator learns the wrong model.
      toast.success('Request sent. The customer decides — you hold no access until they approve.');
      setReason(''); setModules([]); setShowForm(false);
      await load();
    } catch (e2) {
      // The database CHECK on the reason and the one-pending-per-org index
      // both surface here. The server's own words are better than ours: it
      // knows which of the two refused.
      toast.error(e2?.response?.data?.detail || 'That request was refused.');
    } finally {
      setBusy(null);
    }
  };

  /**
   * Ending a session. Immediate, and there is no sweeper waiting to make it
   * true later — the row leaves `v_active_support_sessions` on the next read.
   *
   * `self` is an agent closing their own; `aekam` is a god-mode admin ending a
   * colleague's. The party is sent rather than inferred, because the identity
   * does not say which happened: a platform admin can also be the person who
   * requested it.
   */
  const revoke = async (session, party) => {
    setBusy(session.id);
    try {
      await api.delete(`/v1/support-sessions/${session.id}`, { data: { party } });
      toast.success(`${session.ref} closed. Access ended now.`);
      await load();
    } catch (e2) {
      toast.error(e2?.response?.data?.detail || 'Could not close that session.');
    } finally {
      setBusy(null);
    }
  };

  const head = (
    <header className="apg__head">
      <div className="apg__titles">
        <h1 className="apg__t">
          Support sessions
          <Secondary className="apg__hi" value="सहायता" />
        </h1>
        <p className="apg__lede">
          Access into a customer&rsquo;s organisation that the customer granted. You ask;
          they decide; it ends on a clock. <strong>Not a membership. Time-boxed, written
          to their audit log, and their owner was emailed when it opened.</strong>
        </p>
      </div>
      {!dormant && orgs && orgs.length > 0 && (
        <div className="apg__acts">
          <Button variant="tonal" onClick={() => setShowForm(v => !v)}>
            {showForm ? 'Cancel request' : 'Request access'}
          </Button>
        </div>
      )}
    </header>
  );

  if (loading) return <SkeletonPage withTable />;

  if (err) {
    return (
      <div className="apg">
        {head}
        {/* A real failure is shown. "Nobody is in your data" must never be
            said on the strength of a request that did not answer. */}
        <ErrorState kind={errorKind(err)} grant="the platform console" onRetry={() => {
          setErr(null); setLoading(true);
          load().catch(setErr).finally(() => setLoading(false));
        }} />
      </div>
    );
  }

  const liveMine = mine.filter(s => sessionState(s, now) === 'active');

  return (
    <div className="apg">
      {head}

      {dormant ? (
        /* The table does not exist. This is not an error and it is not empty
           in the sense of "you have none yet" — the feature has not been
           switched on, and saying so plainly is better than either. */
        <EmptyState
          icon="clock"
          title="Support sessions are not enabled yet"
          description="Nobody holds support access to any customer organisation, and nobody can be granted it until the platform owner applies migration 111. Reach the customer through their own account holder in the meantime."
        />
      ) : (
        <>
          {showForm && (
            <Card>
              <CardHead
                title="Ask a customer for access"
                sanskrit="अनुरोध"
              />
              <CardBody>
                <form onSubmit={submit} className="apg__sec">
                  <Field label="Organisation" required htmlFor="ss-org">
                    <Select id="ss-org" value={orgId} onChange={e => setOrgId(e.target.value)}>
                      <option value="">— Choose an organisation —</option>
                      {(orgs || []).map(o => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </Select>
                  </Field>

                  <Field
                    label="Why you need in"
                    required
                    htmlFor="ss-reason"
                    hint={`The owner reads this before deciding. At least ${REASON_MIN} characters, and write it for them rather than for the ticket.`}
                  >
                    <Textarea
                      id="ss-reason"
                      rows={3}
                      value={reason}
                      onChange={e => setReason(e.target.value)}
                      placeholder="Invoice run is stuck at the GST step and the owner cannot clear it"
                    />
                  </Field>

                  <Field
                    label="Modules"
                    required
                    hint="Payroll, HR records and attendance cannot be requested at all — salary, statutory identifiers and face templates are not things a support ticket needs."
                  >
                    <div className="adm-mods">
                      {moduleChoices.map(m => {
                        const on = modules.includes(m.code);
                        const capped = SUPPORT_READ_ONLY.has(m.code);
                        return (
                          <button
                            key={m.code}
                            type="button"
                            aria-pressed={on}
                            className={`adm-mod${on ? ' on' : ''}${capped ? ' is-sensitive' : ''}`}
                            onClick={() => toggleModule(m.code)}
                          >
                            {m.label}
                            {/* Read-only whatever the customer approves: an
                                editor here does not change a record, it SENDS
                                in the customer's name to the customer's
                                contacts. */}
                            {capped && <span className="adm-mod__s">VIEW ONLY</span>}
                          </button>
                        );
                      })}
                    </div>
                  </Field>

                  <Field label="What you need to do" htmlFor="ss-level">
                    <Select id="ss-level" value={level} onChange={e => setLevel(e.target.value)}>
                      <option value="viewer">Look only</option>
                      <option value="editor">Look and change</option>
                    </Select>
                  </Field>

                  <Field
                    label="For how long"
                    htmlFor="ss-ttl"
                    hint="The customer may shorten this. They cannot lengthen it, and there is no extension — a longer ticket is a new request, with a new reason they get to read."
                  >
                    <Select id="ss-ttl" value={String(ttl)} onChange={e => setTtl(Number(e.target.value))}>
                      {TTL_CHOICES.map(c => (
                        <option key={c.hours} value={String(c.hours)}>{c.label}</option>
                      ))}
                    </Select>
                  </Field>

                  {blockers.length > 0 && (
                    <ul className="apg__lede">
                      {blockers.map(b => <li key={b}>{b}</li>)}
                    </ul>
                  )}

                  <div className="apg__acts">
                    <Button
                      type="submit"
                      variant="fill"
                      disabled={blockers.length > 0 || busy === 'request'}
                    >
                      {busy === 'request' ? 'Sending…' : 'Send the request'}
                    </Button>
                    <Button type="button" variant="text" onClick={() => setShowForm(false)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              </CardBody>
            </Card>
          )}

          <section className="apg__sec">
            <div className="apg__sech">
              <h2 className="apg__sect">Your sessions</h2>
              <span className="apg__secn" aria-live="polite">
                {liveMine.length} active
              </span>
            </div>

            {mine.length === 0 ? (
              <EmptyState
                icon="check"
                title="You hold no support access"
                description="That is the normal state. Ask a customer when a ticket needs it, and it ends on its own."
              />
            ) : (
              <Table>
                <TableHead>
                  <HeadCell>Reference</HeadCell>
                  <HeadCell>Organisation</HeadCell>
                  <HeadCell>State</HeadCell>
                  <HeadCell>Modules</HeadCell>
                  <HeadCell>Level</HeadCell>
                  <HeadCell>Clock</HeadCell>
                  <HeadCell>Asked</HeadCell>
                  <HeadCell><span className="sr-only">Actions</span></HeadCell>
                </TableHead>
                <TableBody>
                  {[...mine].sort(byRecency).map(s => {
                    const state = sessionState(s, now);
                    return (
                      <Row key={s.id}>
                        <Cell>{s.ref}</Cell>
                        <Cell>{s.org_name || 'An unnamed organisation'}</Cell>
                        <Cell><StateTag state={state} /></Cell>
                        <Cell>
                          {(s.modules || []).map(m => MODULE_LABEL[m] || m).join(', ') || '—'}
                        </Cell>
                        <Cell>{s.access_level === 'editor' ? 'Look and change' : 'Look only'}</Cell>
                        <Cell><Clock session={s} now={now} /></Cell>
                        <Cell>{fmtWhen(s.requested_at)}</Cell>
                        <Cell>
                          {state === 'active' && (
                            <Button
                              variant="danger"
                              size="sm"
                              disabled={busy === s.id}
                              onClick={() => revoke(s, 'self')}
                            >
                              {busy === s.id ? 'Closing…' : 'Close now'}
                            </Button>
                          )}
                          {state === 'denied' && s.denial_reason && (
                            <span className="adm-kv__v">{s.denial_reason}</span>
                          )}
                        </Cell>
                      </Row>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </section>

          {isGod && all.length > 0 && (
            <section className="apg__sec">
              <div className="apg__sech">
                <h2 className="apg__sect">Every live session</h2>
                <span className="apg__secn">Aekam-wide</span>
              </div>
              {/* Supervision, not administration. A god-mode admin can END a
                  colleague's session; they cannot approve one, extend one, or
                  open one on somebody else's behalf. */}
              <Table>
                <TableHead>
                  <HeadCell>Reference</HeadCell>
                  <HeadCell>Organisation</HeadCell>
                  <HeadCell>Who is in</HeadCell>
                  <HeadCell>Approved by</HeadCell>
                  <HeadCell>Clock</HeadCell>
                  <HeadCell><span className="sr-only">Actions</span></HeadCell>
                </TableHead>
                <TableBody>
                  {all.filter(s => sessionState(s, now) === 'active').sort(byRecency).map(s => (
                    <Row key={s.id}>
                      <Cell>{s.ref}</Cell>
                      <Cell>{s.org_name || 'An unnamed organisation'}</Cell>
                      <Cell>{s.requested_by_name || s.requested_by}</Cell>
                      <Cell>{s.approved_by_name || s.approved_by}</Cell>
                      <Cell><Clock session={s} now={now} /></Cell>
                      <Cell>
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={busy === s.id}
                          onClick={() => revoke(s, 'aekam')}
                        >
                          {busy === s.id ? 'Ending…' : 'End it'}
                        </Button>
                      </Cell>
                    </Row>
                  ))}
                </TableBody>
              </Table>
            </section>
          )}
        </>
      )}
    </div>
  );
}
