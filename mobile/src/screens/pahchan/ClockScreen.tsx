import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, ActivityIndicator, StatusBar, Platform, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../../theme/ThemeProvider';
import { pahchanApi, enrollmentApi, type PunchDirection } from '../../api/pahchan';
import { enqueuePunch, attachPhotoKey, flushPunches, getPunchCount } from '../../offline/punchQueue';

/**
 * Clock in / clock out. 07-pahchan.md, and the prototype at `Pahchan v1.html` §01.
 *
 * Three rules from the spec that this screen exists to honour, and that are each
 * easy to undo with a small "improvement":
 *
 * 1 · CAMERA-ONLY (§1). In-app camera, front lens, no gallery picker and no
 *   gallery permission requested — "a granted permission is an attack surface
 *   whether or not the UI exposes it". With login-only auth a gallery path means
 *   one saved selfie works forever and every punch after the first is a file
 *   copy. That is not a degraded version of the feature; it is its absence.
 *   Retake limit is 3, because unlimited retakes let someone hunt for a frame
 *   that hides where they are.
 *
 * 2 · NOTHING BLOCKS A PUNCH (§2). Location off, weak accuracy, outside the
 *   geofence, no reference pair — the punch is recorded and flagged, and the
 *   employee is TOLD it will be flagged. No condition here returns early without
 *   recording. "A blocked punch at a client site becomes a payroll dispute a week
 *   later, and the employee is right."
 *
 * 3 · THE PUNCH IS QUEUED FIRST, THEN SENT. The queue write is synchronous and
 *   local; the upload and the POST are not. So the record exists before anything
 *   can fail, and `captured_at` is the moment the button was pressed rather than
 *   the moment a network appeared.
 */

const MAX_RETAKES = 3;

/** 07 §2's threshold. Worse than this flags — it never blocks. */
const ACCURACY_FLAG_M = 100;

type Phase = 'idle' | 'capturing' | 'submitting' | 'done';

interface Fix {
  lat?: number;
  lng?: number;
  accuracy_m?: number;
  mock_location?: boolean | null;
  /** Why there is no fix, if there isn't one. Shown to the employee verbatim. */
  problem?: string;
}

/**
 * Best-effort location. Never throws, never blocks the punch.
 *
 * Returns a Fix with `problem` set when it could not get coordinates, so the
 * caller can tell the employee the punch will be flagged rather than silently
 * sending nothing.
 */
async function readFix(): Promise<Fix> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      return { problem: 'Location is off, so this punch will be flagged for review.' };
    }
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      // Never rounded and never defaulted to 0 (§4). A missing accuracy stays
      // undefined so the server flags it, because 0 would read as a perfect fix.
      accuracy_m: pos.coords.accuracy ?? undefined,
      // Android exposes this; iOS does not, so `undefined` there means "not
      // checked on this platform", which is not the same as "checked, clean".
      mock_location: (pos as { mocked?: boolean }).mocked ?? null,
    };
  } catch {
    return { problem: 'Location could not be read, so this punch will be flagged.' };
  }
}

