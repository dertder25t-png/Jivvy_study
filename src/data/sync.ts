// Keeps this device in step with the account. Our own changes are pushed as they happen (store.ts);
// this pulls everyone else's: when the app opens or comes back to the front, every so often while
// it's on screen, and as soon as the connection returns.
import { AppState, Platform } from 'react-native';
import { store } from './store';

const POLL_MS = 45_000;
const MIN_GAP_MS = 5_000;

export function startAutoSync(alsoPull?: () => Promise<void>): () => void {
  let last = 0;
  const pull = (force = false) => {
    if (store.mode !== 'supabase') return;
    if (!force && Date.now() - last < MIN_GAP_MS) return;
    last = Date.now();
    void store.refresh();
    void alsoPull?.().catch(() => {});
  };

  const stops: Array<() => void> = [];
  const timer = setInterval(() => {
    if (AppState.currentState === 'active') pull();
  }, POLL_MS);
  stops.push(() => clearInterval(timer));

  const sub = AppState.addEventListener('change', (s) => {
    if (s === 'active') pull();
  });
  stops.push(() => sub.remove());

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const onFocus = () => pull();
    const onOnline = () => pull(true);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    stops.push(() => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
    });
  }
  return () => stops.forEach((stop) => stop());
}
