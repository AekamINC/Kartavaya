import React, { useEffect, useMemo, useState } from 'react';
import { Text, StyleSheet, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../../theme/ThemeProvider';
import { useOnline } from '../../hooks/useOnline';
import Sheet from '../../components/Sheet';
import { contactSource, clientSource, type PickerOption, type Row }
  from '../../components/pickers';
import { grahaWriteApi, writeErrorMessage, stagesOf, type Pipeline } from '../../api/graha';
import {
  FieldLabel, ChipSelect, Field, DateRow, PickerField, ErrorNote, InfoNote,
  SheetBody, panelStyle,
} from './sheetKit';
import {
  EMPTY_DEAL, dealCreateBody, dealError, type DealForm,
} from './draftRules';

/**
 * A new deal — `POST /api/v1/graha/deals`.
 *
 * The gap this closes is the one the screen's own boundary note used to admit
 * to: a rep could move a deal, log against it and set what happens next, but the
 * deal itself had to already exist, which meant it had been typed at a desk.
 * The conversation that creates a deal happens at a customer's office.
 *
 * ── Why a minimal create is viable ───────────────────────────────────────────
 *
 * `create_deal` reads the org's default pipeline and, finding none, WRITES one
 * (graha.py:940) before inserting. So there is no pipeline chooser on this form
 * and no failure mode on an org that has never opened the web CRM — the first
 * deal a rep creates on a phone bootstraps the board. Stage still comes from
 * `/pipelines` rather than a hardcoded list, because an org that HAS a board may
 * have renamed its stages and a chip offering a stage the board does not have
 * puts the deal somewhere the desktop cannot see it.
 *
 * ── ONLINE ONLY ──────────────────────────────────────────────────────────────
 *
 * The rule `api/graha.ts` sets out: the offline queue replays a failed write
 * three times with no idempotency key, so a POST whose RESPONSE was lost creates
 * a second deal — and a duplicate deal is worse than a duplicate activity,
 * because the pipeline total is then wrong and the rep chases both. The button
 * is disabled offline and the sheet says why.
 */

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Where a created deal should open. Absent means "just close". */
  onCreated?: (dealId: string, title: string) => void;
}

