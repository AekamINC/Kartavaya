import React from 'react';
import { useCustomize } from '../../components/CustomizePanel';
import AccentGrid from '../../components/customize/AccentGrid';
import AccentPreview from '../../components/customize/AccentPreview';
import SidebarBgCards from '../../components/customize/SidebarBgCards';
import { ConvPatternCards, ConvGroundCards } from '../../components/customize/ConversationGround';
import Seg from '../../components/customize/Seg';
import { DEFAULT_CONV_PATTERN, DEFAULT_CONV_GROUND } from '../../lib/convGround';

export default function TabAppearance() {
  const { prefs, setPrefs } = useCustomize();

  return (
    <div className="st__group">
      <div className="sr">
        <div className="sr__l">
          <div className="sr__t">Mode</div>
          {/* System is a live subscription, not a boot-time read — the
              matchMedia listener lives in CustomizeProvider. */}
          <div className="sr__d">System follows your device, including when it switches at sunset.</div>
        </div>
        <div className="sr__c">
          <Seg
            value={prefs.mode}
            onChange={v => setPrefs({ mode: v })}
            label="Theme mode"
            options={[
              // No glyphs. U+2600 renders as a colour emoji on Windows and
              // Android and as a hairline outline on macOS, so the same control
              // was a pictogram on one platform and a smudge on another — and
              // it went into the radio's accessible name either way.
              { label: 'Light',  value: 'light' },
              { label: 'Dark',   value: 'dark' },
              { label: 'System', value: 'system' },
            ]}
          />
        </div>
      </div>

      <div className="sr sr--col">
        <div className="sr__l">
          <div className="sr__t">Accent colour</div>
          <div className="sr__d">
            Used for primary buttons, links, the active sidebar row, selected chips and progress.
          </div>
        </div>
        <div>
          <AccentGrid
            accent={prefs.accent}
            customAccent={prefs.customAccent}
            onPick={id => setPrefs({ accent: id, customAccent: null })}
            onCustom={hex => setPrefs({ customAccent: hex })}
          />
          <AccentPreview />
        </div>
      </div>

      <div className="sr sr--col">
        <div className="sr__l">
          <div className="sr__t">Sidebar background</div>
          <div className="sr__d">The light variant also flips the active row so it stays readable.</div>
        </div>
        <SidebarBgCards
          value={prefs.sideBg || 'dark'}
          onChange={v => setPrefs({ sideBg: v })}
        />
      </div>

      {/* The conversation ground — two axes, two rows, because they are two
          independent settings and one combined control would have to decide
          which of five patterns pairs with which of four grounds. */}
      <div className="sr sr--col">
        <div className="sr__l">
          <div className="sr__t">Conversation pattern</div>
          <div className="sr__d">
            A faint texture behind Sanvaad and Sahayak. Never on a module page.
          </div>
        </div>
        <ConvPatternCards
          value={prefs.convPattern || DEFAULT_CONV_PATTERN}
          onChange={v => setPrefs({ convPattern: v })}
        />
      </div>

      <div className="sr sr--col">
        <div className="sr__l">
          <div className="sr__t">Conversation ground</div>
          <div className="sr__d">
            The tint under the texture. Accent follows the colour you picked above.
          </div>
        </div>
        <ConvGroundCards
          value={prefs.convGround || DEFAULT_CONV_GROUND}
          onChange={v => setPrefs({ convGround: v })}
        />
      </div>
    </div>
  );
}
