import { useCallback } from 'react';
import { useRouter, type Href } from 'expo-router';

/**
 * "Back" that never dead-ends. After a page reload or a direct link there is no previous screen, and a
 * plain `router.back()` does nothing (and logs GO_BACK "not handled"). This goes back when it can and
 * otherwise replaces the screen with `fallback`.
 */
export function useSafeBack(fallback: Href = '/') {
  const router = useRouter();
  return useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(fallback);
  }, [router, fallback]);
}
