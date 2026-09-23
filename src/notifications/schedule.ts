// Turns the planned (already budgeted, ≤3/day) notifications into OS-level local
// notifications. Remote push is not needed: everything is derivable on-device.
// On the web, a page can only show notifications while it's open in a tab, so timers stand in
// for scheduled ones there.
import { Platform } from 'react-native';
import type { PlannedNotification } from '@/core/notifications';

const IOS_LIMIT = 60; // iOS keeps at most 64 pending local notifications
/** A web reminder whose moment passed while the tab was asleep is dropped rather than shown late. */
const WEB_LATE_MS = 30 * 60_000;
const MAX_TIMER_MS = 2 ** 31 - 1;

async function mod() {
  if (Platform.OS === 'web') return null;
  return import('expo-notifications');
}

const webSupported = () => Platform.OS === 'web' && typeof window !== 'undefined' && 'Notification' in window;

/** 'granted' | 'denied' | 'default' (not asked yet) | 'unsupported'. */
export function webPermission(): NotificationPermission | 'unsupported' {
  return webSupported() ? Notification.permission : 'unsupported';
}

export async function ensurePermission(): Promise<boolean> {
  if (Platform.OS === 'web') {
    if (!webSupported()) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    return (await Notification.requestPermission()) === 'granted';
  }
  const N = await mod();
  if (!N) return false;
  const cur = await N.getPermissionsAsync();
  if (cur.granted) return true;
  if (!cur.canAskAgain) return false;
  return (await N.requestPermissionsAsync()).granted;
}

let lastKey = '';
let webTimers: Array<ReturnType<typeof setTimeout>> = [];

function scheduleWeb(list: PlannedNotification[]) {
  webTimers.forEach(clearTimeout);
  webTimers = [];
  const now = Date.now();
  for (const n of list) {
    const delay = n.fireAt.getTime() - now;
    if (delay <= 0 || delay > MAX_TIMER_MS) continue;
    webTimers.push(
      setTimeout(() => {
        if (Date.now() - n.fireAt.getTime() > WEB_LATE_MS || Notification.permission !== 'granted') return;
        try {
          const shown = new Notification(n.title, { body: n.body, tag: n.id, icon: '/icon-192.png' });
          shown.onclick = () => {
            window.focus();
            shown.close();
          };
        } catch {
          /* some browsers only allow notifications from a service worker */
        }
      }, delay),
    );
  }
}

/** Replace everything scheduled with the current plan (idempotent; skips if nothing changed). */
export async function syncNotifications(list: PlannedNotification[], enabled: boolean): Promise<void> {
  if (Platform.OS === 'web') {
    const allowed = enabled && webPermission() === 'granted';
    const key = allowed ? `web|${list.map((n) => `${n.id}@${n.fireAt.getTime()}`).join('|')}` : 'off';
    if (key === lastKey) return;
    lastKey = key;
    if (allowed) scheduleWeb(list);
    else scheduleWeb([]);
    return;
  }

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
