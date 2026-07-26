import React from 'react';
import { Toggle } from '../../components/ui';
import { orgModuleColor } from './catalogue';

/**
 * ModuleCard — one module, its identity colour, and whether it is on.
 *
 * `opacity: .68` for inactive rather than a grey palette swap. The module keeps
 * its colour so the grid stays scannable at a glance, and the toggle is the
 * state rather than the styling — a greyed card and an off card are two ways of
 * saying one thing, and the reader has to work out which they are looking at.
 *
 * The lock tag uses `--danger-container` / `--on-danger-container`, a declared
 * pair. A self-tint of `--danger` with `--danger` text can never reach 4.5:1,
 * because deepening the tint moves the background toward the text (00 §11).
 */
const Lock = (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
    <rect x="4" y="10.5" width="16" height="10" rx="2" /><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
  </svg>
);

export default function ModuleCard({ mod, active, disabled, onToggle }) {
  return (
    <div className={`omod__c${active ? '' : ' off'}`}>
      <div className="omod__h">
        <span className="omod__ic" style={{ '--c': orgModuleColor(mod.code) }} aria-hidden="true">
          {/* The initial, not an icon set. A per-module glyph that is not drawn
              yet renders as an empty box on eight cards at once. */}
          <strong>{mod.label[0]}</strong>
        </span>
        <span className="omod__t">
          {mod.label}
          <span className="ogr__hi" lang="hi">{mod.hi}</span>
        </span>
      </div>

      <span className="omod__d">{mod.blurb}</span>

      {mod.sensitive && (
        <span className="omod__lock">{Lock} SENSITIVE</span>
      )}

      <div className="omod__f">
        <span className={`omod__s${active ? ' on' : ''}`}>{active ? 'Active' : 'Not on your plan'}</span>
        <Toggle
          checked={active}
          disabled={disabled}
          label={`${mod.label} — ${active ? 'active' : 'inactive'}`}
          onChange={onToggle}
        />
      </div>
    </div>
  );
}
