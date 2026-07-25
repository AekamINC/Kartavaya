/**
 * Surface container with optional serif title + Sanskrit label. The workhorse layout card.
 * @startingPoint section="Layout" subtitle="Content card with bilingual header" viewport="700x160"
 */
export interface CardProps {
  title?: string;
  sanskrit?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  noPad?: boolean;
}
export function Card(props: CardProps): JSX.Element;
