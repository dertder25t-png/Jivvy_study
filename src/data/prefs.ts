// Preferences. Most are about this device (screen, permissions, time zone); the study settings
// listed in SYNCED_PREFS also follow a signed-in account to every device (see prefsSync.ts).
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
  /** Show the small "+" quick-add-sub-note button in Notes and the note editor. */
  subNoteQuickAddEnabled: boolean;
  /** Keyboard shortcut (web) that creates a sub-note while editing one. null = off. */
  subNoteShortcutKey: string | null;
  /** Last pocket size chosen in Learn mode — remembered as the next session's default. */
  learnPocketSize: number | null;
  /** Which side of the card Learn mode asks you to type: the definition, the term, or a mix. */
  learnDirection: 'term_to_def' | 'def_to_term' | 'mixed';
  /** When the daily study reminder goes off ('HH:MM', 24h, in the user's zone). */
  studyTime: string;
  /** When the synced study settings last changed, on this device or another. null = never synced. */
  prefsUpdatedAt: string | null;
}

/** The settings that follow the account rather than staying on one device. */
export const SYNCED_PREFS = [
  'studentName', 'dailyMinutes', 'studyTime', 'learnDirection', 'learnPocketSize', 'subNoteQuickAddEnabled', 'subNoteShortcutKey',
] as const satisfies ReadonlyArray<keyof Prefs>;

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
  subNoteQuickAddEnabled: true,
  subNoteShortcutKey: 'Tab',
  learnPocketSize: null,
  learnDirection: 'term_to_def',
  studyTime: '18:00',
  prefsUpdatedAt: null,
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
