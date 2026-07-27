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
          <div className="sr__d">Cozy is the design's own spacing. Compact tightens row padding across tables and lists; Comfy loosens it.</div>
        </div>
        <div className="sr__c">
          {/* Three tiers. `cozy` is the middle one and the default — the tokens
              for it have always been in kartavaya-design.css §4, but it was
              missing from this control, so the tier the product is designed at
              was the one tier nobody could pick. */}
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
            value={String(prefs.radius || 10)}
            onChange={v => setPrefs({ radius: parseInt(v, 10) })}
            options={[
              { label: 'Sharp',   value: '4' },
              { label: 'Default', value: '10' },
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
