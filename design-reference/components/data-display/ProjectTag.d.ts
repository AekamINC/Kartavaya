/**
 * Inline project label with color dot and optional Devanagari name.
 */
export interface ProjectTagProps {
  name: string;
  color?: string;
  sanskrit?: string;
  dense?: boolean;
}
export function ProjectTag(props: ProjectTagProps): JSX.Element;
