// App icon showcase for Kartavya mobile.
// Primary mark: Devanagari "क" (ka — first letter of कर्तव्य / Kartavya)
// over the brand teal→blue gradient with a soft inner shine.

// ── Icon primitive (canvas-rendered for crispness at any size) ────────
function KIcon({ size = 180, radius = 22, variant = 'gradient', mark = 'devanagari' }) {
  const bg = {
    gradient:   'linear-gradient(135deg, #0082c6 0%, #03a1b6 50%, #05b7aa 100%)',
    dark:       'linear-gradient(135deg, #001a2e 0%, #002d4d 50%, #003d3a 100%)',
    monochrome: 'linear-gradient(135deg, #1A2230, #4A5468)',
    light:      'linear-gradient(135deg, #ECECF1, #C6C6CB)',
  }[variant];
  const fg = variant === 'light' ? '#0082c6' : '#fff';
  const ratio = size / 180;
  return (
    <div style={{
      width: size, height: size, borderRadius: radius * ratio,
      background: bg,
      position: 'relative', overflow: 'hidden',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: variant === 'light'
        ? '0 4px 14px rgba(20,30,50,0.12)'
        : '0 10px 22px -8px rgba(0,40,80,0.45)',
      flexShrink: 0,
    }}>
      {/* Inner shine top */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(180deg, rgba(255,255,255,0.18) 0%, transparent 35%)',
        pointerEvents: 'none',
      }} />
      {/* Subtle accent orb */}
      <div style={{
        position: 'absolute',
        left: -size * 0.15, bottom: -size * 0.18,
        width: size * 0.55, height: size * 0.55, borderRadius: '50%',
        background: variant === 'light'
          ? 'radial-gradient(circle, rgba(0,130,198,0.18), transparent 65%)'
          : 'radial-gradient(circle, rgba(255,255,255,0.18), transparent 65%)',
        filter: 'blur(2px)',
      }} />
      {/* Mark */}
      {mark === 'devanagari' && (
        <span style={{
          fontFamily: '"Tiro Devanagari Hindi", "Noto Serif Devanagari", serif',
          fontSize: size * 0.62, color: fg, fontWeight: 400,
          lineHeight: 1, marginTop: size * 0.04,
          textShadow: variant === 'light' ? 'none' : '0 2px 8px rgba(0,0,0,0.18)',
          position: 'relative', zIndex: 1,
        }}>क</span>
      )}
      {mark === 'latin' && (
        <span style={{
          fontFamily: '"Newsreader", Georgia, serif',
          fontSize: size * 0.62, color: fg, fontWeight: 500,
          fontStyle: 'italic',
          lineHeight: 1, marginTop: size * 0.02,
          textShadow: variant === 'light' ? 'none' : '0 2px 8px rgba(0,0,0,0.18)',
          position: 'relative', zIndex: 1, letterSpacing: -0.02,
        }}>K</span>
      )}
      {mark === 'diamond' && (
        <span style={{
          fontSize: size * 0.36, color: fg, fontWeight: 700,
          textShadow: variant === 'light' ? 'none' : '0 2px 8px rgba(0,0,0,0.18)',
          position: 'relative', zIndex: 1,
        }}>◆</span>
      )}
    </div>
  );
}

