import React from 'react';

const COLORS = ['#0082c6','#03a1b6','#05b7aa','#d97706','#6366f1','#C0392B','#0A7A6E','#a78bfa'];

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

export function Avatar({ name, color, size = 28, ring, me, style }) {
  const bg = me ? 'linear-gradient(135deg,#0082c6,#05b7aa)' : (color || COLORS[Math.abs((name||'').length * 7) % COLORS.length]);
  return (
    <span
      className={'k-avatar' + (ring ? ' k-avatar--ring' : '') + (me ? ' k-avatar--me' : '')}
      style={{
        width: size, height: size,
        fontSize: Math.round(size * 0.4),
        background: bg,
        ...style,
      }}
      title={name}
    >
      {initials(name)}
    </span>
  );
}
