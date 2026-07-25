/**
 * Colored circle indicating task priority level.
 */
export interface PriorityDotProps {
  priority: 'urgent' | 'high' | 'medium' | 'low';
  size?: number;
}
export function PriorityDot(props: PriorityDotProps): JSX.Element;
