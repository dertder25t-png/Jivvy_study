// Notes are plain markdown text (like Obsidian). This holds the pure helpers the editor uses for
// its keyboard behaviour, plus turning notes into .md files for export. No React here, so it's testable.
import { outlineToMarkdown, type OutlineNode } from './outline';

export interface Sel {
  start: number;
  end: number;
}

/** The result of an edit: the new text and where the cursor/selection should land. */
export interface Edit {
  text: string;
  sel: Sel;
}

/**
 * The markdown a note shows in the editor. Older notes were bullet outlines whose `body` was kept as a
 * markdown mirror of the tree on every save, so `body` already holds everything. Only fall back to the
 * tree when the body is somehow empty but the tree isn't — never show a note as blank if its words exist.
 */
export function noteMarkdown(note: { body: string; outline?: OutlineNode[] | null }): string {
  if (note.body.trim()) return note.body;
  const fromTree = note.outline?.length ? outlineToMarkdown(note.outline) : '';
  return fromTree.replace(/^- $/gm, '').trim() ? fromTree : note.body;
}

function lineStart(text: string, pos: number): number {
  return text.lastIndexOf('\n', pos - 1) + 1;
}
function lineEnd(text: string, pos: number): number {
  const i = text.indexOf('\n', pos);
  return i === -1 ? text.length : i;
}

const LIST_PREFIX = /^(\s*)([-*+]|(\d+)([.)]))(\s+)(\[[ xX]\]\s+)?/;
const QUOTE_PREFIX = /^(\s*>\s?)+/;

/**
 * Enter, Obsidian-style. On a list line it starts the next item (same marker, next number, a fresh
 * checkbox); on an empty item it ends the list instead. Returns null when a plain newline will do.
 */
export function enterKey(text: string, sel: Sel): Edit | null {
  if (sel.start !== sel.end) return null;
  const pos = sel.start;
  const ls = lineStart(text, pos);
  const line = text.slice(ls, lineEnd(text, pos));
  const before = text.slice(ls, pos);
  const m = line.match(LIST_PREFIX);
  if (m && before.length >= m[0].length) {
    const rest = line.slice(m[0].length);
    if (!rest.trim()) {
      // empty item: drop the marker (outdent first if nested)
      if (m[1].length > 0) {
        const less = m[1].length >= 2 ? m[1].slice(2) : '';
        const next = text.slice(0, ls) + less + line.slice(m[1].length) + text.slice(ls + line.length);
        const delta = less.length - m[1].length;
        return { text: next, sel: { start: pos + delta, end: pos + delta } };
      }
      const next = text.slice(0, ls) + text.slice(ls + line.length);
      return { text: next, sel: { start: ls, end: ls } };
    }
    const marker = m[3] ? `${Number(m[3]) + 1}${m[4]}` : m[2];
    const box = m[6] ? '[ ] ' : '';
    const insert = `\n${m[1]}${marker}${m[5]}${box}`;
    return { text: text.slice(0, pos) + insert + text.slice(pos), sel: { start: pos + insert.length, end: pos + insert.length } };
  }
  const q = line.match(QUOTE_PREFIX);
  if (q && before.length >= q[0].length) {
    if (!line.slice(q[0].length).trim()) {
      const next = text.slice(0, ls) + text.slice(ls + line.length);
      return { text: next, sel: { start: ls, end: ls } };
    }
    const insert = `\n${q[0]}`;
    return { text: text.slice(0, pos) + insert + text.slice(pos), sel: { start: pos + insert.length, end: pos + insert.length } };
  }
  return null;
}

/**
 * Tab / Shift+Tab. Indents (or outdents) every line the selection touches by two spaces — the nesting
 * the outline used, so old notes keep their shape. A bare cursor mid-line with Tab inserts two spaces.
 */
