import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Switch, ActivityIndicator, Platform, Alert, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDeviceId } from '../hooks/usePushNotifications';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../theme/ThemeProvider';
import { useAuth } from '../hooks/useAuth';
import { notificationsApi } from '../api/notifications';
import { avatarColor, userInitials } from '../theme/tokens';
import { flushQueue, getQueueCount } from '../offline/mutationQueue';
import type {
  NotifPrefsResponse, NotifKind, PushMode,
} from '../api/types';

// ── Push token registration helper ───────────────────────────────────────────
async function registerPushToken(): Promise<string | null> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return null;
  // projectId is required for production standalone builds
  const projectId =
    (Constants as any).expoConfig?.extra?.eas?.projectId ??
    (Constants as any).easConfig?.projectId;
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
  const { t, preference, setPreference } = useTheme();
  const { user, logout }                  = useAuth();
  const qc                                = useQueryClient();

  const [pushEnabled,  setPushEnabled]   = useState(false);
  const [registeringPush, setRegPush]    = useState(false);
  const [syncing, setSyncing]            = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('push_enabled').then(v => { if (v === 'true') setPushEnabled(true); });
  }, []);

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
    if (!val) {
      setPushEnabled(false);
      await AsyncStorage.setItem('push_enabled', 'false');
      return;
    }
    setRegPush(true);
    try {
      const token = await registerPushToken();
      if (!token) {
        Alert.alert('Permission denied', 'Enable notifications in your device Settings.');
        return;
      }
      const deviceId = getDeviceId();
      await notificationsApi.registerToken(Platform.OS, token, deviceId);
      setPushEnabled(true);
      await AsyncStorage.setItem('push_enabled', 'true');
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not enable notifications.');
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
      <View style={[s.header, { backgroundColor: t.surface, borderBottomColor: t.outline }]}>
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
          >
            <Ionicons name={icon as any} size={17} color={preference === key ? t.primary : t.ink3} style={{ width: 24 }} />
            <Text style={[s.rowLabel, { color: preference === key ? t.primary : t.ink, flex: 1 }]}>{label}</Text>
            {preference === key && <Ionicons name="checkmark" size={17} color={t.primary} />}
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
              <Row key={item.kind} t={t} first={false} last={i === NOTIF_KINDS.length - 1} onPress={() => toggleKind(item.kind)}>
                <View style={{ flex: 1, gap: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[s.rowLabel, { color: t.ink }]}>{item.label}</Text>
                    <Text style={[s.rowHindi, { color: t.ink4 }]}>{item.hindi}</Text>
                  </View>
                  <Text style={[s.rowSub, { color: t.ink3 }]}>{item.desc}</Text>
                </View>
                <Switch
                  value={enabled}
                  onValueChange={() => toggleKind(item.kind)}
                  trackColor={{ false: t.outline, true: t.primary + 'aa' }}
                  thumbColor={enabled ? t.primary : t.ink4}
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
        <Row t={t} first last onPress={handleSyncNow}>
          <Ionicons name="sync-outline" size={17} color={t.ink3} style={{ width: 24 }} />
          <Text style={[s.rowLabel, { color: t.ink, flex: 1 }]}>Sync now</Text>
          {syncing
            ? <ActivityIndicator size="small" color={t.primary} />
            : <Ionicons name="chevron-forward" size={14} color={t.ink4} />}
        </Row>
      </View>

      {/* ── Permissions ── */}
      <SectionHeader label="PERMISSIONS · अनुमतियाँ" t={t} />
      <View style={[s.card, { backgroundColor: t.surface, borderColor: t.outline }]}>
        <Row t={t} first last onPress={() => Linking.openSettings()}>
          <Ionicons name="shield-checkmark-outline" size={17} color={t.ink3} style={{ width: 24 }} />
          <Text style={[s.rowLabel, { color: t.ink, flex: 1 }]}>App permissions</Text>
          <Ionicons name="open-outline" size={14} color={t.ink4} />
        </Row>
      </View>

      {/* ── Account ── */}
      <SectionHeader label="ACCOUNT" t={t} />
      <View style={[s.card, { backgroundColor: t.surface, borderColor: t.outline }]}>
        <Row t={t} first last onPress={confirmLogout}>
          <Ionicons name="log-out-outline" size={17} color="#ef4444" style={{ width: 24 }} />
          <Text style={[s.rowLabel, { color: '#ef4444', flex: 1 }]}>Sign out</Text>
          <Ionicons name="chevron-forward" size={14} color="#ef4444" />
        </Row>
      </View>

      <Text style={[s.version, { color: t.ink4 }]}>Kartavaya v2.0 · Aekam Inc</Text>
    </ScrollView>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function SectionHeader({ label, t, desc }: { label: string; t: any; desc?: string }) {
  return (
    <View style={s.sectionHead}>
      <Text style={[s.sectionLabel, { color: t.ink3 }]}>{label}</Text>
      {desc && <Text style={[s.sectionDesc, { color: t.ink4 }]}>{desc}</Text>}
    </View>
  );
}

function Row({ t, first, last, children, onPress }: {
  t: any; first: boolean; last: boolean;
  children: React.ReactNode; onPress: () => void;
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
      >
        <Text style={[s.timeChipText, { color: t.primary }]}>{value}</Text>
        <Ionicons name="chevron-down" size={12} color={t.primary} />
      </TouchableOpacity>
      {open && (
        <View style={[s.timeDropdown, { backgroundColor: t.surface, borderColor: t.outline, shadowColor: '#000' }]}>
          <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled showsVerticalScrollIndicator={false}>
            {options.map(o => (
              <TouchableOpacity
                key={o}
                style={[s.timeOption, o === value && { backgroundColor: t.primaryContainer }]}
                onPress={() => { onChange(o); setOpen(false); }}
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
  header:       { paddingTop: Platform.OS === 'ios' ? 56 : 36, paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1 },
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
  sectionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  sectionDesc:  { fontSize: 11 },
  card:         { marginHorizontal: 16, borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  row:          { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 13 },
  rowLabel:     { fontSize: 14, fontWeight: '600' },
  rowHindi:     { fontSize: 11, fontWeight: '400' },
  rowSub:       { fontSize: 11 },
  timeChip:     { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99, borderWidth: 1 },
  timeChipText: { fontSize: 13, fontWeight: '700' },
  timeDropdown: { position: 'absolute', right: 0, top: 38, zIndex: 999, borderRadius: 12, borderWidth: 1, width: 90, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 8 },
  timeOption:   { paddingVertical: 9, paddingHorizontal: 12 },
  timeOptionText:{ fontSize: 13, fontWeight: '600', textAlign: 'center' },
  version:      { fontSize: 10, textAlign: 'center', marginTop: 32, letterSpacing: 1 },
});
