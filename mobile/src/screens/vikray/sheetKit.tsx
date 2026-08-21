import React from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import { display } from '../../theme/fonts';
import { a11yButton, a11ySelected } from '../../components/a11y';

/**
 * The pieces the three Sales sheets share.
 *
 * ── WHY THIS IS NOT `screens/graha/sheetKit.tsx` ─────────────────────────────
 *
 * That file exists, it is very close to this one, and importing it was the
 * first thing tried. It is not imported for an ownership reason rather than a
 * technical one: `screens/graha/**` belongs to another agent in this same pass
 * and its exports are still moving. A cross-directory import into an in-flight
 * file is a merge conflict waiting to be discovered at integration, on a
 * Saturday, by whoever renamed a prop.
 *
 * So this duplicates it deliberately and says so. THE RIGHT END STATE IS ONE
 * KIT in `components/`, and it is flagged in the report rather than taken here
 * — promoting a shared component while two agents are writing against it is the
 * same risk in the other direction.
 *
 * Nothing here fetches or writes. Presentation only, so each sheet stays about
 * its own endpoint.
 */

// ── Labels ───────────────────────────────────────────────────────────────────

/**
 * The kicker's two type styles, as PROPS for `BiLabel` rather than as a wrapper
 * component — and that shape is load-bearing.
 *
 * `screens/__tests__/devanagari.test.ts` walks back from every
 * `LATIN · देवनागरी` string to the tag that encloses it and demands it be a
 * `BiLabel`, or a wrapper it can prove splits the two runs BY READING THE SAME
 * FILE. A wrapper defined here and used over in a sheet is invisible to it, so
 * `<FieldLabel>LINES · पंक्तियाँ</FieldLabel>` fails the sweep even though the
 * wrapper is correct. (That is exactly the failure `screens/graha/` is showing
 * on this branch — nine offenders, all of them false alarms about correct code.)
 *
 * Handing back styles instead means every call site literally reads
 * `<BiLabel {...kickerStyles(t)}>ORDER · आदेश</BiLabel>`, which the sweep
 * accepts and which is also just true: BiLabel really is the component drawing
 * it. One <Text> holding both scripts would put `letterSpacing: 1.2` and
 * `fontWeight: '800'` on the Devanagari — RN applies tracking after shaping, so
 * that breaks the shirorekha, and Tiro ships no bold for the weight to find.
 */
export function kickerStyles(t: ReturnType<typeof useTheme>['t']) {
  return {
    latinStyle: { fontSize: 10, fontWeight: '800' as const, letterSpacing: 1.2, color: t.primary },
    hindiStyle: { color: t.primaryText },
    hindiSize:  11,
  };
}

// ── Choices ──────────────────────────────────────────────────────────────────

export interface ChoiceOption {
  key:   string;
  label: string;
  /** One line saying what picking this actually DOES. Never decorative. */
  note?: string;
  tone?: string;
}

/**
 * A single-select list of options, each with its consequence under it.
 *
 * A ROW LIST AND NOT A CHIP ROW, unlike the CRM's stage picker, and the reason
 * is the payload: a stage move rewrites one word, while `confirmed` deducts
 * stock for every catalogued line on the order and `cancelled` puts it back.
 * Those need a sentence beside them, and a sentence does not fit in a chip.
 *
 * Selection alone commits nothing — the caller still has a confirm button. Two
 * steps for a write that moves inventory is the same reasoning that puts the
 * decline reason behind a sheet on Approvals.
 */
