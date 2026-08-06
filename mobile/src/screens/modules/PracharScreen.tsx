import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '../../theme/ThemeProvider';
import { useOnline } from '../../hooks/useOnline';
import { resolveScreenState } from '../../components/ScreenState';
import ModuleShell, { Stat, StatRow, SectionHead, Card, Tag } from './ModuleShell';
import { pracharApi, num, type PracharDashboard } from '../../api/modules';
import { withAlpha } from '../../theme/tokens';

/**
 * Prachar · प्रचार — marketing, checking view.
 *
 * Endpoint:
 *   GET /api/v1/prachar/dashboard   campaign counts, delivery totals, 5 newest
 *
 * The question this answers on a phone is "did the send land", not "let me
 * build a campaign". Composing, audience selection and scheduling stay on
 * desktop — and sending anything from here would cross OUTBOUND_MODE, which is
 * not a mobile decision to make.
 *
 * Open and click rates are computed against `total_sent` rather than being read
 * from the server, because the dashboard returns raw counters. The guard on the
 * divide matters: an org with campaigns drafted but none sent has
 * total_sent = 0, and an unguarded rate renders as NaN%.
 *
 * ── OPENS, CLICKS AND BOUNCES ARE NOT MEASURED ────────────────────────────
 *
 * Nothing in the product writes those three columns — no Resend webhook, no
 * tracking pixel, no click redirect. On most orgs they read 0; on Unicode Group
 * they held demo seed (51 opens, 29 clicks) which this screen turned into a
 * DELIVERY strip of percentages, in green, on a phone, with no surrounding
 * text. The server now sends them as null with `engagement_measured: false`
 * (`backend/services/engagement_metrics.py`).
 *
 * `num()` coerces null to 0, and 0 through `pct()` is "0%" — a measurement.
 * So the flag is read BEFORE the numbers, and while it is false this screen
 * says so in words rather than showing a rate.
 */

const STATUS_LABEL: Record<string, string> = {
  sent: 'Sent', sending: 'Sending', draft: 'Draft', scheduled: 'Scheduled', paused: 'Paused',
};

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');

export default function PracharScreen() {
  const { t } = useTheme();
  const online = useOnline();

  const q = useQuery({ queryKey: ['prachar', 'dashboard'], queryFn: pracharApi.dashboard });

  // Annotated, not inferred — see the note in api/modules.ts.
  const d: PracharDashboard | undefined = q.data;
  const recent = d?.recent_campaigns ?? [];

  const status = resolveScreenState({
    isLoading: q.isLoading,
    isError:   q.isError,
    error:     q.error,
    online,
    hasData:   q.data !== undefined,
    isEmpty:   false,
  });

  // Read the flag, not the values — see the header. `=== true` rather than a
  // truthiness test so an older server that omits the key falls to the honest
  // side rather than the confident one.
  const measured = d?.engagement_measured === true;

  const sent    = num(d?.delivery?.total_sent);
  const opened  = num(d?.delivery?.total_opened);
  const clicked = num(d?.delivery?.total_clicked);
  const bounced = num(d?.delivery?.total_bounced);

  return (
    <ModuleShell
      title="Marketing" hi="प्रचार"
      status={status}
      stale={q.data !== undefined && !online}
      onRetry={() => q.refetch()}
      refreshing={q.isRefetching}
      boundary="Composing a campaign, choosing an audience and scheduling a send are desktop work. Nothing is sent from this screen."
    >
      <SectionHead label="DELIVERY" hi="वितरण" />
      {measured ? (
        <StatRow>
          <Stat value={pct(opened, sent)}  label="Opened" tone={t.success} />
          <Stat value={pct(clicked, sent)} label="Clicked" />
          <Stat
            value={pct(bounced, sent)}
            label="Bounced"
            tone={bounced > 0 ? t.error : undefined}
          />
        </StatRow>
      ) : (
        <StatRow>
          <Stat value={sent.toLocaleString('en-IN')} label="Recipients" />
          <Stat value="—" label="Opened" />
          <Stat value="—" label="Clicked" />
        </StatRow>
      )}
      <Text style={[s.footnote, { color: t.ink4 }]}>
        {measured
          ? `Across ${sent.toLocaleString('en-IN')} recipient${sent === 1 ? '' : 's'} on campaigns already sent.`
          : `Across ${sent.toLocaleString('en-IN')} recipient${sent === 1 ? '' : 's'} on campaigns already sent. Opens, clicks and bounces are not measured — nothing receives delivery events yet.`}
      </Text>

      <SectionHead label="CAMPAIGNS" hi="अभियान" />
      <StatRow>
        <Stat value={String(num(d?.campaigns?.sent))}      label="Sent" />
        <Stat value={String(num(d?.campaigns?.scheduled))} label="Scheduled" tone={t.approval} />
        <Stat value={String(num(d?.campaigns?.drafts))}    label="Drafts" />
      </StatRow>

      <SectionHead label="RECENT" hi="हाल का" right={String(recent.length)} />
      {recent.length === 0 ? (
        <Card>
          <Text style={[s.meta, { color: t.ink3 }]}>
            No campaigns yet. Anything created on the web shows up here.
          </Text>
        </Card>
      ) : recent.map(c => {
        const key  = (c.status ?? '').toLowerCase();
        const tone = key === 'sent' ? t.success
                   : key === 'sending' || key === 'scheduled' ? t.approval
                   : t.ink3;
        const recipients = num(c.total_recipients);
        const when = c.sent_at ? new Date(c.sent_at) : null;
        return (
          <Card key={c.id}>
            <View style={s.rowTop}>
              <Text style={[s.title, { color: t.ink }]} numberOfLines={2}>
                {c.name?.trim() || 'Untitled campaign'}
              </Text>
              <Tag text={STATUS_LABEL[key] ?? c.status ?? '—'} tone={tone} bg={withAlpha(tone, 0.12)} />
            </View>
            <Text style={[s.meta, { color: t.ink3 }]} numberOfLines={1}>
              {/* eslint-disable-next-line no-nested-ternary */}
              {recipients === 0
                ? 'Not sent yet'
                : measured
                  ? `${recipients.toLocaleString('en-IN')} recipients · ${pct(num(c.total_opened), recipients)} opened`
                  : `${recipients.toLocaleString('en-IN')} recipients`}
              {when && !Number.isNaN(when.getTime())
                ? ` · ${when.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
                : ''}
            </Text>
          </Card>
        );
      })}

      <Text style={[s.footnote, { color: t.ink4, marginTop: 12 }]}>
        {num(d?.unsubscribes_count).toLocaleString('en-IN')} unsubscribed ·{' '}
        {num(d?.templates_count)} template{num(d?.templates_count) === 1 ? '' : 's'} ·{' '}
        {num(d?.automations_count)} automation{num(d?.automations_count) === 1 ? '' : 's'}
      </Text>
    </ModuleShell>
  );
}

const s = StyleSheet.create({
  rowTop:   { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  title:    { flex: 1, fontSize: 14, fontWeight: '700', lineHeight: 19 },
  meta:     { fontSize: 11.5, lineHeight: 16 },
  footnote: { fontSize: 11, lineHeight: 15.5, marginTop: 2 },
});
