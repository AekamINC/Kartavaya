/**
 * RichText — a message body, rendered.
 *
 * `lib/richText.ts` turns the body into tokens; this turns tokens into React
 * Native. The split is the web's, and it is load-bearing: one parser, one
 * renderer, and no second path that can drift from either.
 *
 * ── No CSS means the style budget is explicit ────────────────────────────────
 *
 * The web leaned on `.msg__b { white-space: pre-wrap }` to lay out the newlines
 * in an unformatted message. React Native's `<Text>` renders `\n` literally, so
 * that behaviour is native here — which is why a `p` block needs no wrapper at
 * all, and why a message with no formatting in it produces exactly the node
 * `ChatScreen` rendered before this component existed. Nothing regresses for the
 * 95% of messages that are plain text.
 *
 * Two places where "no CSS" bites, both settled here rather than per call site:
 *
 *  · A nested `<Text>` span accepts `backgroundColor` on both platforms but
 *    IGNORES `padding` and `borderRadius` on Android while honouring them on
 *    iOS. Inline code is therefore a background-coloured span with no box —
 *    using either would ship two different products.
 *  · A `<View>` cannot be nested inside a `<Text>`, so a body containing a code
 *    block, a quote or a list returns a `<View>` holding an ALTERNATING sequence
 *    of `<Text>` runs and block `<View>`s. The `p` runs stay `<Text>`;
 *    collapsing everything into rows would break selection and hyphenation
 *    across a paragraph.
 *
 * ── This component never names a font family for body text ───────────────────
 *
 * A Hindi sentence typed by a colleague is CONTENT, not a UI label, so it does
 * not go through `hindi()`. Two reasons, and the second is the one with teeth:
 * the reader's own message should render in the face their OS picked for their
 * script, and forcing Tiro would drag the `fontWeight: '700'` that `*bold*`
 * needs onto a face that ships only a 400 — which is the synthetic-weight defect
 * `screens/__tests__/devanagari.test.ts` exists to catch. Only `code` and `pre`
 * name a family, and it is `FAMILY.mono`, which is Latin-only by design and only
 * ever wraps text the author explicitly marked as code.
 *
 * For the same reason this file is deliberately NOT added to `allViewFiles()` in
 * that test: it carries no Devanagari literals and it must not use the Tiro face.
 */
import React, { useMemo } from 'react';
import { View, Text, ScrollView, Linking, StyleSheet, type TextStyle } from 'react-native';

import { parseRich, type Block, type Leaf } from '../lib/richText';
import { useTheme } from '../theme/ThemeProvider';
import { FAMILY } from '../theme/fonts';
import { withAlpha } from '../theme/tokens';

export interface RichTextProps {
  /**
   * The message body. Never HTML — there is no `innerHTML` on this platform, so
   * the injection class the web parser defends against does not exist here.
   * What DOES survive the platform change is `href`: `safeHref` is an allowlist
   * and `Linking.openURL` will happily place a call for `tel:`. Keep it.
   */
  text: string;
  /** Display names known on this surface — the senders in the loaded page. Lets
   *  a mention of a colleague who has not posted yet still highlight. */
  names?: string[];
  /** The current user's display name. Its mention renders in the "me" tone. */
  meName?: string | null;
  /** Base colour for ordinary body text. REQUIRED, and with no default on
   *  purpose — a fallback here would silently ignore the caller's theme. */
  color: string;
  /** Base size / rhythm. ChatScreen passes 14.5 / 20 to match its `s.content`. */
  fontSize?: number;
  lineHeight?: number;
  /** Search and mentions rows render a one-line preview: every block collapses
   *  to plain runs, `numberOfLines` applies, and pre/quote/list get no box. */
  compact?: boolean;
  numberOfLines?: number;
  /**
   * This text sits on a FILLED surface (an own-message bubble), not on the
   * page. Links, mentions, code and quote markers then derive from `color`
   * instead of the page-foreground tokens, because those were picked for the
   * page ground and one of them — `primaryText` — is literally the bubble's
   * own fill in the scoped dark palette. Default false: every caller drawing
   * on the page ground keeps the accent colours it has always had.
   */
  tonal?: boolean;
}

