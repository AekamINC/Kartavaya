import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '../../theme/ThemeProvider';
import { useOnline } from '../../hooks/useOnline';
import { resolveScreenState } from '../../components/ScreenState';
import { a11yButton } from '../../components/a11y';
import ModuleShell, { Stat, StatRow, SectionHead, Card, Tag, ModuleCards } from './ModuleShell';
import { grahaApi, inrCompact, inr, num, type Deal, type PipelineStage } from '../../api/modules';
import { withAlpha } from '../../theme/tokens';
import TodayPanel from '../graha/TodayPanel';
import DealDetailSheet from '../graha/DealDetailSheet';

/**
 * Graha · ग्रह — CRM. The field rep's surface.
 *
 * Endpoints reached from here and from what it opens:
 *   GET   /api/v1/graha/pipeline-summary       value and count by stage
 *   GET   /api/v1/graha/deals                  newest 200, org-scoped
 *   GET   /api/v1/graha/today                  the daily action view
 *   GET   /api/v1/graha/deals/{id}             the deal and its activities
 *   GET   /api/v1/graha/follow-ups?deal_id=    the open next steps
 *   GET   /api/v1/graha/pipelines              the stage names for this org
 *   PATCH /api/v1/graha/deals/{id}             move the stage, and only the stage
 *   PATCH /api/v1/graha/follow-ups/{id}/complete
 *   POST  /api/v1/graha/activities             log what just happened
 *   POST  /api/v1/graha/follow-ups             set the next thing
 *
 * ── What changed, and why the boundary sentence moved ────────────────────────
 *
 * This screen used to be two GETs and a boundary note that said logging a call
 * and moving a stage were desktop work. That was an accurate description of the
 * build and a wrong description of the job: a rep does not open a laptop after a
 * meeting, so a CRM that can only be written to at a desk is a CRM that is
 * written to on Friday from memory, if at all.
 *
 * What is here now is the ninety seconds after a call — move the stage, log what
 * happened, set the next thing — and nothing else. Creating a deal, editing a
 * contact and running the pipeline board are still desktop, and the boundary
 * note says so, because `ModuleShell` requires it to say something and a stale
 * sentence claiming the surface is read-only is worse than none.
 */

/**
 * Won and Lost are terminal; everything else is still open pipeline.
 *
 * `api/graha.ts` exports the same rule as `isOpenStage`, for the deal sheet.
 * These two are LEFT AS THEY WERE rather than collapsed into one import: this
 * pass was scoped to adding writes, and quietly changing what a shared screen
 * imports is how a refactor rides in on a feature. Consolidating them is a
 * one-line change and is flagged in the report rather than taken.
 */
const CLOSED = new Set(['won', 'lost', 'closed won', 'closed lost']);
const isOpen = (stage: string | null | undefined) => !CLOSED.has((stage ?? '').toLowerCase());

