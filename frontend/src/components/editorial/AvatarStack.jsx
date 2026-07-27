import React from 'react';
import { userInitials } from '../../lib/utils';
import { avatarBg } from '../ui/Avatar';

export default function AvatarStack({ users = [], max = 3, size = 22 }) {
  const shown = users.slice(0, max);
  const extra = users.length - shown.length;
  return (
    <span className="k-avstack" style={{ '--av-size': size + 'px' }}>
      {shown.map((u, i) => (
        <span
          key={i}
          className="k-avatar k-avatar--ring"
          style={{
            width: size,
            height: size,
            fontSize: Math.round(size * 0.4),
            // See avatarBg — the legacy palette failed behind white initials.
            background: u.color || avatarBg(u.name || String(i)),
          }}
          title={u.name || ''}
        >
          {u.initials || userInitials(u.name || '')}
        </span>
      ))}
      {extra > 0 && (
        <span className="k-avstack__more" style={{ width: size, height: size }}>
          +{extra}
        </span>
      )}
    </span>
  );
}
