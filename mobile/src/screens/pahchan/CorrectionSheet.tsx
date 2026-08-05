import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet, Platform, ActivityIndicator,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import Sheet from '../../components/Sheet';
import BiLabel from '../../theme/BiLabel';
import { hindi } from '../../theme/fonts';
import { useTheme } from '../../theme/ThemeProvider';
import { a11yButton, a11yInput, a11ySelected, hitSlopTo } from '../../components/a11y';
import { useOnline } from '../../hooks/useOnline';
import { correctionsApi } from '../../api/pahchan';
import { hhmm } from './register';
import {
  REASON_MAX, buildCorrection, localInstant, localIso, pairingWarning, rememberAsked,
  type PunchDirection,
} from './corrections';

/**
 * "Ask for a correction" — the caller of `POST /api/v1/pahchan/regularisations`.
 *
 * That endpoint had no caller on any surface, web or mobile. Every screen in the
 * product told an employee whose clock-out was missing that the remedy was to
 * ask for a correction, and no screen let them ask. The HR queue on the other
 * side showed a green tick over an empty list.
 *
 * ── Why it opens from the register and not from a menu ────────────────────────
 *
 * The employee meets this problem on one specific day, on their own register, on
 * a phone, usually the morning after. `AttendanceHistory` already draws that day
 * and already says the true thing about it — "No clock-out recorded", "Needs a
 * clock-out before it counts". This sheet opens from underneath that sentence,
 * pre-filled with the day it is about, so the request is one tap from the
 * statement of the problem rather than four taps from a settings list.
 *
 * ── The two things it refuses, and the one it only warns about ────────────────
 *
 * It refuses a time that has not happened, and a reason under three characters.
 * Both are refusals the server also makes — the first as arithmetic nobody
 * checks until payroll runs, the second as a 422 whose body is a pydantic error
 * list. Said here they are sentences.
 *
 * It WARNS about a clock-out earlier than the clock-in and never blocks it,
 * because `build_day_records` will read that pair as incomplete and pay nothing,
 * and because only the person who was there knows whether a night shift really
 * did end before it started on the calendar day this app drew.
 *
 * ── Online only, and honest about it ──────────────────────────────────────────
 *
 * There is no offline queue behind this. `mutationQueue` discards an item after
 * three failed retries, which for a correction is an unpaid day disposed of
 * silently. So the send needs a connection and the sheet says so before anything
 * is typed, rather than accepting the request and losing it.
 */

const DIRECTIONS: [PunchDirection, string, string][] = [
  ['in',  'Clock in',  'आगमन'],
  ['out', 'Clock out', 'प्रस्थान'],
];

export interface CorrectionSheetProps {
  visible:    boolean;
  onClose:    () => void;
  employeeId: string;
  /** The day the register was showing, `YYYY-MM-DD`. Never editable here — the
   *  entry point IS the day, and a date field would let somebody file against a
   *  Tuesday they are not looking at. */
  forDate:    string;
  /** Which end is missing, so the sheet opens on the one that is wrong. */
  suggest?:   PunchDirection;
  /** The times already on that day, for the pairing warning and the summary. */
  existing?:  { firstIn?: string; lastOut?: string };
  /** Called after the server has acknowledged the request. */
  onAsked?:   () => void;
}

