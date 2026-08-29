// Campaigns — the calendar the reference is built around.
//
// `ScreenPrachar` in `design-reference/Kartavaya Redesign/ScreensMore.jsx` is
// almost entirely this one surface: channel chips over a seven-column month
// grid, campaigns as tinted pills on the day they go out, "Drag to reschedule.
// Channel dots in month view, full previews in week view."
//
// The build rendered a flat vertical list of cards with no date on them at all,
// which is remarkable for a module whose only irreducible question is what goes
// out and when. `prachar_campaigns` has carried `scheduled_at` and `channel`
// since migration 021 and `PATCH /campaigns/{id}` has always accepted a new
// `scheduled_at`, so every part of the reference screen was already backed by
// the API — nothing here is a mock, and the drag writes through.
//
// Three things the reference cannot tell us, decided here:
//
//  · A campaign with no `scheduled_at` cannot sit on a grid. Dropping it would
//    make the calendar under-report the work in flight, so it goes in a named
//    tray under the month and can be dragged ONTO a day to schedule it.
//  · `PATCH` is refused by the server once a campaign is sending or sent
//    (prachar.py:255). Those pills are not draggable, and they say why on hover
//    rather than failing after the drop.
//  · The month is real. The reference hard-codes 28 cells from a Monday; the
//    lead blanks and the length are derived from the month being shown.
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Badge, BackButton } from '../../components/editorial';
import { useToast } from '../../components/ui/toast';
import useModuleWrite from '../../hooks/useModuleWrite';
import AudienceFilter from './AudienceFilter';
import { api, rows, body, Panel, Bar, useResource, useMutate, CAMPAIGN_COLORS, CHANNELS, channelColor, channelLabel, fmtDate, fmtDateTime, humanise, plural, pct, normaliseFilter, parseFilter, filterLabel, reachSentence, DataTable, Td } from './_shared';
import DateInput from '../../components/ui/DateInput';

/** Monday-first, matching the reference's `['सोम','मंगल','बुध','गुरु','शुक्र','शनि','रवि']`. */
const DOW_HI = ['सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि', 'रवि'];
const DOW_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Local Y-M-D. `toISOString()` is UTC and would file a 1 a.m. IST campaign on
 *  the previous day for every user in the country. */
const dayKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Monday = 0. `getDay()` is Sunday = 0, which would shift the whole grid one
 *  column left on a Monday-first calendar. */
const mondayIndex = (d) => (d.getDay() + 6) % 7;

/** A campaign is editable only while the server would accept the edit. */
const isMovable = (c) => c.status === 'draft' || c.status === 'scheduled';

