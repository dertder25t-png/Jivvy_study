// Sub-notes: a note can nest under another. Pure tree-shaping helpers over plain Note[].
import type { Note } from '@/types/db';

export interface NoteTreeNode {
  note: Note;
  children: NoteTreeNode[];
}

/**
 * Builds a forest from a flat note list. Top-level = no parent, or a parent that isn't
 * in `notes` (e.g. filed under a different bucket) — guards against cycles from bad data.
 */
export function buildNoteTree(notes: Note[]): NoteTreeNode[] {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const parentOf = new Map<string, string | null>();
  for (const n of notes) {
    const p = n.parent_note_id;
    parentOf.set(n.id, p && byId.has(p) && p !== n.id ? p : null);
  }
  const childrenOf = new Map<string, Note[]>();
  for (const n of notes) {
    const p = parentOf.get(n.id);
    if (!p) continue;
    const arr = childrenOf.get(p);
    if (arr) arr.push(n);
    else childrenOf.set(p, [n]);
  }

  const visited = new Set<string>();
  const build = (n: Note): NoteTreeNode => {
    visited.add(n.id);
    const kids = (childrenOf.get(n.id) ?? [])
      .filter((k) => !visited.has(k.id)) // breaks a pure cycle rather than recursing forever
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    return { note: n, children: kids.map(build) };
  };

  const byNewestFirst = (a: Note, b: Note) => b.created_at.localeCompare(a.created_at);
  const ordered = [...notes].sort(byNewestFirst);
  const forest: NoteTreeNode[] = [];
  for (const n of ordered) {
    if (parentOf.get(n.id) == null) forest.push(build(n));
  }
  // A note whose whole ancestor chain loops back on itself never has a null parent, so it'd
  // never become a root above — surface it as one anyway instead of dropping it silently.
  for (const n of ordered) {
    if (!visited.has(n.id)) forest.push(build(n));
  }
  return forest;
}

/** Every note in a subtree, root included — used to count/flatten for previews. */
export function flattenTree(node: NoteTreeNode): Note[] {
  return [node.note, ...node.children.flatMap(flattenTree)];
}
