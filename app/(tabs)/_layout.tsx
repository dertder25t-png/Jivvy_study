import React from 'react';
import { Pressable, Text, View, type ColorValue } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/ui/theme';

export default function TabsLayout() {
  const c = useColors();
  const router = useRouter();
  const icon = (name: keyof typeof Ionicons.glyphMap) =>
    ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} size={size} color={color as string} />;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Tabs
        screenOptions={{
          headerStyle: { backgroundColor: c.bg },
          headerTintColor: c.text,
          headerShadowVisible: false,
          headerTitleStyle: { fontWeight: '700', fontSize: 22 },
          tabBarActiveTintColor: c.primary,
          tabBarInactiveTintColor: c.muted,
          tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border },
          sceneStyle: { backgroundColor: c.bg },
        }}
      >
        <Tabs.Screen name="index" options={{ title: 'Coming up', tabBarLabel: 'Coming', tabBarIcon: icon('time-outline') }} />
        <Tabs.Screen name="courses" options={{ title: 'Courses', tabBarIcon: icon('school-outline') }} />
        <Tabs.Screen name="notes" options={{ title: 'Notes', tabBarIcon: icon('document-text-outline') }} />
        <Tabs.Screen name="study" options={{ title: 'Study', tabBarIcon: icon('albums-outline') }} />
        <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon('ellipsis-horizontal') }} />
      </Tabs>

      {/* Capture in under 3 seconds: one tap from anywhere, no destination to choose. */}
      <Pressable
        onPress={() => router.push('/capture')}
        accessibilityRole="button"
        accessibilityLabel="Quick capture"
        style={({ pressed }) => ({
          position: 'absolute', right: 18, bottom: 78, width: 56, height: 56, borderRadius: 28,
          backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center',
          opacity: pressed ? 0.85 : 1, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8,
          shadowOffset: { width: 0, height: 3 }, elevation: 5,
        })}
      >
        <Text style={{ color: c.onPrimary, fontSize: 30, marginTop: -2 }}>+</Text>
      </Pressable>
    </View>
  );
}
