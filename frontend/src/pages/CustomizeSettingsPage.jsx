import React from 'react';
import { PageHeader } from '../components/editorial';
import { Section } from '../components/editorial';
import { useCustomize, ACCENTS, FONTS, DEFAULTS, Seg, deriveAccentColors } from '../components/CustomizePanel';

export default function CustomizeSettingsPage() {
  const { prefs, setPrefs } = useCustomize();

  const activeColor = prefs.customAccent || (ACCENTS.find(a => a.id === prefs.accent) || ACCENTS[0]).color;

  const handleColorPicker = (hex) => {
    const match = ACCENTS.find(a => a.color.toLowerCase() === hex.toLowerCase());
    if (match) {
      setPrefs({ accent: match.id, customAccent: null });
    } else {
      setPrefs({ customAccent: hex });
    }
  };

  const handlePresetClick = (a) => {
    setPrefs({ accent: a.id, customAccent: null });
  };

  const resetAll = () => {
    setPrefs({ ...DEFAULTS });
  };

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '0 24px 48px' }}>
      <PageHeader title="Customize" sanskrit="सजावट" lede="Appearance — Theme, Typography, Layout & Language" />

      {/* ── Theme ──────────────────────────────────── */}
      <Section title="Theme" hi="रंग">
        <div className="k-formpanel" style={{ marginBottom: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <label className="k-formpanel__label" style={{ marginBottom: 0 }}>Mode</label>
            <Seg value={prefs.mode} onChange={v => setPrefs({ mode: v })}
              options={[{ label: '☀ Light', value: 'light' }, { label: '◗ Dark', value: 'dark' }]} />
          </div>

          <div>
            <label className="k-formpanel__label" style={{ marginBottom: 8 }}>Accent color</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <input type="color" value={activeColor} onChange={e => handleColorPicker(e.target.value)}
                style={{ width: 44, height: 36, border: '1px solid var(--rule)', borderRadius: 8, cursor: 'pointer', padding: 2, background: 'var(--surface)' }} />
              <code style={{ fontSize: 13, color: 'var(--ink-2)', fontFamily: 'var(--font-mono)', background: 'var(--bg-soft, var(--bg))', padding: '4px 10px', borderRadius: 6 }}>
                {activeColor}
              </code>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: 6 }}>
              {ACCENTS.map(a => {
                const isActive = !prefs.customAccent && prefs.accent === a.id;
                return (
                  <button key={a.id} onClick={() => handlePresetClick(a)} title={a.label} style={{
                    height: 36, borderRadius: 8, cursor: 'pointer',
                    background: a.color,
                    border: isActive ? '2px solid var(--ink)' : '2px solid transparent',
                    outline: isActive ? `2px solid ${a.color}` : 'none',
                    outlineOffset: 1,
                    display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 4,
                    transition: 'border .12s, outline .12s',
                  }}>
                    <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.06em', color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,.4)' }}>{a.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </Section>

      {/* ── Typography ─────────────────────────────── */}
      <Section title="Typography" hi="अक्षर">
        <div className="k-formpanel" style={{ marginBottom: 0 }}>
          <label className="k-formpanel__label" style={{ marginBottom: 16 }}>Display font
            <select value={prefs.font} onChange={e => setPrefs({ font: e.target.value })} className="k-formpanel__input">
              {FONTS.map(f => <option key={f.id} value={f.id}>{f.label} · {f.sub}</option>)}
            </select>
          </label>

          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label className="k-formpanel__label" style={{ marginBottom: 0 }}>Font size</label>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', fontFamily: 'var(--font-mono)' }}>{prefs.fontSize || 14}px</span>
            </div>
            <input type="range" min={12} max={20} step={1} value={prefs.fontSize || 14}
              onChange={e => setPrefs({ fontSize: parseInt(e.target.value) })}
              style={{ width: '100%', accentColor: 'var(--k-primary)', cursor: 'pointer' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--ink-3)', marginTop: 2 }}>
              <span>12px</span><span>16px</span><span>20px</span>
            </div>
          </div>

          <div style={{ padding: '12px 16px', borderRadius: 8, background: 'color-mix(in srgb, var(--k-primary) 4%, transparent)', border: '1px solid var(--rule-soft)' }}>
            <div style={{ fontSize: 'var(--font-size-base, 14px)', color: 'var(--ink)', lineHeight: 1.5 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}>Preview text</span>
              {' — The quick brown fox jumps over the lazy dog.'}
            </div>
          </div>
        </div>
      </Section>

      {/* ── Layout ─────────────────────────────────── */}
      <Section title="Layout" hi="विन्यास">
        <div className="k-formpanel" style={{ marginBottom: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <label className="k-formpanel__label" style={{ marginBottom: 0 }}>Sidebar</label>
            <Seg value={prefs.sidebar} onChange={v => setPrefs({ sidebar: v })}
              options={[{ label: 'Wide', value: 'wide' }, { label: 'Rail', value: 'rail' }]} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label className="k-formpanel__label" style={{ marginBottom: 0 }}>Density</label>
            <Seg value={prefs.density} onChange={v => setPrefs({ density: v })}
              options={[{ label: 'Compact', value: 'compact' }, { label: 'Comfy', value: 'comfy' }]} />
          </div>
        </div>
      </Section>

      {/* ── Language ───────────────────────────────── */}
      <Section title="Language" hi="भाषा">
        <div className="k-formpanel" style={{ marginBottom: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
            {[
              { label: 'EN',       value: 'en' },
              { label: 'EN + सं',  value: 'en+sa' },
              { label: 'EN + हि',  value: 'en+hi' },
              { label: 'EN + ગુ',  value: 'en+gu' },
              { label: 'हिन्दी',   value: 'hi' },
              { label: 'ગુજરાતી', value: 'gu' },
            ].map(o => {
              const active = prefs.language === o.value;
              return (
                <button key={o.value} onClick={() => setPrefs({ language: o.value })} style={{
                  padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
                  fontSize: 13, fontFamily: 'var(--font-ui)',
                  fontWeight: active ? 600 : 400,
                  background: active ? 'color-mix(in srgb, var(--k-primary) 8%, transparent)' : 'var(--bg)',
                  color: active ? 'var(--ink)' : 'var(--ink-3)',
                  border: active ? '2px solid var(--k-primary)' : '1px solid var(--rule)',
                  transition: 'all .12s',
                }}>
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
      </Section>

      {/* ── Reset ──────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8 }}>
        <button onClick={resetAll} style={{
          padding: '8px 20px', fontSize: 13, fontWeight: 500,
          background: 'transparent', color: '#ef4444',
          border: '1px solid color-mix(in srgb, #ef4444 30%, transparent)', borderRadius: 8, cursor: 'pointer',
          transition: 'background .15s',
        }}>
          Reset to defaults
        </button>

        <div style={{
          padding: '8px 14px', borderRadius: 8,
          fontSize: 12, color: 'var(--ink-3)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ fontFamily: 'var(--font-hindi)', color: 'var(--ink-2)' }}>यथारुचि</span>
          <em style={{ color: 'var(--k-primary)', fontFamily: 'var(--font-display)' }}>"as you wish."</em>
        </div>
      </div>
    </div>
  );
}
