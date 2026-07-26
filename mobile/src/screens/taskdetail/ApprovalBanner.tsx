import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { a11yButton } from '../../components/a11y';
import { APPROVAL_COLORS, withAlpha } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import type { Task, ApprovalStatus } from '../../api/types';
import { s } from './styles';

interface Props {
  task:     Task;
  userRole: string;
  userId:   string;
  onAction: (action: 'request' | 'approve' | 'reject' | 'client' | 'client_approve' | 'client_reject') => void;
}

export function ApprovalBanner({ task, userRole, userId, onAction }: Props) {
  const { t, scheme } = useTheme();
  const status    = task.approval_status;
  const canReview = userRole === 'admin' || userRole === 'owner';
  const isClient  = userRole === 'client';

  if (!status) {
    if (task.created_by_user_id === userId || task.assignee_user_ids?.includes(userId) || canReview) {
      return (
        <TouchableOpacity
          onPress={() => onAction('request')}
          style={[s.approvalRow, { backgroundColor: t.surfaceLow, borderColor: t.outline }]}
          {...a11yButton('Request approval')}
        >
          <Ionicons name="shield-checkmark-outline" size={16} color={t.ink3} accessibilityElementsHidden />
          <Text style={[s.approvalLabel, { color: t.ink3 }]}>Request approval</Text>
          <Ionicons name="chevron-forward" size={14} color={t.ink3} accessibilityElementsHidden />
        </TouchableOpacity>
      );
    }
    return null;
  }

  // Scheme-aware. APPROVAL_COLOR (no S) is the deprecated light-only map, so in
  // dark mode it handed back a hue mixed for the cream canvas. 00 §9 flips these.
  const color = APPROVAL_COLORS[scheme][status] ?? t.ink3;

  /**
   * Action button colours, from the theme rather than the literals that used to
   * be here (#16a34a / #ef4444 / #7c3aed). Those did not flip with the theme, so
   * dark mode drew light-mode greens and reds on a near-black surface.
   *
   * `purple` is --ap-pending-client, which 00 §9 keeps a different hue from
   * --ap-pending on purpose: "waiting on us" versus "waiting on the client" is
   * the distinction the approval flow exists to communicate.
   */
  const ACT = {
    approve: { fg: t.success, bg: t.successBg },
    reject:  { fg: t.error,   bg: t.errorBg },
    client:  { fg: t.purple,  bg: t.purpleContainer },
  };

  const labels: Record<NonNullable<ApprovalStatus>, string> = {
    pending:        'Awaiting internal review',
    pending_client: 'Awaiting client approval',
    approved:       'Approved',
    rejected:       'Rejected',
  };

  return (
    <View style={[s.approvalBanner, { backgroundColor: withAlpha(color, 0.09), borderColor: withAlpha(color, 0.33) }]}>
      <View style={s.approvalBannerRow}>
        <Ionicons name="shield-checkmark" size={16} color={color} />
        <Text style={[s.approvalBannerLabel, { color }]}>{labels[status]}</Text>
      </View>
      {task.approval_notes ? (
        <Text style={[s.approvalNotes, { color: t.ink3 }]}>{task.approval_notes}</Text>
      ) : null}

      {/* Internal review actions — owner/admin */}
      {status === 'pending' && canReview && (
        <View style={s.approvalActions}>
          <TouchableOpacity
            onPress={() => onAction('approve')}
            style={[s.approvalBtn, { backgroundColor: ACT.approve.bg, borderColor: ACT.approve.fg }]}
            {...a11yButton('Approve task')}
          >
            <Ionicons name="checkmark-circle" size={14} color={ACT.approve.fg} accessibilityElementsHidden />
            <Text style={{ color: ACT.approve.fg, fontSize: 12, fontWeight: '700' }}>Approve</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onAction('reject')}
            style={[s.approvalBtn, { backgroundColor: ACT.reject.bg, borderColor: ACT.reject.fg }]}
            {...a11yButton('Reject task')}
          >
            <Ionicons name="close-circle" size={14} color={ACT.reject.fg} accessibilityElementsHidden />
            <Text style={{ color: ACT.reject.fg, fontSize: 12, fontWeight: '700' }}>Reject</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onAction('client')}
            style={[s.approvalBtn, { backgroundColor: ACT.client.bg, borderColor: ACT.client.fg }]}
            {...a11yButton('Send to client for approval')}
          >
            <Ionicons name="send" size={13} color={ACT.client.fg} accessibilityElementsHidden />
            <Text style={{ color: ACT.client.fg, fontSize: 12, fontWeight: '700' }}>Send to client</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Client approval actions */}
      {status === 'pending_client' && isClient && (
        <View style={s.approvalActions}>
          <TouchableOpacity
            onPress={() => onAction('client_approve')}
            style={[s.approvalBtn, { backgroundColor: ACT.approve.bg, borderColor: ACT.approve.fg }]}
            {...a11yButton('Approve this task')}
          >
            <Ionicons name="checkmark-circle" size={14} color={ACT.approve.fg} accessibilityElementsHidden />
            <Text style={{ color: ACT.approve.fg, fontSize: 12, fontWeight: '700' }}>Approve</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onAction('client_reject')}
            style={[s.approvalBtn, { backgroundColor: ACT.reject.bg, borderColor: ACT.reject.fg }]}
            {...a11yButton('Request changes')}
          >
            <Ionicons name="close-circle" size={14} color={ACT.reject.fg} accessibilityElementsHidden />
            <Text style={{ color: ACT.reject.fg, fontSize: 12, fontWeight: '700' }}>Request changes</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}
