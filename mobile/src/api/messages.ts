import { apiClient } from './client';

/**
 * Samvada / Sanvaad messaging.
 *
 * 17-mobile-app.md moves Messages into the fourth tab slot, ahead of Inbox,
 * because messaging is the highest-frequency mobile action. The backend surface
 * already exists in full (`backend/routers/messaging.py`); this is the mobile
 * client for it.
 *
 * Field names are the server's, snake_case, unchanged. Renaming them here would
 * mean two vocabularies for the same record and a mapping layer to keep in step.
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

export interface Message {
  id:                 string;
  channel_id:         string;
  user_id:            string;
  user_name?:         string | null;
  body:               string;
  parent_message_id?: string | null;
  thread_count?:      number;
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

  list: (channelId: string, params?: { before?: string; limit?: number }) =>
    apiClient
      .get<Message[]>(`/v1/messaging/channels/${channelId}/messages`, { params })
      .then(r => r.data),

  send: (channelId: string, body: string, parentMessageId?: string) =>
    apiClient
      .post<Message>(`/v1/messaging/channels/${channelId}/messages`, {
        body,
        parent_message_id: parentMessageId ?? null,
      })
      .then(r => r.data),

  thread: (messageId: string) =>
    apiClient.get<Message[]>(`/v1/messaging/messages/${messageId}/thread`).then(r => r.data),

  react: (messageId: string, emoji: string) =>
    apiClient.post(`/v1/messaging/messages/${messageId}/reactions`, { emoji }).then(r => r.data),

  /** Marks the channel read up to now. Called on open and on focus, not per
   *  message — the server stores a single last_read_at per member. */
  markRead: (channelId: string) =>
    apiClient.post(`/v1/messaging/channels/${channelId}/read`, {}).then(r => r.data),
};
