// Dashboard — the module's own summary, beneath the KPI strip the route file
// already draws from the same call.
//
// The old version rendered three `.k-stats` rows of eleven StatTiles: every
// figure the endpoint returns, at equal weight, with no ordering and no units.
// Eleven equal numbers is not a dashboard — it is the endpoint's response
// pretty-printed. The four that decide what you do next are in the KPI strip
// above; what is left is the funnel (which only means anything as a sequence of
// steps with drop-off between them) and the recent campaigns.
//
// It also crashed on a fresh org: `data.recent_campaigns.length` with no guard,
// on a response where that key is `[]` — fine — but `data` itself was set from a
// `.catch` that only pushed a toast, so a failed call left `data` null and the
// shimmer ran forever. There was no error state at all.
import React from 'react';
import { Badge } from '../../components/editorial';
import { api, body, Panel, Bar, useResource, CAMPAIGN_COLORS, humanise, pct, plural, fmtDate, DataTable, Td } from './_shared';
import { useLanguage } from '../../components/CustomizePanel';
import { secondaryOf } from '../../lib/labels';
import { Secondary } from '../../components/Bilingual';

export default function DashboardTab() {
  // ONE LABEL SHAPE — the funnel table's second script, same leak as the rest.
  const lang = useLanguage();
  const { data, loading, error, reload } = useResource(
    () => api.get('/v1/prachar/dashboard').then(body), [],
  );

  const c = data?.campaigns || {};
  const d = data?.delivery || {};
  const sent = Number(d.total_sent || 0);
  const recent = data?.recent_campaigns || [];

  // OPENS, CLICKS AND BOUNCES ARE NOT MEASURED, and this screen used to draw
  // them as though they were: three rows of the funnel, with a rate against the
  // step above and a red bounce cell over 5%.
  //
  // Nothing in the product writes those columns — no webhook, no pixel, no
  // click redirect — so on most orgs they read 0, which looks like "nobody
  // opened it", and on Unicode Group they read the demo seed, which looks like
  // a result. The backend now serves them as null with
  // `engagement_measured: false` (services/engagement_metrics.py), and null is
  // the thing this file must not coerce: `Number(null || 0)` is 0, and 0 is a
  // measurement. So the test is `== null`, and the answer is a sentence rather
  // than a number.
  const measured = data?.engagement_measured === true;
  const unknown = (v) => !measured || v == null;

  // The funnel, in order, each step measured against the one above it. A raw
  // "1,204 opened" says nothing; "1,204 of 8,900 delivered — 13.5%" is the same
  // number doing work.
  const funnel = [
    { label: 'Sent', hi: 'भेजा', n: sent, of: sent, note: plural(Number(c.sent || 0), 'campaign') },
    {
      label: 'Opened', hi: 'खुला', n: d.total_opened, of: sent,
      note: unknown(d.total_opened) ? 'nothing receives open events' : 'of everything sent',
    },
    {
      label: 'Clicked', hi: 'क्लिक', n: d.total_clicked, of: d.total_opened,
      note: unknown(d.total_clicked) ? 'nothing receives click events' : 'of everything opened',
    },
    {
      label: 'Bounced', hi: 'वापस', n: d.total_bounced, of: sent, bad: true,
      note: unknown(d.total_bounced)
        ? 'nothing receives bounce events — a bad address is never suppressed'
        : 'undeliverable addresses',
    },
  ];

  return (
    <div>
      <Bar title="Delivery funnel" hi="वितरण" />
      <Panel
        loading={loading}
        error={error}
        onRetry={reload}
        empty={!loading && !error && sent === 0}
        emptyProps={{
          icon: '📊',
          title: 'Nothing has gone out yet',
          sub: 'Once a campaign sends, its delivery, opens, clicks and bounces are summed here.',
        }}
        count={4}
      >
        <DataTable columns={['Stage', { label: 'Contacts', align: 'right' }, { label: 'Rate', align: 'right' }, 'Measured against']}>
          {funnel.map((f) => {
            const fi = secondaryOf(f.hi, lang);
            return (
            <tr key={f.label}>
              <td>
                {f.label}
                {fi.secondary && <Secondary className="pr__bar-hi" value={fi.secondary} script={fi.script} />}
              </td>
              <Td align="right" mono bold>
                {unknown(f.n) && f.label !== 'Sent'
                  ? 'Not measured'
                  : Number(f.n || 0).toLocaleString('en-IN')}
              </Td>
              <Td
                align="right"
                mono
                color={!unknown(f.n) && f.bad && f.of && f.n / f.of > 0.05 ? 'var(--danger)' : undefined}
              >
                {f.label === 'Sent' || unknown(f.n) ? '—' : pct(f.n, f.of)}
              </Td>
              <td className="pr__step-when">{f.note}</td>
            </tr>
            );
          })}
        </DataTable>
      </Panel>

      {!measured && (
        <p className="pr__step-when">
          {data?.engagement_note
            || 'Opens, clicks and bounces are not measured — nothing in the product receives delivery events yet.'}
          {' '}Recipients and send dates are real; everything on this screen that is
          marked <b>Not measured</b> is missing, not zero.
        </p>
      )}

      <Bar title="Campaigns by state" hi="स्थिति" />
      <Panel loading={loading} error={error} onRetry={reload} count={5}>
        <DataTable columns={['State', { label: 'Campaigns', align: 'right' }, 'What it means']}>
          {[
            ['draft', c.drafts, 'Written, no date set — will not go out'],
            ['scheduled', c.scheduled, 'Dated and waiting'],
            ['sending', c.sending, 'Going out right now'],
            ['sent', c.sent, 'Delivered, figures final'],
            // A campaign the outbound switch stopped lands here with nothing
            // delivered. Without this row it counted toward the total and
            // showed in no state, so the states stopped adding up.
            ['suppressed', c.suppressed, 'Stopped before anything was delivered — send it again to resume'],
          ].map(([k, n, why]) => (
            <tr key={k}>
              <td><Badge text={humanise(k)} color={CAMPAIGN_COLORS[k]} /></td>
              <Td align="right" mono bold>{Number(n || 0)}</Td>
              <td className="pr__step-when">{why}</td>
            </tr>
          ))}
        </DataTable>
      </Panel>

      <Bar title="Recent campaigns" hi="हाल के" />
      <Panel
        loading={loading}
        error={error}
        onRetry={reload}
        empty={recent.length === 0}
        emptyProps={{
          icon: '📣',
          title: 'No campaigns yet',
          sub: 'The five most recently created campaigns appear here.',
        }}
        count={3}
      >
        {/* The Opened and Open rate columns are dropped entirely while nothing
            measures them, rather than filled with "Not measured" five times
            down a narrow table. The sentence under the funnel above already
            says why, once, and two empty columns on every row is the kind of
            noise a person learns to read past. */}
        <DataTable columns={[
          'Name', 'Status', 'Sent',
          { label: 'Recipients', align: 'right' },
          ...(measured ? [{ label: 'Opened', align: 'right' }, { label: 'Open rate', align: 'right' }] : []),
        ]}>
          {recent.map((r) => (
            <tr key={r.id}>
              <Td bold>{r.name}</Td>
              <td><Badge text={humanise(r.status)} color={CAMPAIGN_COLORS[r.status]} /></td>
              <td>{r.sent_at ? fmtDate(r.sent_at) : '—'}</td>
              <Td align="right" mono>{r.total_recipients || 0}</Td>
              {measured && <Td align="right" mono>{r.total_opened == null ? '—' : r.total_opened}</Td>}
              {measured && (
                <Td align="right" mono>
                  {r.total_opened == null ? '—' : pct(Number(r.total_opened), Number(r.total_recipients || 0))}
                </Td>
              )}
            </tr>
          ))}
        </DataTable>
      </Panel>

      <Bar title="Assets" hi="संसाधन" />
      <Panel loading={loading} error={error} onRetry={reload} count={3}>
        <DataTable columns={['Asset', { label: 'Count', align: 'right' }]}>
          {[
            ['Templates', data?.templates_count],
            ['Automations', data?.automations_count],
            ['Opted out', data?.unsubscribes_count],
          ].map(([label, n]) => (
            <tr key={label}>
              <td>{label}</td>
              <Td align="right" mono bold>{Number(n || 0)}</Td>
            </tr>
          ))}
        </DataTable>
      </Panel>
    </div>
  );
}
