import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { a11yButton } from '../../components/a11y';
import { s } from './styles';

interface Props {
  onBack:        () => void;
  title:         string;
  t:             any;
  rightActions?: React.ReactNode;
}

export function SafeHeader({ onBack, title, t, rightActions }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.safeHeader, { backgroundColor: t.surface, borderBottomColor: t.outline, paddingTop: insets.top + 8 }]}>
      {/* Icon-only, so the name has to come from the label — a chevron alone
          announces as "button" and nothing else. */}
      <TouchableOpacity
        onPress={onBack}
        style={s.backBtn}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        {...a11yButton('Close', `Close ${title}`)}
      >
        <Ionicons name="chevron-down" size={24} color={t.ink} accessibilityElementsHidden />
      </TouchableOpacity>
      <Text style={[s.safeHeaderTitle, { color: t.ink3 }]} numberOfLines={1}>{title}</Text>
      <View style={s.headerRight}>{rightActions ?? <View style={{ width: 28 }} />}</View>
    </View>
  );
}
