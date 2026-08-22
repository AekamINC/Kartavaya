import React from 'react';
import { View, Text, Image, StyleSheet, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { pahchanApi, enrollmentApi, type ReferencePhoto } from '../../api/pahchan';
import { FAMILY } from '../../theme/fonts';
import { useAuth } from '../../hooks/useAuth';
import AttendanceNotice from './AttendanceNotice';
import RulesCard from './RulesCard';
import { localAck } from './noticeAck';
import { PAHCHAN_NOTICE_VERSION } from './noticeCopy';

/**
 * What is held about you, and for how long — 07-pahchan.md §9.
 *
 * "*Me* carries the employee's own reference pair and the retention promise in
 * plain words. Someone whose face is photographed twice a day should be able to
 * see what is held and for how long without asking."
 *
 * That sentence is the whole component. Two things follow from it:
 *
 * The photographs are SHOWN, not described. "Two reference photos on file" is
 * not the same as seeing which two — an employee cannot tell whether the right
 * face is on their record, or whether a replacement they were asked for actually
 * landed, from a count.
 *
 * The windows are the ORG'S ACTUAL NUMBERS, read from policy via /me, never the
 * defaults hardcoded here. An org that shortened its punch-photo window to 30
 * days must not have this screen tell its employees 90. A retention promise
 * displayed from a constant is a promise about a different system.
 *
 * Renders nothing at all for someone who is not a Pahchan employee — this is the
 * shared Me tab, and most people who see it have no attendance record.
 */

const W = 62;
const H = 78;

function Slot({
  photo, label, t,
}: { photo?: ReferencePhoto; label: string; t: any }) {
  const { data: url, isLoading, isError } = useQuery({
    queryKey: ['pahchan', 'refphoto', photo?.id],
    queryFn: () => enrollmentApi.photoUrl(photo!.id),
    enabled: !!photo?.id,
    // Signed and short-lived, so it is not worth holding across a long session.
    staleTime: 4 * 60 * 1000,
  });

  const pending = photo && !photo.approved_at;

  return (
    <View style={{ alignItems: 'center', gap: 5 }}>
      <View
        style={[
          s.slot,
          // `outlineVar`, not `outlineVariant`. `theme/tokens.ts:157` spells it
          // `outlineVar`; this read `t.outlineVariant ?? t.ink3`, and a `??` on a
          // key the object does not have is not a fallback — it is the only
          // branch. Every reference-photo slot has been outlined in body-text
          // grey rather than the divider colour, in both themes, silently.
          { width: W, height: H, backgroundColor: t.surfaceLow, borderColor: t.outlineVar },
        ]}
      >
        {url ? (
          <Image source={{ uri: url }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        ) : isLoading && photo ? (
          <ActivityIndicator size="small" color={t.ink3} />
        ) : (
          <Ionicons
            name={isError ? 'alert-circle-outline' : 'person-outline'}
            size={20}
            color={t.ink3}
          />
        )}
      </View>
      <Text style={[s.slotLabel, { color: t.ink3 }]}>
        {!photo ? 'Not taken' : pending ? 'Awaiting HR' : label}
      </Text>
    </View>
  );
}

export default function MyBiometrics({ t }: { t: any }) {
  // The signed-in account — the subject of the notice acknowledgement. The
  // reference photographs are keyed on the employee record; the notice is not.
  const auth = useAuth();
  const { data: mine } = useQuery({
    // `days` is part of the key — see the note in ClockScreen. This asks for 1
    // day and ClockScreen asks for 7; under a shared key they collided.
    // The notice version joins `days` in the key for the same reason `days` is
    // there: it changes the request, and a key that does not describe the
    // request is a cache that lies.
    queryKey: ['pahchan', 'me', 1, PAHCHAN_NOTICE_VERSION],
    queryFn: () => pahchanApi.me(1, PAHCHAN_NOTICE_VERSION),
    // A failure here must not surface as an error on a settings screen — the
    // section simply does not render.
    retry: false,
  });

  const employeeId = mine?.employee?.id;

  const { data: enrollment } = useQuery({
    queryKey: ['pahchan', 'enrollment', employeeId],
    queryFn: () => enrollmentApi.get(employeeId as string),
    enabled: !!employeeId,
    retry: false,
  });

  // Has this account been served the notice, on this handset or anywhere? The
  // acknowledgement is keyed on the ACCOUNT, not on the employee record —
  // migration 113 measured 0 of 81 employee rows carrying a user_id, so an
  // employee-keyed answer would be null for everybody.
  const noticeAckedAt = mine?.notice?.acknowledged_at ?? localAck(auth.user?.user_id);

  // Not an attendance user AND never served the notice. The Me tab is shared by
  // both shells and most people who open it have no Pahchan record at all.
  //
  // The second half of that condition is load-bearing. Somebody who cleared the
  // gate on the Clock screen has no employee row today, and returning null on
  // `!employeeId` alone would mean the notice they just acknowledged could never
  // be read again — which is the thing 07 §9 exists to prevent.
  if (!employeeId && !noticeAckedAt) return null;

  const photos = enrollment?.photos ?? [];
  const slot1 = photos.find((p: ReferencePhoto) => p.slot === 1);
  const slot2 = photos.find((p: ReferencePhoto) => p.slot === 2);
  const r = mine?.retention;

  return (
    <View style={s.wrap}>
      {employeeId && (
      <View style={s.labelRow}>
        <Text style={[s.label, { color: t.primary }]}>Your attendance photos</Text>
        <Text style={[s.hi, { color: t.ink3 }]}>आपकी तस्वीरें</Text>
      </View>
      )}

      {employeeId && (
      <View style={[s.card, { backgroundColor: t.surfaceLow }]}>
        <View style={s.slots}>
          <Slot photo={slot1} label="Front" t={t} />
          <Slot photo={slot2} label="Angle" t={t} />
          <Text style={[s.slotsNote, { color: t.ink2 }]}>
            {photos.length === 0
              ? 'You have not taken your reference photos yet. Every clock-in is flagged until you do.'
              : enrollment?.complete
                ? 'Your clock-in selfies are compared against these two by a person at your organisation. Face recognition is not used.'
                : 'One or both are still waiting for HR to approve. Until both are approved your clock-ins are flagged.'}
          </Text>
        </View>

        {r && (
          <View style={[s.retention, { borderTopColor: t.outlineVar }]}>
            <Text style={[s.retentionHead, { color: t.ink }]}>How long these are kept</Text>
            <Line t={t} k="Clock-in selfies" v={`${r.punch_photo_days} days, then deleted`} />
            <Line t={t} k="These reference photos" v={`Until you leave, plus ${r.reference_photo_grace_days} days`} />
            <Line t={t} k="Attendance record (times only)" v={`${r.record_retention_years} years`} />
            <Text style={[s.retentionNote, { color: t.ink3 }]}>
              Deleted means deleted, not moved to an archive. The attendance record is
              kept longer than the photographs because the law requires it — it holds
              times and hours, never an image.
            </Text>
          </View>
        )}
      </View>
      )}

      {/* ── The notice, still readable ────────────────────────────────────────
          07 §9's third obligation, and the reason the gate on `ClockScreen` is
          allowed to be one tap: a notice you can only ever see once is a notice
          somebody can honestly say they do not remember being shown. The Me tab
          is where it lives afterwards, which is what `PahchanClock.jsx:151` puts
          there as a `What we store` row.

          Read-only here. There is no button: the acknowledgement was taken at
          the gate, or on the web tab, and re-posting it would move nothing —
          the row is `ON CONFLICT DO NOTHING` and keeps its first timestamp.

          `mine.notice` is absent on a backend older than this feature, and
          `acknowledged_at` is also null when migration 113 has not been applied,
          so the local latch is the second source. Neither being present means
          the date line simply does not render — never a date that was guessed. */}
      <AttendanceNotice
        mode="reference"
        t={t}
        retention={r}
        acknowledgedAt={noticeAckedAt}
      />

      {/* ── What decides about you, after what is held about you ────────────
          Deliberately below the notice and the retention promise, because those
          two answer "what is recorded" and this answers "what is judged" — and
          somebody reading this screen because a punch was flagged is looking for
          the second. Renders nothing on a backend older than the rules block:
          see RulesCard, which has no defaults of its own on purpose. */}
      <RulesCard t={t} rules={mine?.rules} />
    </View>
  );
}

function Line({ t, k, v }: { t: any; k: string; v: string }) {
  return (
    <View style={s.line}>
      <Text style={[s.lineK, { color: t.ink2 }]}>{k}</Text>
      <Text style={[s.lineV, { color: t.ink }]}>{v}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap:     { paddingHorizontal: 16, paddingBottom: 14 },
  labelRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: 6, paddingBottom: 8 },
  label:    { fontSize: 11, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase' },
  hi:       { fontSize: 12, fontFamily: FAMILY.devanagari },
  card:     { borderRadius: 16, overflow: 'hidden' },
  slots:    { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14 },
  slot: {
    borderRadius: 8, borderWidth: 1, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
  },
  slotLabel:  { fontSize: 10.5, fontWeight: '600' },
  slotsNote:  { flex: 1, fontSize: 12, lineHeight: 17.5 },
  retention:  { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 12, gap: 6 },
  retentionHead: { fontSize: 13, fontWeight: '700', paddingBottom: 2 },
  line:       { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  lineK:      { fontSize: 12, flexShrink: 1 },
  lineV:      { fontSize: 12, fontWeight: '600', textAlign: 'right', flexShrink: 1 },
  retentionNote: { fontSize: 11.5, lineHeight: 16.5, paddingTop: 4 },
});
