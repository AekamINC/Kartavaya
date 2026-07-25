/**
 * Small uppercase badge for user roles — admin (blue), member (teal), client (violet).
 */
export interface RoleBadgeProps {
  role: 'admin' | 'member' | 'client';
}
export function RoleBadge(props: RoleBadgeProps): JSX.Element;
