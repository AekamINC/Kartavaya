import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Switch, ActivityIndicator, Platform, Alert, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { getDeviceId } from '../hooks/usePushNotifications';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../theme/ThemeProvider';
import { a11yButton, a11ySelected, a11yToggle } from '../components/a11y';
import { hindi } from '../theme/fonts';
import { useAuth } from '../hooks/useAuth';
import { notificationsApi } from '../api/notifications';
import { avatarColor, userInitials, BRAND } from '../theme/tokens';
import { flushQueue, getQueueCount } from '../offline/mutationQueue';
import { getLastCrash, clearLastCrash } from '../components/CrashGuard';
import type {
  NotifPrefsResponse, NotifKind, PushMode,
} from '../api/types';

/**
 * Whether this device has been told to stop holding a push token.
 *
 * Deliberately tri-state. Absent means "never asked", and the launch-time
 * registration in `usePushNotifications` has to keep registering for those
 * people — reading absence as "off" would silence everyone who has never opened
 * this screen. Only the literal 'false' is a decision, and it is the only value
 * the registration path may refuse to register on.
 */
// One spelling, shared with the hook that READS it. Two literals in two files
// disagree silently, and the symptom is a phone that buzzes while this screen
// says notifications are off.
import { PUSH_ENABLED_KEY } from '../hooks/usePushNotifications';

/**
 * Request permission and mint an Expo push token, or null if permission is
 * refused.
 *
 * A near-copy of `registerForPushNotificationsAsync` in
 * `hooks/usePushNotifications.ts`, which is not exported. It cannot stay a copy:
 * a bogus `Constants.isDevice` gate lived in that one and not this one for two
 * releases, and this copy was ALSO missing the Android channel below, so a
 * device first enabled from this screen had nowhere for Android 8+ to post a
 * notification. See the note at the top of the hook.
 *
 * The one intentional difference is the error contract: null here means
 * "permission refused" and nothing else, so the caller can say so. A failure to
 * mint — an iOS simulator, or Android with no FCM config — throws and is
 * reported with its own words rather than being flattened into a permissions
 * message the person cannot act on.
 */
async function registerPushToken(): Promise<string | null> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return null;

  // Same id, importance and colour as the hook's — a second channel that merely
  // resembled it would give the same app two rows in Android's notification
  // settings, each controlling half the pushes.
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: BRAND.teal,
    });
  }

  // projectId is required for production standalone builds. No `as any`: both
  // properties are declared by expo-constants, and the cast was hiding that
  // from the sweep in `hooks/__tests__/pushRegistration.test.ts`.
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;
  const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
  return token;
}

// ── Config ────────────────────────────────────────────────────────────────────
const NOTIF_KINDS: Array<{ kind: NotifKind; label: string; hindi: string; desc: string }> = [
  { kind: 'assigned',         label: 'Task assigned',      hindi: 'असाइन किया',    desc: 'When a task is assigned to you' },
  { kind: 'comment',          label: 'Comments',           hindi: 'टिप्पणियाँ',   desc: 'When someone comments on your task' },
  { kind: 'mention',          label: 'Mentions',           hindi: 'उल्लेख',       desc: 'When you are @-mentioned' },
  { kind: 'approval_request', label: 'Approval requests',  hindi: 'अनुमोदन',      desc: 'When approval is requested' },
  { kind: 'approved',         label: 'Approved',           hindi: 'स्वीकृत',      desc: 'When your task is approved' },
  { kind: 'rejected',         label: 'Rejected',           hindi: 'अस्वीकृत',     desc: 'When your task is rejected' },
  { kind: 'status_changed',   label: 'Status changes',     hindi: 'स्थिति',       desc: 'When a task status changes' },
  { kind: 'done',             label: 'Task completed',     hindi: 'पूर्ण',        desc: 'When a task is marked done' },
];

const PUSH_MODES: Array<{ value: PushMode; label: string }> = [
  { value: 'always',    label: 'Always' },
  { value: 'mine_only', label: 'Mine only' },
  { value: 'project',   label: 'Project' },
  { value: 'off',       label: 'Off' },
];

const QUIET_HOURS = [
  '00:00','01:00','02:00','03:00','04:00','05:00','06:00','07:00',
  '08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00',
  '16:00','17:00','18:00','19:00','20:00','21:00','22:00','23:00',
];

