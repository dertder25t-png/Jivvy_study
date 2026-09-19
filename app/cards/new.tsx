import React, { useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { addManualCard } from '@/data/actions';
import { useSemester } from '@/data/derived';
import { Button, Chip, Empty, Row, Screen, T } from '@/ui/components';
import { radius, useColors } from '@/ui/theme';

/** Manual cards are first-class: term, definition, save, repeat. No dialogs. */
export default function NewCards() {
  const { courseId } = useLocalSearchParams<{ courseId?: string }>();
  const sem = useSemester();
  const c = useColors();
  const [course, setCourse] = useState<string | null>(courseId ?? sem.rows.courses[0]?.id ?? null);
  const [term, setTerm] = useState('');
  const [def, setDef] = useState('');
  const [added, setAdded] = useState(0);
  const termRef = useRef<TextInput>(null);
  const defRef = useRef<TextInput>(null);

  if (sem.rows.courses.length === 0) return <Screen><Empty title="Add a course first" /></Screen>;

  const save = () => {
    if (!course || !term.trim() || !def.trim()) return;
    addManualCard({ course_id: course, term, definition: def });
    setTerm('');
    setDef('');
    setAdded((n) => n + 1);
    termRef.current?.focus();
  };

  const inputStyle = {
    backgroundColor: c.surface, color: c.text, borderRadius: radius.md, borderWidth: 1, borderColor: c.border,
    paddingHorizontal: 14, paddingVertical: 14, fontSize: 18,
  } as const;

  return (
    <Screen footer={<Button title="Save card" onPress={save} disabled={!term.trim() || !def.trim()} />}>
      <Row style={{ flexWrap: 'wrap' }}>
        {sem.rows.courses.map((k) => (
          <Chip key={k.id} label={k.code ?? k.name} selected={course === k.id} color={k.color} onPress={() => setCourse(k.id)} />
        ))}
      </Row>
      <View style={{ gap: 12 }}>
        <TextInput
          ref={termRef} value={term} onChangeText={setTerm} placeholder="Term" placeholderTextColor={c.muted}
          autoFocus style={inputStyle} returnKeyType="next" onSubmitEditing={() => defRef.current?.focus()} blurOnSubmit={false}
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
      <T variant="small" muted>{added > 0 ? `${added} card${added === 1 ? '' : 's'} added this session. ` : ''}It files under this week’s topic automatically.</T>
    </Screen>
  );
}
