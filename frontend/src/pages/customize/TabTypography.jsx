import React from 'react';
import { useCustomize, DISPLAY_FONTS, UI_FONTS } from '../../components/CustomizePanel';
import FontList from '../../components/customize/FontList';
import TypePreview from '../../components/customize/TypePreview';
import Seg from '../../components/customize/Seg';

export default function TabTypography() {
  const { prefs, setPrefs } = useCustomize();
  const size = prefs.fontSize || 14;

  return (
    <div className="st__group">
      <div className="sr sr--col">
        <div className="sr__l">
          <div className="sr__t">Display font</div>
          <div className="sr__d">Headings, page titles and pull quotes.</div>
        </div>
        <FontList
          fonts={DISPLAY_FONTS}
          value={prefs.font}
          onChange={id => setPrefs({ font: id })}
          label="Display font"
        />
      </div>

      <div className="sr sr--col">
        <div className="sr__l">
          <div className="sr__t">Interface font</div>
          <div className="sr__d">
            Labels, table cells, buttons and body copy. Independent of the display
            font — a serif for headings no longer drags the whole interface with it.
          </div>
        </div>
        <FontList
          fonts={UI_FONTS}
          value={prefs.uiFont || 'inter'}
          onChange={id => setPrefs({ uiFont: id })}
          label="Interface font"
        />
      </div>

      <div className="sr">
        <div className="sr__l">
          <div className="sr__t">Text size</div>
          <div className="sr__d">Scales body copy and everything derived from it.</div>
        </div>
        <div className="sr__c" style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 210 }}>
          <input
            type="range" min={12} max={20} step={1} value={size}
            onChange={e => setPrefs({ fontSize: parseInt(e.target.value, 10) })}
            aria-label="Text size in pixels"
            style={{ flex: 1, accentColor: 'var(--primary)', cursor: 'pointer' }}
          />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, minWidth: 38 }}>
            {size}px
          </span>
        </div>
      </div>

      <div className="sr">
        <div className="sr__l">
          <div className="sr__t">Line height</div>
          <div className="sr__d">Tighter suits dense tables; looser suits long descriptions.</div>
        </div>
        <div className="sr__c">
          <Seg
            label="Line height"
            value={String(prefs.lineHeight || 1.5)}
            onChange={v => setPrefs({ lineHeight: parseFloat(v) })}
            options={[
              { label: 'Tight',   value: '1.3' },
              { label: 'Normal',  value: '1.5' },
              { label: 'Relaxed', value: '1.7' },
            ]}
          />
        </div>
      </div>

      <div className="sr sr--col">
        <div className="sr__l"><div className="sr__t">Preview</div></div>
        <TypePreview
          font={prefs.font}
          uiFont={prefs.uiFont}
          fontSize={size}
          lineHeight={prefs.lineHeight}
        />
      </div>
    </div>
  );
}
