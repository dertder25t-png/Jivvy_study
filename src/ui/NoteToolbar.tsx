import React, { useRef } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from './theme';
import { T } from './components';

interface ToolbarButton {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  shortcut?: string;
  onPress: () => void;
  group?: string;
}

interface NoteToolbarProps {
  onInsertMarkdown: (before: string, after?: string) => void;
}

function ToolbarBtn({
  icon, label, shortcut, onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  shortcut?: string;
  onPress: () => void;
}) {
  const c = useColors();
  const [pressed, setPressed] = React.useState(false);

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={shortcut ? `${label} (${shortcut})` : label}
      style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 6, opacity: pressed ? 0.6 : 1 }}
    >
      <Ionicons name={icon} size={18} color={c.text} />
    </Pressable>
  );
}

export function NoteToolbar({ onInsertMarkdown }: NoteToolbarProps) {
  const c = useColors();

  const buttons: ToolbarButton[] = [
    // Headings
    {
      icon: 'text',
      label: 'Heading 1',
      shortcut: 'Ctrl+Alt+1',
      onPress: () => onInsertMarkdown('# ', '\n'),
      group: 'heading',
    },
    {
      icon: 'text',
      label: 'Heading 2',
      shortcut: 'Ctrl+Alt+2',
      onPress: () => onInsertMarkdown('## ', '\n'),
      group: 'heading',
    },
    {
      icon: 'text',
      label: 'Heading 3',
      shortcut: 'Ctrl+Alt+3',
      onPress: () => onInsertMarkdown('### ', '\n'),
      group: 'heading',
    },

    // Text formatting
    {
      icon: 'checkmark-done',
      label: 'Bold',
      shortcut: Platform.OS === 'web' ? 'Ctrl+B' : 'Cmd+B',
      onPress: () => onInsertMarkdown('**', '**'),
      group: 'format',
    },
    {
      icon: 'code-outline',
      label: 'Italic',
      shortcut: Platform.OS === 'web' ? 'Ctrl+I' : 'Cmd+I',
      onPress: () => onInsertMarkdown('*', '*'),
      group: 'format',
    },
    {
      icon: 'close-circle-outline',
      label: 'Strikethrough',
      onPress: () => onInsertMarkdown('~~', '~~'),
      group: 'format',
    },
    {
      icon: 'star-outline',
      label: 'Highlight',
      onPress: () => onInsertMarkdown('==', '=='),
      group: 'format',
    },

    // Lists
    {
      icon: 'list',
      label: 'Bullet List',
      onPress: () => onInsertMarkdown('- ', '\n'),
      group: 'list',
    },
    {
      icon: 'list-outline',
      label: 'Numbered List',
      onPress: () => onInsertMarkdown('1. ', '\n'),
      group: 'list',
    },
    {
      icon: 'checkbox-outline',
      label: 'Task List',
      onPress: () => onInsertMarkdown('- [ ] ', '\n'),
      group: 'list',
    },

    // Blocks
    {
      icon: 'chatbubble-outline',
      label: 'Quote',
      onPress: () => onInsertMarkdown('> ', '\n'),
      group: 'block',
    },
    {
      icon: 'code-slash',
      label: 'Code Block',
      onPress: () => onInsertMarkdown('```\n', '\n```'),
      group: 'block',
    },
    {
      icon: 'grid-outline',
      label: 'Table',
      onPress: () => onInsertMarkdown('| Header 1 | Header 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |\n', ''),
      group: 'block',
    },

    // Links
    {
      icon: 'link',
      label: 'Link',
      shortcut: Platform.OS === 'web' ? 'Ctrl+K' : 'Cmd+K',
      onPress: () => onInsertMarkdown('[', '](url)'),
      group: 'link',
    },
    {
      icon: 'document-text-outline',
      label: 'Wiki Link',
      onPress: () => onInsertMarkdown('[[', ']]'),
      group: 'link',
    },
  ];

  const groups = ['heading', 'format', 'list', 'block', 'link'];

  return (
    <View style={{ backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 12,
          paddingVertical: 8,
          gap: 4,
          alignItems: 'center',
        }}
      >
        {groups.map((group, groupIdx) => (
          <React.Fragment key={group}>
            <View style={{ flexDirection: 'row', gap: 4 }}>
              {buttons
                .filter((b) => b.group === group)
                .map((btn) => (
                  <ToolbarBtn
                    key={btn.label}
                    icon={btn.icon}
                    label={btn.label}
                    shortcut={btn.shortcut}
                    onPress={btn.onPress}
                  />
                ))}
            </View>
            {groupIdx < groups.length - 1 ? (
              <View style={{ width: 1, height: 20, backgroundColor: c.border, marginHorizontal: 4 }} />
            ) : null}
          </React.Fragment>
        ))}
      </ScrollView>
    </View>
  );
}
