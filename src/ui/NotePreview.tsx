import React from 'react';
import { ScrollView, View } from 'react-native';
import { Markdown } from './Markdown';
import { useColors } from './theme';
import { T } from './components';

interface NotePreviewProps {
  markdown: string;
}

export function NotePreview({ markdown }: NotePreviewProps) {
  const c = useColors();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg, borderLeftWidth: 1, borderLeftColor: c.border }}
      contentContainerStyle={{
        paddingHorizontal: 24,
        paddingVertical: 12,
        paddingBottom: 90,
      }}
    >
      {markdown.trim() ? (
        <Markdown source={markdown} />
      ) : (
        <T muted style={{ textAlign: 'center', marginTop: 20 }}>
          Preview will appear here…
        </T>
      )}
    </ScrollView>
  );
}
