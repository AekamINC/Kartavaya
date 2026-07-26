import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/editorial';
import { Tabs } from '../components/ui';
import TabAppearance from './customize/TabAppearance';
import TabTypography from './customize/TabTypography';
import TabLayout from './customize/TabLayout';
import TabLanguage from './customize/TabLanguage';
import TabNotifications from './customize/TabNotifications';
import TabData from './customize/TabData';

/**
 * CustomizeSettingsPage — the tab shell. Every control lives in customize/*.
 *
 * The tab set is the existing ui/Tabs rather than a second implementation:
 * it already does roving tabindex, ←/→ navigation, and the aria-controls /
 * aria-labelledby pairing that makes the tablist and the panel actually
 * associated. A hand-rolled `.st__tabs` here would have been a less accessible
 * copy of a component this codebase already has.
 *
 * ?tab= is honoured so /settings/notifications can redirect into the
 * notifications tab and keep old links working.
 */
const TABS = [
  { value: 'appearance',    label: 'Appearance',    content: <TabAppearance /> },
  { value: 'typography',    label: 'Typography',    content: <TabTypography /> },
  { value: 'layout',        label: 'Layout',        content: <TabLayout /> },
  { value: 'language',      label: 'Language',      content: <TabLanguage /> },
  { value: 'notifications', label: 'Notifications', content: <TabNotifications /> },
  { value: 'data',          label: 'Data',          content: <TabData /> },
];

export default function CustomizeSettingsPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const initial = TABS.some(t => t.value === requested) ? requested : 'appearance';

  return (
    <div className="st">
      <PageHeader
        kicker="SETTINGS"
        title="Customize"
        sanskrit="सजावट"
        lede="Appearance, typography, layout, language and notifications."
      />

      <Tabs
        tabs={TABS}
        defaultTab={initial}
        onChange={v => setParams(v === 'appearance' ? {} : { tab: v }, { replace: true })}
      />

      {/* --primary-text, not --primary. --primary is a fill at 4.04:1 on --bg
          and this is 12px italic text (00 §12). --font-hindi rather than
          --font-indic is deliberate: यथारुचि is a fixed Sanskrit epigraph, not a
          label that follows the language setting (24 §watermark exception). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 28, fontSize: 12 }}>
        <span lang="sa" style={{ fontFamily: 'var(--font-hindi)', color: 'var(--on-surface-2)' }}>यथारुचि</span>
        <em style={{ color: 'var(--primary-text)', fontFamily: 'var(--font-display)' }}>“as you wish.”</em>
      </div>
    </div>
  );
}
