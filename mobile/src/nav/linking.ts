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
          // The optional segment is which slice — `tasks/today` opens the day.
          // Optional, so `tasks` keeps working exactly as it did.
          Tasks:    'tasks/:segment?',
          Messages: 'messages',
          More:     'more',
        },
      },
      TaskDetail: 'task/:taskId',
      // `board/<id>` opens the board; `board/<id>/Tracker` opens the tracker.
      // The view segment is optional, so every link already in circulation
      // keeps working and lands on Board exactly as before.
      Board:      'board/:projectId/:view?',
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
      /* Approvals had NO path at all until 2026-09-07 — `group: 'work'` put it
         outside the module rule `__tests__/linking.test.ts` enforces, so
         nothing was looking, and it is one of the likeliest things for a push
         to be about. The optional segment carries the tab:
         `kartavaya://approvals` opens Pending, `…/history` opens History, and
         an unknown value falls back rather than rendering nothing — the screen
         resolves it against its own allow-list. */
      Approvals:  'approvals/:tab?',
      // Inbox lost its tab to Messages and is now a stack screen reached from
      // More. Its link keeps working because it moved rather than disappearing —
      // push notifications already in flight point at `inbox`.
      Inbox:      'inbox',
      Reminders:  'reminders',
      Settings:   'settings',
      // The module surfaces. A notification about an outstanding invoice or a
      // leave request is worth deep-linking to the surface that shows it, rather
      // than dropping the user on Today to go and find it.
      //
      // EVERY destination in `destinations.ts` with `group: 'modules'` must
      // appear here, and `__tests__/linking.test.ts` fails if one does not. That
      // rule is not decoration: this map is only loosely type-checked (see the
      // header), so a module added without its line here fails by DOING NOTHING
      // — the push opens Today and the link looks ignored. Both `Vikray` and
      // `SahayakContent` shipped without a path exactly that way.
      //
      // Paths are the ENGLISH domain word, not the Sanskrit route name, because
      // a link is read by a person before it is handled by a router.
      Graha:      'crm',
      Ganit:      'invoices',
      Manav:      'hr',
      Vetana:     'payslips',
      Dristi:     'analytics',
      Sahayak:    'assistant',
      // Sahayak · सामग्री — the content half. A SEPARATE route from `Sahayak`
      // (two Stack.Screens under one name take the signed-in app down), so it
      // needs a separate path; `assistant` would resolve to the chat half.
      SahayakContent: 'content',
      Prachar:    'marketing',
      // Vikray · विक्रय — Sales. Added tonight with a route, a screen and a
      // More tile, and no deep link, which is the gap the test above now closes.
      // The optional segment is the tab — `sales/stock` opens Stock. The ORDER
      // itself is still unaddressable: it presents as a sheet rather than a
      // route (see RootStack's note), so this is as deep as a link goes here.
      Vikray:     'sales/:tab?',
    },
  },
};
