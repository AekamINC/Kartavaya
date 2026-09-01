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
import Clock from './pahchan/Clock';
import Register from './pahchan/Register';
import EnrollQueue from './pahchan/EnrollQueue';
import PahchanPolicy from './pahchan/PahchanPolicy';
import Corrections from './pahchan/Corrections';
import PublishPayroll from './pahchan/PublishPayroll';
import History from './pahchan/History';
import Notice from './pahchan/Notice';
import Enroll from './pahchan/Enroll';
import Consent from './pahchan/Consent';

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
 *
 * `consent` is the eighth and reads as the third sentence of that run: what was
 * recorded about you, what we record and why, and then whether you agreed to
 * it. It sits AFTER `notice` and not between it and `history` on purpose —
 * `__tests__/dpdpNotice.test.jsx` pins `notice` to the position directly after
 * `history`, and that adjacency is the point of both tabs. Being asked to
 * decide before being told is the order this module already refuses on the
 * clock screen.
 *
 * Its table, its two endpoints and the enrolment refusal that reads them all
 * shipped in August with no caller: 24 reference photographs against 12
 * employees and 0 consent rows, measured read-only 2026-08-26.
 */
/*
 * `clock` is first, and the shipped fallback is still `register`.
 *
 * First because it is the only tab most employees can use at all — every other
 * screen here except `history` and `notice` needs a reviewer role — and because
 * `POST /punch` had no web caller until now: an employee on an iPhone, which has
 * no build of the mobile app, could not clock in from anywhere.
 *
 * The fallback stays `register` deliberately. §3's argument is about the SHIPPED
 * default for the person who opens the module to review a day, and moving that
 * out from under existing reviewers is not this change's business. Anyone who
 * clocks in from the web stars `clock` once and it opens there.
 */
const TABS = [
  { id: 'clock',       label: 'Clock in' },
  { id: 'register',    label: 'Register' },
  { id: 'corrections', label: 'Corrections' },
  { id: 'payroll',     label: 'Payroll' },
  { id: 'history',     label: 'My attendance' },
  { id: 'notice',      label: 'What we record' },
  { id: 'consent',     label: 'Consent' },
  /* `enroll` is the employee's OWN reference photos; `enrollment` below is HR's
     review queue for everybody's. Two tabs, two audiences, and the names are
     one letter apart — worth the confusion because the alternative is one tab
     that behaves differently depending on who opened it.
     It sits at the end of the employee run, which now reads: what was recorded
     about you, what we record and why, whether you agreed, and what you are
     compared against. `notice` stays directly after `history` — a test pins
     that adjacency and it is the point of both tabs. */
  { id: 'enroll',      label: 'My photos' },
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

  /* ── `?tab=` WINS, AND IT IS THE WHOLE OF THE HOME-SCREEN STORY ──────────
   *
   * The paragraph above is still true for somebody opening the module from
   * the sidebar: their starred default decides. But an installed home-screen
   * icon — or the manifest shortcut, or a link in a joining email — has to be
   * able to say WHICH screen it opens, and `register` is org-admin only. An
   * employee whose whole use of this product is clocking in landed on a page
   * they cannot see.
   *
   * ⚠ VALIDATED AGAINST THE TAB IDS, never taken as given. The value comes
   * from a URL a stranger can edit, and it is used to choose what renders, so
   * it goes through the same allowlist discipline the SQL rule describes. An
   * unknown value falls through to the starred default rather than rendering
   * nothing.
   *
   * Read once, not watched: a later click sets `picked`, and re-reading the
   * query on every render would drag the user back to the link's tab.
   */
  const [fromUrl] = useState(() => {
    try {
      const want = new URLSearchParams(window.location.search).get('tab');
      return TABS.some(t => t.id === want) ? want : null;
    } catch { return null; }
  });

  const tab = picked ?? fromUrl ?? prefs.defaultTab;
  const [customize, setCustomize] = useState(false);
  const orderedTabs = prefs.order.map(id => TABS.find(t => t.id === id));
  const meta = moduleMeta('pahchan');
  return (
    <div className="ph__page">
      <ModuleHeader
        module="pahchan"
        en={meta.en}
        hi="pahchan"
        sub="Clock in from this browser or the app, and confirm here by comparing the selfie against two reference photos."
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
        {tab === 'clock' && <Clock />}
        {tab === 'register' && <Register />}
        {tab === 'corrections' && <Corrections />}
        {tab === 'payroll' && <PublishPayroll />}
        {tab === 'history' && <History />}
        {tab === 'notice' && <Notice />}
        {tab === 'consent' && <Consent />}
        {tab === 'enroll' && <Enroll />}
        {tab === 'enrollment' && <EnrollQueue />}
        {tab === 'policy' && <PahchanPolicy />}
        {tab === 'analytics' && <ModuleAnalyticsTab module="pahchan" />}
      </div>
    </div>
  );
}