// ── Main app icon showcase ────────────────────────────────────────────
function AppIconShowcase() {
  return (
    <div style={{
      width: '100%', height: '100%', overflow: 'auto',
      background: '#F6F3EC',
      fontFamily: 'Inter, system-ui, sans-serif',
      padding: '32px 40px',
      display: 'flex', flexDirection: 'column', gap: 28,
    }}>
      <div>
        <div style={{
          fontSize: 11, color: '#0082c6', letterSpacing: 2, textTransform: 'uppercase',
          fontWeight: 700, marginBottom: 6,
        }}>App icon</div>
        <h2 style={{
          fontFamily: '"Newsreader", Georgia, serif',
          fontSize: 32, fontWeight: 500, color: '#1A2230',
          margin: 0, letterSpacing: -0.4, lineHeight: 1.1,
          display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap',
        }}>
          The serif <em style={{ color: '#0082c6', fontStyle: 'italic' }}>क</em>
          <span style={{
            fontFamily: '"Tiro Devanagari Hindi", serif',
            fontSize: 0.6 + 'em', color: '#03a1b6',
          }}>कर्तव्य का प्रथम अक्षर</span>
        </h2>
        <p style={{ fontSize: 13.5, color: '#4A5468', lineHeight: 1.55, margin: '8px 0 0', maxWidth: 640 }}>
          The first letter of <b>कर्तव्य</b> — the name itself becomes the mark. Set in Tiro Devanagari Hindi over the brand gradient, with a soft inner shine that reads at every size.
        </p>
      </div>

      {/* Hero: 1024 master + iOS/Android in context */}
      <div style={{
        display: 'grid', gridTemplateColumns: '260px 1fr', gap: 28,
        background: '#FCFAF5', border: '1px solid #E2DCC9', borderRadius: 20,
        padding: 28,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <KIcon size={220} radius={48} />
          <div style={{
            fontSize: 10.5, letterSpacing: 1.4, textTransform: 'uppercase',
            fontWeight: 700, color: '#6E7B91',
          }}>1024 × 1024 master</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 16 }}>
          <h3 style={{
            fontFamily: '"Newsreader", Georgia, serif',
            fontSize: 22, fontWeight: 500, color: '#1A2230',
            margin: 0, letterSpacing: -0.2,
          }}>Construction</h3>
          <ul style={{ margin: 0, padding: '0 0 0 18px', color: '#4A5468', fontSize: 13.5, lineHeight: 1.6 }}>
            <li>Background: 135° gradient <code style={{ background: '#F0ECDF', padding: '1px 6px', borderRadius: 4, fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>#0082c6 → #03a1b6 → #05b7aa</code></li>
            <li>Mark: Tiro Devanagari Hindi <b>क</b> in pure white, ~62% icon height</li>
            <li>Inner shine: 18% white at top, fading by 35%</li>
            <li>Bottom-left accent orb at 18% white, blurred 2px</li>
            <li>Safe area: keep mark within 80% of icon area</li>
            <li>iOS corner radius scales to 22% of icon size (matches squircle)</li>
            <li>Android adaptive: foreground 108dp inside a 108dp background; mask is up to the launcher</li>
          </ul>
        </div>
      </div>

      {/* iOS sizes */}
      <div>
        <h3 style={{
          fontFamily: '"Newsreader", Georgia, serif',
          fontSize: 22, fontWeight: 500, color: '#1A2230',
          margin: '0 0 14px', letterSpacing: -0.2,
        }}>iOS sizes & variants</h3>
        <div style={{ display: 'flex', gap: 22, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          {[
            { size: 180, radius: 40, label: '180px · iPhone' },
            { size: 120, radius: 27, label: '120px · @2x' },
            { size: 80,  radius: 18, label: '80px · Spotlight' },
            { size: 60,  radius: 14, label: '60px · Settings' },
            { size: 40,  radius: 9,  label: '40px · notif' },
          ].map(({ size, radius, label }) => (
            <div key={size} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <KIcon size={size} radius={radius} />
              <div style={{ fontSize: 10, color: '#6E7B91', letterSpacing: 0.4, fontWeight: 600 }}>{label}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 22, marginTop: 24, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <KIcon size={120} radius={27} variant="dark" />
            <div style={{ fontSize: 10, color: '#6E7B91', letterSpacing: 0.4, fontWeight: 600 }}>Dark mode</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <KIcon size={120} radius={27} variant="monochrome" />
            <div style={{ fontSize: 10, color: '#6E7B91', letterSpacing: 0.4, fontWeight: 600 }}>Monochrome</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <KIcon size={120} radius={27} variant="light" />
            <div style={{ fontSize: 10, color: '#6E7B91', letterSpacing: 0.4, fontWeight: 600 }}>Tinted (iOS 18+)</div>
          </div>
        </div>
      </div>

      {/* Android adaptive */}
      <div>
        <h3 style={{
          fontFamily: '"Newsreader", Georgia, serif',
          fontSize: 22, fontWeight: 500, color: '#1A2230',
          margin: '0 0 14px', letterSpacing: -0.2,
        }}>Android adaptive · launcher masks</h3>
        <p style={{ fontSize: 12.5, color: '#4A5468', margin: '0 0 16px', lineHeight: 1.5 }}>
          Foreground sits inside a 108dp safe area; launcher decides the mask (circle, squircle, teardrop, hexagon, etc).
        </p>
        <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
          {[
            { mask: '50%', label: 'Circle' },
            { mask: '28%', label: 'Squircle' },
            { mask: '16% 50% 16% 50%', label: 'Teardrop' },
            { mask: '20%', label: 'Rounded square' },
          ].map(({ mask, label }) => (
            <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div style={{
                width: 108, height: 108, borderRadius: mask,
                background: 'linear-gradient(135deg,#0082c6 0%,#03a1b6 50%,#05b7aa 100%)',
                position: 'relative', overflow: 'hidden',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 8px 18px -6px rgba(0,40,80,0.4)',
              }}>
                <div style={{
                  position: 'absolute', inset: 0,
                  background: 'linear-gradient(180deg, rgba(255,255,255,0.18) 0%, transparent 35%)',
                }} />
                <span style={{
                  fontFamily: '"Tiro Devanagari Hindi", serif',
                  fontSize: 66, color: '#fff', lineHeight: 1, marginTop: 4,
                  textShadow: '0 2px 8px rgba(0,0,0,0.18)',
                  position: 'relative', zIndex: 1,
                }}>क</span>
              </div>
              <div style={{ fontSize: 10, color: '#6E7B91', letterSpacing: 0.4, fontWeight: 600 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Home screen context */}
      <div>
        <h3 style={{
          fontFamily: '"Newsreader", Georgia, serif',
          fontSize: 22, fontWeight: 500, color: '#1A2230',
          margin: '0 0 14px', letterSpacing: -0.2,
        }}>On the home screen</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22 }}>
          <IconHomeScreenContext platform="iOS" />
          <IconHomeScreenContext platform="Android" />
        </div>
      </div>

      {/* Alternative marks */}
      <div>
        <h3 style={{
          fontFamily: '"Newsreader", Georgia, serif',
          fontSize: 22, fontWeight: 500, color: '#1A2230',
          margin: '0 0 14px', letterSpacing: -0.2,
        }}>Alternative marks (rejected)</h3>
        <div style={{ display: 'flex', gap: 22, alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, opacity: 0.55 }}>
            <KIcon size={120} radius={27} mark="latin" />
            <div style={{ fontSize: 10, color: '#6E7B91', letterSpacing: 0.4, fontWeight: 600 }}>Serif K — too generic</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, opacity: 0.55 }}>
            <KIcon size={120} radius={27} mark="diamond" />
            <div style={{ fontSize: 10, color: '#6E7B91', letterSpacing: 0.4, fontWeight: 600 }}>◆ — matches v1, but unbranded</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', flex: 1, justifyContent: 'flex-end' }}>
            <p style={{ fontSize: 12.5, color: '#4A5468', lineHeight: 1.5, maxWidth: 280, margin: 0, fontStyle: 'italic' }}>
              The Devanagari <b>क</b> won because nothing else in the App Store looks like it, and it speaks to the audience Kartavya was built for.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Home screen context — Kartavya icon next to common system icons
function IconHomeScreenContext({ platform }) {
  const isAndroid = platform === 'Android';
  const sysIcons = isAndroid
    ? [
        { bg: '#4285F4', glyph: 'G',  label: 'Gmail' },
        { bg: '#fff',    glyph: '🗓', label: 'Calendar', tx: '#1a73e8' },
        { bg: '#34a853', glyph: '☎',  label: 'Phone' },
        { bg: '#fbbc04', glyph: '✎',  label: 'Keep' },
      ]
    : [
        { bg: '#4cd964', glyph: '✉',  label: 'Mail' },
        { bg: '#ff3b30', glyph: '🗓', label: 'Cal' },
        { bg: '#34c759', glyph: '☎',  label: 'Phone' },
        { bg: '#5ac8fa', glyph: '✎',  label: 'Notes' },
      ];
  const radius = isAndroid ? '24%' : '22%';
  return (
    <div style={{
      borderRadius: 24, padding: 22,
      background: isAndroid
        ? 'linear-gradient(160deg, #1a1f2e 0%, #2a3349 100%)'
        : 'linear-gradient(160deg, #5a4a8a 0%, #3a4060 60%, #1a1f2e 100%)',
      position: 'relative', overflow: 'hidden',
      minHeight: 200,
    }}>
      <div style={{
        fontSize: 10, color: 'rgba(255,255,255,0.6)', fontWeight: 600,
        letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 14,
      }}>{platform} home</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        {/* Kartavya — emphasized */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, position: 'relative' }}>
          <div style={{
            position: 'absolute', top: -6, left: -6, right: -6, bottom: 22,
            borderRadius: 26, border: '2px solid rgba(255,255,255,0.5)',
          }} />
          <div style={{ position: 'relative' }}>
            <KIcon size={64} radius={isAndroid ? 18 : 14} />
          </div>
          <div style={{ fontSize: 10.5, color: '#fff', fontWeight: 500 }}>Kartavya</div>
        </div>
        {sysIcons.map((it, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div style={{
              width: 64, height: 64, borderRadius: radius,
              background: it.bg, color: it.tx || '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 30, fontWeight: 700,
              boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
            }}>{it.glyph}</div>
            <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.85)', fontWeight: 500 }}>{it.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { KIcon, AppIconShowcase });
