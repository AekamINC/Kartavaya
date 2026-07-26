/**
 * Today's pieces — 05-today-dashboard.md §3.
 *
 * The page was 21,289 bytes with five components declared inline. Splitting it
 * is what lets the mobile Today screen (17-mobile-app.md) share `StatRow`
 * instead of reimplementing it.
 *
 * §3 puts these under `components/today/`; they live under `pages/today/`
 * because that is the tree this change owns. Nothing else imports them yet, so
 * the move is a rename when the mobile screen lands.
 */
export { default as StatRow }        from './StatRow';
export { default as QuickActions }   from './QuickActions';
export { default as ReceivablesKPI } from './ReceivablesKPI';
export { default as TaskListCard }   from './TaskListCard';
export { default as ProjectStatus }  from './ProjectStatus';
export { default as UpcomingWeek }   from './UpcomingWeek';
export { default as TeamPulse }      from './TeamPulse';
export { default as TodaySkeleton }  from './TodaySkeleton';
