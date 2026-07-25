// iOS Login + Settings screens for Kartavya mobile companion.
// Mirrors the real LoginScreen.js (invite-only, email/password)
// and adds a Settings screen with permissions, sync, reset, and sign out.

// ── LOGIN ─────────────────────────────────────────────────────────────
function IOSLogin({ dark }) {
  const t = iosTokens(dark);
  return (
    <IOSDevice dark={dark} width={360} height={760}>
      <div style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        background: dark
          ? 'radial-gradient(120% 80% at 50% -10%, rgba(0,130,198,0.18), transparent 60%), #050E1A'
          : 'radial-gradient(120% 80% at 50% -10%, rgba(0,130,198,0.10), transparent 60%), #F2F2F7',
        position: 'relative',
      }}>
        {/* Decorative blurred orb */}
        <div style={{
          position: 'absolute', top: 80, right: -60,
          width: 220, height: 220, borderRadius: '50%',
          background: `radial-gradient(circle, ${KP.primary}55, transparent 65%)`,
          filter: 'blur(8px)', pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', bottom: 120, left: -50,
          width: 200, height: 200, borderRadius: '50%',
          background: `radial-gradient(circle, ${KP.deep}55, transparent 65%)`,
          filter: 'blur(10px)', pointerEvents: 'none',
        }} />

        <div style={{ height: 70 }} />

        {/* Logo */}
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
          padding: '0 24px 28px',
        }}>
          <div style={{
            width: 84, height: 84, borderRadius: 22,
            background: KP.gradD,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 16px 30px -10px rgba(0,130,198,0.45)',
            position: 'relative',
            overflow: 'hidden',
          }}>
            <span style={{
              fontFamily: '"Newsreader", Georgia, serif',
              fontSize: 48, color: '#fff', fontWeight: 500,
              fontFamily: '"Tiro Devanagari Hindi", "Newsreader", serif',
              lineHeight: 1, marginTop: 4,
            }}>क</span>
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(180deg, rgba(255,255,255,0.18), transparent 50%)',
              pointerEvents: 'none',
            }} />
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              fontFamily: '"Newsreader", Georgia, serif',
              fontSize: 36, fontWeight: 500,
              color: dark ? '#fff' : '#1A2230',
              letterSpacing: -0.5, lineHeight: 1,
            }}>Kartavya</div>
            <div style={{
              fontFamily: '"Tiro Devanagari Hindi", serif',
              fontSize: 18, color: KP.primary, marginTop: 4,
            }}>कर्तव्य</div>
            <div style={{
              fontSize: 11, color: dark ? 'rgba(255,255,255,0.5)' : t.text3,
              letterSpacing: 2.4, textTransform: 'uppercase', fontWeight: 600,
              marginTop: 10,
            }}>by Aekam Inc</div>
            <div style={{
              fontFamily: '"Newsreader", Georgia, serif',
              fontStyle: 'italic',
              fontSize: 15, color: dark ? 'rgba(255,255,255,0.7)' : t.text2,
              marginTop: 14,
            }}>Do what must be done.</div>
          </div>
        </div>

        {/* Form card */}
        <div style={{ padding: '0 20px', flex: 1 }}>
          <div style={{
            background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.7)',
            backdropFilter: 'blur(20px) saturate(180%)',
            WebkitBackdropFilter: 'blur(20px) saturate(180%)',
            border: dark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(255,255,255,0.9)',
            borderRadius: 22, padding: '20px 18px',
            boxShadow: dark
              ? '0 20px 40px rgba(0,0,0,0.4)'
              : '0 20px 40px rgba(20,30,50,0.08)',
          }}>
            <IOSLoginField t={t} dark={dark} label="Email" value="keval@aekaminc.com" type="email" />
            <div style={{ height: 12 }} />
            <IOSLoginField t={t} dark={dark} label="Password" value="•••••••••" type="password" />
            <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '10px 0 4px' }}>
              <span style={{ fontSize: 13, color: KP.deep, fontWeight: 500 }}>Forgot password?</span>
            </div>
            <button style={{
              marginTop: 14, width: '100%', height: 48, borderRadius: 14,
              border: 0, background: KP.grad, color: '#fff',
              fontSize: 16, fontWeight: 600, letterSpacing: 0.2,
              boxShadow: '0 8px 18px -6px rgba(0,130,198,0.55)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              Sign in
              <ISFIcon name="chevron-right" size={16} color="#fff" weight="bold" />
            </button>
            <div style={{
              marginTop: 16, padding: 12, borderRadius: 12,
              background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,130,198,0.06)',
              display: 'flex', alignItems: 'flex-start', gap: 8,
            }}>
              <ISFIcon name="sparkles" size={14} color={KP.deep} weight="medium" />
              <span style={{ fontSize: 12, color: dark ? 'rgba(255,255,255,0.7)' : t.text2, lineHeight: 1.45 }}>
                <b style={{ color: dark ? '#fff' : t.text }}>Invite-only access.</b> Contact your admin to be added.
              </span>
            </div>
          </div>
        </div>
        <div style={{
          textAlign: 'center', padding: '24px 0 40px',
          fontSize: 10, color: dark ? 'rgba(255,255,255,0.3)' : t.text4,
          letterSpacing: 2, textTransform: 'uppercase', fontWeight: 600,
        }}>Powered by Aekam Inc</div>
      </div>
    </IOSDevice>
  );
}
function IOSLoginField({ t, dark, label, value, type }) {
  return (
    <div>
      <div style={{
        fontSize: 11, color: dark ? 'rgba(255,255,255,0.55)' : t.text3, fontWeight: 700,
        letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 6,
      }}>{label}</div>
      <div style={{
        height: 44, borderRadius: 12,
        background: dark ? 'rgba(255,255,255,0.06)' : '#fff',
        border: dark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(60,60,67,0.16)',
        padding: '0 14px',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{
          flex: 1, fontSize: 15, color: dark ? '#fff' : t.text,
          letterSpacing: -0.2, fontFamily: type === 'password' ? 'ui-monospace, monospace' : 'system-ui',
        }}>{value}</span>
        {type === 'password' && <span style={{ fontSize: 12, color: t.text3, fontWeight: 500 }}>Show</span>}
      </div>
    </div>
  );
}

// ── SETTINGS ───────────────────────────────────────────────────────────
function IOSSettings({ dark }) {
  const t = iosTokens(dark);
  const me = M_USER('u1');
  return (
    <IOSDevice dark={dark} width={360} height={760}>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: t.bg, position: 'relative' }}>
        <IOSTopHeader
          kicker="Settings"
          kickerHi="विकल्प"
          title="You & your app"
          dark={dark} t={t}
        />

        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0 110px' }}>
          {/* Account */}
          <div style={{ padding: '0 16px 18px' }}>
            <div style={{
              background: t.surface, borderRadius: 22,
              padding: '14px 16px',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <IAvatar u={me} size={48} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: t.text }}>{me.name} Shah</div>
                <div style={{ fontSize: 12.5, color: t.text3, marginTop: 2 }}>keval@aekaminc.com</div>
              </div>
              <span style={{
                fontSize: 10, fontWeight: 700, color: KP.deep,
                background: 'rgba(0,130,198,0.14)',
                padding: '3px 8px', borderRadius: 99,
                letterSpacing: 1.2, textTransform: 'uppercase',
              }}>Owner</span>
            </div>
          </div>

          {/* Notifications — per-kind toggles */}
          <IOSSettingsSection t={t} label="Notifications" hi="सूचनाएँ">
            {M_NOTIF_KINDS.map((k, i) => {
              const tone = M_NOTIF_TONE_STYLES[k.tone];
              const isLast = i === M_NOTIF_KINDS.length - 1;
              const pushMode = k.push === 'always' ? 'Push · email'
                : k.push === 'mine_only' ? 'Push (mine)'
                : k.push === 'project' ? 'Push (project)'
                : 'In-app only';
              const isOn = k.push !== 'off';
              return (
                <div key={k.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  minHeight: 56, padding: '10px 16px',
                  borderBottom: isLast ? 0 : `0.5px solid ${t.sep}`,
                }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 7,
                    background: tone.bg,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <ISFIcon name={tone.iconName} size={14} color={tone.fg} weight="bold" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <span style={{ fontSize: 14, color: t.text, fontWeight: 500, letterSpacing: -0.1 }}>{k.label}</span>
                      <span style={{ fontFamily: '"Tiro Devanagari Hindi", serif', fontSize: 11, color: t.text4 }}>{k.hi}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: t.text3, marginTop: 2, lineHeight: 1.35 }}>{pushMode}</div>
                  </div>
                  {/* iOS-style switch */}
                  <div style={{
                    width: 51, height: 31, borderRadius: 99,
                    background: isOn ? '#34C759' : (dark ? '#39393D' : '#E5E5EA'),
                    padding: 2, transition: 'background 0.2s',
                  }}>
                    <div style={{
                      width: 27, height: 27, borderRadius: 99, background: '#fff',
                      transform: isOn ? 'translateX(20px)' : 'translateX(0)',
                      transition: 'transform 0.2s',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.2), 0 0 0 0.5px rgba(0,0,0,0.04)',
                    }} />
                  </div>
                </div>
              );
            })}
          </IOSSettingsSection>
          <div style={{
            padding: '6px 36px 14px', fontSize: 12, color: t.text3, lineHeight: 1.45,
          }}>Mentions and approvals are urgent — they always push. Others can be in-app only or scoped to your own work.</div>

          {/* Permissions */}
          <IOSSettingsSection t={t} label="Permissions" hi="अनुमतियाँ">
            <IOSSettingsRow t={t} icon="bell"      label="Notifications"     value="Granted" valueColor={KP.primary} sep />
            <IOSSettingsRow t={t} icon="camera"    label="Camera"            value="Granted" valueColor={KP.primary} sep />
            <IOSSettingsRow t={t} icon="mic"       label="Microphone"        value="Ask each time" valueColor="#B06A00" sep />
            <IOSSettingsRow t={t} icon="doc"       label="Photos & files"    value="All photos" valueColor={KP.primary} />
          </IOSSettingsSection>
          <div style={{
            padding: '6px 36px 14px', fontSize: 12, color: t.text3, lineHeight: 1.45,
          }}>Tap any row to open iOS Settings. Approval pushes need <b style={{ color: t.text }}>Notifications</b>.</div>

          {/* Sync & data */}
          <IOSSettingsSection t={t} label="Sync & data" hi="संग्रह">
            <IOSSettingsRow t={t} icon="sync" label="Sync status" value="3 queued" valueColor="#B06A00" sep />
            <IOSSettingsRow t={t} icon="wifi-slash" label="Last synced" value="2 min ago" sep />
            <div style={{ padding: '4px 16px 10px' }}>
              <button style={{
                width: '100%', height: 40, borderRadius: 12,
                border: 0, background: KP.gradD, color: '#fff',
                fontSize: 14, fontWeight: 600, letterSpacing: -0.1,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}>
                <ISFIcon name="sync" size={15} color="#fff" weight="bold" />
                Sync now
              </button>
            </div>
            <IOSSettingsRow t={t} icon="ellipsis" label="Reset app data" value="" destructive />
          </IOSSettingsSection>
          <div style={{
            padding: '6px 36px 14px', fontSize: 12, color: t.text3, lineHeight: 1.45,
          }}>Reset clears the local cache only — your tasks, comments, and files stay safe on the server.</div>

          {/* Preferences */}
          <IOSSettingsSection t={t} label="Preferences" hi="मनपसंद">
            <IOSSettingsRow t={t} icon="sparkles" label="Theme" value="System" sep />
            <IOSSettingsRow t={t} icon="square-stack" label="Default view" value="Board" sep />
            <IOSSettingsRow t={t} icon="square-stack" label="Language" value="English · हिन्दी" />
          </IOSSettingsSection>

          {/* About */}
          <IOSSettingsSection t={t} label="About" hi="सूचना">
            <IOSSettingsRow t={t} icon="square-stack" label="Version" value="2.0.1 · 487" sep />
            <IOSSettingsRow t={t} icon="square-stack" label="Privacy policy" value="" sep />
            <IOSSettingsRow t={t} icon="square-stack" label="Terms of service" value="" />
          </IOSSettingsSection>

          {/* Sign out */}
          <div style={{ padding: '8px 16px 20px' }}>
            <button style={{
              width: '100%', height: 48, borderRadius: 14,
              border: 0, background: dark ? 'rgba(255,69,58,0.18)' : 'rgba(255,69,58,0.10)',
              color: '#FF453A', fontSize: 16, fontWeight: 600, letterSpacing: -0.1,
            }}>Sign out</button>
            <div style={{
              textAlign: 'center', marginTop: 14, fontSize: 10, color: t.text4,
              letterSpacing: 2, textTransform: 'uppercase', fontWeight: 600,
            }}>Kartavya · by Aekam Inc</div>
          </div>
        </div>

        <IOSTabBar active="me" t={t} dark={dark} />
      </div>
    </IOSDevice>
  );
}
function IOSSettingsSection({ label, hi, children, t }) {
  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 8,
        padding: '4px 36px 8px',
      }}>
        <span style={{
          fontSize: 11, color: t.text3, fontWeight: 700,
          letterSpacing: 1.4, textTransform: 'uppercase',
        }}>{label}</span>
        <span style={{
          fontFamily: '"Tiro Devanagari Hindi", serif',
          fontSize: 12, color: t.text4,
        }}>{hi}</span>
      </div>
      <div style={{ padding: '0 16px 8px' }}>
        <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden' }}>
          {children}
        </div>
      </div>
    </>
  );
}
function IOSSettingsRow({ icon, label, value, valueColor, destructive, sep, t }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      minHeight: 44, padding: '10px 16px',
      borderBottom: sep ? `0.5px solid ${t.sep}` : 0,
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: 7,
        background: destructive ? 'rgba(255,69,58,0.14)' : t.fill,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <ISFIcon name={icon} size={16} color={destructive ? '#FF453A' : t.text2} weight="medium" />
      </div>
      <span style={{
        flex: 1, fontSize: 14.5,
        color: destructive ? '#FF453A' : t.text, fontWeight: destructive ? 600 : 500,
        letterSpacing: -0.2,
      }}>{label}</span>
      {value && <span style={{ fontSize: 13.5, color: valueColor || t.text3, fontWeight: 500 }}>{value}</span>}
      {!destructive && <ISFIcon name="chevron-right" size={13} color={t.text4} weight="medium" />}
    </div>
  );
}

Object.assign(window, { IOSLogin, IOSSettings });
