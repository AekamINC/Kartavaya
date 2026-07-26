import { apiClient } from './client';

/**
 * Samvada / Sanvaad messaging.
 *
 * 17-mobile-app.md moves Messages into the fourth tab slot, ahead of Inbox,
 * because messaging is the highest-frequency mobile action.
 *
 * Field names are the server's, snake_case, unchanged — renaming them here would
 * mean two vocabularies for the same record and a mapping layer to keep in step.
 * The types below were checked line by line against
 * `backend/routers/messaging.py`, which turned up three mismatches that made
 * this client non-functional:
 *
 *   1. SENDING WAS BROKEN. `send` posted `{ body }`, but MessageCreate
 *      (messaging.py:36) declares `content`. FastAPI rejected every send with a
 *      422 for a missing required field. The column is `content` too
 *      (messaging.py:350), so `body` was never right at any layer.
 *   2. REACTIONS WERE BROKEN. `emoji` is a QUERY parameter on the server
 *      (`emoji: str = Query(...)`, messaging.py:445), not a body field. Posting
 *      it as JSON was another 422.
 *   3. The message shape was wrong. The server selects `m.*` plus
 *      `u.full_name AS sender_name`, so a message carries `sender_id` /
 *      `sender_name` / `content` — not `user_id` / `user_name` / `body`. Every
 *      "is this mine?" check against `user_id` compared undefined to a real id
 *      and answered no.
 */

export type ChannelType = 'public' | 'private' | 'dm';

export interface Channel {
  id:            string;
  org_id:        string;
  name:          string;
  type:          ChannelType;
  topic?:        string | null;
  is_archived:   boolean;
  member_count:  number;
  /** Messages since this member's last_read_at. Top-level only — thread
   *  replies do not count, which matches how the web renders the badge. */
  unread_count:  number;
  my_last_read?: string | null;
  created_at:    string;
  updated_at:    string;
}

/** One reaction row. The server returns these aggregated per message. */
export interface Reaction {
  emoji:   string;
  user_id: string;
}

export interface Message {
  id:                 string;
  channel_id:         string;
  /** The server's column. NOT `user_id`. */
  sender_id:          string;
  /** Joined from users.full_name. May be null for a deleted account. */
  sender_name?:       string | null;
  sender_avatar?:     string | null;
  /** The server's column. NOT `body`. */
  content:            string;
  type:               string;
  parent_message_id?: string | null;
  /** Replies beneath this message. Absent on the thread endpoint. */
  thread_count?:      number;
  /** Aggregated by the list query; absent from a freshly-inserted row. */
  reactions?:         Reaction[];
  is_deleted:         boolean;
  edited_at?:         string | null;
  created_at:         string;
}

export const messagesApi = {
  channels: () =>
    apiClient.get<Channel[]>('/v1/messaging/channels').then(r => r.data),

  /** Total unread across channels — drives the tab badge. */
  unread: () =>
    apiClient.get<{ total: number }>('/v1/messaging/unread').then(r => r.data),

  /**
   * Newest first, and `before` is a MESSAGE ID used as a cursor, not a
   * timestamp — the server resolves it to that message's created_at
   * (messaging.py:301).
   */
  list: (channelId: string, params?: { before?: string; limit?: number }) =>
    apiClient
      .get<Message[]>(`/v1/messaging/channels/${channelId}/messages`, { params })
      .then(r => r.data),

  send: (channelId: string, content: string, parentMessageId?: string) =>
    apiClient
      .post<Message>(`/v1/messaging/channels/${channelId}/messages`, {
        content,
        type: 'text',
        parent_message_id: parentMessageId ?? null,
      })
      .then(r => r.data),

  edit: (messageId: string, content: string) =>
    apiClient.patch<Message>(`/v1/messaging/messages/${messageId}`, { content }).then(r => r.data),

  remove: (messageId: string) =>
    apiClient.delete(`/v1/messaging/messages/${messageId}`).then(r => r.data),

  thread: (messageId: string) =>
    apiClient.get<Message[]>(`/v1/messaging/messages/${messageId}/thread`).then(r => r.data),

  /** `emoji` goes in the query string, not the body — see the note above. */
  react: (messageId: string, emoji: string) =>
    apiClient
      .post(`/v1/messaging/messages/${messageId}/reactions`, null, { params: { emoji } })
      .then(r => r.data),

  unreact: (messageId: string, emoji: string) =>
    apiClient
      .delete(`/v1/messaging/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`)
      .then(r => r.data),

  /** Marks the channel read up to now. Called on open and on focus, not per
   *  message — the server stores a single last_read_at per member. */
  markRead: (channelId: string) =>
    apiClient.post(`/v1/messaging/channels/${channelId}/read`, {}).then(r => r.data),
};
