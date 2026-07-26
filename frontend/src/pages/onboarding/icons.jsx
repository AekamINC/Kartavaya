import React from 'react';

/** Shared line icons for the wizard. 1.8px stroke, currentColor, no fills. */
const base = (p) => ({
  width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', ...p,
});

export const Check = (p) => <svg {...base(p)}><path d="M20 6L9 17l-5-5" /></svg>;
export const Dash = (p) => <svg {...base(p)}><path d="M6 12h12" /></svg>;
export const Cross = (p) => <svg {...base(p)}><path d="M18 6L6 18M6 6l12 12" /></svg>;
export const Lock = (p) => (
  <svg {...base(p)}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></svg>
);
export const Clock = (p) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);
export const ChevLeft = (p) => <svg {...base(p)}><path d="M15 5l-7 7 7 7" /></svg>;
export const Info = (p) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.01" /></svg>
);
