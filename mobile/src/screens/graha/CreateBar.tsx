import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import { useOnline } from '../../hooks/useOnline';
import { a11yButton } from '../../components/a11y';
import { SectionHead } from '../modules/ModuleShell';
import NewDealSheet from './NewDealSheet';
import NewClientSheet from './NewClientSheet';
import ContactSheet from './ContactSheet';

/**
 * The three things a rep can now START from a phone.
 *
 * A component rather than three buttons inlined into `GrahaScreen`, for an
 * ownership reason as much as a tidiness one: `screens/modules/GrahaScreen.tsx`
 * belongs to the module shell and this pass owns `screens/graha/**`, so the
 * whole of the create surface — the buttons AND the three sheets they open —
 * lives here and the screen gains one line.
 *
 * ── Why they are all disabled offline ────────────────────────────────────────
 *
 * Every one of these is a POST, and the offline queue replays a failed write
 * three times with no idempotency key, so a request that reached Postgres and
 * lost its response on the way back produces a second row. That is the rule
 * `api/graha.ts` sets out. The bar states it ONCE here rather than each sheet
 * discovering it after the user has typed a form — though each sheet says it
 * too, because a sheet can be reached with the connection dropping halfway.
 *
 * ── The order is the order a rep works in ────────────────────────────────────
 *
 * Deal first: it is the thing that is worth opening the phone for, and it can
 * pull the company off the contact it is given. Company last: it is the record
 * everything hangs off, so it is the one somebody sets up once.
 */

interface Props {
  /** Opens the deal sheet on whatever was just created. */
  onOpenDeal: (dealId: string, title: string) => void;
}

export default function CreateBar({ onOpenDeal }: Props) {
  const { t } = useTheme();
  const online = useOnline();

  const [sheet, setSheet] = useState<'deal' | 'contact' | 'company' | null>(null);
  const close = () => setSheet(null);

  return (
    <View>
      <SectionHead label="ADD" hi="जोड़ें" />

      <View style={s.row}>
        <Button
          icon="briefcase-outline" label="Deal"
          disabled={!online}
          onPress={() => setSheet('deal')}
        />
        <Button
          icon="person-add-outline" label="Contact"
          disabled={!online}
          onPress={() => setSheet('contact')}
        />
        <Button
          icon="business-outline" label="Company"
          disabled={!online}
          onPress={() => setSheet('company')}
        />
      </View>

      {!online && (
        <Text style={[s.why, { color: t.ink3 }]}>
          Creating anything needs a connection — a create held on the phone and retried can arrive
          twice, and nothing here can delete the second copy. Moving a stage and editing still work.
        </Text>
      )}

      {/* Mounted unconditionally so each keeps its own reset-on-open effect. */}
      <NewDealSheet
        visible={sheet === 'deal'}
        onClose={close}
        onCreated={onOpenDeal}
      />
      <ContactSheet
        visible={sheet === 'contact'}
        onClose={close}
      />
      <NewClientSheet
        visible={sheet === 'company'}
        onClose={close}
      />
    </View>
  );
}

function Button({ icon, label, onPress, disabled }: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { t } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[
        s.btn,
        { borderColor: t.outline, backgroundColor: t.surface2 },
        disabled && s.disabled,
      ]}
      {...a11yButton(disabled ? `New ${label}, needs a connection` : `New ${label}`)}
      accessibilityState={{ disabled: !!disabled }}
    >
      <Ionicons name={icon} size={16} color={t.primaryText} accessibilityElementsHidden />
      <Text style={[s.btnText, { color: t.primaryText }]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  btn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderRadius: 12, paddingVertical: 12,
    // The 48pt tier — these sit on the surface rather than inside a sheet.
    minHeight: 48,
  },
  btnText: { fontSize: 13, fontWeight: '700' },
  why: { fontSize: 11.5, lineHeight: 16, marginTop: 8 },
  disabled: { opacity: 0.45 },
});
