import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { deleteCard, deleteSet as deleteSetCards, saveNote, updateCard } from '@/data/actions';
import { NO_SET, useCardAdvice } from '@/data/cardAdvice';
import { useSemester } from '@/data/derived';
import { stateFromReviews } from '@/core/scheduling';
import { groupIntoSets, testDateInfo, type SetGroup } from '@/core/sets';
import { relativeTime } from '@/core/time';
import { Badge, Button, Empty, Field, Row, Screen, Section, T } from '@/ui/components';
import { CalendarField } from '@/ui/CalendarField';
import { radius, space, useColors } from '@/ui/theme';
import type { Card as CardRow, CardReview, Note } from '@/types/db';

/** "New", "Overdue", or "Due tomorrow" — the spaced-repetition schedule, made visible. */
function dueInfo(reviews: CardReview[], now: Date, tz: string): { label: string; tone: 'muted' | 'warn' | 'default' } {
  const s = stateFromReviews(reviews);
  if (!s.dueAt) return { label: 'New — not studied yet', tone: 'muted' };
  if (s.dueAt.getTime() <= now.getTime()) return { label: 'Overdue for review', tone: 'warn' };
  return { label: `Due ${relativeTime(s.dueAt, now, tz)}`, tone: 'default' };
}

// Card tiles fill the row and wrap into as many columns as the screen has room for —
// one on a phone, several side by side on a desktop window — instead of one skinny full-width bar each.
const TILE_STYLE = { flexGrow: 1, flexBasis: 260, minWidth: 240, maxWidth: 420 } as const;

