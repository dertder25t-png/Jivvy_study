// Turns the planned (already budgeted, ≤3/day) notifications into OS-level local
// notifications. Remote push is not needed: everything is derivable on-device.
import { Platform } from 'react-native';
import type { PlannedNotification } from '@/core/notifications';

const IOS_LIMIT = 60; // iOS keeps at most 64 pending local notifications

async function mod() {
  if (Platform.OS === 'web') return null;
  return import('expo-notifications');
}

export async function ensurePermission(): Promise<boolean> {
  const N = await mod();
  if (!N) return false;
  const cur = await N.getPermissionsAsync();
  if (cur.granted) return true;
  if (!cur.canAskAgain) return false;
  return (await N.requestPermissionsAsync()).granted;
}

let lastKey = '';

/** Replace everything scheduled with the current plan (idempotent; skips if nothing changed). */
export async function syncNotifications(list: PlannedNotification[], enabled: boolean): Promise<void> {
  const N = await mod();
  if (!N) return;
  const key = enabled ? list.map((n) => `${n.id}@${n.fireAt.getTime()}`).join('|') : 'off';
  if (key === lastKey) return;
  lastKey = key;

  try {
    await N.cancelAllScheduledNotificationsAsync();
    if (!enabled) return;
    const perm = await N.getPermissionsAsync();
    if (!perm.granted) return;

    N.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false,
      }),
    });

    for (const n of list.slice(0, IOS_LIMIT)) {
      await N.scheduleNotificationAsync({
        content: { title: n.title, body: n.body, data: { href: n.href ?? '/' } },
        trigger: { type: N.SchedulableTriggerInputTypes.DATE, date: n.fireAt },
      });
    }
  } catch (e) {
    console.warn('[notifications] schedule failed', (e as Error).message);
  }
}
