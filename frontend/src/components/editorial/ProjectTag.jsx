import React from 'react';

export default function ProjectTag({ name, color, sanskrit, dense }) {
  if (!name) return null;
  return (
    <span className="k-ptag">
      {color && <span className="k-ptag__dot" style={{ background: color }} />}
      <span className="k-ptag__name">{name}</span>
      {/* lang="hi" — editorial.css keys the no-tracking and Devanagari-leading
          rules off [lang], and this span sits inside a chip that may be tracked. */}
      {!dense && sanskrit && <span className="k-ptag__sans" lang="hi">{sanskrit}</span>}
    </span>
  );
}
