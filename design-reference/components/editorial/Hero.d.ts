/**
 * Dashboard hero — greeting with watermark, date line, week strip.
 * Used only on the Today/Dashboard screen.
 * @startingPoint section="Screens" subtitle="Dashboard hero greeting with week strip" viewport="700x280"
 */
export interface HeroProps {
  name: string;
  dateLine?: Array<{ label: string; hindi?: boolean }>;
  lede?: React.ReactNode;
  weekDates?: Array<Date | number>;
  dotsByDay?: Record<string, number>;
  todayIdx?: number;
}
export function Hero(props: HeroProps): JSX.Element;
