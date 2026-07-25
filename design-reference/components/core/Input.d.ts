/**
 * Kartavya text input with warm paper background and accent focus ring.
 */
export interface InputProps {
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  type?: string;
  style?: React.CSSProperties;
  className?: string;
}
export function Input(props: InputProps): JSX.Element;
