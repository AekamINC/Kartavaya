import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import { useOnline } from '../../hooks/useOnline';
import { resolveScreenState } from '../../components/ScreenState';
import ModuleShell, { Stat, StatRow, SectionHead, Card, Tag } from './ModuleShell';
import { srijanApi, num, type HubDashboard } from '../../api/modules';
import { withAlpha } from '../../theme/tokens';
import { hindi } from '../../theme/fonts';

/**
 * Sahayak · सहायक — the AI content hub, checking view.
 *
 * Endpoint:
 *   GET /api/v1/hub/dashboard   org-wide counts + the ten newest content items
 *
 * ── Why this is not the ask-anything box in the reference ────────────────────
 *
 * `MobileModules.jsx` sketches Sahayak as a chat: a prompt field, four canned
 * questions, an answer with a citation line. Two things in the actual system
 * make that the wrong screen to ship first, and both are structural rather than
 * a matter of effort:
 *
 *  1. **There is no org-level ask endpoint.** Every chat route in
 *     `routers/hub_chat.py` is `/clients/{client_id}/chat/sessions…`. A phone
 *     assistant would have to make the user pick a client before asking
 *     anything, which is precisely the friction the sketch was avoiding.
 *  2. **Every question spends model budget**, and the mobile app is the easiest
 *     place in the product to fire one by accident.
 *
 * So this ships as what 17 says the light modules are for — "the CHECKING view,
 * not the DOING view" — and the boundary note names the assistant as absent
 * rather than letting someone hunt for it. Wiring the ask box is a decision
 * about runtime spend and client scoping, not a missing screen.
 */

const STATUS_LABEL: Record<string, string> = {
  draft:          'Draft',
  pending_review: 'Needs review',
  approved:       'Approved',
  published:      'Published',
  scheduled:      'Scheduled',
  rejected:       'Rejected',
};

export default function SrijanScreen() {
  const { t } = useTheme();
  const online = useOnline();

  const q = useQuery({ queryKey: ['sahayak', 'dashboard'], queryFn: srijanApi.dashboard });

  // Annotated, not inferred — see the note in api/modules.ts.
  const d: HubDashboard | undefined = q.data;
  const recent = d?.recent_content ?? [];

  const status = resolveScreenState({
    isLoading: q.isLoading,
    isError:   q.isError,
    error:     q.error,
    online,
    hasData:   q.data !== undefined,
    isEmpty:   false,
  });

  const pending = num(d?.stats?.pending_review);

  return (
    <ModuleShell
      title="Assistant" hi="सहायक"
      status={status}
      stale={q.data !== undefined && !online}
      onRetry={() => q.refetch()}
      refreshing={q.isRefetching}
      boundary="Generating content, running skills and publishing are desktop work. Asking Sahayak a question is not on the phone yet — the chat endpoints are scoped to one client at a time."
    >
      <StatRow>
        <Stat
          value={String(pending)}
          label="Awaiting review"
          tone={pending > 0 ? t.approval : undefined}
        />
        <Stat value={String(num(d?.stats?.total_content))} label="Pieces of content" />
        <Stat value={String(num(d?.stats?.total_clients))} label="Clients" />
      </StatRow>

      <SectionHead label="RECENT CONTENT" hi="हाल का" right={String(recent.length)} />
      {recent.length === 0 ? (
        <Card>
          <Text style={[s.meta, { color: t.ink3 }]}>
            Nothing generated yet. Content created on the web appears here as it lands.
          </Text>
        </Card>
      ) : recent.map(item => {
        const key  = (item.status ?? '').toLowerCase();
        const tone = key === 'published' ? t.success
                   : key === 'rejected'  ? t.error
                   : key === 'pending_review' || key === 'draft' ? t.approval
                   : t.primaryText;
        return (
          <Card key={item.id}>
            <View style={s.rowTop}>
              <Text style={[s.title, { color: t.ink }]} numberOfLines={2}>
                {item.title?.trim() || 'Untitled'}
              </Text>
              <Tag text={STATUS_LABEL[key] ?? item.status ?? '—'} tone={tone} bg={withAlpha(tone, 0.12)} />
            </View>
            <Text style={[s.meta, { color: t.ink3 }]} numberOfLines={1}>
              {item.client_name ?? 'No client'}
              {item.agent_type ? ` · ${item.agent_type.replace(/_/g, ' ')}` : ''}
            </Text>
          </Card>
        );
      })}

      <View style={[s.scopeNote, { backgroundColor: t.surface2, borderColor: t.outlineVar }]}>
        <Ionicons name="shield-checkmark-outline" size={14} color={t.ink3} />
        <Text style={[s.scopeText, { color: t.ink3 }]}>
          <Text style={[s.scopeKicker, { color: t.primaryText }]}>सहायक </Text>
          reads only what you already have access to. It cannot see another
          person's tasks, anyone's payroll, or another organisation's data.
        </Text>
      </View>
    </ModuleShell>
  );
}

const s = StyleSheet.create({
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  title:  { flex: 1, fontSize: 14, fontWeight: '700', lineHeight: 19 },
  meta:   { fontSize: 11.5, lineHeight: 16 },

  scopeNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    borderWidth: 1, borderRadius: 10, padding: 11, marginTop: 14,
  },
  scopeText:   { flex: 1, fontSize: 11.5, lineHeight: 16.5 },
  // No `fontWeight`. Tiro Devanagari Hindi ships one weight (400), so a '700'
  // here is not a bolder Tiro — Android synthesises a smeared fake bold and iOS
  // falls back to the system Devanagari face, putting `सहायक` in a typeface
  // nobody chose next to Latin that renders correctly. `hindi()` deliberately
  // returns no weight; spreading it after a weight did not remove one.
  // Emphasis on Devanagari is carried by colour and size, as it is on the web.
  scopeKicker: { ...hindi() },
});
