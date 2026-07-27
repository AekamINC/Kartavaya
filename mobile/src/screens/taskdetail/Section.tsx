import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { a11yButton, hitSlopTo } from '../../components/a11y';
import { s } from './styles';

interface Props {
  label:     string;
  t:         any;
  children:  React.ReactNode;
  /**
   * `label` names the action for assistive tech. It is optional only so the
   * existing call sites keep compiling; the fallback below is a generic
   * "Edit <section>", which is honest but worse than a caller-supplied verb.
   * The icon alone announced as "button" and nothing else.
   */
  action?:   { icon: string; onPress: () => void; label?: string };
}

export function Section({ label, t, children, action }: Props) {
  return (
    <View style={s.section}>
      <View style={s.sectionHeader}>
        <Text style={[s.sectionLabel, { color: t.ink3 }]} accessibilityRole="header">{label}</Text>
        {action && (
          <TouchableOpacity
            onPress={action.onPress}
            hitSlop={hitSlopTo(16)}
            {...a11yButton(action.label ?? `Edit ${label.toLowerCase()}`)}
          >
            <Ionicons name={action.icon as any} size={16} color={t.ink3} accessibilityElementsHidden />
          </TouchableOpacity>
        )}
      </View>
      {children}
    </View>
  );
}
