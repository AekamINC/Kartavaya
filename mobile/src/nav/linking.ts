import type { LinkingOptions } from '@react-navigation/native';
import type { RootStackParamList } from './RootStack';

/**
 * Deep links.
 *
 * This config is only loosely type-checked — the nested `screens` map is not
 * validated against MainTabParamList — so the five-tab restructure in
 * 17-mobile-app.md silently broke it. It still routed `boards`, `inbox` and `me`
 * to tabs that no longer exist, which fails by doing nothing: the app opens on
 * Today and the link appears to have been ignored.
 *
 * Keep this in step with RootStack by hand. There is no compiler help here.
 */
export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [
    'kartavaya://',
    // Kept for links already in circulation. The canonical domain is
    // kartavaya.com; the .in host predates it and is not retired here because
    // removing a prefix breaks any link already sent to a user.
    'https://app.kartavaya.com',
    'https://app.Kartavaya.in',
  ],
  config: {
    screens: {
      Main: {
        screens: {
          Today:    'today',
          Tasks:    'tasks',
          Messages: 'messages',
          More:     'more',
        },
      },
      TaskDetail: 'task/:taskId',
      Board:      'board/:projectId',
      // Inbox lost its tab to Messages and is now a stack screen reached from
      // More. Its link keeps working because it moved rather than disappearing —
      // push notifications already in flight point at `inbox`.
      Inbox:      'inbox',
      Settings:   'settings',
    },
  },
};
