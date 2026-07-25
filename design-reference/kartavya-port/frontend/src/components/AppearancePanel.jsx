// frontend/src/components/AppearancePanel.jsx
// Kartavya by Aekam Inc — always-visible "Customize" panel.
//
// Floats bottom-right. Lets any user flip theme/accent/density/font/language
// live; persists via AppearanceContext. Doesn't depend on any host tooling —
// it's part of the shipped product. Mount once inside <AppShell>, after
// <Outlet />.

import React, { useState } from 'react';
import { useAppearance } from '../context/AppearanceContext';
import { X } from 'lucide-react';

const ACCENT_SWATCHES = {
  teal:    'linear-gradient(135deg,#0082c6,#05b7aa)',
  blue:    'linear-gradient(135deg,#0a3d91,#1d6fcf)',
  saffron: 'linear-gradient(135deg,#9a3412,#f59e0b)',
  indigo:  'linear-gradient(135deg,#3730a3,#818cf8)',
};

export default function AppearancePanel() {
  const a = useAppearance();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(v => !v)}
        className={'ap-launch' + (open ? ' is-open' : '')}
        aria-label="Customize appearance"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M2.5 5h6M11 5h2.5M2.5 11h2.5M7.5 11h6" />
          <circle cx="9.5" cy="5" r="1.8" fill="currentColor" stroke="none" />
          <circle cx="6" cy="11" r="1.8" fill="currentColor" stroke="none" />
        </svg>
        <span>Customize</span>
        <span className="ap-launch__hi">सजावट</span>
      </button>

      {open && (
        <div className="ap-panel" role="dialog">
          <div className="ap-panel__head">
            <div>
              <div className="ap-panel__kicker">Customize · सजावट</div>
              <h3>Make it yours</h3>
            </div>
            <button className="ap-x" onClick={() => setOpen(false)} aria-label="Close">
              <X size={14} />
            </button>
          </div>

          <div className="ap-panel__body">
            <Section label="Theme" sans="रंग">
              <Row label="Mode">
                <Seg
                  value={a.theme}
                  options={[
                    { v: 'light', label: '☀ Light' },
                    { v: 'dark',  label: '☾ Dark'  },
                  ]}
                  onChange={(v) => a.set('theme', v)}
                />
              </Row>
              <Row label="Accent">
                <div className="ap-accent">
                  {Object.entries(ACCENT_SWATCHES).map(([key, bg]) => (
                    <button
                      key={key}
                      className={'ap-accent__chip' + (a.accent === key ? ' is-active' : '')}
                      style={{ background: bg }}
                      onClick={() => a.set('accent', key)}
                      title={key}
                    >
                      <span>{key}</span>
                    </button>
                  ))}
                </div>
              </Row>
            </Section>

            <Section label="Layout" sans="विन्यास">
              <Row label="Density">
                <Seg
                  value={a.density}
                  options={[
                    { v: 'compact', label: 'Compact' },
                    { v: 'comfy',   label: 'Comfy'   },
                  ]}
                  onChange={(v) => a.set('density', v)}
                />
              </Row>
            </Section>

            <Section label="Type & language" sans="भाषा">
              <Row label="Display">
                <select
                  className="ap-select"
                  value={a.font}
                  onChange={(e) => a.set('font', e.target.value)}
                >
                  <option value="newsreader">Newsreader · editorial</option>
                  <option value="spectral">Spectral · literary</option>
                  <option value="geist">Instrument Serif · modern</option>
                  <option value="inter">Inter · sans only</option>
                </select>
              </Row>
              <Row label="Language">
                <Seg
                  value={a.lang}
                  options={[
                    { v: 'en',  label: 'EN' },
                    { v: 'mix', label: 'EN + सं' },
                    { v: 'hi',  label: 'हिन्दी' },
                  ]}
                  onChange={(v) => a.set('lang', v)}
                />
              </Row>
            </Section>

            <div className="ap-hint">
              <span className="ed-hi-mute">यथारुचि — </span>
              <em>"as you wish."</em> Saved automatically.
            </div>

            <button className="ap-reset" onClick={a.reset}>Reset to defaults</button>
          </div>
        </div>
      )}

      <PanelStyles />
    </>
  );
}

