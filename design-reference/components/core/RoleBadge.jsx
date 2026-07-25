import React from 'react';

export function RoleBadge({ role }) {
  return (
    <span className={'k-rolebadge k-rolebadge--' + (role || 'member')}>
      {role || 'member'}
    </span>
  );
}
