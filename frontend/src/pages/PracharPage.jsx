// Prachar · प्रचार — marketing route shell.
//
// This file was 1,021 lines with 108 inline `style={{…}}` objects. Per
// 13-module-pages.md, and per the header GrahaPage.jsx already carries, a module
// page is split into a route file plus a directory of tab components BEFORE any
// styling is applied: a restyle of a single-file module touches every tab, every
// table and every form at once, and the diff is unreviewable. Graha, Ganit and
// Manav were split and then styled; Prachar was not, which is why it still
// looked like a different product.
//
// ── What the reference asks for ───────────────────────────────────────────
// `design-reference/Kartavaya Redesign/ScreensMore.jsx`, `ScreenPrachar`:
//   · a Growth · वृद्धि kicker over प्रचार Marketing;
//   · a Month / Week control and a Schedule button at the trailing edge;
//   · channel filter chips;
//   · and — the whole point of the screen — a MONTH CALENDAR of campaigns,
//     tinted by channel, draggable to reschedule.
// The build had a flat list of campaign cards and no calendar at all, on a
// module whose one irreducible question is "what goes out, and when".
//
// The Month/Week control and the chips live on the Campaigns tab rather than in
// the header, because seven of the eight tabs are not a calendar and a control
// that does nothing on the tab you are looking at is worse than no control.
import React, { useState } from 'react';
import ModuleHeader from '../components/module/ModuleHeader';
import ModuleTabs from '../components/module/ModuleTabs';
import useTabPrefs from '../components/module/useTabPrefs';
import CustomizeTabs from '../components/module/CustomizeTabs';
import { ModuleAnalyticsTab } from './dristi/AnalyticsTab';
import KpiStrip from '../components/module/KpiStrip';
import { ICONS } from '../components/layout/navIcons';
import useTabPanelMotion from '../lib/tabPanelMotion';
import { api, useResource, body, pct } from './prachar/_shared';

import DashboardTab from './prachar/DashboardTab';
import CampaignsTab from './prachar/CampaignsTab';
import AdsTab from './prachar/AdsTab';
import SequencesTab from './prachar/SequencesTab';
import TemplatesTab from './prachar/TemplatesTab';
import UnsubscribesTab from './prachar/UnsubscribesTab';
import EventsTab from './prachar/EventsTab';

// Order is `MODULE_TABS.prachar` from the reference's Data.jsx:126, MINUS
// `automations`.
//
// THERE IS NO ENGINE BEHIND PRACHAR'S AUTOMATIONS. `prachar/AutomationsTab.jsx`
// offers a form whose own note reads "will run when …, and will …", and not one
// of the seven trigger names it writes appears anywhere in the backend outside
// the five CRUD statements that store them. `staging.prachar_automations` holds
// 0 rows in the product's entire life (measured 6 August 2026) and `run_count`
// on any row created would stay 0 for ever.
//
// This is NOT the CRM's automations. Graha's really do fire, from a working
// engine over a different table with a different trigger vocabulary — which is
// why "point one at the other" is not the fix. Six of Prachar's seven triggers
// are CRM events, so building this means new call sites inside Graha: real
// cross-module work and a product decision, not a patch.
//
// So the tab is unmounted rather than left standing. A screen that promises
// unattended execution is the expensive half to leave in place — nothing is
// lost, because there is nothing to lose, and `POST /v1/prachar/automations`
// now answers 501 so the door does not stay open to a client that remembers it.
// `AutomationsTab.jsx` is kept, unimported: it is the screen this feature needs
// on the day the engine exists, and its own header carries the same note.
const TABS = [
  ['dashboard', DashboardTab], ['campaigns', CampaignsTab], ['ads', AdsTab],
  ['sequences', SequencesTab], ['templates', TemplatesTab],
  ['unsubscribes', UnsubscribesTab], ['events', EventsTab],
  ['analytics', () => <ModuleAnalyticsTab module="prachar" />],
];

