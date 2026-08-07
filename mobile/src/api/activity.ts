import { apiClient } from './client';

/**
 * The activity feed — `GET /api/activity/feed`.
 *
 * 31-tablet.md §3 gives Today a second column at `expanded` and above, holding
 * "approvals, activity and unread". Approvals and unread already have sources on
 * this platform; activity did not, and this is it.
 *
 * ── THE SHAPE IS THE SERVER'S, NOT A GUESS ──────────────────────────────────
 *
 * `backend/routers/activity.py:180` selects `ae.*` from `activity_events` plus
 * three joined names, and `_normalize` parses the `data` JSONB. So every column
 * of the table arrives, and the fields below are the ones the web's
 * `ActivityList.jsx` actually reads — `event_id`, `type`, `actor_name`,
 * `task_title`, `created_at`, `data`.
 *
 * `actor_name` is `COALESCE(full_name, name, email)` and can still be null when
 * the actor row is gone or the event had no actor. The web renders "System" for
 * that, and so does the mobile row — a deleted user is not nobody.
 *
 * ── SCOPE, which is not this file's to widen ────────────────────────────────
 *
 * The endpoint resolves visibility itself, through `get_visible_team_ids` with
 * the ACTIVE ORG. Its own docstring records that this route once held unfixed
 * twins of two org-scoping defects — an unordered `LIMIT 1` for the org and a
 * user-only team predicate that returned both orgs' events to anyone in two.
 * Nothing here should filter or re-derive that; passing a team or an org from
 * the client would be a fourth restatement of the predicate.
 */

/** The verbs the server emits. Anything unrecognised falls back at the render. */
export type ActivityType =
  | 'created' | 'status_changed' | 'assigned' | 'commented'
  | 'comment_edited' | 'comment_deleted' | 'field_changed'
  | 'approved' | 'rejected' | 'mention';

export interface ActivityEvent {
  event_id:    string;
  type:        ActivityType | string;
  /** `COALESCE(full_name, name, email)`. Null when the actor row is gone. */
  actor_name:  string | null;
  actor_id:    string | null;
  task_id:     string | null;
  /** Joined from `tasks`. Null for an event that is not about a task. */
  task_title:  string | null;
  team_name:   string | null;
  created_at:  string;
  /** The parsed JSONB payload — field diffs and the like. Shape varies by type. */
  data:        Record<string, unknown> | null;
}

export const activityApi = {
  /**
   * The newest events the caller may see.
   *
   * `limit` defaults to 6 to match the web dashboard's own call
   * (`DashboardPage.jsx`, `{limit: 6}`) — Today is a summary, and a feed long
   * enough to scroll is the Activity page's job, not a column's.
   */
  feed: (limit = 6): Promise<ActivityEvent[]> =>
    apiClient.get<ActivityEvent[]>('/activity/feed', { params: { limit } })
      .then(r => r.data),
};

/**
 * The phrase that follows the actor's name.
 *
 * Lifted from the web's `ActivityList.jsx` TYPE_META so one event does not read
 * two different ways on two platforms. The emoji do NOT come with it — this app
 * has an icon set, and 24-bilingual-devanagari.md's argument about the platform
 * substituting glyphs per-character applies to emoji as much as to Devanagari.
 */
export function activityVerb(type: string): string {
  switch (type) {
    case 'created':         return 'created this task';
    case 'status_changed':  return 'changed status';
    case 'assigned':        return 'updated assignees';
    case 'commented':       return 'commented';
    case 'comment_edited':  return 'edited a comment';
    case 'comment_deleted': return 'deleted a comment';
    case 'field_changed':   return 'updated a field';
    case 'approved':        return 'approved';
    case 'rejected':        return 'rejected';
    case 'mention':         return 'mentioned someone';
    // An unknown type is a NEW server event, not a broken one. Saying
    // "updated this" is wrong in the least harmful direction; rendering the raw
    // enum would leak `status_changed` into the interface.
    default:                return 'updated this';
  }
}

/** The glyph for an event, in this app's icon set rather than the web's emoji. */
export function activityIcon(type: string): 'add-circle-outline' | 'swap-horizontal-outline'
  | 'person-outline' | 'chatbubble-outline' | 'create-outline' | 'checkmark-circle-outline'
  | 'close-circle-outline' | 'at-outline' | 'ellipse-outline' {
  switch (type) {
    case 'created':         return 'add-circle-outline';
    case 'status_changed':  return 'swap-horizontal-outline';
    case 'assigned':        return 'person-outline';
    case 'commented':
    case 'comment_edited':
    case 'comment_deleted': return 'chatbubble-outline';
    case 'field_changed':   return 'create-outline';
    case 'approved':        return 'checkmark-circle-outline';
    case 'rejected':        return 'close-circle-outline';
    case 'mention':         return 'at-outline';
    default:                return 'ellipse-outline';
  }
}