export default function ClockScreen() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();

  const [phase, setPhase] = useState<Phase>('idle');
  const [retakes, setRetakes] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(getPunchCount());

  const nav = useNavigation();

  const { data: mine } = useQuery({
    queryKey: ['pahchan', 'me'],
    queryFn: () => pahchanApi.me(7),
  });

  // Whether this employee has an approved reference pair. If not, every punch is
  // flagged `noref` — so the prompt to enroll belongs here, on the screen they
  // actually open, rather than waiting for someone to find it in Settings.
  const { data: enrollment } = useQuery({
    queryKey: ['pahchan', 'enrollment', mine?.employee?.id],
    queryFn: () => enrollmentApi.get(mine!.employee!.id),
    enabled: !!mine?.employee?.id,
  });

  // Direction is derived, not chosen. The employee should not have to remember
  // whether they are currently in — the last punch already knows.
  const lastToday = mine?.punches?.[0];
  const direction: PunchDirection = lastToday?.direction === 'in' ? 'out' : 'in';

  useEffect(() => { setPending(getPunchCount()); }, [phase]);

  const submit = useCallback(async () => {
    if (!camera.current || phase !== 'idle') return;
    setPhase('capturing');
    setNotice(null);

    try {
      const shot = await camera.current.takePictureAsync({ quality: 0.9, skipProcessing: false });
      if (!shot?.uri) {
        setPhase('idle');
        setNotice('The camera did not return a photo. Try again.');
        return;
      }

      // Compressed before it is queued, not after. A punch may sit on the device
      // for three days, and a full-resolution frame per punch fills a cheap phone.
      // 720px at q0.75 is comfortably enough for a human to compare two faces.
      const small = await ImageManipulator.manipulateAsync(
        shot.uri,
        [{ resize: { width: 720 } }],
        { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG },
      );

      const fix = await readFix();
      const capturedAt = new Date().toISOString();

      // Queue FIRST. Synchronous and local, so the punch exists before the
      // network is involved and cannot be lost by a failed upload.
      const clientPunchId = enqueuePunch({
        direction,
        captured_at:   capturedAt,
        lat:           fix.lat,
        lng:           fix.lng,
        accuracy_m:    fix.accuracy_m,
        mock_location: fix.mock_location,
        photo_uri:     small.uri,
      });

      setPhase('submitting');
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

      // Tell the employee about every degraded condition, in the words §2 uses.
      // They are recorded, not refused — but someone whose punch will be reviewed
      // deserves to know before their manager mentions it.
      const warnings: string[] = [];
      if (fix.problem) warnings.push(fix.problem);
      else if (fix.accuracy_m != null && fix.accuracy_m > ACCURACY_FLAG_M) {
        warnings.push(
          `Your location is only accurate to ±${Math.round(fix.accuracy_m)}m, so this punch will be flagged. `
          + 'That is normal indoors and is not a problem you caused.',
        );
      }
      if (fix.mock_location === true) {
        warnings.push('Your device reports a simulated location. This punch will be flagged prominently.');
      }

      try {
        const { photo_key } = await pahchanApi.uploadPhoto(small.uri, 'punch');
        attachPhotoKey(clientPunchId, photo_key);
        const result = await flushPunches();
        setPhase('done');
        setNotice(
          result.sent > 0
            ? [`Clocked ${direction === 'in' ? 'in' : 'out'}.`, ...warnings].join(' ')
            : ['Saved on this device. It will send when you have signal.', ...warnings].join(' '),
        );
      } catch {
        // Upload or send failed. The punch is already queued, so this is a
        // "saved, not sent" outcome rather than a failure — and saying so matters,
        // because "couldn't clock in" would send someone hunting for signal.
        setPhase('done');
        setNotice(
          [
            `Clocked ${direction === 'in' ? 'in' : 'out'} and saved on this device. `
            + 'It will send automatically when you have signal.',
            ...warnings,
          ].join(' '),
        );
      }

      void qc.invalidateQueries({ queryKey: ['pahchan'] });
    } catch {
      setPhase('idle');
      setRetakes(n => n + 1);
      setNotice('That did not work. Try again.');
    }
  }, [direction, phase, qc]);

  // ── Permission states ───────────────────────────────────────────────────────

  if (!permission) {
    return (
      <View style={[s.centre, { backgroundColor: t.bg }]}>
        <ActivityIndicator color={t.primary} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={[s.centre, { backgroundColor: t.bg, paddingHorizontal: 32 }]}>
        <Ionicons name="camera-outline" size={34} color={t.ink3} />
        <Text style={[s.h1, { color: t.ink, textAlign: 'center' }]}>Camera access is needed</Text>
        <Text style={[s.body, { color: t.ink3, textAlign: 'center' }]}>
          Clocking in records a photo so your organisation can confirm it was you.
          The photo is taken here in the app — it is never chosen from your gallery,
          and this app never asks for gallery access.
        </Text>
        <Pressable
          onPress={() => {
            if (permission.canAskAgain) void requestPermission();
            else void Linking.openSettings();
          }}
          accessibilityRole="button"
          style={[s.cta, { backgroundColor: t.primary }]}
        >
          <Text style={[s.ctaText, { color: t.onPrimary }]}>
            {permission.canAskAgain ? 'Allow camera' : 'Open settings'}
          </Text>
        </Pressable>
      </View>
    );
  }

  const blockedByRetakes = retakes >= MAX_RETAKES;

  return (
    <View style={s.root}>
      {/* §immersive: edge-to-edge under a transparent bar with light glyphs, in
          light AND dark alike. "A cream status bar above a black camera view is
          the most visible possible defect, and it is invisible in dark mode,
          which is where it gets tested." */}
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="front" />

      <View style={[s.scrim, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]}>
        <View style={s.head}>
          <Text style={s.headEn}>
            {direction === 'in' ? 'Clock in' : 'Clock out'}
          </Text>
          <Text style={s.headHi}>{direction === 'in' ? 'उपस्थिति' : 'प्रस्थान'}</Text>
          {enrollment && !enrollment.complete && (
            <Pressable
              onPress={() => nav.navigate('Enroll' as never)}
              accessibilityRole="button"
              accessibilityLabel="Set up your reference photos"
              style={s.enrollPrompt}
            >
              <Ionicons name="alert-circle-outline" size={13} color="#FFFFFF" />
              <Text style={s.enrollText}>
                {enrollment.pending_approval > 0
                  ? 'Reference photos awaiting HR approval'
                  : 'Add your two reference photos'}
              </Text>
              {enrollment.pending_approval === 0 && (
                <Ionicons name="chevron-forward" size={13} color="#FFFFFF" />
              )}
            </Pressable>
          )}

          {pending > 0 && (
            <View style={s.pendingPill}>
              <Ionicons name="cloud-upload-outline" size={12} color="#FFFFFF" />
              <Text style={s.pendingText}>
                {pending} waiting to send
              </Text>
            </View>
          )}
        </View>

        <View style={s.foot}>
          {notice && (
            <View style={s.notice}>
              <Text style={s.noticeText}>{notice}</Text>
            </View>
          )}

          {blockedByRetakes ? (
            <Text style={s.retakeWarn}>
              You have retaken this {MAX_RETAKES} times. Ask your manager to add the time manually.
            </Text>
          ) : (
            <Pressable
              onPress={submit}
              disabled={phase !== 'idle'}
              accessibilityRole="button"
              accessibilityLabel={direction === 'in' ? 'Clock in now' : 'Clock out now'}
              accessibilityState={{ disabled: phase !== 'idle' }}
              style={({ pressed }) => [
                s.shutter,
                { backgroundColor: phase === 'idle' ? '#FFFFFF' : 'rgba(255,255,255,0.5)' },
                pressed && { transform: [{ scale: 0.96 }] },
              ]}
            >
              {phase === 'idle' ? (
                <Ionicons name="finger-print" size={30} color="#111111" />
              ) : (
                <ActivityIndicator color="#111111" />
              )}
            </Pressable>
          )}

          <Text style={s.hint}>
            {phase === 'submitting' ? 'Sending…'
              : phase === 'done' ? 'Done'
              : 'Look at the camera and tap'}
          </Text>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  // Over a live camera feed the palette does not apply: the background is
  // whatever the lens sees, so contrast has to come from a scrim and fixed
  // white. This is the one screen where theme tokens cannot carry the text.
  scrim: { flex: 1, justifyContent: 'space-between', paddingHorizontal: 20 },
  head: { alignItems: 'center', gap: 2 },
  headEn: { fontSize: 22, fontWeight: '700', color: '#FFFFFF' },
  headHi: { fontSize: 14, color: 'rgba(255,255,255,0.85)' },
  pendingPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10,
    backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 99,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  pendingText: { fontSize: 11.5, fontWeight: '600', color: '#FFFFFF' },
  enrollPrompt: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10,
    // Amber rather than red: an unenrolled employee can still punch (§2), so this
    // is a "do this soon", not a failure.
    backgroundColor: 'rgba(149,88,6,0.9)', borderRadius: 99,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  enrollText: { fontSize: 11.5, fontWeight: '700', color: '#FFFFFF' },
  foot: { alignItems: 'center', gap: 14 },
  notice: {
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  noticeText: { color: '#FFFFFF', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  shutter: {
    width: 76, height: 76, borderRadius: 38,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 4, borderColor: 'rgba(255,255,255,0.4)',
  },
  hint: { color: 'rgba(255,255,255,0.9)', fontSize: 13, fontWeight: '600' },
  retakeWarn: {
    color: '#FFFFFF', fontSize: 13, lineHeight: 19, textAlign: 'center',
    backgroundColor: 'rgba(180,35,24,0.85)', borderRadius: 12, padding: 12,
  },
  h1: { fontSize: 19, fontWeight: '700', marginTop: 6 },
  body: { fontSize: 13.5, lineHeight: 20 },
  cta: { borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12, marginTop: 8 },
  ctaText: { fontSize: 14, fontWeight: '700' },
});
