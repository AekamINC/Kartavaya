import React from 'react';

export function ProjectTag({ name, color, sanskrit, dense }) {
  if (!name) return null;
  return (
    <span className="k-ptag">
      {color && <span className="k-ptag__dot" style={{ background: color }} />}
      <span className="k-ptag__name">{name}</span>
      {!dense && sanskrit && <span className="k-ptag__sans">{sanskrit}</span>}
    </span>
  );
}
