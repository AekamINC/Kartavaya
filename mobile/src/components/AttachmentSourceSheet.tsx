/**
 * AttachmentSourceSheet — bottom sheet for choosing an attachment source.
 * Options: Camera · Gallery / Google Photos · Files (Drive, OneDrive, Dropbox, …)
 * On Android, the Files option opens the system document picker which surfaces
 * all installed storage providers (Drive, OneDrive, Dropbox, local Files, etc.)
 */
import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useTheme } from '../theme/ThemeProvider';
import Sheet from './Sheet';
import { a11yButton } from './a11y';
import BiLabel from '../theme/BiLabel';

export interface PickedFile {
  uri:  string;
  name: string;
  type: string;
}

interface Props {
  visible:   boolean;
  onClose:   () => void;
  onPicked:  (files: PickedFile[]) => void;
  maxFiles?: number;
}

const SOURCES = [
  { key: 'camera',  icon: 'camera-outline',      label: 'Camera',               hint: 'Take a photo or video' },
  { key: 'photos',  icon: 'images-outline',       label: 'Photos',               hint: 'Gallery · Google Photos' },
  { key: 'files',   icon: 'folder-open-outline',  label: 'Files',                hint: 'Drive · OneDrive · Dropbox' },
] as const;

type Source = typeof SOURCES[number]['key'];

export default function AttachmentSourceSheet({ visible, onClose, onPicked, maxFiles = 5 }: Props) {
  const { t } = useTheme();

  const pick = async (source: Source) => {
    onClose();
    try {
      const files: PickedFile[] = [];

      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return;
        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.All,
          quality: 0.85,
        });
        if (result.canceled || !result.assets?.[0]) return;
        const a = result.assets[0];
        files.push({ uri: a.uri, name: a.fileName ?? `photo_${Date.now()}.jpg`, type: a.mimeType ?? 'image/jpeg' });

      } else if (source === 'photos') {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) return;
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.All,
          allowsMultipleSelection: true,
          selectionLimit: maxFiles,
          quality: 0.85,
        });
        if (result.canceled || !result.assets?.length) return;
        for (const a of result.assets) {
          files.push({ uri: a.uri, name: a.fileName ?? `photo_${Date.now()}.jpg`, type: a.mimeType ?? 'image/jpeg' });
        }

      } else {
        const result = await DocumentPicker.getDocumentAsync({
          multiple: true,
          copyToCacheDirectory: true,
        });
        if (result.canceled || !result.assets?.length) return;
        for (const a of result.assets) {
          files.push({ uri: a.uri, name: a.name, type: a.mimeType ?? 'application/octet-stream' });
        }
      }

      if (files.length) onPicked(files);
    } catch {
      // permission denied or picker dismissed — silent
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeLabel="Close attachment picker"
      panelStyle={[s.sheet, { backgroundColor: t.surface }]}
    >
      <View style={[s.handle, { backgroundColor: t.outline }]} />
      <Text style={[s.title, { color: t.ink }]}>Add Attachment</Text>
      <Text style={[s.subtitle, { color: t.ink3 }]}>संलग्नक जोड़ें</Text>

      <View style={s.grid}>
        {SOURCES.map(src => (
          <TouchableOpacity
            key={src.key}
            style={[s.card, { backgroundColor: t.bg, borderColor: t.outline }]}
            onPress={() => pick(src.key)}
            activeOpacity={0.75}
            {...a11yButton(src.label, src.hint)}
          >
            <View style={[s.iconWrap, { backgroundColor: t.primary + '16' }]} accessibilityElementsHidden>
              <Ionicons name={src.icon as any} size={26} color={t.primary} />
            </View>
            <Text style={[s.cardLabel, { color: t.ink }]}>{src.label}</Text>
            <Text style={[s.cardHint, { color: t.ink3 }]}>{src.hint}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        onPress={onClose}
        style={[s.cancelBtn, { borderColor: t.outline }]}
        {...a11yButton('Cancel', 'Close without adding an attachment')}
      >
        {/* fontWeight '600' has no Tiro weight to resolve to; split so the
            Devanagari run keeps the one weight the face actually ships. */}
        <BiLabel latinStyle={[s.cancelText, { color: t.ink3 }]} hindiStyle={{ color: t.ink3 }} hindiSize={14}>
          Cancel · रद्द करें
        </BiLabel>
      </TouchableOpacity>
    </Sheet>
  );
}

const s = StyleSheet.create({
  // `backdrop` is gone — the scrim lives in Sheet now, and it fades over
  // --dur-base --ease-enter instead of appearing at full strength on frame one.
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 28,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 20,
  },
  handle: {
    width: 36, height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10, marginBottom: 4,
  },
  title: {
    fontSize: 17, fontWeight: '700',
    textAlign: 'center', marginTop: 12,
  },
  subtitle: {
    fontSize: 12, textAlign: 'center', marginBottom: 20,
  },
  grid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  card: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 16,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 8,
  },
  iconWrap: {
    width: 52, height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardLabel: {
    fontSize: 13, fontWeight: '700',
  },
  cardHint: {
    fontSize: 10, textAlign: 'center', lineHeight: 14,
  },
  cancelBtn: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 4,
  },
  cancelText: {
    fontSize: 14, fontWeight: '600',
  },
});
