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
      // ── Sanvaad ───────────────────────────────────────────────────────────
      // The RN URL form is `kartavaya://sanvaad/<channelId>?message=…&thread=…`.
      // React Navigation maps the path segment onto `:channelId` and passes
      // query params it does not recognise through under their OWN names, which
      // is why `Chat`'s params are called `message` and `thread` rather than
      // messageId / threadRootId. Renaming them here would need a `parse` map
      // that nothing type-checks, and this config already fails by doing
      // nothing — see the header.
      //
      // ORDER IS LOAD-BEARING. `sanvaad/mentions` and `sanvaad/search` are
      // listed BEFORE `sanvaad/:channelId`, or the parameterised path swallows
      // them and `/sanvaad/search` opens a channel whose id is "search".
      //
      // The WEB-shaped URL the mention push carries — `/sanvaad?channel=…` —
      // does NOT come through here at all. It arrives as `data.url`, a string on
      // the notification payload, which Linking never sees. `lib/deepLink.ts`
      // parses it and `usePushNotifications` navigates. Two entry points, one
      // target.
      Mentions:   'sanvaad/mentions',
      Search:     'sanvaad/search',
      Chat:       'sanvaad/:channelId',
      // Inbox lost its tab to Messages and is now a stack screen reached from
      // More. Its link keeps working because it moved rather than disappearing —
      // push notifications already in flight point at `inbox`.
      Inbox:      'inbox',
      Reminders:  'reminders',
      Settings:   'settings',
      // The seven light module surfaces. A notification about an outstanding
      // invoice or a leave request is worth deep-linking to the surface that
      // shows it, rather than dropping the user on Today to go and find it.
      Graha:      'crm',
      Ganit:      'invoices',
      Manav:      'hr',
      Vetana:     'payslips',
      Dristi:     'analytics',
      Srijan:     'assistant',
      Prachar:    'marketing',
    },
  },
};
