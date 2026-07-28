/**
 * BrandKit — brand colors + fonts, three modes:
 *
 *  "manage"  Org-wide CRUD, saves to /settings API. Admin/owner only.
 *            Used in AdminPage.
 *
 *  "display" Org-wide read-only swatches. Shown to all non-client users.
 *            Used in TaskDrawer, TemplatesPage.
 *
 *  "edit"    Controlled by parent (no API). Parent passes value + onChange.
 *            Used in ProjectsPage new-project form.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

const EMPTY_KIT = { colors: [], fonts: [] };

/* ── Shared sub-components ──────────────────────────────────────────────── */

function ColorSwatch({ hex, name }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
      background: 'var(--bg-soft)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)' }}>
      <span style={{ width: 18, height: 18, borderRadius: 4, background: hex, flexShrink: 0,
        border: '1px solid rgba(0,0,0,.1)', display: 'inline-block' }} />
      <span style={{ fontFamily: 'var(--font-ui)', fontSize: 12, fontWeight: 700,
        color: 'var(--ink)', letterSpacing: '0.03em' }}>{hex}</span>
      {name && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>— {name}</span>}
    </div>
  );
}

function FontChip({ name, use }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
      background: 'var(--bg-soft)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)' }}>
      <span style={{ fontSize: 14, color: 'var(--ink-3)', lineHeight: 1, flexShrink: 0 }}>Aa</span>
      <span style={{ fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{name}</span>
      {use && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>— {use}</span>}
    </div>
  );
}

/* The Devanagari comes in through `hi` rather than inside `children`, because
   this label is uppercase, tracked at .12em and weight 800 — all three of which
   Devanagari must not inherit. It previously carried --font-hindi in its own
   stack with the Devanagari written straight into the label text and no `lang`,
   so the global [lang] reset never fired and "रंग"/"फ़ॉन्ट" rendered
   faux-bold and letter-spaced, which splits the conjuncts.
   `.k-lbl__in` is the existing class for exactly this position. */
function SectionLabel({ children, hi }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase',
      color: 'var(--ink-3)', marginBottom: 8, fontFamily: 'var(--font-ui)' }}>
      {children}
      {hi && <span className="k-lbl__in" lang="hi">{hi}</span>}
    </div>
  );
}

/* ── Editable palette (manage + edit modes) ─────────────────────────────── */

function EditableColors({ colors, onChange, saving }) {
  const [hex,  setHex]  = useState('#0082c6');
  const [name, setName] = useState('');

  const add = () => {
    if (!hex) return;
    onChange([...colors, { hex, name: name.trim() }]);
    setName('');
  };
  const remove = (i) => onChange(colors.filter((_, j) => j !== i));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {colors.map((c, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
          background: 'var(--bg-soft)', borderRadius: 'var(--r-md)', border: '1px solid var(--rule-soft)' }}>
          <span style={{ width: 24, height: 24, borderRadius: 6, background: c.hex, flexShrink: 0,
            border: '1px solid rgba(0,0,0,.1)' }} />
          <span style={{ fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 700, color: 'var(--ink)', minWidth: 80 }}>{c.hex}</span>
          <span style={{ fontSize: 13, color: 'var(--ink-2)', flex: 1 }}>
            {c.name || <em style={{ color: 'var(--ink-faint)', fontStyle: 'italic' }}>Unnamed</em>}
          </span>
          <button onClick={() => remove(i)} disabled={saving}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ position: 'relative', cursor: 'pointer', flexShrink: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 10px',
            background: 'var(--bg-soft)', border: '1px solid var(--rule)', borderRadius: 'var(--r-md)',
            fontSize: 12, color: 'var(--ink-2)', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
            <span style={{ width: 18, height: 18, borderRadius: 4, background: hex, border: '1px solid rgba(0,0,0,.15)', flexShrink: 0 }} />
            {hex}
          </span>
          <input type="color" value={hex} onChange={e => setHex(e.target.value)}
            style={{ position: 'absolute', opacity: 0, width: '100%', height: '100%', top: 0, left: 0, cursor: 'pointer' }} />
        </label>
        <input className="k-input" value={name} onChange={e => setName(e.target.value)}
          placeholder="Name — e.g. Brand Pink, Logo Blue…"
          onKeyDown={e => e.key === 'Enter' && add()}
          style={{ flex: 1, minWidth: 140 }} />
        <button className="k-btn k-btn--ghost k-btn--sm" onClick={add} disabled={saving || !hex}>
          + Add
        </button>
      </div>
    </div>
  );
}

