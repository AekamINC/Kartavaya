import React from 'react';

export function IconButton({ children, onClick, title, ariaLabel, dot, style }) {
  return (
    <button className="k-iconbtn" onClick={onClick} title={title} aria-label={ariaLabel || title} style={style}>
      {children}
      {dot && <span className="k-iconbtn__dot" />}
    </button>
  );
}
