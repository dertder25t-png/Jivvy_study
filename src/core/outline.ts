// Outline notes: each bullet is a node in a small tree. Array order *is* sibling order —
// no separate position field to keep in sync. Pure tree-shaping helpers, mirroring the
// style of noteTree.ts; the editor (src/ui/OutlineEditor.tsx) calls these and re-renders.

export interface OutlineNode {
  id: string;
  text: string;
  /** null = plain bullet, true/false = checkbox item. */
  checked: boolean | null;
  collapsed: boolean;
  children: OutlineNode[];
}

let seq = 0;
/** Not cryptographic — just needs to be unique within one note's tree for React keys/refs. */
export function newNodeId(): string {
  seq += 1;
  return `n${Date.now().toString(36)}${seq.toString(36)}`;
}

export function newNode(text = ''): OutlineNode {
  return { id: newNodeId(), text, checked: null, collapsed: false, children: [] };
}

export function emptyOutline(): OutlineNode[] {
  return [newNode()];
}

// ---------------------------------------------------------------- tree walking

type Loc = { parent: OutlineNode[]; index: number; node: OutlineNode; ancestors: OutlineNode[] };

/** Finds a node by id along with its containing sibling array, index, and ancestor chain. */
function locate(tree: OutlineNode[], id: string, ancestors: OutlineNode[] = []): Loc | null {
  for (let i = 0; i < tree.length; i++) {
    const node = tree[i];
    if (node.id === id) return { parent: tree, index: i, node, ancestors };
    const found = locate(node.children, id, [...ancestors, node]);
    if (found) return found;
  }
  return null;
}

function mapTree(tree: OutlineNode[], fn: (n: OutlineNode) => OutlineNode): OutlineNode[] {
  return tree.map((n) => fn({ ...n, children: mapTree(n.children, fn) }));
}

export interface FlatRow {
  node: OutlineNode;
  depth: number;
  parentId: string | null;
}

/** Visible rows in display order, skipping the children of any collapsed node. */
export function flattenVisible(tree: OutlineNode[]): FlatRow[] {
  const out: FlatRow[] = [];
  const walk = (nodes: OutlineNode[], depth: number, parentId: string | null) => {
    for (const node of nodes) {
      out.push({ node, depth, parentId });
      if (!node.collapsed) walk(node.children, depth + 1, node.id);
    }
  };
  walk(tree, 0, null);
  return out;
}

// ---------------------------------------------------------------- edits

export function updateNodeText(tree: OutlineNode[], id: string, text: string): OutlineNode[] {
  return mapTree(tree, (n) => (n.id === id ? { ...n, text } : n));
}

export function toggleCollapsed(tree: OutlineNode[], id: string): OutlineNode[] {
  return mapTree(tree, (n) => (n.id === id ? { ...n, collapsed: !n.collapsed } : n));
}

/** Cycles null -> false -> true -> null (plain bullet, unchecked box, checked box). */
export function cycleChecked(tree: OutlineNode[], id: string): OutlineNode[] {
  return mapTree(tree, (n) => {
    if (n.id !== id) return n;
    const next = n.checked === null ? false : n.checked === false ? true : null;
    return { ...n, checked: next };
  });
}

/** Inserts a new sibling right after `id`, at the same depth. Returns the new tree + new node id. */
export function insertSiblingAfter(tree: OutlineNode[], id: string, text = ''): { tree: OutlineNode[]; id: string } {
  const node = newNode(text);
  const loc = locate(tree, id);
  if (!loc) return { tree, id: node.id };
  const sibs = [...loc.parent];
  sibs.splice(loc.index + 1, 0, node);
  const next = replaceSiblings(tree, loc, sibs);
  return { tree: next, id: node.id };
}

