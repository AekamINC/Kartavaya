// E-Sign · प्रमाण — document signing.
//
// On the shared module chrome from 13-module-pages.md §1. What this page had
// instead, all of it a private copy of something that already ships:
//
//  · a hand-rolled tab strip — 20 lines of inline style reimplementing `.mt`,
//    with no role="tablist", no aria-selected and no aria-controls, so a screen
//    reader heard two unrelated buttons rather than a tab set;
//  · a hand-rolled filter row reimplementing `Chip`, where the "chips" were
//    <button>s with no aria-pressed, so the applied filter was visible only as
//    a colour;
//  · a fifth private `Badge` with the dead `${color}18` suffix;
//  · five buttons painting `#fff` on `var(--k-primary)` (#05b7aa), which is
//    2.3:1 — `--primary` + `--on-primary` is the measured pair (00 §12);
//  · a bespoke empty block instead of `EmptyState`.
//
// The bilingual pair comes from lib/moduleColors.js, which is what the sidebar
// reads. 13 §2's table says हस्ताक्षर where the registry says प्रमाण; the
// registry wins so the nav and the page cannot disagree — see the report.
//
// SPLIT (13 §"The finding"): the list, the create form and the detail view are
// now three files under `pages/esign/`. This is the route and tab shell only.
// The detail view used to be addressed by encoding a record id into the tab
// string — `tab.startsWith('detail:')` — so `detail:xyz` was rendered by a
// branch that could never match an entry in `TABS`, and the tab strip and the
// content disagreed about which surface was open. It is separate state now.
import React, { useState, useCallback } from 'react';
import ModuleHeader from '../components/module/ModuleHeader';
import ModuleTabs from '../components/module/ModuleTabs';
import { ModuleAnalyticsTab } from './dristi/AnalyticsTab';
import Note from '../components/module/Note';
import { ICONS } from '../components/layout/navIcons';
import { moduleMeta } from '../lib/moduleColors';
import DocumentsTab from './esign/DocumentsTab';
import CreateTab from './esign/CreateTab';
import DetailTab from './esign/DetailTab';
import '../styles/documents.css';

const TABS = [
  { id: 'documents', label: 'Documents' },
  { id: 'create', label: 'New document' },
  { id: 'analytics', label: 'Analytics' },
];

export default function EsignPage() {
  const [tab, setTab] = useState('documents');
  const [openId, setOpenId] = useState(null);
  const meta = moduleMeta('esign');

  const openDoc = useCallback((id) => { setOpenId(id); setTab('documents'); }, []);
  const closeDoc = useCallback(() => setOpenId(null), []);
  const switchTab = useCallback((id) => { setOpenId(null); setTab(id); }, []);

  const panelFor = openId ? 'documents' : tab;

  return (
    <div className="docpane">
      <ModuleHeader
        module="esign"
        en={meta.en}
        hi="esign"
        sub="Send, sign and track documents"
        icon={ICONS.esign}
      />

      {/* The tab strip is hidden while a document is open: a detail view is not
          a third tab, and marking "Documents" selected while its list has been
          replaced is a lie about where you are. */}
      {!openId && (
        <ModuleTabs tabs={TABS} value={tab} onChange={switchTab} label="E-Sign sections" />
      )}

      {/* 13 §2 requires this stated ON the screen, not in help: OTP signing is
          valid under s.10A of the IT Act, and is NOT a Digital Signature
          Certificate. A user who believes they hold a DSC has been misled by
          omission, so the constraint is part of the surface. */}
      <Note>
        Signing here is an <b>electronic signature under s.10A of the Information
        Technology Act, 2000</b>, evidenced by email and OTP plus the audit trail
        on each document. It is <b>not a Digital Signature Certificate</b> —
        filings that require a DSC still require one.
      </Note>

      <div role="tabpanel" id={`mt-panel-${panelFor}`} aria-labelledby={`mt-tab-${panelFor}`}>
        {openId
          ? <DetailTab docId={openId} onBack={closeDoc} />
          : tab === 'documents'
            ? <DocumentsTab onOpen={openDoc} onCreate={() => setTab('create')} />
            : tab === 'analytics'
              ? <ModuleAnalyticsTab module="esign" />
              : <CreateTab onDone={() => setTab('documents')} onOpen={openDoc} />}
      </div>
    </div>
  );
}
