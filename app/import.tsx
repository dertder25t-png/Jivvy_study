import React, { useState } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { parseTextFile, parseCSV, parseJSON, getFileType, validateImportedCard, type QuizletCard, type ImportedNote } from '@/core/importNotes';
import { createNote, addManualCard, saveNote } from '@/data/actions';
import { useSemester } from '@/data/derived';
import { store } from '@/data/store';
import { Button, Card, Empty, Row, Screen, Section, T } from '@/ui/components';
import { useColors } from '@/ui/theme';

type Tab = 'notes' | 'flashcards';

export default function ImportScreen() {
  const c = useColors();
  const router = useRouter();
  const sem = useSemester();
  const [activeTab, setActiveTab] = useState<Tab>('notes');
  const [notes, setNotes] = useState<ImportedNote[]>([]);
  const [cards, setCards] = useState<QuizletCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [sourceNoteTitle, setSourceNoteTitle] = useState('');

  const pickFile = async () => {
    try {
      setLoading(true);
      const result = await DocumentPicker.getDocumentAsync({
        type: activeTab === 'notes'
          ? ['text/plain', 'text/markdown', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/pdf']
          : ['text/csv', 'application/json'],
      });

      if (result.canceled) {
        setLoading(false);
        return;
      }

      const asset = result.assets[0];
      if (!asset.uri) throw new Error('No file URI');

      // Read file content
      const response = await fetch(asset.uri);
      const content = await response.text();

      const fileType = getFileType(asset.name || 'file.txt');

      if (activeTab === 'notes') {
        // Parse note
        if (fileType === 'text' || fileType === 'markdown') {
          const note = parseTextFile(content, asset.name || 'Imported note');
          setNotes([note]);
        } else {
          throw new Error(`File type ${fileType} not yet supported. Please use .txt or .md files for now.`);
        }
      } else {
        // Parse flashcards
        if (asset.name?.endsWith('.csv')) {
          const parsedCards = parseCSV(content);
          setCards(parsedCards.filter(validateImportedCard));
        } else if (asset.name?.endsWith('.json')) {
          const parsedCards = parseJSON(content);
          setCards(parsedCards.filter(validateImportedCard));
        } else {
          throw new Error('Please upload a CSV or JSON file');
        }
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const importNotes = async () => {
    if (notes.length === 0) return;

    try {
      setLoading(true);
      for (const note of notes) {
        const created = createNote({
          body: note.body,
          via: 'import',
        });
        if (note.title && created) {
          saveNote(created, { title: note.title });
        }
      }
      alert(`Successfully imported ${notes.length} note(s)`);
      setNotes([]);
      router.push('/notes');
    } catch (err: any) {
      alert(`Error importing: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const importCards = async () => {
    if (cards.length === 0) return;

    try {
      setLoading(true);

      // Create source note if title provided
      let sourceNoteId: string | null = null;
      if (sourceNoteTitle.trim()) {
        const sourceNote = createNote({
          body: `Imported from Quizlet`,
          via: 'import',
        });
        if (sourceNote) {
          saveNote(sourceNote, { title: sourceNoteTitle });
          sourceNoteId = sourceNote.id;
        }
      }

      // Get a default course for the cards (use first course or null)
      const defaultCourse = sem.rows.courses[0];
      if (!defaultCourse) {
        alert('No courses found. Please create a course first.');
        setLoading(false);
        return;
      }

      // Create cards
      for (const card of cards) {
        addManualCard({
          course_id: defaultCourse.id,
          term: card.term,
          definition: card.definition,
          source_note_id: sourceNoteId,
        });
      }

      alert(`Successfully imported ${cards.length} card(s)`);
      setCards([]);
      setSourceNoteTitle('');
      router.push('/study');
    } catch (err: any) {
      alert(`Error importing: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      {/* Tab selector */}
      <Row gap={8} style={{ marginBottom: 16 }}>
        <Pressable
          onPress={() => {
            setActiveTab('notes');
            setCards([]);
          }}
          style={{ flex: 1 }}
        >
          <View
            style={{
              paddingVertical: 12,
              paddingHorizontal: 16,
              backgroundColor: activeTab === 'notes' ? c.primary : c.surface,
              borderRadius: 8,
              alignItems: 'center',
            }}
          >
            <T style={{ color: activeTab === 'notes' ? c.onPrimary : c.text, fontWeight: '600' }}>
              Notes
            </T>
          </View>
        </Pressable>

        <Pressable
          onPress={() => {
            setActiveTab('flashcards');
            setNotes([]);
          }}
          style={{ flex: 1 }}
        >
          <View
            style={{
              paddingVertical: 12,
              paddingHorizontal: 16,
              backgroundColor: activeTab === 'flashcards' ? c.primary : c.surface,
              borderRadius: 8,
              alignItems: 'center',
            }}
          >
            <T style={{ color: activeTab === 'flashcards' ? c.onPrimary : c.text, fontWeight: '600' }}>
              Flashcards
            </T>
          </View>
        </Pressable>
      </Row>

      {/* Content */}
      <ScrollView contentContainerStyle={{ gap: 16, paddingBottom: 20 }}>
        {activeTab === 'notes' ? (
          <Section title="Import Notes">
            <View style={{ gap: 12 }}>
              <T muted variant="small">
                Upload .txt or .md files to import them as notes. Each file becomes one note.
              </T>

              <Button
                title={loading ? 'Uploading...' : 'Choose File'}
                onPress={pickFile}
                disabled={loading}
              />

              {notes.length > 0 && (
                <>
                  <Card>
                    <T variant="body" style={{ fontWeight: '600' }}>
                      {notes[0].title || 'Untitled Note'}
                    </T>
                    <T variant="small" muted numberOfLines={3}>
                      {notes[0].body.slice(0, 150)}...
                    </T>
                  </Card>

                  <Button
                    title={`Import ${notes.length} Note(s)`}
                    onPress={importNotes}
                    disabled={loading}
                  />
                </>
              )}

              {notes.length === 0 && (
                <Empty title="No file selected" body="Choose a .txt or .md file to get started" />
              )}
            </View>
          </Section>
        ) : (
          <Section title="Import Flashcards">
            <View style={{ gap: 12 }}>
              <T muted variant="small">
                Upload a CSV or JSON file from Quizlet. Format should be: term, definition
              </T>

              <Button
                title={loading ? 'Uploading...' : 'Choose File'}
                onPress={pickFile}
                disabled={loading}
              />

              {cards.length > 0 && (
                <>
                  <View
                    style={{
                      backgroundColor: c.surfaceAlt,
                      borderRadius: 8,
                      padding: 12,
                      maxHeight: 200,
                    }}
                  >
                    <ScrollView>
                      {cards.slice(0, 5).map((card, i) => (
                        <View
                          key={i}
                          style={{
                            marginBottom: i < cards.length - 1 ? 12 : 0,
                            paddingBottom: i < cards.length - 1 ? 12 : 0,
                            borderBottomWidth: i < cards.length - 1 ? 1 : 0,
                            borderBottomColor: c.border,
                          }}
                        >
                          <T variant="small" style={{ fontWeight: '600' }}>
                            {card.term}
                          </T>
                          <T variant="small" muted>
                            {card.definition}
                          </T>
                        </View>
                      ))}
                      {cards.length > 5 && (
                        <T variant="small" muted>
                          +{cards.length - 5} more cards
                        </T>
                      )}
                    </ScrollView>
                  </View>

                  <View style={{ gap: 12 }}>
                    <View>
                      <T variant="small" style={{ marginBottom: 4 }}>
                        Source Note (optional)
                      </T>
                      <TextInput
                        placeholder="e.g., Biology 101 - Chapter 5"
                        value={sourceNoteTitle}
                        onChangeText={setSourceNoteTitle}
                        style={{
                          backgroundColor: c.surface,
                          borderColor: c.border,
                          borderWidth: 1,
                          borderRadius: 8,
                          padding: 12,
                          color: c.text,
                        }}
                      />
                    </View>

                    <Button
                      title={`Import ${cards.length} Card(s)`}
                      onPress={importCards}
                      disabled={loading}
                    />
                  </View>
                </>
              )}

              {cards.length === 0 && (
                <Empty title="No file selected" body="Choose a CSV or JSON file to get started" />
              )}
            </View>
          </Section>
        )}
      </ScrollView>
    </Screen>
  );
}

// Simple TextInput component for the source note title
import { TextInput } from 'react-native';
