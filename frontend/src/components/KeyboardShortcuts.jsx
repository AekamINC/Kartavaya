import React, { useEffect, useState } from 'react';

const SHORTCUTS = [
  { section: 'Navigation', items: [
    { keys: ['⌘', 'K'], label: 'Command palette', hi: 'कमांड पैलेट' },
    { keys: ['G', 'D'], label: 'Go to Dashboard', hi: 'डैशबोर्ड' },
    { keys: ['G', 'T'], label: 'Go to Tasks', hi: 'कार्य' },
    { keys: ['G', 'C'], label: 'Go to CRM', hi: 'ग्राहक' },
    { keys: ['G', 'I'], label: 'Go to Invoicing', hi: 'गणित' },
    { keys: ['G', 'H'], label: 'Go to HRMS', hi: 'मानव' },
  ]},
  { section: 'Actions', items: [
    { keys: ['N'], label: 'New task', hi: 'नया कार्य' },
    { keys: ['I'], label: 'New invoice', hi: 'नया चालान' },
    { keys: ['C'], label: 'New contact', hi: 'नया संपर्क' },
    { keys: ['?'], label: 'Show shortcuts', hi: 'शॉर्टकट दिखाएं' },
    { keys: ['Esc'], label: 'Close dialog', hi: 'बंद करें' },
  ]},
];

export default function KeyboardShortcuts({ open, onClose }) {
  if (!open) return null;

  return (
    <div className="k-cmdk-overlay" onClick={onClose}>
      <div className="k-shortcuts" onClick={e => e.stopPropagation()}>
        <div className="k-shortcuts__header">
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>⌨️</span> Keyboard Shortcuts
            <span style={{ fontFamily: 'var(--font-hindi)', fontSize: 13, color: 'var(--ink-3)', fontWeight: 400 }}>कीबोर्ड शॉर्टकट</span>
          </h3>
          <button className="k-iconbtn" onClick={onClose} style={{ fontSize: 18 }}>×</button>
        </div>
        <div className="k-shortcuts__body">
          {SHORTCUTS.map(group => (
            <div key={group.section}>
              <div className="k-cmdk__section">{group.section}</div>
              {group.items.map(s => (
                <div key={s.label} className="k-shortcuts__row">
                  <div className="k-shortcuts__keys">
                    {s.keys.map((k, i) => (
                      <React.Fragment key={i}>
                        {i > 0 && <span style={{ fontSize: 10, color: 'var(--ink-faint)' }}>then</span>}
                        <kbd className="k-kbd">{k}</kbd>
                      </React.Fragment>
                    ))}
                  </div>
                  <span className="k-shortcuts__label">{s.label}</span>
                  <span className="k-shortcuts__hi">{s.hi}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="k-shortcuts__footer">
          Press <kbd className="k-kbd" style={{ fontSize: 11 }}>?</kbd> anytime to toggle this overlay
        </div>
      </div>
    </div>
  );
}
