// Android Login + Settings screens (Material 3 Expressive).
// Mirrors the real LoginScreen.js logic plus a Settings page with
// permissions, sync, reset, and sign out.

// ── LOGIN ─────────────────────────────────────────────────────────────
function AndLogin({ dark }) {
  const t = aTokens(dark);
  return (
    <AndroidShell dark={dark}>
      <div style={{
        flex: 1, position: 'relative', overflow: 'hidden',
        background: dark
          ? 'radial-gradient(120% 80% at 50% -10%, rgba(131,213,198,0.18), transparent 60%), #0f1411'
          : 'radial-gradient(120% 80% at 50% -10%, rgba(0,130,198,0.10), transparent 60%), #F2F2F7',
      }}>
        {/* Decorative orbs */}
        <div style={{
          position: 'absolute', top: 80, right: -60,
          width: 220, height: 220, borderRadius: '50%',
          background: `radial-gradient(circle, ${KP.primary}55, transparent 65%)`,
          filter: 'blur(12px)', pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', bottom: 60, left: -50,
          width: 220, height: 220, borderRadius: '50%',
          background: `radial-gradient(circle, ${KP.deep}55, transparent 65%)`,
          filter: 'blur(14px)', pointerEvents: 'none',
        }} />

        <div style={{ height: 64 }} />

        {/* Brand */}
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
          padding: '0 24px 28px', position: 'relative', zIndex: 1,
        }}>
          <div style={{
            width: 88, height: 88, borderRadius: 28,
            background: KP.gradD,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 18px 30px -10px rgba(0,130,198,0.5)',
            overflow: 'hidden', position: 'relative',
          }}>
            <span style={{
              fontFamily: '"Tiro Devanagari Hindi", "Newsreader", serif',
              fontSize: 52, color: '#fff', fontWeight: 400,
              lineHeight: 1, marginTop: 4,
            }}>क</span>
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(180deg, rgba(255,255,255,0.18), transparent 50%)',
            }} />
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              fontFamily: '"Newsreader", Roboto, serif',
              fontSize: 36, fontWeight: 500,
              color: t.onSurface, letterSpacing: -0.4, lineHeight: 1,
            }}>Kartavya</div>
            <div style={{
              fontFamily: '"Tiro Devanagari Hindi", serif',
              fontSize: 18, color: t.primary, marginTop: 4,
            }}>कर्तव्य</div>
            <div style={{
              fontSize: 11, color: t.onSurfaceVar2,
              letterSpacing: 2.4, textTransform: 'uppercase', fontWeight: 600,
              marginTop: 10,
            }}>by Aekam Inc</div>
            <div style={{
              fontFamily: '"Newsreader", Roboto, serif',
              fontStyle: 'italic',
              fontSize: 15, color: t.onSurfaceVar,
              marginTop: 14,
            }}>Do what must be done.</div>
          </div>
        </div>

        {/* Form */}
        <div style={{ padding: '0 20px', flex: 1, position: 'relative', zIndex: 1 }}>
          <div style={{
            background: t.surfaceLow, borderRadius: 28,
            padding: '20px 18px',
          }}>
            <AndLoginField t={t} label="Email" value="keval@aekaminc.com" />
            <div style={{ height: 12 }} />
            <AndLoginField t={t} label="Password" value="•••••••••" trailing="Show" type="password" />
            <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '12px 0 4px' }}>
              <span style={{ fontSize: 13, color: t.primary, fontWeight: 600, letterSpacing: 0.1 }}>Forgot password?</span>
            </div>
            <button style={{
              marginTop: 14, width: '100%', height: 48, borderRadius: 99,
              border: 0, background: KP.grad, color: '#fff',
              fontSize: 15, fontWeight: 600, letterSpacing: 0.4,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              fontFamily: 'Roboto, system-ui',
            }}>
              Sign in
              <AMIcon name="chevron-right" size={18} color="#fff" />
            </button>
            <div style={{
              marginTop: 16, padding: 12, borderRadius: 16,
              background: t.secondaryContainer,
              display: 'flex', alignItems: 'flex-start', gap: 8,
            }}>
              <AMIcon name="spark" size={14} color={t.onSecondaryContainer} />
              <span style={{ fontSize: 12.5, color: t.onSecondaryContainer, lineHeight: 1.45 }}>
                <b>Invite-only access.</b> Contact your admin to be added.
              </span>
            </div>
          </div>
        </div>
        <div style={{
          textAlign: 'center', padding: '24px 0 28px',
          fontSize: 10, color: t.onSurfaceVar2,
          letterSpacing: 2, textTransform: 'uppercase', fontWeight: 600,
          position: 'relative', zIndex: 1,
        }}>Powered by Aekam Inc</div>
      </div>
    </AndroidShell>
  );
}
function AndLoginField({ t, label, value, trailing, type }) {
  return (
    <div style={{
      background: t.surface2, borderRadius: 12,
      padding: '8px 16px 10px',
      borderBottom: `2px solid ${t.primary}`,
    }}>
      <div style={{
        fontSize: 12, color: t.primary, fontWeight: 500,
        letterSpacing: 0.4, marginBottom: 2,
      }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          flex: 1, fontSize: 15, color: t.onSurface,
          fontFamily: type === 'password' ? 'ui-monospace, monospace' : 'Roboto, system-ui',
        }}>{value}</span>
        {trailing && <span style={{ fontSize: 12.5, color: t.onSurfaceVar, fontWeight: 600 }}>{trailing}</span>}
      </div>
    </div>
  );
}

