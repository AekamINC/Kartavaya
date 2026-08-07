/**
 * Window classes and pane geometry — the whole of the tablet layout's arithmetic,
 * with no React and no React Native in it.
 *
 * Source: `design-handover/31-tablet.md` §0–§3 and the prototype's own
 * implementation in `design-reference/Kartavaya Redesign/Tablet.jsx` (`tClass`)
 * and `TabletScreens.jsx` (`TApp`, lines 117–141). Where the prose and the
 * prototype disagree the prototype wins, and the two places that happens are
 * marked below.
 *
 * ── WHY THIS FILE HAS NO `react-native` IMPORT ──────────────────────────────
 *
 * Node's type-stripping does not transform JSX, so nothing that pulls in React
 * Native can be imported by `node --test` — which is why almost every guard in
 * this repo reads source files as TEXT. Text assertions cannot tell you that a
 * 744-point iPad mini gets a 280-point list rather than a 279-point one.
 *
 * So the arithmetic lives here, as pure functions over numbers, and
 * `hooks/useWindowClass.ts` is a four-line wrapper that supplies the width. The
 * split is not tidiness: it is the difference between a breakpoint table that is
 * checked and one that is asserted about.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 *
 * Read the window, never the device. Not the model, not the screen size, not the
 * orientation, not the user agent. A 13-inch iPad is 1376pt in full screen,
 * 685pt in a half Split View and 320pt in Slide Over — the same hardware, three
 * layouts, and the narrowest of the three is narrower than a Pixel 8.
 *
 * All widths are POINTS (iPadOS) or density-independent pixels (Android). A
 * physical pixel must never reach a function in this file.
 */

export type WindowClass = 'compact' | 'medium' | 'expanded' | 'large';

/** iPadOS and Android disagree on rail width and on very little else. */
export type Platform = 'ipados' | 'android';

/**
 * Four classes, matching Material's window size classes and the points at which
 * iPadOS itself changes behaviour.
 *
 * DO NOT ADD A FIFTH. Every extra breakpoint is another combination nobody
 * tests, and `15-mobile-web.md` already made this argument for the web.
 */
export function windowClass(width: number): WindowClass {
  return width < 600 ? 'compact'
    : width < 840 ? 'medium'
    : width < 1200 ? 'expanded'
    : 'large';
}

/**
 * The width the navigation takes out of the window.
 *
 * DIVERGENCE FROM THE PROTOTYPE, deliberate. `TabletScreens.jsx:124` computes
 * this as `cls === 'large' ? 280 : (os === 'ipados' ? 72 : 80)` with no compact
 * case, which is correct THERE only because `TApp` returns early for compact
 * before the value is read. Extracted into a function that anything may call,
 * that omission becomes a 72-point subtraction on a phone that has a bottom bar
 * and no rail at all. Compact returns 0.
 */
export function navWidth(cls: WindowClass, platform: Platform): number {
  if (cls === 'compact') return 0;          // bottom bar, not a rail — §2
  if (cls === 'large') return 280;          // the expanded drawer
  return platform === 'ipados' ? 72 : 80;   // the rail — §7
}

/** What is left for content once navigation has taken its share. */
export function contentWidth(width: number, platform: Platform): number {
  return width - navWidth(windowClass(width), platform);
}

/**
 * Whether list and detail sit side by side.
 *
 * THE FLOOR IS 660dp OF CONTENT, NOT A WIDTH CLASS, and the two being tied
 * together was the bug the prototype calls out at `TabletScreens.jsx:132`. Below
 * 660 the detail would be narrower than a phone; above it there is no reason to
 * do anything else — including in portrait, where an iPad Pro held upright has
 * 950dp of content, more than most laptops give a mail client.
 *
 * Two panes below the floor is worse than one: a 600dp window less an 80dp rail
 * splits into a 200dp list beside a 320dp detail. It looks like a tablet layout
 * and reads like a mistake.
 */
export const SIDE_BY_SIDE_FLOOR = 660;

export function sideBySide(content: number): boolean {
  return content >= SIDE_BY_SIDE_FLOOR;
}

