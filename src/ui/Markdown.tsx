import React from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text, View, type TextStyle } from 'react-native';
import { parseBlocks, type Block, type Inline, type ListItem } from '@/core/markdown';
import { useColors, type Colors } from './theme';

const HEADING_SIZE = [0, 32, 26, 22, 19, 17, 16];
const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' });

export const BODY_SIZE = 17;
export const BODY_LINE = 28;

function calloutColors(kind: string, c: Colors): { bg: string; fg: string; icon: string } {
  switch (kind) {
    case 'tip': case 'success': case 'check': case 'done':
      return { bg: c.goodSoft, fg: c.good, icon: '✓' };
    case 'warning': case 'caution': case 'attention': case 'danger': case 'error': case 'bug': case 'important':
      return { bg: c.warnSoft, fg: c.warn, icon: '!' };
    case 'quote': case 'cite':
      return { bg: c.surfaceAlt, fg: c.muted, icon: '“' };
    default: // note, info, abstract, todo, example, question…
      return { bg: c.primarySoft, fg: c.primary, icon: '✎' };
  }
}

function InlineText({ nodes, base }: { nodes: Inline[]; base?: TextStyle }) {
  const c = useColors();
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case 'text':
            return <Text key={i}>{n.v}</Text>;
          case 'bold':
            return <Text key={i} style={{ fontWeight: '700' }}><InlineText nodes={n.c} /></Text>;
          case 'italic':
            return <Text key={i} style={{ fontStyle: 'italic' }}><InlineText nodes={n.c} /></Text>;
          case 'strike':
            return <Text key={i} style={{ textDecorationLine: 'line-through', color: c.muted }}><InlineText nodes={n.c} /></Text>;
          case 'mark':
            return <Text key={i} style={{ backgroundColor: c.warnSoft, color: c.text }}><InlineText nodes={n.c} /></Text>;
          case 'code':
            return <Text key={i} style={{ fontFamily: MONO, fontSize: (base?.fontSize ?? BODY_SIZE) - 2, backgroundColor: c.surfaceAlt }}>{` ${n.v} `}</Text>;
          case 'link':
            return (
              <Text key={i} style={{ color: c.primary, textDecorationLine: 'underline' }} onPress={() => void Linking.openURL(n.href).catch(() => {})}>
                <InlineText nodes={n.c} />
              </Text>
            );
        }
      })}
    </>
  );
}

function ListView({ items }: { items: ListItem[] }) {
  const c = useColors();
  return (
    <View style={{ gap: 4 }}>
      {items.map((it, i) => (
        <View key={i} style={{ flexDirection: 'row', paddingLeft: it.depth * 22, gap: 8 }}>
          <Text style={{ color: c.muted, fontSize: BODY_SIZE, lineHeight: BODY_LINE, width: it.ordered ? 24 : 12, textAlign: it.ordered ? 'right' : 'center' }}>
            {it.task === null ? (it.ordered ? `${it.n}.` : it.depth % 2 ? '◦' : '•') : it.task ? '☑' : '☐'}
          </Text>
          <Text
            selectable
            style={{
              flex: 1, color: it.task ? c.muted : c.text, fontSize: BODY_SIZE, lineHeight: BODY_LINE,
              textDecorationLine: it.task ? 'line-through' : 'none',
            }}
          >
            <InlineText nodes={it.inline} />
          </Text>
        </View>
      ))}
    </View>
  );
}

function BlockView({ b }: { b: Block }) {
  const c = useColors();
  switch (b.t) {
    case 'heading': {
      const size = HEADING_SIZE[b.level] ?? 16;
      return (
        <Text
          selectable
          style={{
            color: b.level >= 5 ? c.muted : c.text, fontSize: size, lineHeight: size * 1.3, fontWeight: '700',
            marginTop: b.level <= 2 ? 10 : 4, letterSpacing: b.level === 1 ? -0.5 : 0,
          }}
        >
          <InlineText nodes={b.inline} base={{ fontSize: size }} />
        </Text>
      );
    }
    case 'para':
      return (
        <Text selectable style={{ color: c.text, fontSize: BODY_SIZE, lineHeight: BODY_LINE }}>
          <InlineText nodes={b.inline} />
        </Text>
      );
    case 'hr':
      return <View style={{ height: StyleSheet.hairlineWidth * 2, backgroundColor: c.border, marginVertical: 12 }} />;
    case 'code':
      return (
        <ScrollView horizontal style={{ backgroundColor: c.surfaceAlt, borderRadius: 8 }} contentContainerStyle={{ padding: 12 }}>
          <Text selectable style={{ fontFamily: MONO, fontSize: 14, lineHeight: 20, color: c.text }}>{b.text}</Text>
        </ScrollView>
      );
    case 'quote':
      return (
        <View style={{ borderLeftWidth: 3, borderLeftColor: c.border, paddingLeft: 14, gap: 8 }}>
          {b.blocks.map((x, i) => <BlockView key={i} b={x} />)}
        </View>
      );
    case 'callout': {
      const k = calloutColors(b.kind, c);
      return (
        <View style={{ backgroundColor: k.bg, borderRadius: 10, padding: 16, gap: 10 }}>
          <Text selectable style={{ color: k.fg, fontSize: BODY_SIZE, fontWeight: '600', lineHeight: BODY_LINE }}>
            {k.icon}  <InlineText nodes={b.title} />
          </Text>
          {b.blocks.map((x, i) => <BlockView key={i} b={x} />)}
        </View>
      );
    }
    case 'list':
      return <ListView items={b.items} />;
    case 'table':
      return (
        <ScrollView horizontal>
          <View style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, borderRadius: 8, overflow: 'hidden' }}>
            {[b.header, ...b.rows].map((row, ri) => (
              <View key={ri} style={{ flexDirection: 'row', backgroundColor: ri === 0 ? c.surfaceAlt : 'transparent' }}>
                {row.map((cell, ci) => (
                  <View key={ci} style={{ minWidth: 110, padding: 10, borderRightWidth: StyleSheet.hairlineWidth, borderTopWidth: ri ? StyleSheet.hairlineWidth : 0, borderColor: c.border }}>
                    <Text selectable style={{ color: c.text, fontSize: 15, fontWeight: ri === 0 ? '700' : '400' }}>
                      <InlineText nodes={cell} />
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      );
  }
}

/** Rendered (reading) view of a note. Purely presentational — the note stays plain text. */
export function Markdown({ source }: { source: string }) {
  const blocks = React.useMemo(() => parseBlocks(source), [source]);
  return (
    <View style={{ gap: 14 }}>
      {blocks.map((b, i) => <BlockView key={i} b={b} />)}
    </View>
  );
}
