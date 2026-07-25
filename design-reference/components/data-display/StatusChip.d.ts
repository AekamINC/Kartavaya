/**
 * Colored dot + label chip for task/approval status. Auto-maps status keys to colors.
 */
export interface StatusChipProps {
  status?: string;
  columnName?: string;
  columnColor?: string;
}
export function StatusChip(props: StatusChipProps): JSX.Element;
