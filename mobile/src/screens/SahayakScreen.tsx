import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Linking,
  Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWindowClass } from '../hooks/useWindowClass';
import { devicePlatform } from '../nav/platform';
import { useNavigation } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { format, isToday, isYesterday } from 'date-fns';

import { useTheme } from '../theme/ThemeProvider';
import { hindi, FAMILY } from '../theme/fonts';
import { withAlpha } from '../theme/tokens';
import { useOnline } from '../hooks/useOnline';
import Lotus from '../components/Lotus';
import Sheet from '../components/Sheet';
import Refresher from '../components/Refresher';
import ScreenState, { resolveScreenState } from '../components/ScreenState';
import { a11yButton } from '../components/a11y';
import { storage } from '../lib/storage';
// The URL allowlist, shared with both grammars rather than re-derived here.
// `Linking.openURL('tel:…')` places a call; a source URL comes off a search
// result and an answer's links are written by a model.
import { safeHref } from '../lib/richText';
import {
  sahayakApi, askStreaming, parseAnswer, citableRefs, hrefHost,
  sessionTitleFor, withKeptPartials,
  StreamUnavailable, StreamFailed,
  type AnsBlock, type AnsLeaf,
  type WorkStep, type Fig, type Evidence,
  type ChatMessageRow, type ChatSession, type HubClient, type KbSource,
  type SahayakAnswer,
} from '../api/sahayak';

/**
 * Sahayak · सहायक — the assistant.
 *
 * Built from `docs/proposals/19-sahayak-final.html`, which is the layout the
 * owner approved: the welcome hero, the opener cards, the conversation, and the
 * lotus as the thinking state. What that document draws for a desktop is a
 * conversations RAIL and a split sources panel — two extra columns, and a phone
 * has one. The rail's content is not dropped for that: past conversations live
 * in a sheet off the header, which is the phone's version of a second column.
 * The sources stay under the answer they belong to, where a `[1]` can point at
 * the row it means.
 *
 * ── Three things this screen did NOT have until 2026-08-19 ──────────────────
 *
 *  · HISTORY. `GET /clients/{id}/chat/sessions` and `GET /chat/sessions/{id}/
 *    messages` have existed since migration 017 and the web has read them the
 *    whole time; the phone opened a blank thread every launch and there was no
 *    way back to yesterday's question. Both routes were already typed in
 *    `api/sahayak.ts` and simply had no caller.
 *  · MARKDOWN THAT MATCHES THE WEB. This screen rendered the answer through
 *    `RichText`, which is Slack's grammar — so `*urgent*` was BOLD here and
 *    ITALIC on the web, and `**Total**` and `## Summary` printed as literal
 *    characters. `parseAnswer` in `api/sahayak.ts` is the CommonMark grammar
 *    the web reads, and its header states which convention won and why.
 *  · THE ANSWER AS IT IS WRITTEN. See `send` below and the streaming section of
 *    `api/sahayak.ts` for what the phone can actually do and the evidence.
 *
 * eSign is still not a destination from here and invoices are still read-only:
 * nothing on this screen navigates, and nothing it renders is a control over a
 * document. An answer that mentions an invoice is prose about an invoice.
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
 * `mobile/`'s test suite cannot render a `.tsx` file at all. That now covers one
 * more thing: whether `ReadableStream` is actually a global in this bundle is a
 * claim about Metro that only a cold start can settle — hot reload lies. The
 * transport degrades to reading the whole body if it is not, so the worst case
 * is the speed this screen already has. The Devanagari is
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

/**
 * Say ONE short thing to a screen reader.
 *
 * The streaming answer used to sit inside `accessibilityLiveRegion="polite"`,
 * which is a promise to re-read the whole region every time its contents
 * change — and its contents change on every publish, which during an answer is
 * every 60ms. A sighted reader sees text growing; a TalkBack user heard the
 * answer restarted from the beginning, sixty times, and could not reach the end
 * of it while it was still arriving.
 *
 * So nothing on this screen is a live region and the three moments that are
 * worth an announcement are announced explicitly: the answer starting to
 * arrive, and the two ways it can finish. `announceForAccessibility` is a
 * no-op when no screen reader is running, which is why it can be called
 * unconditionally.
 */
const announce = (what: string) => { AccessibilityInfo.announceForAccessibility(what); };

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
/**
 * The widest a line of the assistant's prose may get, in dp.
 *
 * ~72 characters at this screen's 14.5px body. Beyond that the eye loses the
 * start of the next line — the reason every book and every newspaper column is
 * narrower than the page it is printed on, and the reason a chat thread at
 * 1200dp is harder to read than the same thread at 600.
 */
const MAX_MEASURE = 720;

interface Turn {
  key:      string;
  role:     'user' | 'assistant';
  content:  string;
  sources:  KbSource[];
  /** From `credits_charged`. Only on an assistant turn from THIS session. */
  credits?: number;
  model?:   string;
  failed?:  boolean;
  /**
   * The structured half, from `POST /v1/hub/chat` — 2026-08-07.
   *
   * All optional, and that is the shape to design against rather than a gap to
   * paper over. `_sahayak_store_answer` has been writing
   * `hub_chat_messages.answer` on every answer since the day the route shipped,
   * and the READ now exists too: `hub.sahayak_chat_history` selects the column,
   * pops it and lifts `_ANSWER_READBACK` onto the row FLAT, beside `content`.
   * So a reopened conversation carries its work steps, figures and evidence,
   * and `api/sahayak.storedAnswerOf` is where the flat row and the older nested
   * blob become one shape for `rowsToTurns` to read.
   *
   * Each falls back to undefined, never to `[]` — "the server sent none" and
   * "this row carries no structure" are different facts.
   */
  work?:     WorkStep[];
  figs?:     Fig[];
  evidence?: Evidence | null;
  refusal?:  string;
  refusalKind?: string;
  /** The server's own verdict. Replaces the old prose heuristic entirely. */
  answered?: boolean;
  /**
   * THIS TURN'S TEXT IS WHAT ARRIVED, not a `final` frame.
   *
   * It never went through `strip_invalid_refs`, so it has no sources; no
   * `final` frame was received, so it has no cost figure and no verdict. Both
   * kinds say so on screen, and they are distinguished because the reader needs
   * to know which of them happened:
   *
   *   'stopped' — they tapped Stop. Their doing, and it is not an error.
   *   'cut'     — the stream died on its own after delivering text. Nobody
   *               chose this, and what arrived used to be thrown away for it:
   *               text appeared, was read, and then vanished on the failure.
   *
   * A stream that fails BEFORE any text is a different case again and does not
   * become a turn at all — there is nothing to keep, and the alert says so.
   */
  partial?: 'stopped' | 'cut';
  /** For a 'cut' turn: the server's own sentence for why it ended. */
  reason?: string;
}


/* ────────────────────────────────────────────────────────────────────────────
 * The answer, rendered
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * `parseAnswer` tokens → React Native.
 *
 * The parser is in `api/sahayak.ts` and its header states the convention:
 * COMMONMARK, the web's grammar, because the author is a model and every model
 * in the chain writes `**bold**` and `## heading`. This file is only the
 * renderer, the same split `lib/richText.ts` / `components/RichText.tsx` uses —
 * and for the same reason, which is that `node --test` cannot link a `.tsx`, so
 * grammar kept inside a component is grammar with no tests.
 *
 * `RichText` is NOT used here any more. It is Slack's grammar and it belongs to
 * Sanvaad, where a colleague is typing; pointing it at model output is what made
 * `*urgent*` bold on the phone and italic on the web.
 *
 * Two React Native facts shape every choice below, both already learned in
 * `RichText`:
 *   · A `<View>` cannot nest inside a `<Text>`, so a block that needs a box is
 *     a sibling `<View>` rather than a run.
 *   · A nested `<Text>` honours `backgroundColor` on both platforms but drops
 *     `padding` and `borderRadius` on Android. Inline code is therefore a tinted
 *     span with no box, so the two platforms ship the same thing.
 *
 * NO FONT FAMILY IS NAMED FOR BODY TEXT, and that is the same decision
 * `RichText` records. An answer in Hindi is content, not a UI label: it renders
 * in the face the reader's OS picked for Devanagari, which HAS a bold. Forcing
 * Tiro here would drag `fontWeight: '700'` — which `**bold**` needs — onto a
 * face that ships only a 400, and that is synthetic bold on Android and a
 * fallback face on iOS. Only `code`, `pre` and the citation chip name a family,
 * and it is `FAMILY.mono`, which is Latin-only by design.
 */

/**
 * A tap on a link, and the one place this screen may open one.
 *
 * The allowlist is applied HERE rather than trusted from the caller, because
 * `Linking.openURL('tel:…')` places a call and `itms-apps://` opens the store,
 * and every href that reaches this function was written by a model repeating a
 * web-search result. `parseAnswer` already refuses a non-http(s) target when it
 * builds the leaf; a second check at the choke point costs one regex and means
 * a future caller cannot introduce the hole by handing over a raw string.
 */