export function indentKey(text: string, sel: Sel, outdent: boolean): Edit {
  const first = lineStart(text, sel.start);
  const multi = sel.start !== sel.end;
  const onList = LIST_PREFIX.test(text.slice(first, lineEnd(text, sel.start)));
  if (!outdent && !multi && !onList) {
    const ins = '  ';
    return { text: text.slice(0, sel.start) + ins + text.slice(sel.end), sel: { start: sel.start + 2, end: sel.start + 2 } };
  }
  const lastPos = multi && sel.end > sel.start && text[sel.end - 1] === '\n' ? sel.end - 1 : sel.end;
  const last = lineEnd(text, lastPos);
  const lines = text.slice(first, last).split('\n');
  let startDelta = 0;
  let total = 0;
  const out = lines.map((l, i) => {
    let d: number;
    let nl: string;
    if (outdent) {
      const strip = l.startsWith('\t') ? 1 : Math.min(2, l.length - l.trimStart().length);
      nl = l.slice(strip);
      d = -strip;
    } else {
      nl = `  ${l}`;
      d = 2;
    }
    if (i === 0) startDelta = d;
    total += d;
    return nl;
  });
  const next = text.slice(0, first) + out.join('\n') + text.slice(last);
  const start = Math.max(first, sel.start + startDelta);
  return { text: next, sel: { start, end: multi ? Math.max(start, sel.end + total) : start } };
}

/** Ctrl+B / Ctrl+I: wraps the selection in a marker, or unwraps it if it's already wrapped. */
export function wrapKey(text: string, sel: Sel, mark: string): Edit {
  const n = mark.length;
  const inside = text.slice(sel.start, sel.end);
  if (text.slice(sel.start - n, sel.start) === mark && text.slice(sel.end, sel.end + n) === mark) {
    return {
      text: text.slice(0, sel.start - n) + inside + text.slice(sel.end + n),
      sel: { start: sel.start - n, end: sel.end - n },
    };
  }
  return {
    text: text.slice(0, sel.start) + mark + inside + mark + text.slice(sel.end),
    sel: { start: sel.start + n, end: sel.end + n },
  };
}

/**
 * Ctrl+Enter (Obsidian's "toggle checkbox"): a plain line becomes "- [ ] ", a bullet gains a box,
 * and a box flips between ticked and unticked. Keeps the cursor on the same text.
 */
export function checkboxKey(text: string, sel: Sel): Edit {
  const ls = lineStart(text, sel.start);
  const le = lineEnd(text, sel.start);
  const line = text.slice(ls, le);
  let next: string;
  const task = line.match(/^(\s*(?:[-*+]|\d+[.)])\s+)\[( |x|X)\]/);
  const list = line.match(/^(\s*(?:[-*+]|\d+[.)])\s+)/);
  if (task) next = `${task[1]}[${task[2] === ' ' ? 'x' : ' '}]${line.slice(task[0].length)}`;
  else if (list) next = `${list[1]}[ ] ${line.slice(list[1].length)}`;
  else {
    const indent = line.match(/^\s*/)![0];
    next = `${indent}- [ ] ${line.slice(indent.length)}`;
  }
  const d = next.length - line.length;
  const shift = (p: number) => (p >= ls ? Math.max(ls, p + d) : p);
  return { text: text.slice(0, ls) + next + text.slice(le), sel: { start: shift(sel.start), end: shift(sel.end) } };
}

/** Ticks or unticks the n-th task checkbox (0-based, in reading order) — clicking a box in Reading view. */
export function toggleTask(text: string, index: number): string {
  let seen = -1;
  let inFence = false;
  return text.split('\n').map((line) => {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (inFence) return line;
    const m = line.match(/^(\s*(?:[-*+]|\d+[.)])\s+)\[( |x|X)\](\s)/);
    if (!m) return line;
    seen += 1;
    if (seen !== index) return line;
    return `${m[1]}[${m[2] === ' ' ? 'x' : ' '}]${line.slice(m[1].length + 3)}`;
  }).join('\n');
}

// ---------------------------------------------------------------- export

