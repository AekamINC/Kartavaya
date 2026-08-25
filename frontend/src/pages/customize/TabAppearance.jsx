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

      {/* Live preview — shows how liquid glass looks on every surface type */}
      <div className="sr" style={{ flexDirection: 'column', gap: 16, padding: 20 }}>
        <div>
          <div className="sr__t">Live preview</div>
          <div className="sr__d">
            Hover over any element to see the accent-tinted depth lift.
            Change the accent color above — borders and shadows follow it.
          </div>
        </div>

        {/* Row 1 — KPI stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          <div className="k-stat">
            <div className="k-stat__lbl">OPEN</div>
            <div className="k-stat__val">80</div>
            <div className="k-stat__sub">10 projects</div>
          </div>
          <div className="k-stat k-stat--warn">
            <div className="k-stat__lbl">OVERDUE</div>
            <div className="k-stat__val">35</div>
            <div className="k-stat__sub">needs review</div>
          </div>
          <div className="k-stat k-stat--ok">
            <div className="k-stat__lbl">DONE</div>
            <div className="k-stat__val">7</div>
            <div className="k-stat__sub">this week</div>
          </div>
          <div className="k-stat k-stat--neutral">
            <div className="k-stat__lbl">TODAY</div>
            <div className="k-stat__val">3</div>
            <div className="k-stat__sub">1 high priority</div>
          </div>
        </div>

        {/* Row 2 — cards + panel */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <section className="k-card" style={{ padding: 14 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Dashboard card</div>
            <div style={{ fontSize: 12, color: 'var(--on-surface-2)' }}>
              Report panels, data cards, KPI sections
            </div>
          </section>
          <section className="gn-panel" style={{ padding: 14 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Finance panel</div>
            <div style={{ fontSize: 12, color: 'var(--on-surface-2)' }}>
              Ganit, receivables, invoices
            </div>
          </section>
          <section className="niyam-card" style={{ padding: 14 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Rule card</div>
            <div style={{ fontSize: 12, color: 'var(--on-surface-2)' }}>
              Niyam automation rules
            </div>
          </section>
        </div>

        {/* Row 3 — mini table, toast, popover mock */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
          <div className="k-card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="tbl" style={{ width: '100%', fontSize: 12 }}>
              <thead><tr>
                <th style={{ padding: '8px 12px', textAlign: 'left' }}>Task</th>
                <th style={{ padding: '8px 12px', textAlign: 'left' }}>Status</th>
                <th style={{ padding: '8px 12px', textAlign: 'right' }}>Due</th>
              </tr></thead>
              <tbody>
                <tr><td style={{ padding: '6px 12px' }}>Design review</td><td style={{ padding: '6px 12px' }}>In progress</td><td style={{ padding: '6px 12px', textAlign: 'right' }}>Today</td></tr>
                <tr><td style={{ padding: '6px 12px' }}>API integration</td><td style={{ padding: '6px 12px' }}>Pending</td><td style={{ padding: '6px 12px', textAlign: 'right' }}>Tomorrow</td></tr>
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="tst" style={{ padding: '10px 14px', borderRadius: 'var(--r-lg, 12px)', fontSize: 12 }}>
              <span style={{ fontWeight: 600 }}>Toast notification</span>
              <div style={{ color: 'var(--on-surface-2)', marginTop: 2 }}>Task marked complete</div>
            </div>
            <div className="k-quickacts" style={{ padding: '10px 14px', borderRadius: 'var(--r-lg, 12px)', fontSize: 12 }}>
              <span style={{ fontWeight: 600 }}>Quick actions</span>
              <div style={{ color: 'var(--on-surface-2)', marginTop: 2 }}>Add task, invoice, client</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
