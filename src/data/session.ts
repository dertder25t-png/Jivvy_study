// Tiny event so any screen (sign-out, "create an account", after deleting an account…) can ask the
// root layout to re-run startup without importing it.
const listeners = new Set<() => void>();

export function onRestart(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function restartApp(): void {
  listeners.forEach((l) => l());
}
