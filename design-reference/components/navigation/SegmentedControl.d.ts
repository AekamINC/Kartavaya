/**
 * Pill-shaped radio group for filter tabs — Mine / All open / Overdue / Done.
 */
export interface SegmentedControlProps {
  options: Array<{ id: string; label: string; count?: number }>;
  active: string;
  onChange?: (id: string) => void;
}
export function SegmentedControl(props: SegmentedControlProps): JSX.Element;