const openHref = (href: string) => {
  const url = safeHref(href);
  if (!url) return;
  Linking.openURL(url).catch(() => {});
};

function Leaves({
  kids, kp, t, onCite, hot,
}: {
  kids: AnsLeaf[]; kp: string; t: any;
  onCite?: (n: number) => void; hot?: number | null;
}): React.ReactElement {
  return (
    <>
      {kids.map((n, i) => {
        const k = `${kp}.${i}`;
        if (typeof n === 'string') return <React.Fragment key={k}>{n}</React.Fragment>;
        switch (n.k) {
          case 'code':
            return (
              <Text key={k} style={[s.mdCode, { color: t.ink, backgroundColor: withAlpha(t.ink, 0.08) }]}>
                {n.text}
              </Text>
            );
          case 'b': return <Text key={k} style={s.mdBold}><Leaves kids={n.kids} kp={k} t={t} onCite={onCite} hot={hot} /></Text>;
          case 'i': return <Text key={k} style={s.mdItalic}><Leaves kids={n.kids} kp={k} t={t} onCite={onCite} hot={hot} /></Text>;
          /**
           * A link, WITH ITS DESTINATION SHOWN.
           *
           * The label is the model's and the model repeats what the web search
           * returned, so it is untrusted text: `[the Income Tax portal](…)` can
           * point anywhere the allowlist permits. On the web the reader gets a
           * status bar on hover and an address bar after the click; a tap here
           * hands straight off to another app, and the first thing they see is
           * the page itself. So the host is drawn next to the label — small and
           * muted, but present — and it is the host `hrefHost` derives, which
           * strips the `user@` prefix that would otherwise let
           * `https://incometax.gov.in@evil.tld/` print a government domain.
           *
           * Not repeated when the label already IS the address; a URL followed
           * by its own host reads as a rendering bug rather than a warning.
           */
          case 'a': {
            const host = hrefHost(n.href);
            const shown = host && !n.text.toLowerCase().includes(host);
            return (
              <Text
                key={k}
                onPress={() => openHref(n.href)}
                accessibilityRole="link"
                // The destination is spoken too. A screen-reader user gets no
                // status bar at all, so the label alone is the whole of what
                // they would have had to go on.
                accessibilityLabel={host ? `${n.text}, link to ${host}` : n.text}
                accessibilityHint="Opens in your browser"
              >
                <Text style={[s.mdLink, { color: t.primaryText }]}>{n.text}</Text>
                {shown ? <Text style={[s.mdLinkHost, { color: t.ink3 }]}>{` (${host})`}</Text> : null}
              </Text>
            );
          }
          /**
           * `[3]` as a control rather than as punctuation — the web's `<cite>`.
           *
           * It only exists when a source is behind it: `parseAnswer` never emits
           * this leaf for a number `citableRefs` does not know, so a marker with
           * nothing to open stays as the characters the model typed. Tapping it
           * lights the matching row in the strip below rather than navigating —
           * a knowledge-base chunk is not a destination in this app, and eSign
           * and invoices are not destinations from here at all.
           */
          case 'cite':
            return (
              <Text
                key={k}
                onPress={() => onCite?.(n.n)}
                accessibilityRole="button"
                accessibilityLabel={`Source ${n.n}`}
                style={[
                  s.mdCite,
                  {
                    color: t.primaryText,
                    backgroundColor: withAlpha(t.primary, hot === n.n ? 0.34 : 0.15),
                  },
                ]}
              >
                {` ${n.n} `}
              </Text>
            );
          default:
            return null;
        }
      })}
    </>
  );
}

