import { store } from './store';
import { asyncOutbox, createLocalBackend, createSupabaseBackend } from './backends';
import { getSupabase, isSupabaseConfigured } from './supabase';
import { prefs } from './prefs';
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
export async function boot(): Promise<BootState> {
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
        await store.init(createSupabaseBackend(sb, user.id), asyncOutbox(`studyapp.outbox.${user.id}`));
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
  prefs.set({ guest: false });
  restartApp();
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
