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
import MessagingTabs from './sanvaad/MessagingTabs';

/**
 * `k-surface-theme` — the scoped Slate / indigo palette from
 * `styles/surface-theme.css`.
 *
 * SCOPED TO SANVAAD AND SAHAYAK ONLY. The owner approved a different ground for
 * those two surfaces and corrected an earlier "whole product" instruction to
 * "just Sahayak internally"; the rest of Kartavaya stays on the warm cream
 * palette. That is why it is a class you opt into rather than a `:root` block —
 * a `:root` block would be the whole product by construction, which is the thing
 * that was explicitly rejected.
 *
 * ON THE PAGE WRAPPER AND NOT ON `.sv`, so the ground reaches the page header
 * and the tab strip as well as the chat shell. Custom properties inherit, so one
 * class on the outermost element is the whole of it. Put on `.sv` instead, the
 * shell would be indigo inside a cream frame, with a hard seam a pixel outside
 * its own border — which is worse than either palette used consistently.
 *
 * IT COVERS THE WHATSAPP TAB TOO, because that tab is inside this page and the
 * seam argument does not stop being true when the second tab is selected. Varta
 * reads its colour from the same product tokens (`--surface`, `--s-container`,
 * `--primary-container`) plus the two fixed WhatsApp literals, which do not
 * flip — so it follows this ground with no change to any file under
 * `pages/sanvaad/varta/`.
 */
/**
 * `k-screen--boards` AND `k-screen`, which is the height source `.m2mod` needs.
 *
 * `.m2mod` is `height: 100%`, and `.k-screen` is a flex column with no height at
 * all — a percentage height against an auto-height parent resolves to auto, so
 * the module would collapse to its content and the log would grow the page
 * instead of scrolling inside itself. `.k-screen--boards` is the existing
 * precedent for exactly this (`height: 100%; overflow: hidden`) and is reused
 * rather than a new modifier being invented for the same job.
 */
export default function SanvaadPage() {
  return (
    <div className="k-screen k-screen--boards k-surface-theme">
      <PageHeader
        title="Messages"
        sanskrit="संवाद"
        lede="Internal channels and WhatsApp, in one place"
      />
      <MessagingTabs />
    </div>
  );
}
