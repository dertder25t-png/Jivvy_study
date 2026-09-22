import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  cycleChecked, deleteNode, flattenVisible, indentNode, insertSiblingAfter, moveDown, moveUp,
  nextVisibleId, outdentNode, previousVisibleId, toggleCollapsed, updateNodeText, type OutlineNode,
} from '@/core/outline';
import { BODY_SIZE } from './Markdown';
import { useColors } from './theme';

const GUIDE_WIDTH = 22;
const CHEVRON_WIDTH = 18;
const BULLET_WIDTH = 20;

function bulletGlyph(depth: number, checked: boolean | null): string {
  if (checked === true) return '☑';
  if (checked === false) return '☐';
  return depth % 2 ? '◦' : '•';
}

interface RowProps {
  node: OutlineNode;
  depth: number;
  hasChildren: boolean;
  focused: boolean;
  registerRef: (id: string, ref: TextInput | null) => void;
  selection: { start: number; end: number } | undefined;
  onFocus: () => void;
  onBlur: () => void;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  onKeyPress: (key: string, shiftKey: boolean) => void;
  onSelectionChange: (sel: { start: number; end: number }) => void;
  onToggleCollapsed: () => void;
  onToggleChecked: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function Row({
  node, depth, hasChildren, focused, registerRef, selection, onFocus, onBlur,
  onChangeText, onSubmit, onKeyPress, onSelectionChange, onToggleCollapsed, onToggleChecked, onMoveUp, onMoveDown,
}: RowProps) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', minHeight: 32 }}>
      {Array.from({ length: depth }).map((_, level) => (
        <View key={level} style={{ width: GUIDE_WIDTH, alignSelf: 'stretch', alignItems: 'center' }}>
          <View style={{ width: 1, flex: 1, backgroundColor: c.border }} />
        </View>
      ))}
      <View style={{ width: CHEVRON_WIDTH, paddingTop: 7, alignItems: 'center' }}>
        {hasChildren ? (
          <Pressable onPress={onToggleCollapsed} hitSlop={8} accessibilityRole="button" accessibilityLabel={node.collapsed ? 'Expand' : 'Collapse'}>
            <Ionicons name={node.collapsed ? 'chevron-forward' : 'chevron-down'} size={14} color={c.muted} />
          </Pressable>
        ) : null}
      </View>
      <Pressable onPress={onToggleChecked} hitSlop={8} style={{ width: BULLET_WIDTH, paddingTop: 6, alignItems: 'center' }} accessibilityRole="button" accessibilityLabel="Toggle checkbox">
        <Text style={{ color: c.muted, fontSize: BODY_SIZE }}>{bulletGlyph(depth, node.checked)}</Text>
      </Pressable>
      <TextInput
        ref={(r) => registerRef(node.id, r)}
        value={node.text}
        onChangeText={onChangeText}
        onFocus={onFocus}
        onBlur={onBlur}
        onSubmitEditing={onSubmit}
        blurOnSubmit={false}
        onKeyPress={(e: any) => {
          if (e.nativeEvent.key === 'Tab') e.preventDefault?.();
          onKeyPress(e.nativeEvent.key, !!e.shiftKey);
        }}
        onSelectionChange={(e) => onSelectionChange(e.nativeEvent.selection)}
        selection={selection}
        placeholder={depth === 0 ? 'Start typing…' : undefined}
        placeholderTextColor={c.muted}
        style={{
          flex: 1, color: node.checked ? c.muted : c.text, fontSize: BODY_SIZE, lineHeight: BODY_SIZE + 6,
          textDecorationLine: node.checked ? 'line-through' : 'none', paddingVertical: 5, paddingHorizontal: 0,
          borderWidth: 0, backgroundColor: 'transparent',
          ...(Platform.OS === 'web' ? ({ outlineStyle: 'none', outlineWidth: 0 } as object) : {}),
        }}
      />
      {focused ? (
        <View style={{ flexDirection: 'row', gap: 2, paddingTop: 4 }}>
          <Pressable onPress={onMoveUp} hitSlop={8} accessibilityRole="button" accessibilityLabel="Move up">
            <Ionicons name="chevron-up" size={16} color={c.muted} />
          </Pressable>
          <Pressable onPress={onMoveDown} hitSlop={8} accessibilityRole="button" accessibilityLabel="Move down">
            <Ionicons name="chevron-down" size={16} color={c.muted} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export function OutlineEditor({ nodes, onChange, autoFocus }: { nodes: OutlineNode[]; onChange: (nodes: OutlineNode[]) => void; autoFocus?: boolean }) {
  const rows = flattenVisible(nodes);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [pendingSelection, setPendingSelection] = useState<{ id: string; pos: number } | null>(null);
  const refs = useRef(new Map<string, TextInput | null>());
  const pendingFocus = useRef<string | null>(null);
  const selections = useRef(new Map<string, { start: number; end: number }>());

  const registerRef = (id: string, ref: TextInput | null) => {
    if (ref) refs.current.set(id, ref);
    else refs.current.delete(id);
  };

  useEffect(() => {
    if (autoFocus && rows.length > 0) refs.current.get(rows[0].node.id)?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus a newly-inserted row once it exists in the DOM.
  useEffect(() => {
    if (!pendingFocus.current) return;
    const ref = refs.current.get(pendingFocus.current);
    if (ref) {
      ref.focus();
      pendingFocus.current = null;
    }
  }, [nodes]);

  // A controlled `selection` needs to be cleared after one render or it pins the cursor there forever.
  useEffect(() => {
    if (!pendingSelection) return;
    const t = setTimeout(() => setPendingSelection(null), 0);
    return () => clearTimeout(t);
  }, [pendingSelection]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      if (!focusedId || !e.altKey) return;
      if (e.key === 'ArrowUp') { e.preventDefault(); onChange(moveUp(nodes, focusedId)); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); onChange(moveDown(nodes, focusedId)); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedId, nodes]);

  const handleSubmit = (id: string) => {
    const { tree, id: newId } = insertSiblingAfter(nodes, id, '');
    pendingFocus.current = newId;
    onChange(tree);
  };

  const handleKeyPress = (id: string, key: string, shiftKey: boolean) => {
    if (key === 'Tab') {
      onChange(shiftKey ? outdentNode(nodes, id) : indentNode(nodes, id));
      return;
    }
    if (key === 'Backspace') {
      const sel = selections.current.get(id);
      const node = rows.find((r) => r.node.id === id)?.node;
      if (!node || node.text !== '' || node.children.length > 0 || rows.length <= 1) return;
      if (sel && sel.start !== 0) return;
      const prevId = previousVisibleId(nodes, id);
      if (!prevId) return;
      const prevText = rows.find((r) => r.node.id === prevId)?.node.text ?? '';
      pendingFocus.current = prevId;
      setPendingSelection({ id: prevId, pos: prevText.length });
      onChange(deleteNode(nodes, id));
      return;
    }
    if (key === 'ArrowUp') {
      const prevId = previousVisibleId(nodes, id);
      if (prevId) refs.current.get(prevId)?.focus();
      return;
    }
    if (key === 'ArrowDown') {
      const nId = nextVisibleId(nodes, id);
      if (nId) refs.current.get(nId)?.focus();
    }
  };

  return (
    <View>
      {rows.map(({ node, depth }) => (
        <Row
          key={node.id}
          node={node}
          depth={depth}
          hasChildren={node.children.length > 0}
          focused={focusedId === node.id}
          registerRef={registerRef}
          selection={pendingSelection?.id === node.id ? { start: pendingSelection.pos, end: pendingSelection.pos } : undefined}
          onFocus={() => setFocusedId(node.id)}
          onBlur={() => setFocusedId((cur) => (cur === node.id ? null : cur))}
          onChangeText={(text) => onChange(updateNodeText(nodes, node.id, text))}
          onSubmit={() => handleSubmit(node.id)}
          onKeyPress={(key, shiftKey) => handleKeyPress(node.id, key, shiftKey)}
          onSelectionChange={(sel) => selections.current.set(node.id, sel)}
          onToggleCollapsed={() => onChange(toggleCollapsed(nodes, node.id))}
          onToggleChecked={() => onChange(cycleChecked(nodes, node.id))}
          onMoveUp={() => onChange(moveUp(nodes, node.id))}
          onMoveDown={() => onChange(moveDown(nodes, node.id))}
        />
      ))}
    </View>
  );
}