// ── Screen ────────────────────────────────────────────────────────────────────
export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  /**
   * The last crash, read once on mount.
   *
   * A crash that killed the process leaves no boundary panel behind — the app is
   * simply gone and reopens clean. `CrashGuard` writes the record to MMKV before
   * the process dies, and this is the only place it can be read back. Read into
   * state rather than called during render so that dismissing it does not need a
   * second read.
   */
  const [crash, setCrash] = useState(() => getLastCrash());
  const { t, preference, setPreference } = useTheme();
  const { user, logout, signOutEverywhere } = useAuth();
  const qc                                = useQueryClient();

  const [pushEnabled,  setPushEnabled]   = useState(false);
  const [registeringPush, setRegPush]    = useState(false);
  const [syncing, setSyncing]            = useState(false);

  /**
   * What the switch shows has to be what is true, not what was last tapped.
   *
   * The stored flag alone was wrong in both directions: it is absent for anyone
   * who has never tapped this row, so the switch read OFF while the hook had
   * registered the device on launch; and it survives the person revoking the OS
   * permission — from the App permissions row two sections below this one — so a
   * stored 'true' read ON after Android and iOS had already stopped delivering.
   *
   * So: an explicit 'false' wins, and otherwise the OS is asked. On focus rather
   * than on mount because this screen is usually still mounted behind the system
   * settings the person just changed.
   */
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    (async () => {
      try {
        if (await AsyncStorage.getItem(PUSH_ENABLED_KEY) === 'false') {
          if (!cancelled) setPushEnabled(false);
          return;
        }
        const { status } = await Notifications.getPermissionsAsync();
        if (!cancelled) setPushEnabled(status === 'granted');
      } catch {
        // A permission read that fails is not a reason to move the switch.
      }
    })();
    return () => { cancelled = true; };
  }, []));

  // Load prefs from server
  const { data: prefsData, isLoading } = useQuery<NotifPrefsResponse>({
    queryKey: ['notif-prefs'],
    queryFn:  notificationsApi.getPrefs,
  });

  const savePrefs = useMutation({
    mutationFn: (body: NotifPrefsResponse) => notificationsApi.setPrefs(body),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['notif-prefs'] }),
  });

  const currentPrefs = prefsData ?? { prefs: {}, quiet_start: '22:00', quiet_end: '07:00' };

  // Toggle a kind's push mode: on → 'mine_only', off → 'off'
  const toggleKind = (kind: NotifKind) => {
    const current = currentPrefs.prefs[kind] ?? 'mine_only';
    const next: PushMode = current === 'off' ? 'mine_only' : 'off';
    savePrefs.mutate({ ...currentPrefs, prefs: { ...currentPrefs.prefs, [kind]: next } });
  };

  const setMode = (kind: NotifKind, mode: PushMode) => {
    savePrefs.mutate({ ...currentPrefs, prefs: { ...currentPrefs.prefs, [kind]: mode } });
  };

  const setQuietStart = (v: string) => {
    savePrefs.mutate({ ...currentPrefs, quiet_start: v });
  };
  const setQuietEnd = (v: string) => {
    savePrefs.mutate({ ...currentPrefs, quiet_end: v });
  };

  const handlePushToggle = async (val: boolean) => {
    if (registeringPush) return;
    setRegPush(true);
    try {
      if (!val) {
        /**
         * Off has to reach the server, and the flag is written only once it has.
         *
         * This branch used to set the flag and return. Nothing read the flag and
         * nothing deleted the token, so `push_tokens` still held this device and
         * `expo_push_service` kept sending to it: the row said off and the phone
         * kept buzzing. Deleting the row is what "off" means — `usePushNotifications`
         * registers again on every launch, so a local flag alone could not have
         * held even if something had read it.
         */
        await notificationsApi.unregisterToken(getDeviceId());
        await AsyncStorage.setItem(PUSH_ENABLED_KEY, 'false');
        setPushEnabled(false);
        return;
      }

      const token = await registerPushToken();
      if (!token) {
        Alert.alert('Permission denied', 'Enable notifications in your device Settings.');
        return;
      }
      await notificationsApi.registerToken(Platform.OS, token, getDeviceId());
      await AsyncStorage.setItem(PUSH_ENABLED_KEY, 'true');
      setPushEnabled(true);
    } catch (e: unknown) {
      // Neither the flag nor the switch has moved, because the server did not.
      // `friendlyMessage` is the sentence api/client.ts wrote for this failure;
      // `message` behind it is the only clue when the throw came from the SDK
      // rather than from a request.
      const detail =
        (e as { friendlyMessage?: string } | null)?.friendlyMessage
        ?? (e instanceof Error ? e.message : undefined);
      if (val) {
        Alert.alert('Could not turn notifications on', detail ?? 'Try again.');
      } else {
        Alert.alert(
          'Still turned on',
          `${detail ?? 'Could not reach the server.'}`
          + ' This device is still registered, so notifications will keep'
          + ' arriving. Try again once you are back online.',
        );
      }
    } finally {
      setRegPush(false);
    }
  };

  const handleSyncNow = async () => {
    const count = getQueueCount();
    if (count === 0) {
      Alert.alert('All synced', 'No offline changes pending.');
      return;
    }
    setSyncing(true);
    try {
      await flushQueue();
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
      Alert.alert('Synced', `${count} change${count === 1 ? '' : 's'} synced.`);
    } catch {
      Alert.alert('Sync failed', 'Check your connection and try again.');
    } finally {
      setSyncing(false);
    }
  };

  const confirmLogout = () => Alert.alert(
    'Sign out',
    'Changes will be saved. You\'ll need to sign in again.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: logout },
    ]
  );

  /**
   * Signing out everywhere is the answer to a lost or stolen phone, and it is
   * the reason a "Remember me" token can safely last a year — so it belongs in
   * front of the user, not buried in a support request.
   *
   * Two things this confirmation says out loud, because both surprise people:
   * it signs THIS device out as well (that is the point, not a side effect),
   * and it reaches every other device the person is signed in on.
   */
  const confirmSignOutEverywhere = () => Alert.alert(
    'Sign out everywhere?',
    'Every device signed in with this account will be signed out, including '
    + 'this one. Use this if a phone has been lost or stolen. Unsent changes '
    + 'are sent first.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out everywhere',
        style: 'destructive',
        onPress: async () => {
          // Send what is queued BEFORE the credentials go. After the token is
          // revoked the queue cannot be flushed by anyone, and the edits sit on
          // the device unreachable until that same person signs in again — on
          // a phone they may have just reported stolen.
          try { await flushQueue(); } catch { /* offline: the queue survives */ }
          try {
            await signOutEverywhere();
          } catch {
            Alert.alert(
              'Could not reach the server',
              'You have been signed out on this device, but other devices may '
              + 'still be signed in. Try again when you are back online.');
          }
        },
      },
    ]
  );

  const themes: Array<{ key: 'system' | 'light' | 'dark'; label: string; icon: string }> = [
    { key: 'system', label: 'System',  icon: 'phone-portrait-outline' },
    { key: 'light',  label: 'Light',   icon: 'sunny-outline' },
    { key: 'dark',   label: 'Dark',    icon: 'moon-outline' },
  ];

  const initials = user ? userInitials(user.name ?? user.full_name ?? '?') : '?';
  const bgColor  = user ? avatarColor(user.user_id) : '#04837A';

  return (
    <ScrollView style={[s.root, { backgroundColor: t.bg }]} contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
      {/* ── Header ── */}
      <View style={[s.header, { backgroundColor: t.surface, borderBottomColor: t.outline, paddingTop: insets.top + 8 }]}>
        <Text style={[s.title, { color: t.ink }]}>Settings</Text>
      </View>

      {/* ── Profile card ── */}
      <View style={[s.profileCard, { backgroundColor: t.surface, borderColor: t.outline }]}>
        <View style={[s.avatar, { backgroundColor: bgColor }]}>
          <Text style={s.avatarText}>{initials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.profileName, { color: t.ink }]}>{user?.name ?? user?.full_name ?? '—'}</Text>
          <Text style={[s.profileEmail, { color: t.ink3 }]}>{user?.email ?? ''}</Text>
          {user?.position ? <Text style={[s.profileJob, { color: t.ink3 }]}>{user.position}</Text> : null}
        </View>
        <View style={[s.roleBadge, { backgroundColor: t.primaryContainer }]}>
          <Text style={[s.roleText, { color: t.primary }]}>{user?.role}</Text>
        </View>
      </View>

      {/* ── Appearance ── */}
      <SectionHeader label="APPEARANCE" t={t} />
      <View style={[s.card, { backgroundColor: t.surface, borderColor: t.outline }]}>
        {themes.map(({ key, label, icon }, i) => (
          <Row
            key={key}
            t={t}
            first={i === 0}
            last={i === themes.length - 1}
            onPress={() => setPreference(key)}
            a11y={a11ySelected(label, preference === key)}
          >
            <Ionicons name={icon as any} size={17} color={preference === key ? t.primary : t.ink3} style={{ width: 24 }} accessibilityElementsHidden />
            <Text style={[s.rowLabel, { color: preference === key ? t.primary : t.ink, flex: 1 }]}>{label}</Text>
            {preference === key && <Ionicons name="checkmark" size={17} color={t.primary} accessibilityElementsHidden />}
          </Row>
        ))}
      </View>

      {/* ── Notifications ── */}
      <SectionHeader label="NOTIFICATIONS" t={t} />
      <View style={[s.card, { backgroundColor: t.surface, borderColor: t.outline }]}>
        {/* Push toggle */}
        <Row t={t} first last={false} onPress={() => {}}>
          <Ionicons name="notifications-outline" size={17} color={t.ink3} style={{ width: 24 }} />
          <Text style={[s.rowLabel, { color: t.ink, flex: 1 }]}>Push notifications</Text>
          {registeringPush
            ? <ActivityIndicator size="small" color={t.primary} />
            : <Switch
                value={pushEnabled}
                onValueChange={handlePushToggle}
                trackColor={{ false: t.outline, true: t.primary + 'aa' }}
                thumbColor={pushEnabled ? t.primary : t.ink4}
                accessibilityLabel="Push notifications"
              />}
        </Row>

        {isLoading ? (
          <View style={{ padding: 20, alignItems: 'center' }}>
            <ActivityIndicator color={t.primary} />
          </View>
        ) : (
          NOTIF_KINDS.map((item, i) => {
            const mode = currentPrefs.prefs[item.kind] ?? 'mine_only';
            const enabled = mode !== 'off';
            return (
              <Row
                key={item.kind}
                t={t}
                first={false}
                last={i === NOTIF_KINDS.length - 1}
                onPress={() => toggleKind(item.kind)}
                a11y={a11yToggle(`${item.label}. ${item.desc}`, enabled)}
              >
                <View style={{ flex: 1, gap: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[s.rowLabel, { color: t.ink }]}>{item.label}</Text>
                    <Text style={[s.rowHindi, { color: t.ink4 }]}>{item.hindi}</Text>
                  </View>
                  <Text style={[s.rowSub, { color: t.ink3 }]}>{item.desc}</Text>
                </View>
                {/* The Row above already announces this kind and its state, so
                    the switch itself must not be a second stop saying the same
                    thing with no name of its own. */}
                <Switch
                  value={enabled}
                  onValueChange={() => toggleKind(item.kind)}
                  trackColor={{ false: t.outline, true: t.primary + 'aa' }}
                  thumbColor={enabled ? t.primary : t.ink4}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                />
              </Row>
            );
          })
        )}
      </View>

      {/* ── Quiet hours ── */}
      <SectionHeader label="QUIET HOURS" t={t} desc="No push notifications during these hours (IST)" />
      <View style={[s.card, { backgroundColor: t.surface, borderColor: t.outline }]}>
        <Row t={t} first last={false} onPress={() => {}}>
          <Ionicons name="moon-outline" size={17} color={t.ink3} style={{ width: 24 }} />
          <Text style={[s.rowLabel, { color: t.ink, flex: 1 }]}>Do not disturb from</Text>
          <TimeWheel
            value={currentPrefs.quiet_start}
            options={QUIET_HOURS}
            onChange={setQuietStart}
            t={t}
          />
        </Row>
        <Row t={t} first={false} last onPress={() => {}}>
          <Ionicons name="sunny-outline" size={17} color={t.ink3} style={{ width: 24 }} />
          <Text style={[s.rowLabel, { color: t.ink, flex: 1 }]}>Until</Text>
          <TimeWheel
            value={currentPrefs.quiet_end}
            options={QUIET_HOURS}
            onChange={setQuietEnd}
            t={t}
          />
        </Row>
      </View>

      {/* ── Sync ── */}
      <SectionHeader label="SYNC · सिंक" t={t} desc="Replay offline changes" />
      <View style={[s.card, { backgroundColor: t.surface, borderColor: t.outline }]}>
        <Row t={t} first last onPress={handleSyncNow} a11y={a11yButton('Sync now', 'Replay changes made while offline')}>
          <Ionicons name="sync-outline" size={17} color={t.ink3} style={{ width: 24 }} accessibilityElementsHidden />
          <Text style={[s.rowLabel, { color: t.ink, flex: 1 }]}>Sync now</Text>
          {syncing
            ? <ActivityIndicator size="small" color={t.primary} />
            : <Ionicons name="chevron-forward" size={14} color={t.ink4} />}
        </Row>
      </View>

      {/* ── Permissions ── */}
      <SectionHeader label="PERMISSIONS · अनुमतियाँ" t={t} />
      <View style={[s.card, { backgroundColor: t.surface, borderColor: t.outline }]}>
        <Row
          t={t}
          first
          last
          onPress={() => Linking.openSettings()}
          a11y={a11yButton('App permissions', 'Opens the system settings for Kartavaya')}
        >
          <Ionicons name="shield-checkmark-outline" size={17} color={t.ink3} style={{ width: 24 }} accessibilityElementsHidden />
          <Text style={[s.rowLabel, { color: t.ink, flex: 1 }]}>App permissions</Text>
          <Ionicons name="open-outline" size={14} color={t.ink4} accessibilityElementsHidden />
        </Row>
      </View>

      {/* ── Account ── */}
      <SectionHeader label="ACCOUNT" t={t} />
      <View style={[s.card, { backgroundColor: t.surface, borderColor: t.outline }]}>
        <Row t={t} first last={false} onPress={confirmLogout} a11y={a11yButton('Sign out', 'Signs you out on this device only')}>
          <Ionicons name="log-out-outline" size={17} color={t.error} style={{ width: 24 }} accessibilityElementsHidden />
          <Text style={[s.rowLabel, { color: t.error, flex: 1 }]}>Sign out</Text>
          <Ionicons name="chevron-forward" size={14} color={t.error} accessibilityElementsHidden />
        </Row>
        <Row
          t={t}
          first={false}
          last
          onPress={confirmSignOutEverywhere}
          a11y={a11yButton('Sign out everywhere',
            'Signs you out on every device, including this one')}
        >
          <Ionicons name="phone-portrait-outline" size={17} color={t.error} style={{ width: 24 }} accessibilityElementsHidden />
          <View style={{ flex: 1 }}>
            <Text style={[s.rowLabel, { color: t.error }]}>Sign out everywhere</Text>
            <Text style={[s.rowSub, { color: t.ink3 }]}>
              All devices, including this one
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={14} color={t.error} accessibilityElementsHidden />
        </Row>
      </View>

      {crash && (
        <View>
          <SectionHeader
            label="LAST CRASH"
            t={t}
            desc="The app closed unexpectedly. Send this to support, then dismiss it."
          />
          <View style={[s.crashBox, { backgroundColor: t.surface, borderColor: t.outline }]}>
            <Text style={[s.crashMeta, { color: t.ink4 }]}>
              {crash.at} · {crash.origin}
            </Text>
            {/* Selectable so it can be copied out of a phone in the field —
                which is the entire point of persisting it. */}
            <Text style={[s.crashText, { color: t.ink2 }]} selectable>
              {crash.message}
              {crash.stack ? `

${crash.stack}` : ''}
            </Text>
          </View>
          <View style={[s.card, { backgroundColor: t.surface, borderColor: t.outline }]}>
            <Row
              t={t} first last
              onPress={() => { clearLastCrash(); setCrash(null); }}
              a11y={a11yButton('Dismiss crash report')}
            >
              <Text style={[s.rowLabel, { color: t.ink2 }]}>Dismiss</Text>
            </Row>
          </View>
        </View>
      )}

      <Text style={[s.version, { color: t.ink4 }]}>Kartavaya v2.0 · Aekam Inc</Text>
    </ScrollView>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────
/**
 * Two of these labels are bilingual in a single string — "SYNC · सिंक" and
 * "PERMISSIONS · अनुमतियाँ" — and the style applied to them was
 * `{ fontWeight: '800', letterSpacing: 1.5 }` with no family.
 *
 * That is wrong for Devanagari twice over. `letterSpacing` forces tracking
 * between glyphs that are supposed to JOIN: Devanagari conjuncts and the
 * connecting shirorekha come apart, which is the script equivalent of spacing
 * out the letters inside an English word. And a weight of 800 has no Tiro to
 * apply to, so the Hindi half renders in a different face and weight from
 * nothing the designer chose.
 *
 * Splitting on the separator lets each script keep its own typography: the Latin
 * run stays an uppercase tracked label, the Devanagari run gets the face that
 * has the glyphs, no tracking and no synthetic weight.
 */
function SectionHeader({ label, t, desc }: { label: string; t: any; desc?: string }) {
  const [latin, indic] = label.split('·').map(part => part.trim());
  return (
    <View style={s.sectionHead}>
      <View style={s.sectionLabelRow}>
        <Text style={[s.sectionLabel, { color: t.ink3 }]}>{latin}</Text>
        {indic ? (
          <Text style={[s.sectionLabelHi, { color: t.ink4 }]}>{indic}</Text>
        ) : null}
      </View>
      {desc && <Text style={[s.sectionDesc, { color: t.ink4 }]}>{desc}</Text>}
    </View>
  );
}

/**
 * `a11y` carries the props from the factories in `components/a11y.ts`. The row
 * is the pressable, so the label and any selected/checked state have to land
 * HERE — putting them on the children inside would name an element the user
 * never focuses.
 */
function Row({ t, first, last, children, onPress, a11y }: {
  t: any; first: boolean; last: boolean;
  children: React.ReactNode; onPress: () => void;
  a11y?: Record<string, unknown>;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        s.row,
        !first && { borderTopWidth: 1, borderTopColor: t.outlineVar },
        first && { borderTopLeftRadius: 14, borderTopRightRadius: 14 },
        last  && { borderBottomLeftRadius: 14, borderBottomRightRadius: 14 },
      ]}
      {...(a11y ?? {})}
    >
      {children}
    </TouchableOpacity>
  );
}