export default function CampaignsTab({ scheduleNonce = 0, seedTemplate = null, onChanged }) {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change campaigns' });
  const { pushToast } = useToast();
  const { busy, go } = useMutate(pushToast);

  const [view, setView] = useState('m');          // m | w | list
  const [anchor, setAnchor] = useState(() => new Date());
  const [channels, setChannels] = useState([]);   // [] = all
  const [form, setForm] = useState(null);
  const [detail, setDetail] = useState(null);
  const [drag, setDrag] = useState(null);         // campaign id being dragged
  const [over, setOver] = useState(null);         // day key under the pointer

  const { data, loading, error, reload } = useResource(
    () => api.get('/v1/prachar/campaigns').then(rows), [],
  );
  const campaigns = data || [];

  // The header's Schedule button. Nonce, not boolean — see PracharPage.
  // TemplatesTab's "Use for campaign" trips the same nonce with a template
  // id riding beside it, so the form opens pre-seeded instead of blank.
  useEffect(() => {
    if (scheduleNonce > 0) setForm({ ...blank(), template_id: seedTemplate || '' });
  }, [scheduleNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(
    () => (channels.length ? campaigns.filter((c) => channels.includes(c.channel)) : campaigns),
    [campaigns, channels],
  );

  const byDay = useMemo(() => {
    const m = new Map();
    for (const c of shown) {
      if (!c.scheduled_at) continue;
      const k = dayKey(new Date(c.scheduled_at));
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(c);
    }
    return m;
  }, [shown]);

  const unscheduled = useMemo(() => shown.filter((c) => !c.scheduled_at), [shown]);

  const refresh = useCallback(() => { reload(); onChanged?.(); }, [reload, onChanged]);

  /** Drop a campaign on a day. Keeps the existing time of day when it had one —
   *  moving a 9 a.m. send to Thursday should not silently reschedule it to
   *  midnight. */
  const drop = async (id, key) => {
    setDrag(null); setOver(null);
    const c = campaigns.find((x) => x.id === id);
    if (!c || !isMovable(c)) return;
    const prev = c.scheduled_at ? new Date(c.scheduled_at) : null;
    const [y, mo, d] = key.split('-').map(Number);
    const next = new Date(y, mo - 1, d, prev ? prev.getHours() : 9, prev ? prev.getMinutes() : 0);
    if (prev && dayKey(prev) === key) return;
    const r = await go(
      () => api.patch(`/v1/prachar/campaigns/${id}`, { scheduled_at: next.toISOString() }),
      `${c.name} moved to ${fmtDate(next)}`,
    );
    if (r.ok) refresh();
  };

  const save = async () => {
    if (!form.name.trim()) return pushToast({ type: 'error', title: 'A campaign needs a name.' });
    if (!form.subject.trim()) return pushToast({ type: 'error', title: 'A campaign needs a subject line.' });
    const payload = {
      name: form.name.trim(),
      // The link, not just the copied text — `template_id` is what
      // `POST .../send` uses to read `compliance_class` off the template
      // (prachar.py:887-895), so a campaign started from a template stays
      // classified even after its subject/body have been edited here.
      template_id: form.template_id || null,
      subject: form.subject.trim(),
      body_html: form.body_html,
      channel: form.channel,
      // Was `{}`, hard-coded, in the payload shared by create AND edit. That
      // one literal is why every campaign this product ever sent went to the
      // whole org, and why editing a campaign's name discarded the segment
      // somebody had set on it through any other means.
      audience_filter: normaliseFilter(form.audience_filter),
      scheduled_at: form.scheduled_at ? new Date(form.scheduled_at).toISOString() : null,
    };
    const r = await go(
      () => (form.id
        ? api.patch(`/v1/prachar/campaigns/${form.id}`, payload)
        : api.post('/v1/prachar/campaigns', payload)),
      form.id ? 'Campaign updated' : 'Campaign created',
    );
    if (r.ok) { setForm(null); refresh(); }
    return undefined;
  };

  if (detail) {
    return (
      <CampaignDetail
        campaign={detail}
        onBack={() => setDetail(null)}
        onEdit={(c) => { setDetail(null); setForm(toForm(c)); }}
        onChanged={refresh}
      />
    );
  }

  if (form) return <CampaignForm form={form} setForm={setForm} onSave={save} onCancel={() => setForm(null)} busy={busy} />;

  const month = anchor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <div>
      <Bar title="Campaigns" hi="अभियान">
        <div className="seg" role="group" aria-label="Calendar view">
          {[['m', 'Month'], ['w', 'Week'], ['list', 'List']].map(([id, l]) => (
            <button
              key={id}
              type="button"
              className={`seg__b${view === id ? ' on' : ''}`}
              aria-pressed={view === id}
              onClick={() => setView(id)}
            >
              {l}
            </button>
          ))}
        </div>
        <button type="button" className="k-btn k-btn--primary k-btn--sm" onClick={() => setForm(blank())}
          disabled={!canWrite} title={denial || undefined}>
          + Schedule
        </button>
      </Bar>

      {/* The lede the reference puts under the page title. It belongs to this
          surface, not to the module — seven of the eight tabs are not a
          calendar. */}
      {view !== 'list' && (
        <p className="gpipe__lede">
          Drag a campaign to reschedule it. Channel dots in month view, full previews in week view.
        </p>
      )}

      <div className="chips" role="group" aria-label="Filter by channel">
        {CHANNELS.map((ch) => {
          const on = channels.includes(ch.id);
          const n = campaigns.filter((c) => c.channel === ch.id).length;
          return (
            <button
              key={ch.id}
              type="button"
              className={`chip${on ? ' on' : ''}`}
              aria-pressed={on}
              onClick={() => setChannels((s) => (on ? s.filter((x) => x !== ch.id) : [...s, ch.id]))}
            >
              <span className="chip__dot pr__dot" style={{ '--c': ch.color }} />
              {ch.label}
              <span className="pr__mono">{n}</span>
            </button>
          );
        })}
        <button
          type="button"
          className={`chip${channels.length === 0 ? ' on' : ''}`}
          aria-pressed={channels.length === 0}
          onClick={() => setChannels([])}
        >
          All campaigns
        </button>
      </div>

      <div className="pr__cal-nav">
        <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={() => setAnchor(shift(anchor, view, -1))}>
          ← Previous
        </button>
        <span className="pr__cal-m">{view === 'w' ? weekLabel(anchor) : month}</span>
        <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={() => setAnchor(shift(anchor, view, 1))}>
          Next →
        </button>
        <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={() => setAnchor(new Date())}>
          Today
        </button>
      </div>

      <Panel
        loading={loading}
        error={error}
        onRetry={reload}
        empty={campaigns.length === 0}
        emptyProps={{
          icon: '📣',
          title: 'No campaigns yet',
          sub: 'A campaign is one message to one audience on one date. Schedule the first and it appears on this calendar.',
          // F32. A CTA in an object literal rather than a JSX attribute, which
          // is why the static sweep walked past it and only the browser found it.
          cta: canWrite ? '+ Schedule' : undefined,
          onCta: canWrite ? () => setForm(blank()) : undefined,
        }}
        count={6}
      >
        {view === 'list' ? (
          <CampaignList list={shown} onOpen={setDetail} />
        ) : (
          <>
            {view === 'm'
              ? <MonthGrid anchor={anchor} byDay={byDay} over={over} setOver={setOver} drag={drag} setDrag={setDrag} onDrop={drop} onOpen={setDetail} />
              : <WeekGrid anchor={anchor} byDay={byDay} over={over} setOver={setOver} drag={drag} setDrag={setDrag} onDrop={drop} onOpen={setDetail} />}

            {unscheduled.length > 0 && (
              <div className="pr__tray">
                <span className="pr__tray-l">
                  {plural(unscheduled.length, 'campaign')} with no date
                </span>
                <div className="pr__tray-items">
                  {unscheduled.map((c) => (
                    <Pill key={c.id} c={c} drag={drag} setDrag={setDrag} onOpen={setDetail} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}

/* ── Calendar pieces ──────────────────────────────────────────────────── */

function Pill({ c, drag, setDrag, onOpen }) {
  const movable = isMovable(c);
  return (
    <button
      type="button"
      className={`pr__pill${drag === c.id ? ' is-dragging' : ''}`}
      style={{ '--c': channelColor(c.channel) }}
      draggable={movable}
      onDragStart={(e) => { setDrag(c.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.id); }}
      onDragEnd={() => setDrag(null)}
      onClick={() => onOpen(c)}
      title={movable
        ? `${c.name} · ${channelLabel(c.channel)} · drag to reschedule`
        : `${c.name} · ${channelLabel(c.channel)} · already ${c.status}, so its date is fixed`}
    >
      <span className="pr__pill-dot" />
      <span className="pr__pill-t">{c.name}</span>
    </button>
  );
}

function MonthGrid({ anchor, byDay, over, setOver, drag, setDrag, onDrop, onOpen }) {
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  const lead = mondayIndex(new Date(y, m, 1));
  const days = new Date(y, m + 1, 0).getDate();
  const today = dayKey(new Date());
  // Trailing pads so the last row is full and the 7n border rule lands on a real
  // cell rather than on whatever happens to be last.
  const cells = lead + days;
  const trail = (7 - (cells % 7)) % 7;

  return (
    <div className="pr__cal">
      <div className="pr__cal-head">
        {DOW_HI.map((d, i) => (
          <div key={d} className="pr__cal-dow" lang="hi" title={DOW_EN[i]}>{d}</div>
        ))}
      </div>
      <div className="pr__cal-grid">
        {Array.from({ length: lead }, (_, i) => <div key={`p${i}`} className="pr__cal-d is-pad" />)}
        {Array.from({ length: days }, (_, i) => {
          const key = dayKey(new Date(y, m, i + 1));
          const items = byDay.get(key) || [];
          return (
            <div
              key={key}
              className={`pr__cal-d${key === today ? ' is-today' : ''}${over === key ? ' is-drop' : ''}`}
              onDragOver={(e) => { if (drag) { e.preventDefault(); setOver(key); } }}
              onDragLeave={() => setOver((o) => (o === key ? null : o))}
              onDrop={(e) => { e.preventDefault(); onDrop(drag, key); }}
            >
              <span className="pr__cal-n">{i + 1}</span>
              <div className="pr__cal-items">
                {items.map((c) => <Pill key={c.id} c={c} drag={drag} setDrag={setDrag} onOpen={onOpen} />)}
              </div>
            </div>
          );
        })}
        {Array.from({ length: trail }, (_, i) => <div key={`t${i}`} className="pr__cal-d is-pad" />)}
      </div>
    </div>
  );
}

function WeekGrid({ anchor, byDay, over, setOver, drag, setDrag, onDrop, onOpen }) {
  const start = new Date(anchor);
  start.setDate(start.getDate() - mondayIndex(start));
  const today = dayKey(new Date());

  return (
    <div className="pr__week">
      {Array.from({ length: 7 }, (_, i) => {
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        const key = dayKey(d);
        const items = byDay.get(key) || [];
        return (
          <div
            key={key}
            className={`pr__week-c${key === today ? ' is-today' : ''}${over === key ? ' is-drop' : ''}`}
            onDragOver={(e) => { if (drag) { e.preventDefault(); setOver(key); } }}
            onDragLeave={() => setOver((o) => (o === key ? null : o))}
            onDrop={(e) => { e.preventDefault(); onDrop(drag, key); }}
          >
            <div className="pr__week-h">
              <span className="pr__week-dow" lang="hi">{DOW_HI[i]}</span>
              <span className="pr__week-n">{d.getDate()}</span>
            </div>
            {items.length === 0
              ? <span className="pr__step-when">Nothing scheduled</span>
              : items.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`pr__wcard${drag === c.id ? ' is-dragging' : ''}`}
                  style={{ '--c': channelColor(c.channel) }}
                  draggable={isMovable(c)}
                  onDragStart={(e) => { setDrag(c.id); e.dataTransfer.effectAllowed = 'move'; }}
                  onDragEnd={() => setDrag(null)}
                  onClick={() => onOpen(c)}
                >
                  <span className="pr__wcard-n">{c.name}</span>
                  <span className="pr__wcard-s">{c.subject || 'No subject line'}</span>
                  <span className="pr__meta">
                    <span className="tag" style={{ '--c': channelColor(c.channel) }}>{channelLabel(c.channel)}</span>
                    <span>{humanise(c.status)}</span>
                  </span>
                </button>
              ))}
          </div>
        );
      })}
    </div>
  );
}

function CampaignList({ list, onOpen }) {
  if (list.length === 0) {
    return <p className="pr__step-when">No campaigns on the channels you have selected.</p>;
  }
  return (
    // Segment sits next to Channel because the two together are the whole of
    // "where does this go". A list that shows neither is how nobody noticed
    // that every row said the same thing.
    //
    // THE "OPENED" COLUMN IS GONE. Nothing in the product measures opens — see
    // `backend/services/engagement_metrics.py` — so the backend now serves
    // `total_opened` as null, and a column that renders `null || 0` prints a
    // confident 0 on every row. On Unicode Group it printed the demo seed, which
    // is worse. The column returns the day a receiver exists; until then the
    // table shows the two figures a send actually produces.
    <DataTable arrange="prachar.campaigns" columns={['Name', 'Channel', 'Segment', 'Scheduled', 'Status', { label: 'Recipients', align: 'right' }]}>
      {list.map((c) => (
        <tr key={c.id} onClick={() => onOpen(c)}>
          {/* Nothing in this row was focusable, so a campaign could not be
              opened without a mouse. `.btn--text` is the shared text button —
              no new class for one table. */}
          <Td bold>
            <button
              type="button"
              className="btn btn--text btn--sm"
              onClick={e => { e.stopPropagation(); onOpen(c); }}
            >
              {c.name}
            </button>
          </Td>
          <td><span className="tag" style={{ '--c': channelColor(c.channel) }}>{channelLabel(c.channel)}</span></td>
          <td className="pr__seg-c" title={filterLabel(c.audience_filter)}>{filterLabel(c.audience_filter)}</td>
          <td>{c.scheduled_at ? fmtDateTime(c.scheduled_at) : 'Not scheduled'}</td>
          <td><Badge text={humanise(c.status)} color={CAMPAIGN_COLORS[c.status]} /></td>
          <Td align="right" mono>{c.total_recipients || 0}</Td>
        </tr>
      ))}
    </DataTable>
  );
}

/* ── Detail ───────────────────────────────────────────────────────────── */

function CampaignDetail({ campaign, onBack, onEdit, onChanged }) {
  // F32 — this component owns its own write controls, so it asks
  // the same question rather than taking the answer as a prop.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change campaigns' });
  const { pushToast } = useToast();
  const { busy, go } = useMutate(pushToast);
  const [c, setC] = useState(campaign);

  // Two independent calls. The old detail view showed neither, although both
  // routes have existed since the module was written: `stats` is per-recipient
  // delivery, `audience` is who the filter actually resolves to. One failing
  // must not blank the other, which is why they are two resources.
  const stats = useResource(() => api.get(`/v1/prachar/campaigns/${c.id}/stats`).then(body), [c.id]);
  const audience = useResource(() => api.get(`/v1/prachar/campaigns/${c.id}/audience`).then(body), [c.id]);

  const send = async () => {
    const a = audience.data || {};
    // The number to confirm against is who RECEIVES it, not who matched. The
    // old confirm quoted the pre-suppression count, so a marketer agreed to 128
    // and 116 were sent — and only the toast afterwards mentioned the gap.
    const n = a.will_receive ?? a.matched ?? a.count;
    const who = n == null ? 'this campaign’s audience' : plural(n, 'person', 'people');
    // And the segment by name, so "send to everyone" is something somebody
    // reads and agrees to rather than something that merely happens.
    const seg = a.summary || filterLabel(c.audience_filter);
    // eslint-disable-next-line no-alert
    if (!window.confirm(
      `Send "${c.name}" to ${who}?\n\nAudience: ${seg}\n\nThis cannot be undone.`,
    )) return;
    let r = await go(() => api.post(`/v1/prachar/campaigns/${c.id}/send`).then(body), null);

    // ── THE ICAI REFUSAL, AND THE ONLY WAY THROUGH IT ────────────────────────
    //
    // The server answers 403 when the audience contains somebody the firm does
    // not act for. Two shapes come back and they are NOT the same:
    //
    //   the template has a compliance class  -> an override is available, and it
    //                                           costs a written basis
    //   the template has none                -> no override exists. Classify it
    //                                           first. Prompting here would be
    //                                           offering a door that is not there.
    //
    // The refusal text is rendered verbatim because it is the only place the
    // clause, the counts and the instruction appear together, and paraphrasing
    // it here would put a second, drifting copy of a legal statement in the UI.
    const status = r.error?.response?.status;
    const detail = r.error?.response?.data?.detail;
    if (!r.ok && status === 403 && typeof detail === 'string'
        && detail.includes('Clause (6)') && !detail.includes('compliance class')) {
      // eslint-disable-next-line no-alert
      const basis = window.prompt(
        `${detail}\n\nTo send anyway, state the basis. It is recorded against `
        + 'your name, with the date and the number of non-client recipients.',
        '',
      );
      if (!basis || !basis.trim()) return;
      r = await go(
        () => api.post(`/v1/prachar/campaigns/${c.id}/send`,
          { icai_override_basis: basis.trim() }).then(body),
        null,
      );
    }

    if (r.ok) {
      const out = r.out || {};
      pushToast({
        type: 'success',
        title: `Sending to ${plural(out.recipients || 0, 'recipient')}`,
        // The skip count is not a footnote. A send that quietly drops 40 people
        // because they opted out, and reports only the 60 it kept, is how a
        // marketer concludes their list is smaller than it is.
        message: [
          out.skipped_unsubscribed
            ? `${plural(out.skipped_unsubscribed, 'contact')} skipped — they have opted out.`
            : '',
          // Said on the way out as well as on the way in. The person who
          // authorised a non-client send should see it confirmed while they are
          // still looking at the screen they authorised it from.
          out.override_recorded
            ? `Override recorded: ${plural(out.compliance?.non_client_count || 0, 'recipient')} without a client record.`
            : '',
        ].filter(Boolean).join(' '),
      });
      setC({ ...c, status: 'sending' });
      onChanged?.();
    }
  };

  const s = stats.data || {};
  const total = Number(s.total || 0);

  return (
    <div>
      <BackButton onClick={onBack} label="Back to campaigns" />
      <div className="k-detail">
        <div className="k-detail__header">
          <div>
            <h3 className="k-detail__title">{c.name}</h3>
            <p className="k-detail__sub">
              {channelLabel(c.channel)} · {c.scheduled_at ? fmtDateTime(c.scheduled_at) : 'no date set'}
            </p>
          </div>
          <Badge text={humanise(c.status)} color={CAMPAIGN_COLORS[c.status]} />
        </div>

        <div className="k-metabar">
          <span>Subject: <strong>{c.subject || '—'}</strong></span>
        </div>

        <div className="k-detail__actions">
          {(c.status === 'draft' || c.status === 'scheduled') && (
            <>
              {/* ── SEND IS NOT OFFERED BEFORE THE NUMBER IT CONFIRMS AGAINST ──
                  `send()` below builds its confirmation from `audience.data`,
                  and this button used to be live from the moment the drawer
                  mounted — while that fetch was still in flight. Press it in
                  that window and `n` is undefined, so the confirm falls to its
                  `n == null` branch and reads "Send X to this campaign's
                  audience?" with NO NUMBER AT ALL, on an action the same
                  sentence calls irreversible.

                  Found by proposal 93 Suite 11 on 2026-08-29, from the dialog
                  text the run captured verbatim:

                    Send "S11-C7" to this campaign's audience? | Audience:
                    Clients only · company ~ "S11 Prachar Reach" | This cannot
                    be undone.

                  That is the same defect this file already fixed once, one step
                  earlier: the comment in `send()` records a marketer agreeing
                  to 128 while 116 were sent. Quoting no number is not safer
                  than quoting the wrong one — it is the same failure to tell
                  somebody what they are about to do.

                  ⚠ GATED ON `loading`, NEVER ON `data`. If the audience fetch
                  FAILS, `loading` is false and `data` stays null — and the
                  button must remain pressable, because the Panel below already
                  shows that error with a Retry and locking the operator out of
                  their own send would be a worse bug than the one being fixed.
                  In that case the honest `n == null` wording is exactly right
                  and is deliberately kept. */}
              <button
                type="button"
                className="k-btn k-btn--primary k-btn--sm"
                onClick={send}
                disabled={busy || !canWrite || audience.loading}
                title={denial
                  || (audience.loading ? 'Working out who this reaches…' : undefined)}
              >
                {busy ? 'Sending…' : 'Send now'}
              </button>
              <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={() => onEdit(c)}>
                Edit
              </button>
            </>
          )}
        </div>
      </div>

      <Bar title="Audience" hi="श्रोता" />
      <Panel
        loading={audience.loading}
        error={audience.error}
        onRetry={audience.reload}
        empty={audience.data?.count === 0}
        emptyProps={{
          icon: '👥',
          title: 'This campaign reaches nobody',
          sub: 'The audience filter resolves to no contacts with an email address. Add contacts in CRM, or widen the filter.',
        }}
        count={2}
      >
        {/* A sent campaign's filter is a historical record of who was targeted,
            and `PATCH` refuses to change it (prachar.py:255), so it renders as
            a fact rather than as a control. */}
        <div className="k-metabar">
          <span>Segment: <strong>{filterLabel(c.audience_filter)}</strong></span>
        </div>
        <p className="pr__step-when">
          {audience.data?.summary
            ? `${reachSentence(audience.data)} — ${audience.data.summary}.`
            : reachSentence(audience.data)}
        </p>
        {(audience.data?.contacts || []).length > 0 && (
          <DataTable arrange="prachar.campaign_audience" columns={['Name', 'Email', 'Company', 'Type']}>
            {(audience.data.contacts || []).map((p) => (
              <tr key={p.id}>
                <Td bold>{p.name}</Td>
                <td>{p.email}</td>
                <td>{p.company || '—'}</td>
                <td>{humanise(p.type)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      <Bar title="Delivery" hi="वितरण" />
      <Panel
        loading={stats.loading}
        error={stats.error}
        onRetry={stats.reload}
        empty={total === 0}
        emptyProps={{
          icon: '📊',
          title: 'Nothing sent yet',
          sub: 'Delivery figures appear here once this campaign has gone out.',
        }}
        count={2}
      >
        {/* Opened, Clicked and Bounced count contact statuses nothing ever
            writes — the column only holds 'pending', 'sent' and 'failed'. They
            were always 0, rendered beside a real Sent count with a 0% share,
            which reads as "we measured, and nobody opened it". The server now
            sends them as null; `Number(null || 0)` would put the 0 straight
            back, so the test is `== null`. */}
        <DataTable columns={['Outcome', { label: 'Contacts', align: 'right' }, { label: 'Share', align: 'right' }]}>
          {[
            ['Sent', s.sent], ['Opened', s.opened], ['Clicked', s.clicked],
            ['Bounced', s.bounced], ['Failed', s.failed],
          ].map(([label, n]) => (
            <tr key={label}>
              <td>{label}</td>
              <Td align="right" mono>{n == null ? 'Not measured' : Number(n)}</Td>
              <Td align="right" mono>{n == null ? '—' : pct(Number(n), total)}</Td>
            </tr>
          ))}
        </DataTable>
        {s.engagement_measured === false && (
          <p className="pr__step-when">{s.engagement_note}</p>
        )}
      </Panel>
    </div>
  );
}

/* ── Form ─────────────────────────────────────────────────────────────── */

const blank = () => ({
  name: '', template_id: '', subject: '', body_html: '', channel: 'email', scheduled_at: '',
  // `{}` here is the same value the old payload hard-coded, but it is now a
  // starting point the operator can change rather than the only value there is.
  audience_filter: {},
});

/** A campaign row back into form shape. `datetime-local` wants
 *  `YYYY-MM-DDTHH:mm` in LOCAL time; slicing the ISO string would show a UTC
 *  clock face and silently move every edit back by 5½ hours. */
const toForm = (c) => {
  let when = '';
  if (c.scheduled_at) {
    const d = new Date(c.scheduled_at);
    when = `${dayKey(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return {
    id: c.id, name: c.name || '', template_id: c.template_id || '', subject: c.subject || '',
    body_html: c.body_html || '', channel: c.channel || 'email', scheduled_at: when,
    // Reading this back is half the fix. `save()` sends whatever the form
    // holds, so a form that did not load the stored filter would overwrite it
    // with the blank one on the next save of any other field.
    audience_filter: parseFilter(c.audience_filter),
  };
};

function CampaignForm({ form, setForm, onSave, onCancel, busy }) {
  // F32 — this component owns its own write controls, so it asks
  // the same question rather than taking the answer as a prop.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change campaigns' });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  // Inbox 15: "marketing templates cannot become campaigns" — reproduced as
  // exactly that. The FK (`prachar_campaigns.template_id`) and the send-path
  // handling of it (prachar.py:887-895, resolving subject/body/compliance
  // class from the template) were both already built; TemplatesTab.jsx had
  // no button and this form had no field, so there was never a way to reach
  // either. This is the field.
  const templates = useResource(
    () => api.get('/v1/prachar/templates').then(rows), [],
  );
  const templateList = templates.data || [];

  // The cross-tab seed (PracharPage's `seedTemplate`) sets `template_id`
  // before this list has loaded — apply it once the template is actually
  // available, but only into a still-blank form, so re-opening an edited
  // draft never overwrites what the operator already typed.
  useEffect(() => {
    if (!form.id && form.template_id && !form.subject && !form.body_html && templateList.length) {
      const t = templateList.find((x) => x.id === form.template_id);
      if (t) setForm((f) => ({ ...f, subject: t.subject || '', body_html: t.body_html || '' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateList.length, form.template_id]);

  const applyTemplate = (id) => {
    const t = templateList.find((x) => x.id === id);
    setForm({
      ...form,
      template_id: id,
      // Copied in, not linked live — matching TemplatesTab's own Duplicate,
      // which copies rather than references. The operator edits a campaign's
      // own subject/body from here on; template_id is kept only so the send
      // path can still read the template's compliance_class.
      ...(t ? { subject: form.subject || t.subject || '', body_html: form.body_html || t.body_html || '' } : {}),
    });
  };

  return (
    <div>
      <BackButton onClick={onCancel} label="Back to campaigns" />
      <div className="k-formpanel">
        <h3 className="pr__form-t">{form.id ? 'Edit campaign' : 'New campaign'}</h3>
        {!form.id && (
          <label className="k-formpanel__label">Start from a template
            <select
              className="k-formpanel__input"
              value={form.template_id}
              onChange={(e) => applyTemplate(e.target.value)}
              disabled={templateList.length === 0}
            >
              <option value="">Blank campaign</option>
              {templateList.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.category ? ` — ${humanise(t.category)}` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="k-formpanel__grid k-formpanel__grid--2">
          <label className="k-formpanel__label">Campaign name
            <input className="k-formpanel__input" placeholder="e.g. July newsletter" value={form.name} onChange={set('name')} />
          </label>
          <label className="k-formpanel__label">Subject line
            <input className="k-formpanel__input" placeholder="e.g. Your monthly update" value={form.subject} onChange={set('subject')} />
          </label>
        </div>
        <div className="k-formpanel__grid k-formpanel__grid--2">
          <label className="k-formpanel__label">Channel
            <select className="k-formpanel__input" value={form.channel} onChange={set('channel')}>
              {CHANNELS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <label className="k-formpanel__label">Send at
            <DateInput className="k-formpanel__input" type="datetime-local" value={form.scheduled_at} onChange={set('scheduled_at')} />
          </label>
        </div>
        {/* Who, before what. The audience is the irreversible half of a
            campaign — the body can be rewritten until it is sent, the
            recipients cannot be recalled once it has been. */}
        <AudienceFilter
          value={form.audience_filter}
          onChange={(f) => setForm({ ...form, audience_filter: f })}
        />
        <label className="k-formpanel__label">Body
          <textarea className="k-formpanel__input" rows={8} placeholder="Campaign body…" value={form.body_html} onChange={set('body_html')} />
        </label>
        <div className="k-formpanel__actions">
          <button type="button" className="k-btn k-btn--primary k-btn--sm" onClick={onSave} disabled={busy || !canWrite} title={denial || undefined}>
            {busy ? 'Saving…' : (form.id ? 'Save campaign' : 'Create campaign')}
          </button>
          <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/* ── Date helpers ─────────────────────────────────────────────────────── */

function shift(d, view, by) {
  const n = new Date(d);
  if (view === 'w') n.setDate(n.getDate() + 7 * by);
  else n.setMonth(n.getMonth() + by, 1);
  return n;
}

function weekLabel(anchor) {
  const s = new Date(anchor);
  s.setDate(s.getDate() - mondayIndex(s));
  const e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6);
  const f = (d) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return `${f(s)} – ${f(e)}`;
}
