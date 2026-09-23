import React, { useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { addManualCard, createNote, saveNote } from '@/data/actions';
import { useSemester } from '@/data/derived';
import { Button, Chip, Field, Row, Screen, T } from '@/ui/components';
import { CalendarField } from '@/ui/CalendarField';
import { radius, useColors } from '@/ui/theme';

/** Manual cards are first-class: term, definition, save, repeat. No dialogs. A class is optional,
 * but every batch gets a set title so it stays a named group in the deck instead of loose cards. */
export default function NewCards() {
  const { courseId } = useLocalSearchParams<{ courseId?: string }>();
  const sem = useSemester();
  const c = useColors();
  const [course, setCourse] = useState<string | null>(courseId ?? null);
  const [setTitle, setSetTitle] = useState('');
  const [setNoteId, setSetNoteId] = useState<string | null>(null);
  const [testDate, setTestDate] = useState<string | null>(null);
  const [term, setTerm] = useState('');
  const [def, setDef] = useState('');
  const [added, setAdded] = useState(0);
  const termRef = useRef<TextInput>(null);
  const defRef = useRef<TextInput>(null);

  const titleLocked = setNoteId !== null;
  const canSave = setTitle.trim().length > 0 && term.trim().length > 0 && def.trim().length > 0;

  const commitTestDate = (iso: string | null) => {
    setTestDate(iso);
    if (setNoteId) {
      const note = sem.rows.notes.find((n) => n.id === setNoteId);
      if (note) saveNote(note, { test_date: iso });
    }
  };

  const save = () => {
    if (!canSave) return;
    let noteId = setNoteId;
    if (!noteId) {
      const note = createNote({ body: '', via: 'manual_set', explicitCourseId: course, testDate });
      saveNote(note, { title: setTitle.trim() });
      noteId = note.id;
      setSetNoteId(noteId);
    }
    addManualCard({ course_id: course, term, definition: def, source_note_id: noteId });
    setTerm('');
    setDef('');
    setAdded((n) => n + 1);
    termRef.current?.focus();
  };

  const startNewSet = () => {
    setSetNoteId(null);
    setSetTitle('');
    setTestDate(null);
    setTerm('');
    setDef('');
    setAdded(0);
  };

  const inputStyle = {
    backgroundColor: c.surface, color: c.text, borderRadius: radius.md, borderWidth: 1, borderColor: c.border,
    paddingHorizontal: 14, paddingVertical: 14, fontSize: 18,
  } as const;

  return (
    <Screen maxWidth={760} footer={<Button title="Save card" onPress={save} disabled={!canSave} />}>
      {titleLocked ? (
        <Row style={{ justifyContent: 'space-between' }}>
          <View>
            <T variant="label" muted>Set</T>
            <T variant="body" style={{ fontWeight: '600' }}>{setTitle}</T>
          </View>
          <Button title="New set" small variant="ghost" onPress={startNewSet} />
        </Row>
      ) : (
        <Field
          label="Set title"
          value={setTitle}
          onChangeText={setSetTitle}
          placeholder="e.g., Chapter 5 vocab"
          autoFocus
        />
      )}

      <View style={{ gap: 4 }}>
        <T variant="label" muted>Test date (optional)</T>
        <CalendarField valueIso={testDate} onChange={commitTestDate} tz={sem.tz} now={sem.now} label="Set test date" />
      </View>

      {sem.rows.courses.length > 0 ? (
        <Row style={{ flexWrap: 'wrap' }}>
          <Chip label="No class" selected={course === null} onPress={() => setCourse(null)} />
          {sem.rows.courses.map((k) => (
            <Chip key={k.id} label={k.code ?? k.name} selected={course === k.id} color={k.color} onPress={() => setCourse(k.id)} />
          ))}
        </Row>
      ) : null}
      <View style={{ gap: 12 }}>
        <TextInput
          ref={termRef} value={term} onChangeText={setTerm} placeholder="Term" placeholderTextColor={c.muted}
          style={inputStyle} returnKeyType="next" onSubmitEditing={() => defRef.current?.focus()} blurOnSubmit={false}
        />
        <TextInput
          ref={defRef} value={def} onChangeText={setDef} placeholder="Definition" placeholderTextColor={c.muted}
          multiline style={[inputStyle, { minHeight: 110, textAlignVertical: 'top' }]}
          onKeyPress={(e) => {
            const ev = e.nativeEvent as { key: string; metaKey?: boolean; ctrlKey?: boolean };
            if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) save();
          }}
        />
      </View>
      <T variant="small" muted>
        {added > 0 ? `${added} card${added === 1 ? '' : 's'} added to "${setTitle}". ` : 'Give this batch a title so it stays grouped in your deck.'}
        {course ? ' Files under this week’s topic automatically.' : ''}
      </T>
    </Screen>
  );
}
