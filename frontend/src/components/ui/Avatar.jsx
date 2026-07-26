import React from 'react';
import { userInitials } from '../../lib/utils';

/**
 * Avatar · AvatarStack (02-common-components.md §2, 26-component-inventory.md §8).
 *
 * The colour is a deterministic hash of the name, so the same person is the
 * same colour on every screen without anything being stored. `AVATAR_COLORS`
 * in lib/utils.js is the legacy list and still carries the retired brand blue
 * `#0082c6`; these six are drawn from the palette instead and are dark enough
 * that white initials clear AA on all of them.
 *
 * Falls back to initials from `name` when there is no image — the existing
 * `.split(' ').map(w => w[0]).slice(0, 2)` behaviour in `userInitials`, kept.
 */
const AV_BG = ['#0F6E66', '#8A5A2B', '#5B4A7C', '#2F6B4F', '#8C3F52', '#3E5C8A'];

export function avatarBg(name) {
  let h = 0;
  for (const ch of String(name || '?')) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return AV_BG[h % AV_BG.length];
}

export function Avatar({ name = '?', src, size = 24, className = '', ...rest }) {
  const style = {
    width: size,
    height: size,
    fontSize: Math.round(size * 0.41),
    '--av-bg': src ? 'transparent' : avatarBg(name),
  };
  return (
    <span className={`av ${className}`.trim()} style={style} title={name || undefined} {...rest}>
      {src ? <img src={src} alt="" /> : userInitials(name)}
    </span>
  );
}

/**
 * Three, then `+n`. The overlap ring paints in the PARENT's background colour,
 * which is why it is a prop and not a constant: a stack on `--s-low` with a
 * `--surface` ring draws a visible halo around every face.
 */
export function AvatarStack({ users = [], max = 3, size = 22, ring, className = '' }) {
  const shown = users.slice(0, max);
  const extra = users.length - shown.length;
  return (
    <span className={`avstack ${className}`.trim()} style={ring ? { '--ring': ring } : undefined}>
      {shown.map((u, i) => (
        <Avatar key={u.id ?? u.user_id ?? i} name={u.name || u.full_name || u.display_name} src={u.avatar_url} size={size} />
      ))}
      {extra > 0 && (
        <span className="avstack__n" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}>
          +{extra}
        </span>
      )}
    </span>
  );
}

export default Avatar;
