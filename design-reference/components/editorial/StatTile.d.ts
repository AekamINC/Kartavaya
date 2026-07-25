/**
 * Metric tile with large Newsreader number, label, optional sub text. Four color variants.
 * @startingPoint section="Data Display" subtitle="Stat tile with colored number" viewport="700x120"
 */
export interface StatTileProps {
  label: string;
  sanskrit?: string;
  value: React.ReactNode;
  sub?: string;
  variant?: 'blue' | 'teal' | 'amber' | 'red';
}
export function StatTile(props: StatTileProps): JSX.Element;
