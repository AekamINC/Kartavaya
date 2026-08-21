// Graha · the module's route SHELL — the page, plus the slot a record renders
// into.
//
// ── Why this file exists ────────────────────────────────────────────────────
//
// `/graha/deals/:dealId` has to leave the list where it was. `GrahaPage` holds
// the open tab, the stage filter, the no-follow-up chip and every tab's own
// state in component state — none of it in the URL — so routing the record as a
// SIBLING of the page would unmount all of it on the way in and rebuild it from
// defaults on the way back. The reader would press Back and land on the
// pipeline board they did not come from, with their filter gone.
//
// A nested route is the one arrangement that does not do that: React Router
// renders this parent ONCE and swaps only what `<Outlet/>` resolves to, so the
// page beneath the record is the same mounted component the reader left. Back
// returns them to the tab and the filters they had, because those never went
// anywhere.
//
// ── The inner Suspense is load-bearing ──────────────────────────────────────
//
// The record route is lazy, like every other page in `App.jsx`. Without a
// boundary HERE the suspension would bubble to the app-level one, which
// replaces the WHOLE tree with `PageLoader` — unmounting `GrahaPage` and losing
// exactly the state this file exists to keep. `fallback={null}` because the
// list is already on screen and is the right thing to be looking at while a
// drawer's chunk arrives; a spinner over it would be a second loading state for
// something that is not the page.
import React, { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import GrahaPage from '../GrahaPage';

export default function GrahaModule() {
  return (
    <>
      <GrahaPage />
      <Suspense fallback={null}>
        <Outlet />
      </Suspense>
    </>
  );
}
