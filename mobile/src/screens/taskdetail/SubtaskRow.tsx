import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { a11yToggle, a11yButton, hitSlopTo } from '../../components/a11y';
import type { Subtask, TeamMember } from '../../api/types';
import { Avatar } from './Avatar';
import { s } from './styles';

function memberName(m: TeamMember): string {
  return m.display_name ?? m.full_name ?? m.name ?? m.email;
}

interface Props {
  sub:      Subtask;
  t:        any;
  members:  TeamMember[];
  canEdit:  boolean;
  onToggle: () => void;
  onDelete: () => void;
}

export function SubtaskRow({ sub, t, members, canEdit, onToggle, onDelete }: Props) {
  const assignee = sub.assignee_user_id
    ? members.find(m => (m.user_id ?? m.member_id) === sub.assignee_user_id)
    : null;

  return (
    <View style={s.subtaskRow}>
      <TouchableOpacity
        onPress={onToggle}
        style={[s.checkbox, { borderColor: sub.is_done ? t.success : t.outline, backgroundColor: sub.is_done ? t.successBg : 'transparent' }]}
        {...a11yToggle(sub.title, sub.is_done, sub.is_done ? 'Mark as incomplete' : 'Mark as complete')}
      >
        {sub.is_done && <Ionicons name="checkmark" size={12} color={t.success} accessibilityElementsHidden />}
      </TouchableOpacity>
      <Text
        style={[s.subtaskTitle, { color: sub.is_done ? t.ink4 : t.ink, textDecorationLine: sub.is_done ? 'line-through' : 'none' }]}
        numberOfLines={2}
      >
        {sub.title}
      </Text>
      {assignee && (
        <Avatar uid={(assignee.user_id ?? assignee.member_id) ?? ''} name={memberName(assignee)} size={20} />
      )}
      {canEdit && (
        <TouchableOpacity
          onPress={onDelete}
          hitSlop={hitSlopTo(14)}
          {...a11yButton(`Delete subtask ${sub.title}`)}
        >
          <Ionicons name="close" size={14} color={t.ink4} accessibilityElementsHidden />
        </TouchableOpacity>
      )}
    </View>
  );
}
