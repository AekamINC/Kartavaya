import React, { useCallback, useEffect, useState } from 'react';
import {
  Button, Card, CardBody, CardHead, Cell, EmptyState, HeadCell, Input, Modal,
  Row, SkeletonTable, StatTile, Table, TableBody, TableHead, Tag,
} from '../../components/ui';
import { api } from '../../lib/api';
import { grouped } from '../../lib/inr';
import { formatDate, formatTime } from '../../lib/timeFormat';
import '../../styles/outbound.css';

/**
 * OutboundLog — what this organisation has actually been sent.
 *
 * ── WHY THIS SCREEN EXISTS ──────────────────────────────────────────────────
 *
 * An AWS alert said 2,586 of 3,000 SES message units were gone for the month.
 * "How many emails have you sent?" took an hour of inference from payslip rows
 * to answer, and the answer was still only a floor, because nothing in this
 * product recorded a send. What that hour found — a payroll run mailing every
 * employee a payslip on every run, sixteen runs against an org of 71 people,
 * all ~960 addressed to `@example.com`, which RFC 2606 reserves and which can
 * therefore only ever hard-bounce against the sending identity production
 * shares — was invisible while it was happening.
 *
 * So this block answers three questions and deliberately no others:
 *
 *   · what has this org been sent this period, by purpose
 *   · did THIS recipient get it, and when
 *   · what failed, and why
 *
 * It sits beside the usage tabs because it answers their shape of question from
 * the other side: those say what it cost, this says what was done for it. The
 * message-unit figure is the one the alert was actually about.
 *
 * ── THE FOUR THINGS THIS SCREEN REFUSES TO SAY ──────────────────────────────
 *
 * 1. SUPPRESSED IS NOT SENT. `OUTBOUND_MODE=dry` is set on staging, so on
 *    staging every one of these rows is suppressed and nothing left the
 *    building. That is the correct outcome there and is not a failure — but it
 *    is not a send either. It has its own tile, its own column and its own
 *    tone, and it is never added into a "sent" figure: that addition is the bug
 *    that once made a campaign report "3 sent" for a send that went nowhere.
 *
 * 2. SENT IS NOT DELIVERED, AND EVIDENCE IS A PROVIDER MESSAGE ID. `sent` means
 *    the provider ACCEPTED it — SES accepted all 960 payslips and bounced them
 *    seconds later. The message id is the only string tying a row here to a
 *    record on the provider's side, so it is shown as its own column and the
 *    confirmed count sits under the sent figure. Nothing is coloured green for
 *    having been sent, because a green tick would claim delivery this product
 *    cannot observe.
 *
 * 3. ROWS BEFORE THE LOG EXISTED DO NOT EXIST. The coverage sentence is the
 *    first thing in the block and is rendered in every state, including the
 *    good one. A month that began before recording did is a FLOOR, in that
 *    word.
 *
 * 4. A SEND WITH NO ORGANISATION IS NOT THIS ORGANISATION'S SEND. Invitations,
 *    password resets and magic links go out before any org context exists and
 *    carry none, so they are in none of these figures. The screen says that
 *    rather than letting the absence read as "we never emailed them".
 *
 * ── WHY IT FETCHES ITS OWN DATA ─────────────────────────────────────────────
 *
 * `BillingUsageSection.load()` fails the whole section if any of its three
 * requests fails. This one must not be able to do that: migration 098 is
 * applied by hand, so a database that has not had it must lose this block and
 * nothing else. A 503 renders as the server's own sentence in place of the
 * figures — never as zeros, which on this screen would read as "nothing was
 * sent" and is the exact claim the whole feature exists to prevent.
 */

/** The server's own words. Never parsed, never re-written. */
function refusal(err, fallback) {
  const detail = err?.response?.data?.detail;
  if (detail && typeof detail === 'object' && detail.message) return detail.message;
  if (typeof detail === 'string' && detail) return detail;
  return fallback;
}

