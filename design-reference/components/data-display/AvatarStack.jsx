import React from 'react';

const COLORS = ['#0082c6','#03a1b6','#05b7aa','#d97706','#6366f1','#C0392B','#0A7A6E','#a78bfa'];

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
}

export function AvatarStack({ users = [], max = 3, size = 22 }) {
  const shown = users.slice(0, max);
  const extra = users.length - shown.length;
  return (
    <span className="k-avstack" style={{ '--av-size': size + 'px' }}>
      {shown.map((u, i) => (
        <span key={i} className="k-avatar k-avatar--ring"
          style={{ width: size, height: size, fontSize: Math.round(size * 0.4), background: u.color || COLORS[i % COLORS.length] }}
          title={u.name || ''}
        >{initials(u.name)}</span>
      ))}
      {extra > 0 && (
        <span className="k-avstack__more" style={{ width: size, height: size }}>+{extra}</span>
      )}
    </span>
  );
}