function TimeWheel({ value, options, onChange, t }: {
  value: string; options: string[];
  onChange: (v: string) => void; t: any;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        style={[s.timeChip, { backgroundColor: t.primaryContainer, borderColor: t.primary + '66' }]}
        accessible
        accessibilityRole="button"
        accessibilityLabel={value}
        accessibilityHint="Choose a time"
        accessibilityState={{ expanded: open }}
      >
        <Text style={[s.timeChipText, { color: t.primary }]}>{value}</Text>
        <Ionicons name="chevron-down" size={12} color={t.primary} accessibilityElementsHidden />
      </TouchableOpacity>
      {open && (
        <View style={[s.timeDropdown, { backgroundColor: t.surface, borderColor: t.outline, shadowColor: '#000' }]}>
          <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled showsVerticalScrollIndicator={false}>
            {options.map(o => (
              <TouchableOpacity
                key={o}
                style={[s.timeOption, o === value && { backgroundColor: t.primaryContainer }]}
                onPress={() => { onChange(o); setOpen(false); }}
                {...a11ySelected(o, o === value)}
              >
                <Text style={[s.timeOptionText, { color: o === value ? t.primary : t.ink }]}>{o}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:         { flex: 1 },
  header:       { paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1 },
  title:        { fontSize: 26, fontWeight: '900' },
  profileCard:  { flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: 16, marginTop: 20, borderRadius: 16, padding: 16, borderWidth: 1 },
  avatar:       { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarText:   { color: '#fff', fontSize: 17, fontWeight: '900' },
  profileName:  { fontSize: 15, fontWeight: '800' },
  profileEmail: { fontSize: 11, marginTop: 2 },
  profileJob:   { fontSize: 11, marginTop: 1 },
  roleBadge:    { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  roleText:     { fontSize: 10, fontWeight: '800', textTransform: 'capitalize' },
  sectionHead:  { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 6, gap: 2 },
  sectionLabelRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  sectionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  // No letterSpacing and no fontWeight — see SectionHeader.
  sectionLabelHi: { fontSize: 11, ...hindi() },
  sectionDesc:  { fontSize: 11 },
  card:         { marginHorizontal: 16, borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  row:          { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 13 },
  rowLabel:     { fontSize: 14, fontWeight: '600' },
  rowHindi:     { fontSize: 11, ...hindi() },
  rowSub:       { fontSize: 11 },
  timeChip:     { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99, borderWidth: 1 },
  timeChipText: { fontSize: 13, fontWeight: '700' },
  timeDropdown: { position: 'absolute', right: 0, top: 38, zIndex: 999, borderRadius: 12, borderWidth: 1, width: 90, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 8 },
  timeOption:   { paddingVertical: 9, paddingHorizontal: 12 },
  timeOptionText:{ fontSize: 13, fontWeight: '600', textAlign: 'center' },
  version:      { fontSize: 10, textAlign: 'center', marginTop: 32, letterSpacing: 1 },
  crashBox:     { marginHorizontal: 20, marginBottom: 8, padding: 12, borderRadius: 10, borderWidth: 1, gap: 6 },
  crashMeta:    { fontSize: 10, letterSpacing: 0.5 },
  crashText:    { fontSize: 11, lineHeight: 16 },
});
