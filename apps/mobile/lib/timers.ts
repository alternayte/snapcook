import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Platform } from "react-native";

type Timer = { endsAt: number; notification?: string };

const STORE_KEY = "timers";
const TICK_MS = 500;

// Timers live outside any screen, so they keep running when the cook looks at something else.
let timers: Record<string, Timer> = {};
const listeners = new Set<() => void>();

function publish(next: Record<string, Timer>) {
  timers = next;
  for (const listener of listeners) listener();
  AsyncStorage.setItem(STORE_KEY, JSON.stringify(next)).catch(() => {});
}

// A timer started before the app was closed is still running when it opens again.
AsyncStorage.getItem(STORE_KEY)
  .then((stored) => {
    if (stored) publish({ ...(JSON.parse(stored) as Record<string, Timer>), ...timers });
  })
  .catch(() => {});

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** Starts a countdown. On a phone it also rings when the time is up, even with the screen locked. */
export async function startTimer(key: string, minutes: number, message: string) {
  const seconds = Math.round(minutes * 60);
  let notification: string | undefined;
  if (Platform.OS !== "web") {
    const { granted } = await Notifications.requestPermissionsAsync();
    if (granted) {
      notification = await Notifications.scheduleNotificationAsync({
        content: { title: message, sound: true },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds },
      });
    }
  }
  publish({ ...timers, [key]: { endsAt: Date.now() + seconds * 1000, notification } });
}

export function stopTimer(key: string) {
  const { [key]: stopped, ...rest } = timers;
  if (stopped?.notification) {
    Notifications.cancelScheduledNotificationAsync(stopped.notification).catch(() => {});
  }
  publish(rest);
}

/** Seconds left on a timer, null when it is not running, 0 when its time is up. */
export function useTimer(key: string) {
  const timer = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => timers[key],
    () => undefined,
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!timer) return;
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(tick);
  }, [timer]);
  return timer ? Math.max(0, Math.ceil((timer.endsAt - now) / 1000)) : null;
}
