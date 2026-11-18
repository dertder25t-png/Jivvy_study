// Add a course by hand — no syllabus needed. Deadlines, exams and grading can be added later
// (or a syllabus uploaded for it), but notes and flashcards can be filed under it right away.
import React, { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { createCourse, fileNote } from '@/data/actions';
import { store } from '@/data/store';
import { Button, Card, Field, Screen, T } from '@/ui/components';

export default function NewCourse() {
  const router = useRouter();
  /** Opened from a note's "File under" list: file that note here once the course exists. */
  const { noteId } = useLocalSearchParams<{ noteId?: string }>();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [instructor, setInstructor] = useState('');
  const [email, setEmail] = useState('');

  const ok = name.trim().length > 0;

  const create = () => {
    if (!ok) return;
    const course = createCourse({ name, code, instructor_name: instructor, instructor_email: email });
    const note = noteId ? store.all('notes').find((n) => n.id === noteId) : undefined;
    if (note) {
      fileNote(note, course.id);
      router.back();
    } else {
      router.replace(`/course/${course.id}`);
    }
  };

  return (
    <Screen maxWidth={560}>
      <T variant="title">Add a course</T>
      <T muted>Just a name is enough. You can file notes and flashcards under it now, and add deadlines or a syllabus later.</T>
      <Card>
        <Field label="Course name" value={name} onChangeText={setName} placeholder="Introduction to Psychology" autoFocus onSubmitEditing={create} />
        <Field label="Course code (optional)" value={code} onChangeText={setCode} placeholder="PSY 2301" autoCapitalize="characters" onSubmitEditing={create} />
        <Field label="Instructor (optional)" value={instructor} onChangeText={setInstructor} placeholder="Dr. Reyes" onSubmitEditing={create} />
        <Field label="Instructor email (optional)" value={email} onChangeText={setEmail} placeholder="reyes@school.edu" autoCapitalize="none" keyboardType="email-address" onSubmitEditing={create} />
        <Button title="Add course" onPress={create} disabled={!ok} />
      </Card>
    </Screen>
  );
}
