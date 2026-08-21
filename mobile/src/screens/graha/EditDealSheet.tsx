import React, { useEffect, useMemo, useState } from 'react';
import { Text, StyleSheet, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../../theme/ThemeProvider';
import { useOnline } from '../../hooks/useOnline';
import { useOfflineMutation } from '../../hooks/useOfflineMutation';
import Sheet from '../../components/Sheet';
import { clientSource, type PickerOption } from '../../components/pickers';
import { inr, type Deal } from '../../api/modules';
import {
  grahaWriteApi, writeErrorMessage, stagesOf,
  type DealDetail, type DealActivity, type Pipeline,
} from '../../api/graha';
import {
  FieldLabel, ChipSelect, Field, DateRow, PickerField, ErrorNote, InfoNote,
  SheetBody, panelStyle,
} from './sheetKit';
import {
  dealPatch, dealError, fromDateParam, isEmptyPatch, type DealForm,
} from './draftRules';

/**
 * The whole deal, editable — `PATCH /api/v1/graha/deals/{id}`.
 *
 * The deal sheet has always been able to move a STAGE, which is one column and
 * the only one that changes during a call. This is the other conversation: the
 * number moved, the close date slipped, the name was wrong. Those are the edits
 * that otherwise wait for a laptop and therefore never happen — a deal whose
 * value is six weeks stale is the reason a pipeline total is not believed.
 *
 * ── ONLY WHAT CHANGED GOES OVER THE WIRE ─────────────────────────────────────
 *
 * `dealPatch` (see `draftRules.ts`) diffs the form against what it opened with
 * and sends the difference. This is not tidiness: `update_deal` writes every key
 * it receives, someone at a desk may be editing this same deal right now, and a
 * phone that PUT back the object it fetched two minutes ago would silently
 * revert their work. The offline queue makes it worse — it merges PATCHes to one
 * URL by body and replays minutes later, so a wide body re-applies stale columns
 * long after the fact.
 *
 * Two fields cannot be CLEARED from here, and the form says so rather than
 * offering a clear that does nothing: `expected_close_date` and `client_id` are
 * cast (`::date`, uuid) with no NULLIF around them in this endpoint, so an empty
 * string is a 500 and `None` is filtered out before the SET list is built.
 *
 * ── This one IS queueable ────────────────────────────────────────────────────
 *
 * Unlike the four creates. A PATCH applied twice is the same PATCH, which is the
 * whole of the test `api/graha.ts` sets: replaying it lands the user's own last
 * intent, not a second row.
 */

interface Props {
  visible: boolean;
  onClose: () => void;
  /** The deal as the detail sheet has it. Null while the sheet is closing. */
  deal: DealDetail | null;
}

export default function EditDealSheet({ visible, onClose, deal }: Props) {
  const { t } = useTheme();
  const online = useOnline();
  const qc = useQueryClient();

  /**
   * What the form opened with, kept beside what it holds now.
   *
   * The diff has to be against the values as LOADED, not against the server's
   * current row: if a refetch lands while the sheet is open, diffing against the
   * fresh row would make the user's own unsaved edit look like no change at all.
   */
  const [before, setBefore] = useState<DealForm | null>(null);
  const [form, setForm]     = useState<DealForm | null>(null);
  const [client, setClient] = useState<PickerOption | null>(null);
  const [showDate, setShowDate] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  const clients = useMemo(() => clientSource(), []);

  const pipelines = useQuery({
    queryKey: ['graha', 'pipelines'],
    queryFn:  grahaWriteApi.pipelines,
    enabled:  visible,
    staleTime: 30 * 60 * 1000,
  });

  // Annotated, not inferred — `useQuery(...).data` is `any` on this toolchain.
  const pipes: Pipeline[] = pipelines.data ?? [];
  const stages = useMemo(() => stagesOf(pipes), [pipes]);

  /**
   * The company's NAME, from the list that has it.
   *
   * `get_deal` returns `client_id` and no `client_name` — it joins contacts, not
   * clients. `GET /deals` DOES return `client_name`, and the screen behind this
   * sheet has already fetched it, so the name is in the cache under
   * `['graha','deals']`. Read from there rather than by adding a request, and
   * when it is not there the field is left blank with a line of copy: an id is
   * never a label, and "Loading…" for a name that will never arrive is worse
   * than saying nothing.
   */
  const cachedName = useMemo(() => {
    if (!deal?.client_id) return null;
    const list = qc.getQueryData<Deal[]>(['graha', 'deals']) ?? [];
    const hit = list.find(d => d.id === deal.id);
    return hit?.client_name ?? null;
  }, [qc, deal?.id, deal?.client_id, visible]);

  useEffect(() => {
    if (!visible || !deal) return;
    const seeded: DealForm = {
      title:     deal.title ?? '',
      contactId: deal.contact_id,
      clientId:  deal.client_id,
      // The typed string, not the number: `value` arrives as a numeric string
      // from asyncpg's NUMERIC and re-formatting it would show a rep a figure
      // they did not enter.
      value:     deal.value === null || deal.value === undefined ? '' : String(deal.value),
      stage:     deal.stage ?? '',
      closeDate: fromDateParam(deal.expected_close_date),
      notes:     deal.notes ?? '',
    };
    setBefore(seeded);
    setForm(seeded);
    setClient(deal.client_id && cachedName ? { id: deal.client_id, label: cachedName } : null);
    setShowDate(false);
    setError(null);
  }, [visible, deal?.id]);

  const set = <K extends keyof DealForm>(key: K, v: DealForm[K]) =>
    setForm(f => (f ? { ...f, [key]: v } : f));

  const patch = useMemo(
    () => (before && form ? dealPatch(before, form) : {}),
    [before, form],
  );
  const problem = form ? dealError(form) : 'Loading…';
  const dirty = !isEmptyPatch(patch);

  const save = useOfflineMutation<{ dealId: string; patch: Record<string, unknown> }>({
    method: 'PATCH',
    urlBuilder: v => `/v1/graha/deals/${v.dealId}`,
    bodyBuilder: v => v.patch,
    mutationFn:  v => grahaWriteApi.updateDeal(v.dealId, v.patch),
    entity_type: 'graha_deal',
    entityId:    v => v.dealId,
    // NO `optimisticId` on purpose. With one, a second save REPLACES the queued
    // body and the first edit's fields are lost; without one the queue falls
    // through to its PATCH squash, which MERGES bodies for the same URL — so a
    // stage moved before going offline and a value edited after it arrive as one
    // request carrying both.
    snapshotKey: v => ['graha', 'deal', v.dealId],
    optimisticUpdate: (v, client_) => {
      client_.setQueryData<{ deal: DealDetail; activities: DealActivity[] } | undefined>(
        ['graha', 'deal', v.dealId],
        prev => (prev ? { ...prev, deal: { ...prev.deal, ...v.patch } } : prev),
      );
      // The list behind the sheet shows title, value and stage. Leaving it stale
      // makes closing the sheet look like the edit was thrown away.
      client_.setQueryData<Deal[] | undefined>(['graha', 'deals'], prev =>
        (prev ?? []).map(d => (d.id === v.dealId ? { ...d, ...v.patch } as Deal : d)),
      );
    },
    rollback: (v, snapshot, client_) => {
      if (snapshot) client_.setQueryData(['graha', 'deal', v.dealId], snapshot);
      void client_.invalidateQueries({ queryKey: ['graha', 'deals'] });
    },
    onlineOptions: {
      onError: (err: unknown) => setError(writeErrorMessage(err)),
      onSuccess: () => {
        setError(null);
        // Won and Lost set `won_at` and `probability` on the SERVER, so the
        // optimistic row is incomplete until this refetch lands.
        void qc.invalidateQueries({ queryKey: ['graha', 'deal', deal?.id] });
        void qc.invalidateQueries({ queryKey: ['graha', 'deals'] });
        void qc.invalidateQueries({ queryKey: ['graha', 'pipeline-summary'] });
        void qc.invalidateQueries({ queryKey: ['graha', 'today'] });
        onClose();
      },
    },
  });

  const submit = async () => {
    if (!deal || !form) return;
    if (problem) { setError(problem); return; }
    // Nothing moved. The endpoint answers a bodyless PATCH with a 400, and a red
    // note because somebody opened a form and closed it is a lie about failure.
    if (!dirty) { onClose(); return; }
    setError(null);
    await save.mutateAsync({ dealId: deal.id, patch });
    // The QUEUED path resolves without ever reaching `onSuccess`, so it has to
    // close the sheet itself. Read off `isQueued` rather than off `online`:
    // the hook re-checks NetInfo at the moment of the call, and the render-time
    // flag can be a second stale — which would leave the sheet open forever on a
    // write that in fact went to the queue.
    if (save.isQueued) onClose();
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeLabel="Close the edit deal sheet"
      panelStyle={panelStyle(t)}
      avoidKeyboard
    >
      <SheetBody
        kickerLatin="EDIT DEAL" kickerHindi="सौदा बदलें"
        title={deal?.title ?? ''}
        onClose={onClose}
        submitLabel={!dirty ? 'Nothing changed' : online ? 'Save changes' : 'Save when back online'}
        onSubmit={submit}
        submitting={save.isPending}
        canSubmit={!!form && !problem && dirty}
      >
        {!online && (
          <InfoNote
            icon="cloud-offline-outline"
            text="No connection. Unlike creating something, an edit is safe to hold on the phone and send later — applying the same change twice is one change. It will go as soon as there is signal."
          />
        )}

        <FieldLabel latin="DEAL" hindi="सौदा" />
        <Field
          value={form?.title ?? ''}
          onChangeText={v => { set('title', v); setError(null); }}
          placeholder="Annual retainer — FY 2026-27"
          label="Deal name"
          invalid={!!form && !form.title.trim()}
        />

        <FieldLabel latin="VALUE" hindi="मूल्य" />
        <Field
          value={form?.value ?? ''}
          onChangeText={v => { set('value', v); setError(null); }}
          placeholder="250000"
          label="Value in rupees"
          keyboardType="numeric"
        />
        {!!before?.value && (
          <Text style={[s.hint, { color: t.ink4 }]}>Was {inr(before.value)}</Text>
        )}

        <FieldLabel latin="STAGE" hindi="चरण" />
        <ChipSelect
          options={stages.map(name => ({
            key: name,
            label: name,
            tone: name.toLowerCase() === 'won' ? t.success
                : name.toLowerCase() === 'lost' ? t.ink3
                : t.primary,
          }))}
          value={form?.stage || null}
          onChange={v => set('stage', v)}
        />

        <FieldLabel latin="COMPANY" hindi="कंपनी" />
        <PickerField
          source={clients}
          selected={client}
          title="Whose deal is this?"
          label="Company"
          placeholder={deal?.client_id && !cachedName ? 'Already set — choose to replace' : 'Choose a company…'}
          onSelect={(option) => { setClient(option); set('clientId', option.id); }}
          // No `onClear`. Detaching a deal from its company is not expressible
          // through this endpoint — see the header — and a clear button that
          // silently does nothing is worse than not offering one.
        />
        {!!deal?.client_id && !cachedName && (
          <Text style={[s.hint, { color: t.ink4 }]}>
            This deal already belongs to a company. Choosing one here replaces it; leaving it alone keeps it.
          </Text>
        )}

        <FieldLabel latin="EXPECTED CLOSE" hindi="अपेक्षित समापन" />
        <DateRow
          value={form?.closeDate ?? null}
          onPress={() => setShowDate(true)}
          emptyLabel="Not set"
          label="Expected close date"
        />
        {showDate && (
          <DateTimePicker
            value={form?.closeDate ?? new Date()}
            mode="date"
            display={Platform.OS === 'android' ? 'calendar' : 'spinner'}
            onChange={(_, selected) => {
              setShowDate(Platform.OS === 'ios');
              if (selected) set('closeDate', selected);
            }}
          />
        )}

        <FieldLabel latin="NOTES" hindi="टिप्पणी" />
        <Field
          value={form?.notes ?? ''}
          onChangeText={v => set('notes', v)}
          placeholder="What they asked for, and what they are comparing it against…"
          label="Notes"
          multiline
        />

        {error && <ErrorNote text={error} />}
      </SheetBody>
    </Sheet>
  );
}

const s = StyleSheet.create({
  hint: { fontSize: 11.5, lineHeight: 16, marginTop: 6 },
});
