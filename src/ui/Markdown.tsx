import React from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text, View, type TextStyle } from 'react-native';
import { parseBlocks, type Block, type Inline, type ListItem } from '@/core/markdown';
import { useColors, type Colors } from './theme';

const HEADING_SIZE = [0, 38, 32, 26, 22, 19, 17];
const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' });

export const BODY_SIZE = 17;
export const BODY_LINE = 28;

// Obsidian-like colors for callouts
const CALLOUT_ICONS: Record<string, string> = {
  'note': '📝',
  'abstract': '📋',
  'summary': '📋',
  'tldr': '📋',
  'info': '💡',
  'todo': '✓',
  'tip': '✓',
  'success': '✓',
  'check': '✓',
  'done': '✓',
  'question': '❓',
  'help': '❓',
  'faq': '❓',
  'warning': '⚠️',
  'caution': '⚠️',
  'attention': '⚠️',
  'failure': '❌',
  'fail': '❌',
  'missing': '❌',
  'danger': '❌',
  'error': '❌',
  'bug': '🐛',
  'example': '📌',
  'quote': '💬',
  'cite': '💬',
};

function calloutColors(kind: string, c: Colors): { bg: string; fg: string; icon: string; borderColor: string } {
  switch (kind) {
    case 'tip': case 'success': case 'check': case 'done':
      return { bg: c.goodSoft, fg: c.good, icon: CALLOUT_ICONS[kind] || '✓', borderColor: c.good };
    case 'warning': case 'caution': case 'attention': case 'danger': case 'error': case 'bug': case 'important':
      return { bg: c.warnSoft, fg: c.warn, icon: CALLOUT_ICONS[kind] || '⚠️', borderColor: c.warn };
    case 'quote': case 'cite':
      return { bg: c.surfaceAlt, fg: c.muted, icon: CALLOUT_ICONS[kind] || '💬', borderColor: c.muted };
    default: // note, info, abstract, todo, example, question…
      return { bg: c.primarySoft, fg: c.primary, icon: CALLOUT_ICONS[kind] || '📝', borderColor: c.primary };
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
      const isSmallHeading = b.level >= 4;
      return (
        <View>
          <Text
            selectable
            style={{
              color: b.level >= 5 ? c.muted : c.text,
              fontSize: size,
              lineHeight: size * 1.4,
              fontWeight: b.level === 1 ? '800' : '700',
              marginTop: b.level <= 2 ? 16 : b.level === 3 ? 12 : 8,
              marginBottom: b.level <= 2 ? 8 : 4,
              letterSpacing: b.level === 1 ? -0.5 : 0,
            }}
          >
            <InlineText nodes={b.inline} base={{ fontSize: size }} />
          </Text>
          {b.level === 1 || b.level === 2 ? (
            <View style={{ height: b.level === 1 ? 2 : 1, backgroundColor: c.border, marginTop: 4, marginBottom: 8 }} />
          ) : null}
        </View>
      );
    }
    case 'para':
      return (
        <Text selectable style={{ color: c.text, fontSize: BODY_SIZE, lineHeight: BODY_LINE, marginVertical: 2 }}>
          <InlineText nodes={b.inline} />
        </Text>
      );
    case 'hr':
      return <View style={{ height: 1, backgroundColor: c.border, marginVertical: 16 }} />;
    case 'code': {
      const lines = b.text.split('\n');
      const lang = b.lang || 'code';
      return (
        <View style={{ marginVertical: 8 }}>
          {b.lang ? (
            <View style={{ backgroundColor: c.surfaceAlt, paddingHorizontal: 12, paddingVertical: 6, borderTopLeftRadius: 8, borderTopRightRadius: 8 }}>
              <Text style={{ fontSize: 12, color: c.muted, fontFamily: MONO }}>{lang}</Text>
            </View>
          ) : null}
          <ScrollView
            horizontal
            style={{
              backgroundColor: c.surfaceAlt,
              borderBottomLeftRadius: 8,
              borderBottomRightRadius: 8,
            }}
            contentContainerStyle={{ padding: 12 }}
          >
            <View>
              {lines.map((line, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 12 }}>
                  <Text style={{
                    fontSize: 12,
                    color: c.muted,
                    fontFamily: MONO,
                    width: 30,
                    textAlign: 'right',
                  }}>
                    {i + 1}
                  </Text>
                  <Text
                    selectable
                    style={{
                      fontFamily: MONO,
                      fontSize: 14,
                      lineHeight: 20,
                      color: c.text,
                      minWidth: 200,
                    }}
                  >
                    {line || ' '}
                  </Text>
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      );
    }
    case 'quote':
      return (
        <View style={{
          borderLeftWidth: 4,
          borderLeftColor: c.muted,
          paddingLeft: 16,
          paddingVertical: 8,
          gap: 8,
          opacity: 0.8,
        }}>
          {b.blocks.map((x, i) => <BlockView key={i} b={x} />)}
        </View>
      );
    case 'callout': {
      const k = calloutColors(b.kind, c);
      return (
        <View style={{
          backgroundColor: k.bg,
          borderLeftWidth: 4,
          borderLeftColor: k.borderColor,
          borderRadius: 6,
          padding: 16,
          gap: 10,
          marginVertical: 4,
        }}>
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
        <ScrollView horizontal style={{ marginVertical: 8 }}>
          <View style={{ borderWidth: 1, borderColor: c.border, borderRadius: 8, overflow: 'hidden' }}>
            {[b.header, ...b.rows].map((row, ri) => (
              <View
                key={ri}
                style={{
                  flexDirection: 'row',
                  backgroundColor: ri === 0 ? c.surfaceAlt : ri % 2 === 1 ? c.bg : c.surface,
                }}
              >
                {row.map((cell, ci) => (
                  <View
                    key={ci}
                    style={{
                      minWidth: 120,
                      paddingVertical: 12,
                      paddingHorizontal: 14,
                      borderRightWidth: ci < row.length - 1 ? StyleSheet.hairlineWidth : 0,
                      borderBottomWidth: ri < b.rows.length ? StyleSheet.hairlineWidth : 0,
                      borderColor: c.border,
                    }}
                  >
                    <Text
                      selectable
                      style={{
                        color: c.text,
                        fontSize: 14,
                        fontWeight: ri === 0 ? '700' : '500',
                        lineHeight: 20,
                      }}
                    >
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
