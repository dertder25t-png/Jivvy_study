import React, { useEffect, useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { createNote } from '@/data/actions';
import { useSemester } from '@/data/derived';
import { Button, Row, Screen, T } from '@/ui/components';
import { radius, useColors } from '@/ui/theme';
import { useSafeBack } from '@/ui/nav';

/**
 * Capture in under 3 seconds: focus is already in the box, there is no
 * destination to pick — the note files itself afterwards.
 */
export default function Capture() {
  const c = useColors();
  const router = useRouter();
  const back = useSafeBack('/');
  const sem = useSemester();
  const [text, setText] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const input = useRef<TextInput>(null);

  useEffect(() => {
    const t = setTimeout(() => input.current?.focus(), 150);
    return () => clearTimeout(t);
  }, []);

  const save = (another: boolean) => {
    const body = text.trim();
    if (!body) return;
    const note = createNote({ body, via: 'in_app' });
    const course = note.course_id ? sem.courseById.get(note.course_id) : undefined;
    setText('');
    if (another) {
      setSaved(course ? `Saved to ${course.code ?? course.name}` : 'Saved to your inbox');
      input.current?.focus();
    } else {
      back();
    }
  };

  return (
    <Screen
      scroll={false}
      footer={
        <Row>
          <Button title="Save + another" variant="secondary" onPress={() => save(true)} disabled={!text.trim()} style={{ flex: 1 }} />
          <Button title="Save" onPress={() => save(false)} disabled={!text.trim()} style={{ flex: 1 }} />
        </Row>
      }
    >
      <TextInput
        ref={input}
        value={text}
        onChangeText={(v) => { setText(v); if (saved) setSaved(null); }}
        multiline
        autoFocus
        placeholder={'What just happened?\n"Reading moved to Thursday", a definition, an idea…'}
        placeholderTextColor={c.muted}
        style={{
          flex: 1, color: c.text, fontSize: 20, lineHeight: 28, textAlignVertical: 'top',
          backgroundColor: c.surface, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: c.border,
        }}
      />
      <View style={{ minHeight: 22 }}>
        <T variant="small" muted>{saved ?? "No need to pick a class — it files itself. Tip: your keyboard's mic button works for voice."}</T>
      </View>
    </Screen>
  );
}
