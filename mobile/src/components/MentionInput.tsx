/**
 * MentionInput — the composer's text field, with an `@` picker over the
 * directory.
 *
 * This is the FIELD and its suggestion list, not the whole composer. ChatScreen
 * keeps the send button, the reply bar, the KeyboardAvoidingView and the
 * padding; this owns the one thing they cannot: a caret position. There is no
 * `onSelectionChange` on the composer today, and without a caret there is no
 * `@`-token and no picker — which is the whole reason this component exists.
 *
 * ── A phone has no arrow keys ────────────────────────────────────────────────
 *
 * The web picker is driven by ArrowUp / ArrowDown / Enter / Escape and rendered
 * at measured caret coordinates. None of that exists here. The list is a tap
 * target stack anchored above the field, above the keyboard, and every row is at
 * least `MIN_TOUCH` tall. Nothing is "selected" until it is tapped, so there is
 * no active-row state to announce and no Enter to intercept.
 *
 * ── Insertion writes the FULL display name, and that is not cosmetic ─────────
 *
 * `@` + `full_name` + one space. Never an id, never a `<@u_ab12>` sigil, never
 * the first token. Three separate readers parse that literal form: the parser in
 * `lib/richText.ts`, the server-side resolver that writes `samvada_mentions` and
 * the push notification, and `GET /search`, which runs over `content`. A handle
 * or a sigil produces a message that looks like it mentions somebody, notifies
 * nobody, and cannot be found by searching the name — the exact inserter/parser
 * disagreement the web's `renderMentions.test.jsx` exists for. The arithmetic
 * lives in `lib/mentionText.ts` so it can be tested without a renderer.
 *
 * ── The picker offers only who the SERVER would resolve ─────────────────────
 *
 * The resolver's universe is narrower than the org: `_readable_by`
 * (`services/samvaad_mentions.py:287`) returns CHANNEL MEMBERS ONLY for a
 * `private` channel and for a `dm`, and unions the org in only for `public` —
 * deliberately, because a mention notification quotes the message body, so
 * resolving somebody who cannot open the channel would mail them its contents.
 *
 * Sourcing the picker from the org anyway produced the worst failure this
 * feature can have. Pick a colleague who is not a member: the composer inserts
 * the correct literal `@Full Name `, the message posts, the resolver finds no
 * candidate, and there is no mention row, no notification, no push and no
 * badge. NOTHING TELLS THE SENDER — not even the local highlight, whose
 * vocabulary is built from the senders in the loaded pages, so the name is not
 * so much as bolded. They believe they reached someone they did not.
 *
 * THE NARROWING IS THE SERVER'S NOW. `GET /directory` takes a `channel_id` and
 * scopes the candidate set exactly the way `_readable_by` does, then runs the
 * search and the LIMIT inside it.
 *
 * This component used to fetch an org-wide page and filter it against the
 * channel's member ids, which closed the ordinary case and could not close two
 * others. A page ordered alphabetically over a 200-person org can be filled by
 * non-members while the one member being typed sorts past the cut: nothing
 * survives the filter, and the picker then says the restriction emptied it —
 * the same silence, reached from the other side. And a member whose `full_name`
 * is NULL was dropped here as unrenderable while the resolver, which coalesces
 * to `name` then `email`, matched them happily. Both are answered where the
 * rows are chosen, because a local filter can only ever discard rows; it can
 * never recover one the server's LIMIT has already cut.
 *
 * What is left on this side is `channelId`, which says WHICH universe, and
 * `restricted`, which says only whether an empty answer is worth a sentence.
 *
 * ── Why the list is a plain View ─────────────────────────────────────────────
 *
 * Six rows do not need virtualisation, and a nested VirtualizedList inside
 * ChatScreen's FlatList logs a warning and mis-measures. There are also no file
 * attachments in this composer and no upload control: that is a scope decision,
 * not an omission.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  type StyleProp, type TextStyle, type NativeSyntheticEvent, type TextInputSelectionChangeEventData,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { mentionTokenAt, insertMention } from '../lib/mentionText';
import { messagesApi, isUuid, type DirectoryUser } from '../api/messages';
import { useTheme } from '../theme/ThemeProvider';
import { avatarColor, userInitials } from '../theme/tokens';
import { MIN_TOUCH } from './a11y';

export interface MentionInputProps {
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  /** Forwarded to the INNER TextInput. ChatScreen focuses it when a reply target
   *  is set, so a wrapper here would make "Reply in thread" a silent no-op. */
  inputRef?: React.RefObject<TextInput>;
  /** Fires `true` on the first keystroke of a non-empty draft and `false` when
   *  the draft empties, the field blurs, or this unmounts. ChatScreen forwards
   *  it to `useTypingPing`, which rides the next scheduled `/live` poll rather
   *  than issuing a request of its own. */
  onTypingChange?: (typing: boolean) => void;
  /** Driven by `/me.can_post`. Renders a sentence, not a greyed-out field. */
  locked?: boolean;
  lockedLabel?: string;
  /** Lands on the inner TextInput. The wrapper carries the row's flex, so pass
   *  appearance here and leave the sizing of the composer row to the parent. */
  style?: StyleProp<TextStyle>;
  maxLength?: number;
  /** Max rows DISPLAYED in the picker, and — now that the server scopes before
   *  it limits — the size of the page we ask for. Empty query is allowed: `@`
   *  alone lists people. */
  suggestionLimit?: number;
  /**
   * The channel whose resolver universe the picker must match.
   *
   * Goes to `GET /directory` as `channel_id`, which is the whole of what makes
   * the offered set the resolvable set. It arrives from a route param, so it
   * must be a uuid — `messagesApi.directory` throws on anything else rather
   * than quietly asking for the org — and the query below stays disabled when
   * it is not one.
   *
   * `null` asks for the unscoped org-wide directory. Nothing in this app passes
   * that: every composer sits in a channel, and a composer that did not could
   * not have its offers checked against any resolver at all.
   */
  channelId?: string | null;
  /**
   * Whether this channel's resolver universe is members-only (`private`, `dm`).
   *
   * It no longer chooses the candidate set — the server does — and survives for
   * one job: deciding whether an EMPTY picker is worth RESTRICTED_NOTE. In a
   * members-only room "nobody here is called that" is a rule the reader cannot
   * otherwise see; in a public one it is an ordinary failed search and a
   * permanent footnote above the keyboard would be chrome on every keystroke.
   *
   * PASS TRUE WHILE THE CHANNEL'S TYPE IS UNKNOWN. The two wrong answers are not
   * symmetric: a note shown for a beat in a public channel is a sentence nobody
   * needed, while a note withheld in a private one is somebody typing the name
   * by hand and believing it landed.
   */
  restricted?: boolean;
}