export default function GrahaScreen() {
  const { t } = useTheme();
  const online = useOnline();

  /**
   * Which deal the sheet is showing.
   *
   * Held here rather than inside the row, so both the TODAY list and the DEALS
   * list open the same sheet, and so a single sheet instance survives the row
   * being re-rendered under it by a refetch.
   *
   * The title rides along so the sheet has a name to draw before its own fetch
   * resolves — the alternative is a heading that says nothing for 400ms on the
   * one screen a rep opens while walking.
   */
  const [open, setOpen] = useState<{ id: string; title: string } | null>(null);
  const [visible, setVisible] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);

  const openDeal = (id: string, title: string) => {
    setOpen({ id, title });
    setVisible(true);
  };

  const summary = useQuery({
    queryKey: ['graha', 'pipeline-summary'],
    queryFn:  grahaApi.pipelineSummary,
  });
  const deals = useQuery({
    queryKey: ['graha', 'deals'],
    queryFn:  grahaApi.deals,
  });

  // Annotated, not inferred: `useQuery(...).data` is `any` on this toolchain.
  // See the note in api/modules.ts — without these two annotations every field
  // access below this line is unchecked.
  const rows:   Deal[]          = deals.data   ?? [];
  const stages: PipelineStage[] = summary.data ?? [];

  const totals = useMemo(() => {
    const openStages = stages.filter(st => isOpen(st.stage));
    return {
      openValue: openStages.reduce((a, st) => a + num(st.total_value), 0),
      openCount: openStages.reduce((a, st) => a + num(st.count), 0),
      // "Slipping" is an expected close date already in the past on a deal that
      // is still open. It is the only figure on this screen that is a judgement
      // rather than a total, and it is the one worth opening the phone for.
      slipping: rows.filter(d => {
        if (!isOpen(d.stage) || !d.expected_close_date) return false;
        const due = new Date(d.expected_close_date);
        return !Number.isNaN(due.getTime()) && due < new Date();
      }).length,
    };
  }, [stages, rows]);

  const hasData = summary.data !== undefined || deals.data !== undefined;
  const status = resolveScreenState({
    isLoading: summary.isLoading || deals.isLoading,
    isError:   summary.isError || deals.isError,
    error:     summary.error ?? deals.error,
    online,
    hasData,
    isEmpty:   hasData && rows.length === 0,
  });

  const refetch = () => { summary.refetch(); deals.refetch(); };

  return (
    <>
      <ModuleShell
        title="CRM" hi="ग्रह"
        status={status}
        stale={hasData && !online}
        onRetry={refetch}
        refreshing={summary.isRefetching || deals.isRefetching}
        emptyTitle="No deals yet"
        emptyBody="Deals are created on the web. Once one exists you can move it, log against it and set what happens next from here."
        boundary="Creating a deal, editing a contact and the pipeline board are desktop work. From here you can move a stage, log what just happened and set the next step — and a stage move survives being offline, while logging and follow-ups need a connection."
      >
        <StatRow>
          <Stat value={inrCompact(totals.openValue)} label="Open pipeline" />
          <Stat value={String(totals.openCount)} label="Open deals" />
          <Stat
            value={String(totals.slipping)}
            label="Past close date"
            tone={totals.slipping > 0 ? t.error : undefined}
          />
        </StatRow>

        <TodayPanel onOpenDeal={openDeal} onError={setWriteError} error={writeError} />

        <SectionHead label="DEALS" hi="सौदे" right={String(rows.length)} />
        <ModuleCards>
          {rows.slice(0, 40).map(d => <DealRow key={d.id} deal={d} onOpen={openDeal} />)}
        </ModuleCards>
        {rows.length > 40 && (
          <Text style={[s.more, { color: t.ink4 }]}>
            Showing the 40 most recent of {rows.length}. The full list is on the web.
          </Text>
        )}
      </ModuleShell>

      {/* Mounted outside `ModuleShell` so it is not unmounted when the shell
          swaps to a non-ready state under it — a refetch that briefly fails
          would otherwise close a sheet the user is typing into. `dealId` stays
          set through the dismissal animation; `enabled` on the query is what
          stops it refetching while it closes. */}
      <DealDetailSheet
        visible={visible}
        onClose={() => setVisible(false)}
        dealId={open?.id ?? null}
        dealTitle={open?.title ?? ''}
      />
    </>
  );
}

function DealRow({ deal, onOpen }: { deal: Deal; onOpen: (id: string, title: string) => void }) {
  const { t } = useTheme();

  const open = isOpen(deal.stage);
  const due  = deal.expected_close_date ? new Date(deal.expected_close_date) : null;
  const late = open && !!due && !Number.isNaN(due.getTime()) && due < new Date();

  // Won gets the success colour, Lost the muted one, everything open the accent.
  // Three of the four are semantic tokens rather than a private palette, so a
  // contrast fix on the web reaches this row too.
  const stageTone =
    (deal.stage ?? '').toLowerCase() === 'won'  ? t.success :
    (deal.stage ?? '').toLowerCase() === 'lost' ? t.ink4 :
    late ? t.approval : t.primaryText;

  const who = deal.client_name ?? deal.contact_company ?? deal.contact_name ?? '';
  const whenLabel = due && !Number.isNaN(due.getTime())
    ? due.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : null;

  return (
    <TouchableOpacity
      onPress={() => onOpen(deal.id, deal.title)}
      activeOpacity={0.7}
      // The accessible name is the deal, not "card 3 of 40". `who` is included
      // because two deals with the same title at two customers is the normal
      // case in this product, and a screen reader user gets one shot at telling
      // them apart.
      {...a11yButton(who ? `${deal.title}, ${who}` : deal.title, 'Opens the deal')}
    >
      <Card accent={late ? t.approval : undefined}>
        <View style={s.rowTop}>
          <Text style={[s.dealTitle, { color: t.ink }]} numberOfLines={2}>{deal.title}</Text>
          <Text style={[s.dealValue, { color: t.ink2 }]}>{inr(deal.value)}</Text>
        </View>
        <View style={s.rowMeta}>
          {!!deal.stage && (
            <Tag text={deal.stage} tone={stageTone} bg={withAlpha(stageTone, 0.12)} />
          )}
          {!!who && <Text style={[s.dealWho, { color: t.ink3 }]} numberOfLines={1}>{who}</Text>}
          {!!whenLabel && (
            <Text style={[s.dealWhen, { color: late ? t.approval : t.ink4 }]}>
              {late ? 'was due ' : 'closes '}{whenLabel}
            </Text>
          )}
        </View>
      </Card>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  rowTop:  { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  dealTitle: { flex: 1, fontSize: 14, fontWeight: '700', lineHeight: 19 },
  dealValue: { fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
  dealWho:   { flex: 1, minWidth: 60, fontSize: 11.5 },
  dealWhen:  { fontSize: 11, fontWeight: '700' },
  more: { fontSize: 11.5, lineHeight: 16, marginTop: 8, textAlign: 'center' },
});
