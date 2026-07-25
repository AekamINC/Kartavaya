/**
 * Team member card with avatar, role badge, stats row, and recent task list.
 * @startingPoint section="Patterns" subtitle="Team member card" viewport="320x260"
 */
export interface MemberCardProps {
  name: string;
  role?: 'admin' | 'member' | 'client';
  tz?: string;
  avatar?: { color?: string };
  openTasks?: number;
  doneThisWeek?: number;
  avgCycle?: string;
  recentTasks?: Array<{ title: string; id: string; priority?: string }>;
}
export function MemberCard(props: MemberCardProps): JSX.Element;
