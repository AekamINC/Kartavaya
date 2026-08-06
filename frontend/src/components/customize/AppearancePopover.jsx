/**
 * AppearancePopover.jsx — appearance customisation WITHOUT leaving the page.
 *
 * ── The complaint this answers ──────────────────────────────────────────────
 *
 * "Sahayak is not a complete package like the prototype." In
 * `design-reference/Kartavaya Redesign/Chrome.jsx:143` the appearance controls
 * are `AppearancePop`, a 306px popover hanging off the top bar that applies on
 * click. In the build the same settings existed ONLY at `/settings/customize`,
 * so choosing an accent meant leaving the page you were judging the accent on,
 * changing it against a screen made of rows and toggles, and navigating back to
 * find out. You cannot tell whether Crimson works on the invoice table from a
 * settings page that has no table.
 *
 * ── It is not a fork of the settings page ───────────────────────────────────
 *
 * Every control here is the SAME COMPONENT the settings tabs render —
 * `AccentGrid`, `AccentPreview`, `SidebarBgCards`, `ConvPatternCards`,
 * `ConvGroundCards`, `FontList`, `TypePreview`, `SoundGrid`, `Seg` — and every
 * write goes through the SAME `useCustomize().setPrefs`, which persists to
 * `k_prefs` and calls `applyPrefs` in the same tick. There is no second store,
 * no second effect and no second copy of the accent maths. Open this popover
 * and `/settings/customize` side by side and they cannot disagree, because
 * there is only one of everything.
 *
 * That is also what makes "applies immediately" true for free: `setPrefs`
 * already writes the CSS custom properties onto `documentElement`, so the page
 * behind the popover repaints on the click rather than on a save or a reload.
 *
 * ── Why it works on every module ────────────────────────────────────────────
 *
 * It is mounted by `layout/Topbar.jsx`, which `AppShell` renders once for every
 * route inside the shell. Nothing in this file knows or asks which module is
 * underneath, and nothing in it is imported from `pages/sahayak/**`. The suite
 * at `__tests__/appearancePopover.test.jsx` mounts the real Topbar at two
 * different module routes and drives the same assertions against both.
 *
 * ── Dismissal, focus and the accessible name ────────────────────────────────
 *
 * The trigger and the panel share ONE ref, so the outside-click test is a
 * single `contains` — none of the `data-notif-trigger` gymnastics
 * `NotificationsModal` needs, where the trigger lives outside the panel and
 * pressing it would otherwise fire mousedown (dismiss) then click (re-open) and
 * look frozen.
 *
 * `mousedown`, not `click`, so a control that re-renders on press cannot
 * swallow the dismissal. Escape is bound in the CAPTURE phase and stops
 * propagating, so closing this does not also close a drawer behind it.
 *
 * `FocusTrap` is the shared one from `components/ui`, unmodified. It also
 * restores focus to the trigger on unmount, which is the half of "keyboard
 * reachable" that is easy to forget: a user who opens this with Return and
 * closes it with Escape lands back on the button they pressed, not at <body>.
 *
 * ── What is deliberately NOT in here ────────────────────────────────────────
 *
 * `NotifyPrefs` — the ninth component in `components/customize/` — is not
 * composed in. It GETs `/me/notification_prefs` on mount, and this panel is
 * mounted on every page in the product: putting it here buys a request every
 * time anyone opens the popover to change an accent, and its own controls
 * (per-kind email/push/in-app modes, quiet hours) are a table, not a popover
 * row. It stays on the Notifications tab, which the foot links to.
 */
import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { useCustomize, DISPLAY_FONTS, UI_FONTS } from '../CustomizePanel';
import FocusTrap from '../ui/FocusTrap';
import { Secondary } from '../Bilingual';
import { ICONS } from '../layout/navIcons';

import AccentGrid from './AccentGrid';
import AccentPreview from './AccentPreview';
import SidebarBgCards from './SidebarBgCards';
import { ConvPatternCards, ConvGroundCards } from './ConversationGround';
import FontList from './FontList';
import TypePreview from './TypePreview';
import SoundGrid from './SoundGrid';
import Seg from './Seg';

