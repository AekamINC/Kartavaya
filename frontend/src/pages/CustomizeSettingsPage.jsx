import React from 'react';
import { PageHeader } from '../components/editorial';
import { useCustomize, ACCENTS, FONTS, DEFAULTS, Seg, SectionHead, Row, deriveAccentColors } from '../components/CustomizePanel';

const SELECT_STYLE = {
  width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 13,
  border: '1px solid var(--rule)', background: 'var(--surface)',
  color: 'var(--ink)', fontFamily: 'var(--font-ui)', cursor: 'pointer',
  appearance: 'none',
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236E7B91' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center',
};

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
      <PageHeader title="Customize · सजावट" subtitle="Appearance — Theme, Typography, Layout & Language" />

      {/* ── Theme ──────────────────────────────────── */}
      <section style={{ marginBottom: 32 }}>
        <SectionHead en="THEME" hi="रंग" />

        <Row label="Mode">
          <Seg value={prefs.mode} onChange={v => setPrefs({ mode: v })}
            options={[{ label: '☀ Light', value: 'light' }, { label: '◗ Dark', value: 'dark' }]} />
        </Row>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: 8 }}>Accent color</div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <input type="color" value={activeColor} onChange={e => handleColorPicker(e.target.value)}
              style={{ width: 44, height: 36, border: '1px solid var(--rule)', borderRadius: 8, cursor: 'pointer', padding: 2, background: 'var(--surface)' }} />
            <code style={{ fontSize: 13, color: 'var(--ink-2)', fontFamily: 'var(--font-mono, monospace)', background: 'var(--bg-soft)', padding: '4px 10px', borderRadius: 6 }}>
              {activeColor}
            </code>
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            {ACCENTS.map(a => {
              const isActive = !prefs.customAccent && prefs.accent === a.id;
              return (
                <button key={a.id} onClick={() => handlePresetClick(a)} title={a.label} style={{
                  flex: 1, height: 32, borderRadius: 8, cursor: 'pointer',
                  background: a.color,
                  border: isActive ? '2px solid var(--ink)' : '2px solid transparent',
                  outline: isActive ? `2px solid ${a.color}` : 'none',
                  outlineOffset: 1,
                  display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 3,
                  transition: 'border .12s, outline .12s',
                }}>
                  <span style={{ fontSize: 7, fontWeight: 800, letterSpacing: '0.06em', color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,.4)' }}>{a.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <div style={{ height: 1, background: 'var(--rule-soft)', marginBottom: 24 }} />

      {/* ── Typography ─────────────────────────────── */}
      <section style={{ marginBottom: 32 }}>
        <SectionHead en="TYPOGRAPHY" hi="अक्षर" />

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: 6 }}>Display font</div>
          <select value={prefs.font} onChange={e => setPrefs({ font: e.target.value })} style={SELECT_STYLE}>
            {FONTS.map(f => <option key={f.id} value={f.id}>{f.label} · {f.sub}</option>)}
          </select>
        </div>

        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>Font size</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', fontFamily: 'var(--font-mono, monospace)' }}>{prefs.fontSize || 14}px</span>
          </div>
          <input type="range" min={12} max={20} step={1} value={prefs.fontSize || 14}
            onChange={e => setPrefs({ fontSize: parseInt(e.target.value) })}
            style={{ width: '100%', accentColor: 'var(--k-primary)', cursor: 'pointer' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--ink-3)', marginTop: 2 }}>
            <span>12px</span><span>16px</span><span>20px</span>
          </div>
        </div>

        <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, background: 'var(--bg-soft)', border: '1px solid var(--rule-soft)' }}>
          <div style={{ fontSize: 'var(--font-size-base, 14px)', color: 'var(--ink)', lineHeight: 1.5 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}>Preview text</span>
            {' — The quick brown fox jumps over the lazy dog.'}
          </div>
        </div>
      </section>

      <div style={{ height: 1, background: 'var(--rule-soft)', marginBottom: 24 }} />

      {/* ── Layout ─────────────────────────────────── */}
      <section style={{ marginBottom: 32 }}>
        <SectionHead en="LAYOUT" hi="विन्यास" />

        <Row label="Sidebar">
          <Seg value={prefs.sidebar} onChange={v => setPrefs({ sidebar: v })}
            options={[{ label: 'Wide', value: 'wide' }, { label: 'Rail', value: 'rail' }]} />
        </Row>

        <Row label="Density">
          <Seg value={prefs.density} onChange={v => setPrefs({ density: v })}
            options={[{ label: 'Compact', value: 'compact' }, { label: 'Comfy', value: 'comfy' }]} />
        </Row>
      </section>

      <div style={{ height: 1, background: 'var(--rule-soft)', marginBottom: 24 }} />

      {/* ── Language ───────────────────────────────── */}
      <section style={{ marginBottom: 32 }}>
        <SectionHead en="LANGUAGE" hi="भाषा" />

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
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
                padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                fontSize: 13, fontFamily: 'var(--font-ui)',
                fontWeight: active ? 600 : 400,
                background: active ? 'var(--surface-2)' : 'var(--bg-soft)',
                color: active ? 'var(--ink)' : 'var(--ink-3)',
                boxShadow: active ? '0 1px 3px rgba(0,0,0,.08)' : 'none',
                outline: active ? '2px solid var(--k-primary)' : 'none',
                transition: 'all .12s',
              }}>
                {o.label}
              </button>
            );
          })}
        </div>
      </section>

      <div style={{ height: 1, background: 'var(--rule-soft)', marginBottom: 24 }} />

      {/* ── Reset ──────────────────────────────────── */}
      <button onClick={resetAll} style={{
        padding: '8px 20px', fontSize: 13, fontWeight: 500,
        background: 'transparent', color: '#ef4444',
        border: '1px solid #ef444444', borderRadius: 8, cursor: 'pointer',
      }}>
        Reset to defaults
      </button>

      <div style={{
        marginTop: 20, padding: '10px 14px', borderRadius: 10,
        border: `1px solid ${activeColor}44`, borderLeftWidth: 3,
        background: `${activeColor}0d`, fontSize: 12, lineHeight: 1.6, color: 'var(--ink-3)',
      }}>
        <span style={{ fontFamily: 'var(--font-hindi)', color: 'var(--ink-2)' }}>यथारुचि</span>
        {' — '}
        <em style={{ color: 'var(--k-primary)', fontFamily: 'var(--font-display)' }}>"as you wish."</em>
        {' Your choices persist as you click around.'}
      </div>
    </div>
  );
}
