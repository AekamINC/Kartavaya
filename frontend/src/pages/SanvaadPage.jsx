/**
 * SanvaadPage.jsx — Sanvaad · संवाद (messaging) and WhatsApp · वार्ता.
 *
 * Implements `design-handover/06-sanvaad-varta.md`. The page was one 28 KB file
 * holding `SanvaadPage`, `ChannelsTab`, `ChatView`, `WhatsAppTab`, `WAChat` and
 * `StatusBadge`; it is now the shell only, with the tree in `pages/sanvaad/`.
 *
 * Two of the handover's defects did not survive contact with the branch and are
 * recorded here so the next reader does not "fix" them again:
 *
 *   · **`addToast` (§0, listed as the file's ship-blocker).** There is no
 *     `addToast` anywhere in `frontend/src` — this file already destructured
 *     `pushToast` in all three places and called it with the object signature.
 *   · **"Scrollback is `#94a3b8` on `#0f172a`, 2.9:1" (§1 / defect table 2).**
 *     Neither hex appeared in this file. It carried exactly four literals —
 *     three `#fff` and `#4FC3F7`, the correct WhatsApp read tick — and all text
 *     read from tokens. `#94a3b8` lives in `.k-bcol--requested` in
 *     `editorial.css`, which is the board column header, a different surface.
 *
 * A third was half-stale: the unconditional `scrollIntoView` had already been
 * made conditional, but it measured after the DOM had grown. See
 * `sanvaad/useStickyScroll.js`.
 *
 * `StatusBadge` — the fifth independent status-colour map in the codebase — is
 * gone; `ui/StatusChip.jsx` renders those states now.
 */
import React from 'react';
import { PageHeader } from '../components/editorial';
import { Tabs } from '../components/ui';
import ChannelsTab from './sanvaad/ChannelsTab';
import WhatsAppTab from './sanvaad/varta/WhatsAppTab';

/**
 * `06`: "the WhatsApp surface is labelled **WhatsApp** with **वार्ता / Varta** as
 * subtext, everywhere it appears… WhatsApp is what a user is looking for; Varta
 * is the internal module name and rides beneath it." Same weighting as
 * `01-navigation.md`: the recognised word carries the hierarchy.
 */
const TABS = [
  {
    value: 'channels',
    label: <>Channels <span className="sv__hi" lang="hi">चैनल</span></>,
    content: <ChannelsTab />,
  },
  {
    value: 'whatsapp',
    label: <>WhatsApp <span className="sv__hi" lang="hi">वार्ता</span></>,
    content: <WhatsAppTab />,
  },
];

export default function SanvaadPage() {
  return (
    <div className="k-screen">
      <PageHeader
        title="Messages"
        sanskrit="संवाद"
        lede="Internal channels and WhatsApp, in one place"
      />
      <Tabs tabs={TABS} defaultTab="channels" />
    </div>
  );
}
