import React from 'react';
import { NOTIF_SOUND_GROUPS, playNotifSound } from '../../lib/notifSound';

/**
 * SoundGrid — tapping a card selects it AND plays it.
 *
 * A separate play button doubles the number of targets for no benefit: nobody
 * wants to preview a sound they are not considering, and nobody selects one
 * they have not heard. One target does both.
 *
 * The bars animate only on the selected card, staggered by index. The animation
 * is scaled by --ix, which already collapses under both the OS reduced-motion
 * setting and the user's own animation preference.
 */
export default function SoundGrid({ value, onChange }) {
  const choose = (id) => {
    onChange(id);
    if (id !== 'none') playNotifSound(id);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {NOTIF_SOUND_GROUPS.map(g => (
        <div key={g.group}>
          <div className="st__gt" style={{ color: 'var(--on-surface-3)', marginBottom: 7 }}>
            {g.group}
            {g.hi && <span className="st__gh" lang="hi" style={{ marginLeft: 6 }}>{g.hi}</span>}
          </div>
          <div className="snd" role="radiogroup" aria-label={`${g.group} sounds`}>
            {g.sounds.map(s => {
              const on = value === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={`snd__c${on ? ' on' : ''}`}
                  onClick={() => choose(s.id)}
                >
                  <span className="snd__w" aria-hidden="true">
                    {[0, 1, 2, 3].map(i => (
                      <i key={i} style={{ animationDelay: `${i * 90}ms`, height: `${45 + i * 18}%` }} />
                    ))}
                  </span>
                  <span>
                    {s.label}
                    {s.hi && <span lang="hi" style={{ opacity: .7, marginLeft: 4 }}>{s.hi}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
