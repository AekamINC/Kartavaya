import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import Sheet from '../../components/Sheet';
import { s } from './styles';

interface Props {
  visible:      boolean;
  columns:      Array<{ column_id: string; name: string; color: string }>;
  currentColId: string;
  onMove:       (colId: string) => void;
  onClose:      () => void;
}

export function MoveModal({ visible, columns, currentColId, onMove, onClose }: Props) {
  const { t } = useTheme();
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeLabel="Close column picker"
      panelStyle={[s.pickerSheet, { backgroundColor: t.surface }]}
    >
      <View style={[s.sheetHandle, { backgroundColor: t.ink3 }]} />
      <Text style={[s.pickerTitle, { color: t.ink }]}>Move to column</Text>
      {columns.filter(c => c.column_id !== currentColId).map(c => (
        <TouchableOpacity
          key={c.column_id}
          style={[s.pickerRow, { borderBottomColor: t.outline }]}
          onPress={() => onMove(c.column_id)}
        >
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.color }} />
          <Text style={[s.pickerName, { color: t.ink }]}>{c.name}</Text>
        </TouchableOpacity>
      ))}
    </Sheet>
  );
}
