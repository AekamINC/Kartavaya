/**
 * Page header with uppercase kicker, serif title, Devanagari pair, lede, and right-side actions.
 * Used on every non-dashboard page.
 * @startingPoint section="Layout" subtitle="Page header with kicker, title, Hindi label" viewport="700x120"
 */
export interface PageHeaderProps {
  kicker?: string;
  title: string;
  sanskrit?: string;
  lede?: string;
  right?: React.ReactNode;
}
export function PageHeader(props: PageHeaderProps): JSX.Element;
