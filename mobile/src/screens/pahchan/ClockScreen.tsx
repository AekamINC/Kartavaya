import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, StatusBar, Linking, Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../../theme/ThemeProvider';
import { hindi } from '../../theme/fonts';
import { pahchanApi, enrollmentApi, type PunchDirection } from '../../api/pahchan';
import { enqueuePunch, attachPhotoKey, flushPunches } from '../../offline/punchQueue';
import { useQueueStatus } from '../../hooks/useQueueStatus';
import { duration, scaleTo, useReducedMotion, DUR, EASE } from '../../theme/motion';
import AttendanceHistory, { AttendanceSegment } from './AttendanceHistory';

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

/**
 * How long the confirmation ring holds before it settles.
 *
 * From the reference prototype, which is the only place this timing is written
 * down: `Mobile.jsx:318` runs `setTimeout(…, 900)` on the `matched` stage before
 * moving on. It is deliberately long for a confirmation — 900ms is four times
 * `--dur-base` — because this is the frame that tells someone their day has been
 * recorded, and it is the last thing they look at before putting the phone away.
 *
 * The build had no equivalent. `phase` went `capturing → submitting → done` with
 * the shutter swapped for a spinner and a line of text underneath; nothing on
 * screen ever said "that worked" in a way you could see from arm's length.
 */
const CONFIRM_HOLD_MS = 900;

/**
 * `.mcam__ring.ok` from `mobile.css:196`, split across the two properties RN
 * gives us. Fixed hexes rather than tokens for the same reason the rest of this
 * screen is: the background here is a live camera feed, so there is no surface
 * for a theme colour to be legible against.
 */
