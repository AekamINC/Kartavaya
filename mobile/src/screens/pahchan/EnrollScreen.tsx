import React, { useCallback, useRef, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, ActivityIndicator, StatusBar, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../../theme/ThemeProvider';
import { pahchanApi, enrollmentApi, type ReferencePhoto } from '../../api/pahchan';

/**
 * Enrollment — the two reference photos every punch is later compared against.
 *
 * 07 §0: "Two reference photos, captured now, are what make v2 cheap. They become
 * the embeddings. One frontal photo gives a single embedding that fails on anyone
 * who turns their head; re-enrolling every client's workforce later is the kind of
 * migration that quietly kills a feature. The pair costs one extra tap per
 * employee, once."
 *
 * Slot 1 is frontal, slot 2 is at an angle. The instruction differs per slot
 * because two photos taken thirty seconds apart in the same pose give the
 * reviewer nothing a single photo would not, and give v2 nothing either.
 *
 * These land PENDING. HR approves them, and until two are approved the punch path
 * keeps flagging `noref` — a face nobody has vouched for is not a reference.
 * Saying that on screen matters: an employee who takes two photos and then sees
 * their punches still flagged would reasonably think it had not worked.
 *
 * Same camera-only rule as the punch screen (§1), for the same reason: if a
 * reference photo could come from the gallery, someone could enroll a face that
 * is not theirs and the comparison would confirm it forever.
 */

const SLOTS = [
  {
    slot: 1 as const,
    title: 'Look straight at the camera',
    hi: 'सीधे देखें',
    body: 'Neutral expression, good light, nothing covering your face.',
  },
  {
    slot: 2 as const,
    title: 'Now turn slightly to one side',
    hi: 'थोड़ा बगल में',
    body: 'A quarter turn is enough. This second angle is what makes the check reliable.',
  },
];

export default function EnrollScreen() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: mine } = useQuery({
    queryKey: ['pahchan', 'me'],
    queryFn: () => pahchanApi.me(1),
  });
  const employeeId = mine?.employee?.id;

  const { data: enrollment, isLoading } = useQuery({
    queryKey: ['pahchan', 'enrollment', employeeId],
    queryFn: () => enrollmentApi.get(employeeId as string),
    enabled: !!employeeId,
  });

  const live = enrollment?.photos ?? [];
  const filled = new Set(live.map((p: ReferencePhoto) => p.slot));
  // The first slot with nothing live in it. Retaking a slot means deleting on the
  // server side, so this screen only ever fills gaps — replacement is HR's job.
  const next = SLOTS.find(s => !filled.has(s.slot));

  const capture = useCallback(async () => {
    if (!camera.current || !employeeId || !next || busy) return;
    setBusy(true);
    setError(null);
    // Both local copies are deleted before this function returns, on every path.
    // A reference photo is the identity baseline every future punch is judged
    // against — the most sensitive image this product handles — and the server
    // copy is the one under the org's retention policy. A duplicate sitting in the
    // app sandbox is outside every retention promise Kartavaya makes.
    let originalUri: string | null = null;
    let resizedUri: string | null = null;
    try {
      const shot = await camera.current.takePictureAsync({ quality: 0.95, skipProcessing: false });
      if (!shot?.uri) { setError('The camera did not return a photo. Try again.'); return; }
      originalUri = shot.uri;

      // 1080px at q0.85, larger than a punch selfie. These are the comparison
      // baseline and the future embedding source, so they get the bigger budget —
      // at 1080px with a face filling much of the frame there is plenty of detail
      // for an embedding model, which a 720px punch frame would not guarantee.
      const image = await ImageManipulator.manipulateAsync(
        shot.uri,
        [{ resize: { width: 1080 } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
      );
      resizedUri = image.uri;

      const { photo_key } = await pahchanApi.uploadPhoto(image.uri, 'reference');
      await enrollmentApi.submit({ employee_id: employeeId, slot: next.slot, object_key: photo_key });
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      await qc.invalidateQueries({ queryKey: ['pahchan', 'enrollment'] });
    } catch {
      // No local queue here, unlike a punch. A reference photo is set up once and
      // is not time-critical, so failing and asking again is honest — whereas
      // queueing it would leave the employee believing they were enrolled.
      setError('That could not be saved. Check your connection and try again.');
    } finally {
      // Unconditional, including on failure: there is no retry that reuses these
      // files — `capture()` always takes a fresh photograph — so on every path
      // they are redundant by the time we get here.
      for (const uri of [originalUri, resizedUri]) {
        if (uri) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      }
      setBusy(false);
    }
  }, [busy, employeeId, next, qc]);

  if (!permission) {
    return <View style={[s.centre, { backgroundColor: t.bg }]}><ActivityIndicator color={t.primary} /></View>;
  }

  if (!permission.granted) {
    return (
      <View style={[s.centre, { backgroundColor: t.bg, paddingHorizontal: 32 }]}>
        <Ionicons name="camera-outline" size={34} color={t.ink3} />
        <Text style={[s.h1, { color: t.ink }]}>Camera access is needed</Text>
        <Text style={[s.body, { color: t.ink3, textAlign: 'center' }]}>
          These two photos are what your organisation compares your clock-in selfies
          against. They are taken here in the app and never chosen from your gallery.
        </Text>
        <Pressable
          onPress={() => permission.canAskAgain ? void requestPermission() : void Linking.openSettings()}
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

  if (isLoading || !employeeId) {
    return (
      <View style={[s.centre, { backgroundColor: t.bg, paddingHorizontal: 32 }]}>
        {isLoading
          ? <ActivityIndicator color={t.primary} />
          : (
            <>
              <Ionicons name="person-outline" size={30} color={t.ink3} />
              <Text style={[s.h1, { color: t.ink }]}>Not linked yet</Text>
              <Text style={[s.body, { color: t.ink3, textAlign: 'center' }]}>
                Your account is not linked to an employee record. Ask HR to link it,
                then come back.
              </Text>
            </>
          )}
      </View>
    );
  }

  // Both slots filled — say what happens next rather than showing a dead camera.
  if (!next) {
    const pending = enrollment?.pending_approval ?? 0;
    return (
      <View style={[s.centre, { backgroundColor: t.bg, paddingHorizontal: 32 }]}>
        <Ionicons
          name={enrollment?.complete ? 'checkmark-circle' : 'time-outline'}
          size={38}
          color={enrollment?.complete ? t.success : t.approval}
        />
        <Text style={[s.h1, { color: t.ink }]}>
          {enrollment?.complete ? 'You are enrolled' : 'Waiting for approval'}
        </Text>
        <Text style={[s.body, { color: t.ink3, textAlign: 'center' }]}>
          {enrollment?.complete
            ? 'Both reference photos are on file. Your clock-ins will be checked against them.'
            : `Both photos are saved. ${pending} still need${pending === 1 ? 's' : ''} to be approved by your HR team — `
              + 'until then your clock-ins will be marked for review. That is expected and is not a problem you need to fix.'}
        </Text>
        <Text style={[s.fine, { color: t.ink4, textAlign: 'center' }]}>
          These photos are kept while you are employed here and deleted
          {' '}{mine?.retention?.reference_photo_grace_days ?? 45} days after you leave.
        </Text>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="front" />

      <View style={[s.scrim, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]}>
        <View style={s.head}>
          <Text style={s.step}>Photo {next.slot} of 2</Text>
          <Text style={s.headEn}>{next.title}</Text>
          <Text style={s.headHi}>{next.hi}</Text>
        </View>

        <View style={s.foot}>
          <Text style={s.guide}>{next.body}</Text>
          {error && <Text style={s.error}>{error}</Text>}
          <Pressable
            onPress={capture}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`Take reference photo ${next.slot} of 2`}
            accessibilityState={{ disabled: busy }}
            style={({ pressed }) => [
              s.shutter,
              { backgroundColor: busy ? 'rgba(255,255,255,0.5)' : '#FFFFFF' },
              pressed && { transform: [{ scale: 0.96 }] },
            ]}
          >
            {busy ? <ActivityIndicator color="#111111" /> : <Ionicons name="camera" size={28} color="#111111" />}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  // Over a live camera feed the palette cannot carry the text — the background is
  // whatever the lens sees — so the scrim and fixed white are deliberate here,
  // exactly as on ClockScreen.
  scrim: { flex: 1, justifyContent: 'space-between', paddingHorizontal: 24 },
  head: { alignItems: 'center', gap: 3 },
  step: { fontSize: 11.5, fontWeight: '700', letterSpacing: 1.2, color: 'rgba(255,255,255,0.75)', textTransform: 'uppercase' },
  headEn: { fontSize: 20, fontWeight: '700', color: '#FFFFFF', textAlign: 'center' },
  headHi: { fontSize: 14, color: 'rgba(255,255,255,0.85)' },
  foot: { alignItems: 'center', gap: 14 },
  guide: {
    fontSize: 13, lineHeight: 19, color: '#FFFFFF', textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
  },
  error: {
    fontSize: 13, lineHeight: 19, color: '#FFFFFF', textAlign: 'center',
    backgroundColor: 'rgba(180,35,24,0.85)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
  },
  shutter: {
    width: 76, height: 76, borderRadius: 38,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 4, borderColor: 'rgba(255,255,255,0.4)',
  },
  h1: { fontSize: 19, fontWeight: '700', marginTop: 6 },
  body: { fontSize: 13.5, lineHeight: 20 },
  fine: { fontSize: 12, lineHeight: 18, marginTop: 6 },
  cta: { borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12, marginTop: 8 },
  ctaText: { fontSize: 14, fontWeight: '700' },
});
