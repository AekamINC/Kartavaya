// Kray · settings — a thin wrapper that renders POSettingsPanel as a tab.
//
// The settings panel already exists (procurement/POSettingsPanel.jsx) and
// handles approval rules, budget limits, prefix config and over-receipt policy.
// This tab just mounts it so it appears in the Kray tab bar instead of being
// a button inside the PO tab.
import React from 'react';
import POSettingsPanel from '../procurement/POSettingsPanel';

export default function KraySettingsTab() {
  return <POSettingsPanel onClose={() => {}} />;
}
