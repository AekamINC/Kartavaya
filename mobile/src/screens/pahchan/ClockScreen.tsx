import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, ActivityIndicator, StatusBar, Platform, Linking,
  Animated, AccessibilityInfo,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../../theme/ThemeProvider';
import { DUR, EASE, amplitude, duration, useReducedMotion } from '../../theme/motion';
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

/**
 * Over a live camera feed the palette does not apply — the background is
 * whatever the lens sees — so these two are fixed, and they are the prototype's
 * own values for this screen (`pahchan.css` `.pc__tick`, `.pc__done`).
 *
 * Amber, not red, for a queued punch. It is recorded; only its delivery is
 * waiting. Colouring it as a failure would send someone hunting for signal over
 * a punch that is already safe.
 */
const OK = '#6FBF8F';
const QUEUED = '#E8A33D';

/** 07 §2's threshold. Worse than this flags — it never blocks. */
const ACCURACY_FLAG_M = 100;

type Phase = 'idle' | 'capturing' | 'submitting' | 'done';

/** Whether the punch reached the server, or is sitting on the phone. */
type Outcome = 'sent' | 'queued' | null;

/**
 * The shutter is BUSY, not merely non-idle.
 *
 * `phase !== 'idle'` disabled it, and nothing ever returned the phase to 'idle'
 * — so one punch permanently disabled the control and left an ActivityIndicator
 * spinning inside it. The screen's success state was a spinner that never
 * stopped, and there was no way to clock out again without killing the app.
 *
 * 'done' is a RESTING state: the confirmation stays on screen and the control
 * is live, because the next thing this person does on this screen is the
 * opposite punch.
 */
