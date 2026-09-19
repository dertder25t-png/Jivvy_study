// Device-level preferences (not user data — these never leave the phone).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { deviceTimezone } from '@/core/time';

export interface Prefs {
  tz: string;
  dailyMinutes: number;
  notificationsEnabled: boolean;
  studentName: string;
  /** Note editor's left flashcard panel: null = not chosen yet (open on wide screens, closed on phones). */
  notePanelOpen: boolean | null;
  /** Chose "use without an account": data stays on this device. */
  guest: boolean;
  /** Whether to offer moving this device's data into an account. */
  localImport: 'pending' | 'done' | 'skipped';
  /** Last time the app was opened, as of the *previous* session. Drives the comeback screen. */
  lastOpenedAt: string | null;
}

const KEY = 'studyapp.prefs.v1';

const DEFAULTS = (): Prefs => ({
  tz: deviceTimezone(),
  dailyMinutes: 90,
  notificationsEnabled: true,
  studentName: '',
  notePanelOpen: null,
  guest: false,
  localImport: 'pending',
  lastOpenedAt: null,
});

let current: Prefs = DEFAULTS();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const prefs = {
  get: () => current,
  async load(): Promise<Prefs> {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) current = { ...DEFAULTS(), ...(JSON.parse(raw) as Partial<Prefs>) };
    } catch {
      /* first run or storage unavailable */
    }
    emit();
    return current;
  },
  set(patch: Partial<Prefs>) {
    current = { ...current, ...patch };
    emit();
    AsyncStorage.setItem(KEY, JSON.stringify(current)).catch(() => {});
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

export function usePrefs(): Prefs {
  return useSyncExternalStore(prefs.subscribe, prefs.get, prefs.get);
}
