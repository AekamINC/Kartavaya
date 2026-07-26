/**
 * usePushNotifications — Expo push token registration + tap-to-navigate.
 *
 * Call once inside InnerApp (after AuthProvider).
 * - Requests permissions on first mount when user is authenticated.
 * - Registers/refreshes token with backend via POST /me/push_tokens.
 * - Handles notification tap: navigates to TaskDetail when task_id is present.
 */
import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { MMKV } from 'react-native-mmkv';

import { useAuth } from './useAuth';
import { navigationRef } from '../nav/navigationRef';
import { apiClient } from '../api/client';
import { BRAND } from '../theme/tokens';

const storage = new MMKV({ id: 'push_tokens' });
const DEVICE_ID_KEY = 'push_device_id';

/**
 * Return a stable cryptographically-random device ID, generating and persisting
 * one in MMKV on the first call. Exported so useAuth can deregister on logout.
 */
export function getDeviceId(): string {
  let id = storage.getString(DEVICE_ID_KEY);
  if (!id) {
    id = `device_${Crypto.randomUUID()}`;
    storage.set(DEVICE_ID_KEY, id);
  }
  return id;
}

// Configure how notifications are handled while app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * Request push-notification permissions and return the Expo push token.
 * Returns null on simulators, physical devices without permission, or any error.
 */
async function registerForPushNotificationsAsync(): Promise<string | null> {
  // Expo Go / simulators don't support push
  if (!Constants.isDevice) return null;

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') return null;

    // Android requires a notification channel.
    //
    // `lightColor` was '#0082C6' — the brand blue that 00 §9 retired. It is the
    // notification LED and the accent Android tints the small icon with, and it
    // already disagreed with app.json's expo-notifications `color: '#05b7aa'`,
    // so the same notification arrived blue-lit and teal-iconed. Taking it from
    // BRAND means the two cannot drift again.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: BRAND.teal,
      });
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;
    const tokenData = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    return tokenData.data;
  } catch {
    // Non-fatal — emulators and dev clients without Firebase will land here
    return null;
  }
}

/**
 * React hook that registers the device for Expo push notifications and wires
 * up a tap listener that navigates to TaskDetail when a notification is tapped.
 * Call once inside InnerApp after AuthProvider.
 */
export function usePushNotifications() {
  const { user } = useAuth();
  const notifListener = useRef<Notifications.Subscription>();
  const responseListener = useRef<Notifications.Subscription>();

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    (async () => {
      const token = await registerForPushNotificationsAsync();
      if (!token || cancelled) return;

      const deviceId = getDeviceId();
      const platform = Platform.OS === 'ios' ? 'ios' : 'android';

      try {
        await apiClient.post('/me/push_tokens', { token, device_id: deviceId, platform });
      } catch {
        // Non-fatal — push will just not work until next launch
      }
    })();

    // Foreground notification listener (optional — handler above shows it)
    notifListener.current = Notifications.addNotificationReceivedListener(
      (_notification) => {
        // Could update badge count here if needed
      }
    );

    // Tap listener: navigate to task when notification is tapped
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data   = response.notification.request.content.data as Record<string, unknown>;
        const taskId = data?.taskId as string | undefined;
        // Validate format before navigating — guards against crafted payloads
        const isValidId = taskId && /^[0-9a-f-]{32,36}$/i.test(taskId);
        if (isValidId && navigationRef.isReady()) {
          navigationRef.navigate('TaskDetail', { taskId });
        }
      }
    );

    return () => {
      cancelled = true;
      notifListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [user?.user_id]);  // re-register if user changes (e.g. logout → login)
}
