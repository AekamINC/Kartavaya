/**
 * Overlapping avatar initials with +N overflow badge.
 */
export interface AvatarStackProps {
  users?: Array<{ name?: string; color?: string; initials?: string }>;
  max?: number;
  size?: number;
}
export function AvatarStack(props: AvatarStackProps): JSX.Element;
