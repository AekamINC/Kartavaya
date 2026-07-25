/**
 * Kanban board card with ID, priority dot, title, footer (due chip, meta counts, avatars).
 * @startingPoint section="Patterns" subtitle="Kanban card" viewport="300x160"
 */
export interface KanbanCardProps {
  id: string;
  title: string;
  priority?: 'urgent' | 'high' | 'medium' | 'low';
  assignees?: Array<{ name: string; color?: string }>;
  comments?: number;
  attachments?: number;
  due?: React.ReactNode;
  onClick?: () => void;
}
export function KanbanCard(props: KanbanCardProps): JSX.Element;
