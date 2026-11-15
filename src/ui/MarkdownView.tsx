import React from 'react';
import { Linking, Platform, Pressable, ScrollView, Text, View, type TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { parseBlocks, type Block, type Inline } from '@/core/markdown';
import { useColors, type Colors } from './theme';

const SIZE = 17;
const LINE = 27;
export const MONO = Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', ios: 'Menlo', default: 'monospace' });
const HEADING_SIZE = [0, 30, 25, 21, 19, 17, 16];

const CALLOUT_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  note: 'pencil', info: 'information-circle', tip: 'flame', hint: 'flame', important: 'flame', success: 'checkmark-circle',
  question: 'help-circle', warning: 'warning', caution: 'warning', danger: 'flash', failure: 'close-circle', bug: 'bug',
  example: 'list', quote: 'chatbox-ellipses', abstract: 'clipboard', summary: 'clipboard', todo: 'checkbox',
};

function Inlines({ nodes, c }: { nodes: Inline[]; c: Colors }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case 'text': return <React.Fragment key={i}>{n.v}</React.Fragment>;
          case 'bold': return <Text key={i} style={{ fontWeight: '700' }}><Inlines nodes={n.c} c={c} /></Text>;
          case 'italic': return <Text key={i} style={{ fontStyle: 'italic' }}><Inlines nodes={n.c} c={c} /></Text>;
          case 'strike': return <Text key={i} style={{ textDecorationLine: 'line-through' }}><Inlines nodes={n.c} c={c} /></Text>;
          case 'mark': return <Text key={i} style={{ backgroundColor: c.warnSoft }}><Inlines nodes={n.c} c={c} /></Text>;
          case 'code': return <Text key={i} style={{ fontFamily: MONO, fontSize: SIZE - 2, backgroundColor: c.surfaceAlt }}>{` ${n.v} `}</Text>;
          case 'link':
            return (
              <Text key={i} style={{ color: c.primary, textDecorationLine: 'underline' }} onPress={() => { void Linking.openURL(n.href).catch(() => {}); }}>
                <Inlines nodes={n.c} c={c} />
              </Text>
            );
          default: return null;
        }
      })}
    </>
  );
}

interface Ctx {
  c: Colors;
  /** Counts task checkboxes in reading order, so a tap maps back to the right line of source. */
  task: { n: number };
  onToggleTask?: (index: number) => void;
  /** Inside a quote/callout: tasks there aren't clickable (they're behind "> " in the source). */
  nested: boolean;
}

function Blocks({ blocks, ctx }: { blocks: Block[]; ctx: Ctx }) {
  const { c } = ctx;
  const body: TextStyle = { color: c.text, fontSize: SIZE, lineHeight: LINE };
  return (
    <>
      {blocks.map((b, i) => {
        const key = `${i}`;
        switch (b.t) {
          case 'heading':
            return (
              <Text key={key} selectable style={{ ...body, fontSize: HEADING_SIZE[b.level], lineHeight: HEADING_SIZE[b.level] * 1.3, fontWeight: b.level <= 2 ? '700' : '600', marginTop: b.level <= 2 ? 14 : 8 }}>
                <Inlines nodes={b.inline} c={c} />
              </Text>
            );
          case 'para':
            return <Text key={key} selectable style={body}><Inlines nodes={b.inline} c={c} /></Text>;
          case 'hr':
            return <View key={key} style={{ height: 1, backgroundColor: c.border, marginVertical: 10 }} />;
          case 'code':
            return (
              <ScrollView key={key} horizontal style={{ backgroundColor: c.surfaceAlt, borderRadius: 8 }} contentContainerStyle={{ padding: 12 }}>
                <Text selectable style={{ fontFamily: MONO, fontSize: SIZE - 3, lineHeight: LINE - 4, color: c.text }}>{b.text}</Text>
              </ScrollView>
            );
          case 'quote':
            return (
              <View key={key} style={{ borderLeftWidth: 3, borderLeftColor: c.border, paddingLeft: 14, gap: 8 }}>
                <Blocks blocks={b.blocks} ctx={{ ...ctx, nested: true }} />
              </View>
            );
          case 'callout':
            return (
              <View key={key} style={{ backgroundColor: c.primarySoft, borderRadius: 8, padding: 12, gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name={CALLOUT_ICON[b.kind] ?? 'pencil'} size={16} color={c.primary} />
                  <Text selectable style={{ ...body, fontWeight: '600', color: c.primary }}><Inlines nodes={b.title} c={c} /></Text>
                </View>
                <Blocks blocks={b.blocks} ctx={{ ...ctx, nested: true }} />
              </View>
            );
          case 'list':
            return (
              <View key={key} style={{ gap: 2 }}>
                {b.items.map((it, j) => {
                  let marker: React.ReactNode;
                  if (it.task !== null) {
                    const index = ctx.nested ? -1 : ctx.task.n++;
                    const icon = <Ionicons name={it.task ? 'checkbox' : 'square-outline'} size={19} color={it.task ? c.primary : c.muted} />;
                    marker = ctx.onToggleTask && index >= 0 ? (
                      <Pressable onPress={() => ctx.onToggleTask?.(index)} hitSlop={6} accessibilityRole="checkbox" accessibilityState={{ checked: it.task }}>{icon}</Pressable>
                    ) : icon;
                  } else {
                    marker = <Text style={{ ...body, color: c.muted }}>{it.ordered ? `${it.n}.` : it.depth % 2 ? '◦' : '•'}</Text>;
                  }
                  return (
                    <View key={j} style={{ flexDirection: 'row', paddingLeft: it.depth * 24 }}>
                      <View style={{ width: 26, height: LINE, justifyContent: 'center' }}>{marker}</View>
                      <Text selectable style={{ ...body, flex: 1, ...(it.task ? { color: c.muted, textDecorationLine: 'line-through' } : null) }}>
                        <Inlines nodes={it.inline} c={c} />
                      </Text>
                    </View>
                  );
                })}
              </View>
            );
          case 'table':
            return (
              <ScrollView key={key} horizontal>
                <View style={{ borderWidth: 1, borderColor: c.border, borderRadius: 6 }}>
                  {[b.header, ...b.rows].map((row, r) => (
                    <View key={r} style={{ flexDirection: 'row', backgroundColor: r === 0 ? c.surfaceAlt : 'transparent', borderTopWidth: r ? 1 : 0, borderColor: c.border }}>
                      {row.map((cell, k) => (
                        <Text key={k} selectable style={{ ...body, minWidth: 120, paddingHorizontal: 10, paddingVertical: 6, fontWeight: r === 0 ? '600' : '400' }}>
                          <Inlines nodes={cell} c={c} />
                        </Text>
                      ))}
                    </View>
                  ))}
                </View>
              </ScrollView>
            );
          default:
            return null;
        }
      })}
    </>
  );
}

/** Reading view: the note's markdown rendered, with selectable text and tappable checkboxes. */
export function MarkdownView({ text, onToggleTask }: { text: string; onToggleTask?: (index: number) => void }) {
  const c = useColors();
  const blocks = parseBlocks(text);
  if (blocks.length === 0) {
    return <Text style={{ color: c.muted, fontSize: SIZE, lineHeight: LINE, paddingVertical: 5 }}>Nothing here yet — switch to editing to start writing.</Text>;
  }
  return (
    <View style={{ gap: 10, paddingVertical: 5 }}>
      <Blocks blocks={blocks} ctx={{ c, task: { n: 0 }, onToggleTask, nested: false }} />
    </View>
  );
}
