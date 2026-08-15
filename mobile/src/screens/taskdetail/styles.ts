import { StyleSheet, Platform } from 'react-native';

export const s = StyleSheet.create({
  root:         { flex: 1 },
  // Header
  // paddingTop comes from the safe-area inset at the render site (SafeHeader) —
  // this was the last static 56/36 formula in the app after the 2026-08-15
  // header sweep, and static offsets sit under the status bar on Android
  // edge-to-edge.
  safeHeader:   { flexDirection: 'row', alignItems: 'center', paddingBottom: 12, paddingHorizontal: 16, borderBottomWidth: 1, gap: 8 },
  backBtn:      { width: 28 },
  safeHeaderTitle: { flex: 1, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  headerRight:  { width: 28, alignItems: 'flex-end' },
  // Scroll
  scroll:       { paddingBottom: 24 },
  // Title
  titleInput:   { fontSize: 22, fontWeight: '800', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 4, borderBottomWidth: 2, lineHeight: 30 },
  titleText:    { fontSize: 22, fontWeight: '800', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 8, lineHeight: 30 },
  // Meta
  metaRow:      { paddingHorizontal: 20, paddingVertical: 10 },
  metaChip:     { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99, borderWidth: 1.5 },
  metaChipText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  // Section
  section:      { paddingHorizontal: 20, paddingVertical: 14 },
  sectionHeader:{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sectionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  divider:      { height: 1, marginHorizontal: 16 },
  emptyHint:    { fontSize: 13, fontStyle: 'italic' },
  // Description
  descText:     { fontSize: 14, lineHeight: 21 },
  descInput:    { fontSize: 14, lineHeight: 21, borderRadius: 10, borderWidth: 1, padding: 12, minHeight: 80 },
  // Assignees
  assigneeRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  assigneeChip: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  assigneeChipName: { fontSize: 12, fontWeight: '700' },
  assigneeAdd:  { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  // Subtasks
  subtaskProgress: { height: 4, borderRadius: 2, overflow: 'hidden', marginBottom: 10 },
  subtaskProgressFill: { height: 4, borderRadius: 2 },
  subtaskRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  checkbox:     { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  subtaskTitle: { flex: 1, fontSize: 14, lineHeight: 19 },
  addSubtaskRow:{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  addSubtaskInput:{ flex: 1, borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9, fontSize: 13 },
  addSubtaskBtn:{ width: 34, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  // Approval
  approvalRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, borderWidth: 1 },
  approvalLabel:{ flex: 1, fontSize: 13, fontWeight: '600' },
  approvalBanner:{ borderRadius: 12, borderWidth: 1, padding: 12, gap: 8 },
  approvalBannerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  approvalBannerLabel: { fontSize: 13, fontWeight: '700' },
  approvalNotes:{ fontSize: 12, lineHeight: 17 },
  approvalActions:{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  approvalBtn:  { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, borderWidth: 1 },
  // Attachments
  attachGrid:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  attachChip:   { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, borderWidth: 1, maxWidth: 180 },
  attachName:   { fontSize: 12, fontWeight: '600', flex: 1 },
  // Comments
  commentRow:       { flexDirection: 'row', gap: 10, marginBottom: 14, alignItems: 'flex-end' },
  commentRowMine:   { flexDirection: 'row-reverse' },
  commentBubble:    { flex: 1, borderRadius: 14, padding: 11, borderWidth: 1, maxWidth: '85%' },
  commentAuthor:    { fontSize: 11, fontWeight: '800', marginBottom: 3 },
  commentBody:      { fontSize: 13, lineHeight: 18 },
  commentTime:      { fontSize: 10, marginTop: 5, textAlign: 'right' },
  // Composer
  composer:         { borderTopWidth: 1, paddingHorizontal: 14, paddingVertical: 10 },
  editingBanner:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, marginBottom: 8 },
  editingBannerText:{ fontSize: 11, fontWeight: '700' },
  composerRow:      { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  composerInput:    { flex: 1, borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 10 : 8, fontSize: 14, maxHeight: 100 },
  sendBtn:          { flexShrink: 0, marginBottom: 2 },
  sendGrad:         { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  // Modals
  // modalOverlay removed — Sheet/Dialog own the frame and fade the scrim.
  approvalModal:    { margin: 16, borderRadius: 20, padding: 22, marginBottom: Platform.OS === 'ios' ? 32 : 16 },
  approvalModalTitle:{ fontSize: 18, fontWeight: '900', marginBottom: 16 },
  approvalModalLabel:{ fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 6 },
  approvalModalInput:{ borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, marginBottom: 4 },
  approvalModalCancelBtn: { paddingHorizontal: 18, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  approvalModalConfirmBtn:{ flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  pickerSheet:  { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 0, paddingBottom: Platform.OS === 'ios' ? 34 : 16 },
  sheetHandle:  { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 4 },
  pickerTitle:  { fontSize: 17, fontWeight: '900', paddingHorizontal: 20, paddingVertical: 14 },
  pickerRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 13, borderBottomWidth: 1 },
  pickerName:   { flex: 1, fontSize: 14, fontWeight: '700' },
  pickerSub:    { fontSize: 12, marginTop: 1 },
  emptyCheck:   { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5 },
  pickerDoneBtn:{ margin: 16, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  pickerDoneText:{ fontSize: 14, fontWeight: '800' },
});