export default function PracharPage() {
  // Tab prefs (proposal 67). This page reads its tab from local state only —
  // no URL param, no route state — so the starred default decides where the
  // module opens; `picked` (a click, or the header's + Schedule) wins from the
  // first choice.
  const prefs = useTabPrefs('prachar', TABS.map(([id]) => id), { fallback: 'campaigns' });
  const [picked, setTab] = useState(null);
  const tab = picked ?? prefs.defaultTab;
  const [customize, setCustomize] = useState(false);
  // Opens the Campaigns tab with its scheduler already open. Same nonce pattern
  // as GrahaPage's `newDealNonce`: a counter rather than a boolean, so pressing
  // the header button twice re-opens the form the second time.
  const [scheduleNonce, setScheduleNonce] = useState(0);
  const Active = (TABS.find(([id]) => id === tab) || TABS[0])[1];
  // `key` is destructured out rather than spread. `useTabPanelMotion` returns
  // `{ key, style }` and the key is the whole mechanism — it remounts the panel
  // so the CSS animation restarts. React warns on a spread `key` today and
  // React 19 DROPS it silently, which would leave the panel animating once and
  // never again. GrahaPage still spreads it; this is the shape that survives.
  const { key: panelKey, ...motion } = useTabPanelMotion(prefs.order, tab);

  // One call feeds both the KPI strip and the tab counts — the module summary
  // the page had no equivalent of. A module that opens on a list of rows with
  // no figures above them makes you read the list to learn the state.
  const { data: sum, loading, error, reload } = useResource(
    () => api.get('/v1/prachar/dashboard').then(body), [],
  );

  const c = sum?.campaigns || {};
  const d = sum?.delivery || {};
  const sent = Number(d.total_sent || 0);
  // Nothing measures opens — see DashboardTab's funnel and
  // `backend/services/engagement_metrics.py`. The backend says so explicitly
  // rather than leaving it to be inferred from a null, because the tile below
  // has to choose between a percentage and a sentence before it reads a value.
  const measured = sum?.engagement_measured === true;
  const opened = Number(d.total_opened || 0);

  const kpi = sum ? [
    {
      label: 'In flight', hi: 'चालू', tone: 'p',
      value: Number(c.scheduled || 0) + Number(c.sending || 0),
      sub: `${c.drafts || 0} still in draft`,
    },
    {
      label: 'Reached', hi: 'पहुँच',
      value: sent,
      sub: sent ? 'recipients, all sent campaigns' : 'nothing sent yet',
    },
    // A KPI tile is the one place on this page a figure is read without any
    // surrounding sentence, so it is the one place a fabricated open rate does
    // the most damage. While nothing measures opens it says so in the value
    // itself — no tone, because there is no state to be good or bad about.
    measured ? {
      label: 'Open rate', hi: 'खुला', tone: opened && sent && opened / sent < 0.15 ? 'warn' : 'ok',
      value: pct(opened, sent),
      // A rate with no denominator is not a rate. 00 §12: the caption carries
      // the same fact the tone does, so colour is never the only signal.
      sub: sent ? `${opened} of ${sent} opened` : 'no sends to measure',
    } : {
      label: 'Open rate', hi: 'खुला',
      value: 'Not measured',
      sub: 'nothing receives open events',
    },
    {
      label: 'Opted out', hi: 'निकास',
      tone: sum.unsubscribes_count > 0 ? 'warn' : undefined,
      value: sum.unsubscribes_count || 0,
      sub: 'excluded from every send',
    },
  ] : null;

  const counts = {
    campaigns: c.total,
    templates: sum?.templates_count,
    unsubscribes: sum?.unsubscribes_count,
  };
  const tabs = prefs.order.map(id => ({ id, label: id, count: counts[id] }));

  return (
    <div className="pr__page">
      <ModuleHeader
        module="prachar"
        kick="section.growth"
        en="Marketing"
        hi="prachar"
        sub="Every campaign carries a channel and a date."
        icon={ICONS.prachar}
        actions={
          <button
            type="button"
            className="k-btn k-btn--primary k-btn--sm"
            onClick={() => { setTab('campaigns'); setScheduleNonce((n) => n + 1); }}
          >
            + Schedule
          </button>
        }
      />

      <ModuleTabs
        tabs={tabs} value={tab} onChange={setTab} label="Prachar sections"
        defaultTab={prefs.defaultTab}
        // Pin the open tab first — a new "opens here" must not yank the panel.
        onCustomize={() => { setTab(tab); setCustomize(true); }}
      />
      <CustomizeTabs
        open={customize} onClose={() => setCustomize(false)}
        tabs={tabs} defaultTab={prefs.defaultTab}
        onSave={prefs.save} standard={prefs.standard}
      />

      <KpiStrip items={kpi} loading={loading} error={error} count={4} />

      <div
        key={panelKey}
        role="tabpanel"
        id={`mt-panel-${tab}`}
        aria-labelledby={`mt-tab-${tab}`}
        className="ix-panel"
        {...motion}
      >
        {tab === 'campaigns'
          ? <CampaignsTab scheduleNonce={scheduleNonce} onChanged={reload} />
          : <Active onChanged={reload} />}
      </div>
    </div>
  );
}
