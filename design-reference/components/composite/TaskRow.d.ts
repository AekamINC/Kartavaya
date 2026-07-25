/**
 * Table-style task row with priority dot, ID, title, project tag, avatars, due chip.
 * @startingPoint section="Patterns" subtitle="Task list row" viewport="700x60"
 */
export interface TaskRowProps {
  id: string;
  title: string;
  project?: { name: string; color: string };
  priority?: 'urgent' | 'high' | 'medium' | 'low';
  assignees?: Array<{ name: string; color?: string }>;
  due?: React.ReactNode;
  onClick?: () => void;
}
export function TaskRow(props: TaskRowProps): JSX.Element;
