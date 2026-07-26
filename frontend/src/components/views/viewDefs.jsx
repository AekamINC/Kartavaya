import React from 'react';

/**
 * The seven views, and the custom-field types, once.
 *
 * `BoardsPage` and `ProjectBoardPage` each carried a byte-for-byte copy of both
 * arrays — fourteen inline SVGs and fourteen labels, maintained in two places.
 * 04 §2 makes the argument against two toolbars; this is the same argument one
 * level down. A view added to one page and not the other is the failure mode,
 * and it had already happened once in the reverse direction: the two pages'
 * switchers disagreed about where the Archived toggle lived.
 *
 * Icons are 14px on a 16-unit viewBox at stroke 1.5, which is what makes them
 * optically match the 13px segmented-control label beside them. They are
 * `aria-hidden` because the label is right there — an icon that repeats its own
 * label is read twice.
 */

const ico = (children) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    {children}
  </svg>
);

export const VIEWS = [
  {
    id: 'kanban',
    label: 'Board',
    icon: ico(<><rect x="1" y="3" width="4" height="10" rx="1" /><rect x="6" y="3" width="4" height="10" rx="1" /><rect x="11" y="3" width="4" height="10" rx="1" /></>),
  },
  {
    id: 'table',
    label: 'List',
    icon: ico(<path d="M2 4h12M2 8h12M2 12h12" />),
  },
  {
    id: 'calendar',
    label: 'Calendar',
    icon: ico(<><rect x="2" y="3" width="12" height="11" rx="1.5" /><path d="M5 2v2M11 2v2M2 7h12" /></>),
  },
  {
    id: 'timeline',
    label: 'Timeline',
    icon: ico(<><path d="M2 5h5M2 8h9M2 11h6" /><circle cx="9" cy="5" r="1.5" fill="currentColor" stroke="none" /><circle cx="13" cy="8" r="1.5" fill="currentColor" stroke="none" /><circle cx="10" cy="11" r="1.5" fill="currentColor" stroke="none" /></>),
  },
  {
    id: 'workload',
    label: 'Workload',
    icon: ico(<><circle cx="6" cy="5" r="2.5" /><circle cx="11" cy="5" r="2" /><path d="M1 13c0-2.2 2-4 5-4s5 1.8 5 4" /><path d="M11 9c2 .5 3 1.8 3 3" /></>),
  },
  {
    id: 'priority',
    label: 'Priority',
    icon: ico(<path d="M2 3l12 0M2 7l8 0M2 11l5 0" />),
  },
  {
    id: 'mytasks',
    label: 'My Tasks',
    icon: ico(<><circle cx="8" cy="5" r="3" /><path d="M2 14c0-3 2.7-5 6-5s6 2 6 5" /><path d="M6 10.5l1.5 1.5 3-3" strokeWidth="1.8" /></>),
  },
];

/** The archive filter. Not a view — it filters whichever view is showing. */
export const IcArchive = (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <rect x="1" y="4" width="14" height="3" rx="1" /><path d="M2 7v6a1 1 0 001 1h10a1 1 0 001-1V7" /><path d="M6 10h4" />
  </svg>
);

export const IcPlus = (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M8 3v10M3 8h10" />
  </svg>
);

export const FIELD_TYPES = [
  { v: 'text', l: 'Text' },
  { v: 'number', l: 'Number' },
  { v: 'date', l: 'Date' },
  { v: 'select', l: 'Select / Dropdown' },
  { v: 'checkbox', l: 'Checkbox' },
  { v: 'url', l: 'URL' },
  { v: 'person', l: 'Person' },
];
