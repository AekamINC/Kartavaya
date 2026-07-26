import React, { useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, Pressable, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../theme/ThemeProvider';
import { s } from './styles';
import { BRAND_GRADIENT_2 } from '../../theme/tokens';

/**
 * A rejection reason is REQUIRED, not optional.
 *
 * server.py:1209 returns 400 "Rejection reason is required" when notes is empty,
 * so the modal previously labelled the field "NOTES (OPTIONAL)" for every
 * action, let the user confirm an empty reject, and surfaced the server's 400 as
 * a bare error alert. 17-mobile-app.md lists "decline gated on a reason" as part
 * of the approval surface for exactly this reason: the person whose work was
 * rejected needs to know why, and the gate belongs in front of the request.
 */
const REQUIRES_REASON = new Set(['reject', 'client_reject']);

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

  const needsReason = action !== null && REQUIRES_REASON.has(action);
  const reasonMissing = needsReason && !notes.trim();

  /**
   * A destructive confirm reads as destructive, but NOT as a red gradient fill.
   *
   * The pair that was here — ['#ef4444', '#dc2626'] — was theme-invariant, so a
   * dark-mode reject carried the light-mode red. Swapping in `t.error` alone is
   * not enough either: there is no `--on-danger` token in the palette yet, and
   * dark-mode `danger` is a light salmon (#F2867A) that white text fails
   * against. So the destructive button is a container fill with matching text —
   * errorBg behind error — which is contrast-correct in both themes without
   * needing a token that does not exist.
   */
  const destructive = needsReason;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <Pressable style={s.modalOverlay} onPress={onClose}>
          <Pressable style={[s.approvalModal, { backgroundColor: t.surface }]} onPress={() => {}}>
            <Text style={[s.approvalModalTitle, { color: t.ink }]}>{title}</Text>
            <Text style={[s.approvalModalLabel, { color: t.ink3 }]}>
              {needsReason ? 'REASON (REQUIRED)' : 'NOTES (OPTIONAL)'}
            </Text>
            <TextInput
              style={[
                s.approvalModalInput,
                { backgroundColor: t.bg, borderColor: reasonMissing ? t.error : t.outline, color: t.ink },
              ]}
              value={notes}
              onChangeText={setNotes}
              placeholder={needsReason ? 'Why is this being sent back?' : 'Add notes…'}
              placeholderTextColor={t.ink3}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              accessibilityLabel={needsReason ? 'Reason, required' : 'Notes, optional'}
            />
            {needsReason && (
              <Text style={{ color: t.ink3, fontSize: 11.5, lineHeight: 16, marginTop: 6 }}>
                The person who did the work sees this. Say what needs to change.
              </Text>
            )}
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
                disabled={reasonMissing}
                accessibilityState={{ disabled: reasonMissing }}
                onPress={() => {
                  // Gate in front of the request rather than relying on the
                  // server's 400, so the user is told what is missing while the
                  // field is still on screen.
                  if (reasonMissing) {
                    Alert.alert('Reason required', 'Add a short reason so the assignee knows what to change.');
                    return;
                  }
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
                style={{ flex: 1, opacity: reasonMissing ? 0.45 : 1 }}
              >
                {destructive ? (
                  <View style={[s.approvalModalConfirmBtn, { backgroundColor: t.errorBg, borderWidth: 1, borderColor: t.error }]}>
                    <Text style={{ color: t.error, fontWeight: '900', fontSize: 13 }}>Confirm</Text>
                  </View>
                ) : (
                  <LinearGradient
                    colors={BRAND_GRADIENT_2}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={s.approvalModalConfirmBtn}
                  >
                    <Text style={{ color: '#FFFFFF', fontWeight: '900', fontSize: 13 }}>Confirm</Text>
                  </LinearGradient>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