/** A name that's legal on Windows, macOS, Linux, and inside a zip. */
export function safeFileName(name: string, fallback = 'Untitled'): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .slice(0, 80)
    .trim();
  return cleaned || fallback;
}

/** "Untitled", "Untitled 2", ... — so two notes with the same title never overwrite each other. */
export function uniqueName(base: string, taken: Set<string>): string {
  let name = base;
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base} ${i}`;
  taken.add(name.toLowerCase());
  return name;
}

/** First non-empty line, stripped of markdown, for notes with no title. */
export function firstLineTitle(body: string): string {
  const line = body.split('\n').find((l) => l.trim()) ?? '';
  return line.replace(/^\s*(#+|[-*+]|\d+[.)]|>)\s*/, '').replace(/^\[[ xX]\]\s*/, '').replace(/[*_=~`]/g, '').trim().slice(0, 60);
}

export function noteTitle(note: { title: string | null; body: string }): string {
  return note.title?.trim() || firstLineTitle(note.body) || 'Untitled';
}

function yamlString(v: string): string {
  return /^[\w .,()&'-]+$/.test(v) && !/^\s|\s$/.test(v) ? v : JSON.stringify(v);
}

/**
 * A note as an Obsidian-friendly .md file: YAML properties up top (course, dates, parent), then the
 * note's own markdown untouched.
 */
export function noteToMarkdownFile(
  note: { title: string | null; body: string; outline?: OutlineNode[] | null; created_at: string; updated_at: string },
  meta: { course?: string | null; parent?: string | null } = {},
): string {
  const props: string[] = [];
  if (note.title?.trim()) props.push(`title: ${yamlString(note.title.trim())}`);
  if (meta.course) props.push(`course: ${yamlString(meta.course)}`);
  if (meta.parent) props.push(`parent: ${JSON.stringify(`[[${meta.parent}]]`)}`);
  props.push(`created: ${note.created_at}`);
  props.push(`updated: ${note.updated_at}`);
  const body = noteMarkdown(note);
  return `---\n${props.join('\n')}\n---\n\n${body}${body.endsWith('\n') ? '' : '\n'}`;
}

interface VaultNote {
  id: string;
  title: string | null;
  body: string;
  outline?: OutlineNode[] | null;
  course_id: string | null;
  parent_note_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Every note as a file in an Obsidian vault: one folder per course ("Inbox" for unfiled notes), file
 * names from titles (deduplicated), and sub-notes linking back to their parent with a [[wikilink]].
 */
export function buildVault(
  notes: VaultNote[],
  courses: Array<{ id: string; name: string; code?: string | null }>,
): Array<{ path: string; content: string; modified: Date }> {
  const courseName = new Map(courses.map((k) => [k.id, k.code ? `${k.code} ${k.name}`.trim() : k.name]));
  const folderTaken = new Set<string>();
  const folderOf = new Map<string, string>();
  const folderFor = (courseId: string | null): string => {
    const key = courseId ?? '';
    let f = folderOf.get(key);
    if (!f) {
      f = uniqueName(safeFileName(courseId ? courseName.get(courseId) ?? 'Course' : 'Inbox'), folderTaken);
      folderOf.set(key, f);
    }
    return f;
  };
  const sorted = [...notes].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const takenIn = new Map<string, Set<string>>();
  const nameOf = new Map<string, string>();
  for (const n of sorted) {
    const folder = folderFor(n.course_id);
    const taken = takenIn.get(folder) ?? new Set<string>();
    takenIn.set(folder, taken);
    nameOf.set(n.id, uniqueName(safeFileName(noteTitle(n)), taken));
  }
  return sorted.map((n) => {
    const parent = n.parent_note_id ? nameOf.get(n.parent_note_id) ?? null : null;
    return {
      path: `${folderFor(n.course_id)}/${nameOf.get(n.id)}.md`,
      content: noteToMarkdownFile(n, { course: n.course_id ? courseName.get(n.course_id) ?? null : null, parent }),
      modified: new Date(n.updated_at),
    };
  });
}
