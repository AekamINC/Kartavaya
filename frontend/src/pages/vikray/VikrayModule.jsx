// Vikray · the module's route SHELL — the page, plus the slot a record renders
// into.
//
// The same arrangement as `graha/GrahaModule.jsx`, for the same reason.
// `VikrayPage` holds the open tab, the order status filter and the dashboard's
// drill-in target in component state; none of it is in the URL. Routing
// `/vikray/orders/:orderId` as a sibling would throw all of it away on the way
// in and rebuild it from defaults on the way back, so a salesperson who
// filtered to "Dispatched", opened an order and pressed Back would land on the
// pipeline board with no filter.
//
// A nested route keeps this parent mounted and swaps only the `<Outlet/>`, so
// the list behind the record is the same one the reader left.
//
// The inner Suspense keeps a lazy record route from suspending the app-level
// boundary, which would replace the whole tree with `PageLoader` and unmount
// the page underneath — the precise loss this file prevents. `fallback={null}`:
// the list is already on screen and is the right thing to be looking at.
import React, { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import VikrayPage from '../VikrayPage';

export default function VikrayModule() {
  return (
    <>
      <VikrayPage />
      <Suspense fallback={null}>
        <Outlet />
      </Suspense>
    </>
  );
}