function AnswerText({
  text, t, sources, onCite, hot, color, size = 14.5, leading = 21,
}: {
  text: string; t: any;
  /**
   * The sources this answer came back with. ABSENT means no `[n]` in the text
   * may become a control — which is the state streaming text is in, because
   * `strip_invalid_refs` has not run on it yet.
   *
   * Taken as the array rather than as a ready-made Set so the memo below has
   * something stable to key on: a caller that built the Set in its own render
   * would hand a new object every frame and re-parse the whole answer on each
   * one, which during a stream is every 60ms.
   */
  sources?: KbSource[];
  onCite?: (n: number) => void; hot?: number | null;
  color: string; size?: number; leading?: number;
}) {
  const citable = useMemo(() => (sources ? citableRefs(sources) : undefined), [sources]);
  const blocks = useMemo(() => parseAnswer(text, citable), [text, citable]);
  if (!blocks.length) return null;

  const base = { color, fontSize: size, lineHeight: leading };
  const leaves = (kids: AnsLeaf[], kp: string) => (
    <Leaves kids={kids} kp={kp} t={t} onCite={onCite} hot={hot} />
  );

  const block = (b: AnsBlock, i: number): React.ReactNode => {
    const k = `mb${i}`;
    switch (b.k) {
      case 'h':
        return (
          <Text
            key={k}
            style={[
              s.mdH,
              { color: t.ink, fontSize: size + (b.level === 1 ? 4 : b.level === 2 ? 2.5 : 1) },
            ]}
            accessibilityRole="header"
          >
            {leaves(b.kids, k)}
          </Text>
        );
      case 'hr':
        return <View key={k} style={[s.mdHr, { backgroundColor: t.outlineVar }]} />;
      // Horizontal scroll, never wrap. A wrapped stack trace or a wrapped SQL
      // line is unreadable, and the scroll lives inside the block so the thread
      // itself never moves sideways.
      case 'pre':
        return (
          <View key={k} style={[s.mdPre, { backgroundColor: t.surface3 }]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Text style={[s.mdPreText, { color: t.ink2 }]}>{b.text}</Text>
            </ScrollView>
          </View>
        );
      case 'ul':
        return (
          <View key={k} style={s.mdList}>
            {b.items.map((it, j) => (
              <View key={`${k}.${j}`} style={s.mdItem}>
                <Text style={[s.mdBullet, { color: t.ink3, lineHeight: leading }]}>{'•'}</Text>
                <Text style={[base, s.mdItemText]}>{leaves(it, `${k}.${j}`)}</Text>
              </View>
            ))}
          </View>
        );
      case 'ol':
        return (
          <View key={k} style={s.mdList}>
            {b.items.map((it, j) => (
              <View key={`${k}.${j}`} style={s.mdItem}>
                {/* The number the model wrote, not the row's position. See
                    `parseAnswer`: a browser showing the same answer prints the
                    literal number, and two surfaces numbering one list
                    differently is the divergence in miniature. */}
                <Text style={[s.mdBullet, { color: t.ink3, lineHeight: leading }]}>{`${it.num}.`}</Text>
                <Text style={[base, s.mdItemText]}>{leaves(it.kids, `${k}.${j}`)}</Text>
              </View>
            ))}
          </View>
        );
      /**
       * A table, scrolled sideways rather than squeezed.
       *
       * Fixed column width and one horizontal scroller, exactly as the evidence
       * table below does it — a five-column table does not fit 360dp, and
       * flexing it produces columns one character wide, which is not a smaller
       * table but an unreadable one.
       */
      case 'table':
        return (
          <View key={k} style={s.mdTableWrap}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View>
                <View style={[s.mdTr, { borderBottomColor: t.outlineVar }]}>
                  {b.head.map((cell, ci) => (
                    <Text key={`${k}.h${ci}`} style={[s.mdTh, { color: t.ink3 }]} numberOfLines={2}>
                      {leaves(cell, `${k}.h${ci}`)}
                    </Text>
                  ))}
                </View>
                {b.rows.map((row, ri) => (
                  <View key={`${k}.r${ri}`} style={[s.mdTr, { borderBottomColor: t.outlineVar }]}>
                    {row.map((cell, ci) => (
                      <Text key={`${k}.r${ri}c${ci}`} style={[s.mdTd, { color: t.ink2 }]} numberOfLines={3}>
                        {leaves(cell, `${k}.r${ri}c${ci}`)}
                      </Text>
                    ))}
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
        );
      default:
        return <Text key={k} style={[base, s.mdP]}>{leaves(b.kids, k)}</Text>;
    }
  };

  return <View>{blocks.map(block)}</View>;
}

/**
 * The named steps — the prototype's `.sh__work`.
 *
 * A spinner over a data question tells the reader nothing about what is being
 * read on their behalf, and the read steps are FREE while the writing step is
 * not. Both are stated per row rather than left to a footnote, which is the
 * split the skill dispatcher already enforces server-side.
 */
function Work({ rows, t }: { rows?: WorkStep[]; t: any }) {
  if (!rows?.length) return null;
  return (
    <View style={s.work}>
      {rows.map((r, i) => (
        <View key={`w${i}`} style={s.workRow}>
          <View style={[s.workDot, { backgroundColor: r.ok ? t.primary : t.ink3 }]} />
          <Text style={[s.workLabel, { color: t.ink2 }]} numberOfLines={1}>{r.label}</Text>
          <Text style={[s.workNote, { color: t.ink3 }]} numberOfLines={1}>{r.note}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * The attributable figures.
 *
 * A tile without `src` is DROPPED rather than shown without one — a number with
 * no provenance is the one thing worse than not answering, and the server
 * already refuses to emit one. Filtering here too costs nothing and means a
 * future field cannot slip a bare number onto the screen.
 *
 * Two columns on a tablet, one on a phone: three tiles side by side at 360dp
 * truncate their own labels, which makes them unreadable rather than compact.
 */
function Figs({ figs, t, wide }: { figs?: Fig[]; t: any; wide: boolean }) {
  const usable = (figs ?? []).filter(f => f && f.value != null && f.src);
  if (!usable.length) return null;
  return (
    <View style={s.figs}>
      {usable.map((f, i) => (
        <View
          key={`f${i}`}
          style={[
            s.fig,
            { backgroundColor: t.surface2, borderColor: t.outlineVar },
            wide && { flexBasis: '48%' },
          ]}
        >
          <Text style={[s.figLabel, { color: t.ink3 }]} numberOfLines={1}>{f.label}</Text>
          <Text style={[s.figValue, { color: t.ink }]} numberOfLines={1}>{f.value}</Text>
          {!!f.sub && (
            <Text style={[s.figSub, { color: t.ink3 }]} numberOfLines={1}>{f.sub}</Text>
          )}
        </View>
      ))}
    </View>
  );
}

/**
 * The rows the answer was computed from, behind a switch.
 *
 * Collapsed by default on every size. It is evidence, not the answer — opening
 * it is a deliberate act ("show me the rows behind it"), and a table unfurled
 * under every reply pushes the next question off the screen on a phone.
 *
 * Horizontally scrollable, always: a six-column table does not fit 360dp and
 * squeezing it produces columns one character wide. The scroll is inside the
 * table's own container so the thread never scrolls sideways.
 */
function EvidenceTable({ ev, t }: { ev?: Evidence | null; t: any }) {
  const [open, setOpen] = useState(false);
  if (!ev || !ev.rows?.length) return null;
  return (
    <View style={s.evWrap}>
      <TouchableOpacity
        onPress={() => setOpen(o => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={open ? 'Hide the rows behind this answer' : 'Show the rows behind this answer'}
        style={s.evToggle}
      >
        <Text style={[s.evToggleText, { color: t.primary }]}>
          {open ? 'Hide the rows behind it' : `Show the rows behind it · ${ev.total}`}
        </Text>
      </TouchableOpacity>
      {open && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.evScroll}>
          <View>
            <View style={[s.evRow, { borderBottomColor: t.outlineVar }]}>
              {ev.cols.map((c, i) => (
                <Text key={`c${i}`} style={[s.evHead, { color: t.ink3 }]} numberOfLines={1}>{c}</Text>
              ))}
            </View>
            {ev.rows.map((row, ri) => (
              <View key={`r${ri}`} style={[s.evRow, { borderBottomColor: t.outlineVar }]}>
                {row.map((cell, ci) => (
                  <Text key={`c${ci}`} style={[s.evCell, { color: t.ink2 }]} numberOfLines={1}>{cell}</Text>
                ))}
              </View>
            ))}
            {ev.truncated && (
              <Text style={[s.evMore, { color: t.ink3 }]}>
                First {ev.rows.length} of {ev.total}.
              </Text>
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

/**
 * What it would not tell you — the prototype's `.sh-none`, and 29 §2 rule 2
 * calls it the most important element on the screen.
 *
 * The title follows the KIND, for the same reason it does on the web: an
 * `unrecognised` answer withheld nothing, and heading that block "what it would
 * not tell you" tells the reader something was hidden from them, which is a
 * second false impression on the exact reply this was built to fix.
 */
function Refusal({ text, kind, t }: { text?: string; kind?: string; t: any }) {
  if (!text?.trim()) return null;
  const title = kind === 'unrecognised'
    ? 'Nothing of yours was read for this'
    : 'What it would not tell you';
  return (
    <View style={[s.none, { backgroundColor: t.surface2, borderColor: t.outlineVar }]}>
      <Text style={[s.noneTitle, { color: t.ink }]}>{title}</Text>
      <Text style={[s.noneBody, { color: t.ink2 }]}>{text}</Text>
    </View>
  );
}

export default function SahayakScreen() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  /**
   * TABLET, 2026-08-07. This screen had no size awareness at all, so on a
   * 1200dp tablet a chat thread ran the full width of the window — a 140-
   * character measure that the eye cannot track back to the start of the next
   * line, which is the one thing prose layout has to get right.
   *
   * `content`, not `width`: the rail is already subtracted, so the measure is
   * of the space the thread actually has. Capped rather than centred — the
   * standing rule is fluid and left-aligned, and a centred column would put the
   * composer somewhere different from every other screen in the app.
   */
  const { content, split } = useWindowClass(devicePlatform());
  const wide = split;
  const measure = Math.min(content, MAX_MEASURE);
  const nav = useNavigation();
  const qc = useQueryClient();
  const online = useOnline();

  const [clientId, setClientId] = useState<string | null>(
    () => storage.getString(CLIENT_KEY) ?? null,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [draft, setDraft] = useState('');
  /**
   * The composer's live value, mirrored for the code that runs LATER.
   *
   * `onError` fires after a network round trip, and by then the reader may have
   * typed the next question — but the handler closed over the `draft` from the
   * render that started the send, which is empty. Deciding what to do with the
   * words the send failed with off that stale copy is what made a failure
   * overwrite whatever had been typed since.
   */
  const draftRef = useRef('');
  useEffect(() => { draftRef.current = draft; }, [draft]);
  /**
   * A question that was sent, failed, and could NOT be put straight back in the
   * composer because the reader had already started typing another one.
   *
   * It is parked rather than dropped. Losing what somebody typed is the worst
   * thing a chat can do to them, and the old code did it on every failure where
   * the composer was not empty: the words went into `sent.current`, the guard
   * refused to clobber the new draft, and nothing ever showed them again.
   */
  const [unsent, setUnsent] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  /**
   * The answer being written right now: the steps that have been announced and
   * the text that has arrived so far.
   *
   * NOT a Turn, and never appended to `turns`. What streams is PROVISIONAL —
   * citation validation runs on the complete text, so a `[7]` that streamed may
   * not survive — and the only text that becomes a turn is `final.message`.
   * Keeping the two in different variables is what makes that impossible to get
   * wrong by accident.
   */
  const [live, setLive] = useState<{ steps: string[]; text: string } | null>(null);
  /** Aborts the in-flight stream. Non-null exactly while one is open. */
  const abort = useRef<AbortController | null>(null);
  /** A stream is open, so there is something a stop button could actually stop.
   *  State rather than a ref because the composer has to re-render on it. */
  const [streaming, setStreaming] = useState(false);
  /**
   * The route answered 404/405/501 once, so this build is talking to a
   * deployment that has no streaming endpoint. Remembered for the life of the
   * screen so every later question goes straight to `POST /chat` instead of
   * paying a round trip to be told the same thing again.
   */
  const noStreamRoute = useRef(false);
  /**
   * WHICH CONVERSATION IS ON SCREEN, as a number that changes when it does.
   *
   * An answer in flight used to be appended to whatever thread was showing when
   * it landed. Every control stays live during a send — only the send button is
   * disabled — so a reader can pick another client, open a stored conversation
   * or start a new one while the stream is still open, and all three of those
   * empty the thread. The answer to the OLD question then dropped onto the
   * bottom of the new one, and `onSuccess` moved `sessionId` with it.
   *
   * That is worse than a stray paragraph. `_sahayak_answer` reads `client_id`
   * back OFF the session and ignores the one in the body, so the next question
   * — sent with the session id the crossed answer left behind — is answered out
   * of the previous client's knowledge base while the header names the new one.
   *
   * So every action that changes what the thread IS bumps this, and an answer
   * whose token no longer matches is dropped rather than shown.
   */
  const thread = useRef(0);
  /** The token the question in flight was asked under. One ref is enough: `send`
   *  is a no-op while `ask.isPending`, so there is never a second one. */
  const asking = useRef(0);
  /**
   * The thread on screen is about to become a different one.
   *
   * Bumps the token and CLOSES the stream. An answer nobody will be shown is a
   * socket nobody is reading and a native task nobody will release, and leaving
   * it open would hold the composer disabled until it finished. The org is
   * still charged for whatever the provider generated by then — the same honest
   * cost the Stop button carries, and for the same reason: the debit is the
   * server's and happens whether or not this reader is listening.
   */
  const leaveThread = useCallback(() => {
    thread.current += 1;
    abort.current?.abort();
  }, []);
  /** Which `[n]` chip was last tapped, and on which turn. */
  const [hot, setHot] = useState<{ key: string; n: number } | null>(null);
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
    // Before anything else on this path, because the picker is live during a
    // send: an answer about the old client must not land in the thread this is
    // about to empty. See `thread`.
    leaveThread();
    storage.set(CLIENT_KEY, id);
    setClientId(id);
    // A new client is a new knowledge base. Carrying the conversation across
    // would leave answers about one firm sitting above questions about another,
    // and the session belongs to the old client server-side regardless.
    setSessionId(null);
    setTurns([]);
    setPickerOpen(false);
  }, [leaveThread]);

  // ── History ────────────────────────────────────────────────────────────────

  /**
   * Past conversations for this client.
   *
   * `GET /clients/{id}/chat/sessions` orders by `updated_at DESC` server-side,
   * so the list is newest-activity-first without this screen re-sorting — which
   * is also what keeps it in the same order as the web's rail.
   *
   * Not fetched until the sheet is opened. It is one request per client and
   * most sessions on this screen never look at it; paying for it on mount
   * would put a round trip in front of the first question on every launch.
   */
  const [historyWanted, setHistoryWanted] = useState(false);
  const sessionsQuery = useQuery<ChatSession[]>({
    queryKey: ['sahayak', 'sessions', clientId],
    queryFn:  () => sahayakApi.sessions(clientId as string),
    enabled:  !!clientId && historyWanted,
    staleTime: 30_000,
  });
  const sessions: ChatSession[] = sessionsQuery.data ?? [];
  const [opening, setOpening] = useState<string | null>(null);

  const openHistory = useCallback(() => {
    setHistoryWanted(true);
    setHistoryOpen(true);
  }, []);

  /**
   * Open a stored conversation and continue it.
   *
   * The whole thread is re-read rather than merged into what is on screen:
   * `GET …/messages` is the authority and it is unpaged and oldest-first, so
   * replacing is both correct and cheaper than reconciling. `sessionId` is set
   * only AFTER the rows are in hand — set it first and a question sent while
   * the read was still in flight would land in a conversation the reader could
   * not yet see.
   */
  const openSession = useCallback(async (id: string) => {
    // The history sheet is live during a send too, so the answer to the question
    // still being written must not drop onto the bottom of the conversation the
    // reader has just chosen to read. See `thread`.
    leaveThread();
    setOpening(id);
    try {
      const rows = await sahayakApi.messages(id);
      setTurns(rowsToTurns(rows));
      setSessionId(id);
      setHot(null);
      setHistoryOpen(false);
    } catch (e: unknown) {
      Alert.alert('Not opened', friendly(e) ?? 'Could not load that conversation.');
    } finally {
      setOpening(null);
    }
  }, [leaveThread]);

  /** Start again. Nothing is deleted — the old session is still in the list. */
  const newConversation = useCallback(() => {
    leaveThread();
    setSessionId(null);
    setTurns([]);
    setHot(null);
    setLive(null);
    setHistoryOpen(false);
  }, [leaveThread]);

  // ── Asking ─────────────────────────────────────────────────────────────────

  /**
   * Send one question.
   *
   * The session is created LAZILY, on the first question, rather than when a
   * client is picked. Creating it on pick would leave an empty "New chat" in
   * `hub_chat_sessions` — and on the web's rail — every time somebody opened
   * this screen and changed their mind, which is most times.
   */

  /** The last question sent, kept so a failure can hand the words back. */
  const sent = useRef('');
  /** Set by the stop button, read once by `onError`. */
  const stopped = useRef(false);
  /**
   * The live buffer, in a ref as well as in state.
   *
   * The ref is the truth and the state is only how it reaches the screen.
   * `onError` runs after the stream has ended and needs everything that
   * arrived; reading that off a state variable captured in a closure is a race
   * this screen would lose exactly when it mattered — on the turn somebody
   * stopped, where the buffer IS the answer.
   */
  const liveBuf = useRef<{ steps: string[]; text: string } | null>(null);
  const publishAt = useRef(0);
  const publishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Push the buffer to the screen, at most once every 60ms.
   *
   * THIS PACES RENDERS, NOT TEXT. Every byte that has arrived is already in the
   * buffer and the next publish shows all of it; nothing is held back, timed or
   * revealed. Without the floor a token-sized frame is a `setState` per token,
   * and `renderTurn` is rebuilt each render, so the whole visible thread
   * re-renders on every token — which on a phone is where a real stream starts
   * looking worse than no stream at all.
   *
   * The trailing timer is what makes it safe: the last frame of an answer is
   * published even when it lands inside the 60ms window.
   */
  const publishLive = useCallback((immediate = false) => {
    if (publishTimer.current) { clearTimeout(publishTimer.current); publishTimer.current = null; }
    const now = Date.now();
    if (immediate || now - publishAt.current >= 60) {
      publishAt.current = now;
      setLive(liveBuf.current ? { ...liveBuf.current } : null);
      return;
    }
    publishTimer.current = setTimeout(() => {
      publishTimer.current = null;
      publishAt.current = Date.now();
      setLive(liveBuf.current ? { ...liveBuf.current } : null);
    }, 60);
  }, []);

  const resetLive = useCallback((next: { steps: string[]; text: string } | null) => {
    if (publishTimer.current) { clearTimeout(publishTimer.current); publishTimer.current = null; }
    liveBuf.current = next;
    publishAt.current = 0;
    setLive(next);
  }, []);

  // A stream still running when the screen goes away is a socket nobody is
  // reading and a native task nobody will release.
  useEffect(() => () => {
    if (publishTimer.current) clearTimeout(publishTimer.current);
    abort.current?.abort();
  }, []);

  /** One finished answer → the turn that renders it. */
  const answerTurn = useCallback((answer: SahayakAnswer): Turn => ({
    key:     `a-${Date.now()}`,
    role:    'assistant',
    // THE FINAL FRAME, NEVER THE ACCUMULATION. Everything that streamed is
    // provisional: `strip_invalid_refs` can only run on the complete text, so a
    // client that kept its own copy would show citations the server rejected.
    content: answer.message,
    sources: answer.sources,
    credits: answer.credits_charged,
    model:   answer.model,
    work:     answer.work,
    figs:     answer.figs,
    evidence: answer.evidence,
    refusal:  answer.refusal,
    refusalKind: answer.refusal_detail?.kind,
    answered: answer.answered,
    // THE SERVER SAYS SO. This used to be `looksLikeFailure`, a string
    // heuristic over the prose, because the old route gave nothing else to go
    // on — same status, same shape, same keys whether it had answered or
    // apologised. `answered` is the endpoint's own verdict.
    failed:  answer.answered === false,
  }), []);

  const ask = useMutation({
    mutationFn: async (question: string) => {
      if (!clientId) throw new Error('No client selected');
      /**
       * CLEARED AT THE START OF EVERY TURN, not only inside the branch that
       * reads it.
       *
       * It was set by Stop and cleared only by `onError`'s stopped arm — so a
       * stop that landed while the stream was already resolving left it true
       * for ever: `askStreaming` had returned, `onError` never ran, and the
       * NEXT question's first failure was rendered as "you stopped this",
       * silently truncated, with no alert and the words not handed back.
       */
      stopped.current = false;
      // The conversation this answer belongs to, read once at the start. What
      // it is compared against — and what happens when they differ — is in
      // `thread`.
      asking.current = thread.current;
      const ctrl = new AbortController();
      abort.current = ctrl;
      resetLive({ steps: [], text: '' });

      // No createSession first, on either path. `POST /v1/hub/chat` opens the
      // conversation itself and only AFTER the permission check, so a question
      // the caller may not ask leaves no empty "New chat" in the customer's org
      // — which the old create-then-send order did on every single refusal.
      const plain = async () => {
        const answer = await sahayakApi.ask(question, { sessionId, clientId });
        return { sid: answer.session_id ?? sessionId, answer };
      };

      if (noStreamRoute.current) return plain();

      setStreaming(true);
      try {
        const { answer } = await askStreaming(
          question,
          { sessionId, clientId },
          {
            onStep: (label) => {
              const b = liveBuf.current ?? { steps: [], text: '' };
              liveBuf.current = { steps: [...b.steps, label], text: b.text };
              // A step is one row and they arrive seconds apart: publish it now
              // rather than through the coalescer, so "Reading your invoices"
              // appears the moment the server says it is reading them.
              publishLive(true);
            },
            onDelta: (text) => {
              const b = liveBuf.current ?? { steps: [], text: '' };
              // ONCE, on the first token. Not per token: that is the mistake
              // the live region made, and announcing "the answer is arriving"
              // sixty times is the same interruption in a different shape.
              if (!b.text) announce('The answer is arriving.');
              liveBuf.current = { steps: b.steps, text: b.text + text };
              publishLive();
            },
          },
          { signal: ctrl.signal },
        );
        return { sid: answer.session_id ?? sessionId, answer };
      } catch (e: unknown) {
        // A stop is not a failure to recover from. `onError` renders what was
        // read and says what it cost; re-asking here would spend a second
        // charge on the answer the reader just interrupted.
        if (ctrl.signal.aborted) throw e;
        /**
         * THE ONLY RETRY, AND WHY IT IS SAFE.
         *
         * `StreamUnavailable` means no answer was generated: either the build
         * could not open a streaming transport (nothing was sent) or the route
         * replied 404/405/501 (FastAPI refused before any handler ran). Both
         * are free, so asking once on `POST /chat` costs the org one answer,
         * not two. Every other failure ends the turn — see `api/sahayak.ts`.
         */
        if (e instanceof StreamUnavailable) {
          noStreamRoute.current = true;
          setStreaming(false);
          resetLive({ steps: [], text: '' });
          return plain();
        }
        throw e;
      } finally {
        abort.current = null;
        setStreaming(false);
      }
    },
    onSuccess: ({ sid, answer }) => {
      // The live buffer is DISCARDED, not converted. `answerTurn` reads
      // `answer.message` — the final frame — so what streamed never becomes the
      // stored text of a turn under any code path.
      resetLive(null);
      // The session list shows a title derived from the first question, so it
      // is stale the moment this lands — for the client this question was asked
      // about, which is not necessarily the one on screen now. Invalidated by
      // prefix for that reason, before the check below returns.
      qc.invalidateQueries({ queryKey: ['sahayak', 'sessions'] });
      // THE THREAD MOVED WHILE THIS WAS BEING WRITTEN, so this answer belongs
      // to a conversation that is no longer on screen. Appending it would put
      // one client's answer under another client's header, and `setSessionId`
      // below would then send the next question into the old client's knowledge
      // base with the new client's name on the screen. See `thread`.
      if (asking.current !== thread.current) return;
      if (sid) setSessionId(sid);
      setTurns(prev => [...prev, answerTurn(answer)]);
      // The one moment a live region would have been right about, and it is
      // gone by the time it happens: the live block unmounts when the turn is
      // appended, so the completion is announced rather than rendered.
      announce('The answer is ready.');
    },
    onError: async (e: unknown) => {
      const partial = liveBuf.current;
      resetLive(null);
      // READ AND CLEARED TOGETHER. See `mutationFn` for the turn this leaked
      // into when it was cleared inside the branch below instead.
      const wasStopped = stopped.current;
      stopped.current = false;

      /**
       * THE THREAD MOVED WHILE THIS QUESTION WAS IN FLIGHT — see `thread`.
       *
       * `leaveThread` aborted it, so this is the abort arriving rather than a
       * failure of anything. Nothing below may run: the partial turn would be
       * appended to somebody else's conversation, the recovery would replace it
       * with rows read out of a session that is no longer open, and the question
       * would be handed back into a composer that now sends to another client's
       * knowledge base. The reader left this question behind on purpose.
       */
      if (asking.current !== thread.current) return;

      /**
       * THE ANSWER ENDED EARLY, AND WHAT ARRIVED IS KEPT.
       *
       * Two things reach this point with text on screen, and they used to be
       * handled as opposites: a stop kept its text, and a stream that DIED
       * after delivering text had it deleted — the reader watched an answer
       * arrive and then watched it vanish, replaced by an alert. Both are the
       * same fact about the same bytes: they arrived, they were read, and they
       * are not a whole answer. So both are kept and both are marked, and the
       * mark says which one happened, because the reader chose one of them and
       * not the other.
       *
       * Either way the turn has no sources, no cost figure and no verdict:
       * without a `final` frame the text never went through
       * `strip_invalid_refs`, so every `[n]` in it is a number the server has
       * not stood behind, and `credits_charged` was never sent.
       *
       * A failure with NO text is not this case. Nothing arrived, so there is
       * nothing to keep, and it falls through to the recovery below.
       */
      const text = partial?.text ?? '';
      if (wasStopped || (text && e instanceof StreamFailed && e.sawDelta)) {
        const at = Date.now();
        setTurns(prev => [
          // The question stays and stops being pending — it WAS sent, and the
          // server answered it. Only the reading was interrupted.
          ...prev.map(x => (
            x.role === 'user' && x.key.startsWith('u-pending')
              ? { ...x, key: `u-${at}` }
              : x
          )),
          {
            key:     `a-partial-${at}`,
            role:    'assistant' as const,
            content: text,
            sources: [],
            partial: wasStopped ? 'stopped' as const : 'cut' as const,
            // The server's own sentence, kept with the text it belongs to
            // rather than shown in an alert the reader has to dismiss before
            // they can look at what arrived.
            reason:  wasStopped || !(e instanceof StreamFailed) ? undefined : e.message,
          },
        ]);
        announce(wasStopped ? 'You stopped the answer.' : 'The answer was cut off.');

        /**
         * AND THE CONVERSATION THE SERVER ALREADY OPENED IS FOUND AGAIN.
         *
         * `_sahayak_answer` opens the session at step 2b and stores the question
         * at step 5, both before the first delta — but `session_id` reaches this
         * client on the `final` frame alone, which a stopped or cut stream never
         * receives. So the FIRST answer of a thread ending early left `sessionId`
         * null with a live conversation sitting on the server: the follow-up
         * went out with `session_id: null`, the server opened a SECOND one, and
         * its history read returned nothing. The reader saw one continuous
         * conversation and asked "and for last month?"; the model had no idea
         * what "that" was, and the history sheet listed two conversations for
         * one exchange.
         *
         * The title is the handle — `sessionTitleFor` explains why it is the
         * only one available. Newest first, because the list comes back ordered
         * by `updated_at DESC` and the conversation this question just opened is
         * the one most recently touched. A miss is left alone: starting a new
         * conversation is what happens today and is better than adopting one
         * this question did not open.
         */
        if (!sessionId && clientId) {
          try {
            const list = await sahayakApi.sessions(clientId);
            const want = sessionTitleFor(sent.current);
            const mine = list.find(sn => sn.title === want);
            // Checked again after the round trip: the reader may have moved
            // conversations while this was in the air.
            if (mine && asking.current === thread.current) setSessionId(mine.id);
          } catch { /* No id, so the next question opens a fresh conversation. */ }
        }
        return;
      }

      /**
       * Drop the optimistic question, hand the words back, and THEN GO AND LOOK
       * — because a timeout is not a failure. `apiClient` is configured at 15
       * seconds and a RAG answer is an embedding call plus an optional re-rank
       * plus a completion; a slow one exceeds that while the server carries on,
       * stores the answer and keeps the charge. If a session exists, its stored
       * messages are the truth, so they are re-read and a question that
       * actually succeeded reappears with its answer rather than being lost
       * along with the credits it cost.
       */
      setTurns(prev => prev.filter(x => !(x.role === 'user' && x.key.startsWith('u-pending'))));
      /**
       * THE WORDS COME BACK, AND THEY COME BACK EVEN WHEN THE BOX IS FULL.
       *
       * The composer is cleared on send so the send feels immediate. If the
       * request then fails, the question goes straight back — unless the reader
       * has started typing the next one, in which case putting it back would
       * delete what they are in the middle of writing. That guard was right and
       * it was the whole story: the words were dropped on the floor instead.
       *
       * So they are parked where they can be seen and recovered. `draftRef`
       * rather than the `draft` this handler closed over, which is the value
       * from the render that started the send and is empty by definition.
       */
      const parked = !!draftRef.current.trim();
      if (parked) setUnsent(sent.current);
      else setDraft(sent.current);
      if (sessionId) {
        try {
          const stored = await sahayakApi.messages(sessionId);
          // WITH THE PARTIALS PUT BACK. The stored rows are the truth for
          // everything the server holds, and a stopped or cut answer is
          // precisely what it does not hold — `ai_router._record_abandoned`
          // writes no assistant row — so replacing the thread wholesale deleted
          // text the reader had already read, one turn later and with no
          // explanation. `withKeptPartials` says how the two are lined up.
          setTurns(prev => withKeptPartials(rowsToTurns(stored), prev));
        } catch (readErr: unknown) {
          /**
           * THE CONVERSATION IS GONE, so the phone must stop naming it.
           *
           * A session deleted from the web — or made inactive — 404s here and
           * on every send that carries its id, and holding on to it would make
           * every later question fail the same way with no way out but "New
           * conversation". The turns stay on screen; only the id is dropped, so
           * the next question opens a fresh conversation. Any other failure is
           * a failure to READ and says nothing about whether the session
           * exists.
           */
          if ((readErr as { response?: { status?: number } })?.response?.status === 404) {
            setSessionId(null);
          }
          /* The alert below is the one that matters. */
        }
      }
      Alert.alert(
        'Not answered',
        ((e instanceof StreamFailed ? e.message : friendly(e))
          ?? 'Could not reach the assistant. Your question was not sent.')
        // Said out loud when the words could not go back in the box, because
        // the row that holds them is the one thing on this screen a reader
        // would not think to look for — and a screen reader is inside this
        // alert, not near the composer.
        + (parked ? ' Your question is kept just above the box.' : ''),
      );
    },
  });

  const send = useCallback(() => {
    const question = draft.trim();
    if (!question || !clientId || ask.isPending) return;
    sent.current = question;
    setDraft('');
    setHot(null);
    setTurns(prev => [
      ...prev,
      { key: `u-pending-${Date.now()}`, role: 'user', content: question, sources: [] },
    ]);
    ask.mutate(question);
  }, [draft, clientId, ask]);

  /**
   * Stop. A real cancel, not a hidden spinner.
   *
   * `AbortController` reaches the native task through `expo/fetch`'s abort
   * subscription, so the socket actually closes; on the fallback path there is
   * nothing to abort and the button is not offered. The request had no timeout
   * of any kind before this — a stream that never ended left the composer
   * disabled until the app was killed.
   */
  const stop = useCallback(() => {
    if (!abort.current) return;
    stopped.current = true;
    abort.current.abort();
  }, []);

  // Newest at the bottom, so the list follows the answer as it arrives. Not an
  // inverted list, unlike ChatScreen: this conversation is read from the top
  // (the hero is above the first question) and is short enough that it never
  // pages backwards.
  //
  // The answer's own length is a dependency, so the list follows text as it
  // arrives — but the timeout is cleared and reset on every change, so a fast
  // stream produces ONE scroll when it pauses rather than a scroll per frame.
  // Repeatedly animating to the end while text is still arriving is the jitter
  // that makes a streaming chat harder to read than a static one.
  useEffect(() => {
    if (turns.length === 0 && !live) return;
    const id = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(id);
  }, [turns.length, ask.isPending, live?.text.length, live?.steps.length]);

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

      {/* The phone's version of the prototype's conversations rail. Only when a
          client is chosen: sessions are per client, so with none picked there is
          nothing this could list. */}
      {!!clientId && (
        <Pressable
          onPress={openHistory}
          hitSlop={8}
          {...a11yButton('Past conversations', 'Opens earlier chats with this client')}
        >
          <Ionicons name="time-outline" size={20} color={t.ink2} />
        </Pressable>
      )}

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

    /**
     * The `[n]` markers this turn can stand behind.
     *
     * Derived from the sources the SERVER attached to this answer, so a marker
     * with nothing behind it renders as the characters the model typed rather
     * than as a chip that opens nothing. A turn that ended early gets an empty
     * set: its text never reached `strip_invalid_refs` and every number in it
     * is still provisional.
     */
    const citeSources = item.partial ? undefined : item.sources;
    const edge = item.failed ? t.error : item.partial ? t.outline : t.outlineVar;

    return (
      <View style={s.aRow}>
        {/* The mark beside the answer, as `19-sahayak-final` draws it. Small and
            still — the animated one is the thinking state and using it here as
            well would leave the screen permanently in motion. */}
        <View style={s.aMark}>
          <Lotus size={26} color={item.failed ? t.error : t.primary} weight={1} />
        </View>

        <View style={s.aBody}>
          <View style={[s.aCard, { backgroundColor: t.surface, borderColor: edge }]}>
            {item.failed && (
              <Text style={[s.aFailed, { color: t.error }]}>
                {/* The server's own words when it has them. `refusal` names the
                    module, the source or the error — "could not answer" names
                    nothing and is the sentence somebody has to come and ask
                    about. Only falls back when the row predates the field. */}
                {item.refusal?.trim()
                  || 'The assistant could not answer. Your credits were refunded.'}
              </Text>
            )}
            {/* The order is the prototype's: what it did, what it found, then
                what it said. Reading the answer first and the steps after is
                how you end up trusting a number whose source failed. */}
            <Work rows={item.work} t={t} />
            <Figs figs={item.figs} t={t} wide={wide} />
            {/* CommonMark, the web's grammar — see `AnswerText` above and the
                header of `parseAnswer`. This used to be `RichText`, which is
                Slack's, and it made `*urgent*` bold here and italic there. */}
            <AnswerText
              text={item.content}
              t={t}
              color={t.ink}
              sources={citeSources}
              hot={hot?.key === item.key ? hot.n : null}
              /**
               * A tap on `[3]` lights source 3 below — and, when source 3 is a
               * web page, opens it, which is what the web's `<cite>` does with
               * its `hrefFor` map. Both, not either: the reader should be able
               * to see WHICH source they just followed when they come back.
               *
               * A knowledge-base chunk has nowhere to go — it is a fragment of
               * a document inside the product, not a destination — so it only
               * lights. `safeHref` decides, not the source's `type`.
               */
              onCite={n => {
                setHot({ key: item.key, n });
                const src = item.sources.find(x => Number(x.ref) === n);
                const href = src?.url ? safeHref(src.url) : null;
                if (href) openHref(href);
              }}
            />
            {/**
              * WHAT ENDED THIS TURN, AND ONLY WHAT IS TRUE OF THIS TURN.
              *
              * The credits clause used to be printed unconditionally, and it is
              * a claim about the server's books: `hub._refund_abandoned` PUTS
              * THE CREDIT BACK when the reader leaves before the provider is
              * asked — the guard runs from the charge up to the line before
              * `generate_stream`, which is precisely the window the Stop button
              * makes easy to hit. So a reader who stopped during "Thinking…"
              * was told they had paid for an answer they had just been
              * refunded for.
              *
              * Text having arrived is the one signal this screen can trust for
              * it: a delta means the provider generated tokens, which means the
              * provider billed us, which means the debit stands. With no text
              * the phone cannot know — the stop may have landed either side of
              * that line — so it says nothing about credits rather than
              * guessing, and it still never states a NUMBER, because
              * `credits_charged` rides on a `final` frame these turns never got.
              */}
            {item.partial && (
              <Text style={[s.stopNote, { color: t.ink3 }]}>
                {item.partial === 'stopped'
                  ? (item.content
                      ? 'You stopped this answer, so it is not complete and nothing in it is cited. The model had already written part of it, so it still cost credits.'
                      : 'You stopped this before any of the answer arrived.')
                  : `The answer stopped arriving part way through, so it is not complete and nothing in it is cited.${item.reason ? ` ${item.reason}` : ''}`}
              </Text>
            )}
          </View>

          <EvidenceTable ev={item.evidence} t={t} />

          {/* Not shown twice: when the answer FAILED the refusal is already the
              body above, so printing it again under the same card reads as the
              app repeating itself. */}
          {!item.failed && (
            <Refusal text={item.refusal} kind={item.refusalKind} t={t} />
          )}

          {item.sources.length > 0 && (
            <View style={s.sources}>
              <Text style={[s.sourcesHead, { color: t.ink3 }]}>
                SOURCES · {item.sources.length}
              </Text>
              {item.sources.map((src, i) => {
                // The ref arrives as a string on stored web sources, so it is
                // compared as a number rather than by identity.
                const n = Number(src.ref);
                const lit = hot?.key === item.key && Number.isInteger(n) && hot.n === n;
                return (
                  <View
                    key={`${item.key}-src-${i}`}
                    style={[
                      s.source,
                      lit && { backgroundColor: withAlpha(t.primary, 0.1), borderRadius: 6 },
                    ]}
                  >
                    <View style={[s.sourceRef, { backgroundColor: withAlpha(t.primary, lit ? 0.34 : 0.15) }]}>
                      <Text style={[s.sourceRefText, { color: t.primaryText }]}>
                        {src.ref ?? '·'}
                      </Text>
                    </View>
                    <Text style={[s.sourceText, { color: t.ink2 }]} numberOfLines={2}>
                      {src.title || src.url || 'Untitled'}
                    </Text>
                    {/* CORRECTED 2026-08-19: a web source DOES carry a ref —
                        `hub.py` numbers web results into the citable set, and 75
                        of the 77 stored ones have one, as a STRING. The old
                        comment here said the opposite and the web client acted
                        on it, which threw away nearly every citation the product
                        has ever made. The label says where the source came from,
                        which is a different fact from whether it is citable. */}
                    <Text style={[s.sourceKind, { color: t.ink3 }]}>
                      {src.type === 'web' ? 'WEB' : 'KB'}
                    </Text>
                  </View>
                );
              })}
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

  /**
   * The answer being written, right now.
   *
   * Three states in one block, and they are deliberately distinguishable:
   * nothing yet (the lotus alone), steps announced but no text (the lotus and
   * what is being read), and text arriving. Once text is arriving the lotus
   * stops being the subject — the answer is.
   *
   * The text is parsed with NO citable set. Nothing here has been validated, so
   * a `[2]` stays as the characters `[2]` until the final frame says otherwise.
   *
   * NOT A LIVE REGION, and the explicit "none" is the point rather than a
   * default written out. This block was `accessibilityLiveRegion="polite"`
   * wrapped around the answer itself — a promise to re-read the whole region on
   * every change, and it changes on every publish, which is every 60ms while
   * text is arriving. A sighted reader saw an answer growing; a TalkBack user
   * heard it restarted from the top some sixty times and could never reach the
   * end of it. `announce` marks the three moments that are worth saying.
   */
  const liveBlock = live ? (
    <View style={s.aRow} accessibilityLiveRegion="none">
      <View style={s.aMark}><Lotus size={26} color={t.primary} weight={1} /></View>
      <View style={s.aBody}>
        {live.steps.length > 0 && (
          <View style={s.work}>
            {live.steps.map((label, i) => (
              <View key={`ls${i}`} style={s.workRow}>
                <View style={[s.workDot, { backgroundColor: t.primary }]} />
                <Text style={[s.workLabel, { color: t.ink2 }]} numberOfLines={1}>{label}</Text>
              </View>
            ))}
          </View>
        )}
        {live.text
          ? (
            <View style={[s.aCard, { backgroundColor: t.surface, borderColor: t.outlineVar }]}>
              <AnswerText text={live.text} t={t} color={t.ink} />
            </View>
          )
          : <Text style={[s.thinkingText, { color: t.ink3 }]}>Thinking…</Text>}
      </View>
    </View>
  ) : null;

  return (
    <View style={[s.root, { backgroundColor: t.bg }]}>
      {header}

      {/* `height` on Android, not `undefined`.
       *
       * MEASURED on an Android 16 emulator 2026-08-07: the composer sat BEHIND
       * the keyboard and could not be reached — the question could be typed but
       * not sent. `undefined` here means "do nothing and let the window resize
       * itself", which relies on `windowSoftInputMode="adjustResize"` in the
       * manifest. That is set, and it stopped being honoured: under the
       * edge-to-edge display this build targets, the system no longer resizes
       * the window for the IME, so nothing moved.
       *
       * `LoginScreen` already passes `height` on Android and its field has
       * always been reachable on the same device — which is what made this a
       * one-line difference rather than a theory.
       */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
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
            contentContainerStyle={[s.scroll, wide && { maxWidth: measure }]}
            keyboardShouldPersistTaps="handled"
            // The hero is the WELCOME, so it goes once there is a conversation
            // to read. It used to sit above every thread, which was tolerable
            // when a thread was never more than the questions asked since the
            // app opened — now that a stored conversation can be loaded from
            // history, it would put a 104px lotus and two opener cards on top of
            // forty messages.
            ListHeaderComponent={turns.length === 0 ? hero : null}
            refreshControl={
              <Refresher
                refreshing={clientsQuery.isRefetching}
                onRefresh={clientsQuery.refetch}
              />
            }
            ListFooterComponent={liveBlock}
          />
        )}

        {/**
          * A QUESTION THAT WAS NOT SENT, AND IS NOT LOST.
          *
          * It gets here only when the composer already had something in it when
          * the send failed, so putting it straight back would have deleted what
          * the reader was in the middle of typing. Both texts matter and this
          * row is how both survive.
          *
          * THE TAP IS A SWAP, NOT AN OVERWRITE. What is in the composer comes
          * out and takes this text's place, so the recovery cannot itself be
          * the thing that loses something — and tapping twice puts everything
          * back where it was. Nothing here spends credits: it fills the box,
          * exactly like an opener card, and the reader still has to press send.
          */}
        {!!unsent && (
          <View style={[s.unsent, { backgroundColor: t.surface2, borderTopColor: t.outlineVar }]}>
            <Pressable
              style={s.unsentBody}
              onPress={() => { const held = draft; setDraft(unsent); setUnsent(held.trim() ? held : ''); }}
              {...a11yButton(
                `Not sent: ${unsent}`,
                'Puts this question back in the box, keeping whatever is in it now',
              )}
            >
              <Text style={[s.unsentLabel, { color: t.ink3 }]}>NOT SENT</Text>
              <Text style={[s.unsentText, { color: t.ink2 }]} numberOfLines={2}>{unsent}</Text>
            </Pressable>
            <Pressable onPress={() => setUnsent('')} hitSlop={10} {...a11yButton('Discard the unsent question')}>
              <Ionicons name="close" size={16} color={t.ink3} />
            </Pressable>
          </View>
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
          {/* STOP, and only where there is something to stop.
              A stream can be aborted — `expo/fetch` carries the signal down to
              the native task — so the button becomes a real cancel. On the
              plain `POST /chat` path there is nothing to abort: axios would
              resolve anyway, the server would finish, and a button that hid the
              answer instead of stopping it would be a lie about what it did.

              The hint does not say "it still costs credits" flatly any more.
              Stopping before the provider is asked is REFUNDED server-side by
              `hub._refund_abandoned`, and that window — the charge up to the
              line before `generate_stream` — is exactly the one this button
              makes easiest to hit, during "Thinking…". */}
          {ask.isPending && streaming ? (
            <Pressable
              onPress={stop}
              {...a11yButton('Stop', 'Stops reading the answer. If the model has already started writing, it still costs credits')}
              style={[s.send, { backgroundColor: t.surface3, borderWidth: 1, borderColor: t.outline }]}
            >
              <Ionicons name="stop" size={15} color={t.ink2} />
            </Pressable>
          ) : (
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
          )}
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

      {/*
        PAST CONVERSATIONS — the prototype's rail, folded into a sheet.

        There is no delete control here and that is deliberate. The endpoint
        exists (`DELETE /chat/sessions/{id}`, a soft delete), but on a phone a
        destructive control in a scrolling list is one mis-tap from a row that
        is the org's only record of what was asked and what it cost. Removing a
        conversation is a web action.
      */}
      <Sheet
        visible={historyOpen}
        onClose={() => setHistoryOpen(false)}
        closeLabel="Close past conversations"
        panelStyle={[s.sheet, { backgroundColor: t.surface }]}
      >
        <View style={[s.handle, { backgroundColor: t.outline }]} />
        <Text style={[s.sheetTitle, { color: t.ink }]}>Past conversations</Text>
        <Text style={[s.sheetSub, { color: t.ink3 }]}>
          {client ? `With ${client.name}. ` : ''}Opening one loads it and carries
          on where it stopped.
        </Text>

        <Pressable
          onPress={newConversation}
          style={({ pressed }) => [
            s.clientRow,
            { backgroundColor: pressed ? t.surface2 : 'transparent', borderColor: t.outlineVar },
          ]}
          {...a11yButton('New conversation', 'Starts an empty thread. Nothing is deleted')}
        >
          <Ionicons name="add" size={17} color={t.primaryText} />
          <Text style={[s.clientName, { color: t.primaryText }]}>New conversation</Text>
        </Pressable>

        {/* Loading, failed and genuinely-empty are three different sentences.
            One "no conversations" for all three is the false-empty defect this
            app has already shipped once. */}
        {sessionsQuery.isLoading ? (
          <View style={s.sheetBusy}><ActivityIndicator color={t.primary} /></View>
        ) : sessionsQuery.isError ? (
          <View style={s.sheetBusy}>
            <Text style={[s.sheetSub, { color: t.ink3 }]}>
              {friendly(sessionsQuery.error) ?? 'Could not load past conversations.'}
            </Text>
            <Pressable onPress={() => sessionsQuery.refetch()} {...a11yButton('Try again')}>
              <Text style={[s.sheetRetry, { color: t.primaryText }]}>Try again</Text>
            </Pressable>
          </View>
        ) : sessions.length === 0 ? (
          <Text style={[s.sheetSub, { color: t.ink3 }]}>
            Nothing yet. The first question you ask starts one.
          </Text>
        ) : (
          <ScrollView style={s.sheetScroll}>
            {sessions.map(sn => {
              const on = sn.id === sessionId;
              return (
                <Pressable
                  key={sn.id}
                  onPress={() => openSession(sn.id)}
                  disabled={!!opening}
                  style={({ pressed }) => [
                    s.clientRow,
                    {
                      backgroundColor: on ? t.primaryContainer : pressed ? t.surface2 : 'transparent',
                      borderColor: t.outlineVar,
                    },
                  ]}
                  {...a11yButton(on ? `${sn.title}, open` : sn.title)}
                >
                  <View style={s.clientRowBody}>
                    {/* Every line in a tonal row is recoloured — see the client
                        picker above for the three contrast failures that rule
                        comes from. */}
                    <Text
                      style={[s.clientName, { color: on ? t.onPrimaryContainer : t.ink }]}
                      numberOfLines={1}
                    >
                      {sn.title?.trim() || 'Untitled conversation'}
                    </Text>
                    <Text
                      style={[s.clientMeta, { color: on ? t.onPrimaryContainer : t.ink3 }]}
                      numberOfLines={1}
                    >
                      {whenLabel(sn.created_at)}
                      {' · '}
                      {sn.message_count} message{sn.message_count === 1 ? '' : 's'}
                    </Text>
                  </View>
                  {opening === sn.id
                    ? <ActivityIndicator size="small" color={on ? t.onPrimaryContainer : t.primary} />
                    : on ? <Ionicons name="checkmark" size={17} color={t.onPrimaryContainer} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </Sheet>
    </View>
  );
}

/**
 * When a conversation started, in as few characters as the row has room for.
 *
 * An absolute date once it is older than yesterday. "3 days ago" is the form
 * that makes somebody count backwards to work out whether it was the Tuesday
 * they are thinking of.
 */
function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (isToday(d)) return format(d, 'HH:mm');
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'd MMM yyyy');
}

/**
 * Stored rows → rendered turns.
 *
 * NO COST LINE ON A REBUILT TURN, AND IT IS A CHOICE RATHER THAN A LIMIT. This
 * once said the number was not available, and that stopped being true:
 * `_ANSWER_READBACK` lists `credits` and `credits_charged`, `_with_stored_answer`
 * lifts every key the blob carries onto the row, and `api/sahayak.storedAnswerOf`
 * copies both into the merged blob — so `GET /chat/sessions/{id}/messages` does
 * return them and `a.credits_charged` is there to be read. `Turn.credits` is
 * deliberately left unset anyway: the cost is a receipt for the request the user
 * just made, and re-stating it against history they scrolled back to would read
 * as a fresh charge.
 *
 * THE STRUCTURED HALF IS HYDRATED WHEN IT IS THERE. `hub_chat_messages.answer`
 * holds the work steps, the figures, the evidence and the refusal for every
 * answer since 2026-08-07 — migration 119 is applied and
 * `_sahayak_store_answer` writes it. `hub.sahayak_chat_history` now reads it
 * back, FLAT: it pops the column and lifts those keys onto the row, and does
 * not echo the blob under `answer` as well. `api/sahayak.cleanRow` is where the
 * two shapes become one, so this reads `r.answer` and finds the structure
 * whichever way the row carried it.
 *
 * Read defensively for the same reason it is read at all: an absent blob is
 * "this row carries no structure", never "this answer had no steps", so every
 * field falls back to undefined rather than to `[]`.
 *
 * A role the server has not used yet is dropped rather than guessed at. The
 * column is free text and only 'user' and 'assistant' are written today.
 */
function rowsToTurns(rows: ChatMessageRow[]): Turn[] {
  const out: Turn[] = [];
  for (const r of rows) {
    if (r.role !== 'user' && r.role !== 'assistant') continue;
    const a = (r.answer && typeof r.answer === 'object' ? r.answer : null) as
      Partial<SahayakAnswer> | null;
    out.push({
      key:     r.id,
      role:    r.role,
      content: r.content,
      sources: r.sources ?? [],
      model:   r.model_used ?? undefined,
      work:     Array.isArray(a?.work) ? a!.work : undefined,
      figs:     Array.isArray(a?.figs) ? a!.figs : undefined,
      evidence: a?.evidence ?? undefined,
      refusal:  typeof a?.refusal === 'string' ? a.refusal : undefined,
      refusalKind: a?.refusal_detail?.kind,
      answered: typeof a?.answered === 'boolean' ? a.answered : undefined,
      // Only the server's own verdict marks a stored turn failed. A row with no
      // blob has no verdict, and guessing one from the prose is the heuristic
      // `answered` was added to end.
      failed:   a?.answered === false,
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

  // ── The CommonMark blocks. Geometry only; every colour is applied inline
  //    from the theme, which is what lets one style object serve both themes.
  mdP:         { marginTop: 6 },
  mdH:         { fontWeight: '700', marginTop: 10, marginBottom: 1 },
  mdHr:        { height: StyleSheet.hairlineWidth, marginVertical: 11 },
  mdBold:      { fontWeight: '700' },
  mdItalic:    { fontStyle: 'italic' },
  mdLink:      { textDecorationLine: 'underline' },
  // The destination, beside the label. Not underlined and not the link colour:
  // it is what the link IS, not a second thing to tap.
  mdLinkHost:  { fontSize: 11.5 },
  // No padding and no borderRadius on either of these two: Android drops both
  // on a nested Text span and iOS applies them, so using either ships two
  // different products. The background tint is the one decoration that renders
  // the same on each.
  mdCode:      { fontFamily: FAMILY.mono, fontSize: 13 },
  mdCite:      { fontFamily: FAMILY.mono, fontSize: 11, fontWeight: '700' },
  mdPre:       { marginTop: 8, borderRadius: 8, padding: 10 },
  mdPreText:   { fontFamily: FAMILY.mono, fontSize: 12, lineHeight: 18 },
  mdList:      { marginTop: 6, gap: 3 },
  mdItem:      { flexDirection: 'row', gap: 7 },
  mdBullet:    { fontSize: 13.5, minWidth: 17 },
  mdItemText:  { flex: 1, minWidth: 0 },
  mdTableWrap: { marginTop: 8 },
  mdTr:        { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  mdTh:        { width: 132, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.4,
                 paddingVertical: 6, paddingRight: 10 },
  mdTd:        { width: 132, fontSize: 12, paddingVertical: 6, paddingRight: 10 },

  // ── The answer contract's own blocks, 2026-08-07 ────────────────────────
  //
  // Every colour is applied inline from the theme; only geometry lives here,
  // which is how the rest of this file is written and what lets one style
  // object serve both themes.
  work:        { marginTop: 2, marginBottom: 8, gap: 3 },
  workRow:     { flexDirection: 'row', alignItems: 'center', gap: 7 },
  workDot:     { width: 6, height: 6, borderRadius: 3 },
  workLabel:   { fontSize: 12, flexShrink: 1 },
  workNote:    { fontSize: 11, marginLeft: 'auto' },

  figs:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  fig:         { flexGrow: 1, flexBasis: '100%', borderWidth: 1, borderRadius: 10,
                 paddingVertical: 8, paddingHorizontal: 10 },
  figLabel:    { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.5 },
  figValue:    { fontSize: 19, fontWeight: '600', marginTop: 2 },
  figSub:      { fontSize: 11, marginTop: 1 },

  evWrap:      { marginTop: 8 },
  // 44dp of touch target, which is the floor — a disclosure that misses is a
  // control the reader concludes is decoration.
  evToggle:    { paddingVertical: 11 },
  evToggleText:{ fontSize: 12.5, fontWeight: '600' },
  evScroll:    { marginTop: 2 },
  evRow:       { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  evHead:      { width: 130, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.4,
                 paddingVertical: 6, paddingRight: 10 },
  evCell:      { width: 130, fontSize: 12, paddingVertical: 6, paddingRight: 10 },
  evMore:      { fontSize: 11, paddingTop: 6 },

  none:        { marginTop: 10, borderWidth: 1, borderRadius: 10, padding: 10 },
  noneTitle:   { fontSize: 12.5, fontWeight: '700', marginBottom: 3 },
  noneBody:    { fontSize: 12.5, lineHeight: 18 },

  sources:     { marginTop: 8, gap: 5 },
  sourcesHead: { fontSize: 9.5, fontWeight: '700', letterSpacing: 0.7 },
  source:      { flexDirection: 'row', alignItems: 'center', gap: 7 },
  sourceRef:   { width: 18, height: 18, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  sourceRefText: { fontSize: 10, fontWeight: '700' },
  sourceText:  { flex: 1, fontSize: 11.5 },
  sourceKind:  { fontSize: 9, fontWeight: '700', letterSpacing: 0.6 },

  cost: { fontSize: 10, marginTop: 6 },

  // The "Thinking…" row no longer has a box of its own. It sits inside the live
  // block, in the same lotus-and-body frame the answer will occupy, so the
  // layout does not jump the moment the first token lands.
  thinkingText: { fontSize: 12.5, paddingTop: 5 },

  // Sits directly on top of the composer, sharing its edge — it is about what
  // goes IN the box, not a notification about the conversation.
  unsent: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  // 44dp of target once the two lines and the padding are counted; a recovery
  // control that misses is a recovery that did not happen.
  unsentBody:  { flex: 1, minWidth: 0, paddingVertical: 2 },
  unsentLabel: { fontSize: 9.5, fontWeight: '700', letterSpacing: 0.7 },
  unsentText:  { fontSize: 12.5, lineHeight: 17, marginTop: 1 },

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
  sheetBusy:   { alignItems: 'center', gap: 8, paddingVertical: 18 },
  sheetRetry:  { fontSize: 13, fontWeight: '600', paddingVertical: 8 },
  stopNote:    { fontSize: 11.5, lineHeight: 17, marginTop: 8 },
  clientRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderRadius: 10, padding: 11, marginBottom: 7,
  },
  clientRowBody: { flex: 1, minWidth: 0 },
  clientName: { fontSize: 14, fontWeight: '600' },
  clientMeta: { fontSize: 11.5, marginTop: 2 },
});
