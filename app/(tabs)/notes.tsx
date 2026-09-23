import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { needsConfirmation } from '@/core/notes';
import { buildNoteTree, type NoteTreeNode } from '@/core/noteTree';
import { relativeTime } from '@/core/time';
import { createSubNote, fileNote } from '@/data/actions';
import { useSemester } from '@/data/derived';
import { usePrefs } from '@/data/prefs';
import { Button, Card, Chip, Dot, Empty, Row, Screen, Section, T } from '@/ui/components';
import { useLayout } from '@/ui/layout';
import { radius, space, useColors } from '@/ui/theme';
import type { Note } from '@/types/db';

function preview(n: Note): string {
  const first = (n.body.trim().split('\n').find((l) => l.trim()) ?? '').replace(/^\s*-\s*(\[[ xX]\]\s*)?/, '');
  return (n.title || first).replace(/[#*_`]/g, '').slice(0, 90) || 'Empty note';
}

export default function Notes() {
  const sem = useSemester();
  const router = useRouter();
  const c = useColors();
  const { subNoteQuickAddEnabled } = usePrefs();
  const { isPhone } = useLayout();
  const notes = [...sem.rows.notes].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const inbox = notes.filter(needsConfirmation);
  const filed = notes.filter((n) => !needsConfirmation(n));
  const courses = sem.rows.courses;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const tree = useMemo(() => buildNoteTree(filed), [filed]);

  const confirmAllGuesses = () => {
    for (const n of inbox) if (n.course_id && n.course_inferred) fileNote(n, n.course_id);
  };
  const guesses = inbox.filter((n) => n.course_id && n.course_inferred);

  const toggleCollapsed = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addSubNote = (parent: Note) => {
    const sub = createSubNote(parent);
    router.push(`/note/${sub.id}`);
  };

  const renderNode = (node: NoteTreeNode, depth: number): React.ReactNode => {
    const n = node.note;
    const course = n.course_id ? sem.courseById.get(n.course_id) : undefined;
    const topic = n.topic_id ? sem.rows.topics.find((t) => t.id === n.topic_id) : undefined;
    const hasChildren = node.children.length > 0;
    const isOpen = !collapsed.has(n.id);

    return (
      <View key={n.id} style={{ gap: 8 }}>
        <View
          style={{
            marginLeft: depth * 20,
            borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
            borderLeftWidth: 3, borderLeftColor: course?.color ?? c.border, backgroundColor: c.surface,
            flexDirection: 'row', alignItems: 'stretch',
          }}
        >
          {hasChildren ? (
            <Pressable
              onPress={() => toggleCollapsed(n.id)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`${isOpen ? 'Collapse' : 'Expand'} sub-notes`}
              style={{ paddingHorizontal: 10, justifyContent: 'center' }}
            >
              <Ionicons name={isOpen ? 'chevron-down' : 'chevron-forward'} size={16} color={c.muted} />
            </Pressable>
          ) : (
            <View style={{ width: 30 }} />
          )}
          <Pressable
            onPress={() => router.push(`/note/${n.id}`)}
            accessibilityRole="button"
            style={{ flex: 1, paddingVertical: space.sm, paddingRight: space.sm, gap: 2 }}
          >
            <T variant="body" style={{ fontWeight: '600' }} numberOfLines={2}>{preview(n)}</T>
            <Row gap={6}>
              <Dot color={course?.color ?? '#999'} size={8} />
              <T variant="small" muted numberOfLines={1}>
                {[course?.code ?? course?.name, topic ? `Wk ${topic.week_no ?? ''} ${topic.title}`.trim() : null, relativeTime(n.created_at, sem.now, sem.tz)]
                  .filter(Boolean).join(' · ')}
                {hasChildren ? ` · ${node.children.length} sub-note${node.children.length === 1 ? '' : 's'}` : ''}
              </T>
            </Row>
          </Pressable>
          {subNoteQuickAddEnabled ? (
            <Pressable
              onPress={() => addSubNote(n)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Add a sub-note under ${preview(n)}`}
              style={{ paddingHorizontal: 12, justifyContent: 'center' }}
            >
              <Ionicons name="add" size={18} color={c.muted} />
            </Pressable>
          ) : null}
        </View>
        {hasChildren && isOpen ? node.children.map((child) => renderNode(child, depth + 1)) : null}
      </View>
    );
  };

  return (
    <Screen maxWidth={900}>
      <Row gap={8}>
        <Button title="New note" onPress={() => router.push('/note/new')} style={isPhone ? { flex: 1 } : undefined} />
        <Button title="Import" variant="secondary" onPress={() => router.push('/import')} style={isPhone ? { flex: 1 } : undefined} />
      </Row>

      {inbox.length > 0 ? (
        <Section
          title={`Inbox · ${inbox.length}`}
          right={guesses.length > 1 ? <Button title="Confirm all guesses" small variant="ghost" onPress={confirmAllGuesses} /> : undefined}
        >
          <View style={{ gap: 8 }}>
            {inbox.map((n) => {
              const guess = n.course_id ? sem.courseById.get(n.course_id) : undefined;
              return (
                <Card key={n.id}>
                  {/* the text opens the note; the chips below are separate buttons (buttons can't nest) */}
                  <Pressable onPress={() => router.push(`/note/${n.id}`)} accessibilityRole="button" style={{ gap: 4 }}>
                    <T variant="body" numberOfLines={2}>{preview(n)}</T>
                    <T variant="small" muted>{relativeTime(n.created_at, sem.now, sem.tz)} · {guess ? `Looks like ${guess.code ?? guess.name}?` : 'Which class is this for?'}</T>
                  </Pressable>
                  <Row style={{ flexWrap: 'wrap' }}>
                    {guess ? <Chip label={`Yes, ${guess.code ?? guess.name}`} small selected color={guess.color} onPress={() => fileNote(n, guess.id)} /> : null}
                    {courses.filter((c2) => c2.id !== guess?.id).map((c2) => (
                      <Chip key={c2.id} label={c2.code ?? c2.name} small onPress={() => fileNote(n, c2.id)} />
                    ))}
                  </Row>
                </Card>
              );
            })}
          </View>
        </Section>
      ) : null}

      <Section title="Notes">
        <View style={{ gap: 8 }}>
          {filed.length === 0 && inbox.length === 0 ? (
            <Empty title="Nothing captured yet" body="Tap + anywhere to jot something down. It files itself by class and week." />
          ) : null}
          {tree.map((node) => renderNode(node, 0))}
        </View>
      </Section>
    </Screen>
  );
}
