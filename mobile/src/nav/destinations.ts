/**
 * Every place the app can go, once.
 *
 * `31-tablet.md` §2: "Rail and drawer are the same destination list, the same
 * order, the same badges." They are also the same list the bottom bar and the
 * More grid already draw from — so this file is that list, and the three
 * navigations become three renderings of it rather than three copies that drift.
 *
 * ── WHY THIS MATTERS MORE THAN IT LOOKS: §2 DELETES `More` AT `large` ────────
 *
 * "More exists on a phone because five slots cannot hold twelve modules. At 1200
 * the drawer holds all of them with the content panes still intact, so the
 * compromise has nothing left to solve."
 *
 * That makes the drawer's list load-bearing in a way the phone's never was.
 * Every destination reachable only through More today becomes UNREACHABLE at
 * `large` if it is not in the drawer — silently, with no error and nothing on
 * screen to notice. With one list there is nowhere for a destination to hide:
 * `__tests__/destinations.test.ts` fails if any entry lacks a real route, and if
 * anything the More grid can reach is missing from the drawer's grouping.
 *
 * ── TWO DEPARTURES FROM THE PROTOTYPE'S `TDRAWER`, both decided ──────────────
 *
 * 1. NO eSIGN. `Tablet.jsx:64` lists `['sign', 'eSign', 'हस्ताक्षर', …]`. There
 *    is no eSign screen in this app and there will not be one — owner,
 *    2026-08-07: eSign stays on the web page, "less chance for bug and easy to
 *    fix bug no need of new app for bug fix". A web fix ships the moment it is
 *    merged; an app fix waits on a store review. So the destination is absent
 *    here rather than present-and-stubbed, and the test asserts its absence so
 *    that porting the prototype's list wholesale cannot quietly restore it.
 *
 * 2. FIVE DESTINATIONS THE PROTOTYPE'S DRAWER DOES NOT HAVE — Boards, Mentions,
 *    Reminders, Content and Marketing. All five are real, routed screens the
 *    More grid reaches today. The prototype was drawn against a smaller app; it
 *    is not an instruction to drop a screen. Since More is deleted at `large`,
 *    omitting them would delete them, so they are grouped where they belong.
 */

import type { Ionicons } from '@expo/vector-icons';

import type { Label } from '../theme/labels';
import type { RootStackParamList, MainTabParamList } from './RootStack';

type Glyph = keyof typeof Ionicons.glyphMap;

/**
 * The drawer's four groups, in order, from `Tablet.jsx:45`. A null label is a
 * group that is grouped but not titled — the rail draws a rule between them and
 * the drawer leaves the heading out, because "Work" above Today is a caption on
 * the obvious.
 */
export const GROUPS = [
  { id: 'work',       label: null,           hi: null },
  { id: 'attendance', label: 'Attendance',   hi: 'उपस्थिति' },
  { id: 'modules',    label: 'Modules',      hi: 'मॉड्यूल' },
  { id: 'system',     label: null,           hi: null },
] as const;

export type GroupId = (typeof GROUPS)[number]['id'];

/** Which counter feeds a badge. Both come off the single `/live` poll. */
export type BadgeSource = 'unread' | 'mentions';

export interface Destination extends Label {
  key:  string;
  hi:   string;
  /** Outline glyph — the More tile, the drawer row, the inactive rail item. */
  icon: Glyph;
  /** Filled glyph for the active rail item. Falls back to `icon`. */
  iconActive?: Glyph;
  /** The stack route this opens. Every destination has one; see the test. */
  route: keyof RootStackParamList;
  /** Set when the destination is a TAB inside `Main` rather than a stack screen. */
  tab?: keyof MainTabParamList;
  badge?: BadgeSource;
  /**
   * Shown by the More grid in place of navigating, when a surface is not built
   * yet. Nothing sets it today — all nineteen destinations are routed — but the
   * field stays because the grid's handling of it is the thing 17-mobile-app.md
   * asks for: tell the user where the boundary is rather than hiding the tile.
   */
  note?: string;
  /** Drawer and rail grouping — the prototype's. */
  group: GroupId;
  /**
   * Where the row sits in the PHONE's More grid, or absent if it has a tab and
   * so never appears there.
   *
   * Deliberately a second grouping rather than a reuse of `group`. The phone's
   * More screen puts Attendance and Time under different headings than the
   * drawer does, and changing that would be a redesign of a shipped phone screen
   * — which §9 is explicit is not part of this work: "No new screen components.
   * Every screen in the prototype is the phone screen from 17-mobile-app.md,
   * placed in a pane."
   */
  phoneSection?: 'work' | 'modules' | 'system';
}

