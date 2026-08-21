import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../../theme/ThemeProvider';
import { useOnline } from '../../hooks/useOnline';
import Sheet from '../../components/Sheet';
import BiLabel from '../../theme/BiLabel';
import { a11yButton, a11yInput } from '../../components/a11y';
import { num } from '../../api/modules';
import {
  vikrayWriteApi, vikrayWriteError, VIKRAY_OFFLINE_NOTE, type StockRow,
} from '../../api/vikray';
import {
  SheetFrame, PrimaryButton, ErrorNote, InfoNote, GoodNote, DetailRow,
  kickerStyles, panelStyle,
} from './sheetKit';

/**
 * Adjust one product's stock.
 *
 * ── A RELATIVE FIELD AND AN ABSOLUTE ONE, ON THE SAME ENDPOINT ───────────────
 *
 * `PATCH /stock/{product_id}` takes two things that behave differently and the
 * difference is the reason this sheet is online-only:
 *
 *   · `quantity_delta` is RELATIVE. The server does `quantity_on_hand + $1`.
 *   · `low_stock_threshold` is ABSOLUTE. It is written as given.
 *
 * `offline/mutationQueue.ts` squashes consecutive PATCHes to the same URL by
 * merging their bodies last-writer-wins. For an absolute field that is correct.
 * For a relative one it is silent arithmetic loss: two counts of +5 and +3
 * squash to +3, five units disappear, the stock ledger records one move instead
 * of two, and nothing anywhere reports an error. So neither field is queued —
 * splitting one endpoint across two policies by which key happens to be present
 * is a rule nobody would remember at the call site.
 *
 * The button is therefore DISABLED offline with the reason stated, rather than
 * armed and doomed. `api/vikray.ts` carries the full note.
 *
 * ── WHY A DELTA AND NOT A NEW COUNT ─────────────────────────────────────────
 *
 * The field asks for the CHANGE, not the resulting figure, because that is what
 * the endpoint takes and translating in the UI would be a lie about what gets
 * written. The arithmetic is shown live — `40 → 45` — so nobody has to do it in
 * their head, and the ledger row that `vikray_stock_moves` stores is exactly the
 * number typed.
 */

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Null while the sheet is closing. */
  row: StockRow | null;
}

