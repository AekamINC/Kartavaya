import React from "react";
import BrandLoader from "./BrandLoader";

/**
 * The Suspense fallback for every lazy route.
 *
 * This used to be the word "Loading…" in 13px --ink-3 at 50% opacity. See
 * BrandLoader for why it is now the brand mark drawing itself instead — the
 * short version is that this is the only moment the mark gets a whole screen,
 * and in the APK it is the first thing that appears after the splash.
 */
export default function PageLoader() {
  return <BrandLoader />;
}