function EditableFonts({ fonts, onChange, saving }) {
  const [name, setName] = useState('');
  const [use,  setUse]  = useState('');

  const add = () => {
    if (!name.trim()) return;
    onChange([...fonts, { name: name.trim(), use: use.trim() }]);
    setName(''); setUse('');
  };
  const remove = (i) => onChange(fonts.filter((_, j) => j !== i));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {fonts.map((f, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
          background: 'var(--bg-soft)', borderRadius: 'var(--r-md)', border: '1px solid var(--rule-soft)' }}>
          <span style={{ fontSize: 16, color: 'var(--ink-3)', lineHeight: 1, flexShrink: 0, width: 24, textAlign: 'center' }}>Aa</span>
          <span style={{ fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{f.name}</span>
          <span style={{ fontSize: 13, color: 'var(--ink-2)', flex: 1 }}>
            {f.use || <em style={{ color: 'var(--ink-faint)', fontStyle: 'italic' }}>No description</em>}
          </span>
          <button onClick={() => remove(i)} disabled={saving}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input className="k-input" value={name} onChange={e => setName(e.target.value)}
          placeholder="Font name — e.g. Poppins, Montserrat…"
          onKeyDown={e => e.key === 'Enter' && add()}
          style={{ flex: 1, minWidth: 140 }} />
        <input className="k-input" value={use} onChange={e => setUse(e.target.value)}
          placeholder="Use — e.g. Headings, Body, Captions…"
          onKeyDown={e => e.key === 'Enter' && add()}
          style={{ flex: 1, minWidth: 120 }} />
        <button className="k-btn k-btn--ghost k-btn--sm" onClick={add} disabled={saving || !name.trim()}>
          + Add
        </button>
      </div>
    </div>
  );
}

/* ── Main export ─────────────────────────────────────────────────────────── */

export default function BrandKit({ mode = 'display', value, onChange }) {
  const [kit,     setKit]     = useState(value || EMPTY_KIT);
  const [loading, setLoading] = useState(mode !== 'edit');
  const [saving,  setSaving]  = useState(false);

  // Load org settings for manage + display modes
  useEffect(() => {
    if (mode === 'edit') return;
    api.get('/settings')
      .then(r => setKit({ colors: r.data.brand_colors || [], fonts: r.data.brand_fonts || [] }))
      .catch(() => setKit(EMPTY_KIT))
      .finally(() => setLoading(false));
  }, [mode]);

  // Sync edit mode value from parent
  useEffect(() => {
    if (mode === 'edit') setKit(value || EMPTY_KIT);
  }, [value, mode]);

  const saveOrg = useCallback(async (updated) => {
    setSaving(true);
    try {
      const res = await api.put('/settings', { brand_colors: updated.colors, brand_fonts: updated.fonts });
      setKit({ colors: res.data.brand_colors || [], fonts: res.data.brand_fonts || [] });
    } catch (_) {}
    finally { setSaving(false); }
  }, []);

  const handleColorsChange = (colors) => {
    const updated = { ...kit, colors };
    setKit(updated);
    if (mode === 'manage') saveOrg(updated);
    else if (mode === 'edit') onChange?.(updated);
  };

  const handleFontsChange = (fonts) => {
    const updated = { ...kit, fonts };
    setKit(updated);
    if (mode === 'manage') saveOrg(updated);
    else if (mode === 'edit') onChange?.(updated);
  };

  if (loading) {
    return <div style={{ fontSize: 12, color: 'var(--ink-faint)', padding: '6px 0' }}>Loading…</div>;
  }

  const hasColors = kit.colors.length > 0;
  const hasFonts  = kit.fonts.length > 0;

  /* ── display mode ─────────────────────────────────────────────────────── */
  if (mode === 'display') {
    if (!hasColors && !hasFonts) {
      return (
        <div style={{ fontSize: 12, color: 'var(--ink-faint)', fontStyle: 'italic' }}>
          No brand kit saved. Admins can add colors and fonts in <strong>Admin → Brand Colors</strong>.
        </div>
      );
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {hasColors && (
          <div>
            <SectionLabel hi="रंग">Colors</SectionLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {kit.colors.map((c, i) => <ColorSwatch key={i} {...c} />)}
            </div>
          </div>
        )}
        {hasFonts && (
          <div>
            <SectionLabel hi="फ़ॉन्ट">Fonts</SectionLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {kit.fonts.map((f, i) => <FontChip key={i} {...f} />)}
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ── manage + edit modes ──────────────────────────────────────────────── */
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <SectionLabel hi="रंग">Colors</SectionLabel>
        {!hasColors && (
          <div style={{ fontSize: 12, color: 'var(--ink-faint)', fontStyle: 'italic', marginBottom: 8 }}>
            No colors saved yet.
          </div>
        )}
        <EditableColors colors={kit.colors} onChange={handleColorsChange} saving={saving} />
      </div>
      <div>
        <SectionLabel hi="फ़ॉन्ट">Fonts</SectionLabel>
        {!hasFonts && (
          <div style={{ fontSize: 12, color: 'var(--ink-faint)', fontStyle: 'italic', marginBottom: 8 }}>
            No fonts saved yet.
          </div>
        )}
        <EditableFonts fonts={kit.fonts} onChange={handleFontsChange} saving={saving} />
      </div>
      {mode === 'manage' && saving && (
        <div style={{ fontSize: 11, color: 'var(--k-primary)', fontStyle: 'italic' }}>Saving…</div>
      )}
    </div>
  );
}
