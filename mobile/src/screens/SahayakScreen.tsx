import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeProvider';
import { hindi } from '../theme/fonts';
import { withAlpha } from '../theme/tokens';
import { useOnline } from '../hooks/useOnline';
import Lotus from '../components/Lotus';
import Sheet from '../components/Sheet';
import Refresher from '../components/Refresher';
import RichText from '../components/RichText';
import ScreenState, { resolveScreenState } from '../components/ScreenState';
import { a11yButton } from '../components/a11y';
import { storage } from '../lib/storage';
import {
  sahayakApi, looksLikeFailure,
  type ChatMessageRow, type HubClient, type KbSource,
} from '../api/sahayak';

/**
 * Sahayak · सहायक — the assistant.
 *
 * Built from `docs/proposals/19-sahayak-final.html`, which is the layout the
 * owner approved: the welcome hero, the opener cards, the conversation, and the
 * lotus as the thinking state. What that document draws for a desktop and this
 * screen does not have is the conversations rail and the split sources panel —
 * both are a second column, and a phone has one.
 *
 * ── READ `api/sahayak.ts` BEFORE THIS FILE ──────────────────────────────────
 *
 * Two gaps are structural and are surfaced ON THIS SCREEN rather than hidden:
 *
 *  1. THERE IS NO ORG-LEVEL ASK ENDPOINT. The assistant is a per-client
 *     retrieval-augmented chatbot — `hub_chat.py`'s routes are all
 *     `/clients/{client_id}/chat/sessions…` and the retriever is scoped to one
 *     client's knowledge base. So a client is chosen first, and the screen says
 *     which knowledge base it is about to read. Defaulting silently to the first
 *     client would answer questions about Sanchay while the user was thinking
 *     about Navrang, which is the worst available outcome: a confident answer to
 *     a question nobody asked.
 *  2. EVERY QUESTION SPENDS CREDITS, charged before the model runs. Nothing here
 *     sends without a deliberate tap — THE OPENER CARDS FILL THE COMPOSER, THEY
 *     DO NOT SEND — and the cost of each answer is stated under it.
 *
 * Neither is a mock. Every byte on this screen comes from the real endpoints.
 *
 * ── The one thing that has NOT been verified ────────────────────────────────
 *
 * NOTHING ON THIS SCREEN HAS BEEN SEEN ON A DEVICE OR AN EMULATOR. It was
 * written on a Windows workstation with no Android image and no iOS host, and
 * `mobile/`'s test suite cannot render a `.tsx` file at all. The Devanagari is
 * the part that matters most: `सहायक` renders through `hindi()`, which is the
 * only face in the app with the glyphs (Tiro Devanagari Hindi, bundled by
 * `@expo-google-fonts/tiro-devanagari-hindi`, so it is in the binary and needs
 * no network), and `theme/__tests__/fonts.test.ts` proves the style object is
 * right — but a style object being right is not a shirorekha being intact.
 * See the report.
 */

/** MMKV. The chosen client survives a relaunch; the conversation does not. */
const CLIENT_KEY = 'sahayak_client_id';

/**
 * The openers.
 *
 * TWO, not the six `19-sahayak-final` lists — its own note says "six on a wide
 * screen · four on a laptop · two on a phone", and its stylesheet collapses the
 * grid to a single column below 560px. Two full-width cards is the phone case of
 * the same design.
 *
 * THEY ARE NOT THE PROPOSAL'S OPENERS, and the difference is a correctness one
 * rather than a taste one. The proposal asks "What's due this month? · Filing
 * deadlines ACROSS CLIENTS" — and there is no across-clients retriever behind
 * it, so that card would put a question to a single client's knowledge base and
 * present whatever came back as an answer about the whole practice. Both of
 * these are scoped to the one client the screen has actually selected.
 *
 * One English and one Devanagari, which is the proposal's own pattern: the
 * server detects the question's language per message (`detect_language(body.message)`,
 * so a conversation that opened in English does not outvote a Hindi question) and
 * the system prompt names the reply's language. Offering a Hindi opener is
 * therefore a real affordance and not decoration.
 */