import { getNotifSoundId, setNotifSoundId } from '../../lib/notifSound';
import { DEFAULT_CONV_PATTERN, DEFAULT_CONV_GROUND } from '../../lib/convGround';
import '../../styles/appearance.css';

/**
 * The panel body. Split out from the trigger so the trigger stays readable and
 * so the dialog's contents mount only while it is open — nine sections of
 * swatches, specimen rows and pattern tiles is not markup to keep alive behind
 * every page in the product for a control most people press twice a year.
 */
function AppearancePanel({ titleId, onClose }) {
  const { prefs, setPrefs } = useCustomize();

  /* The notification sound is the one setting on this panel that does NOT live
     in `k_prefs`. `lib/notifSound.js` owns its own key and its own player, and
     `TabNotifications` reads it exactly this way. Mirroring it into prefs here
     would create the second store this file exists to avoid. */
  const [soundId, setSoundId] = useState(getNotifSoundId);
  const chooseSound = (id) => { setNotifSoundId(id); setSoundId(id); };

  const size = prefs.fontSize || 14;

  return (
    <div className="kap__pop" role="dialog" aria-labelledby={titleId}>
      <div className="kap__hd">
        <span className="kap__hd-t" id={titleId}>
          Appearance
          <Secondary className="kap__hd-hi" value="रूप" />
        </span>
        <button
          type="button"
          className="k-iconbtn"
          onClick={onClose}
          aria-label="Close appearance"
        >
          {ICONS.close}
        </button>
      </div>

      <div className="kap__body">
        {/* 1 · Mode. `system` is a live matchMedia subscription inside
            CustomizeProvider, not a boot-time read, so it keeps following the
            device after sunset without a reload. */}
        <div className="kap__sec">
          <div className="kap__row">
            <span className="kap__lbl">Mode</span>
            <Seg
              label="Theme mode"
              value={prefs.mode}
              onChange={v => setPrefs({ mode: v })}
              options={[
                { label: 'Light',  value: 'light' },
                { label: 'Dark',   value: 'dark' },
                { label: 'System', value: 'system' },
              ]}
            />
          </div>
        </div>

        {/* 2 · Accent. The preview sits directly under the grid because the
            whole reason this is a popover is that you can also see the real
            page behind it change — the preview is for the four component
            shapes the page underneath may not happen to be showing. */}
        <div className="kap__sec">
          <span className="kap__lbl">Accent</span>
          <AccentGrid
            accent={prefs.accent}
            customAccent={prefs.customAccent}
            onPick={id => setPrefs({ accent: id, customAccent: null })}
            onCustom={hex => setPrefs({ customAccent: hex })}
          />
          <AccentPreview />
        </div>

        {/* 3 · Sidebar background. */}
        <div className="kap__sec">
          <span className="kap__lbl">Sidebar</span>
          <SidebarBgCards
            value={prefs.sideBg || 'dark'}
            onChange={v => setPrefs({ sideBg: v })}
          />
        </div>

        <hr className="kap__rule" />

        {/* 4 · Density. */}
        <div className="kap__sec">
          <div className="kap__row">
            <span className="kap__lbl">Density</span>
            <Seg
              label="Density"
              value={prefs.density}
              onChange={v => setPrefs({ density: v })}
              options={[
                { label: 'Compact', value: 'compact' },
                { label: 'Cozy',    value: 'cozy' },
                { label: 'Comfy',   value: 'comfy' },
              ]}
            />
          </div>
        </div>

        {/* 5 · Corner radius. `Chrome.jsx:190` drives this from a slider
            8→28 step 2; the build offers the three values the token scale is
            actually drawn at, which is what TabLayout offers too. */}
        <div className="kap__sec">
          <div className="kap__row">
            <span className="kap__lbl">Corners</span>
            <Seg
              label="Corner radius"
              value={String(prefs.radius || 12)}
              onChange={v => setPrefs({ radius: parseInt(v, 10) })}
              options={[
                { label: 'Sharp',   value: '8' },
                { label: 'Default', value: '12' },
                { label: 'Round',   value: '20' },
              ]}
            />
          </div>
        </div>

        {/* 6 · Motion. Writes --ix-user / --motion-scale-user, never --ix or
            --motion-scale: an inline style on the root outranks a media query,
            so writing the derived names directly would let this preference
            silently defeat the OS reduced-motion setting. */}
        <div className="kap__sec">
          <div className="kap__row">
            <span className="kap__lbl">Motion</span>
            <Seg
              label="Animation"
              value={prefs.anim || 'full'}
              onChange={v => setPrefs({ anim: v })}
              options={[
                { label: 'Full',    value: 'full' },
                { label: 'Reduced', value: 'reduced' },
                { label: 'None',    value: 'none' },
              ]}
            />
          </div>
          <span className="kap__hint">
            If your device already asks for reduced motion, that wins regardless of this setting.
          </span>
        </div>

        <hr className="kap__rule" />

        {/* 7 · Typeface — two independent faces, and the specimen that shows
            the pair. Both lists render each option IN the face it offers, so a
            360px column is enough to choose from. */}
        <div className="kap__sec">
          <span className="kap__lbl">Typeface</span>
          <span className="kap__sub">Headings</span>
          <FontList
            fonts={DISPLAY_FONTS}
            value={prefs.font}
            onChange={id => setPrefs({ font: id })}
            label="Display font"
          />
          <span className="kap__sub">Interface</span>
          <FontList
            fonts={UI_FONTS}
            value={prefs.uiFont || 'inter'}
            onChange={id => setPrefs({ uiFont: id })}
            label="Interface font"
          />
          <div className="kap__row">
            <span className="kap__sub">Line height</span>
            <Seg
              label="Line height"
              value={String(prefs.lineHeight || 1.5)}
              onChange={v => setPrefs({ lineHeight: parseFloat(v) })}
              options={[
                { label: 'Tight',   value: '1.3' },
                { label: 'Normal',  value: '1.5' },
                { label: 'Relaxed', value: '1.7' },
              ]}
            />
          </div>
          <TypePreview
            font={prefs.font}
            uiFont={prefs.uiFont}
            fontSize={size}
            lineHeight={prefs.lineHeight}
          />
        </div>

        <hr className="kap__rule" />

        {/* 8 · The conversation ground — two axes, deliberately two controls.
            One combined control would have to decide which of five patterns
            pairs with which of four grounds. */}
        <div className="kap__sec">
          <span className="kap__lbl">Conversation</span>
          <ConvPatternCards
            value={prefs.convPattern || DEFAULT_CONV_PATTERN}
            onChange={v => setPrefs({ convPattern: v })}
          />
          <ConvGroundCards
            value={prefs.convGround || DEFAULT_CONV_GROUND}
            onChange={v => setPrefs({ convGround: v })}
          />
          <span className="kap__hint">
            A faint texture and tint behind Sanvaad and Sahayak. Never on a module page.
          </span>
        </div>

        <hr className="kap__rule" />

        {/* 9 · Notification sound. A card both selects AND plays, which is the
            component's own design: nobody previews a sound they are not
            considering and nobody picks one they have not heard. */}
        <div className="kap__sec">
          <span className="kap__lbl">Notification sound</span>
          <SoundGrid value={soundId} onChange={chooseSound} />
        </div>
      </div>

      <div className="kap__ft">
        <span className="kap__hint">Saved on this device as you choose.</span>
        <Link className="kap__ft-a" to="/settings/customize" onClick={onClose}>
          All settings
        </Link>
      </div>
    </div>
  );
}

/**
 * The trigger plus the panel. Drop it anywhere; it brings its own anchor.
 *
 * Uncontrolled on purpose. The Topbar has no reason to know whether appearance
 * is open — unlike the bell, whose open state AppShell shares with the mobile
 * bar — and an owner for this state would be a prop threaded through two
 * components for nothing.
 */
export default function AppearanceMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const titleId = useId();

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return undefined;

    const onPointer = (e) => {
      // The trigger is INSIDE this ref, so a press on it is "inside" and only
      // the button's own onClick toggles — no dismiss/re-open race.
      if (ref.current?.contains(e.target)) return;
      close();
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    };

    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, close]);

  return (
    <div className="kap" ref={ref}>
      <button
        type="button"
        className="k-iconbtn"
        title="Appearance"
        aria-label="Appearance"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        {ICONS.customize}
      </button>
      {open && (
        <FocusTrap active>
          <AppearancePanel titleId={titleId} onClose={close} />
        </FocusTrap>
      )}
    </div>
  );
}
