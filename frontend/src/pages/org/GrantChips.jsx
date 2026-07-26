import React from 'react';
import { moduleLabel } from './catalogue';
import { DEFAULT_GRANT_LEVEL, levelColor, levelLabel } from './levels';

/**
 * GrantChips — "Ganit · admin", three then +n.
 *
 * The LEVEL carries the colour, not the module. When you are scanning a member
 * list you are asking who can approve things, not which product they are in, so
 * the four level colours have to be the ones that separate at a glance.
 *
 * Three chips, then `+n`. A member with eleven grants would otherwise make the
 * row 60px tall and push everyone else off the screen. `title` on the overflow
 * carries the rest, so the information is one hover away rather than gone.
 */
export default function GrantChips({ grants = [], max = 3, empty = 'No modules' }) {
  if (!grants.length) return <span className="omt__more">{empty}</span>;

  // A grant with no level reads as `viewer`, and that is the truth rather than a
  // guess: `org_member_modules.role` is NOT NULL DEFAULT 'viewer', and the
  // endpoint that writes grants never names the column — so every row in the
  // system is at viewer whether or not the API says so.
  const level = g => g.level || DEFAULT_GRANT_LEVEL;
  const shown = grants.slice(0, max);
  const rest = grants.slice(max);

  return (
    <span className="omt__gr">
      {shown.map(g => (
        <span key={g.code} className="gc" style={{ '--c': levelColor(level(g)) }}>
          <span className="gc__m">{moduleLabel(g.code)}</span>
          <span className="gc__l">{levelLabel(level(g))}</span>
        </span>
      ))}
      {rest.length > 0 && (
        <span
          className="omt__more"
          title={rest.map(g => `${moduleLabel(g.code)} · ${levelLabel(level(g))}`).join('\n')}
        >
          +{rest.length}
        </span>
      )}
    </span>
  );
}
