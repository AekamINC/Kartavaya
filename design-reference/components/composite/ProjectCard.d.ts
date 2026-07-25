/**
 * Project grid card with color bar, Sanskrit name, client label, stats, and progress bar.
 * @startingPoint section="Patterns" subtitle="Project card with progress" viewport="320x220"
 */
export interface ProjectCardProps {
  name: string;
  sanskrit?: string;
  client?: string;
  color?: string;
  tasks?: number;
  done?: number;
  daysLeft?: number;
  progress?: number;
  onClick?: () => void;
}
export function ProjectCard(props: ProjectCardProps): JSX.Element;