export default function Deck() {
  const sem = useSemester();
  const router = useRouter();
  const c = useColors();
  const advice = useCardAdvice();
  const cards = sem.rows.cards.filter((k) => k.status !== 'rejected');

  const [openSets, setOpenSets] = useState<Set<string>>(new Set());
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [editing, setEditing] = useState<CardRow | null>(null);
  const [eTerm, setETerm] = useState('');
  const [eDef, setEDef] = useState('');
  const [renamingSet, setRenamingSet] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [confirmDeleteSet, setConfirmDeleteSet] = useState<string | null>(null);
  const [editingTestDateSet, setEditingTestDateSet] = useState<string | null>(null);

  const noteById = useMemo(() => new Map<string, Note>(sem.rows.notes.map((n) => [n.id, n])), [sem.rows.notes]);

  const reviewsByCard = useMemo(() => {
    const m = new Map<string, CardReview[]>();
    for (const r of sem.rows.card_reviews) {
      const arr = m.get(r.card_id);
      if (arr) arr.push(r);
      else m.set(r.card_id, [r]);
    }
    return m;
  }, [sem.rows.card_reviews]);

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

  const renameSet = (setKey: string, noteId: string) => {
    if (!renameText.trim()) { setRenamingSet(null); return; }
    const note = noteById.get(noteId);
    if (note) saveNote(note, { title: renameText.trim() });
    setRenamingSet(null);
  };

  const commitTestDate = (noteId: string, iso: string | null) => {
    const note = noteById.get(noteId);
    if (!note) return;
    saveNote(note, { test_date: iso });
  };

  const deleteSet = (set: SetGroup) => {
    deleteSetCards(set.cards, set.noteId);
    setConfirmDeleteSet(null);
  };

  const renderCardRow = (k: CardRow) => {
    const isOpen = openCardId === k.id;
    if (editing?.id === k.id) {
      return (
        <View key={k.id} style={[TILE_STYLE, { gap: 8, backgroundColor: c.surfaceAlt, borderRadius: radius.md, padding: space.sm }]}>
          <Field value={eTerm} onChangeText={setETerm} placeholder="Term" />
          <Field value={eDef} onChangeText={setEDef} placeholder="Definition" multiline style={{ minHeight: 64 }} />
          <Row>
            <Button title="Cancel" small variant="secondary" onPress={() => setEditing(null)} style={{ flex: 1 }} />
            <Button title="Save" small onPress={saveEdit} style={{ flex: 1 }} />
          </Row>
        </View>
      );
    }
    const due = dueInfo(reviewsByCard.get(k.id) ?? [], sem.now, sem.tz);
    const dueColor = due.tone === 'warn' ? c.warn : due.tone === 'muted' ? c.muted : c.text;
    const reviews = reviewsByCard.get(k.id) ?? [];
    const lastReviewedAt = stateFromReviews(reviews).lastReviewedAt;

    return (
      <View key={k.id} style={[TILE_STYLE, { borderRadius: radius.md, backgroundColor: c.surfaceAlt, overflow: 'hidden' }]}>
        <Pressable onPress={() => setOpenCardId(isOpen ? null : k.id)} accessibilityRole="button" accessibilityLabel={`${isOpen ? 'Hide' : 'Show'} definition for ${k.term}`}>
          <Row style={{ justifyContent: 'space-between', padding: space.sm }}>
            <View style={{ flex: 1 }}>
              <T variant="body" style={{ fontWeight: '600' }}>{k.term}</T>
              <T variant="small" style={{ color: dueColor }}>{due.label}</T>
            </View>
            <Row gap={6}>
              {k.origin === 'generated' ? <Badge label="from notes" /> : null}
              <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color={c.muted} />
            </Row>
          </Row>
        </Pressable>
        {isOpen ? (
          <View style={{ paddingHorizontal: space.sm, paddingBottom: space.sm, gap: space.sm }}>
            <T variant="small" muted>{k.definition}</T>
            <T variant="small" muted>
              {lastReviewedAt ? `Last studied ${relativeTime(lastReviewedAt, sem.now, sem.tz)}` : 'Never studied yet'}
            </T>
            <Row>
              <Button title="Edit" small variant="secondary" onPress={() => startEdit(k)} style={{ flex: 1 }} />
              <Button title="Delete" small variant="ghost" onPress={() => deleteCard(k)} style={{ flex: 1 }} />
            </Row>
          </View>
        ) : null}
      </View>
    );
  };

  const renderSetActions = (setKey: string, set: SetGroup) => {
    const suggestions = advice.bySet.get(set.noteId ?? NO_SET)?.length ?? 0;
    const checkButton = (
      <Button
        title={suggestions > 0 ? `Card check · ${suggestions}` : 'Card check'}
        small
        variant={suggestions > 0 ? 'secondary' : 'ghost'}
        onPress={() => router.push(`/cards/check?noteId=${set.noteId ?? NO_SET}`)}
      />
    );
    if (renamingSet === setKey) {
      return (
        <Row gap={8}>
          <Field value={renameText} onChangeText={setRenameText} style={{ flex: 1 }} autoFocus />
          <Button title="Cancel" small variant="secondary" onPress={() => setRenamingSet(null)} />
          <Button title="Save" small onPress={() => renameSet(setKey, set.noteId!)} />
        </Row>
      );
    }
    if (confirmDeleteSet === setKey) {
      return (
        <Row style={{ justifyContent: 'space-between' }}>
          <T variant="small" muted style={{ flex: 1 }}>Delete all {set.cards.length} cards in this set? This can't be undone.</T>
          <Row gap={8}>
            <Button title="Cancel" small variant="secondary" onPress={() => setConfirmDeleteSet(null)} />
            <Button title={`Delete ${set.cards.length}`} small variant="ghost" onPress={() => deleteSet(set)} />
          </Row>
        </Row>
      );
    }
    // "Ungrouped cards" isn't tied to a note, so there's nothing to rename or date — but it can go like any set.
    if (!set.noteId) {
      return (
        <Row gap={8} style={{ flexWrap: 'wrap' }}>
          {checkButton}
          <Button title="Delete set" small variant="ghost" onPress={() => setConfirmDeleteSet(setKey)} />
        </Row>
      );
    }
    if (editingTestDateSet === setKey) {
      return (
        <View style={{ gap: 6 }}>
          <T variant="small" muted>Test date</T>
          <CalendarField
            valueIso={set.testDate}
            onChange={(iso) => commitTestDate(set.noteId!, iso)}
            tz={sem.tz}
            now={sem.now}
            label="Set test date"
          />
          <Button title="Done" small variant="secondary" onPress={() => setEditingTestDateSet(null)} style={{ alignSelf: 'flex-start' }} />
        </View>
      );
    }
    return (
      <Row gap={8} style={{ flexWrap: 'wrap' }}>
        <Button title="Learn mode" small onPress={() => router.push(`/cards/learn?noteId=${set.noteId}`)} />
        {checkButton}
        <Button title="Rename set" small variant="ghost" onPress={() => { setRenamingSet(setKey); setRenameText(set.title); }} />
        <Button title={set.testDate ? 'Edit test date' : 'Set test date'} small variant="ghost" onPress={() => setEditingTestDateSet(setKey)} />
        <Button title="Delete set" small variant="ghost" onPress={() => setConfirmDeleteSet(setKey)} />
      </Row>
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
              {set.testDate ? (
                <T variant="small" style={{ color: testDateInfo(set.testDate, sem.now, sem.tz).tone === 'warn' ? c.warn : c.muted }}>
                  {testDateInfo(set.testDate, sem.now, sem.tz).label}
                </T>
              ) : null}
            </View>
            <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={20} color={c.muted} />
          </Row>
        </Pressable>
        {isOpen ? (
          <View style={{ gap: space.sm, padding: space.md, paddingTop: 0 }}>
            {renderSetActions(setKey, set)}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {set.cards.map(renderCardRow)}
            </View>
          </View>
        ) : null}
      </View>
    );
  };

  const renderCourseGroup = (groupKey: string, title: string, list: CardRow[]) => {
    if (list.length === 0) return null;
    const pending = list.filter((k) => k.status === 'pending').length;
    const visible = list.filter((k) => k.status !== 'pending');
    const sets = groupIntoSets(visible, noteById);
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
