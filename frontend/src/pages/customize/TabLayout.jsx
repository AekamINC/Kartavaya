import React from 'react';
import { useCustomize } from '../../components/CustomizePanel';
import Seg from '../../components/customize/Seg';
import { mobileNavChoicesFor, mobileNavFor, MOBILE_NAV_DEFAULT } from '../../components/layout/navConfig';
import { currentUser } from '../../lib/auth';

export default function TabLayout() {
  const { prefs, setPrefs } = useCustomize();

  /* ── The bottom bar's three slots ────────────────────────────────────────
     Arrangeable because the right three differ per PERSON, not per product.
     Sales reach for CRM and Sales hourly; a site supervisor wants Attendance;
     an accountant wants Finance. Any fixed set is wrong for most of the firm.

     Choices are grant-filtered through the same `navGroupsFor` the sidebar
     uses, so this can never offer a destination the chooser cannot open.

     ＋ and More are not offered: More is the only way back to the other thirty
     destinations, and the bar cannot give that away. */
  const choices = mobileNavChoicesFor(currentUser());
  const chosen = Array.isArray(prefs.mobileNav) ? prefs.mobileNav : MOBILE_NAV_DEFAULT;
  const setSlot = (i, to) => {
    const next = [...chosen];
    if (to === '') next.splice(i, 1); else next[i] = to;
    // De-duplicate: the same destination twice would waste a slot on a bar
    // that only has three.
    setPrefs({ mobileNav: [...new Set(next)].filter(Boolean).slice(0, 3) });
  };
  const preview = mobileNavFor(chosen);

  return (
    <div className="st__group">
      <div className="sr">
        <div className="sr__l">
          <div className="sr__t">Sidebar</div>
          <div className="sr__d">Rail collapses to icons and keeps labels in tooltips.</div>
        </div>
        <div className="sr__c">
          <Seg
            label="Sidebar width"
            value={prefs.sidebar}
            onChange={v => setPrefs({ sidebar: v })}
            options={[{ label: 'Wide', value: 'wide' }, { label: 'Rail', value: 'rail' }]}
          />
        </div>
      </div>

      <div className="sr">
        <div className="sr__l">
          <div className="sr__t">Density</div>
          <div className="sr__d">Compact tightens row padding across tables and lists. Cozy is the default.</div>
        </div>
        <div className="sr__c">
          {/* Three tiers, matching `Chrome.jsx:196`. Cozy was missing entirely,
              so the default tier had no control that could return you to it:
              anyone who tried Compact was stuck choosing between the tightest
              and the loosest. */}
          <Seg
            label="Density"
            value={prefs.density}
            onChange={v => setPrefs({ density: v })}
            options={[
              { label: 'Compact', value: 'compact' },
              { label: 'Cozy',    value: 'cozy' },
              { label: 'Comfy',   value: 'comfy' },
            ]}
          />
        </div>
      </div>

      <div className="sr">
        <div className="sr__l">
          <div className="sr__t">Fit to screen</div>
          <div className="sr__d">
            On a laptop panel — 1366&times;768, or a 1080p screen at Windows&rsquo; 125%
            scaling — this tightens the page header, the stat strip and the row
            height so more of the table is above the fold. It never loosens
            anything, and it leaves Compact alone.
          </div>
        </div>
        <div className="sr__c">
          <Seg
            label="Fit to screen"
            value={prefs.fit || 'on'}
            onChange={v => setPrefs({ fit: v })}
            options={[{ label: 'On', value: 'on' }, { label: 'Off', value: 'off' }]}
          />
        </div>
      </div>

      <div className="sr">
        <div className="sr__l">
          <div className="sr__t">Corner radius</div>
          <div className="sr__d">Drives every --r-* step, so cards, inputs and chips stay in proportion.</div>
        </div>
        <div className="sr__c">
          <Seg
            label="Corner radius"
            value={String(prefs.radius || 12)}
            onChange={v => setPrefs({ radius: parseInt(v, 10) })}
            /* 8 | 12 | 20. The harness drives this from a slider with min 8
               (`Chrome.jsx:190`) and defaults to 12, so `4` was outside the
               design's range and `10` was not a value it ever renders. */
            options={[
              { label: 'Sharp',   value: '8' },
              { label: 'Default', value: '12' },
              { label: 'Round',   value: '20' },
            ]}
          />
        </div>
      </div>

      <div className="sr">
        <div className="sr__l">
          <div className="sr__t">Animation</div>
          {/* This writes --ix-user, never --ix. An inline style on the root
              outranks a media query, so writing --ix directly would let this
              preference silently defeat the OS reduced-motion setting. */}
          <div className="sr__d">
            If your device already asks for reduced motion, that wins regardless of this setting.
          </div>
        </div>
        <div className="sr__c">
          <Seg
            label="Animation"
            value={prefs.anim || 'full'}
            onChange={v => setPrefs({ anim: v })}
            options={[
              { label: 'Full',    value: 'full' },
              { label: 'Reduced', value: 'reduced' },
              { label: 'None',    value: 'none' },
            ]}
          />
        </div>
      </div>

      <div className="sr sr--col">
        <div className="sr__l">
          <div className="sr__t">Bottom bar on phones</div>
          <div className="sr__d">
            Three destinations of your choosing. ＋ and More are fixed — More is how you
            reach everything else. Only what you already have access to is offered.
          </div>
        </div>
        <div className="sr__c">
          <div className="mnavpick">
            {[0, 1, 2].map(i => (
              <label className="mnavpick__slot" key={i}>
                <span className="mnavpick__n">Slot {i + 1}</span>
                <select
                  className="k-input"
                  value={chosen[i] || ''}
                  onChange={e => setSlot(i, e.target.value)}
                  aria-label={`Bottom bar slot ${i + 1}`}
                >
                  <option value="">— empty —</option>
                  {choices.map(c => (
                    <option key={c.to} value={c.to}>{c.en}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          {/* The bar as it will render, so the arrangement is visible without
              reaching for a phone. Same order the component builds. */}
          <div className="mnavpick__preview" aria-label="Preview of the bottom bar">
            {preview.map((it, i) => (
              <span key={i} className={'mnavpick__cell' + (it.kind === 'fab' ? ' is-fab' : '')}>
                {it.kind === 'fab' ? '＋' : it.en}
              </span>
            ))}
          </div>

          <button
            type="button"
            className="k-btn k-btn--ghost hb-btn--sm"
            onClick={() => setPrefs({ mobileNav: null })}
          >
            Reset to default
          </button>
        </div>
      </div>
    </div>
  );
}
