import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { boot, pullAccountPrefs, type BootState } from '@/data/boot';
import { getSupabase, isSupabaseConfigured } from '@/data/supabase';
import { store } from '@/data/store';
import { startAutoSync } from '@/data/sync';
import { enterGuestMode } from '@/data/boot';
import { onRestart } from '@/data/session';
import { useSemester } from '@/data/derived';
import { usePrefs } from '@/data/prefs';
import { syncNotifications } from '@/notifications/schedule';
import { AuthScreen } from '@/ui/AuthScreen';
import { Button, Screen, T } from '@/ui/components';
import { useLayout } from '@/ui/layout';
import { Sidebar } from '@/ui/Sidebar';
import { useColors } from '@/ui/theme';

let comebackHandled = false;

/** Keeps OS notifications in step with the (budgeted) plan, and this device in step with the account. */
function Background() {
  const sem = useSemester();
  const { notificationsEnabled } = usePrefs();

  useEffect(() => {
    void syncNotifications(sem.notifications, notificationsEnabled);
  }, [sem.notifications, notificationsEnabled]);

  useEffect(() => startAutoSync(pullAccountPrefs), []);
  return null;
}

/** Desktop gets a persistent sidebar beside every screen; phones and tablets keep the bottom tabs. */
function AppShell({ children }: { children: React.ReactNode }) {
  const { isDesktop } = useLayout();
  if (!isDesktop) return <>{children}</>;
  return (
    <View style={{ flex: 1, flexDirection: 'row' }}>
      <Sidebar />
      <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
    </View>
  );
}

export default function RootLayout() {
  const c = useColors();
  const router = useRouter();
  const [state, setState] = useState<BootState | null>(null);

  const start = useCallback(async () => {
    setState(null);
    setState(await boot());
  }, []);

  useEffect(() => {
    void start();
  }, [start]);

  // screens (sign out, "create an account", delete account…) can ask for a fresh start
  useEffect(() => onRestart(() => void start()), [start]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const { data } = getSupabase().auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') void start();
      if (event === 'SIGNED_IN' && !store.ready) void start();
    });
    return () => data.subscription.unsubscribe();
  }, [start]);

  useEffect(() => {
    if (state?.status === 'ready' && state.comeback && !comebackHandled) {
      comebackHandled = true;
      const t = setTimeout(() => router.push('/comeback'), 50);
      return () => clearTimeout(t);
    }
  }, [state, router]);

  if (!state) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}>
        <ActivityIndicator color={c.primary} />
      </View>
    );
  }
  if (state.status === 'needs_auth') {
    return (
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <AuthScreen onGuest={enterGuestMode} />
      </SafeAreaProvider>
    );
  }
  if (state.status === 'error') {
    return (
      <SafeAreaProvider>
        <Screen>
          <T variant="title">Couldn't load your semester</T>
          <T muted>{state.message}</T>
          <Button title="Try again" onPress={start} />
        </Screen>
      </SafeAreaProvider>
    );
  }

  const header = {
    headerStyle: { backgroundColor: c.bg },
    headerTintColor: c.text,
    headerShadowVisible: false,
    headerTitleStyle: { fontWeight: '600' as const },
    contentStyle: { backgroundColor: c.bg },
    headerBackTitle: 'Back',
  };

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <Background />
      <AppShell>
      <Stack screenOptions={header}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="capture" options={{ presentation: 'modal', title: 'Capture' }} />
        <Stack.Screen name="comeback" options={{ title: '', headerBackVisible: false }} />
        <Stack.Screen name="syllabus/add" options={{ title: 'Add a syllabus' }} />
        <Stack.Screen name="syllabus/review" options={{ title: 'Look right?' }} />
        <Stack.Screen name="course/[id]" options={{ title: '' }} />
        <Stack.Screen name="assignment/[id]" options={{ title: '' }} />
        <Stack.Screen name="grading/[id]" options={{ title: 'Grading setup' }} />
        <Stack.Screen name="cards/setup" options={{ title: 'Study' }} />
        <Stack.Screen name="note/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="cards/generate" options={{ title: 'Make flashcards' }} />
        <Stack.Screen name="cards/review" options={{ title: 'Review' }} />
        <Stack.Screen name="cards/new" options={{ title: 'Add cards' }} />
        <Stack.Screen name="cards/deck" options={{ title: 'Your cards' }} />
        <Stack.Screen name="cards/learn" options={{ title: 'Learn' }} />
        <Stack.Screen name="cards/check" options={{ title: 'Card check' }} />
        <Stack.Screen name="import" options={{ title: 'Import' }} />
        <Stack.Screen name="tests/generate" options={{ title: 'Generate practice questions' }} />
        <Stack.Screen name="tests/review" options={{ title: 'Review questions' }} />
        <Stack.Screen name="crunch" options={{ title: 'Crunch forecast' }} />
        <Stack.Screen name="email" options={{ title: 'Email a professor' }} />
        <Stack.Screen name="waiting" options={{ title: 'Waiting on' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="account" options={{ title: 'Account' }} />
      </Stack>
      </AppShell>
    </SafeAreaProvider>
  );
}
