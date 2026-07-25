/**
 * Kartavya button — gradient primary, ghost outline, reject danger, small size.
 * @dsCard group="Components"
 * @startingPoint section="Controls" subtitle="Primary, ghost, reject buttons" viewport="700x100"
 */
export interface ButtonProps {
  children: React.ReactNode;
  /** 'primary' (gradient), 'ghost' (outline), 'reject' (danger border) */
  variant?: 'primary' | 'ghost' | 'reject';
  /** 'default' or 'sm' */
  size?: 'default' | 'sm';
  onClick?: () => void;
  disabled?: boolean;
  style?: React.CSSProperties;
  className?: string;
}
export function Button(props: ButtonProps): JSX.Element;
