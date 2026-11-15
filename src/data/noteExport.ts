// Getting notes out as Markdown: copy one, save one as a .md file, or save every note as a .zip that
// opens straight into Obsidian as a vault (one folder per course).
import * as Clipboard from 'expo-clipboard';
import { Platform, Share } from 'react-native';
import { buildVault, noteTitle, noteToMarkdownFile, safeFileName } from '@/core/noteText';
import { makeZip } from '@/core/zip';
import type { Note } from '@/types/db';
import { store } from './store';

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function metaFor(note: Note) {
  const course = note.course_id ? store.all('courses').find((k) => k.id === note.course_id) : undefined;
  const parent = note.parent_note_id ? store.all('notes').find((n) => n.id === note.parent_note_id) : undefined;
  return {
    course: course ? (course.code ? `${course.code} ${course.name}` : course.name) : null,
    parent: parent ? safeFileName(noteTitle(parent)) : null,
  };
}

/** Copies the note's markdown (just the text — no properties) to the clipboard. */
export async function copyNoteMarkdown(body: string): Promise<void> {
  await Clipboard.setStringAsync(body);
}

/** Web: downloads "<title>.md". Phones: opens the share sheet with the markdown. */
export async function downloadNote(note: Note): Promise<void> {
  const name = `${safeFileName(noteTitle(note))}.md`;
  const md = noteToMarkdownFile(note, metaFor(note));
  if (Platform.OS === 'web') saveBlob(new Blob([md], { type: 'text/markdown;charset=utf-8' }), name);
  else await Share.share({ title: name, message: md });
}

/** Every note as an Obsidian vault in a .zip (web). Phones get one long markdown document to share. */
export async function downloadAllNotes(now = new Date()): Promise<number> {
  const notes = store.all('notes');
  const files = buildVault(notes, store.all('courses'));
  const stamp = now.toISOString().slice(0, 10);
  if (Platform.OS === 'web') {
    const bytes = makeZip(files, now);
    saveBlob(new Blob([bytes as BlobPart], { type: 'application/zip' }), `study-app-notes-${stamp}.zip`);
  } else {
    const all = files.map((f) => `<!-- ${f.path} -->\n${f.content}`).join('\n\n');
    await Share.share({ title: `study-app-notes-${stamp}.md`, message: all });
  }
  return files.length;
}
