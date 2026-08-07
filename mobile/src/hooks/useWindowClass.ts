/**
 * The window class, live.
 *
 * `useWindowDimensions()` and NEVER `Dimensions.get('window')`. The first
 * re-renders on resize; the second freezes at launch and is the single most
 * common tablet bug in the ecosystem — an app that was 1376pt when it started
 * and is 320pt now, still drawing the layout it was born with.
 *
 * `mobile/src` currently contains ZERO calls to `Dimensions.get(`, which is
 * acceptance test 3 in `31-tablet.md` §10 and is the one piece of good news the
 * spec did not expect. Keep it that way: the whole of §6 — resize is a resize,
 * not a remount; nothing is lost; the detail pane becomes the full window with
 * the same record still selected — rests on the width being a live value.
 *
 * All arithmetic is in `lib/windowClass.ts`, which imports nothing and is unit
 * tested against the real device table. This file exists only to supply the
 * width, and is deliberately too small to hold a decision.
 */

import { useWindowDimensions } from 'react-native';

import {
  windowClass, navWidth, contentWidth, sideBySide, listWidth, gridColumns,
  stacksSupportingPane,
  type Platform, type WindowClass,
} from '../lib/windowClass';

export type { WindowClass, Platform };

export interface WindowLayout {
  /** Live window width in points / dp. */
  width:     number;
  /** Live window height in points / dp. */
  height:    number;
  /** compact · medium · expanded · large. */
  cls:       WindowClass;
  /** What the rail or drawer takes; 0 at compact, which has a bottom bar. */
  nav:       number;
  /** Window less navigation — the number every other rule is measured against. */
  content:   number;
  /** List and detail side by side. Content ≥ 660, NOT a width class. */
  split:     boolean;
  /** The leading pane: 38% of content, clamped 280–400. */
  listWidth: number;
  /** How many columns a list of cards flows into: 1, 2 or 3. */
  columns:   1 | 2 | 3;
  /** Whether a SUPPORTING pane stacks under its leader. Approvals only. */
  stacked:   boolean;
}

/**
 * Every layout decision in the tablet build reads this and nothing else.
 *
 * `platform` is passed rather than read from `Platform.OS` because the two rail
 * widths are a DESIGN difference between iPadOS and Android, not a runtime one —
 * which means it has to be settable in a test, and in the one place the app
 * renders a preview of the other platform's shell.
 */
export function useWindowClass(platform: Platform): WindowLayout {
  const { width, height } = useWindowDimensions();
  const cls     = windowClass(width);
  const content = contentWidth(width, platform);

  return {
    width,
    height,
    cls,
    nav:       navWidth(cls, platform),
    content,
    split:     sideBySide(content),
    listWidth: listWidth(width, platform),
    columns:   gridColumns(content),
    stacked:   stacksSupportingPane(width, height),
  };
}