const OPENERS: Array<{ prompt: string; hint: string; dev?: boolean }> = [
  {
    prompt: "What's due this month?",
    hint:   'Deadlines and filings for this client',
  },
  {
    prompt: 'इस क्लाइंट का कितना भुगतान बाकी है?',
    hint:   'Outstanding payments',
    dev:    true,
  },
];

/** The sentence `api/client.ts` already wrote onto the error. */
function friendly(e: unknown): string | undefined {
  const m = (e as { friendlyMessage?: unknown } | null | undefined)?.friendlyMessage;
  return typeof m === 'string' && m ? m : undefined;
}

/**
 * A message on the way to the server, or one that came back.
 *
 * The user's question is rendered optimistically — it is stored server-side in
 * the same transaction that charges for the answer, so it is real the instant
 * the request is accepted, and waiting for the round trip to show somebody their
 * own words back reads as the app having dropped them.
 *
 * `pending` marks the row the lotus is spinning under. It is not an error state
 * and it is not a queue: `useOfflineMutation` is deliberately NOT used here —
 * a question replayed on reconnect two hours later spends credits on a model
 * call nobody is waiting for, against a knowledge base that has moved on.
 */
interface Turn {
  key:      string;
  role:     'user' | 'assistant';
  content:  string;
  sources:  KbSource[];
  /** From `credits_charged`. Only on an assistant turn from THIS session. */
  credits?: number;
  model?:   string;
  failed?:  boolean;
}