/**
 * A tap on a link.
 *
 * `href` has already been through `safeHref`'s allowlist — an `a` token does not
 * exist for anything but `http://` and `https://` — so this does not re-derive
 * it, and in particular never reads the LABEL, which is the author's text and
 * can say anything at all. A URL with no handler rejects; swallowing that is
 * correct, since there is nothing to tell the reader beyond "your phone has no
 * browser".
 */
const openHref = (href: string) => { Linking.openURL(href).catch(() => {}); };

export default function RichText({
  text,
  names,
  meName = null,
  color,
  fontSize = 14.5,
  lineHeight = 20,
  compact = false,
  numberOfLines,
  tonal = false,
}: RichTextProps) {
  const { t } = useTheme();

  // Keyed on the JOINED names rather than the array, so a parent that builds a
  // fresh `names` array in its render (which every list row does) does not
  // re-parse every message body on every scroll frame.
  const namesKey = names ? names.join('\u0000') : '';
  const blocks = useMemo(
    () => parseRich(text, { names, meName }),
    // `namesKey` stands in for `names` here on purpose: it changes exactly
    // when the contents do.
    [text, namesKey, meName],
  );

  const base: TextStyle = { color, fontSize, lineHeight };

  /**
   * Every run this component draws must come from `color`, not from the page
   * palette.
   *
   * This used to paint links and mentions with `t.primaryText`, inline code
   * and its background with `t.ink`, and quotes and bullets with `t.ink3` —
   * all page-foreground tokens, chosen for the page ground. On a message
   * bubble filled with `t.primary` that is wrong, and in the scoped dark
   * palette it is invisible: `primaryText` and `primary` are the same literal
   * (#4ADECD), so a URL inside your own bubble was drawn in exactly the
   * bubble's fill — measured at 1.00:1 dark and 1.20:1 light. The link stayed
   * tappable and rendered as a blank gap the width of the text.
   *
   * `tonal` says "you are on a filled surface". Then contrast comes from the
   * underline and from alpha, never from hue — the one thing that is safe when
   * the fill colour is not known here. The caller already passes the correct
   * foreground for its surface as `color`; deriving from it is what makes
   * "EVERY line in it must be recoloured" true rather than aspirational.
   */
  const codeStyle: TextStyle = {
    fontFamily: FAMILY.mono,
    fontSize: fontSize - 1.5,
    // No padding and no borderRadius. Android drops both on a nested Text span
    // and iOS applies them; a background colour is the one decoration that
    // renders the same on each.
    backgroundColor: withAlpha(tonal ? color : t.ink, 0.08),
    color: tonal ? color : t.ink,
  };
  const linkStyle: TextStyle = {
    color: tonal ? color : t.primaryText,
    textDecorationLine: 'underline',
  };
  // Quotes and list markers are deliberately quieter than body text. On a fill
  // that is alpha off the same foreground; on the page it is the muted ramp.
  const mutedColor = tonal ? withAlpha(color, 0.75) : t.ink3;

  const renderLeaves = (kids: Leaf[], kp: string): React.ReactNode[] =>
    kids.map((n, i) => {
      const k = `${kp}.${i}`;
      if (typeof n === 'string') return <React.Fragment key={k}>{n}</React.Fragment>;
      switch (n.k) {
        // Verbatim. A code span is the one leaf the parser promises nothing else
        // touches, and this renderer keeps that promise.
        case 'code':
          return <Text key={k} style={codeStyle}>{n.text}</Text>;
        case 'b':
          return <Text key={k} style={s.bold}>{renderLeaves(n.kids, k)}</Text>;
        case 'i':
          return <Text key={k} style={s.italic}>{renderLeaves(n.kids, k)}</Text>;
        case 's':
          return <Text key={k} style={s.strike}>{renderLeaves(n.kids, k)}</Text>;
        case 'a':
          return (
            <Text
              key={k}
              style={linkStyle}
              onPress={() => openHref(n.href)}
              accessibilityRole="link"
              accessibilityHint="Opens in your browser"
            >
              {n.text}
            </Text>
          );
        // The "me" tint is the whole point of the badge: a mention of somebody
        // else must not look like a mention of you.
        case 'mn':
          return (
            <Text
              key={k}
              style={[
                s.mention,
                { color: tonal ? color : t.primaryText },
                n.me ? { backgroundColor: withAlpha(t.primary, 0.18) } : null,
              ]}
            >
              {n.mention}
            </Text>
          );
        default:
          return null;
      }
    });

  /**
   * A preview row. Everything becomes ONE `<Text numberOfLines>`: a block that
   * kept its box inside a 44pt list row would push the row to full height, which
   * is what a `compact` without a `numberOfLines` (or the reverse) produces.
   * Inline tone is kept — a mentions row where your own name is not tinted is a
   * mentions row that has lost its subject.
   */
  if (compact) {
    const runs: React.ReactNode[] = [];
    blocks.forEach((b, i) => {
      const k = `b${i}`;
      if (i > 0) runs.push(<React.Fragment key={`${k}.gap`}>{' '}</React.Fragment>);
      if (b.k === 'pre') { runs.push(<React.Fragment key={k}>{b.text}</React.Fragment>); return; }
      if (b.k === 'ul' || b.k === 'ol') {
        b.items.forEach((it, j) => {
          if (j > 0) runs.push(<React.Fragment key={`${k}.${j}.gap`}>{' '}</React.Fragment>);
          runs.push(...renderLeaves(it, `${k}.${j}`));
        });
        return;
      }
      runs.push(...renderLeaves(b.kids, k));
    });
    return <Text style={base} numberOfLines={numberOfLines}>{runs}</Text>;
  }

  const renderBlock = (b: Block, i: number): React.ReactNode => {
    const k = `b${i}`;
    switch (b.k) {
      // Horizontal scroll rather than wrap: a wrapped stack trace is unreadable,
      // and a stack trace is what people paste.
      case 'pre':
        return (
          <View key={k} style={[s.pre, { backgroundColor: t.surface3 }]}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.prePad}
            >
              <Text style={{ fontFamily: FAMILY.mono, fontSize: fontSize - 1.5, color: t.ink2 }}>
                {b.text}
              </Text>
            </ScrollView>
          </View>
        );
      case 'quote':
        return (
          <View key={k} style={[s.quote, { borderLeftColor: t.outline }]}>
            <Text style={[base, { color: mutedColor }]}>{renderLeaves(b.kids, k)}</Text>
          </View>
        );
      case 'ul':
        return (
          <View key={k}>
            {b.items.map((it, j) => (
              <View key={`${k}.${j}`} style={s.item}>
                <Text style={[base, { color: mutedColor }]}>{'•'}</Text>
                {/* `flex: 1` is load-bearing: without it a long item overflows
                    the row instead of wrapping inside it. */}
                <Text style={[base, s.itemBody]}>{renderLeaves(it, `${k}.${j}`)}</Text>
              </View>
            ))}
          </View>
        );
      case 'ol':
        return (
          <View key={k}>
            {b.items.map((it, j) => (
              <View key={`${k}.${j}`} style={s.item}>
                <Text style={[base, { color: mutedColor }]}>{`${b.start + j}.`}</Text>
                <Text style={[base, s.itemBody]}>{renderLeaves(it, `${k}.${j}`)}</Text>
              </View>
            ))}
          </View>
        );
      default:
        return <Text key={k} style={base}>{renderLeaves(b.kids, k)}</Text>;
    }
  };

  // The common case, kept as the bare node it has always been. A wrapper View
  // around a single paragraph would change the layout of every plain message in
  // the product to buy nothing.
  if (blocks.length === 0) return <Text style={base} />;
  if (blocks.length === 1 && blocks[0].k === 'p') {
    return renderBlock(blocks[0], 0) as React.ReactElement;
  }

  return <View>{blocks.map(renderBlock)}</View>;
}

const s = StyleSheet.create({
  bold:   { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  mention: { fontWeight: '700' },

  pre:    { borderRadius: 8, paddingVertical: 8, marginVertical: 6 },
  prePad: { paddingHorizontal: 10 },

  quote:  { borderLeftWidth: 3, paddingLeft: 10, marginVertical: 4 },

  item:     { flexDirection: 'row', gap: 8 },
  itemBody: { flex: 1 },
});
