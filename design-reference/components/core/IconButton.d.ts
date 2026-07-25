/**
 * 34×34 square icon button with optional notification dot.
 */
export interface IconButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
  ariaLabel?: string;
  /** Show a red notification dot */
  dot?: boolean;
  style?: React.CSSProperties;
}
export function IconButton(props: IconButtonProps): JSX.Element;
