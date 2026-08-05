/**
 * actionConfig.js — the config vocabulary the automation BUILDER writes.
 *
 * This file exists because the builder and the engine disagreed about it, in
 * silence, for as long as the feature has shipped. AutomationsPage.jsx used to
 * fold one free-text box into a config object like this:
 *
 *     if (['post_comment','send_notification','send_email'].includes(type))
 *       cfg.message = text;
 *     else if (type === 'change_status') cfg.status = text;
 *     else cfg.value = text;
 *
 * backend/services/automation_engine.py reads `body` for post_comment,
 * `user_ids` for send_notification and assign_to, `to` for send_email, and
 * `field_id` for set_field. Five of the six never met. A `.get()` that misses
 * returns a default, the action does nothing, and the rule reports success —
 * so the page showed a rising run count on rules that had never once done
 * their job. Two of them were worse than inert: `assign_to` overwrote
 * `assignee_user_ids` with the empty list it defaulted to, unassigning
 * everyone on the task, and `post_comment` inserted an empty comment.
 *
 * The keys below are the ENGINE's, and that direction was chosen after
 * counting rows: `public.automations` held 0 rows, so no stored rule was going
 * to be orphaned either way, and the engine's vocabulary is the one that can
 * express the actions at all (a notification needs recipients, a field needs
 * an id AND a value — neither fits in one string, whatever it is called).
 *
 * Keep this as a plain declarative table. backend/tests/test_automation_config_parity.py
 * parses it as text and compares it against the `cfg.get(...)` calls in the
 * engine, which is the check that would have caught the original bug.
 */

/** Every config key the builder may emit, per action type. Engine vocabulary. */
export const ACTION_CONFIG_KEYS = {
  send_email: ['to', 'subject', 'html'],
  send_notification: ['user_ids', 'title', 'message'],
  set_field: ['field_id', 'value'],
  change_status: ['status'],
  assign_to: ['user_ids'],
  post_comment: ['body'],
};

/**
 * Keys the engine refuses to run without. Mirrors ACTION_CONFIG[...]['required']
 * in automation_engine.py so the builder can block Create instead of saving a
 * rule that will fail on its first event.
 */
export const ACTION_REQUIRED_KEYS = {
  send_email: ['to'],
  send_notification: ['user_ids'],
  set_field: ['field_id'],
  change_status: ['status'],
  assign_to: ['user_ids'],
  post_comment: ['body'],
};

/** What each action's inputs are called on screen, for the missing-config message. */
const KEY_LABELS = {
  to: 'recipient',
  subject: 'subject',
  html: 'message',
  user_ids: 'at least one person',
  title: 'title',
  message: 'message',
  field_id: 'a field',
  value: 'a value',
  status: 'a target status',
  body: 'comment text',
};

const isBlank = (v) =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '') ||
  (Array.isArray(v) && v.length === 0);

/**
 * Pure. Builds the config object for one action from the builder's draft.
 *
 * `draft` is the page's per-action form state; only the keys this action reads
 * are consulted, and blank optional values are dropped rather than written as
 * empty strings — an empty `subject` should fall back to the engine's default,
 * not overwrite it with "".
 */
export function buildActionConfig(actionType, draft = {}) {
  const keys = ACTION_CONFIG_KEYS[actionType];
  if (!keys) return {};
  const required = ACTION_REQUIRED_KEYS[actionType] || [];
  const cfg = {};
  for (const key of keys) {
    const raw = draft[key];
    const value = typeof raw === 'string' ? raw.trim() : raw;
    // `value` on set_field is the exception: "" and 0 and false are real
    // instructions there, and the engine requires the KEY to be present even
    // when what it holds is falsy. Everything else drops when blank.
    const keepBlank = actionType === 'set_field' && key === 'value';
    if (!isBlank(value) || required.includes(key) || keepBlank) {
      cfg[key] = value === undefined ? '' : value;
    }
  }
  return cfg;
}

/**
 * Pure. Returns the human-readable reasons this config cannot run, or [].
 * Same rule as the engine's config_problems(), phrased for the person filling
 * in the form.
 */
export function configProblems(actionType, cfg = {}) {
  const required = ACTION_REQUIRED_KEYS[actionType];
  if (!required) return [`Unknown action "${actionType}"`];
  const missing = required.filter((k) => isBlank(cfg[k]));
  if (missing.length === 0) return [];
  return [`Needs ${missing.map((k) => KEY_LABELS[k] || k).join(' and ')}.`];
}

/**
 * Pure. Summarises a stored action for the rules list — the reason a rule that
 * does nothing now says so on the card instead of only in the run count.
 */
export function describeAction(action) {
  const cfg = (action && action.config) || {};
  const problems = configProblems(action && action.type, cfg);
  return { ok: problems.length === 0, problems };
}
