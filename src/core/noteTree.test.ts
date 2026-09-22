import { describe, expect, it } from 'vitest';
import { buildNoteTree, flattenTree } from './noteTree';
import type { Note } from '@/types/db';

function mkNote(id: string, over: Partial<Note> = {}): Note {
  return {
    id, user_id: 'u1', course_id: null, topic_id: null, parent_note_id: null,
    title: id, body: '', captured_via: 'in_app', course_inferred: false, note_type: 'text', outline: null,
    created_at: `2026-09-${id.padStart(2, '0')}T00:00:00Z`, updated_at: `2026-09-${id.padStart(2, '0')}T00:00:00Z`,
    ...over,
  };
}

describe('buildNoteTree', () => {
  it('nests children under their parent and leaves parentless notes at top level', () => {
    const a = mkNote('01');
    const b = mkNote('02', { parent_note_id: '01' });
    const c = mkNote('03', { parent_note_id: '01' });
    const d = mkNote('04');
    const tree = buildNoteTree([a, b, c, d]);
    expect(tree.map((t) => t.note.id)).toEqual(['04', '01']); // newest root first
    const root = tree.find((t) => t.note.id === '01')!;
    expect(root.children.map((t) => t.note.id)).toEqual(['02', '03']); // children oldest first
  });

  it('nests multiple levels deep', () => {
    const a = mkNote('01');
    const b = mkNote('02', { parent_note_id: '01' });
    const c = mkNote('03', { parent_note_id: '02' });
    const tree = buildNoteTree([a, b, c]);
    expect(tree).toHaveLength(1);
    expect(tree[0].children[0].children[0].note.id).toBe('03');
  });

  it('treats a parent_note_id pointing outside the given list as top-level', () => {
    const a = mkNote('01', { parent_note_id: 'ghost' });
    expect(buildNoteTree([a])).toEqual([{ note: a, children: [] }]);
  });

  it('treats a self-referencing note as top-level instead of looping', () => {
    const a = mkNote('01', { parent_note_id: '01' });
    expect(buildNoteTree([a])).toEqual([{ note: a, children: [] }]);
  });

  it('breaks a parent/child cycle instead of recursing forever', () => {
    const a = mkNote('01', { parent_note_id: '02' });
    const b = mkNote('02', { parent_note_id: '01' });
    const tree = buildNoteTree([a, b]);
    // Whichever isn't chosen as root still appears somewhere, exactly once.
    const ids = tree.flatMap(flattenTree).map((n) => n.id).sort();
    expect(ids).toEqual(['01', '02']);
  });
});

describe('flattenTree', () => {
  it('includes the root and every descendant', () => {
    const a = mkNote('01');
    const b = mkNote('02', { parent_note_id: '01' });
    const c = mkNote('03', { parent_note_id: '02' });
    const [root] = buildNoteTree([a, b, c]);
    expect(flattenTree(root).map((n) => n.id)).toEqual(['01', '02', '03']);
  });
});