export function ChoiceList({ options, value, onChange, disabled }: {
  options:  readonly ChoiceOption[];
  value:    string | null;
  onChange: (key: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTheme();
  return (
    <View style={{ gap: 8 }}>
      {options.map(o => {
        const on   = value === o.key;
        const tone = o.tone ?? t.primary;
        return (
          <TouchableOpacity
            key={o.key}
            onPress={() => onChange(o.key)}
            disabled={disabled}
            style={[
              s.choice,
              { borderColor: t.outline, backgroundColor: t.bg },
              on && { borderColor: tone, backgroundColor: tone + '14' },
              disabled ? { opacity: 0.45 } : null,
            ]}
            {...a11ySelected(o.note ? `${o.label}. ${o.note}` : o.label, on)}
            accessibilityState={{ selected: on, disabled: !!disabled }}
          >
            <View style={[s.radio, { borderColor: on ? tone : t.outline }]}>
              {on && <View style={[s.radioDot, { backgroundColor: tone }]} />}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[s.choiceLabel, { color: on ? tone : t.ink }]}>{o.label}</Text>
              {!!o.note && (
                <Text style={[s.choiceNote, { color: t.ink3 }]}>{o.note}</Text>
              )}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ── Messages ─────────────────────────────────────────────────────────────────

/**
 * A refusal, announced.
 *
 * `accessibilityRole="alert"` and an assertive live region together: a write
 * that failed is the one message a user must not miss, and on a sheet they are
 * looking at the button, not at the text beneath it.
 */
export function ErrorNote({ text }: { text: string }) {
  const { t } = useTheme();
  return (
    <View style={[s.note, { backgroundColor: t.errorBg, borderColor: t.error }]}>
      <Ionicons name="alert-circle-outline" size={15} color={t.onErrorContainer} accessibilityElementsHidden />
      <Text
        style={[s.noteText, { color: t.onErrorContainer }]}
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
      >
        {text}
      </Text>
    </View>
  );
}

/** A statement of fact — about the connection, a grant, a side effect. Amber. */
export function InfoNote({ text, icon = 'information-circle-outline' }: {
  text: string;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const { t } = useTheme();
  return (
    <View style={[s.note, { backgroundColor: t.approvalBg, borderColor: t.approval }]}>
      <Ionicons name={icon} size={15} color={t.onApprovalContainer} accessibilityElementsHidden />
      <Text style={[s.noteText, { color: t.onApprovalContainer }]}>{text}</Text>
    </View>
  );
}

/** A settled outcome worth keeping on screen — an invoice number, an order number. */
export function GoodNote({ text }: { text: string }) {
  const { t } = useTheme();
  return (
    <View style={[s.note, { backgroundColor: t.successBg, borderColor: t.success }]}>
      <Ionicons name="checkmark-circle-outline" size={15} color={t.onSuccessContainer} accessibilityElementsHidden />
      <Text
        style={[s.noteText, { color: t.onSuccessContainer }]}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
      >
        {text}
      </Text>
    </View>
  );
}

// ── The frame ────────────────────────────────────────────────────────────────

/**
 * Handle, header, scrolling body, pinned footer.
 *
 * `kicker` is a NODE, not a string, so the call site can pass a real `BiLabel`.
 * See `kickerStyles` for why that matters beyond taste.
 *
 * The footer stays OUT of the scroll view: on a 393pt screen a footer inside
 * the scroller sits below the fold and the sheet looks like it has no way to
 * finish.
 */
export function SheetFrame({ kicker, title, onClose, children, footer }: {
  kicker:   React.ReactNode;
  title:    string;
  onClose:  () => void;
  children: React.ReactNode;
  /** Omitted entirely on a read-only sheet, rather than rendered empty. */
  footer?:  React.ReactNode;
}) {
  const { t } = useTheme();
  return (
    <>
      <View style={[s.handle, { backgroundColor: t.outline }]} />

      <View style={[s.header, { borderBottomColor: t.outline }]}>
        <View style={{ flex: 1 }}>
          {kicker}
          <Text style={[s.headerTitle, { color: t.ink }]} numberOfLines={2} accessibilityRole="header">
            {title}
          </Text>
        </View>
        <TouchableOpacity onPress={onClose} hitSlop={12} {...a11yButton('Close')}>
          <Ionicons name="close" size={22} color={t.ink3} accessibilityElementsHidden />
        </TouchableOpacity>
      </View>

      <ScrollView style={s.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {children}
        <View style={{ height: 24 }} />
      </ScrollView>

      {!!footer && (
        <View style={[s.footer, { borderTopColor: t.outline }]}>{footer}</View>
      )}
    </>
  );
}

/** The one filled button a sheet gets. `tone` recolours it for a destructive move. */
export function PrimaryButton({ label, onPress, busy, disabled, tone, onTone }: {
  label:    string;
  onPress:  () => void;
  busy?:    boolean;
  disabled?: boolean;
  tone?:    string;
  onTone?:  string;
}) {
  const { t } = useTheme();
  const bg   = tone   ?? t.primary;
  const fg   = onTone ?? t.onPrimary;
  const dead = !!disabled || !!busy;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={dead}
      style={[s.btn, { backgroundColor: bg }, dead && s.btnDisabled]}
      {...a11yButton(label)}
      accessibilityState={{ disabled: dead, busy: !!busy }}
    >
      {busy
        ? <ActivityIndicator color={fg} size="small" />
        : <Text style={[s.btnText, { color: fg }]}>{label}</Text>}
    </TouchableOpacity>
  );
}

/** One `label · value` line. The read-only half of every sheet here. */
export function DetailRow({ label, value, tone, mono }: {
  label: string;
  value: string;
  tone?: string;
  /** Tabular figures for money and quantities, so columns of them line up. */
  mono?: boolean;
}) {
  const { t } = useTheme();
  return (
    <View style={s.detailRow} accessibilityLabel={`${label}: ${value}`}>
      <Text style={[s.detailLabel, { color: t.ink3 }]} numberOfLines={1}>{label}</Text>
      <Text
        style={[s.detailValue, { color: tone ?? t.ink }, mono ? s.tabular : null]}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}

/** The panel shape every Sales sheet uses. Passed to `Sheet`'s `panelStyle`. */
export function panelStyle(t: ReturnType<typeof useTheme>['t']) {
  return {
    backgroundColor: t.surface,
    borderTopLeftRadius:  24,
    borderTopRightRadius: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    // Never full height. A sheet that reaches the status bar reads as a screen
    // that arrived from the wrong direction, and the strip of scrim above it is
    // the only affordance saying the list is still underneath.
    maxHeight: '92%' as const,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 20,
  };
}

const s = StyleSheet.create({
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // Newsreader, like every other sheet header — not the platform serif, which
  // resolves to two different typefaces on the two platforms.
  headerTitle: { fontSize: 20, ...display(400) },
  body:   { paddingHorizontal: 20, paddingTop: 4 },
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },

  choice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 11,
    borderWidth: 1.5, borderRadius: 12,
    paddingHorizontal: 13, paddingVertical: 11,
    // 44pt to the finger, per MOTION-SPEC §5's Touch column.
    minHeight: 48,
  },
  radio: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  radioDot:   { width: 10, height: 10, borderRadius: 5 },
  choiceLabel: { fontSize: 14.5, fontWeight: '700' },
  choiceNote:  { fontSize: 12, lineHeight: 16.5, marginTop: 2 },

  note: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 11, paddingVertical: 9,
    marginTop: 14,
  },
  noteText: { flex: 1, fontSize: 12, lineHeight: 17 },

  detailRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingVertical: 5,
  },
  detailLabel: { flex: 1, fontSize: 12.5 },
  detailValue: { flexShrink: 1, fontSize: 13.5, fontWeight: '700', textAlign: 'right' },
  tabular:     { fontVariant: ['tabular-nums'] },

  btn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', minHeight: 48, justifyContent: 'center' },
  btnDisabled: { opacity: 0.45 },
  btnText: { fontWeight: '700', fontSize: 15 },
});