/** "05 Aug 2026 · 4:32 PM". Absolute, never "2 days ago". */
function stamp(iso) {
  if (!iso) return '—';
  const d = formatDate(iso);
  const t = formatTime(iso);
  return t ? `${d} · ${t}` : d;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/** `2026-08` → "August 2026". Built from the string, never through `new Date`. */
function monthName(ym) {
  const [y, m] = String(ym || '').split('-');
  return MONTH_NAMES[Number(m) - 1] ? `${MONTH_NAMES[Number(m) - 1]} ${y}` : String(ym || '');
}

/**
 * The tone a status is shown in.
 *
 * `sent` is DELIBERATELY UNTINTED, and not `--ok`. Green here would read as "it
 * arrived", and this log cannot know that — it records what left the building.
 * The three that carry a tone are the three that are a problem: something that
 * never went, something that was refused, and something the provider never
 * answered about at all.
 */
const STATUS_TONE = {
  suppressed: 'var(--warn)',
  failed: 'var(--danger)',
  queued: 'var(--warn)',
};

/**
 * Our wording, where we have wording. Anything else falls through to the
 * server's own key, so a status added on the server appears under its raw name
 * rather than not appearing at all — the same rule `UsageBySource.jsx` keeps
 * about the tab list.
 *
 * `queued` IS RENDERED AS "No answer" AND NOT AS "Queued", which would suggest
 * something still in a line waiting its turn. Migration 098 is explicit that it
 * means the opposite: the provider was called and never answered, and a row
 * still reading it minutes later is itself the finding — the process died
 * between the call and the reply, which is how the original log history was
 * lost in the first place.
 */
const STATUS_WORD = {
  sent: 'Sent',
  suppressed: 'Suppressed',
  failed: 'Failed',
  queued: 'No answer',
};

const statusWord = s => STATUS_WORD[s] || s || 'Not recorded';

export default function OutboundLog({ basePath, period }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState('');
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState(null);
  const [lookup, setLookup] = useState('');

  const load = useCallback(async () => {
    setFailed('');
    try {
      const res = await api.get(`${basePath}/outbound`, { params: { period } });
      setData(res.data || null);
    } catch (e) {
      setData(null);
      setFailed(refusal(
        e,
        'Couldn’t read what this organisation has been sent. Every figure above '
        + 'is unaffected — it comes from a different read.',
      ));
    }
  }, [basePath, period]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    load().finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [load]);

  const totals = data?.totals || {};
  const sent = Number(totals.sent) || 0;
  const confirmed = Number(totals.confirmed) || 0;
  const suppressed = Number(totals.suppressed) || 0;
  const failedCount = Number(totals.failed) || 0;
  const unanswered = Number(totals.unanswered) || 0;
  const total = Number(totals.total) || 0;
  const units = Number(totals.ses_units) || 0;
  const unmeasured = Number(totals.unmeasured) || 0;
  const purposes = data?.purposes || [];
  const bypassed = Number(data?.kill_switch_bypassed) || 0;

  /* WHOSE CONSOLE IS THIS.
     Two callers, and the difference is a privacy boundary rather than a
     styling one. `/v1/billing/me` is a firm looking at its OWN sends, where the
     address is the firm's own record and showing it is the point.
     `/v1/billing/orgs/{id}` is the Aekam finance console looking at a
     CUSTOMER's sends, and Aekam must not see a customer's contact addresses —
     the server enforces that: it returns a DOMAIN in `target`, and refuses
     `?recipient=` with a 400 rather than a filtered 200.
     This flag exists so the UI stops OFFERING what the server refuses. A
     lookup box that always errors reads as a broken console, not as a rule. */
  const platformView = /\/billing\/orgs\//.test(basePath || '');

  const openDrill = next => setDrill({ recipient: '', purpose: '', status: '', ...next });

  const submitLookup = (e) => {
    e.preventDefault();
    const target = lookup.trim();
    if (target) openDrill({ recipient: target });
  };

  return (
    <Card>
      <CardHead
        title="What was actually sent"
        sanskrit="प्रेषित"
        actions={<span className="bl__sub">{monthName(data?.period || period)}</span>}
      />
      <CardBody>
        {loading && <SkeletonTable rows={4} />}

        {!loading && failed && (
          <p className="bl__note" role="status">{failed}</p>
        )}

        {!loading && !failed && data && (
          <>
            <Coverage data={data} />

            {/* The kill switch was bypassed. Migration 098 argues this must be
                zero on staging forever, and it has already been non-zero twice
                — both times a sender that built its own MIME and called the
                provider directly. It is above the figures because it changes
                what they mean. */}
            {bypassed > 0 && (
              <p className="bl__note bl__note--warn" role="status">
                <Tag color="var(--danger)">Kill switch bypassed</Tag>
                {grouped(bypassed)} of these went to a provider while the process was in
                dry mode, which is supposed to be impossible. Something sent without
                going through the outbound gate.
              </p>
            )}

            <div className="bl__stats">
              <StatTile
                label="Sent"
                value={grouped(sent)}
                sub={sent === 0
                  ? 'Nothing was handed to a provider'
                  : `${grouped(confirmed)} of these came back with a provider id`}
              />
              <StatTile
                label="Suppressed"
                value={grouped(suppressed)}
                sub="Never left the building"
                variant={suppressed > 0 ? 'warn' : 'neutral'}
              />
              <StatTile
                label="Failed"
                value={grouped(failedCount)}
                sub={unanswered > 0
                  ? `Refused by the provider · ${grouped(unanswered)} more never got an answer`
                  : 'Refused by the provider'}
                variant={failedCount > 0 || unanswered > 0 ? 'danger' : 'neutral'}
              />
              <StatTile
                label="Email message units"
                value={grouped(units)}
                /* THE FIGURE THE ALERT WAS ABOUT. It is a floor twice over —
                   sizes are measured before MIME framing and base64 expansion,
                   and an unmeasured row counts as one unit whatever it weighed
                   — so it is labelled a floor and the unmeasured count is
                   printed beside it rather than folded in. */
                sub={unmeasured > 0
                  ? `At least — ${grouped(unmeasured)} sends had no size recorded`
                  : 'At least — sizes are measured before framing'}
              />
            </div>

            <p className="bl__note">
              <Tag color="var(--warn)">Sent is not delivered</Tag>
              “Sent” means an email or push provider accepted it without an error. Nothing
              in this product hears back from a mailbox, so no figure here is a delivery —
              a provider can accept a message and bounce it seconds later. A row carrying
              a provider message id can be looked up at that provider; one without it is a
              record that we tried.
            </p>

            <PurposeTable purposes={purposes} total={total} onDrill={openDrill} />

            <p className="bl__note">
              Invitations, password resets and magic links are sent before an organisation
              exists, so they carry none and are not counted anywhere on this card.
            </p>

            {platformView && (
              <p className="bl__note">
                <Tag color="var(--pf-keyline)">Aekam view</Tag>
                Addresses are not shown here and cannot be searched. This console reports
                what a customer sent and what it cost, never who they sent it to — the
                “To” column carries the recipient’s domain only.
              </p>
            )}

            {!platformView && (
            <form className="ob__find" onSubmit={submitLookup}>
              <label className="ob__find-l" htmlFor="ob-recipient">
                Did one person get it?
              </label>
              <Input
                id="ob-recipient"
                type="text"
                inputMode="email"
                autoComplete="off"
                placeholder="name@company.com"
                value={lookup}
                onChange={e => setLookup(e.target.value)}
              />
              <Button type="submit" variant="out" disabled={!lookup.trim()}>
                Look up
              </Button>
              <span className="bl__sub">
                Searches every send recorded for that address against this organisation,
                not just {monthName(data?.period || period)}.
              </span>
            </form>
            )}
          </>
        )}
      </CardBody>

      <SendDrill
        drill={drill}
        basePath={basePath}
        period={period}
        recordingSince={data?.recording_since || null}
        onClose={() => setDrill(null)}
      />
    </Card>
  );
}

/**
 * The coverage sentence — the first thing in the block, in every state.
 *
 * This is the honesty requirement that cost the most to learn. The question
 * "how many have we sent?" was answered with a floor derived from payroll rows,
 * and the floor was then reported as a number. A log that started last Tuesday
 * and renders a month's total as though it covered the month puts the reader
 * back in exactly that position, and nothing else on the screen would tell
 * them.
 *
 * Three different facts, three different sentences, none of them optional:
 *   · nothing recorded at all — which is NOT the same as nothing sent
 *   · recording began mid-period — the figures are a floor, in that word
 *   · recording covers the period — say so, so the reader knows the difference
 *     is being tracked rather than ignored
 */
function Coverage({ data }) {
  const since = data?.recording_since || null;
  const covers = Boolean(data?.covers_whole_period);
  const month = monthName(data?.period);

  if (!since) {
    return (
      <p className="bl__note bl__note--warn" role="status">
        <Tag color="var(--warn)">No history</Tag>
        No send has ever been recorded for this organisation. That is not evidence that
        nothing was sent — this log only holds what was recorded after it was deployed,
        and anything sent before that left no trace anywhere.
      </p>
    );
  }

  if (!covers) {
    return (
      <p className="bl__note bl__note--warn" role="status">
        <Tag color="var(--warn)">Partial month</Tag>
        This log begins on {stamp(since)}, which is after {month} started. Every figure
        below is a floor for this period and not a total — whatever was sent earlier in
        the month was not recorded and does not appear here.
      </p>
    );
  }

  return (
    <p className="bl__note">
      Recording since {stamp(since)}, so {month} is covered in full. Anything sent before
      that date was never recorded and is not counted anywhere on this card.
    </p>
  );
}

/**
 * One row per purpose and channel. The purpose LIST is never written down here
 * — it is `purposes[]` exactly as the API returned it, so a purpose that sent
 * nothing this month has no row and nobody has to decide whether an empty
 * "Payslips" row means "payroll did not run" or "we forgot to add it".
 *
 * Four separate figures per row and never a sum of them. `Sent` carries its
 * confirmed count underneath rather than in a column of its own, because
 * confirmed is a SUBSET of sent and a fifth column of numbers invites somebody
 * to add the row up.
 */
function PurposeTable({ purposes, total, onDrill }) {
  const unclassified = purposes
    .filter(p => p.purpose === 'unclassified')
    .reduce((n, p) => n + (Number(p.total) || 0), 0);

  if (!purposes.length) {
    return (
      <EmptyState
        title={{ en: 'Nothing recorded this period', hi: 'कुछ नहीं भेजा गया' }}
        description={'No email or push was recorded against this organisation in the '
          + 'month selected above. If you expected one, read the coverage note — the '
          + 'log may simply begin after the send.'}
      />
    );
  }

  return (
    <>
      <Table className="bl__tbl">
        <TableHead>
          <HeadCell>Purpose</HeadCell>
          <HeadCell>Channel</HeadCell>
          <HeadCell num>Sent</HeadCell>
          <HeadCell num>Suppressed</HeadCell>
          <HeadCell num>Failed</HeadCell>
          <HeadCell num>No answer</HeadCell>
          <HeadCell>Last one</HeadCell>
        </TableHead>
        <TableBody>
          {purposes.map((p) => {
            const key = `${p.purpose || 'none'}:${p.channel || 'none'}`;
            const name = p.label || p.purpose || 'No purpose recorded';
            const psent = Number(p.sent) || 0;
            const pconf = Number(p.confirmed) || 0;
            return (
              <Row key={key}>
                <Cell>
                  <span className="bl__item">{name}</span>
                  {p.purpose && <span className="bl__ref">{p.purpose}</span>}
                </Cell>
                <Cell>{p.channel || '—'}</Cell>
                <Cell num>
                  <Figure
                    count={psent}
                    sub={`${grouped(pconf)} confirmed`}
                    /* No provider id anywhere in the group is the one thing
                       worth flagging on a summary row: it is what a broken
                       provider integration looks like, and it is
                       indistinguishable from a healthy one if you only read
                       the left-hand number. */
                    weak={psent > 0 && pconf === 0}
                    onClick={() => onDrill({ purpose: p.purpose || '', status: 'sent' })}
                    label={`Sent, ${name}`}
                  />
                </Cell>
                <Cell num>
                  <Figure
                    count={Number(p.suppressed) || 0}
                    onClick={() => onDrill({ purpose: p.purpose || '', status: 'suppressed' })}
                    label={`Suppressed, ${name}`}
                  />
                </Cell>
                <Cell num>
                  <Figure
                    count={Number(p.failed) || 0}
                    tone={Number(p.failed) > 0 ? 'bad' : ''}
                    onClick={() => onDrill({ purpose: p.purpose || '', status: 'failed' })}
                    label={`Failed, ${name}`}
                  />
                </Cell>
                <Cell num>
                  {/* `queued` is the one word 098's CHECK permits for this
                      state. It reads as "waiting" and means the opposite —
                      the provider was called and never replied — which is why
                      the column is headed "No answer" and not "Queued". */}
                  <Figure
                    count={Number(p.unanswered) || 0}
                    tone={Number(p.unanswered) > 0 ? 'bad' : ''}
                    onClick={() => onDrill({ purpose: p.purpose || '', status: 'queued' })}
                    label={`Never answered, ${name}`}
                  />
                </Cell>
                <Cell>{stamp(p.last_at)}</Cell>
              </Row>
            );
          })}
        </TableBody>
      </Table>
      <p className="bl__sub">
        {grouped(total)} rows recorded for this organisation in the period, across every
        channel. A row is one attempted send.
      </p>
      {/* Migration 098 asks for this to be watched by name: `unclassified` is
          what the writer stores when a sender passes no purpose, and "if it is
          still most of the table in a month, question 1 cannot be broken down
          and this column is decoration". Saying it on the screen is the only
          way anybody watches it. */}
      {unclassified > total / 2 && total > 0 && (
        <p className="bl__note bl__note--warn">
          <Tag color="var(--warn)">Mostly unclassified</Tag>
          {grouped(unclassified)} of these {grouped(total)} rows were sent without a
          purpose recorded, so the breakdown above cannot account for most of the period.
          The senders behind them have not been taught to say what they were for.
        </p>
      )}
    </>
  );
}

/**
 * A count that opens the rows behind it — or a dash that does not.
 *
 * Zero is not a button. A control that opens an empty modal teaches people the
 * modal is broken; a dash says there is nothing to open, which is the same
 * `.bl__none` the credit figures already use for "nothing was recorded here".
 */
function Figure({ count, sub, weak, tone = '', onClick, label }) {
  if (!count) return <span className="bl__none" aria-label="nothing recorded">—</span>;
  return (
    <button
      type="button"
      className={`bl__lnk bl__lnk--fig ob__fig${tone === 'bad' ? ' ob__fig--bad' : ''}`}
      onClick={onClick}
      aria-label={label}
    >
      <span className="bl__fig-c">{grouped(count)}</span>
      {sub && (
        <span className={`bl__fig-r${weak ? ' ob__unconf' : ''}`}>
          {weak ? 'none confirmed' : sub}
        </span>
      )}
    </button>
  );
}

/**
 * The individual sends behind one figure, or every send made to one address.
 *
 * TWO SCOPES, AND THE CAPTION IS BUILT FROM THE SERVER'S ANSWER rather than
 * from what was asked for. `scope` comes back on the body and `period` comes
 * back NULL when the server ignored the month — which it does for a recipient
 * lookup, because "did this person get their payslip?" is not a question about
 * a month and making somebody guess which run it was in turns one lookup into
 * six. Captioning this from the local `period` prop instead would put one month
 * on a result that spans years.
 */
function SendDrill({ drill, basePath, period, recordingSince, onClose }) {
  const [body, setBody] = useState(null);
  const [failed, setFailed] = useState('');

  const open = Boolean(drill);
  const recipient = drill?.recipient || '';
  const purpose = drill?.purpose || '';
  const status = drill?.status || '';

  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    setBody(null);
    setFailed('');
    api.get(`${basePath}/outbound/messages`, {
      params: {
        period: recipient ? undefined : period,
        purpose: purpose || undefined,
        status: status || undefined,
        recipient: recipient || undefined,
        limit: 200,
      },
    })
      .then(r => { if (live) setBody(r.data || null); })
      .catch(e => { if (live) setFailed(refusal(e, 'Couldn’t load these sends.')); });
    return () => { live = false; };
  }, [open, basePath, period, purpose, status, recipient]);

  const rows = body?.data || null;
  const byRecipient = body?.scope === 'recipient';
  /* Same boundary as the card above, derived again rather than threaded
     through as a prop: this modal is reachable from both consoles and the
     column heading has to be honest in each. */
  const platformView = /\/billing\/orgs\//.test(basePath || '');

  const title = recipient
    ? `Sends to ${recipient}`
    : `${status ? statusWord(status) : 'Every status'}${purpose ? ` · ${purpose}` : ''}`;

  return (
    <Modal
      open={open}
      onOpenChange={v => { if (!v) onClose(); }}
      title={title}
      dataTestId="outbound-messages"
      size="lg"
    >
      <p className="bl__sub">
        {byRecipient
          ? 'Every send recorded to that address for this organisation, newest first, '
            + 'across all months. Invitations and password resets are sent before an '
            + 'organisation exists and are not among them.'
          : `Within ${monthName(body?.period || period)}.`}
        {recordingSince && ` The log begins on ${stamp(recordingSince)}; nothing before that was recorded.`}
      </p>

      {failed && <p className="bl__err" role="alert">{failed}</p>}
      {!failed && rows === null && <SkeletonTable rows={5} />}

      {rows && rows.length === 0 && (
        <EmptyState
          title={{ en: 'No sends recorded', hi: 'कोई प्रेषण नहीं' }}
          description={byRecipient
            ? 'Nothing was recorded to that address. A send that predates this log left '
              + 'no trace anywhere, so this is not evidence that it never happened.'
            : 'Nothing matching was recorded in this period.'}
        />
      )}

      {rows && rows.length > 0 && (
        <>
          <Table className="bl__tbl">
            <TableHead>
              <HeadCell>When</HeadCell>
              <HeadCell>{platformView ? 'To (domain)' : 'To'}</HeadCell>
              <HeadCell>What</HeadCell>
              <HeadCell>Status</HeadCell>
              <HeadCell>Evidence</HeadCell>
            </TableHead>
            <TableBody>
              {rows.map(r => (
                <Row key={r.id}>
                  <Cell>{stamp(r.created_at)}</Cell>
                  <Cell><span className="bl__ref">{r.target || '—'}</span></Cell>
                  <Cell>
                    <span className="bl__item">{r.subject || r.purpose || 'No purpose recorded'}</span>
                    {r.ref && <span className="bl__ref">{r.ref}</span>}
                    {r.channel && <span className="bl__ref">{r.channel}</span>}
                  </Cell>
                  <Cell>
                    <Tag color={STATUS_TONE[r.status]}>{statusWord(r.status)}</Tag>
                    {/* The kill-switch mode, and ONLY when it contradicts the
                        status. A dry-mode suppression is the normal, correct
                        state on staging and saying so on every row is noise; a
                        dry-mode row that reached a provider is the thing
                        migration 098 says must never exist. */}
                    {r.mode === 'dry' && (r.status === 'sent' || r.status === 'failed') && (
                      <Tag color="var(--danger)">bypassed dry mode</Tag>
                    )}
                    {/* The failure reason, verbatim and unparsed. It is the
                        provider's own sentence — "Email address is not
                        verified" — and rewriting it into our words loses the
                        one string that would have explained the bounce. */}
                    {r.error && <span className="ob__why">{r.error}</span>}
                  </Cell>
                  <Cell>
                    {r.provider_message_id ? (
                      <span className="ob__ev">
                        <span className="bl__ref">{r.provider_message_id}</span>
                        {r.provider && <span className="bl__ph-e">{r.provider}</span>}
                      </span>
                    ) : (
                      <span className="ob__none" title="No provider message id was recorded for this send">
                        Not confirmed
                      </span>
                    )}
                  </Cell>
                </Row>
              ))}
            </TableBody>
          </Table>
          {body?.truncated && (
            <p className="bl__note bl__note--pad">
              The 200 most recent are shown. There are more.
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