export default function NewDealSheet({ visible, onClose, onCreated }: Props) {
  const { t } = useTheme();
  const online = useOnline();
  const qc = useQueryClient();

  const [form, setForm]     = useState<DealForm>(EMPTY_DEAL);
  const [contact, setContact] = useState<PickerOption | null>(null);
  const [client, setClient]   = useState<PickerOption | null>(null);
  const [showDate, setShowDate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  // Memoised: a factory called in the render body hands the picker a new source
  // object every keystroke, which re-keys its queries and refetches the list.
  const contacts = useMemo(() => contactSource(), []);
  const clients  = useMemo(() => clientSource(), []);

  const pipelines = useQuery({
    queryKey: ['graha', 'pipelines'],
    queryFn:  grahaWriteApi.pipelines,
    enabled:  visible,
    staleTime: 30 * 60 * 1000,
  });

  // Annotated, not inferred — `useQuery(...).data` is `any` on this toolchain.
  const pipes: Pipeline[] = pipelines.data ?? [];
  const stages = useMemo(() => stagesOf(pipes), [pipes]);

  // Reset on OPEN, not on close: clearing while the sheet animates out shows the
  // user their own typing disappearing.
  useEffect(() => {
    if (!visible) return;
    setForm(EMPTY_DEAL); setContact(null); setClient(null);
    setShowDate(false); setSaving(false); setError(null);
  }, [visible]);

  // The first stage of the org's own board, once it has loaded. Left blank until
  // then rather than defaulted to 'New', which may not be a stage this org has.
  useEffect(() => {
    if (!visible || !stages.length) return;
    setForm(f => (f.stage ? f : { ...f, stage: stages[0] }));
  }, [visible, stages]);

  const set = <K extends keyof DealForm>(key: K, v: DealForm[K]) =>
    setForm(f => ({ ...f, [key]: v }));

  /**
   * Choosing the person fills in the company, if the form has not got one.
   *
   * `EntityPicker` hands back the raw row alongside the option precisely for
   * this. A deal at a customer belongs to the COMPANY — contacts come and go,
   * the customer stays — and asking a rep to pick the same firm twice is how the
   * client_id ends up empty on half the deals.
   */
  const chooseContact = (option: PickerOption, row: Row) => {
    setContact(option);
    setForm(f => ({ ...f, contactId: option.id }));
    const joinedId   = typeof row.client_id === 'string' ? row.client_id : null;
    const joinedName = typeof row.client_name === 'string' ? row.client_name : null;
    if (joinedId && joinedName && !client) {
      setClient({ id: joinedId, label: joinedName });
      setForm(f => ({ ...f, clientId: joinedId }));
    }
  };

  const problem = dealError(form);

  const submit = async () => {
    if (problem) { setError(problem); return; }
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const created = await grahaWriteApi.createDeal(dealCreateBody(form));
      // Everything that counts deals is now wrong: the list, the stage summary
      // the header totals are computed from, and Today's stale-deal list.
      void qc.invalidateQueries({ queryKey: ['graha', 'deals'] });
      void qc.invalidateQueries({ queryKey: ['graha', 'pipeline-summary'] });
      void qc.invalidateQueries({ queryKey: ['graha', 'today'] });
      onClose();
      onCreated?.(created.id, created.title);
    } catch (err) {
      setError(writeErrorMessage(err, { creating: true }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeLabel="Close the new deal sheet"
      panelStyle={panelStyle(t)}
      avoidKeyboard
    >
      <SheetBody
        kickerLatin="NEW DEAL" kickerHindi="नया सौदा"
        title={client?.label ?? contact?.label ?? 'What are you selling?'}
        onClose={onClose}
        submitLabel={online ? 'Create deal' : 'Needs a connection'}
        onSubmit={submit}
        submitting={saving}
        canSubmit={online && !problem}
      >
        {!online && (
          <InfoNote
            icon="cloud-offline-outline"
            text="Creating a deal needs a connection. It is not queued on purpose — a queued create that loses its reply on the way back would be sent twice, and two copies of one deal makes the pipeline total wrong."
          />
        )}

        <FieldLabel latin="DEAL" hindi="सौदा" />
        <Field
          value={form.title}
          onChangeText={v => { set('title', v); if (v.trim()) setError(null); }}
          placeholder="Annual retainer — FY 2026-27"
          label="Deal name"
          invalid={!!error && !form.title.trim()}
          autoFocus
        />

        <FieldLabel latin="COMPANY" hindi="कंपनी" />
        <PickerField
          source={clients}
          selected={client}
          title="Whose deal is this?"
          label="Company"
          placeholder="Choose a company…"
          onSelect={(option) => { setClient(option); set('clientId', option.id); }}
          onClear={() => { setClient(null); set('clientId', null); }}
        />

        <FieldLabel latin="CONTACT" hindi="संपर्क" />
        <PickerField
          source={contacts}
          selected={contact}
          title="Who are you dealing with?"
          label="Contact"
          placeholder="Choose a contact…"
          onSelect={chooseContact}
          onClear={() => { setContact(null); set('contactId', null); }}
        />

        <FieldLabel latin="VALUE" hindi="मूल्य" />
        <Field
          value={form.value}
          onChangeText={v => { set('value', v); setError(null); }}
          placeholder="250000"
          label="Value in rupees"
          keyboardType="numeric"
        />

        {/* The org's own stages, never a hardcoded six. */}
        <FieldLabel latin="STAGE" hindi="चरण" />
        <ChipSelect
          options={stages.map(name => ({ key: name, label: name }))}
          value={form.stage || null}
          onChange={v => set('stage', v)}
        />

        <FieldLabel latin="EXPECTED CLOSE" hindi="अपेक्षित समापन" />
        <DateRow
          value={form.closeDate}
          onPress={() => setShowDate(true)}
          emptyLabel="Not set"
          label="Expected close date"
        />
        {showDate && (
          <DateTimePicker
            value={form.closeDate ?? new Date()}
            mode="date"
            display={Platform.OS === 'android' ? 'calendar' : 'spinner'}
            // Forwards, unlike an activity: a close date in the past is what the
            // screen behind this one counts as slipping.
            minimumDate={new Date()}
            onChange={(_, selected) => {
              setShowDate(Platform.OS === 'ios');
              if (selected) set('closeDate', selected);
            }}
          />
        )}

        <FieldLabel latin="NOTES" hindi="टिप्पणी" />
        <Field
          value={form.notes}
          onChangeText={v => set('notes', v)}
          placeholder="What they asked for, and what they are comparing it against…"
          label="Notes"
          multiline
        />

        {error && <ErrorNote text={error} />}
        {!error && !!problem && (
          <Text style={[s.hint, { color: t.ink3 }]}>{problem}</Text>
        )}
      </SheetBody>
    </Sheet>
  );
}

const s = StyleSheet.create({
  hint: { fontSize: 11.5, lineHeight: 16, marginTop: 12 },
});
