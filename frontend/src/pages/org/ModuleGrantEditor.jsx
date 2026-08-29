import React from 'react';
import { Checkbox } from '../../components/ui';
import { Lock } from './ModuleCard';
import { ORG_MODULES, orgModuleColor } from './catalogue';
import {
  DEFAULT_GRANT_LEVEL, defaultLevelFor, isSeparatedDuty, levelLabel, validLevels,
} from './levels';

/**
 * ModuleGrantEditor — the one grant editor, wherever a grant is decided.
 *
 * `GrantRow` lived inside `TabMembers.jsx` and served exactly one screen: the
 * sheet an admin opens on a member who has ALREADY ACCEPTED. That is the wrong
 * half of the journey to be the only one, because the grants that decide a
 * colleague's first hour are the ones attached to the INVITATION —
 * `accept_invite` writes `org_member_modules` from `invites.module_grants`, and
 * both callers were posting `{email, org_role}` and nothing else. Every invited
 * colleague therefore accepted into an org with zero grant rows, `_module_grants`
 * returned `[]`, `navConfig.js` hid every `module:` entry, and the guaranteed
 * first-run experience was core PM and nothing else — with the admin going back
 * afterwards to fix by hand what they could have said at the time.
 *
 * So the row moved here instead of being copied. It is the same control in the
 * member sheet and in both invite paths: same levels, same SENSITIVE tag, same
 * separated-duty sentence. A second editor would have been a second place for
 * the Vetana admin/approver rule to drift, and that rule is the one this product
 * cannot afford to get wrong in only one of its copies.
 *
 * ── Why this file imports org.css ───────────────────────────────────────────
 * `.ogr__*` lives in `styles/org.css`, which was imported by the two pages that
 * owned the sheet (`OrgSettingsPage`, `RolesAccessPage`). The onboarding wizard
 * imports neither, so a row rendered there would have arrived unstyled — a
 * stack of naked checkboxes on the one screen where the admin is deciding what
 * their team can reach. The import travels with the component that needs it.
 */
import '../../styles/org.css';
import { Secondary } from '../../components/Bilingual';

/** One module row: on/off, then at what level. */
export function GrantRow({ mod, grant, levelsEditable = true, onToggle, onLevel }) {
  const on = Boolean(grant);
  const level = grant?.level || defaultLevelFor(mod.code);
  const levels = validLevels(mod.code);

  return (
    <div className={`ogr__r${on ? ' on' : ''}`} style={{ '--c': orgModuleColor(mod.code) }}>
      <Checkbox
        checked={on}
        label={`${mod.label} access`}
        onChange={() => onToggle(mod.code)}
      />
      <span className="ogr__n">
        {mod.label}
        <Secondary className="ogr__hi" value={mod.hi} />
        <span className="of__h"> {mod.en}</span>
      </span>

      {mod.sensitive && <span className="omod__lock">{Lock} SENSITIVE</span>}

      <span className="ogr__lv" role="group" aria-label={`${mod.label} level`}>
        {levels.map(l => (
          <button
            key={l}
            type="button"
            className={`ogr__b${on && level === l ? ' on' : ''}`}
            disabled={!on || !levelsEditable}
            aria-pressed={on && level === l}
            onClick={() => onLevel(mod.code, l)}
          >
            {levelLabel(l)}
          </button>
        ))}
      </span>

      {/* Stated on the row it applies to, not in a footnote — and stated whether
          or not the module is currently on, because the moment it matters is
          while you are deciding to grant it, not after.

          The sentence deliberately no longer ends "grant both if one person does
          both". `staging.org_member_modules` is UNIQUE (user_id, org_id,
          module_code), so a second grant row on the same module CANNOT EXIST —
          sending admin and approver for one module in the same save violates the
          unique index. The role model allows holding both; the schema does not
          yet represent it. Promising it here would be a promise this screen
          cannot keep. See the report. */}
      {isSeparatedDuty(mod.code) && (
        <span className="ogr__note">
          <strong>Admin does not include Approver here.</strong>
          {on && (
            <> Admin is breadth — salary structures, chart of accounts. Approver is
              depth — releasing payments, closing periods. Whoever sets what people
              are paid must not also be the one who releases the money, so pick the
              one this person actually does. One grant per module is all this
              stores today.</>
          )}
        </span>
      )}
    </div>
  );
}

/**
 * The whole editor: every module the org may grant, in catalogue order.
 *
 * `codes` is the org's ACTIVE module codes, and `null` means "not looked up" —
 * the same convention `AccessMatrix` uses for the same read. Null falls back to
 * the full catalogue rather than to nothing: an editor that renders empty while
 * a subscription request is in flight reads as "this org has no modules", which
 * is the one thing it must never say by accident.
 *
 * When the codes ARE known they are a filter, not decoration.
 * `_validate_grants` REJECTS an invitation naming a module the org does not
 * subscribe to — it does not drop the module and send the rest — so offering an
 * unsubscribed module here would fail the whole invitation on save.
 */
export function ModuleGrantList({ draft, codes = null, levelsEditable = true, onToggle, onLevel }) {
  const offered = Array.isArray(codes)
    ? ORG_MODULES.filter(m => codes.includes(m.code))
    : ORG_MODULES;

  if (!offered.length) {
    return (
      <p className="of__h of__h--flush">
        No modules are active on this organisation yet, so there is nothing to
        grant. Aekam provisions modules — ask your account manager.
      </p>
    );
  }

  return (
    <div className="ogr">
      {offered.map(mod => (
        <GrantRow
          key={mod.code}
          mod={mod}
          grant={draft.find(g => g.code === mod.code)}
          levelsEditable={levelsEditable}
          onToggle={onToggle}
          onLevel={onLevel}
        />
      ))}
    </div>
  );
}

/**
 * Turn a module on or off in a draft, immutably.
 *
 * A grant starts at the level the SERVER would have chosen for that module —
 * see `defaultLevelFor`. It used to start at `validLevels(code)[0]`, which is
 * the same answer everywhere except Sanvaad, where it is `viewer` and the server
 * says `editor` because a Sanvaad viewer cannot post.
 */
export function toggleGrantIn(draft, code) {
  return draft.some(g => g.code === code)
    ? draft.filter(g => g.code !== code)
    : [...draft, { code, level: defaultLevelFor(code) }];
}

export function setLevelIn(draft, code, level) {
  return draft.map(g => (g.code === code ? { ...g, level } : g));
}

/**
 * What an invitation grants when nobody touched the picker.
 *
 * This is NOT a new policy — it is `org_members.add_member`'s own default
 * branch, mirrored so the two doors into an org agree: every active module the
 * org has, at that module's starting level, MINUS the sensitive three. Payroll,
 * personnel files and the books are granted on purpose or not at all, never by
 * omission.
 *
 * Mirrored rather than left to the server because the server only applies it on
 * the add path. An invitation carries whatever list it was created with, so
 * "nothing" here would mean the empty rail this whole change exists to end.
 *
 * `codes` null — subscription unread — yields an empty list rather than a guess.
 * Sending a module the org does not have would fail the entire invitation.
 */
export function defaultGrantsFor(codes) {
  if (!Array.isArray(codes)) return [];
  return ORG_MODULES
    .filter(m => codes.includes(m.code) && !m.sensitive)
    .map(m => ({ code: m.code, level: defaultLevelFor(m.code) }));
}

/** The wire shape both endpoints take: `[{code, role}]`. */
export function toWireGrants(draft) {
  return (draft || []).map(g => ({ code: g.code, role: g.level || DEFAULT_GRANT_LEVEL }));
}