const isBusy = (p: Phase) => p === 'capturing' || p === 'submitting';

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
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [retakes, setRetakes] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(getPunchCount());

  const nav = useNavigation();
  const reduced = useReducedMotion();

  /**
   * The shutter flash.
   *
   * The one piece of motion on this screen that is genuinely informational: the
   * camera preview does not otherwise change at the instant the frame is taken,
   * so without it there is no moment. It is not the ONLY signal — the haptic
   * fires beside it and the shutter swaps to a spinner — which is what lets it
   * collapse to nothing under reduced motion without taking the meaning along.
   */
  const flash = useRef(new Animated.Value(0)).current;

  /** The confirmation pop. Amplitude only; the tick is drawn either way. */
  const tickScale = useRef(new Animated.Value(1)).current;

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

  // The queue drains in the background when connectivity returns, and nothing
  // re-rendered this screen when it did — so "3 waiting to send" could still be
  // on screen long after they had all sent. Re-read on focus, which is when
  // someone is actually looking at it.
  useFocusEffect(useCallback(() => { setPending(getPunchCount()); }, []));

  /**
   * Say it out loud.
   *
   * The notice is the load-bearing half of the confirmation — under reduced
   * motion it is very nearly the whole of it — and a `<Text>` that appears is
   * not announced by a screen reader on its own.
   */
  useEffect(() => {
    if (notice) AccessibilityInfo.announceForAccessibility(notice);
  }, [notice]);

  /**
   * The confirmation. One place, so 'sent' and 'queued' cannot drift apart.
   *
   * Someone punching in outdoors, in a hurry, glancing at a phone in sunlight,
   * has to know this registered. So the confirmation is carried by three signals
   * that fail independently:
   *
   *   · a HAPTIC — success for sent, warning for queued. Not motion, not visual,
   *     works with the screen barely readable and with reduced motion on;
   *   · a STATIC swap — the shutter becomes a coloured tick, green for sent and
   *     amber for queued, and the sentence under it says which. Present at
   *     `--motion-scale: 0`, because nothing about it moves;
   *   · a POP — and only this last one is motion, so losing it loses nothing.
   *
   * `queued` is not a failure and must not read as one. The punch is recorded;
   * only its delivery is pending. Amber, not red.
   */
  const finish = useCallback((how: Exclude<Outcome, null>, message: string) => {
    setPhase('done');
    setOutcome(how);
    setNotice(message);

    void Haptics.notificationAsync(
      how === 'sent'
        ? Haptics.NotificationFeedbackType.Success
        : Haptics.NotificationFeedbackType.Warning,
    ).catch(() => {});

    // MOTION-SPEC §4: confirmations overshoot, and spring is for confirmation
    // only. At `amplitude(…, true)` the overshoot is 0 and this settles on 1
    // immediately — the tick is already drawn, so it simply does not bounce.
    tickScale.setValue(1);
    Animated.sequence([
      Animated.timing(tickScale, {
        toValue: 1 + amplitude(18, reduced) / 100,
        duration: duration(DUR.fast, reduced),
        easing: EASE.spring,
        useNativeDriver: true,
      }),
      Animated.timing(tickScale, {
        toValue: 1,
        duration: duration(DUR.slow, reduced),
        easing: EASE.spring,
        useNativeDriver: true,
      }),
    ]).start();
  }, [reduced, tickScale]);

  const submit = useCallback(async () => {
    if (!camera.current || isBusy(phase)) return;
    setPhase('capturing');
    setNotice(null);
    setOutcome(null);

    try {
      const shot = await camera.current.takePictureAsync({ quality: 0.9, skipProcessing: false });

      // Fired once there IS a frame, not on the button press: this marks the
      // instant the photograph was actually taken, and a flash a moment before
      // or after the capture is a lie about when. Under reduced motion
      // `duration()` returns 0 and the overlay is set and cleared on the same
      // frame — invisible, which is correct, because the haptic below and the
      // shutter's own spinner both still mark the moment.
      if (!shot?.uri) {
        setPhase('idle');
        setNotice('The camera did not return a photo. Try again.');
        return;
      }

      flash.setValue(0.9);
      Animated.timing(flash, {
        toValue: 0,
        duration: duration(DUR.slow, reduced),
        easing: EASE.standard,
        useNativeDriver: true,
      }).start();
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

      // Compressed before it is queued, not after. A punch may sit on the device
      // for three days, and a full-resolution frame per punch fills a cheap phone.
      // 720px at q0.75 is comfortably enough for a human to compare two faces.
      const small = await ImageManipulator.manipulateAsync(
        shot.uri,
        [{ resize: { width: 720 } }],
        { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG },
      );

      // The full-resolution frame is a SECOND copy of the same face, and it is
      // the larger one. Nothing reads it after this point — the queue holds
      // `small.uri` — so leaving it behind means every punch permanently adds an
      // unreferenced high-resolution photograph to the device that no retention
      // job anywhere is pointed at. Deleted immediately rather than at flush,
      // because it is already redundant the moment the resize returns.
      if (small.uri !== shot.uri) {
        await FileSystem.deleteAsync(shot.uri, { idempotent: true }).catch(() => {});
      }

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
        finish(
          result.sent > 0 ? 'sent' : 'queued',
          result.sent > 0
            ? [`Clocked ${direction === 'in' ? 'in' : 'out'}.`, ...warnings].join(' ')
            : ['Saved on this device. It will send when you have signal.', ...warnings].join(' '),
        );
      } catch {
        // Upload or send failed. The punch is already queued, so this is a
        // "saved, not sent" outcome rather than a failure — and saying so matters,
        // because "couldn't clock in" would send someone hunting for signal.
        finish(
          'queued',
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
  }, [direction, phase, qc, finish, flash, reduced]);

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

      {/* The shutter flash. `pointerEvents="none"` matters — it covers the whole
          screen including the shutter button, and an overlay that swallows the
          next tap would eat the clock-out. */}
      <Animated.View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[StyleSheet.absoluteFill, s.flash, { opacity: flash }]}
      />

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
            // Amber, and the same amber as the queued tick below. Two indicators
            // for one condition that did not agree on a colour is two conditions
            // as far as the person reading them is concerned. Static — a pulsing
            // "waiting" badge is an infinite animation, and an infinite animation
            // is the one thing this codebase has repeatedly got wrong under
            // reduced motion.
            <View style={s.pendingPill}>
              <Ionicons name="cloud-upload-outline" size={12} color="#FFFFFF" />
              <Text style={s.pendingText}>
                {pending === 1 ? '1 punch waiting to send' : `${pending} punches waiting to send`}
              </Text>
            </View>
          )}
        </View>

        <View style={s.foot}>
          {notice && (
            // `polite`, and announced imperatively above — between them the
            // sentence reaches TalkBack and VoiceOver, which a bare <Text>
            // appearing in a subtree does not.
            <View style={s.notice} accessibilityLiveRegion="polite">
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
              disabled={isBusy(phase)}
              accessibilityRole="button"
              accessibilityLabel={direction === 'in' ? 'Clock in now' : 'Clock out now'}
              accessibilityState={{ disabled: isBusy(phase), busy: isBusy(phase) }}
              style={({ pressed }) => [
                s.shutter,
                {
                  backgroundColor: isBusy(phase) ? 'rgba(255,255,255,0.5)' : '#FFFFFF',
                  // The confirmation ring. A static difference, so it is exactly
                  // as visible at --motion-scale 0 as at 1.
                  borderColor: phase === 'done'
                    ? (outcome === 'sent' ? OK : QUEUED)
                    : 'rgba(255,255,255,0.4)',
                },
                // Press feedback pairs its scale with an opacity step, so it
                // still reads when the scale is gone. `amplitude()` is what
                // removes the movement rather than a second style branch.
                pressed && {
                  transform: [{ scale: 1 - amplitude(4, reduced) / 100 }],
                  opacity: 0.86,
                },
              ]}
            >
              {isBusy(phase) ? (
                <ActivityIndicator color="#111111" />
              ) : phase === 'done' ? (
                // NOT an ActivityIndicator. This state used to render one and
                // never leave, so the success state was a spinner that never
                // stopped — indistinguishable from a send still in flight, on
                // the screen whose entire job is to say the punch registered.
                <Animated.View style={{ transform: [{ scale: tickScale }] }}>
                  <Ionicons
                    name={outcome === 'sent' ? 'checkmark-sharp' : 'cloud-upload'}
                    size={30}
                    color={outcome === 'sent' ? OK : QUEUED}
                  />
                </Animated.View>
              ) : (
                <Ionicons name="finger-print" size={30} color="#111111" />
              )}
            </Pressable>
          )}

          <Text style={s.hint}>
            {phase === 'capturing' ? 'Hold still…'
              : phase === 'submitting' ? 'Sending…'
                : phase === 'done'
                  // Deliberately says nothing about which direction is next.
                  // `direction` is derived from the last punch and the query
                  // that supplies it is invalidated by the punch just made, so
                  // it flips underneath this line at a moment nobody controls —
                  // and the heading above already shows the answer once it has.
                  ? (outcome === 'sent'
                    ? 'Recorded. Tap again for your next punch.'
                    : 'Saved on this phone. Tap again for your next punch.')
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
  flash: { backgroundColor: '#FFFFFF' },
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
    borderWidth: 1, borderColor: QUEUED,
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
