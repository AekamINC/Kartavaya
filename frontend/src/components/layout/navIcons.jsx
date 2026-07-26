// The 29 nav icons, extracted from Sidebar.jsx per 01-navigation.md §3.
// Kept as a module so the sidebar, the module headers, the mobile drawer and
// the command palette can share one set instead of each inlining its own.
import React from 'react';

export const ICONS = {
  dashboard:   <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 1.5"/></svg>,
  projects:    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 5l1.5-2H7l1.5 2H14v8H2V5z"/></svg>,
  tasks:       <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 4h10M3 8h7M3 12h9"/><circle cx="13" cy="8" r="1.4" fill="currentColor" stroke="none"/></svg>,
  approvals:   <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="6"/><path d="M5.5 8l1.8 1.8L10.5 6.5"/></svg>,
  activity:    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M1 8h3l2-5 4 10 2-5h3"/></svg>,
  automations: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M9 2L3 9h4l-1 5 6-7H8l1-5z"/></svg>,
  time:        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8.5" r="5.5"/><path d="M8 5.5v3l2 1.5"/><path d="M5.5 1.5h5"/></svg>,
  templates:   <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 2.5h7l3 3v8H3z"/><path d="M9.5 2.5V6H13"/><path d="M5.5 9h5M5.5 11h3"/></svg>,
  reports:     <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M5 9.5l2-2 2 2 2-3"/><path d="M5 6h2"/></svg>,
  teams:       <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="6" cy="6" r="2.4"/><path d="M1.5 13c0-2.6 2-4.2 4.5-4.2S10.5 10.4 10.5 13"/><circle cx="12" cy="6" r="1.6"/><path d="M11.5 9.2c1.7 0 3 1.1 3 2.6"/></svg>,
  categories:  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 2h5.5l6.5 6.5-5.5 5.5L2 7.5V2z"/><circle cx="5.5" cy="5.5" r="1"/></svg>,
  notifications:<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M13 11l-2-2H5L3 11V4a1 1 0 011-1h8a1 1 0 011 1v7z"/><path d="M6.5 13.5a1.5 1.5 0 003 0"/></svg>,
  inbox:       <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 11h3l1 2h4l1-2h3V4a1 1 0 00-1-1H3a1 1 0 00-1 1v7z"/><path d="M5.5 7.5h5"/><path d="M5.5 5.5h3"/></svg>,
  admin:       <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M8 2l5 2v4.5c0 3-2.2 5.2-5 5.8C5.2 13.7 3 11.5 3 8.5V4l5-2z"/><path d="M6 8.2l1.3 1.3L10 6.8"/></svg>,
  billing:     <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2 6.5h12"/><path d="M5 10h3"/><path d="M10 10h1.5"/></svg>,
  hub:         <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="2"/><path d="M8 2v4M8 10v4M2 8h4M10 8h4M4 4l2.8 2.8M9.2 9.2L12 12M12 4l-2.8 2.8M6.8 9.2L4 12"/></svg>,
  org:         <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="4" y="2" width="8" height="12" rx="1"/><path d="M6 5h1.5M6 7.5h1.5M6 10h1.5M9 5h1M9 7.5h1"/></svg>,
  graha:       <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="5" r="3"/><path d="M2.5 14c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/></svg>,
  ganit:       <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2" y="2" width="12" height="12" rx="1.5"/><path d="M2 6h12M6 6v8"/><path d="M9 9h2M9 11h2"/></svg>,
  manav:       <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="6" cy="4.5" r="2"/><circle cx="11" cy="4.5" r="2"/><path d="M1.5 12c0-2.2 2-3.5 4.5-3.5s4.5 1.3 4.5 3.5"/><path d="M10 8.5c1.8 0 3.5 1 3.5 3"/></svg>,
  vikray:      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 3h2l2 8h6l2-5H6"/><circle cx="7" cy="13.5" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="13.5" r="1" fill="currentColor" stroke="none"/></svg>,
  vetana:      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2.5" y="2" width="11" height="12" rx="1.5"/><path d="M5.5 5.5h5M5.5 8h3M5.5 10.5h4"/><path d="M10 9l1.5 1.5L10 12" strokeWidth="1.2"/></svg>,
  dristi:      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 10l3-5 3 3 4-6"/><path d="M11 2h3v3"/><circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="8" cy="11" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="9" r="1.2" fill="currentColor" stroke="none"/></svg>,
  prachar:     <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 4h8v7H2z"/><path d="M10 6l4-2v9l-4-2"/><path d="M4 11v2.5"/><path d="M6 11v2.5"/></svg>,
  esign:       <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M9.5 2.5l4 4-8 8H1.5v-4z"/><path d="M8 4l4 4"/></svg>,
  customize:   <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="3"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41"/></svg>,
  logout:      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h3M11 11l3-3-3-3M14 8H6"/></svg>,
  chart:       <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 13V7M7 13V4M11 13V9M15 13V2"/><path d="M1 14h14"/></svg>,

  // Chrome — used by the topbar, the mobile bar and the bottom nav rather
  // than by a nav entry, so they carry no Devanagari label of their own.
  plus:        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 3v10M3 8h10"/></svg>,
  more:        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/></svg>,
  burger:      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M3 5.5h14M3 10h14M3 14.5h14"/></svg>,
  bell:        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M13 11l-2-2H5L3 11V4a1 1 0 011-1h8a1 1 0 011 1v7z"/><path d="M6.5 13.5a1.5 1.5 0 003 0"/></svg>,
  search:      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>,
  chevR:       <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 3l5 5-5 5"/></svg>,
  chevL:       <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M10 3L5 8l5 5"/></svg>,
  close:       <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>,
  eye:         <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z"/><circle cx="8" cy="8" r="1.8"/></svg>,
  users:       <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="6" cy="6" r="2.4"/><path d="M1.5 13c0-2.6 2-4.2 4.5-4.2S10.5 10.4 10.5 13"/><circle cx="12" cy="6" r="1.6"/><path d="M11.5 9.2c1.7 0 3 1.1 3 2.6"/></svg>,
};

export const icon = name => ICONS[name] || null;
