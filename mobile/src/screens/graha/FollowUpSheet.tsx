import React, { useEffect, useState } from 'react';
import { Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../../theme/ThemeProvider';
import { useOnline } from '../../hooks/useOnline';
import Sheet from '../../components/Sheet';
import { a11yButton } from '../../components/a11y';
import { grahaWriteApi, writeErrorMessage } from '../../api/graha';
import { FieldLabel, ChipSelect, Field, ErrorNote, InfoNote, SheetBody, panelStyle } from './sheetKit';
import { dueDateIn, QUICK_DUE, DEFAULT_QUICK } from './dueDate';

/**
 * Set the next thing — `POST /api/v1/graha/follow-ups`.
 *
 * The other half of the ninety seconds after a call. Logging what happened is
 * the record; this is the only part of the CRM that makes something happen
 * next, and it is what `GET /today`'s `overdue_followups` reads back.
 *
 * ONLINE ONLY, for the reason set out in `api/graha.ts` and repeated in
 * `LogActivitySheet` — a POST replayed by the offline queue creates a second
 * row, and two follow-ups for the same call means the rep is chased twice and
 * trusts the list less.
 *
 * `assigned_to` is deliberately not offered. `create_follow_up` defaults it to
 * the caller, which is what a rep setting their own next step means every time;
 * assigning someone else is a delegation decision made at a desk, and the picker
 * it would need cannot show a member list without rendering names this screen
 * has no other reason to fetch.
 */

interface Props {
  visible: boolean;
  onClose: () => void;
  dealId:    string;
  dealTitle: string;
  contactId?: string | null;
}

export default function FollowUpSheet({ visible, onClose, dealId, dealTitle, contactId }: Props) {
  const { t } = useTheme();
  const online = useOnline();
  const qc = useQueryClient();

  const [title, setTitle]   = useState('');
  const [notes, setNotes]   = useState('');
  const [quick, setQuick]   = useState<string | null>(DEFAULT_QUICK);
  const [due, setDue]       = useState<Date>(() => dueDateIn(Number(DEFAULT_QUICK)));
  const [showPicker, setShowPicker] = useState(false);
  const [titleError, setTitleError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setTitle(''); setNotes(''); setQuick(DEFAULT_QUICK); setDue(dueDateIn(Number(DEFAULT_QUICK)));
    setShowPicker(false); setTitleError(false); setSaving(false); setError(null);
  }, [visible]);

  const pickQuick = (key: string) => {
    setQuick(key);
    setDue(dueDateIn(Number(key)));
  };

  const submit = async () => {
    if (!title.trim()) { setTitleError(true); return; }
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await grahaWriteApi.createFollowUp({
        title:       title.trim(),
        description: notes.trim(),
        // Required by `FollowUpCreate` — it has no default, and the server
        // parses it with `datetime.fromisoformat`.
        due_at:      due.toISOString(),
        deal_id:     dealId,
        contact_id:  contactId ?? '',
      });
      void qc.invalidateQueries({ queryKey: ['graha', 'follow-ups', dealId] });
      void qc.invalidateQueries({ queryKey: ['graha', 'today'] });
      onClose();
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
      closeLabel="Close the follow-up sheet"
      panelStyle={panelStyle(t)}
      avoidKeyboard
    >
      <SheetBody
        kickerLatin="NEXT STEP" kickerHindi="अगला कदम"
        title={dealTitle}
        onClose={onClose}
        submitLabel={online ? 'Set follow-up' : 'Needs a connection'}
        onSubmit={submit}
        submitting={saving}
        canSubmit={online && !!title.trim()}
      >
        {!online && (
          <InfoNote
            icon="cloud-offline-outline"
            text="Setting a follow-up needs a connection. It is not queued on purpose — a queued create that loses its reply would be sent twice, and you would be chased twice for the same call."
          />
        )}

        <FieldLabel latin="WHAT NEXT" hindi="आगे क्या" />
        <Field
          value={title}
          onChangeText={v => { setTitle(v); if (v.trim()) setTitleError(false); }}
          placeholder="Send the revised quote"
          label="What next"
          invalid={titleError}
          autoFocus
        />
        {titleError && (
          <Text
            style={[s.fieldError, { color: t.error }]}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            Say what the next step is.
          </Text>
        )}

        <FieldLabel latin="WHEN" hindi="कब" />
        <ChipSelect options={QUICK_DUE} value={quick} onChange={pickQuick} />
        <TouchableOpacity
          onPress={() => setShowPicker(true)}
          style={[s.dateBtn, { borderColor: t.outline, backgroundColor: t.bg }]}
          {...a11yButton(`Due ${due.toLocaleDateString('en-IN')}`, 'Opens the date picker')}
        >
          <Text style={{ color: t.ink, fontSize: 14 }}>
            {due.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
          </Text>
          <Text style={{ color: t.ink3, fontSize: 12 }}>Change date</Text>
        </TouchableOpacity>
        {showPicker && (
          <DateTimePicker
            value={due}
            mode="date"
            display={Platform.OS === 'android' ? 'calendar' : 'spinner'}
            // A follow-up in the past is born overdue, which is never what
            // anybody means on this sheet.
            minimumDate={new Date()}
            onChange={(_, selected) => {
              setShowPicker(Platform.OS === 'ios');
              if (selected) {
                // Same 10:00 rule the quick buttons use, so the two routes to a
                // date cannot disagree about what time of day it means.
                const at10 = new Date(selected.getTime());
                at10.setHours(10, 0, 0, 0);
                setDue(at10);
                // The chips no longer describe this date, so none is selected.
                setQuick(null);
              }
            }}
          />
        )}

        <FieldLabel latin="DETAIL" hindi="विवरण" />
        <Field
          value={notes}
          onChangeText={setNotes}
          placeholder="Anything you will have forgotten by then…"
          label="Detail"
          multiline
        />

        {error && <ErrorNote text={error} />}
      </SheetBody>
    </Sheet>
  );
}

const s = StyleSheet.create({
  fieldError: { fontSize: 11, marginTop: 4 },
  dateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, minHeight: 44, marginTop: 8,
  },
});
