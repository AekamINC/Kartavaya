import React from 'react';
import { useCustomize } from '../../components/CustomizePanel';
import Seg from '../../components/customize/Seg';

export default function TabLayout() {
  const { prefs, setPrefs } = useCustomize();

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
    </div>
  );
}
