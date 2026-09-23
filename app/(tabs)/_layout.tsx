import React from 'react';
import { Pressable, View, type ColorValue } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLayout } from '@/ui/layout';
import { useColors } from '@/ui/theme';

const TAB_BAR_HEIGHT = 64;

export default function TabsLayout() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isDesktop } = useLayout();
  const icon = (name: keyof typeof Ionicons.glyphMap, active: keyof typeof Ionicons.glyphMap) =>
    ({ color, focused }: { color: ColorValue; focused: boolean }) => (
      <Ionicons name={focused ? active : name} size={22} color={color as string} />
    );

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Tabs
        screenOptions={{
          headerStyle: { backgroundColor: c.bg },
          headerTintColor: c.text,
          headerShadowVisible: false,
          headerTitleAlign: 'left',
          headerTitleStyle: { fontWeight: '700', fontSize: isDesktop ? 24 : 22 },
          tabBarActiveTintColor: c.primary,
          tabBarInactiveTintColor: c.muted,
          tabBarLabelStyle: { fontSize: 11, lineHeight: 14, fontWeight: '600' },
          // Desktop navigates from the sidebar; the bottom bar is a phone pattern.
          tabBarStyle: isDesktop
            ? { display: 'none' }
            : { backgroundColor: c.surface, borderTopColor: c.border, height: TAB_BAR_HEIGHT + insets.bottom, paddingTop: 4, paddingBottom: insets.bottom + 4 },
          sceneStyle: { backgroundColor: c.bg },
        }}
      >
        <Tabs.Screen name="index" options={{ title: 'Coming up', tabBarLabel: 'Coming up', tabBarIcon: icon('time-outline', 'time') }} />
        <Tabs.Screen name="courses" options={{ title: 'Courses', tabBarIcon: icon('school-outline', 'school') }} />
        <Tabs.Screen name="notes" options={{ title: 'Notes', tabBarIcon: icon('document-text-outline', 'document-text') }} />
        <Tabs.Screen name="study" options={{ title: 'Study', tabBarIcon: icon('albums-outline', 'albums') }} />
        <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon('ellipsis-horizontal-circle-outline', 'ellipsis-horizontal-circle') }} />
      </Tabs>

      {/* Capture in under 3 seconds: one tap from anywhere, no destination to choose. (Desktop has it in the sidebar.) */}
      {!isDesktop ? (
        <Pressable
          onPress={() => router.push('/capture')}
          accessibilityRole="button"
          accessibilityLabel="Quick capture"
          style={({ pressed }) => ({
            position: 'absolute', right: 16, bottom: TAB_BAR_HEIGHT + insets.bottom + 16, width: 56, height: 56, borderRadius: 18,
            backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center',
            transform: [{ scale: pressed ? 0.95 : 1 }], shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12,
            shadowOffset: { width: 0, height: 4 }, elevation: 6,
          })}
        >
          <Ionicons name="add" size={30} color={c.onPrimary} />
        </Pressable>
      ) : null}
    </View>
  );
}
