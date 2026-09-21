import React, { useEffect, useRef, useState } from 'react';
import {
  Alert, Animated, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View, useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { countWords } from '@/core/markdown';
import { createNote, deleteNote, fileNote, saveNote } from '@/data/actions';
import { useSemester } from '@/data/derived';
import { prefs, usePrefs } from '@/data/prefs';
import { store } from '@/data/store';
import { Button, Chip, Empty, Row, Screen, T } from '@/ui/components';
import { BODY_LINE, BODY_SIZE, Markdown } from '@/ui/Markdown';
import { NoteCardsPanel, PANEL_WIDTH } from '@/ui/NoteCardsPanel';
import { NoteToolbar } from '@/ui/NoteToolbar';
import { NotePreview } from '@/ui/NotePreview';
import { space, useColors } from '@/ui/theme';
import type { Note } from '@/types/db';
import { useSafeBack } from '@/ui/nav';

// Browsers draw their own focus ring around a focused <textarea>/<input>; on an open page that reads
// as a box. Kill it inline (web only) so it doesn't depend on the HTML shell being reloaded.
const NO_RING = (Platform.OS === 'web' ? { outlineStyle: 'none', outlineWidth: 0 } : {}) as object;

const COLUMN = 760; // comfortable reading measure, like a page
const WIDE = 900; // at this width the flashcard panel docks beside the page instead of sliding over it

function IconBtn({
  icon, label, onPress, active, badge,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  active?: boolean;
  badge?: number;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
        backgroundColor: active ? c.primarySoft : pressed ? c.surfaceAlt : 'transparent',
      })}
    >
      <Ionicons name={icon} size={22} color={active ? c.primary : c.muted} />
      {badge ? (
        <View style={{ position: 'absolute', top: 3, right: 3, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: c.warn, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}>
          <T variant="small" color={c.bg} style={{ fontSize: 10, lineHeight: 12, fontWeight: '700' }}>{badge}</T>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * The note page. Open and borderless like a sheet of paper: a big title, one wide column,
 * and nothing boxed in. Plain text + markdown underneath; "reading view" renders it.
 * The flashcard panel lives on the left and slides in and out.
 */
export default function NoteEditor() {
  const { id, courseId } = useLocalSearchParams<{ id: string; courseId?: string }>();
  const c = useColors();
  const router = useRouter();
  const sem = useSemester();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const { notePanelOpen } = usePrefs();
  const panelOpen = notePanelOpen ?? wide;

  const isNew = id === 'new';
  const existing = !isNew ? sem.rows.notes.find((n) => n.id === id) : undefined;
  const created = useRef<Note | null>(null);
  const deleted = useRef(false);
  const noteId = created.current?.id ?? (isNew ? null : id);
  const note = noteId ? sem.rows.notes.find((n) => n.id === noteId) ?? null : null;

  const [title, setTitle] = useState(existing?.title ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const [mode, setMode] = useState<'write' | 'read'>(isNew || !existing?.body.trim() ? 'write' : 'read');
  const [menuOpen, setMenuOpen] = useState(false);
  const [showPreview, setShowPreview] = useState(!wide); // on mobile, start with editor only
  const latest = useRef({ title, body });
  latest.current = { title, body };
  const bodyRef = useRef<TextInput>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Helper to insert markdown (inserts before selection or at end)
  const insertMarkdown = (before: string, after: string = '') => {
    // For MVP: insert at the end of the text
    // On web, we could use cursor position from the textarea
    // On native, this is simpler
    const newBody = body + (body.trim() && !body.endsWith('\n') ? '\n' : '') + before + after;
    setBody(newBody);

    // Focus back on the input
    setTimeout(() => {
      bodyRef.current?.focus();
    }, 50);
  };

  // ---------------------------------------------------------------- saving
  const findNote = (): Note | null => {
    const nid = created.current?.id ?? (id !== 'new' ? id : null);
    return nid ? store.all('notes').find((n) => n.id === nid) ?? null : null;
  };

  /** Writes the current text (creating the note on first real content) and returns the stored note. */
  const persist = (): Note | null => {
    if (deleted.current) return null;
    const { title: t, body: b } = latest.current;
    const cur = findNote();
    if (cur) {
      if (cur.body !== b || (cur.title ?? '') !== t.trim()) saveNote(cur, { title: t.trim() || null, body: b });
      return findNote();
    }
    if (!b.trim() && !t.trim()) return null;
    const n = createNote({ body: b, via: 'in_app', explicitCourseId: courseId ?? null });
    created.current = n;
    if (t.trim()) saveNote(n, { title: t.trim() });
    return findNote();
  };

  /** A note you typed into and then emptied shouldn't linger as "Empty note" (unless cards came from it). */
  const dropIfEmpty = () => {
    if (deleted.current) return;
    const n = findNote();
    if (!n) return;
    const { title: t, body: b } = latest.current;
    if (b.trim() || t.trim()) return;
    if (store.all('cards').some((k) => k.source_note_id === n.id)) return;
    deleted.current = true;
    deleteNote(n);
  };

  /** Back, or to the Notes list when there's nothing to go back to (deep link / page reload). */
  const goBack = useSafeBack('/notes');

  /** Save, then tidy up — used whenever the page is left. */
  const leave = () => {
    persist();
    dropIfEmpty();
  };

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(persist, 600);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, body]);

  useEffect(() => () => leave(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- mode
  const enterWrite = () => {
    setMode('write');
    setTimeout(() => bodyRef.current?.focus(), 60);
  };
  const toggleMode = () => (mode === 'write' ? (persist(), setMode('read')) : enterWrite());
  const toggleRef = useRef(toggleMode);
  toggleRef.current = toggleMode;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        toggleRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // ---------------------------------------------------------------- flashcard panel (left)
  const progress = useRef(new Animated.Value(panelOpen ? 1 : 0)).current;
  const [mounted, setMounted] = useState(panelOpen);
  useEffect(() => {
    if (panelOpen) setMounted(true);
    Animated.timing(progress, { toValue: panelOpen ? 1 : 0, duration: 220, useNativeDriver: false }).start(({ finished }) => {
      if (finished && !panelOpen) setMounted(false);
    });
  }, [panelOpen, progress]);
  const setPanel = (open: boolean) => prefs.set({ notePanelOpen: open });

  const panel = mounted ? (
    <NoteCardsPanel note={note} body={body} ensureSaved={persist} onClose={() => setPanel(false)} />
  ) : null;

  // ---------------------------------------------------------------- filing / delete
  const course = note?.course_id ? sem.courseById.get(note.course_id) : undefined;
  const topic = note?.topic_id ? sem.rows.topics.find((t) => t.id === note.topic_id) : undefined;
  const crumb = [
    course ? course.code ?? course.name : 'Inbox',
    topic ? `${topic.week_no != null ? `Wk ${topic.week_no} · ` : ''}${topic.title}` : null,
    title.trim() || 'Untitled',
  ].filter(Boolean).join('  /  ');

  const remove = () => {
    const go = () => {
      deleted.current = true;
      const target = findNote();
      if (target) deleteNote(target);
      goBack();
    };
    if (Platform.OS === 'web') {
      if (window.confirm('Delete this note?')) go();
    } else {
      Alert.alert('Delete this note?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: go }]);
    }
  };

  if (!isNew && !existing && !created.current) return <Screen><Empty title="Note not found" /></Screen>;

  const pendingCount = note ? sem.rows.cards.filter((k) => k.source_note_id === note.id && k.status === 'pending').length : 0;
  const words = countWords(body);
  const dirty = note ? note.body !== body || (note.title ?? '') !== title.trim() : body.trim() !== '' || title.trim() !== '';

  // ---------------------------------------------------------------- page
  const column = { flex: 1, width: '100%' as const, maxWidth: COLUMN, paddingHorizontal: 24 };

  const page = (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      {/* top bar */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: (Platform.OS === 'web' ? 0 : insets.top) + 6, paddingBottom: 6, paddingHorizontal: 8, gap: 2 }}>
        <IconBtn icon="chevron-back" label="Back" onPress={() => { leave(); goBack(); }} />
        <IconBtn icon={panelOpen ? 'albums' : 'albums-outline'} label={panelOpen ? 'Hide flashcards' : 'Show flashcards'} onPress={() => setPanel(!panelOpen)} active={panelOpen} badge={panelOpen ? 0 : pendingCount} />
        <Pressable onPress={() => setMenuOpen((v) => !v)} style={{ flex: 1, minWidth: 0, overflow: 'hidden', alignItems: 'center', paddingHorizontal: 6 }} accessibilityRole="button" accessibilityLabel="Where this note is filed">
          <T variant="small" muted numberOfLines={1} ellipsizeMode="head" style={{ maxWidth: '100%' }}>{crumb}</T>
        </Pressable>
        {mode === 'write' && !wide ? (
          <IconBtn icon={showPreview ? 'create-outline' : 'eye-outline'} label={showPreview ? 'Editor' : 'Preview'} onPress={() => setShowPreview((v) => !v)} active={showPreview} />
        ) : null}
        <IconBtn icon={mode === 'write' ? 'book-outline' : 'create-outline'} label={mode === 'write' ? 'Reading view' : 'Edit'} onPress={toggleMode} />
        <IconBtn icon="ellipsis-vertical" label="More" onPress={() => setMenuOpen((v) => !v)} active={menuOpen} />
      </View>

      {menuOpen ? (
        <View style={{ alignItems: 'center' }}>
          <View style={{ width: '100%', maxWidth: COLUMN, paddingHorizontal: 24, paddingBottom: 12, gap: 8 }}>
            <T variant="label" muted>Filed under</T>
            <Row style={{ flexWrap: 'wrap' }}>
              {sem.rows.courses.map((k) => (
                <Chip
                  key={k.id} label={k.code ?? k.name} small color={k.color}
                  selected={note?.course_id === k.id && !note?.course_inferred}
                  onPress={() => { const n = persist(); if (n) fileNote(n, k.id); }}
                />
              ))}
            </Row>
            {note?.course_inferred ? <T variant="small" muted>We guessed this one — tap the right class to confirm.</T> : null}
            {note ? <Button title="Delete note" variant="danger" small onPress={remove} style={{ alignSelf: 'flex-start' }} /> : null}
          </View>
        </View>
      ) : null}

      {/* the page */}
      <View style={{ flex: 1 }}>
        {mode === 'write' ? (
          <View style={{ flex: 1, flexDirection: wide ? 'row' : 'column' }}>
            {/* Editor column (left on desktop, full width on mobile unless showing preview) */}
            {(!showPreview || wide) && (
              <View style={{
                flex: wide ? 1 : 1,
                backgroundColor: c.bg,
              }}>
                {/* Toolbar */}
                <NoteToolbar onInsertMarkdown={insertMarkdown} />

                {/* Editor */}
                <View style={{ flex: 1, alignItems: 'center' }}>
                  <View style={column}>
                    <TextInput
                      value={title}
                      onChangeText={setTitle}
                      placeholder="Untitled"
                      placeholderTextColor={c.muted}
                      returnKeyType="next"
                      blurOnSubmit={false}
                      onSubmitEditing={() => bodyRef.current?.focus()}
                      style={{
                        color: c.text, fontSize: 34, fontWeight: '700', letterSpacing: -0.5, paddingVertical: 14, paddingHorizontal: 0,
                        borderWidth: 0, backgroundColor: 'transparent', ...NO_RING,
                      }}
                    />
                    <TextInput
                      ref={bodyRef}
                      value={body}
                      onChangeText={setBody}
                      multiline
                      autoFocus={isNew}
                      placeholder="Start writing…"
                      placeholderTextColor={c.muted}
                      style={{
                        flex: 1, color: c.text, fontSize: BODY_SIZE, lineHeight: BODY_LINE, textAlignVertical: 'top',
                        paddingTop: 4, paddingBottom: 90, paddingHorizontal: 0, borderWidth: 0, backgroundColor: 'transparent', ...NO_RING,
                      }}
                    />
                  </View>
                </View>
              </View>
            )}

            {/* Preview pane (right on desktop, toggle on mobile) */}
            {(wide || showPreview) && (
              <View style={{
                flex: 1,
                backgroundColor: c.bg,
              }}>
                <NotePreview markdown={body} />
              </View>
            )}
          </View>
        ) : (
          <ScrollView style={{ width: '100%' }} contentContainerStyle={{ alignItems: 'center', paddingBottom: 120, flexGrow: 1 }}>
            <Pressable onPress={enterWrite} style={{ width: '100%', maxWidth: COLUMN, paddingHorizontal: 24, flexGrow: 1, minHeight: 400 }} accessibilityLabel="Tap to edit">
              {title.trim() ? (
                <T variant="big" style={{ paddingVertical: 14, fontSize: 34 }} selectable>{title}</T>
              ) : (
                <View style={{ height: 14 }} />
              )}
              {body.trim() ? <Markdown source={body} /> : <T muted>Nothing here yet — tap to start writing.</T>}
            </Pressable>
          </ScrollView>
        )}
      </View>

      {/* quiet status, bottom-right like a status bar */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute', right: 12, bottom: 8, flexDirection: 'row', gap: 10, paddingVertical: 3, paddingHorizontal: 8,
          borderRadius: 8, backgroundColor: c.bg, opacity: 0.92,
        }}
      >
        <T variant="small" muted style={{ fontSize: 12 }}>
          {words.toLocaleString()} word{words === 1 ? '' : 's'} · {body.length.toLocaleString()} characters
        </T>
        <T variant="small" muted style={{ fontSize: 12 }}>{dirty ? 'Saving…' : note ? 'Saved' : ''}</T>
      </View>
    </View>
  );

  // wide: the panel docks beside the page; narrow: it slides over it from the left edge.
  const overlayWidth = Math.min(PANEL_WIDTH + 20, width * 0.88);
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: c.bg }}>
      {wide ? (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <Animated.View style={{ width: progress.interpolate({ inputRange: [0, 1], outputRange: [0, PANEL_WIDTH] }), overflow: 'hidden' }}>
            <View style={{ width: PANEL_WIDTH, flex: 1 }}>{panel}</View>
          </Animated.View>
          {page}
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {page}
          <View pointerEvents={panelOpen ? 'auto' : 'none'} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}>
            <Animated.View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: '#000', opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 0.45] }) }}>
              <Pressable style={{ flex: 1 }} onPress={() => setPanel(false)} accessibilityLabel="Close flashcards" />
            </Animated.View>
            <Animated.View
              style={{
                position: 'absolute', top: 0, bottom: 0, left: 0, width: overlayWidth,
                paddingTop: Platform.OS === 'web' ? 0 : insets.top, backgroundColor: c.surface,
                transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-overlayWidth, 0] }) }],
              }}
            >
              {panel}
            </Animated.View>
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
