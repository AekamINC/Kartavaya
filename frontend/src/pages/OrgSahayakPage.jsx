// Sahayak · सहायक — the org's own AI workspace. Route shell.
//
// (`sahayak` stays the module CODE, the route and the stylesheet prefix. The
// owner asked for that explicitly: the rename is what a user reads, not what
// the codebase calls things. `moduleColors.js` already resolves the code to
// en: 'Sahayak' / hi: 'सहायक', so the header has read correctly for a while.)
//
// This file was 1,291 lines carrying 241 inline styles with all six tabs inside
// it. Per 13-module-pages.md a module page is a route file plus a directory of
// tab components, split BEFORE styling: a restyle of a single-file module
// touches every tab, table and form at once and the diff is unreviewable.
//
// ── Figures first ────────────────────────────────────────────────────────────
//
// The rendered reference (`design-reference/Kartavaya Redesign/ScreensMore.jsx`,
// `ScreenSahayak`) puts four figures ABOVE the tab strip and only then the tabs.
// The build had a row of `StatTile`s that showed `–` on failure and `0` on a
// missing field — indistinguishable, and one of them means "you have no credits"
// while the other means "we do not know". They are now a `KpiStrip`, which has a
// failure state of its own and says which it is.
import React, { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import ModuleHeader from '../components/module/ModuleHeader';
import ModuleTabs from '../components/module/ModuleTabs';
import KpiStrip from '../components/module/KpiStrip';
import { ICONS } from '../components/layout/navIcons';
import { moduleMeta } from '../lib/moduleColors';
import useTabPanelMotion from '../lib/tabPanelMotion';
import { api } from '../lib/api';
import { currentUser } from '../lib/auth';
import { errText } from './hub/_shared';

import { canManageSkills } from './admin/platformRoles';

import SahayakTab from './sahayak/SahayakTab';
import SkillsTab from './sahayak/SkillsTab';
import ContentTab from './sahayak/ContentTab';
import GenerateTab from './sahayak/GenerateTab';
import DataCatalogTab from './sahayak/DataCatalogTab';
import DataRunsTab from './sahayak/DataRunsTab';
import CreditsTab from './sahayak/CreditsTab';

/**
 * Tab order. The last five are verbatim from `Data.jsx:130` MODULE_TABS.sahayak;
 * `sahayak` is new and is first.
 *
 * ── The assistant was not on this list, and that was the bigger bug ──────────
 *
 * The chatbot is built, metered, grounded and billed. `routers/hub_chat.py` has
 * charged `channel/chatbot_message` for every answer since 2026-08-04. The only
 * screen that rendered a conversation was `pages/hub/ChatTab.jsx`, which is the
 * AGENCY-side per-client view and requires a client chosen from a directory a
 * client org does not have. So an org signed into Kartavaya could not reach its
 * own assistant at all — a finished backend and a finished screen with nothing
 * joining them, which is the sixth time this codebase has done that.
 *
 * ── Why it is first, and why it is the default ──────────────────────────────
 *
 * Because it is the product. This module is named Sahayak — `moduleColors.js`
 * has resolved `sahayak` to en: 'Sahayak' since the rename — and landing on a
 * skill-pack list is landing on the plumbing. Making it first without making it
 * the default would also leave the strip disagreeing with itself: the first tab
 * would not be the one you get.
 *
 * The cost is that `/hub/org` with no `?tab=` now opens somewhere new for
 * people who had learnt it opens on Skills. Every existing deep link keeps
 * working — `?tab=skills` is still `skills` — and DEFAULT_TAB below is the one
 * place to change if the owner wants the old landing back.
 */
const TABS = ['sahayak', 'skills', 'content', 'generate', 'data catalog', 'data runs', 'credits'];

/** The tab a bare `/hub/org` opens on, and the one that needs no `?tab=`. */
const DEFAULT_TAB = TABS[0];

/**
 * `?tab=` aliases. The command palette links here as `/hub/org?tab=scrapers`
 * (`lib/commands.js`) — "scrapers" is the vocabulary of the ROUTER
 * (`routers/scrapers.py`) and of `20-search-palette.md` §3, while this page
 * calls the same feature "data catalog". Accepting both keeps the palette entry
 * honest without renaming a tab users already read.
 */
const TAB_ALIASES = {
  scrapers: 'data catalog',
  'data-catalog': 'data catalog',
  'data-runs': 'data runs',
  runs: 'data runs',
  // The assistant answers to the three words a person would try. `assistant`
  // and `chat` are what anyone linking to it from outside this page will guess,
  // and `chat` is what the agency-side tab is called — the same feature under
  // the name the rest of the codebase uses for it.
  assistant: 'sahayak',
  chat: 'sahayak',
};

function resolveTab(raw) {
  if (!raw) return null;
  const key = String(raw).toLowerCase();
  const resolved = TAB_ALIASES[key] || key;
  return TABS.includes(resolved) ? resolved : null;
}

export default function OrgSahayakPage() {
  const me = currentUser();
  const meta = moduleMeta('sahayak');
  const [params, setParams] = useSearchParams();
  // Read once for the initial value: after mount the tab buttons own the state,
  // so a later param change must not yank the user off the tab they just clicked.
  const [tab, setTab] = useState(() => resolveTab(params.get('tab')) || DEFAULT_TAB);
  const [pendingRunId, setPendingRunId] = useState(null);

  const [credits, setCredits] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // `key` is destructured out rather than spread: React 19 does not see a key
  // that arrives through a spread, and the remount is the whole mechanism —
  // without it the panel's entrance animation never restarts.
  const { key: panelKey, ...motion } = useTabPanelMotion(TABS, tab);

  const canAssign = canManageSkills(me);

  const loadCredits = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await api.get('/v1/hub/org/credits');
      setCredits(r.data);
    } catch (err) {
      setCredits(null);
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadCredits(); }, [loadCredits]);

  /* Keep the URL truthful so the tab stays shareable and survives a refresh.
     `replace` rather than push: six tabs behind a Back button that only undoes
     tab clicks is not history anyone wants. */
  const selectTab = useCallback((t) => {
    setTab(t);
    setParams(t === DEFAULT_TAB ? {} : { tab: t }, { replace: true });
  }, [setParams]);

  const org = credits?.org_balance || {};
  // `user_allocation` is null when no allocation row exists, which is not the
  // same as an allocation of zero: without a row the server applies no personal
  // cap at all and the run comes out of the org pool.
  const you = credits?.user_allocation || null;
  const capped = !!you;
  const plan = org.plan_credits ?? 0;
  // `org.balance`, not `plan - used`. This screen recomputed the balance a
  // SECOND time from the month's usage, on top of a reply that was already
  // inventing it the same way — and neither number was the one the server
  // refuses against. Measured 2026-07-29: this strip read 744 while the wallet
  // held 324. The balance is a fact the server keeps; reading it is the whole
  // job here.
  const orgLeft = org.balance;
  const yourLeft = capped ? (you.allocated ?? 0) - (you.used ?? 0) : orgLeft;

  const kpi = credits ? [
    {
      label: 'Org balance', hi: 'संस्था', tone: 'p',
      value: orgLeft ?? '—',
      // "of 1000 this month" claimed balance + used adds up to the plan. It does
      // not: the balance carries whatever was left when the month turned, and
      // the plan is what the reset tops it back up to.
      sub: plan > 0 ? `plan gives ${plan} a month` : 'no plan allocation',
    },
    {
      label: 'Used this month', hi: 'प्रयोग',
      value: org.used ?? 0,
      sub: 'across the whole organisation',
    },
    {
      label: 'Your allocation', hi: 'आवंटन',
      value: capped ? you.allocated : '—',
      sub: capped ? 'set by an org admin' : 'no personal cap set',
    },
    {
      label: 'You have left', hi: 'शेष',
      tone: yourLeft <= 0 ? 'warn' : 'ok',
      value: yourLeft ?? '—',
      // "ask an admin to raise it" was printed to everyone with no allocation
      // row — advice to fix something that is not broken, beside a zero that
      // was not their balance.
      sub: !capped ? 'you spend from the org pool'
        : yourLeft <= 0 ? 'ask an admin to raise it' : 'available to spend',
    },
  ] : null;

  const costs = credits?.credit_costs || null;

  return (
    <div className="sr-page">
      {/* The old sub-line described the Skills tab and nothing else, which was
          accurate while Skills was where this page opened. It is now the second
          of seven. */}
      <ModuleHeader
        module="sahayak"
        kick="section.growth"
        en={meta.en}
        hi="sahayak"
        sub="Ask Sahayak about your own work, or run a skill against your own data. Every answer and every run says what it touched and what it spent."
        icon={ICONS.hub}
      />

      <KpiStrip items={kpi} loading={loading} error={error} count={4} />

      <ModuleTabs
        tabs={TABS.map(id => ({ id }))}
        value={tab}
        onChange={selectTab}
        label="Sahayak sections"
      />

      <div
        key={panelKey}
        role="tabpanel"
        id={`mt-panel-${tab}`}
        aria-labelledby={`mt-tab-${tab}`}
        className="ix-panel"
        {...motion}
      >
        {/* `onSpent` reloads the credit strip above. An answer is charged as
            `channel/chatbot_message` in the same transaction that stores the
            question, so the balance printed at the top of this page is stale
            the moment a reply lands unless it is asked again. */}
        {tab === 'sahayak' && <SahayakTab onSpent={loadCredits} />}
        {tab === 'skills' && <SkillsTab canAssign={canAssign} costs={costs} onSpent={loadCredits} />}
        {tab === 'content' && <ContentTab />}
        {tab === 'generate' && <GenerateTab credits={credits} costs={costs} onSpent={loadCredits} />}
        {tab === 'data catalog' && (
          <DataCatalogTab
            onSpent={loadCredits}
            onViewRun={id => { setPendingRunId(id); selectTab('data runs'); }}
          />
        )}
        {tab === 'data runs' && (
          <DataRunsTab initialRunId={pendingRunId} onConsumeInitial={() => setPendingRunId(null)} />
        )}
        {tab === 'credits' && (
          <CreditsTab credits={credits} loading={loading} error={error} onRetry={loadCredits} />
        )}
      </div>
    </div>
  );
}