/**
 * The token is debounced before it reaches the query key, not after.
 *
 * The query key carries `q`, so it mints a cache entry per distinct one, and
 * keying on every keystroke would leave one entry per character of every name
 * anybody ever half-typed. 200ms is under the threshold where the list feels
 * like it lags the finger and above the rate at which a thumb types.
 */
const QUERY_DEBOUNCE = 200;

const DEFAULT_LOCKED = 'You have read-only access to Sanvaad.';

/**
 * Shown INSTEAD of the list when the restriction is what emptied it.
 *
 * "conversation" and not "channel", because the restriction bites hardest in a
 * DM, where the only resolvable person is the one you are talking to.
 */
const RESTRICTED_NOTE = 'Only people in this conversation can be mentioned.';

export default function MentionInput({
  value,
  onChangeText,
  placeholder,
  inputRef,
  onTypingChange,
  locked = false,
  lockedLabel = DEFAULT_LOCKED,
  style,
  maxLength = 4000,
  suggestionLimit = 6,
  channelId = null,
  restricted = false,
}: MentionInputProps) {
  const { t } = useTheme();

  const ownRef = useRef<TextInput>(null);
  const ref = inputRef ?? ownRef;

  const [sel, setSel] = useState({ start: 0, end: 0 });

  /**
   * The caret to force for exactly one render, after an insertion.
   *
   * Replacing a TextInput's `value` puts the caret at the END on both platforms,
   * so mentioning somebody in the middle of a half-written sentence would throw
   * the cursor to the tail and the rest of the sentence would be typed after it.
   * Held for one render and then released — a permanently controlled `selection`
   * makes the field impossible to tap into.
   */
  const [pendingCaret, setPendingCaret] = useState<number | null>(null);
  useEffect(() => {
    if (pendingCaret === null) return undefined;
    const id = setTimeout(() => setPendingCaret(null), 0);
    return () => clearTimeout(id);
  }, [pendingCaret]);

  /* ── The typing flag ─────────────────────────────────────────────────────── */

  const typingOn = useRef(false);
  const onTypingRef = useRef(onTypingChange);
  useEffect(() => { onTypingRef.current = onTypingChange; }, [onTypingChange]);

  const signalTyping = useCallback((on: boolean) => {
    if (typingOn.current === on) return;
    typingOn.current = on;
    onTypingRef.current?.(on);
  }, []);

  // Leaving the channel with a half-typed draft must not leave your dots
  // animating in it for the eight seconds the server's window allows.
  useEffect(() => () => {
    if (typingOn.current) onTypingRef.current?.(false);
  }, []);

  /**
   * The parent can empty the draft WITHOUT going through `onChangeText`, and it
   * does: sending clears the box directly so a slow network cannot invite a
   * double-send. The flag has to follow that, or `typingOn` stays latched at
   * true, the next keystroke reports nothing because it is reporting the same
   * value, and the dots never come back for the rest of the session. Reporting
   * false twice costs nothing — it is a flag on the next poll, not a request.
   */
  useEffect(() => {
    if (!value.trim() && typingOn.current) signalTyping(false);
  }, [value, signalTyping]);

  /* ── The token ───────────────────────────────────────────────────────────── */

  const handleChangeText = useCallback((next: string) => {
    /**
     * `onChangeText` fires BEFORE `onSelectionChange`, so the stored selection is
     * one edit stale at the moment the token is computed. The caret is therefore
     * projected from the length delta — exact for an insert, a delete and a
     * paste at the caret, and irrelevant for a range replacement, which yields
     * no token anyway. `onSelectionChange` overwrites it with the truth an
     * instant later.
     */
    const caret = Math.max(0, Math.min(next.length, sel.start + (next.length - value.length)));
    setSel({ start: caret, end: caret });
    signalTyping(!!next.trim());
    onChangeText(next);
  }, [onChangeText, sel.start, value.length, signalTyping]);

  const handleSelectionChange = useCallback(
    (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      setSel(e.nativeEvent.selection);
    },
    [],
  );

  const handleBlur = useCallback(() => { signalTyping(false); }, [signalTyping]);

  const tok = useMemo(
    () => (locked ? null : mentionTokenAt(value, sel.start, sel.end)),
    [locked, value, sel.start, sel.end],
  );
  const tokQuery = tok ? tok.query : null;

  const [debouncedQuery, setDebouncedQuery] = useState<string | null>(null);
  useEffect(() => {
    if (tokQuery === null) { setDebouncedQuery(null); return undefined; }
    const id = setTimeout(() => setDebouncedQuery(tokQuery), QUERY_DEBOUNCE);
    return () => clearTimeout(id);
  }, [tokQuery]);

  /**
   * A channel id that is not a uuid is a 404 on the server and a throw in
   * `messagesApi.directory` — both deliberate, because the only other thing
   * either could do is hand back the whole org for a channel that asked to be
   * scoped. The picker therefore stays SHUT rather than falling back to a query
   * that can only fail or only mislead. `null` is not this case: it is a caller
   * that never asked for a scope.
   */
  const scopeUsable = channelId == null || isUuid(channelId);

  /**
   * Identity only, caller excluded, and never persisted — `offline/queryClient`
   * drops anything keyed `['messaging','directory',…]` from MMKV, because a key
   * that carries a debounced query string would otherwise write one entry per
   * keystroke to disk and hold it for two hours. That exclusion tests only the
   * first two segments of the key, so everything after them rides along safely.
   *
   * THE CHANNEL IS IN THE KEY, ahead of the query string. The same `q` names a
   * different set of people in two different rooms now that the server scopes,
   * and a shared entry would hand a private channel the answer cached for a
   * public one — which is the org, and precisely the set that must not be
   * offered there. The limit is in the key for the older version of the same
   * reason: it is a page size, and two callers asking for different amounts of
   * the same list do not have the same answer.
   */
  const directory = useQuery({
    queryKey: ['messaging', 'directory', channelId ?? '', debouncedQuery ?? '', suggestionLimit],
    queryFn: () => messagesApi.directory(debouncedQuery ?? '', suggestionLimit, channelId),
    enabled: debouncedQuery !== null && !locked && scopeUsable,
    staleTime: 5 * 60_000,
  });

  /**
   * One guard, and it is a shape guard rather than a policy.
   *
   * The server has already scoped, searched, ordered and limited; there is
   * nothing left here that could narrow the set correctly. What remains is that
   * a candidate with no display string at all cannot be inserted —
   * `insertMention` refuses a blank name, because `@ ` mentions nobody — and
   * drawing one would put a nameless tappable row in the list.
   *
   * SCOPED, THIS NOW WITHHOLDS NOBODY THE RESOLVER WOULD MATCH, which is the
   * point of it changing: `full_name` comes back as
   * `COALESCE(full_name, name, email)`, so the colleague whose `full_name` is
   * NULL — dropped here for as long as this picker has existed, while the
   * server resolved them without difficulty — is offered like anybody else.
   *
   * The slice is the `suggestionLimit` prop's own promise about how many rows
   * are DRAWN, kept independent of what the page happened to contain.
   */
  const rows = useMemo<DirectoryUser[]>(() => {
    // Annotated on the way out of the query, not inferred: `moduleResolution:
    // "node"` leaks react-query's `TData` unbound, so `directory.data` is `any`
    // and a mistyped field here would compile. ChatScreen states the same thing
    // at length over its own queries.
    const all: DirectoryUser[] = directory.data ?? [];
    return all.filter(u => !!u && !!u.full_name?.trim()).slice(0, suggestionLimit);
  }, [directory.data, suggestionLimit]);

  /**
   * Whether an empty picker is worth a sentence.
   *
   * `isSuccess` and not `rows.length === 0` alone: each debounced query mints a
   * new cache entry, so `data` is undefined while one is in flight and the note
   * would flash on nearly every keystroke, ahead of the rows it is meant to
   * stand in for. An ERROR is deliberately not this state either — a directory
   * that would not load is not a rule about who may be mentioned, and typing the
   * name by hand still resolves, because the resolver reads the literal text out
   * of `content` and knows nothing about this picker.
   */
  const note = restricted && directory.isSuccess && rows.length === 0;

  const open = tok !== null && !locked && (rows.length > 0 || note);

  const choose = useCallback((u: DirectoryUser) => {
    if (!tok || !u.full_name) return;
    const next = insertMention(value, tok, u.full_name);
    setSel({ start: next.caret, end: next.caret });
    setPendingCaret(next.caret);
    setDebouncedQuery(null);
    onChangeText(next.value);
    signalTyping(true);
    // The list is a sibling View, so tapping it does not blur the field on
    // either platform — but a picked name should leave the reader typing, not
    // hunting for the box.
    ref.current?.focus();
  }, [tok, value, onChangeText, signalTyping, ref]);

  /* ── Render ──────────────────────────────────────────────────────────────── */

  // A greyed-out field reads as broken; a sentence reads as a rule.
  if (locked) {
    return (
      <View
        style={[s.locked, { backgroundColor: t.surfaceLow, borderColor: t.outline }]}
        accessible
        accessibilityRole="text"
        accessibilityLabel={lockedLabel}
      >
        <Text style={[s.lockedText, { color: t.ink3 }]}>{lockedLabel}</Text>
      </View>
    );
  }

  return (
    <View style={s.wrap}>
      {open && (
        /* Anchored to the TOP edge of the field, growing upward: the composer is
           the last row above the keyboard, so a list opened below it would be
           entirely off-screen. No ancestor between here and the composer may set
           `overflow: 'hidden'`, or Android clips this. */
        <View
          style={[s.pop, { backgroundColor: t.surface, borderColor: t.outlineVar }]}
          /* A menu with no items is not a menu. When the restriction has emptied
             it this box is one sentence, and announcing it as a menu would have
             a screen reader offer navigation into nothing. */
          accessibilityRole={rows.length > 0 ? 'menu' : 'text'}
          accessibilityLabel={rows.length > 0 ? 'Mention someone' : RESTRICTED_NOTE}
        >
          {note && (
            /* Said, rather than left as an empty picker.
               THE CHOICE, since it costs a line above the keyboard: the note
               appears ONLY when a members-only room answered with nobody, never
               alongside rows. With even one name offered the list is its own
               answer, and a permanent footnote would sit there for most
               keystrokes in a private channel — a line of chrome on every
               letter. With nothing offered the picker would simply not appear,
               and that silence is exactly what lets somebody type the name by
               hand and believe it landed. One line converts it into a rule. */
            <Text style={[s.note, { color: t.ink3 }]}>{RESTRICTED_NOTE}</Text>
          )}

          {rows.map(u => (
            <Pressable
              key={u.user_id}
              onPress={() => choose(u)}
              accessibilityRole="menuitem"
              accessibilityLabel={`Mention ${u.full_name}`}
              style={({ pressed }) => [s.row, pressed && { backgroundColor: t.surface3 }]}
            >
              <View style={[s.avatar, { backgroundColor: avatarColor(u.user_id) }]}>
                <Text style={s.avatarText}>{userInitials(u.full_name ?? '')}</Text>
              </View>
              <Text style={[s.rowName, { color: t.ink }]} numberOfLines={1}>
                {u.full_name}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <TextInput
        ref={ref}
        style={[s.input, { backgroundColor: t.bg, borderColor: t.outline, color: t.ink }, style]}
        value={value}
        onChangeText={handleChangeText}
        onSelectionChange={handleSelectionChange}
        selection={pendingCaret === null ? undefined : { start: pendingCaret, end: pendingCaret }}
        onBlur={handleBlur}
        placeholder={placeholder ?? 'Message…'}
        placeholderTextColor={t.ink4}
        multiline
        maxLength={maxLength}
        accessibilityLabel="Message text"
        accessibilityHint="Type @ to mention someone"
      />
    </View>
  );
}

const s = StyleSheet.create({
  // The composer row's flex lives here, not on the field, so that the picker's
  // absolute anchor has a box the width of the field to attach to.
  wrap: { flex: 1, minWidth: 0 },

  input: {
    borderWidth: 1, borderRadius: 20,
    paddingHorizontal: 14, paddingTop: 9, paddingBottom: 9,
    fontSize: 14.5, maxHeight: 120,
  },

  pop: {
    position: 'absolute', left: 0, right: 0, bottom: '100%',
    marginBottom: 6, borderRadius: 12, borderWidth: 1, overflow: 'hidden',
    // Above the composer on both platforms. Android orders by elevation and
    // ignores zIndex on siblings that have none.
    zIndex: 20, elevation: 8,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, minHeight: MIN_TOUCH,
  },
  avatar: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFFFFF', fontSize: 10.5, fontWeight: '700' },
  rowName: { flex: 1, fontSize: 14 },

  // Not on `MIN_TOUCH`: nothing here is tappable, and padding a sentence out to
  // a touch target only makes it look like a row that refuses to respond.
  note: { paddingHorizontal: 12, paddingVertical: 10, fontSize: 12.5, lineHeight: 17 },

  locked: {
    borderWidth: 1, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 11,
  },
  lockedText: { fontSize: 13, lineHeight: 18 },
});