export const DESTINATIONS: Destination[] = [
  // ── Work ───────────────────────────────────────────────────────────────────
  { key: 'today',    en: 'Today',    hi: 'आज',      icon: 'today-outline',       iconActive: 'today',       route: 'Main', tab: 'Today',    group: 'work' },
  { key: 'tasks',    en: 'Tasks',    hi: 'कर्तव्य',   icon: 'checkbox-outline',    iconActive: 'checkbox',    route: 'Main', tab: 'Tasks',    group: 'work' },
  { key: 'msgs',     en: 'Messages', hi: 'संवाद',    icon: 'chatbubbles-outline', iconActive: 'chatbubbles', route: 'Main', tab: 'Messages', group: 'work', badge: 'mentions' },
  { key: 'boards',   en: 'Boards',   hi: 'फ़लक',     icon: 'grid-outline',        route: 'Board',     group: 'work', phoneSection: 'work' },
  { key: 'inbox',    en: 'Inbox',    hi: 'सूचना',    icon: 'notifications-outline', route: 'Inbox',   group: 'work', phoneSection: 'work', badge: 'unread' },
  { key: 'mentions', en: 'Mentions', hi: 'उल्लेख',   icon: 'at-outline',          route: 'Mentions',  group: 'work', phoneSection: 'work', badge: 'mentions' },
  { key: 'approvals',en: 'Approvals',hi: 'सम्मति',    icon: 'checkmark-circle-outline', route: 'Approvals', group: 'work', phoneSection: 'work' },

  // ── Attendance ─────────────────────────────────────────────────────────────
  // `pahchan` sits under Modules on the phone and under Attendance here, which
  // is the one place the two groupings deliberately disagree — see
  // `phoneSection` above.
  { key: 'pahchan',  en: 'Attendance', hi: 'पहचान',  icon: 'finger-print-outline', iconActive: 'finger-print', route: 'Clock', group: 'attendance', phoneSection: 'modules' },
  { key: 'time',     en: 'Time',       hi: 'काल',     icon: 'time-outline',        route: 'Time',      group: 'attendance', phoneSection: 'work' },
  { key: 'reminders',en: 'Reminders',  hi: 'स्मरण',   icon: 'alarm-outline',       route: 'Reminders', group: 'attendance', phoneSection: 'work' },

  // ── Modules ────────────────────────────────────────────────────────────────
  //
  // ORDER IS `MoreScreen`'s, NOT THE PROTOTYPE'S, and the difference is one row.
  // `Tablet.jsx` puts Sahayak sixth (`ai`, straight after Dristi); the shipped
  // phone grid puts it LAST, after Content and Marketing. Declaration order
  // drives all three renderings, so one of them had to give — and §9 is explicit
  // that the phone screens do not change as part of this work. The drawer takes
  // the phone's order; the prototype's module group is otherwise identical.
  { key: 'graha',   en: 'CRM',        hi: 'ग्रह',     icon: 'people-outline',      route: 'Graha',   group: 'modules', phoneSection: 'modules' },
  { key: 'ganit',   en: 'Invoicing',  hi: 'गणित',    icon: 'receipt-outline',     route: 'Ganit',   group: 'modules', phoneSection: 'modules' },
  { key: 'manav',   en: 'HR',         hi: 'मानव',    icon: 'id-card-outline',     route: 'Manav',   group: 'modules', phoneSection: 'modules' },
  { key: 'vetana',  en: 'Payslips',   hi: 'वेतन',    icon: 'cash-outline',        route: 'Vetana',  group: 'modules', phoneSection: 'modules' },
  { key: 'dristi',  en: 'Analytics',  hi: 'दृष्टि',  icon: 'stats-chart-outline', route: 'Dristi',  group: 'modules', phoneSection: 'modules' },
  // `सामग्री` — CONTENT. Never `सहायक`: two destinations behind one module gate
  // that shared a word once already, and the duplicate route name it produced
  // took the whole signed-in app down (`0e14f848`).
  { key: 'sahayak-content', en: 'Content', hi: 'सामग्री', icon: 'sparkles-outline', route: 'SahayakContent', group: 'modules', phoneSection: 'modules' },
  { key: 'prachar', en: 'Marketing',  hi: 'प्रचार',  icon: 'megaphone-outline',   route: 'Prachar', group: 'modules', phoneSection: 'modules' },
  { key: 'sahayak', en: 'Sahayak',    hi: 'सहायक',   icon: 'chatbubbles-outline', route: 'Sahayak', group: 'modules', phoneSection: 'modules' },
  // Vikray · विक्रय — Sales. APPENDED, not slotted in beside CRM and Invoicing
  // where it belongs by subject, and the reason is the rule two comments above:
  // declaration order drives all three renderings, so putting Sales third would
  // move six tiles that are already in users' hands. `__tests__/destinations.test.ts`
  // pins that order precisely so the question has to be answered on purpose.
  // Reordering the module group is a deliberate design change, not a side effect
  // of adding a module.
  //
  // `विक्रय` — SALE / selling. Not `बिक्री`, which is the same idea in everyday
  // Hindi but is not the name the product uses: the module is Vikray everywhere
  // else in this codebase, and a drawer that renames it would be a second name
  // for one destination.
  { key: 'vikray',  en: 'Sales',      hi: 'विक्रय',   icon: 'cart-outline',        iconActive: 'cart', route: 'Vikray', group: 'modules', phoneSection: 'modules' },

  // ── System ─────────────────────────────────────────────────────────────────
  { key: 'settings', en: 'Settings', hi: 'व्यवस्था', icon: 'settings-outline', route: 'Settings', group: 'system', phoneSection: 'system' },
];

