import React from 'react';
import { View, Text, TouchableOpacity, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import Sheet from '../../components/Sheet';
import { a11yToggle, a11yButton } from '../../components/a11y';
import type { TeamMember } from '../../api/types';
import { Avatar } from './Avatar';
import { s } from './styles';

function memberName(m: TeamMember): string { return m.display_name ?? m.full_name ?? m.name ?? m.email; }
function memberId(m: TeamMember): string   { return (m.user_id ?? m.member_id) ?? ''; }

interface Props {
  visible:     boolean;
  members:     TeamMember[];
  selectedIds: string[];
  onToggle:    (uid: string) => void;
  onClose:     () => void;
}

export function AssigneePickerModal({ visible, members, selectedIds, onToggle, onClose }: Props) {
  const { t } = useTheme();
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeLabel="Close assignee picker"
      panelStyle={[s.pickerSheet, { backgroundColor: t.surface }]}
    >
      <View style={[s.sheetHandle, { backgroundColor: t.ink3 }]} />
      <Text style={[s.pickerTitle, { color: t.ink }]}>Assignees</Text>
      <FlatList
        data={members}
        keyExtractor={m => memberId(m)}
        style={{ maxHeight: 360 }}
        renderItem={({ item: m }) => {
          const uid      = memberId(m);
          const selected = selectedIds.includes(uid);
          const nm       = memberName(m);
          // Selection was carried by the checkmark GLYPH alone, so a screen
          // reader read every row identically whether assigned or not.
          // `a11yToggle` puts it in accessibilityState, where it is announced.
          return (
            <TouchableOpacity
              style={[s.pickerRow, { borderBottomColor: t.outline }]}
              onPress={() => onToggle(uid)}
              {...a11yToggle(nm, selected, selected ? 'Remove as assignee' : 'Add as assignee')}
            >
              <Avatar uid={uid} name={nm} size={34} />
              <View style={{ flex: 1 }}>
                <Text style={[s.pickerName, { color: t.ink }]}>{nm}</Text>
                {m.position ? <Text style={[s.pickerSub, { color: t.ink3 }]}>{m.position}</Text> : null}
              </View>
              {selected
                ? <Ionicons name="checkmark-circle" size={22} color={t.primary} accessibilityElementsHidden />
                : <View style={[s.emptyCheck, { borderColor: t.outline }]} />}
            </TouchableOpacity>
          );
        }}
      />
      <TouchableOpacity
        onPress={onClose}
        style={[s.pickerDoneBtn, { backgroundColor: t.primaryContainer }]}
        {...a11yButton('Done', 'Close the assignee picker')}
      >
        <Text style={[s.pickerDoneText, { color: t.primary }]}>Done</Text>
      </TouchableOpacity>
    </Sheet>
  );
}