const CONFIRM_GREEN = '#5BD98A';
const CONFIRM_HALO  = 'rgba(91,217,138,0.35)';

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
  const { t, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();

  const [phase, setPhase] = useState<Phase>('idle');
  const [retakes, setRetakes] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const reduced = useReducedMotion();

  /**
   * The pending count was `useState(getPunchCount())` refreshed by an effect
   * keyed on `[phase]`, so it only moved when the employee happened to take
   * another photo. A punch that flushed in the background while this screen was
   * open kept showing as waiting; one enqueued elsewhere never appeared at all.
   * `useQueueStatus` subscribes to the MMKV write instead.
   */
  const { punches } = useQueueStatus();

  /**
   * The confirmation pop. MOTION-SPEC §4's one-shot vocabulary — `--dur-slow`
   * on `--ease-spring`, overshooting and settling — applied to the shutter,
   * which is the control the employee is already looking at.
   *
   * Reduced motion collapses BOTH halves: `scaleTo` takes the overshoot to 1 so
   * nothing grows, and `duration` takes the settle to 0ms. What survives is the
   * colour and the tick, which is where the meaning was. §4 gives spring to
   * confirmations only, and a punch landing is exactly that.
   */
  const confirm = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (phase !== 'done') { confirm.setValue(1); return; }
    Animated.sequence([
      Animated.timing(confirm, {
        toValue: scaleTo(1.14, reduced),
        duration: duration(DUR.slow, reduced),
        easing: EASE.spring,
        useNativeDriver: true,
      }),
      Animated.timing(confirm, {
        toValue: 1,
        duration: duration(DUR.base, reduced),
        easing: EASE.emph,
        useNativeDriver: true,
      }),
    ]).start();

    /**
     * Hold the confirmation, then hand the control back.
     *
     * `done` was terminal: the shutter is disabled for every phase but `idle`,
     * so once a punch landed this screen could not take another one until it was
     * unmounted and remounted. Clock in, then clock out an hour later without
     * leaving the screen, and the button was dead.
     *
     * The `notice` deliberately survives — the confirmation ring is the part
     * that is timed, and the sentence explaining a flagged location or an unsent
     * punch is information the employee may still be reading.
     *
     * `direction` recomputes on its own: the flush invalidates ['pahchan'], the
     * refetch lands, and the button comes back saying the opposite thing.
     */
    const back = setTimeout(() => setPhase('idle'), CONFIRM_HOLD_MS);
    return () => clearTimeout(back);
  }, [phase, reduced, confirm]);

  // `Clock | My attendance`, per the reference's MPahchan. The register is a tab
  // on this screen rather than a route of its own, because it is the same
  // question asked twice — "am I in?" and "was I in?".
  const [tab, setTab] = useState<'clock' | 'history'>('clock');

  const nav = useNavigation();

  const { data: mine, isFetching: mineFetching } = useQuery({
    // `days` is part of the key. It was not, and `MyBiometrics` asks the same
    // key for 1 day while this asks for 7 — so whichever mounted first decided
    // what both got back. Same key, different request, is a cache that lies.
    queryKey: ['pahchan', 'me', 7],
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

  // ── The register ────────────────────────────────────────────────────────────
  // Deliberately ABOVE the camera-permission gate. Reading your own attendance
  // record does not need a camera, and someone who denied the permission — or
  // who is looking at last month on a train — must still be able to see it.
  if (tab === 'history') {
    return (
      <View style={[s.historyRoot, { backgroundColor: t.bg, paddingTop: insets.top + 8 }]}>
        <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
        <View style={s.historyHead}>
          <Text style={[s.historyTitle, { color: t.ink }]} accessibilityRole="header">Attendance</Text>
          <Text style={[s.historyTitleHi, { color: t.primaryText }]}>पहचान</Text>
        </View>
        <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
          <AttendanceSegment tab={tab} onChange={setTab} />
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
          <AttendanceHistory />
        </ScrollView>
      </View>
    );
  }

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

          {punches.count > 0 && (
            <View
              style={s.pendingPill}
              accessibilityLiveRegion="polite"
            >
              <Ionicons
                name="cloud-upload-outline" size={12} color="#FFFFFF"
                accessibilityElementsHidden importantForAccessibility="no"
              />
              <Text style={s.pendingText}>
                {punches.count} waiting to send
                {/* The 72-hour buffer, named while it is still open. Before
                    this, `PUNCH_RETENTION_MS` was enforced silently by
                    pruneExpired and only ever surfaced as an Alert AFTER a
                    punch had aged out — by which point the employee's only
                    remaining option is a regularisation request. Shown inside
                    the last day so it reads as a warning and not as wallpaper. */}
                {punches.hoursLeft != null && punches.hoursLeft <= 24
                  ? ` · about ${punches.hoursLeft} h left`
                  : ''}
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
            <Animated.View style={{ transform: [{ scale: confirm }] }}>
              <Pressable
                onPress={submit}
                // `mineFetching` closes the window the confirmation hold opens.
                // `direction` is derived from the last punch, so between handing
                // the shutter back and the refetch landing it would still read
                // "Clock in" — and a second tap there is a duplicate punch that
                // this queue is append-only and does NOT dedupe.
                disabled={phase !== 'idle' || mineFetching}
                accessibilityRole="button"
                accessibilityLabel={direction === 'in' ? 'Clock in now' : 'Clock out now'}
                accessibilityState={{ disabled: phase !== 'idle' || mineFetching }}
                style={({ pressed }) => [
                  s.shutter,
                  {
                    backgroundColor: phase === 'done' ? CONFIRM_GREEN
                      : phase === 'idle' ? '#FFFFFF'
                      : 'rgba(255,255,255,0.5)',
                    // The ring 07 §1's prototype puts round the face. `.mcam__ring.ok`
                    // is `box-shadow: 0 0 0 2px #5BD98A, 0 0 0 12px rgba(91,217,138,.2)`;
                    // RN has no box-shadow, so the outer halo is the border and the
                    // inner ring is the fill.
                    borderColor: phase === 'done' ? CONFIRM_HALO : 'rgba(255,255,255,0.4)',
                  },
                  // §1 gives press feedback --dur-instant; a Pressable style
                  // callback has no duration to give it, so what is left to get
                  // right is the amplitude — and that is the half reduced motion
                  // cares about. `scaleTo` takes it to 1, so the button responds
                  // in colour alone.
                  pressed && { transform: [{ scale: scaleTo(0.96, reduced) }] },
                ]}
              >
                {phase === 'done' ? (
                  <Ionicons name="checkmark" size={34} color="#06282B" />
                ) : phase === 'idle' ? (
                  <Ionicons name="finger-print" size={30} color="#111111" />
                ) : (
                  <ActivityIndicator color="#111111" />
                )}
              </Pressable>
            </Animated.View>
          )}

          <Text style={s.hint} accessibilityLiveRegion="polite">
            {phase === 'submitting' ? 'Sending…'
              : phase === 'done' ? (direction === 'in' ? 'Clocked in' : 'Clocked out')
              : 'Look at the camera and tap'}
          </Text>

          {/* The reference reaches the register from a segment; over a live
              camera there is nowhere to put one, so the way through is a link.
              It comes BACK via the segment on the other side. */}
          <Pressable
            onPress={() => setTab('history')}
            accessibilityRole="button"
            accessibilityLabel="My attendance"
            hitSlop={10}
            style={({ pressed }) => [s.historyLink, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="calendar-outline" size={14} color="#FFFFFF" />
            <Text style={s.historyLinkText}>My attendance</Text>
          </Pressable>
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

  // Over the camera, so fixed white for the same reason as everything else in
  // the scrim — the background is whatever the lens sees.
  historyLink: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 99,
    paddingHorizontal: 14, paddingVertical: 7,
  },
  historyLinkText: { color: '#FFFFFF', fontSize: 12.5, fontWeight: '700' },

  // The register tab is a normal themed screen, not a camera one.
  historyRoot: { flex: 1 },
  historyHead: { paddingHorizontal: 16, paddingBottom: 10 },
  historyTitle: { fontSize: 24, fontWeight: '700', letterSpacing: -0.4 },
  historyTitleHi: { fontSize: 13, marginTop: 1, ...hindi() },
});
