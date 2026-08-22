/**
 * levels.js — the Tier-4 module ladder, mirrored from
 * `backend/middleware/role_tiers.py`, which is the source of truth.
 *
 * This is a MIRROR and is allowed to be wrong only in the safe direction: it
 * decides which levels a picker offers, never which levels are honoured. Every
 * grant is re-checked server-side by `level_satisfies()`, so a stale copy here
 * shows a control that the API then refuses — annoying, not dangerous.
 *
 * The one rule that is easy to get backwards, so it is stated twice:
 * **on Vetana and Ganit, admin does NOT satisfy approver.** Admin is breadth —
 * salary structures, chart of accounts. Approver is depth — release payments,
 * close periods. Whoever defines what people are paid must not also be the one
 * who releases the money. One person may hold both, and in a small firm often
 * must; the point is that it becomes a second, visible, audited grant rather
 * than something admin quietly includes.
 */

export const VIEWER = 'viewer';
export const EDITOR = 'editor';
export const APPROVER = 'approver';
export const ADMIN = 'admin';

/** The ladder, weakest first. */
export const LEVELS = [VIEWER, EDITOR, APPROVER, ADMIN];

/** Vetana and Ganit: approver and admin are not a hierarchy. */
export const SEPARATED_DUTY_MODULES = ['vetana', 'ganit'];

/** Nothing in these to approve. */
export const NO_APPROVER_MODULES = ['kartavya', 'dristi', 'sahayak', 'sanvaad', 'esign'];

/** Everyone in the org edits tasks, so Kartavya has no read-only rung. */
export const NO_VIEWER_MODULES = ['kartavya'];

/**
 * What a new grant starts at. NOT admin: the reason for having four levels is
 * to give narrow access to specific people, and a default of admin means every
 * grant is full control and the levels never get used.
 */
export const DEFAULT_GRANT_LEVEL = VIEWER;

export const LEVEL_LABELS = {
  viewer: 'Viewer', editor: 'Editor', approver: 'Approver', admin: 'Admin',
};

/**
 * Colour per level, as token references rather than hexes so the chips inherit
 * every contrast fix made in `00-tokens.md` §7 and flip correctly in dark mode.
 * The ramp reads as escalating authority: neutral → working → deciding →
 * configuring.
 */
export const LEVEL_COLORS = {
  viewer:   'var(--on-surface-3)',
  editor:   'var(--st-in-progress)',
  approver: 'var(--st-in-review)',
  admin:    'var(--primary-text)',
};

export const levelColor = level => LEVEL_COLORS[level] || LEVEL_COLORS.viewer;
export const levelLabel = level => LEVEL_LABELS[level] || String(level || '—');

/**
 * The levels that mean something for this module. Offering a level a module has
 * no use for invites a grant that silently does nothing — and the database
 * refuses it outright (`org_member_modules_level_is_meaningful`), so the picker
 * and the CHECK constraint have to agree.
 */
export function validLevels(moduleCode) {
  return LEVELS.filter(l => {
    if (l === APPROVER && NO_APPROVER_MODULES.includes(moduleCode)) return false;
    if (l === VIEWER && NO_VIEWER_MODULES.includes(moduleCode)) return false;
    return true;
  });
}

/** Does `held` satisfy `required` on this module? Mirrors `level_satisfies`. */
export function levelSatisfies(held, required, moduleCode) {
  if (!held || !LEVELS.includes(held) || !LEVELS.includes(required)) return false;
  if (SEPARATED_DUTY_MODULES.includes(moduleCode) && required === APPROVER) {
    return held === APPROVER;
  }
  return LEVELS.indexOf(held) >= LEVELS.indexOf(required);
}

/** True where holding admin still leaves approval out of reach. */
export const isSeparatedDuty = moduleCode => SEPARATED_DUTY_MODULES.includes(moduleCode);

/**
 * Where a NEW grant starts, per module — the mirror of
 * `role_tiers.NEW_GRANT_LEVEL_BY_MODULE` / `default_level_for()`.
 *
 * It matters now that the pickers SEND a level rather than letting the column
 * default decide. `validLevels(code)[0]` — which is what the member sheet used
 * — answers `viewer` for Sanvaad, and a Sanvaad viewer cannot post: the grant
 * would be spent and the person still could not speak in the thread they were
 * invited to. The server writes `editor` there when no level is given, and a
 * picker that quietly sends something weaker than the server's own default is a
 * downgrade nobody asked for.
 */
export const NEW_GRANT_LEVEL_BY_MODULE = { sanvaad: EDITOR };

/**
 * The level a new grant on this module starts at. Same two guards as the
 * server's: the per-module entry wins, and it is discarded if the module has no
 * use for it — `validLevels` is the same set the CHECK constraint enforces, so
 * a default outside it would create a grant the database refuses.
 */
export function defaultLevelFor(moduleCode) {
  const levels = validLevels(moduleCode);
  const wanted = NEW_GRANT_LEVEL_BY_MODULE[moduleCode] || DEFAULT_GRANT_LEVEL;
  return levels.includes(wanted) ? wanted : (levels[0] || DEFAULT_GRANT_LEVEL);
}
