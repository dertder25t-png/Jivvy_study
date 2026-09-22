import { describe, expect, it } from 'vitest';
import {
  cycleChecked, deleteNode, flattenVisible, indentNode, insertSiblingAfter, moveDown, moveUp,
  newNode, outdentNode, outlineToMarkdown, toggleCollapsed, updateNodeText, type OutlineNode,
} from './outline';
import { parseBlocks } from './markdown';

function tree(...texts: string[]): OutlineNode[] {
  return texts.map((t) => newNode(t));
}

describe('flattenVisible', () => {
  it('walks depth-first and reports depth', () => {
    const a = newNode('a');
    const b = newNode('b');
    a.children = [b];
    const rows = flattenVisible([a, newNode('c')]);
    expect(rows.map((r) => [r.node.text, r.depth])).toEqual([['a', 0], ['b', 1], ['c', 0]]);
  });

  it('skips children of a collapsed node', () => {
    const a = newNode('a');
    a.children = [newNode('b')];
    a.collapsed = true;
    expect(flattenVisible([a]).map((r) => r.node.text)).toEqual(['a']);
  });
});

describe('insertSiblingAfter', () => {
  it('inserts a new node right after the given id, same depth', () => {
    const [a, b] = tree('a', 'b');
    const { tree: next, id } = insertSiblingAfter([a, b], a.id, 'new');
    expect(next.map((n) => n.text)).toEqual(['a', 'new', 'b']);
    expect(next[1].id).toBe(id);
  });

  it('inserts after a nested node within its own parent', () => {
    const a = newNode('a');
    const child = newNode('child');
    a.children = [child];
    const { tree: next } = insertSiblingAfter([a], child.id, 'new');
    expect(next[0].children.map((n: OutlineNode) => n.text)).toEqual(['child', 'new']);
  });
});

describe('indentNode / outdentNode', () => {
  it('indents a node under its previous sibling', () => {
    const [a, b] = tree('a', 'b');
    const next = indentNode([a, b], b.id);
    expect(next).toHaveLength(1);
    expect(next[0].children.map((n) => n.text)).toEqual(['b']);
  });

  it('is a no-op on the first sibling', () => {
    const [a, b] = tree('a', 'b');
    expect(indentNode([a, b], a.id)).toEqual([a, b]);
  });

  it('outdents a node to become the next sibling of its parent, keeping its own children', () => {
    const a = newNode('a');
    const b = newNode('b');
    const grandchild = newNode('gc');
    b.children = [grandchild];
    a.children = [b];
    const next = outdentNode([a], b.id);
    expect(next.map((n) => n.text)).toEqual(['a', 'b']);
    expect(next[1].children.map((n) => n.text)).toEqual(['gc']);
  });

  it('is a no-op on a root node', () => {
    const [a] = tree('a');
    expect(outdentNode([a], a.id)).toEqual([a]);
  });

  it('round-trips: indent then outdent restores the original shape', () => {
    const [a, b, c] = tree('a', 'b', 'c');
    const indented = indentNode([a, b, c], c.id);
    const restored = outdentNode(indented, c.id);
    expect(restored.map((n) => n.text)).toEqual(['a', 'b', 'c']);
  });
});

describe('deleteNode', () => {
  it('removes a leaf node', () => {
    const [a, b] = tree('a', 'b');
    expect(deleteNode([a, b], a.id).map((n) => n.text)).toEqual(['b']);
  });

  it('refuses to delete a node with children', () => {
    const a = newNode('a');
    a.children = [newNode('child')];
    expect(deleteNode([a], a.id)).toEqual([a]);
  });
});

describe('moveUp / moveDown', () => {
  it('swaps with the adjacent sibling and no-ops at the ends', () => {
    const [a, b, c] = tree('a', 'b', 'c');
    expect(moveDown([a, b, c], a.id).map((n) => n.text)).toEqual(['b', 'a', 'c']);
    expect(moveUp([a, b, c], a.id).map((n) => n.text)).toEqual(['a', 'b', 'c']);
    expect(moveDown([a, b, c], c.id).map((n) => n.text)).toEqual(['a', 'b', 'c']);
  });
});

describe('toggleCollapsed / cycleChecked', () => {
  it('flips collapsed', () => {
    const [a] = tree('a');
    expect(toggleCollapsed([a], a.id)[0].collapsed).toBe(true);
  });

  it('cycles null -> false -> true -> null', () => {
    const [a] = tree('a');
    const once = cycleChecked([a], a.id);
    expect(once[0].checked).toBe(false);
    const twice = cycleChecked(once, a.id);
    expect(twice[0].checked).toBe(true);
    const thrice = cycleChecked(twice, a.id);
    expect(thrice[0].checked).toBeNull();
  });
});

describe('updateNodeText', () => {
  it('updates only the matching node, anywhere in the tree', () => {
    const a = newNode('a');
    const child = newNode('child');
    a.children = [child];
    const next = updateNodeText([a], child.id, 'edited');
    expect(next[0].children[0].text).toBe('edited');
    expect(next[0].text).toBe('a');
  });
});

describe('outlineToMarkdown', () => {
  it('serializes nesting and checkboxes into markdown parseBlocks already understands', () => {
    const parent = newNode('Parent');
    const plainChild = newNode('Plain child');
    const doneChild = newNode('Done child');
    doneChild.checked = true;
    const todoChild = newNode('Todo child');
    todoChild.checked = false;
    parent.children = [plainChild, doneChild, todoChild];

    const md = outlineToMarkdown([parent]);
    const [block] = parseBlocks(md);
    expect(block.t).toBe('list');
    if (block.t !== 'list') throw new Error('expected list');
    expect(block.items.map((it) => it.depth)).toEqual([0, 1, 1, 1]);
    expect(block.items.map((it) => it.task)).toEqual([null, null, true, false]);
  });
});
