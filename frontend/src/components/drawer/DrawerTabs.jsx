import React from 'react';
import { Tabs } from '../ui/Tabs';

/**
 * DrawerTabs — Details · Comments · Files · Time · Activity, with counts.
 *
 * It is a thin composition over `ui/Tabs.jsx` rather than a second tab
 * implementation: `Tabs` already carries the sliding indicator, the roving
 * tabindex and the `aria-controls`/`aria-labelledby` pairing, and a drawer with
 * its own copy is how two tab bars end up disagreeing about which one has a
 * focus ring.
 *
 * What lives here is the part that IS drawer-specific and was previously inline
 * in a 700-line `TaskDrawer.jsx`: the order of the tabs, their labels, their
 * counts, and the fact that Time is hidden from clients. Panels arrive as
 * props, so `TaskDrawer` stays orchestration.
 *
 * `count` is passed even when zero. "Files" and "Files 0" say different things —
 * the second is a statement that there are none, the first is a question.
 */
export default function DrawerTabs({
  details, detailsCount,
  comments, commentCount,
  files, fileCount,
  time, timeCount,
  activity, activityCount,
  showTime = true,
  onChange,
}) {
  const tabs = [
    { value: 'details',  label: 'Details',  count: detailsCount,  content: details },
    { value: 'comments', label: 'Comments', count: commentCount,  content: comments },
    { value: 'files',    label: 'Files',    count: fileCount,     content: files },
    ...(showTime ? [{ value: 'time', label: 'Time', count: timeCount, content: time }] : []),
    { value: 'activity', label: 'Activity', count: activityCount, content: activity },
  ];

  return <Tabs defaultTab="details" tabs={tabs} onChange={onChange} />;
}
