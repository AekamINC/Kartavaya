import { apiClient } from './client';
import type { Notification, NotifPrefsResponse } from './types';

export const notificationsApi = {
  list:        (params?: { kind?: string }) =>
    apiClient.get<Notification[]>('/notifications', { params }).then(r => r.data),

  /**
   * There is no `/notifications/unread_count`, and there never was — the helper
   * that called it sat here with zero callers while the two surfaces that show a
   * count each got it somewhere real: `NotificationContext.tsx:34` destructures
   * `unread` from `poll()`, and `InboxScreen.tsx:114` counts `!read_at` over the
   * list it already has. Removed rather than repointed at `/notifications/poll`,
   * because `poll` is not a read: `server.py:2822` processes due reminders and
   * INSERTs notification rows as a side effect, so calling it for a number would
   * mean a badge render could send a reminder.
   */
  poll: () =>
    apiClient.get<{ unread: number; fresh: import('./types').Notification[] }>('/notifications/poll').then(r => r.data),

  markRead:    (ids?: string[]) =>
    // `mark-read`, hyphenated — `server.py:2786`. The underscore spelling this
    // carried 404s, so every "mark read" tap in InboxScreen was a silent no-op
    // that the optimistic UI hid until the next refetch. The web client
    // (`NotificationContext.jsx:213,230`) always used the hyphen.
    apiClient.post('/notifications/mark-read', ids ? { notification_ids: ids } : { mark_all: true })
      .then(r => r.data),

  getPrefs:    () =>
    apiClient.get<NotifPrefsResponse>('/me/notification_prefs').then(r => r.data),

  setPrefs:    (prefs: NotifPrefsResponse) =>
    apiClient.put('/me/notification_prefs', prefs).then(r => r.data),

  registerToken: (platform: string, token: string, device_id: string) =>
    apiClient.post('/me/push_tokens', { platform, token, device_id }).then(r => r.data),

  unregisterToken: (device_id: string) =>
    apiClient.delete(`/me/push_tokens/${device_id}`).then(r => r.data),
};
