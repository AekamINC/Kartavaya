import React, { useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, Pressable, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../theme/ThemeProvider';
import { s } from './styles';
import { BRAND_GRADIENT_2 } from '../../theme/tokens';

interface Props {
  visible:   boolean;
  action:    'request' | 'approve' | 'reject' | 'client' | 'client_approve' | 'client_reject' | null;
  onClose:   () => void;
  onConfirm: (notes: string, extra?: { client_email?: string }) => void;
}

export function ApprovalModal({ visible, action, onClose, onConfirm }: Props) {
  const { t } = useTheme();
  const [notes, setNotes] = useState('');
  const [email, setEmail] = useState('');

  const title = action === 'request'        ? 'Request Approval'
    : action === 'approve'                  ? 'Approve Task'
    : action === 'reject'                   ? 'Reject Task'
    : action === 'client'                   ? 'Send to Client'
    : action === 'client_approve'           ? 'Client Approve'
    : action === 'client_reject'            ? 'Client Reject'
    : '';

  const GRAD: [string, string] = (action === 'reject' || action === 'client_reject')
    ? ['#ef4444', '#dc2626']
    : BRAND_GRADIENT_2;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <Pressable style={s.modalOverlay} onPress={onClose}>
          <Pressable style={[s.approvalModal, { backgroundColor: t.surface }]} onPress={() => {}}>
            <Text style={[s.approvalModalTitle, { color: t.ink }]}>{title}</Text>
            <Text style={[s.approvalModalLabel, { color: t.ink3 }]}>NOTES (OPTIONAL)</Text>
            <TextInput
              style={[s.approvalModalInput, { backgroundColor: t.bg, borderColor: t.outline, color: t.ink }]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Add notes…"
              placeholderTextColor={t.ink3}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
            {action === 'client' && (
              <>
                <Text style={[s.approvalModalLabel, { color: t.ink3, marginTop: 10 }]}>CLIENT EMAIL</Text>
                <TextInput
                  style={[s.approvalModalInput, { backgroundColor: t.bg, borderColor: t.outline, color: t.ink }]}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="client@example.com"
                  placeholderTextColor={t.ink3}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </>
            )}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <TouchableOpacity
                onPress={onClose}
                style={[s.approvalModalCancelBtn, { borderColor: t.outline }]}
              >
                <Text style={{ color: t.ink3, fontWeight: '700' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  if (action === 'client') {
                    const emailTrimmed = email.trim();
                    if (!emailTrimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) {
                      Alert.alert('Invalid email', 'Please enter a valid client email address.');
                      return;
                    }
                    onConfirm(notes, { client_email: emailTrimmed });
                  } else {
                    onConfirm(notes);
                  }
                  setNotes(''); setEmail('');
                }}
                style={{ flex: 1 }}
              >
                <LinearGradient
                  colors={GRAD}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={s.approvalModalConfirmBtn}
                >
                  <Text style={{ color: '#fff', fontWeight: '900', fontSize: 13 }}>Confirm</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