/**
 * The leading pane's width: 38% of the content region, clamped to 280–400.
 *
 * Clamped at both ends for different reasons. Below 280 a task row cannot hold a
 * title, an assignee and a due date on one line; above 400 the list stops being
 * a list and starts competing with the thing it opens.
 */
export function listWidth(width: number, platform: Platform): number {
  const content = contentWidth(width, platform);
  return Math.max(280, Math.min(400, Math.round(content * 0.38)));
}

/**
 * How many columns a list of cards flows into.
 *
 * A single column of cards across 700dp is a phone layout that happens to be
 * wide — the most common way a tablet build looks unfinished. Headers, filters,
 * segmented controls and section rules keep spanning the full width; only the
 * cards flow.
 */
export function gridColumns(content: number): 1 | 2 | 3 {
  return content >= 1040 ? 3 : content >= 640 ? 2 : 1;
}

/**
 * Whether a SUPPORTING pane stacks under its leader.
 *
 * Stacking is for a supporting pane only — content that is not the detail of the
 * row above it — and Approvals is the one screen in the product that has one.
 * Do not stack a detail under its own list: a task list above a task detail
 * reads as two half-height windows rather than one surface, and the divider
 * moves every time the list length changes.
 *
 * Height, not width, decides it, because what a supporting pane needs is room
 * below the queue rather than room beside it. The prototype writes this as
 * `const tall = h > w && h >= 900; const stack = tall && !sbs ? false : tall`,
 * which reduces to `tall` — the `!sbs` arm returns `false` only when `tall` is
 * already false. Written out plainly here rather than reproduced as-is.
 */
export function stacksSupportingPane(width: number, height: number): boolean {
  return height > width && height >= 900;
}

// ── The rail fills to fit ─────────────────────────────────────────────────────

/**
 * `Tablet.jsx:86`'s constants, in dp.
 *
 * `RAIL_ITEM` is a glyph plus a label, and it is comfortably above both touch
 * floors in §4 (44pt iPadOS, 48dp Android) — which is the number that must not
 * be traded away to fit another destination in. If a window is too short, the
 * answer is More, never a smaller target.
 */
export const RAIL_ITEM   = 63;
/** The ＋ at the head of the rail. Android only: on iPadOS ＋ is a pane toolbar
 *  button, so the rail has nothing above its first destination (§7). */
export const RAIL_FAB    = 68;
/** Sync state and the avatar, pinned to the bottom. */
export const RAIL_FOOTER = 78;
/** The three rules that separate the four groups. */
export const RAIL_RULES  = 30;

/**
 * How many destinations the rail can show at this height.
 *
 * §2 gives the rail six destinations; `Tablet.jsx:25` gives it FIFTEEN and fills
 * to fit, with the remainder behind More. The prototype is the spec here
 * (the .md's own prose is the outdated half), and the behaviour it describes is
 * the better one: "on a tall tablet held upright there is no remainder, so More
 * does not appear at all."
 *
 * TAKES THE RAIL'S AVAILABLE HEIGHT, NOT THE WINDOW'S. The prototype computes
 * `h - 64 - …` because its `h` is the whole screen and 64 is the status bar it
 * drew itself. Here the caller has already subtracted the safe-area insets, so
 * subtracting a status bar again would lose a destination on every device.
 *
 * The floor of 3 is deliberate: a rail showing two things and a More is not a
 * rail, but it is still better than one that overflows its container silently.
 */
export function railSlots(availableHeight: number, platform: Platform): number {
  const fab = platform === 'android' ? RAIL_FAB : 0;
  return Math.max(3, Math.floor((availableHeight - fab - RAIL_FOOTER - RAIL_RULES) / RAIL_ITEM));
}

/**
 * Split a destination list into what the rail shows and whether More is needed.
 *
 * When it overflows, one slot goes BACK to More — otherwise the last destination
 * and the More button would compete for the same row and one of them would be
 * clipped off the bottom with nothing to indicate it.
 */
export function railItems<T>(items: T[], slots: number): { shown: T[]; overflow: boolean } {
  const overflow = slots < items.length;
  return { shown: overflow ? items.slice(0, Math.max(1, slots - 1)) : items, overflow };
}