function Section({ label, sans, children }) {
  return (
    <div className="ap-section">
      <div className="ap-section__head">
        <span>{label}</span>
        <span className="ap-section__sans">{sans}</span>
      </div>
      {children}
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="ap-row">
      <div className="ap-row__lbl">{label}</div>
      <div className="ap-row__val">{children}</div>
    </div>
  );
}

function Seg({ value, options, onChange }) {
  return (
    <div className="ap-seg">
      {options.map(o => (
        <button
          key={o.v}
          className={value === o.v ? 'is-active' : ''}
          onClick={() => onChange(o.v)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Scoped CSS — kept in-file so AppearancePanel is one drop-in component. */
function PanelStyles() {
  return (
    <style>{`
      .ap-launch {
        position: fixed; right: 20px; bottom: 20px;
        display: inline-flex; align-items: center; gap: 8px;
        padding: 10px 14px 10px 12px;
        background: var(--ed-surface, #FCFAF5);
        color: var(--ed-ink, #1A2230);
        border: 1px solid var(--ed-rule-strong, #C8C0AA);
        border-radius: 99px;
        font-size: 12.5px; font-weight: 600;
        font-family: 'Inter', system-ui, sans-serif;
        box-shadow: 0 8px 24px -10px rgba(8,14,26,.18), 0 1px 0 rgba(255,255,255,.4) inset;
        z-index: 90; cursor: pointer;
        transition: transform .15s, box-shadow .15s;
      }
      .dark .ap-launch { background: var(--ed-surface); border-color: var(--ed-rule-strong); box-shadow: 0 8px 24px -10px rgba(0,0,0,.6); }
      .ap-launch:hover { transform: translateY(-2px); box-shadow: 0 14px 30px -10px rgba(8,14,26,.25); }
      .ap-launch svg { color: var(--ed-primary, #05b7aa); }
      .ap-launch__hi {
        font-family: 'Tiro Devanagari Hindi', serif;
        color: var(--ed-ink-3, #6E7B91);
        font-weight: 400; font-size: 13px;
        border-left: 1px solid var(--ed-rule, #E2DCC9);
        padding-left: 8px; margin-left: 2px;
      }
      .ap-launch.is-open {
        background: var(--ed-ink); color: var(--ed-surface);
        border-color: var(--ed-ink);
      }
      .ap-launch.is-open .ap-launch__hi { color: rgba(255,255,255,.6); border-color: rgba(255,255,255,.2); }
      .ap-launch.is-open svg { color: var(--ed-primary); }

      .ap-panel {
        position: fixed; right: 20px; bottom: 76px;
        width: 320px;
        max-height: calc(100vh - 100px);
        background: var(--ed-surface, #FCFAF5);
        border: 1px solid var(--ed-rule, #E2DCC9);
        border-radius: 18px;
        box-shadow: 0 30px 80px -20px rgba(8,14,26,.32);
        z-index: 91;
        display: flex; flex-direction: column; overflow: hidden;
        font-family: 'Inter', system-ui, sans-serif;
        color: var(--ed-ink, #1A2230);
      }
      .dark .ap-panel { box-shadow: 0 30px 80px -20px rgba(0,0,0,.7); }

      .ap-panel__head {
        display: flex; align-items: flex-start; justify-content: space-between;
        padding: 16px 18px 12px;
        border-bottom: 1px solid var(--ed-rule-soft, #EFE9D8);
        background: radial-gradient(circle at 100% 0%, color-mix(in srgb, var(--ed-primary, #05b7aa) 10%, transparent), transparent 70%), var(--ed-surface);
      }
      .ap-panel__kicker { font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--ed-mid, #03a1b6); font-weight: 700; margin-bottom: 4px; }
      .ap-panel__head h3 { font-family: var(--font-display, 'Newsreader', Georgia, serif); font-size: 18px; font-weight: 500; margin: 0; color: var(--ed-ink); }

      .ap-x { background: transparent; border: 0; cursor: pointer; color: var(--ed-ink-3); width: 28px; height: 28px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; }
      .ap-x:hover { background: var(--ed-rule-soft); color: var(--ed-ink); }

      .ap-panel__body { flex: 1; overflow-y: auto; padding: 14px 18px 18px; display: flex; flex-direction: column; gap: 16px; }

      .ap-section { display: flex; flex-direction: column; gap: 8px; }
      .ap-section__head { display: flex; align-items: baseline; gap: 8px; padding-bottom: 4px; border-bottom: 1px dashed var(--ed-rule-soft); }
      .ap-section__head > span:first-child { font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; font-weight: 700; color: var(--ed-ink-3); }
      .ap-section__sans { font-family: 'Tiro Devanagari Hindi', serif; font-size: 12px; color: var(--ed-ink-faint, #A5B0C2); }

      .ap-row { display: grid; grid-template-columns: 88px 1fr; gap: 12px; align-items: center; }
      .ap-row__lbl { font-size: 12px; color: var(--ed-ink-2); font-weight: 500; }
      .ap-row__val { min-width: 0; }

      .ap-seg { display: flex; background: var(--ed-bg-soft, #F0ECDF); border: 1px solid var(--ed-rule); border-radius: 8px; padding: 2px; }
      .ap-seg button { flex: 1; background: transparent; border: 0; padding: 5px 8px; border-radius: 6px; font: inherit; font-size: 11.5px; font-weight: 600; color: var(--ed-ink-3); cursor: pointer; }
      .ap-seg button:hover { color: var(--ed-ink-2); }
      .ap-seg button.is-active { background: var(--ed-surface); color: var(--ed-ink); box-shadow: 0 1px 3px rgba(0,0,0,.08); }

      .ap-select { width: 100%; padding: 7px 10px; font-size: 12.5px; background: var(--ed-bg-soft); border: 1px solid var(--ed-rule); border-radius: 8px; color: var(--ed-ink); outline: none; font-family: inherit; }
      .ap-select:focus { border-color: color-mix(in srgb, var(--ed-primary) 60%, var(--ed-rule)); background: var(--ed-surface); }

      .ap-accent { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
      .ap-accent__chip {
        position: relative; height: 36px; border: 0; border-radius: 7px; cursor: pointer;
        display: flex; align-items: flex-end; justify-content: flex-start; padding: 4px 6px; overflow: hidden;
      }
      .ap-accent__chip span { font-size: 8.5px; letter-spacing: 0.12em; text-transform: uppercase; font-weight: 700; color: rgba(255,255,255,.95); text-shadow: 0 1px 2px rgba(0,0,0,.45); position: relative; z-index: 1; }
      .ap-accent__chip.is-active { box-shadow: 0 0 0 2px var(--ed-ink), 0 0 0 4px var(--ed-surface); }

      .ap-hint { font-family: var(--font-display); font-size: 12.5px; font-style: italic; color: var(--ed-ink-3); padding: 10px 12px; background: var(--ed-bg-soft); border-radius: 8px; border-left: 2px solid var(--ed-primary); line-height: 1.5; }
      .ap-hint em { color: var(--ed-ink-2); font-style: italic; }

      .ap-reset { background: transparent; color: var(--ed-ink-3); border: 1px solid var(--ed-rule); border-radius: 8px; padding: 7px 10px; font-size: 11.5px; font-weight: 500; cursor: pointer; }
      .ap-reset:hover { color: var(--ed-ink); border-color: var(--ed-ink-faint); }

      @media (max-width: 720px) {
        .ap-panel { right: 12px; left: 12px; width: auto; }
        .ap-launch { right: 12px; bottom: 12px; }
      }
    `}</style>
  );
}
