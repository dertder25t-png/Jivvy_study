// Keeps this device in step with the account. Our own changes are pushed as they happen (store.ts);
// this picks up everyone else's: when the app opens or comes back to the front, every 30 s while it's
// on screen, and as soon as the connection returns. Each check is one tiny request for the account's
// change counter — everything is downloaded again only when another device actually changed something.
import { AppState, Platform } from 'react-native';
import { store } from './store';

const POLL_MS = 30_000;
const MIN_GAP_MS = 5_000;
/** Study settings live on the account's profile; they change rarely, so they're checked less often. */
const PREFS_EVERY_MS = 5 * 60_000;

export function startAutoSync(alsoPull?: () => Promise<void>): () => void {
  let lastCheck = 0;
  let lastPrefs = 0;
  /** `returning`: the app just came back to the front (or back online) — also check the settings. */
  const check = (returning = false) => {
    if (store.mode !== 'supabase') return;
    const now = Date.now();
    if (now - lastCheck < MIN_GAP_MS) return;
    lastCheck = now;
    void store.checkForChanges();
    if (returning || now - lastPrefs >= PREFS_EVERY_MS) {
      lastPrefs = now;
      void alsoPull?.().catch(() => {});
    }
  };

  const stops: Array<() => void> = [];
  const timer = setInterval(() => {
    if (AppState.currentState === 'active') check();
  }, POLL_MS);
  stops.push(() => clearInterval(timer));

  const sub = AppState.addEventListener('change', (s) => {
    if (s === 'active') check(true);
  });
  stops.push(() => sub.remove());

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const onFocus = () => check(true);
    const onOnline = () => check(true);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    stops.push(() => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
    });
  }
  return () => stops.forEach((stop) => stop());
}
