import { store } from './store';
import { asyncOutbox, createLocalBackend, createSupabaseBackend } from './backends';
import { getSupabase, isSupabaseConfigured } from './supabase';
import { deviceId, prefs } from './prefs';
import { pullPrefs, watchPrefs } from './prefsSync';
import { restartApp } from './session';
import { shouldShowComeback } from '@/core/triage';

export type BootState =
  | { status: 'ready'; comeback: boolean }
  | { status: 'needs_auth' }
  | { status: 'error'; message: string };

/**
 * Starts the app: load device prefs, pick a backend, hydrate the store.
 *   signed in                      → Supabase (synced to the account)
 *   not signed in + "guest" chosen → this device only
 *   not signed in, backend exists  → show the sign-in screen
 *   no backend configured at all   → this device only (demo mode)
 * A real session always wins over the guest flag.
 */
let stopPrefsWatch: (() => void) | null = null;

export async function boot(): Promise<BootState> {
  stopPrefsWatch?.();
  stopPrefsWatch = null;
  try {
    await prefs.load();
    const previous = prefs.get().lastOpenedAt;
    const now = new Date();

    if (isSupabaseConfigured) {
      const sb = getSupabase();
      const { data } = await sb.auth.getSession();
      const user = data.session?.user;
      if (user) {
        if (prefs.get().guest) prefs.set({ guest: false });
        const name = (user.user_metadata as { full_name?: string } | undefined)?.full_name;
        if (name && !prefs.get().studentName) prefs.set({ studentName: name });
        await Promise.all([
          store.init(createSupabaseBackend(sb, user.id, deviceId()), asyncOutbox(`studyapp.outbox.${user.id}`)),
          pullPrefs(sb), // study settings made on another device
        ]);
        stopPrefsWatch = watchPrefs(sb);
      } else if (prefs.get().guest) {
        await store.init(createLocalBackend());
      } else {
        return { status: 'needs_auth' };
      }
    } else {
      await store.init(createLocalBackend());
    }

    const comeback = shouldShowComeback(previous ? new Date(previous) : null, now);
    prefs.set({ lastOpenedAt: now.toISOString() });
    return { status: 'ready', comeback };
  } catch (e) {
    return { status: 'error', message: (e as Error).message ?? 'Something went wrong starting the app.' };
  }
}

export async function signOut() {
  if (isSupabaseConfigured) {
    try {
      await getSupabase().auth.signOut();
    } catch {
      /* offline: still sign out locally below */
    }
  }
  store.reset();
  // The next account's own settings should win over whatever this one left behind.
  prefs.set({ guest: false, prefsUpdatedAt: null });
  restartApp();
}

/** Keep this device in step with the account (no-op outside an account). */
export function pullAccountPrefs(): Promise<void> {
  return isSupabaseConfigured && store.mode === 'supabase' ? pullPrefs(getSupabase()) : Promise.resolve();
}

/** Leave guest mode so the sign-in / create-account screen shows. */
export function leaveGuestMode() {
  store.reset();
  prefs.set({ guest: false });
  restartApp();
}

/** Continue without an account: everything stays on this device. */
export function enterGuestMode() {
  prefs.set({ guest: true });
  restartApp();
}
