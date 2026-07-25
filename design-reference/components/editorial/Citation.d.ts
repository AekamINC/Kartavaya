/**
 * Sanskrit/Hindi quote block with left accent border. Used on the dashboard right column.
 */
export interface CitationProps {
  sanskrit?: string;
  english?: string;
  source: string;
}
export function Citation(props: CitationProps): JSX.Element;
