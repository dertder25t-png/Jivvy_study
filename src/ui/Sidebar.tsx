// Desktop navigation: a persistent left sidebar that replaces the phone's bottom tabs + "More" page.
// It stays put across every screen (course pages, the deck, import…), like a normal desktop app.
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { usePathname, useRouter, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSemester } from '@/data/derived';
import { SIDEBAR_WIDTH } from './layout';
import { radius, space, useColors } from './theme';

type IconName = keyof typeof Ionicons.glyphMap;

interface NavItem {
  label: string;
  href: string;
  icon: IconName;
  /** Tab routes switch tabs; everything else opens as a page on top of them. */
  tab?: boolean;
  /** Other paths that should light this item up (e.g. a course page lights "Courses"). */
  also?: RegExp;
  badge?: number;
}

function isActive(item: NavItem, path: string): boolean {
  if (item.href === '/') return path === '/' || path === '';
  return path === item.href || path.startsWith(`${item.href}/`) || !!item.also?.test(path);
}

export function Sidebar() {
  const c = useColors();
  const router = useRouter();
  const path = usePathname();
  const sem = useSemester();
  const waiting = sem.rows.waiting_on.filter((w) => !w.resolved_at).length;

  const primary: NavItem[] = [
    { label: 'Coming up', href: '/', icon: 'time-outline', tab: true, also: /^\/assignment\// },
    { label: 'Courses', href: '/courses', icon: 'school-outline', tab: true, also: /^\/(course|grading|syllabus)\// },
    { label: 'Notes', href: '/notes', icon: 'document-text-outline', tab: true, also: /^\/note\// },
    { label: 'Study', href: '/study', icon: 'albums-outline', tab: true, also: /^\/cards\/(setup|review|learn|generate)/ },
  ];
  const cards: NavItem[] = [
    { label: 'Your cards', href: '/cards/deck', icon: 'layers-outline' },
    { label: 'Add cards', href: '/cards/new', icon: 'add-circle-outline' },
    { label: 'Import', href: '/import', icon: 'cloud-upload-outline' },
  ];
  const tools: NavItem[] = [
    { label: 'Crunch forecast', href: '/crunch', icon: 'pulse-outline' },
    { label: 'Catch up', href: '/comeback', icon: 'refresh-outline' },
    { label: 'Email a professor', href: '/email', icon: 'mail-outline' },
    { label: 'Waiting on', href: '/waiting', icon: 'hourglass-outline', badge: waiting || undefined },
  ];
  const footer: NavItem[] = [
    { label: 'Settings', href: '/settings', icon: 'settings-outline' },
    { label: 'Account', href: '/account', icon: 'person-circle-outline' },
  ];

  // Sidebar items are top-level destinations: clear whatever is stacked on top, then go.
  const go = (item: NavItem) => {
    if (router.canDismiss()) router.dismissAll();
    if (item.tab) router.navigate(item.href as Href);
    else router.push(item.href as Href);
  };

  const renderItem = (item: NavItem) => {
    const active = isActive(item, path);
    return (
      <Pressable
        key={item.href}
        onPress={() => go(item)}
        accessibilityRole="link"
        accessibilityState={{ selected: active }}
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
          flexDirection: 'row', alignItems: 'center', gap: 10,
          paddingVertical: 8, paddingHorizontal: 10, borderRadius: radius.sm,
          backgroundColor: active ? c.primarySoft : hovered ? c.surfaceAlt : pressed ? c.surfaceAlt : 'transparent',
        })}
      >
        <Ionicons name={item.icon} size={18} color={active ? c.primary : c.muted} />
        <Text style={{ flex: 1, fontSize: 14, fontWeight: active ? '600' : '500', color: active ? c.primary : c.text }}>
          {item.label}
        </Text>
        {item.badge ? (
          <View style={{ minWidth: 20, paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill, backgroundColor: c.surfaceAlt }}>
            <Text style={{ fontSize: 11, fontWeight: '600', color: c.muted, textAlign: 'center' }}>{item.badge}</Text>
          </View>
        ) : null}
      </Pressable>
    );
  };

  const group = (title: string | null, items: NavItem[]) => (
    <View style={{ gap: 2 }}>
      {title ? (
        <Text style={{ fontSize: 11, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase', color: c.muted, paddingHorizontal: 10, marginBottom: 4 }}>
          {title}
        </Text>
      ) : null}
      {items.map(renderItem)}
    </View>
  );

  return (
    <View style={{ width: SIDEBAR_WIDTH, backgroundColor: c.surface, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: c.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.md }}>
        <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="school" size={17} color={c.onPrimary} />
        </View>
        <Text style={{ fontSize: 17, fontWeight: '700', color: c.text, letterSpacing: -0.2 }}>Study App</Text>
      </View>

      <View style={{ paddingHorizontal: space.md, paddingBottom: space.md }}>
        <Pressable
          onPress={() => router.push('/capture')}
          accessibilityRole="button"
          accessibilityLabel="Quick capture"
          style={({ pressed }) => ({
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
            paddingVertical: 10, borderRadius: radius.md, backgroundColor: c.primary, opacity: pressed ? 0.85 : 1,
          })}
        >
          <Ionicons name="add" size={18} color={c.onPrimary} />
          <Text style={{ color: c.onPrimary, fontWeight: '600', fontSize: 14 }}>Quick capture</Text>
        </Pressable>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: space.sm, paddingBottom: space.lg, gap: space.lg }}>
        {group(null, primary)}
        {group('Flashcards', cards)}
        {group('Tools', tools)}
      </ScrollView>

      <View style={{ paddingHorizontal: space.sm, paddingVertical: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, gap: 2 }}>
        {footer.map(renderItem)}
      </View>
    </View>
  );
}