export default function CorrectionSheet({
  visible, onClose, employeeId, forDate, suggest, existing = {}, onAsked,
}: CorrectionSheetProps) {
  const { t } = useTheme();
  const online = useOnline();
  const qc = useQueryClient();

  const [direction, setDirection] = useState<PunchDirection>(suggest ?? 'out');
  const [time, setTime] = useState('');
  const [picking, setPicking] = useState(false);
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Reopening for a different day must not carry the last day's answers. The
  // sheet is mounted once by the register and reused for every cell.
  useEffect(() => {
    if (!visible) return;
    setDirection(suggest ?? 'out');
    setTime('');
    setPicking(false);
    setReason('');
    setSending(false);
    setProblem(null);
  }, [visible, forDate, suggest]);

  /** The instant the two fields describe, or null while the time is unset. */
  const instant = useMemo(
    () => (time ? localInstant(forDate, time) : null),
    [forDate, time],
  );

  // Depends on the two TIMES rather than on `existing`, which the register
  // rebuilds as a fresh object literal on every render — a memo keyed on the
  // object recomputes every time and is only decoration.
  const { firstIn, lastOut } = existing;
  const warning = useMemo(() => {
    if (!instant) return null;
    return pairingWarning(direction, localIso(instant), { firstIn, lastOut });
  }, [instant, direction, firstIn, lastOut]);

  const send = async () => {
    setProblem(null);
    const built = buildCorrection({ employeeId, forDate, direction, time, reason });
    if (!built.ok) { setProblem(built.problem); return; }

    setSending(true);
    try {
      const created = await correctionsApi.request(built.body);
      // Recorded only now, and only because the server answered with an id. See
      // the note on `rememberAsked` — writing this on the attempt would put
      // "requested" on a register for a request nobody received.
      rememberAsked({
        id:          created.id,
        employee_id: employeeId,
        for_date:    forDate,
        direction,
        at_time:     built.body.requested_at_time,
        asked_at:    new Date().toISOString(),
      });
      // The register is keyed on punches and this changes none of them, but the
      // Me tab and the clock both read the same query and both draw the day.
      qc.invalidateQueries({ queryKey: ['pahchan'] });
      onAsked?.();
      onClose();
    } catch (err: any) {
      const status = err?.response?.status;
      setProblem(
        status === 403
          ? 'You can only ask for a correction to your own attendance.'
          : status === 402 || status === 404
            ? 'Attendance corrections are not switched on for your organisation.'
            : 'That did not reach your organisation, so nothing has been requested. '
              + 'Check your connection and send it again.',
      );
    } finally {
      setSending(false);
    }
  };

  const readable = new Date(`${forDate}T00:00:00`);
  const dayLabel = Number.isNaN(readable.getTime())
    ? forDate
    : readable.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      avoidKeyboard
      closeLabel="Close the correction request"
      panelStyle={[s.panel, { backgroundColor: t.surface }]}
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.body}>
        <View style={s.head}>
          <BiLabel
            latinStyle={[s.headLatin, { color: t.ink }]}
            hindiStyle={{ color: t.ink3 }}
            hindiSize={13}
          >
            ASK FOR A CORRECTION · सुधार
          </BiLabel>
          <Pressable onPress={onClose} hitSlop={hitSlopTo(24)} {...a11yButton('Close')}>
            <Ionicons name="close" size={20} color={t.ink3} />
          </Pressable>
        </View>

        <Text style={[s.day, { color: t.ink }]}>{dayLabel}</Text>
        <Text style={[s.sub, { color: t.ink3 }]}>
          {firstIn || lastOut
            ? `Recorded: in ${hhmm(firstIn)} · out ${hhmm(lastOut)}.`
            : 'No punch reached us for this day.'}
        </Text>

        {/* ── Which end ── */}
        <Text style={[s.label, { color: t.ink2 }]}>WHICH TIME IS WRONG OR MISSING</Text>
        <View style={s.segRow}>
          {DIRECTIONS.map(([id, en, hi]) => {
            const on = id === direction;
            return (
              <Pressable
                key={id}
                onPress={() => setDirection(id)}
                style={[
                  s.seg,
                  { borderColor: on ? t.primary : t.outlineVar,
                    backgroundColor: on ? t.surface2 : 'transparent' },
                ]}
                {...a11ySelected(en, on)}
              >
                <Text style={[s.segEn, { color: on ? t.primary : t.ink2 }]}>{en}</Text>
                <Text style={[s.segHi, { color: on ? t.primaryText : t.ink4 }]}>{hi}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* ── The time ── */}
        <Text style={[s.label, { color: t.ink2 }]}>THE TIME IT ACTUALLY WAS</Text>
        <Pressable
          onPress={() => setPicking(true)}
          style={[s.field, { borderColor: t.outlineVar, backgroundColor: t.surfaceLow }]}
          {...a11yButton(
            time ? `Time, ${time}` : 'Time, not set',
            'Opens the time picker',
          )}
        >
          <Ionicons name="time-outline" size={17} color={t.ink3} accessibilityElementsHidden />
          <Text style={[s.fieldText, { color: time ? t.ink : t.ink4 }]}>
            {time || 'Pick a time'}
          </Text>
        </Pressable>
        {picking && (
          <DateTimePicker
            // Anchored on the day being corrected, so the picker cannot hand back
            // a value from today. Only the clock portion is read out of it.
            value={instant ?? localInstant(forDate, '09:00') ?? new Date()}
            mode="time"
            is24Hour
            display={Platform.OS === 'android' ? 'clock' : 'spinner'}
            onChange={(_, picked) => {
              setPicking(Platform.OS === 'ios');
              if (!picked) return;
              const hh = `${picked.getHours()}`.padStart(2, '0');
              const mm = `${picked.getMinutes()}`.padStart(2, '0');
              setTime(`${hh}:${mm}`);
            }}
          />
        )}

        {/* ── The reason ── */}
        <Text style={[s.label, { color: t.ink2 }]}>WHAT HAPPENED</Text>
        <TextInput
          value={reason}
          onChangeText={setReason}
          multiline
          numberOfLines={3}
          maxLength={REASON_MAX}
          placeholder="Phone battery died before I could clock out."
          placeholderTextColor={t.ink4}
          style={[s.input, { borderColor: t.outlineVar, backgroundColor: t.surfaceLow, color: t.ink }]}
          {...a11yInput('What happened', 'Read by whoever decides on this request')}
        />
        <Text style={[s.hint, { color: t.ink4 }]}>
          A person at your organisation reads this and decides. It is the only thing
          on the request for them to go on.
        </Text>

        {warning && (
          <Text style={[s.warn, { color: t.onApprovalContainer, backgroundColor: t.approvalBg }]}>
            {warning}
          </Text>
        )}

        {problem && (
          <Text style={[s.err, { color: t.onErrorContainer, backgroundColor: t.errorBg }]}>
            {problem}
          </Text>
        )}

        {!online && (
          <Text style={[s.warn, { color: t.onApprovalContainer, backgroundColor: t.approvalBg }]}>
            You are offline. This one is not held on the phone the way a punch is —
            it goes to a person, so it needs a connection. Nothing you have typed is
            lost while this sheet is open.
          </Text>
        )}

        <Pressable
          onPress={send}
          disabled={sending || !online}
          style={[
            s.send,
            { backgroundColor: sending || !online ? t.surface3 : t.primary },
          ]}
          {...a11yButton(sending ? 'Sending the request' : 'Send the request')}
          accessibilityState={{ disabled: sending || !online, busy: sending }}
        >
          {sending
            ? <ActivityIndicator size="small" color={t.ink2} />
            : (
              <Text style={[s.sendText, { color: sending || !online ? t.inkDisabled : t.onPrimary }]}>
                Send to my organisation
              </Text>
            )}
        </Pressable>

        <Text style={[s.foot, { color: t.ink4 }]}>
          One request covers one end of the day. If both your clock-in and your
          clock-out are missing, send this twice.
        </Text>
        <Text style={[s.foot, { color: t.ink4 }]}>
          Nothing changes on your record until somebody approves it, and approving it
          reaches payroll only when your organisation next publishes attendance for
          this period. This app cannot show you their decision yet — they will tell
          you, or you will see the corrected day appear.
        </Text>
      </ScrollView>
    </Sheet>
  );
}

const s = StyleSheet.create({
  panel: { borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '90%' },
  body:  { padding: 18, paddingBottom: 30, gap: 10 },

  head:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headLatin: { fontSize: 11, fontWeight: '800', letterSpacing: 1.3 },

  day: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3, marginTop: 2 },
  sub: { fontSize: 12, lineHeight: 17 },

  label: { fontSize: 10, fontWeight: '800', letterSpacing: 1.1, marginTop: 10 },

  segRow: { flexDirection: 'row', gap: 8 },
  seg:    { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 10, alignItems: 'center', gap: 2 },
  segEn:  { fontSize: 13, fontWeight: '700' },
  segHi:  { fontSize: 11, ...hindi() },

  field:     { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: 46 },
  fieldText: { fontSize: 15 },

  input: {
    borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 82,
    fontSize: 14.5, lineHeight: 20, textAlignVertical: 'top',
  },
  hint: { fontSize: 11.5, lineHeight: 16 },

  warn: { fontSize: 12, lineHeight: 17.5, borderRadius: 10, padding: 10 },
  err:  { fontSize: 12, lineHeight: 17.5, borderRadius: 10, padding: 10 },

  send:     { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  sendText: { fontSize: 14.5, fontWeight: '800' },

  foot: { fontSize: 11.5, lineHeight: 16.5 },
});
