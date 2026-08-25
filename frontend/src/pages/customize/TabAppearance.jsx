import React from 'react';
import { useCustomize, LIQUID_GLASS_PRESETS } from '../../components/CustomizePanel';
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

      <div className="sr">
        <div className="sr__l">
          <div className="sr__t">Glass intensity</div>
          <div className="sr__d">Controls blur, saturation and transparency of glass surfaces.</div>
        </div>
        <div className="sr__c">
          <input
            type="range" min="0" max="1" step="0.05"
            value={prefs.glassMix ?? 0.6}
            onChange={e => setPrefs({ glassMix: +e.target.value })}
            aria-label="Glass intensity"
            style={{ width: '100%' }}
          />
        </div>
      </div>

      <div className="sr">
        <div className="sr__l">
          <div className="sr__t">Liquid glass</div>
          <div className="sr__d">Apple-style refraction effect on glass surfaces. Uses SVG displacement.</div>
        </div>
        <div className="sr__c">
          <Seg
            value={prefs.liquidGlass || 'off'}
            onChange={v => setPrefs({ liquidGlass: v })}
            label="Liquid glass preset"
            options={[
              { value: 'off',    label: 'Off' },
              { value: 'subtle', label: 'Subtle' },
              { value: 'medium', label: 'Medium' },
              { value: 'full',   label: 'Full' },
            ]}
          />
        </div>
      </div>

      <div className="sr">
        <div className="sr__l">
          <div className="sr__t">Glass lens</div>
          <div className="sr__d">A draggable refraction lens you can move around the screen.</div>
        </div>
        <div className="sr__c">
          <Seg
            value={prefs.glassLens ? 'on' : 'off'}
            onChange={v => setPrefs({ glassLens: v === 'on' })}
            label="Glass lens"
            options={[
              { value: 'off', label: 'Off' },
              { value: 'on',  label: 'On' },
            ]}
          />
        </div>
      </div>

      {/* Live preview — shows how glass looks on actual component shapes */}
      {(prefs.liquidGlass || 'off') !== 'off' && (
        <div className="sr" style={{ flexDirection: 'column', gap: 16 }}>
          <div className="sr__t">Live preview</div>
          <div className="sr__d" style={{ marginBottom: 8 }}>
            Hover over the cards below to see the depth effect. These are the same
            styles applied across dashboards, reports, and all module surfaces.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <div className="k-stat">
              <div className="k-stat__kicker">OPEN TASKS</div>
              <div className="k-stat__val">80</div>
              <div className="k-stat__sub">across 10 projects</div>
            </div>
            <div className="k-stat k-stat--warn">
              <div className="k-stat__kicker">OVERDUE</div>
              <div className="k-stat__val">35</div>
              <div className="k-stat__sub">needs attention</div>
            </div>
            <div className="k-stat k-stat--ok">
              <div className="k-stat__kicker">DONE THIS WEEK</div>
              <div className="k-stat__val">7</div>
              <div className="k-stat__sub">7 more than last week</div>
            </div>
            <div className="k-stat k-stat--neutral">
              <div className="k-stat__kicker">DUE TODAY</div>
              <div className="k-stat__val">3</div>
              <div className="k-stat__sub">1 high priority</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <section className="k-card" style={{ padding: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Sample card</div>
              <div style={{ fontSize: 13, color: 'var(--on-surface-2)' }}>
                This is how a dashboard card, report panel, or data section looks
                with the current glass preset. Hover to see the depth lift.
              </div>
            </section>
            <section className="k-card" style={{ padding: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Another card</div>
              <div style={{ fontSize: 13, color: 'var(--on-surface-2)' }}>
                Every bordered surface in Kartavya — stats, KPIs, panels, tables,
                menus, popovers — all respond to this setting.
              </div>
            </section>
          </div>

          <div className="gn-panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Finance panel</div>
            <div style={{ fontSize: 13, color: 'var(--on-surface-2)' }}>
              Ganit panels, receivables KPI, report cards — they all get the same
              glass border glow, depth shadow, and hover lift.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
