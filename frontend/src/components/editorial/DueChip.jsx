/**
 * Moved to `ui/DueChip.jsx` (02-common-components.md §5) — logic unchanged, it
 * is the most carefully-reasoned component in the build and the file says so.
 *
 * This shim stays because `views/KanbanCard.jsx` and `views/TableView.jsx`
 * import the path directly rather than through the barrel. It goes when the
 * file that restyles the board views moves those imports (04).
 */
export { default, relDue } from '../ui/DueChip';
