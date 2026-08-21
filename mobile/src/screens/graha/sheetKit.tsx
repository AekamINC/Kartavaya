import React from 'react';
import {
  View, Text, TextInput, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import BiLabel from '../../theme/BiLabel';
import { SEP } from '../../theme/labels';
import { display } from '../../theme/fonts';
import { a11yButton, a11yInput, a11ySelected } from '../../components/a11y';

/**
 * The pieces the three CRM sheets share.
 *
 * Lifted out rather than copied because there are three of them and
 * `NewTaskSheet.tsx` — the template all of this follows — is 772 lines with its
 * field styles inlined. Three more copies of that stylesheet is how a design
 * system drifts: the sixth scrim opacity, the tenth priority map. The header of
 * `Sheet.tsx` records both of those happening here already.
 *
 * Nothing in this file fetches or writes. It is presentation only, so the
 * sheets that use it stay about their own endpoint.
 */

// ── Labels ───────────────────────────────────────────────────────────────────

/**
 * A field label — the Latin kicker and its Devanagari twin, as TWO props.
 *
 * Every other bilingual label in this app is written as one string with a
 * middot (`PROJECT · परियोजना`) and split inside `BiLabel`. This one takes the
 * halves separately, for a reason that is specific to a SHARED component:
 *
 * `screens/__tests__/devanagari.test.ts` enforces the split by reading the file
 * the literal appears in and looking for the split in the component that
 * encloses it. That works when the label component is local — `NewTaskSheet`
 * declares its own `FieldLabel` — and it cannot work when the component lives
 * in another file, because the sweep has no way to follow the import. The check
 * is right and the sweep is the only guard mobile has on this, so the answer is
 * not to weaken it.
 *
 * Taking two props is the stronger fix anyway: there is no fused string in
 * these sheets at all, so the defect the rule exists to prevent — one <Text>
 * carrying `letterSpacing: 1.2` and `fontWeight: '800'` across both scripts —
 * is not merely caught here, it is unrepresentable.
 */
export function FieldLabel({ latin, hindi }: { latin: string; hindi: string }) {
  const { t } = useTheme();
  return (
    <BiLabel
      style={{ marginBottom: 8, marginTop: 16 }}
      latinStyle={{ fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: t.primary }}
      hindiStyle={{ color: t.primaryText }}
      hindiSize={11}
    >
      {`${latin} ${SEP} ${hindi}`}
    </BiLabel>
  );
}

// ── Chips ────────────────────────────────────────────────────────────────────

export interface ChipOption { key: string; label: string; tone?: string }

/**
 * A single-select row of chips.
 *
 * Wraps rather than scrolls horizontally. A stage list is six or seven short
 * words and a rep must be able to SEE the one they are moving to — a horizontal
 * scroller hides the terminal stages off the right edge, which are exactly the
 * two that matter at the end of a call.
 */
export function ChipSelect({ options, value, onChange, disabled }: {
  options: readonly ChipOption[];
  value:   string | null;
  onChange: (key: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTheme();
  return (
    <View style={s.chipWrap}>
      {options.map(o => {
        const on = value === o.key;
        const tone = o.tone ?? t.primary;
        return (
          <TouchableOpacity
            key={o.key}
            onPress={() => onChange(o.key)}
            disabled={disabled}
            style={[
              s.chip,
              { borderColor: t.outline, backgroundColor: t.bg },
              on && { borderColor: tone, backgroundColor: tone + '1F' },
              disabled && { opacity: 0.45 },
            ]}
            {...a11ySelected(o.label, on)}
            accessibilityState={{ selected: on, disabled: !!disabled }}
          >
            <Text style={[s.chipText, { color: on ? tone : t.ink3 }, on && { fontWeight: '700' }]}>
              {o.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ── Text fields ──────────────────────────────────────────────────────────────

export function Field({ value, onChangeText, placeholder, label, multiline, invalid, autoFocus }: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  /** The accessible name. RN has no `aria-describedby`, so an invalid field
   *  carries its own state in its name — the pattern `NewTaskSheet` settled on. */
  label: string;
  multiline?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
}) {
  const { t } = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={t.ink3}
      style={[
        s.input,
        { borderColor: invalid ? t.error : t.outline, backgroundColor: t.bg, color: t.ink },
        multiline && s.inputMulti,
      ]}
      multiline={multiline}
      textAlignVertical={multiline ? 'top' : 'center'}
      autoFocus={autoFocus}
      {...a11yInput(invalid ? `${label}, required` : label)}
    />
  );
}

// ── Messages ─────────────────────────────────────────────────────────────────

/**
 * A refusal, announced.
 *
 * `accessibilityLiveRegion` and `role="alert"` are both here on purpose: a
 * write that failed is the one message a user must not miss, and on a sheet
 * they are looking at the button, not the text under it.
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

/** A statement of fact about the connection, not a failure. Amber, not red. */
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

// ── The frame ────────────────────────────────────────────────────────────────

/**
 * Handle, header, scrolling body, pinned footer button.
 *
 * The submit button stays OUT of the scroll view. On a 393pt screen with the
 * keyboard up, a footer inside the scroller sits below the fold and the sheet
 * looks like it has no way to finish.
 */
export function SheetBody({ kickerLatin, kickerHindi, title, onClose, children, submitLabel, onSubmit, submitting, canSubmit }: {
  /** The two halves of the header kicker. Two props for the reason FieldLabel
   *  states above — a shared component cannot carry the fused literal. */
  kickerLatin: string;
  kickerHindi: string;
  title:   string;
  onClose: () => void;
  children: React.ReactNode;
  submitLabel: string;
  onSubmit: () => void;
  submitting: boolean;
  canSubmit: boolean;
}) {
  const { t } = useTheme();
  return (
    <>
      <View style={[s.handle, { backgroundColor: t.outline }]} />

      <View style={[s.header, { borderBottomColor: t.outline }]}>
        <View style={{ flex: 1 }}>
          <BiLabel
            latinStyle={{ fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: t.primary }}
            hindiStyle={{ color: t.primaryText }}
            hindiSize={11}
            style={{ marginBottom: 2 }}
          >
            {`${kickerLatin} ${SEP} ${kickerHindi}`}
          </BiLabel>
          <Text style={[s.headerTitle, { color: t.ink }]} numberOfLines={2}>{title}</Text>
        </View>
        <TouchableOpacity onPress={onClose} hitSlop={12} {...a11yButton('Close')}>
          <Ionicons name="close" size={22} color={t.ink3} accessibilityElementsHidden />
        </TouchableOpacity>
      </View>

      <ScrollView style={s.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {children}
        <View style={{ height: 24 }} />
      </ScrollView>

      <View style={[s.footer, { borderTopColor: t.outline }]}>
        <TouchableOpacity
          onPress={onSubmit}
          disabled={!canSubmit || submitting}
          style={[s.btn, { backgroundColor: t.primary }, (!canSubmit || submitting) && s.btnDisabled]}
          {...a11yButton(submitLabel)}
          accessibilityState={{ disabled: !canSubmit || submitting, busy: submitting }}
        >
          {submitting
            ? <ActivityIndicator color={t.onPrimary} size="small" />
            : <Text style={[s.btnText, { color: t.onPrimary }]}>{submitLabel}</Text>}
        </TouchableOpacity>
      </View>
    </>
  );
}

/** The panel shape every CRM sheet uses. Passed to `Sheet`'s `panelStyle`. */
export function panelStyle(t: ReturnType<typeof useTheme>['t']) {
  return {
    backgroundColor: t.surface,
    borderTopLeftRadius:  24,
    borderTopRightRadius: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
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

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1.5,
    // 44pt to the finger without a 44pt chip: the row would look like buttons
    // for giants at the size the spec draws them.
    minHeight: 36, justifyContent: 'center',
  },
  chipText: { fontSize: 13, fontWeight: '600' },

  input: {
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 11,
    fontSize: 14, minHeight: 44,
  },
  inputMulti: { minHeight: 88, paddingTop: 12 },

  note: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 11, paddingVertical: 9,
    marginTop: 16,
  },
  noteText: { flex: 1, fontSize: 12, lineHeight: 17 },

  btn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', minHeight: 48, justifyContent: 'center' },
  btnDisabled: { opacity: 0.45 },
  btnText: { fontWeight: '700', fontSize: 15 },
});
