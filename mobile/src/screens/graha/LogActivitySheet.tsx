import React, { useEffect, useState } from 'react';
import { Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../../theme/ThemeProvider';
import { useOnline } from '../../hooks/useOnline';
import Sheet from '../../components/Sheet';
import { a11yButton } from '../../components/a11y';
import {
  grahaWriteApi, writeErrorMessage, ACTIVITY_TYPES, type ActivityType,
} from '../../api/graha';
import { FieldLabel, ChipSelect, Field, ErrorNote, InfoNote, SheetBody, panelStyle } from './sheetKit';

/**
 * Log what just happened — `POST /api/v1/graha/activities`.
 *
 * The one thing a rep does on a phone. They have just come out of a meeting or
 * put the phone down after a call, and the entire value of the CRM depends on
 * that being recorded in the next ninety seconds rather than tonight.
 *
 * ── ONLINE ONLY, and it says so ──────────────────────────────────────────────
 *
 * This is the decision recorded in `api/graha.ts`: the offline queue retries
 * three times and carries no idempotency key, so a POST whose response is lost
 * — not whose request failed, whose RESPONSE is lost — is replayed and creates a
 * second activity. There is no way to delete one from this app, and a call
 * history that shows the same call twice is wrong permanently.
 *
 * A stage move can be queued because PATCHing the same stage twice is one move.
 * A create cannot, until the endpoint takes an idempotency key.
 *
 * So when the device is offline the sheet does not pretend. It disables the
 * button and states the reason, which is `resolveScreenState`'s offline copy
 * applied to a write: name what will happen instead of telling someone on a
 * highway to go and find signal.
 */

const TYPE_LABELS: Record<ActivityType, string> = {
  call:    'Call',
  meeting: 'Meeting',
  email:   'Email',
  note:    'Note',
  task:    'Task',
};

interface Props {
  visible: boolean;
  onClose: () => void;
  /** The deal this is being logged against, and its name for the header. */
  dealId:    string;
  dealTitle: string;
  /** Passed through so `compute_lead_score` runs and the contact timeline shows it. */
  contactId?: string | null;
}

export default function LogActivitySheet({ visible, onClose, dealId, dealTitle, contactId }: Props) {
  const { t } = useTheme();
  const online = useOnline();
  const qc = useQueryClient();

  const [type, setType]           = useState<ActivityType>('call');
  const [title, setTitle]         = useState('');
  const [notes, setNotes]         = useState('');
  const [when, setWhen]           = useState<Date | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [titleError, setTitleError] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);

  // Reset on open, not on close: a sheet that clears while it is animating out
  // shows the user their text disappearing.
  useEffect(() => {
    if (!visible) return;
    setType('call'); setTitle(''); setNotes(''); setWhen(null);
    setShowPicker(false); setTitleError(false); setSaving(false); setError(null);
  }, [visible]);

  const submit = async () => {
    if (!title.trim()) { setTitleError(true); return; }
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await grahaWriteApi.logActivity({
        deal_id:       dealId,
        // Empty string rather than omitted: `ActivityCreate.contact_id` defaults
        // to '' and the INSERT casts it through `NULLIF($3,'')::uuid`. Sending
        // null would fail that cast.
        contact_id:    contactId ?? '',
        activity_type: type,
        title:         title.trim(),
        description:   notes.trim(),
        scheduled_at:  when ? when.toISOString() : '',
      });
      // Both the deal (its activity list is embedded in the detail response)
      // and Today (which lists today's activities) are now stale.
      void qc.invalidateQueries({ queryKey: ['graha', 'deal', dealId] });
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
      closeLabel="Close the log activity sheet"
      panelStyle={panelStyle(t)}
      avoidKeyboard
    >
      <SheetBody
        kickerLatin="LOG ACTIVITY" kickerHindi="गतिविधि"
        title={dealTitle}
        onClose={onClose}
        submitLabel={online ? 'Log it' : 'Needs a connection'}
        onSubmit={submit}
        submitting={saving}
        canSubmit={online && !!title.trim()}
      >
        {!online && (
          <InfoNote
            icon="cloud-offline-outline"
            text="Logging a call needs a connection. It is not queued on purpose — a queued log that loses its reply on the way back would be sent twice and appear twice, and nothing on this phone can delete the copy."
          />
        )}

        <FieldLabel latin="TYPE" hindi="प्रकार" />
        <ChipSelect
          options={ACTIVITY_TYPES.map(k => ({ key: k, label: TYPE_LABELS[k] }))}
          value={type}
          onChange={k => setType(k as ActivityType)}
        />

        <FieldLabel latin="WHAT HAPPENED" hindi="क्या हुआ" />
        <Field
          value={title}
          onChangeText={v => { setTitle(v); if (v.trim()) setTitleError(false); }}
          placeholder="Spoke to the finance head about pricing"
          label="What happened"
          invalid={titleError}
          autoFocus
        />
        {titleError && (
          <Text
            style={[s.fieldError, { color: t.error }]}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            Say what happened — this is the line the next person reads.
          </Text>
        )}

        <FieldLabel latin="DETAIL" hindi="विवरण" />
        <Field
          value={notes}
          onChangeText={setNotes}
          placeholder="Anything the next person needs to know…"
          label="Detail"
          multiline
        />

        {/* WHEN — optional, and the server stores it as `scheduled_at`. Left
            empty the activity is stamped with `created_at`, which is right for
            "this just happened"; set, it is how a rep back-dates yesterday's
            call. A native date input is not available here by house rule and
            would be the wrong control anyway — this is the same
            DateTimePicker every other date in the app goes through. */}
        <FieldLabel latin="WHEN" hindi="कब" />
        <TouchableOpacity
          onPress={() => setShowPicker(true)}
          style={[s.dateBtn, { borderColor: t.outline, backgroundColor: t.bg }]}
          {...a11yButton(
            when ? `When, ${when.toLocaleDateString('en-IN')}` : 'When, not set — defaults to now',
            'Opens the date picker',
          )}
        >
          <Text style={{ color: when ? t.ink : t.ink3, fontSize: 14 }}>
            {when ? when.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Just now'}
          </Text>
        </TouchableOpacity>
        {showPicker && (
          <DateTimePicker
            value={when ?? new Date()}
            mode="date"
            display={Platform.OS === 'android' ? 'calendar' : 'spinner'}
            // No minimumDate: an activity is something that ALREADY happened, so
            // backwards is the direction this one travels.
            maximumDate={new Date()}
            onChange={(_, selected) => {
              setShowPicker(Platform.OS === 'ios');
              if (selected) setWhen(selected);
            }}
          />
        )}

        {error && <ErrorNote text={error} />}
      </SheetBody>
    </Sheet>
  );
}

const s = StyleSheet.create({
  fieldError: { fontSize: 11, marginTop: 4 },
  dateBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, minHeight: 44, justifyContent: 'center' },
});
