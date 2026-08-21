import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
// A namespace import, deliberately separate from the named one above.
//
// `react-native`'s `Clipboard` getter prints a deprecation warning the moment
// the property is READ, so a named import would fire it at module load on every
// launch, for a screen almost nobody opens. Reached through the namespace it is
// touched once, inside the handler, when somebody actually taps Copy. There is
// no non-deprecated alternative without adding `@react-native-clipboard/
// clipboard`, which is a native module and therefore a new dev build for
// everyone — a large bill for a warning line.
import * as RN from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../../theme/ThemeProvider';
import { hindi } from '../../theme/fonts';
import { a11yButton } from '../../components/a11y';
import { useOnline } from '../../hooks/useOnline';
import ScreenState from '../../components/ScreenState';
import { agoLabel } from '../../hooks/useQueueStatus';
import { withAlpha } from '../../theme/tokens';
import {
  getFailedMutations, discardFailedMutation, retryFailedMutation,
  canRetryFailed, flushQueue, friendlyFlushError,
} from '../../offline/mutationQueue';
import type { FailedMutation } from '../../api/types';
import type { RootStackParamList } from '../../nav/RootStack';
import {
  describeMutation, failureReason, exportText, formatWhen, clip,
  type ReasonCopy,
} from './describeFailure';

/**
 * Unsent changes — the dead letter, rendered.
 * ──────────────────────────────────────────
 *
 * `offline/mutationQueue.ts` stopped throwing away writes that can never
 * succeed; it moves them to a persisted store instead. That was necessary and
 * it was not sufficient. Until this screen existed the failure was as loud as a
 * seven-second banner in `App.tsx` and no louder, and afterwards the only copy
 * of what the person typed sat in MMKV that nothing read. For a PATCH that is
 * survivable — the record is still on screen and they can change it again. For a
 * CREATE it is not: the invoice, the deal, the task somebody typed on a site
 * with no signal was never created, and nothing anywhere remembered it was meant
 * to be.
 *
 * ── The three things this screen is for ──────────────────────────────────────
 *
 *   1. SAY WHAT IT WAS, in the words the person used. `describeFailure.ts` does
 *      the work; nothing here ever renders a URL, a method or an id.
 *   2. SAY WHY, per the three ways the queue gives up, and what to do about
 *      each. They need different actions, which is the whole reason they are
 *      three reasons and not one.
 *   3. GET IT OUT. Copy is available on every entry regardless of reason,
 *      including the ones that can be retried, because the retry might fail too
 *      and this is still the last copy.
 *
 * ── Why nothing here is destructive by accident ──────────────────────────────
 *
 * Discard is the only path that removes anything, it always confirms first, and
 * the confirmation names the entry rather than saying "this item". There is no
 * "discard all": the store has one (`clearFailedMutations`) and this screen
 * deliberately does not call it. A sweep control on a screen full of last copies
 * is one mis-tap away from being the bug this whole mechanism was built to fix.
 *
 * ── Why it re-reads on focus ─────────────────────────────────────────────────
 *
 * MMKV is not reactive and `flushQueue` runs from `App.tsx` on every reconnect,
 * so the store can change while this screen is mounted but not focused. Reading
 * in `useFocusEffect` means coming back from Settings shows what is actually
 * there rather than what was there when the screen was pushed.
 */

type Nav = NativeStackNavigationProp<RootStackParamList, 'Unsent'>;

/** What the reason looks like. Colour comes from the container pairs, which are
 *  defined in both themes — see the banner note in `App.tsx` for what happens
 *  when a warn colour is picked for light and shipped into dark. */
interface ReasonSkin {
  icon: keyof typeof Ionicons.glyphMap;
  bg:   string;
  fg:   string;
}