export default function SahayakScreen() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const nav = useNavigation();
  const qc = useQueryClient();
  const online = useOnline();

  const [clientId, setClientId] = useState<string | null>(
    () => storage.getString(CLIENT_KEY) ?? null,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  /**
   * The turns rendered right now.
   *
   * Held in component state rather than in react-query, and that is not laziness
   * about caching. `GET /chat/sessions/{id}/messages` is the authority and is
   * refetched whenever a send fails, but the OPTIMISTIC user turn and the
   * per-answer `credits_charged` have no home in that response — the stored row
   * carries neither — so the rendered list is the two merged. Cache the merge
   * and the optimistic half outlives the request that produced it.
   */
  const [turns, setTurns] = useState<Turn[]>([]);
  const listRef = useRef<FlatList<Turn>>(null);

  // ── Clients ────────────────────────────────────────────────────────────────

  const clientsQuery = useQuery<HubClient[]>({
    queryKey: ['sahayak', 'clients'],
    queryFn: () => sahayakApi.clients(),
    staleTime: 5 * 60_000,
  });
  // Annotated on the way out, and NOT defaulted to `[]` in the destructuring —
  // `const { data = [] }` erases the difference between "the org has no clients"
  // and "the request failed", which is the false-empty defect three screens in
  // this app shipped. `hasData` below is computed from definedness.
  const clients: HubClient[] = clientsQuery.data ?? [];

  const client = useMemo(
    () => clients.find(c => c.id === clientId) ?? null,
    [clients, clientId],
  );

  /**
   * A stored client id that is no longer in the org is forgotten.
   *
   * Without this the header would read "Choose a client" while `clientId` held a
   * value, so the composer would be enabled and the first send would 404 on a
   * client the user cannot see. Only runs once the query has ANSWERED —
   * `clientsQuery.data !== undefined` — because an empty list during loading is
   * not evidence of anything.
   */
  useEffect(() => {
    if (clientsQuery.data === undefined || !clientId) return;
    if (!clients.some(c => c.id === clientId)) {
      storage.delete(CLIENT_KEY);
      setClientId(null);
    }
  }, [clientsQuery.data, clients, clientId]);

  const chooseClient = useCallback((id: string) => {
    storage.set(CLIENT_KEY, id);
    setClientId(id);
    // A new client is a new knowledge base. Carrying the conversation across
    // would leave answers about one firm sitting above questions about another,
    // and the session belongs to the old client server-side regardless.
    setSessionId(null);
    setTurns([]);
    setPickerOpen(false);
  }, []);

  // ── Asking ─────────────────────────────────────────────────────────────────

  /**
   * Send one question.
   *
   * The session is created LAZILY, on the first question, rather than when a
   * client is picked. Creating it on pick would leave an empty "New chat" in
   * `hub_chat_sessions` — and on the web's rail — every time somebody opened
   * this screen and changed their mind, which is most times.
   */
  const ask = useMutation({
    mutationFn: async (question: string) => {
      if (!clientId) throw new Error('No client selected');
      const sid = sessionId ?? (await sahayakApi.createSession(clientId)).id;
      const answer = await sahayakApi.send(sid, question);
      return { sid, answer };
    },
    onSuccess: ({ sid, answer }) => {
      setSessionId(sid);
      setTurns(prev => [
        ...prev,
        {
          key:     `a-${Date.now()}`,
          role:    'assistant',
          content: answer.message,
          sources: answer.sources,
          credits: answer.credits_charged,
          model:   answer.model,
          // THE FRIENDLY 200. When every provider fails, the endpoint refunds
          // the credits and answers 200 with an apology in the `message` field —
          // so a total failure arrives looking exactly like an answer. Marked
          // here so the row can say what it is instead of being read as the
          // assistant's considered reply.
          failed:  looksLikeFailure(answer),
        },
      ]);
      // The session list on the web shows a title derived from the first
      // question, so it is stale the moment this lands.
      qc.invalidateQueries({ queryKey: ['sahayak', 'sessions', clientId] });
    },
    onError: async (e: unknown) => {
      /**
       * Drop the optimistic question and hand the words back.
       *
       * AND THEN GO AND LOOK, because a timeout is not a failure. `apiClient` is
       * configured at 15 seconds and a RAG answer is an embedding call plus an
       * optional re-rank plus a completion; a slow one exceeds that while the
       * server carries on, stores the answer and keeps the charge. If a session
       * exists, its stored messages are the truth — so they are re-read, and a
       * question that actually succeeded reappears with its answer rather than
       * being lost along with the credits it cost.
       */
      setTurns(prev => prev.filter(x => !(x.role === 'user' && x.key.startsWith('u-pending'))));
      if (sessionId) {
        try {
          const stored = await sahayakApi.messages(sessionId);
          setTurns(rowsToTurns(stored));
        } catch { /* The alert below is the one that matters. */ }
      }
      Alert.alert(
        'Not answered',
        friendly(e) ?? 'Could not reach the assistant. Your question was not sent.',
      );
    },
  });

  const send = useCallback(() => {
    const question = draft.trim();
    if (!question || !clientId || ask.isPending) return;
    setDraft('');
    setTurns(prev => [
      ...prev,
      { key: `u-pending-${Date.now()}`, role: 'user', content: question, sources: [] },
    ]);
    ask.mutate(question);
  }, [draft, clientId, ask]);

  // Newest at the bottom, so the list follows the answer as it arrives. Not an
  // inverted list, unlike ChatScreen: this conversation is read from the top
  // (the hero is above the first question) and is short enough that it never
  // pages backwards.
  useEffect(() => {
    if (turns.length === 0) return;
    const id = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(id);
  }, [turns.length, ask.isPending]);

  // ── State ──────────────────────────────────────────────────────────────────

  const status = resolveScreenState({
    isLoading: clientsQuery.isLoading,
    isError:   clientsQuery.isError,
    error:     clientsQuery.error,
    online,
    // Definedness, not length: an org with no clients and a 500 must not render
    // the same screen.
    hasData:   clientsQuery.data !== undefined,
    // Never `empty` — an org with no Sahayak clients gets its own sentence below,
    // which can say what to do about it. The generic empty state cannot.
    isEmpty:   false,
  });

  const canAsk = !!clientId && draft.trim().length > 0 && !ask.isPending;

  const header = (
    <View style={[s.header, { paddingTop: insets.top + 6, backgroundColor: t.surface, borderBottomColor: t.outlineVar }]}>
      <Pressable onPress={() => nav.goBack()} hitSlop={10} {...a11yButton('Back')}>
        <Ionicons name="chevron-back" size={24} color={t.ink2} />
      </Pressable>

      <View style={{ flex: 1, minWidth: 0 }}>
        {/* TWO SIBLING <Text> NODES, NEVER ONE STRING AND NEVER NESTED.
            Nesting would let the Latin node's weight and tracking inherit onto
            the Devanagari: Tiro ships only a 400, so a '700' is synthetic bold
            on Android and a system-face fallback on iOS, and React Native
            applies tracking AFTER shaping, which breaks the shirorekha and pulls
            conjuncts apart. `theme/BiLabel.tsx` documents both at length. */}
        <View style={s.titleRow}>
          <Text style={[s.title, { color: t.ink }]} numberOfLines={1}>Sahayak</Text>
          <Text style={[s.titleHi, { color: t.primaryText }]} numberOfLines={1}>सहायक</Text>
        </View>
      </View>

      <Pressable
        onPress={() => setPickerOpen(true)}
        style={({ pressed }) => [
          s.clientChip,
          { backgroundColor: pressed ? t.surface3 : t.surface2, borderColor: t.outlineVar },
        ]}
        {...a11yButton(
          client ? `Client: ${client.name}. Change client` : 'Choose a client',
          'The assistant reads one client’s knowledge base at a time',
        )}
      >
        <Ionicons name="business-outline" size={13} color={t.ink3} />
        <Text style={[s.clientChipText, { color: client ? t.ink2 : t.ink3 }]} numberOfLines={1}>
          {client ? client.name : 'Choose client'}
        </Text>
        <Ionicons name="chevron-down" size={13} color={t.ink3} />
      </Pressable>
    </View>
  );

  /** The welcome. Shown until the conversation has something in it. */
  const hero = (
    <View style={s.hero}>
      <Lotus size={104} color={t.primary} weight={1} />

      <View style={s.heroTitleRow}>
        <Text style={[s.heroTitle, { color: t.ink }]}>Sahayak</Text>
        <Text style={[s.heroTitleHi, { color: t.ink2 }]}>सहायक</Text>
      </View>
      {/* Approved copy, verbatim. Pure Devanagari, so the whole node goes
          through `hindi()` — there is no Latin in it to keep separate. */}
      <Text style={[s.heroSub, { color: t.ink2 }]}>आपका सहायक — आपके काम का साथी</Text>

      {!clientId ? (
        <Text style={[s.heroNote, { color: t.ink3 }]}>
          Choose a client to begin. Sahayak answers from that client’s knowledge
          base — the documents and notes your firm has added for them — and one
          client at a time is as wide as it can currently see.
        </Text>
      ) : (
        <>
          {/* Cards FILL the composer; they do not send. A tap that spends
              credits has to be the send button and nothing else. */}
          <View style={s.openers}>
            {OPENERS.map(o => (
              <Pressable
                key={o.prompt}
                onPress={() => setDraft(o.prompt)}
                style={({ pressed }) => [
                  s.opener,
                  { backgroundColor: t.surface2, borderColor: pressed ? t.primary : t.outlineVar },
                ]}
                {...a11yButton(o.prompt, 'Puts this question in the box — it does not send it')}
              >
                <Text
                  style={[o.dev ? s.openerTitleHi : s.openerTitle, { color: t.ink }]}
                  numberOfLines={2}
                >
                  {o.prompt}
                </Text>
                <Text style={[s.openerHint, { color: t.ink3 }]} numberOfLines={1}>{o.hint}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={[s.heroNote, { color: t.ink3 }]}>
            Reading {client?.name ?? 'this client'}’s knowledge base. Each answer
            costs credits from your organisation’s balance.
          </Text>
        </>
      )}
    </View>
  );

  const renderTurn = ({ item }: { item: Turn }) => {
    if (item.role === 'user') {
      return (
        <View style={s.qRow}>
          <View style={[s.qBubble, { backgroundColor: t.primary }]}>
            <Text style={[s.qText, { color: t.onPrimary }]}>{item.content}</Text>
          </View>
        </View>
      );
    }

    return (
      <View style={s.aRow}>
        {/* The mark beside the answer, as `19-sahayak-final` draws it. Small and
            still — the animated one is the thinking state and using it here as
            well would leave the screen permanently in motion. */}
        <View style={s.aMark}>
          <Lotus size={26} color={item.failed ? t.error : t.primary} weight={1} />
        </View>

        <View style={s.aBody}>
          <View
            style={[
              s.aCard,
              {
                backgroundColor: t.surface,
                borderColor: item.failed ? t.error : t.outlineVar,
              },
            ]}
          >
            {item.failed && (
              <Text style={[s.aFailed, { color: t.error }]}>
                The assistant could not answer. Your credits were refunded.
              </Text>
            )}
            {/* RichText rather than a bare <Text>: the model is instructed to
                cite with [1] [2] and to use plain prose, and answers routinely
                come back with lists and bold. It is given the colour explicitly
                because it paints every run it produces from that one prop. */}
            <RichText
              text={item.content}
              names={[]}
              meName={null}
              color={t.ink}
              fontSize={14.5}
              lineHeight={21}
            />
          </View>

          {item.sources.length > 0 && (
            <View style={s.sources}>
              <Text style={[s.sourcesHead, { color: t.ink3 }]}>
                SOURCES · {item.sources.length}
              </Text>
              {item.sources.map((src, i) => (
                <View key={`${item.key}-src-${i}`} style={s.source}>
                  <View style={[s.sourceRef, { backgroundColor: withAlpha(t.primary, 0.15) }]}>
                    <Text style={[s.sourceRefText, { color: t.primaryText }]}>
                      {src.ref ?? '·'}
                    </Text>
                  </View>
                  <Text style={[s.sourceText, { color: t.ink2 }]} numberOfLines={2}>
                    {src.title || src.url || 'Untitled'}
                  </Text>
                  {/* A web source carries no `ref` — nothing numbered it into
                      the prompt, so the model was never given a [n] to cite it
                      by. Saying where it came from is the only honest label. */}
                  <Text style={[s.sourceKind, { color: t.ink3 }]}>
                    {src.type === 'web' ? 'WEB' : 'KB'}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* What it cost, stated. The mobile app is the easiest place in the
              product to spend model budget by accident. */}
          {item.credits !== undefined && item.credits > 0 && (
            <Text style={[s.cost, { color: t.ink3 }]}>
              {item.credits} credit{item.credits === 1 ? '' : 's'}
              {item.model ? ` · ${item.model}` : ''}
            </Text>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={[s.root, { backgroundColor: t.bg }]}>
      {header}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {status !== 'ready' ? (
          <ScreenState
            status={status}
            onRetry={() => clientsQuery.refetch()}
            {...(status === 'forbidden'
              ? {
                  title: 'Sahayak is not available to you',
                  body: friendly(clientsQuery.error)
                    ?? 'Either your organisation does not have Sahayak, or you have not been granted access to it.',
                }
              : {})}
          />
        ) : clients.length === 0 ? (
          <ScrollView contentContainerStyle={s.scroll}>
            {hero}
            <Text style={[s.heroNote, { color: t.ink3 }]}>
              There are no clients in this organisation yet. Sahayak answers from
              a client’s knowledge base, so a client has to exist before it has
              anything to read. Clients are created on the web.
            </Text>
          </ScrollView>
        ) : (
          <FlatList
            ref={listRef}
            data={turns}
            keyExtractor={x => x.key}
            renderItem={renderTurn}
            contentContainerStyle={s.scroll}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={hero}
            /* refreshControl removed — any RefreshControl blanks the whole list on
           this build. See components/Refresher.tsx. */
            ListFooterComponent={
              ask.isPending ? (
                <View style={s.thinking} accessibilityLiveRegion="polite">
                  <Lotus size={30} color={t.primary} weight={1} />
                  <Text style={[s.thinkingText, { color: t.ink3 }]}>Thinking…</Text>
                </View>
              ) : null
            }
          />
        )}

        <View
          style={[
            s.composer,
            { backgroundColor: t.surface, borderTopColor: t.outlineVar, paddingBottom: insets.bottom || 10 },
          ]}
        >
          <TextInput
            value={draft}
            onChangeText={setDraft}
            multiline
            editable={!!clientId}
            /* The three languages `detect_language` actually routes on, named so
               a Hindi or Gujarati speaker knows the box is for them. Kept as one
               ASCII-and-Devanagari-and-Gujarati string in a placeholder rather
               than a rendered label: a placeholder is not a <Text> node and
               carries no font family of its own, so the platform picks a face
               per script — which is the one place in this app where that is the
               right outcome, because no bundled face covers all three. */
            placeholder={clientId ? 'Ask anything — English, हिन्दी or ગુજરાતી…' : 'Choose a client first'}
            placeholderTextColor={t.ink3}
            maxLength={4000}
            accessibilityLabel="Ask Sahayak"
            style={[s.input, { backgroundColor: t.bg, borderColor: t.outline, color: t.ink }]}
          />
          <Pressable
            onPress={send}
            disabled={!canAsk}
            accessibilityState={{ disabled: !canAsk }}
            {...a11yButton('Ask Sahayak')}
            style={[s.send, { backgroundColor: canAsk ? t.primary : withAlpha(t.primary, 0.35) }]}
          >
            {ask.isPending
              ? <ActivityIndicator size="small" color={t.onPrimary} />
              : <Ionicons name="arrow-up" size={18} color={t.onPrimary} />}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <Sheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        closeLabel="Close client list"
        panelStyle={[s.sheet, { backgroundColor: t.surface }]}
      >
        <View style={[s.handle, { backgroundColor: t.outline }]} />
        <Text style={[s.sheetTitle, { color: t.ink }]}>Which client?</Text>
        <Text style={[s.sheetSub, { color: t.ink3 }]}>
          Sahayak reads one client’s knowledge base at a time. Changing the
          client starts a new conversation.
        </Text>
        <ScrollView style={s.sheetScroll}>
          {clients.map(c => {
            const on = c.id === clientId;
            return (
              <Pressable
                key={c.id}
                onPress={() => chooseClient(c.id)}
                style={({ pressed }) => [
                  s.clientRow,
                  {
                    backgroundColor: on ? t.primaryContainer : pressed ? t.surface2 : 'transparent',
                    borderColor: t.outlineVar,
                  },
                ]}
                {...a11yButton(on ? `${c.name}, selected` : c.name)}
              >
                <View style={s.clientRowBody}>
                  {/* WHEN A ROW GOES TONAL, EVERY LINE IN IT IS RECOLOURED.
                      Measuring the web specimen caught three failures at 2.79,
                      2.83 and 3.4:1, all the same shape: a secondary line left
                      on the page foreground while the row under it went
                      `--primary-container`. `on-surface-3` on this container
                      measures 5.23:1 in light and 2.83:1 in dark — which is
                      exactly why it goes unnoticed. */}
                  <Text
                    style={[s.clientName, { color: on ? t.onPrimaryContainer : t.ink }]}
                    numberOfLines={1}
                  >
                    {c.name}
                  </Text>
                  <Text
                    style={[s.clientMeta, { color: on ? t.onPrimaryContainer : t.ink3 }]}
                    numberOfLines={1}
                  >
                    {c.industry?.trim() || 'No industry set'}
                    {c.is_active === false ? ' · inactive' : ''}
                  </Text>
                </View>
                {on && <Ionicons name="checkmark" size={17} color={t.onPrimaryContainer} />}
              </Pressable>
            );
          })}
        </ScrollView>
      </Sheet>
    </View>
  );
}

/**
 * Stored rows → rendered turns.
 *
 * `credits_charged` is NOT on a stored row — it comes back only on the `send`
 * response — so a turn rebuilt from the server carries no cost line. That is
 * correct rather than a gap: the cost is a receipt for the request the user just
 * made, and re-stating it for history they scrolled back to would read as a
 * fresh charge.
 *
 * A role the server has not used yet is dropped rather than guessed at. The
 * column is free text and only 'user' and 'assistant' are written today.
 */
function rowsToTurns(rows: ChatMessageRow[]): Turn[] {
  const out: Turn[] = [];
  for (const r of rows) {
    if (r.role !== 'user' && r.role !== 'assistant') continue;
    out.push({
      key:     r.id,
      role:    r.role,
      content: r.content,
      sources: r.sources ?? [],
      model:   r.model_used ?? undefined,
    });
  }
  return out;
}

const s = StyleSheet.create({
  root: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 7 },
  title:    { fontSize: 17, fontWeight: '700' },
  // No fontWeight and no letterSpacing. Tiro Devanagari Hindi ships one weight;
  // anything above it is synthetic bold on Android and a system-face fallback on
  // iOS, and RN applies tracking after shaping, which splits the shirorekha.
  titleHi:  { fontSize: 14, ...hindi() },

  clientChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    maxWidth: 156, borderWidth: 1, borderRadius: 999,
    paddingHorizontal: 9, paddingVertical: 5,
  },
  clientChipText: { flexShrink: 1, fontSize: 11.5, fontWeight: '600' },

  scroll: { paddingHorizontal: 14, paddingBottom: 20 },

  hero:        { alignItems: 'center', paddingTop: 18, paddingBottom: 14 },
  heroTitleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 12 },
  heroTitle:   { fontSize: 22, fontWeight: '600' },
  heroTitleHi: { fontSize: 21, ...hindi() },
  heroSub:     { fontSize: 14.5, marginTop: 4, textAlign: 'center', ...hindi() },
  heroNote:    { fontSize: 11.5, lineHeight: 17, textAlign: 'center', marginTop: 12, paddingHorizontal: 8 },

  // One column, which is `19-sahayak-final`'s own phone breakpoint.
  openers:      { alignSelf: 'stretch', gap: 8, marginTop: 16 },
  opener:       { borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 10 },
  openerTitle:  { fontSize: 13, fontWeight: '600', marginBottom: 2 },
  openerTitleHi: { fontSize: 13.5, marginBottom: 2, ...hindi() },
  openerHint:   { fontSize: 10.5 },

  qRow:    { alignItems: 'flex-end', marginTop: 14 },
  qBubble: { maxWidth: '84%', borderRadius: 16, borderBottomRightRadius: 5, paddingHorizontal: 13, paddingVertical: 9 },
  qText:   { fontSize: 14.5, lineHeight: 21 },

  aRow:   { flexDirection: 'row', gap: 9, marginTop: 12, alignItems: 'flex-start' },
  aMark:  { paddingTop: 4 },
  aBody:  { flex: 1, minWidth: 0 },
  aCard:  { borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 11 },
  aFailed: { fontSize: 11.5, fontWeight: '700', marginBottom: 6 },

  sources:     { marginTop: 8, gap: 5 },
  sourcesHead: { fontSize: 9.5, fontWeight: '700', letterSpacing: 0.7 },
  source:      { flexDirection: 'row', alignItems: 'center', gap: 7 },
  sourceRef:   { width: 18, height: 18, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  sourceRefText: { fontSize: 10, fontWeight: '700' },
  sourceText:  { flex: 1, fontSize: 11.5 },
  sourceKind:  { fontSize: 9, fontWeight: '700', letterSpacing: 0.6 },

  cost: { fontSize: 10, marginTop: 6 },

  thinking:     { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 16 },
  thinkingText: { fontSize: 12.5 },

  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12, paddingTop: 8,
  },
  input: {
    flex: 1, borderWidth: 1, borderRadius: 20,
    paddingHorizontal: 14, paddingTop: 9, paddingBottom: 9,
    fontSize: 14.5, maxHeight: 120,
  },
  send: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },

  sheet: {
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingBottom: Platform.OS === 'ios' ? 34 : 22,
    paddingHorizontal: 18, maxHeight: '80%',
  },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 6 },
  sheetTitle: { fontSize: 16, fontWeight: '700', textAlign: 'center', marginTop: 6 },
  sheetSub:   { fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: 4, marginBottom: 10 },
  sheetScroll: { maxHeight: 380 },
  clientRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderRadius: 10, padding: 11, marginBottom: 7,
  },
  clientRowBody: { flex: 1, minWidth: 0 },
  clientName: { fontSize: 14, fontWeight: '600' },
  clientMeta: { fontSize: 11.5, marginTop: 2 },
});
