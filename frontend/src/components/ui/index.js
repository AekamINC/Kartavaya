/**
 * The one barrel for shared primitives — 02-common-components.md §2.
 *
 * Staging had two component systems that did not share tokens: Tailwind
 * primitives in `ui/*.js` (`cn()` + utility classes, `accent`/`bgMuted`/
 * `textSubtle`) and the editorial set (CSS classes on custom properties). They
 * disagreed on concrete values — `Button` was `rounded-full` while `Input` was
 * `rounded-2xl`, so a button and an input side by side had different corner
 * radii — and `Badge` existed twice under one name, both exported.
 *
 * One system. Everything below is CSS classes on custom properties, styled from
 * `styles/components.css`, with no Tailwind and no component library.
 */

/* Form and action */
export { default as Button } from './Button';
export { Field, Input, Select, Textarea, Row2 } from './Field';
export { default as Toggle } from './Toggle';
export { default as Checkbox } from './Checkbox';
export { default as Radio, RadioGroup } from './Radio';

/* Surfaces */
export { Card, CardHead, CardBody } from './Card';
export { Modal, ModalHead, ModalBody, ModalFoot } from './modal';
export { default as ConfirmDialog } from './ConfirmDialog';
export { default as Sheet } from './Sheet';
export { default as Popover } from './Popover';
export { default as Menu } from './Menu';
export { default as FocusTrap } from './FocusTrap';

/* Data display */
export { default as Tag } from './Tag';
export { Chip, ChipRow } from './Chip';
export { default as StatusChip } from './StatusChip';
export { default as DueChip, relDue } from './DueChip';
export { default as StatTile } from './StatTile';
export { Avatar, AvatarStack, avatarBg } from './Avatar';
export { default as Table, TableHead, TableBody, Row, Cell, HeadCell, BulkBar, nextSort } from './Table';
export { default as Stepper } from './Stepper';
export { Tabs } from './Tabs';
export { StatusBar } from './StatusBar';
export { Tooltip } from './Tooltip';

/* Selection */
export { default as Picker, PickerDate, usePicker } from './Picker';
export { default as ServerPicker } from './ServerPicker';
export { DatePicker } from './DatePicker';

/* Empty, loading, error — the three states a component spends most of its life
   in, and the three the build renders as a blank div (26 §9). */
export { default as EmptyState } from './EmptyState';
export { default as ErrorState, errorKind, OfflineBanner } from './ErrorState';
export {
  SkeletonText, SkeletonAvatar, SkeletonCard, SkeletonCardGrid, SkeletonTable,
  SkeletonPage, SkeletonRegion, SkeletonList, SkeletonBoard, SkeletonChat,
} from './Skeleton';

/* Feedback */
export { ToastProvider, useToast } from './toast';
export { default as SkipLink } from './SkipLink';
