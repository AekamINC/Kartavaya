import { Platform as RNPlatform } from 'react-native';

import type { Platform } from '../lib/windowClass';

/**
 * iPadOS or Android, for 31-tablet.md §7's per-platform navigation.
 *
 * ── WHY THIS IS ITS OWN MODULE ──────────────────────────────────────────────
 *
 * It began life inside `RootStack.tsx`, which is the right place for the shell
 * to read it — but `RootStack` imports every screen, so a screen importing it
 * back is a cycle. Metro resolves cycles by handing one side a partially
 * initialised module, which fails as an `undefined is not a function` at some
 * unrelated call site later in startup.
 *
 * ── WHY IT IS A FUNCTION AND NOT A CONSTANT ─────────────────────────────────
 *
 * So it can be overridden. §7's differences — a 72 rail against an 80 one, a
 * tinted glyph against a Material pill, a toolbar ＋ against a FAB — are DESIGN
 * decisions about two platforms rather than runtime facts, which means every
 * component that acts on them takes `platform` as a prop. This is only the
 * default, read once at the top of a tree.
 */
export function devicePlatform(): Platform {
  return RNPlatform.OS === 'ios' ? 'ipados' : 'android';
}
