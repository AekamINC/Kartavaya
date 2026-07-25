/**
 * Circular avatar with initials derived from name. Supports ring (for stacking) and "me" gradient.
 */
export interface AvatarProps {
  name?: string;
  color?: string;
  size?: number;
  ring?: boolean;
  me?: boolean;
  style?: React.CSSProperties;
}
export function Avatar(props: AvatarProps): JSX.Element;
