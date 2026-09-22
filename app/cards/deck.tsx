import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { deleteCard, updateCard } from '@/data/actions';
import { useSemester } from '@/data/derived';
import { Badge, Button, Empty, Field, Row, Screen, Section, T } from '@/ui/components';
import { radius, space, useColors } from '@/ui/theme';
import type { Card as CardRow } from '@/types/db';

interface SetGroup {
  key: string;
  title: string;
  cards: CardRow[];
}

/** Groups cards by the note they were added under ("set title") so a big deck stays navigable. */
function groupIntoSets(list: CardRow[], noteTitle: (id: string) => string): SetGroup[] {
  const order: string[] = [];
  const m = new Map<string, SetGroup>();
  for (const k of list) {
    const key = k.source_note_id ?? '__ungrouped__';
    let g = m.get(key);
    if (!g) {
      g = { key, title: k.source_note_id ? noteTitle(k.source_note_id) : 'Ungrouped cards', cards: [] };
      m.set(key, g);
      order.push(key);
    }
    g.cards.push(k);
  }
  return order.map((k) => m.get(k)!);
}

export default function Deck() {
  const sem = useSemester();
  const router = useRouter();
  const c = useColors();
  const cards = sem.rows.cards.filter((k) => k.status !== 'rejected');

  const [openSets, setOpenSets] = useState<Set<string>>(new Set());
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [editing, setEditing] = useState<CardRow | null>(null);
  const [eTerm, setETerm] = useState('');
  const [eDef, setEDef] = useState('');

  const noteById = useMemo(() => new Map(sem.rows.notes.map((n) => [n.id, n])), [sem.rows.notes]);
  const noteTitle = (id: string) => noteById.get(id)?.title || 'Untitled set';

  if (cards.length === 0) {
    return (
      <Screen>
        <Empty title="No cards yet" body="Make them from a note, or add your own." action={<Button title="Add a card" onPress={() => router.push('/cards/new')} />} />
      </Screen>
    );
  }

  const toggleSet = (key: string) => {
    setOpenSets((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const startEdit = (k: CardRow) => {
    setEditing(k);
    setETerm(k.term);
    setEDef(k.definition);
  };
  const saveEdit = () => {
    if (!editing || !eTerm.trim() || !eDef.trim()) return;
    updateCard(editing, { term: eTerm, definition: eDef });
    setEditing(null);
  };

  const renderCardRow = (k: CardRow) => {
    const isOpen = openCardId === k.id;
    if (editing?.id === k.id) {
      return (
        <View key={k.id} style={{ gap: 8, backgroundColor: c.surfaceAlt, borderRadius: radius.md, padding: space.sm }}>
          <Field value={eTerm} onChangeText={setETerm} placeholder="Term" />
          <Field value={eDef} onChangeText={setEDef} placeholder="Definition" multiline style={{ minHeight: 64 }} />
          <Row>
            <Button title="Cancel" small variant="secondary" onPress={() => setEditing(null)} style={{ flex: 1 }} />
            <Button title="Save" small onPress={saveEdit} style={{ flex: 1 }} />
          </Row>
        </View>
      );
    }
    return (
      <View key={k.id} style={{ borderRadius: radius.md, backgroundColor: c.surfaceAlt, overflow: 'hidden' }}>
        <Pressable onPress={() => setOpenCardId(isOpen ? null : k.id)} accessibilityRole="button" accessibilityLabel={`${isOpen ? 'Hide' : 'Show'} definition for ${k.term}`}>
          <Row style={{ justifyContent: 'space-between', padding: space.sm }}>
            <T variant="body" style={{ fontWeight: '600', flex: 1 }}>{k.term}</T>
            <Row gap={6}>
              {k.origin === 'generated' ? <Badge label="from notes" /> : null}
              <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color={c.muted} />
            </Row>
          </Row>
        </Pressable>
        {isOpen ? (
          <View style={{ paddingHorizontal: space.sm, paddingBottom: space.sm, gap: space.sm }}>
            <T variant="small" muted>{k.definition}</T>
            <Row>
              <Button title="Edit" small variant="secondary" onPress={() => startEdit(k)} style={{ flex: 1 }} />
              <Button title="Delete" small variant="ghost" onPress={() => deleteCard(k)} style={{ flex: 1 }} />
            </Row>
          </View>
        ) : null}
      </View>
    );
  };

  const renderSet = (groupKey: string, set: SetGroup) => {
    const setKey = `${groupKey}:${set.key}`;
    const isOpen = openSets.has(setKey);
    return (
      <View key={setKey} style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, overflow: 'hidden' }}>
        <Pressable onPress={() => toggleSet(setKey)} accessibilityRole="button" accessibilityLabel={`${isOpen ? 'Collapse' : 'Expand'} ${set.title}`}>
          <Row style={{ justifyContent: 'space-between', padding: space.md }}>
            <View>
              <T variant="body" style={{ fontWeight: '600' }}>{set.title}</T>
              <T variant="small" muted>{set.cards.length} card{set.cards.length === 1 ? '' : 's'}</T>
            </View>
            <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={20} color={c.muted} />
          </Row>
        </Pressable>
        {isOpen ? (
          <View style={{ gap: 8, padding: space.md, paddingTop: 0 }}>
            {set.cards.map(renderCardRow)}
          </View>
        ) : null}
      </View>
    );
  };

  const renderCourseGroup = (groupKey: string, title: string, list: CardRow[]) => {
    if (list.length === 0) return null;
    const pending = list.filter((k) => k.status === 'pending').length;
    const visible = list.filter((k) => k.status !== 'pending');
    const sets = groupIntoSets(visible, noteTitle);
    return (
      <Section key={groupKey} title={`${title} · ${visible.length}${pending ? ` (+${pending} waiting)` : ''}`}>
        <View style={{ gap: 8 }}>
          {sets.map((set) => renderSet(groupKey, set))}
        </View>
      </Section>
    );
  };

  const unsorted = cards.filter((k) => !k.course_id);

  return (
    <Screen>
      <T variant="small" muted>Tap a set to open it, then tap a card to see its definition.</T>
      {sem.rows.courses.map((course) => renderCourseGroup(course.id, course.code ?? course.name, cards.filter((k) => k.course_id === course.id)))}
      {renderCourseGroup('unsorted', 'No class', unsorted)}
    </Screen>
  );
}