/** Replaces the sibling array a located node lives in, by walking down its ancestor chain. */
function replaceSiblings(tree: OutlineNode[], loc: Loc, newSibs: OutlineNode[]): OutlineNode[] {
  if (loc.ancestors.length === 0) return newSibs;
  const [rootAncestor] = loc.ancestors;
  const setChildren = (nodes: OutlineNode[], chain: OutlineNode[]): OutlineNode[] => nodes.map((n) => {
    if (n.id !== chain[0].id) return n;
    if (chain.length === 1) return { ...n, children: newSibs };
    return { ...n, children: setChildren(n.children, chain.slice(1)) };
  });
  return setChildren(tree, [rootAncestor, ...loc.ancestors.slice(1)]);
}

/** Moves a node to become the last child of its previous sibling. No-op on the first sibling. */
export function indentNode(tree: OutlineNode[], id: string): OutlineNode[] {
  const loc = locate(tree, id);
  if (!loc || loc.index === 0) return tree;
  const prevSibling = loc.parent[loc.index - 1];
  const withoutNode = [...loc.parent];
  withoutNode.splice(loc.index, 1);
  const rehomed = withoutNode.map((n) => (n.id === prevSibling.id ? { ...n, children: [...n.children, { ...loc.node, collapsed: false }] } : n));
  return replaceSiblings(tree, loc, rehomed);
}

/** Moves a node to become the next sibling of its parent. No-op on a root node. */
export function outdentNode(tree: OutlineNode[], id: string): OutlineNode[] {
  const loc = locate(tree, id);
  if (!loc || loc.ancestors.length === 0) return tree;
  const parentNode = loc.ancestors[loc.ancestors.length - 1];
  const grandLoc = locate(tree, parentNode.id)!;
  const withoutNode = [...loc.parent];
  withoutNode.splice(loc.index, 1);
  const afterUpdate = replaceSiblings(tree, loc, withoutNode);

  const grandSibsLoc = locate(afterUpdate, parentNode.id)!;
  const grandSibs = [...grandSibsLoc.parent];
  grandSibs.splice(grandSibsLoc.index + 1, 0, loc.node);
  return replaceSiblings(afterUpdate, grandSibsLoc, grandSibs);
}

/** Removes a leaf node (one with no children). No-op if it has children. */
export function deleteNode(tree: OutlineNode[], id: string): OutlineNode[] {
  const loc = locate(tree, id);
  if (!loc || loc.node.children.length > 0) return tree;
  const sibs = [...loc.parent];
  sibs.splice(loc.index, 1);
  return replaceSiblings(tree, loc, sibs);
}

function swap<T>(arr: T[], i: number, j: number): T[] {
  const out = [...arr];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

export function moveUp(tree: OutlineNode[], id: string): OutlineNode[] {
  const loc = locate(tree, id);
  if (!loc || loc.index === 0) return tree;
  return replaceSiblings(tree, loc, swap(loc.parent, loc.index, loc.index - 1));
}

export function moveDown(tree: OutlineNode[], id: string): OutlineNode[] {
  const loc = locate(tree, id);
  if (!loc || loc.index === loc.parent.length - 1) return tree;
  return replaceSiblings(tree, loc, swap(loc.parent, loc.index, loc.index + 1));
}

export function previousVisibleId(tree: OutlineNode[], id: string): string | null {
  const rows = flattenVisible(tree);
  const i = rows.findIndex((r) => r.node.id === id);
  return i > 0 ? rows[i - 1].node.id : null;
}

export function nextVisibleId(tree: OutlineNode[], id: string): string | null {
  const rows = flattenVisible(tree);
  const i = rows.findIndex((r) => r.node.id === id);
  return i >= 0 && i < rows.length - 1 ? rows[i + 1].node.id : null;
}

// ---------------------------------------------------------------- markdown mirror

/** Serializes the tree into the nested-bullet markdown syntax core/markdown.ts already parses. */
export function outlineToMarkdown(tree: OutlineNode[]): string {
  const lines: string[] = [];
  const walk = (nodes: OutlineNode[], depth: number) => {
    for (const n of nodes) {
      const indent = '  '.repeat(depth);
      const marker = n.checked === null ? '-' : n.checked ? '- [x]' : '- [ ]';
      lines.push(`${indent}${marker} ${n.text}`);
      walk(n.children, depth + 1);
    }
  };
  walk(tree, 0);
  return lines.join('\n');
}
