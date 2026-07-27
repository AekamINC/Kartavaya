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
import { Badge, DataTable, Td } from '../../components/editorial';
import {
  api, body, Panel, Bar, useResource,
  CAMPAIGN_COLORS, humanise, pct, plural, fmtDate,
} from './_shared';

export default function DashboardTab() {
  const { data, loading, error, reload } = useResource(
    () => api.get('/v1/prachar/dashboard').then(body), [],
  );

  const c = data?.campaigns || {};
  const d = data?.delivery || {};
  const sent = Number(d.total_sent || 0);
  const opened = Number(d.total_opened || 0);
  const clicked = Number(d.total_clicked || 0);
  const bounced = Number(d.total_bounced || 0);
  const recent = data?.recent_campaigns || [];

  // The funnel, in order, each step measured against the one above it. A raw
  // "1,204 opened" says nothing; "1,204 of 8,900 delivered — 13.5%" is the same
  // number doing work.
  const funnel = [
    { label: 'Sent', hi: 'भेजा', n: sent, of: sent, note: plural(Number(c.sent || 0), 'campaign') },
    { label: 'Opened', hi: 'खुला', n: opened, of: sent, note: 'of everything sent' },
    { label: 'Clicked', hi: 'क्लिक', n: clicked, of: opened, note: 'of everything opened' },
    { label: 'Bounced', hi: 'वापस', n: bounced, of: sent, note: 'undeliverable addresses', bad: true },
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
          {funnel.map((f) => (
            <tr key={f.label}>
              <td>
                {f.label}
                <span className="pr__bar-hi" lang="hi"> {f.hi}</span>
              </td>
              <Td align="right" mono bold>{f.n.toLocaleString('en-IN')}</Td>
              <Td align="right" mono color={f.bad && f.of && f.n / f.of > 0.05 ? 'var(--danger)' : undefined}>
                {f.label === 'Sent' ? '—' : pct(f.n, f.of)}
              </Td>
              <td className="pr__step-when">{f.note}</td>
            </tr>
          ))}
        </DataTable>
      </Panel>

      <Bar title="Campaigns by state" hi="स्थिति" />
      <Panel loading={loading} error={error} onRetry={reload} count={4}>
        <DataTable columns={['State', { label: 'Campaigns', align: 'right' }, 'What it means']}>
          {[
            ['draft', c.drafts, 'Written, no date set — will not go out'],
            ['scheduled', c.scheduled, 'Dated and waiting'],
            ['sending', c.sending, 'Going out right now'],
            ['sent', c.sent, 'Delivered, figures final'],
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
        <DataTable columns={[
          'Name', 'Status', 'Sent',
          { label: 'Recipients', align: 'right' },
          { label: 'Opened', align: 'right' },
          { label: 'Open rate', align: 'right' },
        ]}>
          {recent.map((r) => (
            <tr key={r.id}>
              <Td bold>{r.name}</Td>
              <td><Badge text={humanise(r.status)} color={CAMPAIGN_COLORS[r.status]} /></td>
              <td>{r.sent_at ? fmtDate(r.sent_at) : '—'}</td>
              <Td align="right" mono>{r.total_recipients || 0}</Td>
              <Td align="right" mono>{r.total_opened || 0}</Td>
              <Td align="right" mono>{pct(Number(r.total_opened || 0), Number(r.total_recipients || 0))}</Td>
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
