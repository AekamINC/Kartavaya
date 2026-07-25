/**
 * Pill showing relative due date with color-coded urgency tone.
 */
export interface DueChipProps {
  /** ISO date string or display label when variant is set */
  date?: string;
  /** Override tone: danger (overdue), warn (today/tomorrow), normal, muted */
  variant?: 'danger' | 'warn' | 'normal' | 'muted';
  /** Flush mode: no border/background */
  flush?: boolean;
}
export function DueChip(props: DueChipProps): JSX.Element;