/**
 * Which destination is currently open, for the rail's and drawer's selected row.
 *
 * Takes the stack route AND the nested tab, because three destinations —
 * Today, Tasks, Messages — all sit on the route `Main` and are told apart only
 * by which tab is focused. Matching on the route alone would light up Today for
 * all three.
 *
 * Returns null for a route that is not a destination at all (TaskDetail, Chat,
 * Search…). That is correct rather than a gap: pushing a task detail should not
 * un-light the list it came from, so the caller keeps the last real key.
 */
export function destinationKeyFor(route?: string, tab?: string): string | null {
  if (!route) return null;
  if (route === 'Main') {
    return DESTINATIONS.find(d => d.tab === tab)?.key ?? null;
  }
  return DESTINATIONS.find(d => !d.tab && d.route === route)?.key ?? null;
}

/**
 * Routes that own the whole window — no rail, no drawer, at any width.
 *
 * §5: "The capture screen owns the window. No rail, no drawer, no panes, in any
 * class, in either orientation — edge-to-edge under a transparent status bar
 * with light glyphs." Both of these put a camera full-bleed behind a face ring;
 * navigation chrome over that is not a smaller version of the screen, it is a
 * different screen.
 */
export const IMMERSIVE_ROUTES = new Set(['Clock', 'Enroll']);

/** The destinations in one drawer/rail group, in declaration order. */
export function inGroup(group: GroupId): Destination[] {
  return DESTINATIONS.filter(d => d.group === group);
}

/** The destinations the phone's More grid draws, in its own two sections. */
export function inPhoneSection(section: 'work' | 'modules' | 'system'): Destination[] {
  return DESTINATIONS.filter(d => d.phoneSection === section);
}

/**
 * The four routes that own a bottom-bar slot, plus More. Not derived from
 * `tab` — `Create` is a slot with no destination behind it, and `More` is a
 * destination that exists only at compact.
 */
export const BAR_TABS = ['Today', 'Tasks', 'Create', 'Messages', 'More'] as const;