export default function UnsentScreen() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const online = useOnline();

  const [entries, setEntries] = useState<FailedMutation[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const reload = useCallback(() => {
    // Newest first. `recordFailure` appends, so the raw order is oldest-first,
    // and the one somebody is looking for is almost always the one they just
    // watched fail.
    setEntries([...getFailedMutations()].reverse());
  }, []);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  const onCopy = useCallback((entry: FailedMutation) => {
    const text = exportText(entry, canRetryFailed(entry));
    try {
      RN.Clipboard.setString(text);
      setNote('Copied. Paste it wherever you need it.');
    } catch {
      // Every field is also on screen and selectable, so a clipboard that is
      // unavailable costs a tap-and-hold rather than the content.
      setNote('Could not reach the clipboard — press and hold the details above to select them.');
    }
  }, []);

  const onRetry = useCallback(async (entry: FailedMutation) => {
    setBusyId(entry.item.id);
    setNote(null);
    try {
      const outcome = retryFailedMutation(entry.item.id);
      if (outcome === 'not-found') {
        setNote('That one is no longer here — it may have been retried on another screen.');
        reload();
        return;
      }
      if (outcome === 'expired-create') {
        // Refused by the store rather than by the button, which is the belt to
        // the screen's braces: both ask `canRetryFailed`, so this is only
        // reachable if an item crossed the six-day line while the screen sat
        // open. Saying so is better than a Retry that silently does nothing.
        setNote('That one has just passed the six-day limit and can no longer be sent. Copy it out and enter it again.');
        reload();
        return;
      }

      if (!online) {
        setNote('Back in the queue. It will go out as soon as you have a connection.');
        reload();
        return;
      }

      const result = await flushQueue();
      const mine = result.failed.find(f => f.item.id === entry.item.id);
      if (!mine) {
        setNote('Sent.');
      } else if (mine.permanent) {
        setNote(`Failed again: ${friendlyFlushError(mine.error)}`);
      } else {
        setNote('Still not getting through — it stays queued and will keep trying.');
      }
    } catch {
      setNote("Couldn't reach the server. It stays queued and will keep trying.");
    } finally {
      setBusyId(null);
      reload();
    }
  }, [online, reload]);

  const onDiscard = useCallback((entry: FailedMutation) => {
    const d = describeMutation(entry.item);
    Alert.alert(
      'Discard this for good?',
      `${d.title}\n\nThis is the last copy of it. Nothing has been sent to the server, `
      + 'and nothing on any screen will remember it. If you have not copied the '
      + 'details out yet, do that first.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            discardFailedMutation(entry.item.id);
            setNote('Discarded.');
            reload();
          },
        },
      ],
    );
  }, [reload]);

  return (
    <View style={[s.root, { backgroundColor: t.bg, paddingTop: insets.top }]}>
      <View style={s.header}>
        <Pressable onPress={() => nav.goBack()} hitSlop={10} {...a11yButton('Back')}>
          <Ionicons name="chevron-back" size={24} color={t.ink2} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[s.title, { color: t.ink }]} accessibilityRole="header">Unsent changes</Text>
          <Text style={[s.titleHi, { color: t.primaryText }]}>अप्रेषित</Text>
        </View>
      </View>

      {entries.length === 0 ? (
        /* The normal state, and it has to read like it. A person who opens this
           and finds it empty has learned something good — not that a screen
           failed to load. */
        <ScreenState
          status="empty"
          icon="checkmark-circle-outline"
          title="Nothing was lost"
          body={
            'Every change made on this phone has reached the server. If one ever '
            + "can't be sent, it waits here with everything you typed, and nothing "
            + 'is deleted until you say so.'
          }
        />
      ) : (
        <ScrollView
          contentContainerStyle={[s.listPad, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={[s.intro, { color: t.ink3 }]}>
            {entries.length === 1
              ? 'One change never reached the server.'
              : `${entries.length} changes never reached the server.`}
            {' '}Nothing here will be sent on its own — each one is waiting on you.
          </Text>

          {note && (
            <View
              style={[s.note, { backgroundColor: t.primaryContainer, borderColor: withAlpha(t.primary, 0.3) }]}
              accessibilityLiveRegion="polite"
            >
              <Text style={[s.noteText, { color: t.onPrimaryContainer }]}>{note}</Text>
            </View>
          )}

          {entries.map(entry => (
            <FailedCard
              key={entry.item.id}
              entry={entry}
              busy={busyId === entry.item.id}
              onCopy={() => onCopy(entry)}
              onRetry={() => onRetry(entry)}
              onDiscard={() => onDiscard(entry)}
            />
          ))}

          <Text style={[s.footer, { color: t.ink4 }]}>
            Kept on this phone only. Signing out does not clear them, and the app
            keeps the hundred most recent.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

// ── One entry ─────────────────────────────────────────────────────────────────

function FailedCard({ entry, busy, onCopy, onRetry, onDiscard }: {
  entry: FailedMutation;
  busy: boolean;
  onCopy: () => void;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const { t } = useTheme();

  const d = describeMutation(entry.item);
  const retryable = canRetryFailed(entry);
  const why: ReasonCopy = failureReason(entry, retryable);

  const skin: ReasonSkin =
    entry.reason === 'exhausted'
      ? { icon: 'refresh-circle-outline', bg: t.approvalBg, fg: t.onApprovalContainer }
      : entry.reason === 'expired'
        ? { icon: 'hourglass-outline', bg: t.errorBg, fg: t.onErrorContainer }
        : { icon: 'close-circle-outline', bg: t.errorBg, fg: t.onErrorContainer };

  // The raw error is worth showing only when it says something the reason copy
  // does not. `friendlyFlushError` passes EXPIRED_MESSAGE straight through, and
  // repeating it under a heading that already explains the ceiling is noise.
  const serverSaid = friendlyFlushError(entry.error);
  const showServerSaid = entry.reason !== 'expired' && !!serverSaid;

  const failedAgo = agoLabel(entry.failed_at);

  return (
    <View style={[s.card, { backgroundColor: t.surface, borderColor: t.outline }]}>
      <View style={s.cardHead}>
        <View style={[s.badge, { backgroundColor: skin.bg }]}>
          <Ionicons name={skin.icon} size={12} color={skin.fg} accessibilityElementsHidden />
          <Text style={[s.badgeText, { color: skin.fg }]}>{why.badge}</Text>
        </View>
        <Text style={[s.kind, { color: t.ink4 }]}>{d.kind}</Text>
      </View>

      <Text style={[s.cardTitle, { color: t.ink }]}>{d.title}</Text>
      <Text style={[s.cardMeta, { color: t.ink4 }]}>
        {d.action} {formatWhen(entry.item.created_at)}
        {failedAgo ? ` · gave up ${failedAgo} ago` : ''}
      </Text>

      {/* What they typed. Selectable so it can be lifted out by hand on a phone
          whose clipboard bridge is unavailable — the same reasoning as the crash
          box in Settings, and the same reason that box is selectable too. */}
      {d.fields.length > 0 ? (
        <View style={[s.fields, { borderColor: t.outlineVar }]}>
          {d.fields.map((f, i) => (
            <View key={`${f.label}-${i}`} style={s.fieldRow}>
              <Text style={[s.fieldLabel, { color: t.ink3 }]}>{f.label}</Text>
              <Text style={[s.fieldValue, { color: t.ink }]} selectable>{clip(f.value, 300)}</Text>
            </View>
          ))}
        </View>
      ) : (
        <View style={[s.fields, { borderColor: t.outlineVar }]}>
          <Text style={[s.fieldValue, { color: t.ink3 }]}>
            This one carried no details of its own — the action was the whole of it.
          </Text>
        </View>
      )}

      <Text style={[s.why, { color: t.ink2 }]}>{why.headline}</Text>
      <Text style={[s.whyBody, { color: t.ink3 }]}>{why.meaning}</Text>
      {showServerSaid && (
        <Text style={[s.serverSaid, { color: t.ink3 }]} selectable>
          The server said: {serverSaid}
        </Text>
      )}
      <Text style={[s.whatNow, { color: t.ink2 }]}>{why.whatNow}</Text>
      {why.retryCaveat && (
        <Text style={[s.caveat, { color: t.ink4 }]}>{why.retryCaveat}</Text>
      )}

      <View style={s.actions}>
        <Pressable
          onPress={onCopy}
          {...a11yButton(`Copy the details of ${d.title}`, 'Puts everything you entered on the clipboard')}
          style={[s.btn, { borderColor: t.outline }]}
        >
          <Ionicons name="copy-outline" size={14} color={t.ink2} accessibilityElementsHidden />
          <Text style={[s.btnText, { color: t.ink2 }]}>Copy</Text>
        </Pressable>

        {why.retryable && (
          <Pressable
            onPress={onRetry}
            disabled={busy}
            {...a11yButton(`Try sending ${d.title} again`)}
            style={[s.btn, { borderColor: t.primary, backgroundColor: busy ? t.surface2 : t.primary }]}
          >
            {busy
              ? <ActivityIndicator size="small" color={t.primaryText} />
              : (
                <>
                  <Ionicons name="refresh" size={14} color={t.onPrimary} accessibilityElementsHidden />
                  <Text style={[s.btnText, { color: t.onPrimary }]}>Try again</Text>
                </>
              )}
          </Pressable>
        )}

        <Pressable
          onPress={onDiscard}
          {...a11yButton(`Discard ${d.title}`, 'Asks you to confirm first — this is the last copy')}
          style={[s.btn, { borderColor: withAlpha(t.error, 0.4) }]}
        >
          <Ionicons name="trash-outline" size={14} color={t.error} accessibilityElementsHidden />
          <Text style={[s.btnText, { color: t.error }]}>Discard</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1 },
  header:  { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: 6, paddingBottom: 10 },
  title:   { fontSize: 24, fontWeight: '700', letterSpacing: -0.4 },
  // No fontWeight and no letterSpacing — Tiro ships one weight and RN tracks
  // after shaping, which splits the shirorekha. See theme/BiLabel.tsx.
  titleHi: { fontSize: 13, marginTop: 1, ...hindi() },

  listPad: { paddingHorizontal: 16, gap: 10 },
  intro:   { fontSize: 13, lineHeight: 19, marginTop: 2, marginBottom: 2 },

  note:     { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  noteText: { fontSize: 12.5, lineHeight: 18, fontWeight: '600' },

  card:      { borderWidth: 1, borderRadius: 14, padding: 14, gap: 6 },
  cardHead:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge:     { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
  kind:      { marginLeft: 'auto', fontSize: 11, fontWeight: '700' },

  cardTitle: { fontSize: 15, fontWeight: '700', lineHeight: 21 },
  cardMeta:  { fontSize: 11.5, lineHeight: 16 },

  fields:     { borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 8, marginVertical: 4, gap: 5 },
  fieldRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  fieldLabel: { fontSize: 11.5, fontWeight: '700', width: 96 },
  fieldValue: { flex: 1, fontSize: 12.5, lineHeight: 18 },

  why:        { fontSize: 13, fontWeight: '700', lineHeight: 19, marginTop: 2 },
  whyBody:    { fontSize: 12.5, lineHeight: 18 },
  serverSaid: { fontSize: 12.5, lineHeight: 18, fontStyle: 'italic' },
  whatNow:    { fontSize: 12.5, lineHeight: 18, fontWeight: '600', marginTop: 4 },
  caveat:     { fontSize: 11.5, lineHeight: 16 },

  actions: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, minHeight: 44, flexGrow: 1, flexBasis: 96,
  },
  btnText: { fontSize: 12.5, fontWeight: '800' },

  footer: { fontSize: 11, lineHeight: 16, marginTop: 6 },
});