export default function StockAdjustSheet({ visible, onClose, row }: Props) {
  const { t } = useTheme();
  const online = useOnline();
  const qc = useQueryClient();

  const [delta, setDelta]  = useState('');
  const [sign, setSign]    = useState<1 | -1>(1);
  const [error, setError]  = useState<string | null>(null);
  const [done, setDone]    = useState<string | null>(null);
  const [busy, setBusy]    = useState(false);

  /**
   * Reset when a DIFFERENT product is opened.
   *
   * Keyed on `product_id` rather than on `visible`: clearing on close would
   * wipe the field during the dismissal animation, and a sheet that is reopened
   * on the same product mid-thought should still hold what was typed. Opening a
   * different product must not inherit the last one's number — that is how a
   * count lands on the wrong shelf.
   */
  useEffect(() => {
    setDelta('');
    setSign(1);
    setError(null);
    setDone(null);
  }, [row?.product_id]);

  const onHand = num(row?.quantity_on_hand);
  const parsed = useMemo(() => {
    // Digits and one decimal point. `quantity_on_hand` is numeric on the server,
    // so half units are real; a leading minus is NOT accepted here because the
    // direction is the toggle's job and two ways to say "subtract" is how you
    // get a double negative.
    const cleaned = delta.replace(/[^0-9.]/g, '');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [delta]);

  const applied = parsed === null ? null : sign * parsed;
  const after   = applied === null ? null : onHand + applied;

  const submit = async () => {
    if (!row || applied === null || busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await vikrayWriteApi.adjustStock(row.product_id, {
        quantity_delta: applied,
        // The server's own default for this field. Sent explicitly so the
        // ledger row says where the movement came from — an audit of
        // `vikray_stock_moves` with a blank reason column is an audit of
        // nothing.
        reason: 'manual_adjustment',
      });
      setDone(
        `${row.name} is now ${fmt(onHand + applied)} ${row.unit || 'units'}. `
        + 'The movement is on the stock ledger.',
      );
      setDelta('');
      qc.invalidateQueries({ queryKey: ['vikray'] });
    } catch (e: unknown) {
      setError(vikrayWriteError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeLabel="Close stock adjustment"
      panelStyle={panelStyle(t)}
      avoidKeyboard
    >
      <SheetFrame
        kicker={<BiLabel {...kickerStyles(t)}>ADJUST STOCK · भंडार</BiLabel>}
        title={row?.name ?? 'Product'}
        onClose={onClose}
        footer={
          <PrimaryButton
            label={
              applied === null ? 'Enter a quantity'
                : applied > 0 ? `Add ${fmt(applied)}`
                : `Remove ${fmt(-applied)}`
            }
            onPress={submit}
            busy={busy}
            disabled={applied === null || !online}
          />
        }
      >
        <View style={{ height: 8 }} />
        <DetailRow label="On hand" value={`${fmt(onHand)} ${row?.unit || 'units'}`} mono />
        <DetailRow label="Low-stock alert at" value={fmt(num(row?.low_stock_threshold))} mono />

        {!online && <InfoNote icon="cloud-offline-outline" text={VIKRAY_OFFLINE_NOTE} />}

        <View style={s.dirRow} accessibilityRole="radiogroup">
          {([[1, 'Add', 'add-circle-outline'], [-1, 'Remove', 'remove-circle-outline']] as const).map(
            ([v, label, icon]) => {
              const on = sign === v;
              const tone = v === 1 ? t.success : t.error;
              return (
                <TouchableOpacity
                  key={label}
                  onPress={() => setSign(v)}
                  disabled={!online || busy}
                  style={[
                    s.dir,
                    { borderColor: on ? tone : t.outline, backgroundColor: on ? tone + '14' : t.bg },
                    (!online || busy) ? { opacity: 0.45 } : null,
                  ]}
                  {...a11yButton(label)}
                  accessibilityState={{ selected: on, disabled: !online || busy }}
                >
                  <Ionicons name={icon} size={17} color={on ? tone : t.ink3} accessibilityElementsHidden />
                  <Text style={[s.dirText, { color: on ? tone : t.ink3 }]}>{label}</Text>
                </TouchableOpacity>
              );
            },
          )}
        </View>

        <TextInput
          value={delta}
          onChangeText={v => { setDelta(v); setError(null); setDone(null); }}
          placeholder="How many?"
          placeholderTextColor={t.ink3}
          keyboardType="decimal-pad"
          editable={online && !busy}
          style={[
            s.input,
            { borderColor: t.outline, backgroundColor: t.bg, color: t.ink },
            (!online || busy) ? { opacity: 0.45 } : null,
          ]}
          {...a11yInput(sign === 1 ? 'Quantity to add' : 'Quantity to remove')}
        />

        {/* The arithmetic, done for the user rather than by them. A negative
            result is shown rather than blocked: the server allows it — stock can
            legitimately go below zero when a count is being corrected — but it
            is flagged, because it is almost always a typo. */}
        {after !== null && (
          <View style={s.preview}>
            <Text style={[s.previewText, { color: t.ink3 }]}>
              {fmt(onHand)} → <Text style={{ color: t.ink, fontWeight: '800' }}>{fmt(after)}</Text>
              {' '}{row?.unit || 'units'}
            </Text>
            {after < 0 && (
              <Text style={[s.previewWarn, { color: t.error }]}>
                That takes the count below zero.
              </Text>
            )}
          </View>
        )}

        {!!error && <ErrorNote text={error} />}
        {!!done && <GoodNote text={done} />}

        <Text style={[s.foot, { color: t.ink4 }]}>
          The low-stock threshold is set on the web. Changing it from here is not
          built — it is the one field on this endpoint that would be safe to queue,
          and mixing a queued field with an unqueueable one on the same form is
          worse than leaving it out.
        </Text>
      </SheetFrame>
    </Sheet>
  );
}

/** Whole numbers stay whole; halves keep one place. Quantities, not money. */
function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}

const s = StyleSheet.create({
  dirRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
  dir: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    borderWidth: 1.5, borderRadius: 12, paddingVertical: 12, minHeight: 48,
  },
  dirText: { fontSize: 14, fontWeight: '700' },

  input: {
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 11,
    fontSize: 16, minHeight: 48, marginTop: 10,
    fontVariant: ['tabular-nums'],
  },

  preview: { marginTop: 12, gap: 3 },
  previewText: { fontSize: 14, fontVariant: ['tabular-nums'] },
  previewWarn: { fontSize: 12, fontWeight: '700' },

  foot: { fontSize: 11.5, lineHeight: 16.5, marginTop: 20 },
});
