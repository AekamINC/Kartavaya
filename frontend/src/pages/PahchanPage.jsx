// Pahchan · पहचान — attendance route shell.
//
// Spec: design-handover/07-pahchan.md. v1 is login + live selfie + GPS, verified
// by HUMAN COMPARISON against two reference photos captured at enrollment. Face
// matching is parked to v2 and device enrollment is dropped.
//
// The Register tab is first on purpose. §3 calls it "the surface that decides
// whether this works" — human comparison is the only verification, so if the
// reviewer cannot keep up the feature is theatre. Policy and enrollment support
// it; they are not the point of the page.
//
// On the shared module chrome from 13-module-pages.md §1, like every other
// module page. It was on `PageHeader` + `TabBar`, which differ from the spec in
// three measurable ways: `.k-pageh__h1` is `clamp(32px, 4vw, 44px)` against
// `.mh__en` at 25px; `.k-pageh__sans` sets the Devanagari at 0.7em of that h1
// (22-31px, spec says 15px) in `--k-primary`, i.e. `--primary-vivid`, a fill
// rather than the measured `--primary-text`; and `PageHeader` has no module
// accent, where `.mh__ic` is the 38px tinted icon that identifies the module.
// `.k-tabbar` also carries no tablist roles.
import React, { useState } from 'react';
import ModuleHeader from '../components/module/ModuleHeader';
import ModuleTabs from '../components/module/ModuleTabs';
import useTabPrefs from '../components/module/useTabPrefs';
import CustomizeTabs from '../components/module/CustomizeTabs';
import { ModuleAnalyticsTab } from './dristi/AnalyticsTab';
import { ICONS } from '../components/layout/navIcons';
import { moduleMeta } from '../lib/moduleColors';
import Register from './pahchan/Register';
import EnrollQueue from './pahchan/EnrollQueue';
import PahchanPolicy from './pahchan/PahchanPolicy';
import Corrections from './pahchan/Corrections';
import PublishPayroll from './pahchan/PublishPayroll';
import History from './pahchan/History';
import Notice from './pahchan/Notice';

/**
 * The tab order is the order of the day, not the order the screens were built.
 *
 * Register first — §3, the surface the feature lives or dies on. Then the two
 * things that follow from reviewing a day: a correction someone has asked for,
 * and pushing the settled result to payroll. `history` and `notice` are the
 * employee's own two tabs and are the only ones here that need no reviewer
 * role; enrollment and policy are setup, and setup goes last.
 *
 * Three of these six had no UI at all until now. `corrections` and `payroll`
 * were endpoints nothing called; `history` is in `17-mobile-app.md`'s screen
 * table and existed in no form on either platform.
 *
 * `notice` is the seventh, and it is the DPDP notice — `PhNotice` in the
 * prototype, which existed in no form in `frontend/src`, `mobile/src` or
 * `backend/`. It sits directly after `history` because the two employee-facing
 * tabs belong together and ahead of the setup pair: what was recorded about
 * you, then what we record and why.
 */
const TABS = [
  { id: 'register',    label: 'Register' },
  { id: 'corrections', label: 'Corrections' },
  { id: 'payroll',     label: 'Payroll' },
  { id: 'history',     label: 'My attendance' },
  { id: 'notice',      label: 'What we record' },
  { id: 'enrollment',  label: 'Enrollment' },
  { id: 'policy',      label: 'Policy' },
  { id: 'analytics',   label: 'Analytics' },
];

export default function PahchanPage() {
  // Tab prefs (proposal 67). This page reads its tab from local state only —
  // no URL param, no route state — so the starred default decides where the
  // module opens. `register` stays the shipped fallback: §3's argument is
  // about the SHIPPED order, and a reviewer who stars something else has made
  // that call for themselves.
  const prefs = useTabPrefs('pahchan', TABS.map(t => t.id), { fallback: 'register' });
  const [picked, setTab] = useState(null);
  const tab = picked ?? prefs.defaultTab;
  const [customize, setCustomize] = useState(false);
  const orderedTabs = prefs.order.map(id => TABS.find(t => t.id === id));
  const meta = moduleMeta('pahchan');
  return (
    <div className="ph__page">
      <ModuleHeader
        module="pahchan"
        en={meta.en}
        hi="pahchan"
        sub="Clock-ins are recorded on the phone and confirmed here by comparing the selfie against two reference photos."
        icon={ICONS.pahchan}
      />
      <ModuleTabs
        tabs={orderedTabs} value={tab} onChange={setTab} label="Pahchan sections"
        defaultTab={prefs.defaultTab}
        // Pin the open tab first — a new "opens here" must not yank the panel.
        onCustomize={() => { setTab(tab); setCustomize(true); }}
      />
      <CustomizeTabs
        open={customize} onClose={() => setCustomize(false)}
        tabs={orderedTabs} defaultTab={prefs.defaultTab}
        onSave={prefs.save} standard={prefs.standard}
      />
      <div role="tabpanel" id={`mt-panel-${tab}`} aria-labelledby={`mt-tab-${tab}`}>
        {tab === 'register' && <Register />}
        {tab === 'corrections' && <Corrections />}
        {tab === 'payroll' && <PublishPayroll />}
        {tab === 'history' && <History />}
        {tab === 'notice' && <Notice />}
        {tab === 'enrollment' && <EnrollQueue />}
        {tab === 'policy' && <PahchanPolicy />}
        {tab === 'analytics' && <ModuleAnalyticsTab module="pahchan" />}
      </div>
    </div>
  );
}
