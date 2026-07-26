import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

/**
 * Is the device actually able to reach the network?
 *
 * Five call sites were each doing their own `NetInfo.fetch()` with their own
 * idea of what "online" means. `useOfflineMutation`, `NewTaskSheet` and `App`
 * all wrote the same expression by hand:
 *
 *     !!(state.isConnected && state.isInternetReachable !== false)
 *
 * The `!== false` is the load-bearing part and the easiest to get wrong.
 * `isInternetReachable` is `null` while the probe is still in flight, and a
 * plain truthiness test reads that null as offline — so for the first second
 * after a cold start every screen would claim the device has no connection and
 * every mutation would queue instead of firing. Treating only an explicit
 * `false` as offline gives the probe time to answer.
 *
 * This hook is the read-only half: it tells a SCREEN whether to render its
 * offline state. Mutations keep using `useOfflineMutation`, which re-checks at
 * the moment of the write rather than trusting a subscription that may be a
 * render behind.
 *
 * Starts optimistic. A false "you are offline" on a working connection is the
 * worse error of the two: it makes a screen that would have loaded fine show a
 * dead end, and unlike the reverse it does not correct itself visibly.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let alive = true;
    const apply = (state: { isConnected: boolean | null; isInternetReachable: boolean | null }) => {
      if (!alive) return;
      setOnline(!!(state.isConnected && state.isInternetReachable !== false));
    };

    // Subscribing does not give you the current value, only the next change, so
    // a device that is already offline when the screen mounts would render as
    // online until connectivity happened to change.
    NetInfo.fetch().then(apply).catch(() => {/* keep the optimistic default */});
    const unsub = NetInfo.addEventListener(apply);

    return () => { alive = false; unsub(); };
  }, []);

  return online;
}