// ── SETTINGS ───────────────────────────────────────────────────────────
function AndSettings({ dark }) {
  const t = aTokens(dark);
  const me = M_USER('u1');
  return (
    <AndroidShell dark={dark}>
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 110 }}>
        <ATopHeader
          kicker="Settings"
          kickerHi="विकल्प"
          title="You & your app"
          dark={dark} t={t}
        />

        {/* Account card */}
        <div style={{ padding: '4px 16px 18px' }}>
          <div style={{
            background: t.surfaceLow, borderRadius: 28,
            padding: '16px 18px',
            display: 'flex', alignItems: 'center', gap: 14,
          }}>
            <AAvatar u={me} size={52} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 600, color: t.onSurface }}>{me.name} Shah</div>
              <div style={{ fontSize: 13, color: t.onSurfaceVar, marginTop: 2 }}>keval@aekaminc.com</div>
            </div>
            <span style={{
              fontSize: 10.5, fontWeight: 700, color: t.onSecondaryContainer,
              background: t.secondaryContainer,
              padding: '4px 10px', borderRadius: 99,
              letterSpacing: 1.2, textTransform: 'uppercase',
            }}>Owner</span>
          </div>
        </div>

        {/* Notifications — per-kind toggles */}
        <AndSettingsSection t={t} label="Notifications" hi="सूचनाएँ" caption="Mentions and approvals always push. Others can be in-app or scoped.">
          {M_NOTIF_KINDS.map((k, i) => {
            const isLast = i === M_NOTIF_KINDS.length - 1;
            const pushMode = k.push === 'always' ? 'Push · email'
              : k.push === 'mine_only' ? 'Push (mine)'
              : k.push === 'project' ? 'Push (project)'
              : 'In-app only';
            const isOn = k.push !== 'off';
            // Pick an M3 container colour per tone
            const containerBg = {
              mention:  t.secondaryContainer, approval: t.tertiaryContainer,
              assigned: t.purpleContainer,    comment:  t.primaryContainer,
              status:   t.secondaryContainer, success:  t.primaryContainer,
              danger:   t.errorContainer,     neutral:  t.surface2,
            }[k.tone];
            const containerFg = {
              mention:  t.onSecondaryContainer, approval: t.onTertiaryContainer,
              assigned: t.purple,               comment:  t.onPrimaryContainer,
              status:   t.onSecondaryContainer, success:  t.onPrimaryContainer,
              danger:   t.onErrorContainer,     neutral:  t.onSurfaceVar,
            }[k.tone];
            const iconName = {
              mention: 'at',     approval: 'check',  assigned: 'person',
              comment: 'inbox',  status: 'view-kanban', success: 'check',
              danger: 'flag',    neutral: 'view-kanban',
            }[k.tone];
            return (
              <div key={k.id} style={{
                display: 'flex', alignItems: 'center', gap: 14,
                minHeight: 64, padding: '10px 18px',
                borderBottom: isLast ? 0 : `1px solid ${t.outlineVar}`,
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 99,
                  background: containerBg,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <AMIcon name={iconName} size={18} color={containerFg} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ fontSize: 15, color: t.onSurface, fontWeight: 500 }}>{k.label}</span>
                    <span style={{ fontFamily: '"Tiro Devanagari Hindi", serif', fontSize: 11, color: t.onSurfaceVar2 }}>{k.hi}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: t.onSurfaceVar, marginTop: 2 }}>{pushMode}</div>
                </div>
                {/* M3 switch */}
                <div style={{
                  width: 52, height: 32, borderRadius: 99,
                  background: isOn ? t.primary : t.surface2,
                  border: isOn ? 0 : `2px solid ${t.outline}`,
                  padding: 4, position: 'relative',
                  boxSizing: 'border-box',
                }}>
                  <div style={{
                    width: isOn ? 24 : 16, height: isOn ? 24 : 16,
                    borderRadius: 99,
                    background: isOn ? t.onPrimary : t.outline,
                    transform: isOn ? 'translateX(20px)' : 'translateX(4px)',
                    transition: 'transform 0.2s, width 0.2s, height 0.2s',
                    position: 'absolute', top: '50%', marginTop: isOn ? -12 : -8,
                    left: 0,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {isOn && <AMIcon name="check" size={14} color={t.primary} />}
                  </div>
                </div>
              </div>
            );
          })}
        </AndSettingsSection>

        {/* Permissions */}
        <AndSettingsSection t={t} label="Permissions" hi="अनुमतियाँ" caption="Approval pushes need Notifications.">
          <AndSettingsRow t={t} icon="inbox"  label="Notifications"     status="granted" valueColor={t.primary} sep />
          <AndSettingsRow t={t} icon="camera" label="Camera"            status="granted" valueColor={t.primary} sep />
          <AndSettingsRow t={t} icon="mic"    label="Microphone"        status="Ask each time" valueColor={t.tertiary} sep />
          <AndSettingsRow t={t} icon="doc"    label="Photos & files"    status="All photos" valueColor={t.primary} />
        </AndSettingsSection>

        {/* Sync */}
        <AndSettingsSection t={t} label="Sync & data" hi="संग्रह" caption="Reset clears local cache only — server data is safe.">
          <AndSettingsRow t={t} icon="sync"     label="Sync status"   status="3 queued" valueColor={t.tertiary} sep />
          <AndSettingsRow t={t} icon="wifi-off" label="Last synced"   status="2 min ago" sep />
          <div style={{ padding: '8px 14px 12px' }}>
            <button style={{
              width: '100%', height: 44, borderRadius: 99, border: 0,
              background: t.primary, color: t.onPrimary,
              fontSize: 14, fontWeight: 600, letterSpacing: 0.2,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              fontFamily: 'Roboto, system-ui',
            }}>
              <AMIcon name="sync" size={16} color={t.onPrimary} />
              Sync now
            </button>
          </div>
          <AndSettingsRow t={t} icon="more-vert" label="Reset app data" destructive />
        </AndSettingsSection>

        {/* Preferences */}
        <AndSettingsSection t={t} label="Preferences" hi="मनपसंद">
          <AndSettingsRow t={t} icon="spark"        label="Theme"         status="System" sep />
          <AndSettingsRow t={t} icon="view-kanban"  label="Default view"  status="Board" sep />
          <AndSettingsRow t={t} icon="view-kanban"  label="Language"      status="English · हिन्दी" />
        </AndSettingsSection>

        {/* About */}
        <AndSettingsSection t={t} label="About" hi="सूचना">
          <AndSettingsRow t={t} icon="view-kanban"  label="Version"          status="2.0.1 · 487" sep />
          <AndSettingsRow t={t} icon="view-kanban"  label="Privacy policy" sep />
          <AndSettingsRow t={t} icon="view-kanban"  label="Terms of service" />
        </AndSettingsSection>

        {/* Sign out */}
        <div style={{ padding: '8px 16px 24px' }}>
          <button style={{
            width: '100%', height: 48, borderRadius: 99,
            border: `1px solid ${t.error}`, background: 'transparent',
            color: t.error, fontSize: 15, fontWeight: 600, letterSpacing: 0.2,
            fontFamily: 'Roboto, system-ui',
          }}>Sign out</button>
          <div style={{
            textAlign: 'center', marginTop: 14, fontSize: 10, color: t.onSurfaceVar2,
            letterSpacing: 2, textTransform: 'uppercase', fontWeight: 600,
          }}>Kartavya · by Aekam Inc</div>
        </div>
      </div>
      <ABottomNav active="me" t={t} dark={dark} />
    </AndroidShell>
  );
}
function AndSettingsSection({ label, hi, caption, children, t }) {
  return (
    <div style={{ padding: '0 16px 14px' }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 8,
        padding: '0 6px 8px',
      }}>
        <span style={{
          fontSize: 11, color: t.primary, fontWeight: 700,
          letterSpacing: 1.4, textTransform: 'uppercase',
        }}>{label}</span>
        <span style={{
          fontFamily: '"Tiro Devanagari Hindi", serif',
          fontSize: 12, color: t.onSurfaceVar2,
        }}>{hi}</span>
      </div>
      <div style={{ background: t.surfaceLow, borderRadius: 28, overflow: 'hidden' }}>
        {children}
      </div>
      {caption && <div style={{
        padding: '8px 6px 0', fontSize: 12, color: t.onSurfaceVar2, lineHeight: 1.45,
      }}>{caption}</div>}
    </div>
  );
}
function AndSettingsRow({ icon, label, status, valueColor, destructive, sep, t }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      minHeight: 56, padding: '10px 18px',
      borderBottom: sep ? `1px solid ${t.outlineVar}` : 0,
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 99,
        background: destructive ? t.errorContainer : t.surface2,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <AMIcon name={icon} size={18} color={destructive ? t.onErrorContainer : t.onSurfaceVar} />
      </div>
      <span style={{
        flex: 1, fontSize: 15,
        color: destructive ? t.error : t.onSurface, fontWeight: destructive ? 600 : 500,
      }}>{label}</span>
      {status && <span style={{
        fontSize: 13, color: valueColor || t.onSurfaceVar, fontWeight: 500,
        textTransform: status === 'granted' ? 'capitalize' : 'none',
      }}>{status === 'granted' ? 'Granted' : status}</span>}
      {!destructive && <AMIcon name="chevron-right" size={16} color={t.onSurfaceVar2} />}
    </div>
  );
}

Object.assign(window, { AndLogin, AndSettings });
