import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { crunchHeadline, crunchWhen } from '@/core/collisions';
import { useSemester } from '@/data/derived';
import { store } from '@/data/store';
import { Badge, Card, Screen, Section, T } from '@/ui/components';
import { radius, space, useColors } from '@/ui/theme';

interface Item {
  title: string;
  sub: string;
  href: string;
  icon: keyof typeof Ionicons.glyphMap;
  badge?: string;
}

export default function More() {
  const sem = useSemester();
  const router = useRouter();
  const c = useColors();
  const waiting = sem.rows.waiting_on.filter((w) => !w.resolved_at).length;
  const crunch = sem.crunch[0];

  const groups: Array<{ title: string; items: Item[] }> = [
    {
      title: 'Plan',
      items: [
        {
          title: 'Crunch forecast', icon: 'pulse-outline', href: '/crunch',
          sub: crunch ? `${crunchHeadline(crunch)} — ${crunchWhen(crunch)}` : 'No heavy weeks on the horizon.',
          badge: crunch ? crunchWhen(crunch) : undefined,
        },
        { title: 'Catch up', icon: 'refresh-outline', href: '/comeback', sub: "What's still salvageable, and the one thing worth doing today." },
        { title: 'Waiting on', icon: 'hourglass-outline', href: '/waiting', sub: "Emails and requests you're expecting an answer to.", badge: waiting ? String(waiting) : undefined },
      ],
    },
    {
      title: 'Flashcards',
      items: [
        { title: 'Your cards', icon: 'layers-outline', href: '/cards/deck', sub: 'Browse and edit every set, and set test dates.' },
        { title: 'Import', icon: 'cloud-upload-outline', href: '/import', sub: 'Paste from Quizlet, or upload a CSV, TSV, JSON or text file.' },
      ],
    },
    {
      title: 'Tools',
      items: [
        { title: 'Email a professor', icon: 'mail-outline', href: '/email', sub: 'Pre-filled with your course, the assignment and the real policy text.' },
      ],
    },
    {
      title: 'You',
      items: [
        {
          title: 'Account', icon: 'person-circle-outline', href: '/account',
          sub: store.mode === 'supabase' ? 'Signed in — profile, password, your data.' : 'Not signed in — create an account to sync and back up.',
        },
        { title: 'Settings', icon: 'settings-outline', href: '/settings', sub: 'Reminders, study time, shortcuts.' },
      ],
    },
  ];

  return (
    <Screen maxWidth={720}>
      {groups.map((g) => (
        <Section key={g.title} title={g.title}>
          <Card style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
            {g.items.map((item, i) => (
              <Pressable
                key={item.href}
                onPress={() => router.push(item.href as Href)}
                accessibilityRole="button"
                style={({ pressed }) => ({
                  flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg,
                  backgroundColor: pressed ? c.surfaceAlt : 'transparent',
                  borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0, borderTopColor: c.border,
                })}
              >
                <View style={{ width: 34, height: 34, borderRadius: radius.sm, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name={item.icon} size={18} color={c.primary} />
                </View>
                <View style={{ flex: 1, gap: 1 }}>
                  <T variant="body" style={{ fontWeight: '600' }}>{item.title}</T>
                  <T variant="small" muted numberOfLines={2}>{item.sub}</T>
                </View>
                {item.badge ? <Badge label={item.badge} tone="warn" /> : null}
                <Ionicons name="chevron-forward" size={16} color={c.muted} />
              </Pressable>
            ))}
          </Card>
        </Section>
      ))}
    </Screen>
  );
}
