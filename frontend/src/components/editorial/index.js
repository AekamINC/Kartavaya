/**
 * Editorial barrel.
 *
 * 02-common-components.md §5 moves this barrel to `ui/index.js` and absorbs the
 * primitives into it. Three have moved so far — StatusChip, DueChip and
 * StatTile — and they are re-exported from here so the forty-odd pages that
 * import `from '../components/editorial'` keep working while the migration
 * runs. New work imports from `components/ui`.
 *
 * The rest (Hero, PageHeader, WeekStrip, Citation, ProjectTag, the ModuleUI
 * set) are page-specific compositions rather than primitives and stay put until
 * the file that restyles their surface moves them — 26 §7: absorb only while
 * you are already editing that page, never as a standalone sweep.
 */
export { default as Hero }        from './Hero';
export { default as PageHeader }  from './PageHeader';
export { default as Card }        from './Card';
export { default as PriorityDot } from './PriorityDot';
export { default as ProjectTag }  from './ProjectTag';
export { default as AvatarStack } from './AvatarStack';
export { default as WeekStrip }   from './WeekStrip';
export { default as Citation }    from './Citation';
export { TabBar, Section, Badge, Shimmer, Empty, BackButton, ModCard, DataTable, Td } from './ModuleUI';

/* Moved to components/ui — same components, new home. */
export { default as StatTile }   from '../ui/StatTile';
export { default as DueChip }    from '../ui/DueChip';
export { default as StatusChip } from '../ui/StatusChip';
