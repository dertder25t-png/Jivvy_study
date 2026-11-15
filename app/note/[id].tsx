import React, { useEffect, useRef, useState } from 'react';
import {
  Alert, AppState, Animated, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View, useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { countWords } from '@/core/markdown';
import { noteMarkdown, toggleTask } from '@/core/noteText';
import { bodyToOutline } from '@/core/outline';
import { createNote, createSubNote, deleteNote, fileNote, saveNote } from '@/data/actions';
import { useSemester } from '@/data/derived';
import { prefs, usePrefs } from '@/data/prefs';
import { copyNoteMarkdown, downloadNote } from '@/data/noteExport';
import { rememberVersion, versionsOf, type NoteVersion } from '@/data/noteHistory';
import { store } from '@/data/store';
import { Button, Chip, Empty, Row, Screen, T } from '@/ui/components';
import { SIDEBAR_WIDTH, useLayout } from '@/ui/layout';
import { NoteCardsPanel, PANEL_WIDTH } from '@/ui/NoteCardsPanel';
import { MarkdownEditor, type MarkdownEditorHandle } from '@/ui/MarkdownEditor';
import { MarkdownView } from '@/ui/MarkdownView';
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
 * and nothing boxed in. The note is plain markdown, edited as one piece of text (select and copy
 * anything) and read rendered — Ctrl/Cmd+E flips between the two, like Obsidian. The flashcard
 * panel lives on the left and slides in and out.
 */
export default function NoteEditor() {
  const { id, courseId } = useLocalSearchParams<{ id: string; courseId?: string }>();
  const c = useColors();
  const router = useRouter();
  const sem = useSemester();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { isDesktop } = useLayout();
  const wide = width - (isDesktop ? SIDEBAR_WIDTH : 0) >= WIDE;
  const { notePanelOpen, subNoteQuickAddEnabled, subNoteShortcutKey, noteMode } = usePrefs();
  const panelOpen = notePanelOpen ?? wide;

  const isNew = id === 'new';
  const existing = !isNew ? sem.rows.notes.find((n) => n.id === id) : undefined;
  const created = useRef<Note | null>(null);
  const deleted = useRef(false);
  const noteId = created.current?.id ?? (isNew ? null : id);
  const note = noteId ? sem.rows.notes.find((n) => n.id === noteId) ?? null : null;

  const [title, setTitle] = useState(existing?.title ?? '');
  const [body, setBody] = useState(() => (existing ? noteMarkdown(existing) : ''));
  const [menuOpen, setMenuOpen] = useState(false);
  const [mode, setModeState] = useState<'edit' | 'read'>(isNew || !existing?.body.trim() ? 'edit' : noteMode);
  const [history, setHistory] = useState<NoteVersion[] | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const editor = useRef<MarkdownEditorHandle | null>(null);
  const latest = useRef({ title, body });
  latest.current = { title, body };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setMode = (m: 'edit' | 'read') => {
    setModeState(m);
    prefs.set({ noteMode: m });
    if (m === 'edit') setTimeout(() => editor.current?.focus(), 50);
  };
  const say = (msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash((cur) => (cur === msg ? null : cur)), 2200);
  };

  // Keep what the note looked like when it was opened, so this session's edits can always be undone.
  useEffect(() => {
    if (existing) void rememberVersion(existing.id, existing, existing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      if (cur.body !== b || (cur.title ?? '') !== t.trim()) {
        void rememberVersion(cur.id, cur, { body: b });
        // `outline` is still written (as the tree of this markdown) so an older copy of the app that
        // reads the tree first shows the same words rather than a stale version.
        saveNote(cur, { title: t.trim() || null, body: b, outline: bodyToOutline(b) });
      }
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

  // Never lose the last keystrokes: save at once when the tab is closed/hidden or the app goes to the background.
  useEffect(() => {
    const now = () => persist();
    const sub = AppState.addEventListener('change', (st) => { if (st !== 'active') now(); });
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const onHide = () => { if (document.visibilityState === 'hidden') now(); };
      window.addEventListener('pagehide', now);
      window.addEventListener('beforeunload', now);
      document.addEventListener('visibilitychange', onHide);
      return () => {
        sub.remove();
        window.removeEventListener('pagehide', now);
        window.removeEventListener('beforeunload', now);
        document.removeEventListener('visibilitychange', onHide);
      };
    }
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ctrl/Cmd+E: switch between editing and reading (Obsidian's shortcut).
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        setMode(mode === 'edit' ? 'read' : 'edit');
      }
    };
    // capture phase: the text box handles its own keys and would otherwise keep this one to itself
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

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

  // ---------------------------------------------------------------- sub-notes
  const parentNote = note?.parent_note_id ? sem.rows.notes.find((n) => n.id === note.parent_note_id) ?? null : null;
  const subNoteCount = note ? sem.rows.notes.filter((n) => n.parent_note_id === note.id).length : 0;

  const addSubNote = () => {
    const saved = persist();
    if (!saved) return;
    const sub = createSubNote(saved);
    router.push(`/note/${sub.id}`);
  };

  const onKeyPressSubNote = (e: { nativeEvent: { key: string }; preventDefault?: () => void }) => {
    if (!subNoteShortcutKey || e.nativeEvent?.key !== subNoteShortcutKey) return;
    e.preventDefault?.();
    addSubNote();
  };

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
  const dirty = note
    ? note.body !== body || (note.title ?? '') !== title.trim()
    : body.trim() !== '' || title.trim() !== '';

  const copy = async () => {
    try {
      await copyNoteMarkdown(body);
      say('Copied as Markdown');
    } catch {
      say("Couldn't copy — select the text and copy it instead");
    }
  };
  const download = async () => {
    const saved = persist();
    if (saved) await downloadNote(saved).catch(() => say("Couldn't save the file"));
  };
  const openHistory = async () => {
    const n = persist();
    setHistory(n ? await versionsOf(n.id) : []);
  };
  const restore = (v: NoteVersion) => {
    const n = findNote();
    if (n) void rememberVersion(n.id, { title: title.trim() || null, body }, { body: v.body }, new Date(), true);
    setTitle(v.title ?? '');
    setBody(v.body);
    setHistory(null);
    setMenuOpen(false);
    say('Restored — the version you replaced is in history too');
  };

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
        {subNoteQuickAddEnabled && note ? (
          <IconBtn icon="add-outline" label="Add sub-note" onPress={addSubNote} badge={subNoteCount || undefined} />
        ) : null}
        <IconBtn
          icon={mode === 'edit' ? 'book-outline' : 'create-outline'}
          label={mode === 'edit' ? 'Reading view (Ctrl+E)' : 'Edit (Ctrl+E)'}
          onPress={() => setMode(mode === 'edit' ? 'read' : 'edit')}
        />
        <IconBtn icon="copy-outline" label="Copy as Markdown" onPress={copy} />
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
            <T variant="label" muted style={{ marginTop: 4 }}>Export</T>
            <Row style={{ flexWrap: 'wrap' }}>
              <Button title="Copy as Markdown" variant="secondary" small onPress={copy} />
              {note ? <Button title={Platform.OS === 'web' ? 'Download .md' : 'Share as .md'} variant="secondary" small onPress={download} /> : null}
              {note ? <Button title="Version history" variant="secondary" small onPress={openHistory} /> : null}
            </Row>
            {history ? (
              <View style={{ gap: 6, paddingVertical: 4 }}>
                <T variant="small" muted>
                  {history.length ? 'Earlier versions saved on this device. Restoring keeps the current text in history too.' : 'No earlier versions on this device yet.'}
                </T>
                {history.map((v) => (
                  <Row key={v.at} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <T variant="small" style={{ flex: 1 }} numberOfLines={1}>
                      {new Date(v.at).toLocaleString()} · {v.body.trim().split(/\s+/).filter(Boolean).length} words — {v.body.trim().slice(0, 50) || '(empty)'}
                    </T>
                    <Button title="Restore" variant="secondary" small onPress={() => restore(v)} />
                  </Row>
                ))}
              </View>
            ) : null}
            {note ? <Button title="Delete note" variant="danger" small onPress={remove} style={{ alignSelf: 'flex-start' }} /> : null}
          </View>
        </View>
      ) : null}

      {/* the page */}
      <View style={{ flex: 1 }}>
        <ScrollView style={{ width: '100%' }} contentContainerStyle={{ alignItems: 'center', paddingBottom: 120, flexGrow: 1 }}>
          <View style={column}>
            {parentNote ? (
              <Pressable onPress={() => { leave(); router.push(`/note/${parentNote.id}`); }} accessibilityRole="button" style={{ paddingTop: 10 }}>
                <T variant="small" color={c.primary}>↑ {parentNote.title || 'Back to parent note'}</T>
              </Pressable>
            ) : null}
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Untitled"
              placeholderTextColor={c.muted}
              returnKeyType="next"
              blurOnSubmit={false}
              onKeyPress={onKeyPressSubNote}
              style={{
                color: c.text, fontSize: 34, fontWeight: '700', letterSpacing: -0.5, paddingVertical: 14, paddingHorizontal: 0,
                borderWidth: 0, backgroundColor: 'transparent', ...NO_RING,
              }}
            />
            {mode === 'edit' ? (
              <MarkdownEditor ref={editor} value={body} onChange={setBody} autoFocus={isNew} />
            ) : (
              <View style={{ minHeight: 320 }}>
                <MarkdownView text={body} onToggleTask={(i) => setBody((b) => toggleTask(b, i))} />
              </View>
            )}
          </View>
        </ScrollView>
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
        <T variant="small" muted style={{ fontSize: 12 }}>{flash ?? (dirty ? 'Saving…' : note ? 'Saved' : '')}</T>
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
