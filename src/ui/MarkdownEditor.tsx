import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { Platform, TextInput } from 'react-native';
import { checkboxKey, enterKey, indentKey, wrapKey, type Edit, type Sel } from '@/core/noteText';
import { useColors } from './theme';

const SIZE = 17;
const LINE = 27;
const WEB = Platform.OS === 'web';

export interface MarkdownEditorHandle {
  focus: () => void;
}

/** The nearest scrolling ancestor, so growing the textarea doesn't make the page jump. */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/**
 * Applies an edit through the browser's own text insertion so Ctrl+Z still undoes it. Only the part
 * that changed is replaced. Returns false if the browser refused (then the caller sets the value).
 */
function applyNative(el: HTMLTextAreaElement, before: string, edit: Edit): boolean {
  let a = 0;
  while (a < before.length && a < edit.text.length && before[a] === edit.text[a]) a++;
  let b = 0;
  while (b < before.length - a && b < edit.text.length - a && before[before.length - 1 - b] === edit.text[edit.text.length - 1 - b]) b++;
  el.focus();
  el.setSelectionRange(a, before.length - b);
  const insert = edit.text.slice(a, edit.text.length - b);
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const ok = insert ? document.execCommand('insertText', false, insert) : document.execCommand('delete', false);
  if (!ok || el.value !== edit.text) return false;
  el.setSelectionRange(edit.sel.start, edit.sel.end);
  return true;
}

/**
 * The note text itself: one plain-markdown text area, like Obsidian's source mode. Select, copy and
 * paste across any number of lines. Enter continues a list, Tab / Shift+Tab nest it, Ctrl+B / Ctrl+I
 * bold and italicise, Ctrl+Enter toggles a checkbox.
 */
export const MarkdownEditor = forwardRef<MarkdownEditorHandle, {
  value: string;
  onChange: (text: string) => void;
  autoFocus?: boolean;
  placeholder?: string;
}>(function MarkdownEditor({ value, onChange, autoFocus, placeholder }, ref) {
  const c = useColors();
  const input = useRef<TextInput | null>(null);
  const sel = useRef<Sel>({ start: value.length, end: value.length });
  const [pending, setPending] = useState<Sel | undefined>(undefined);
  const [height, setHeight] = useState<number | undefined>(undefined);
  const latest = useRef(value);
  latest.current = value;

  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }), []);

  const dom = () => (WEB ? (input.current as unknown as HTMLTextAreaElement | null) : null);

  // Grow with the text so the whole page scrolls as one sheet (a textarea won't do that by itself).
  useLayoutEffect(() => {
    const el = dom();
    if (!el?.style) return;
    const scroller = scrollParent(el);
    const top = scroller?.scrollTop;
    el.style.height = '0px';
    const h = Math.max(el.scrollHeight, 320);
    el.style.height = `${h}px`;
    if (scroller && top != null) scroller.scrollTop = top;
    setHeight(h);
  }, [value]);

  // A controlled selection pins the cursor until it's released, so let go one tick later.
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPending(undefined), 0);
    return () => clearTimeout(t);
  }, [pending]);

  const apply = (edit: Edit | null) => {
    if (!edit) return false;
    const el = dom();
    if (el && applyNative(el, latest.current, edit)) {
      sel.current = edit.sel;
      return true;
    }
    sel.current = edit.sel;
    onChange(edit.text);
    setPending(edit.sel);
    return true;
  };

  const currentSel = (): Sel => {
    const el = dom();
    return el ? { start: el.selectionStart, end: el.selectionEnd } : sel.current;
  };

  const onKeyPress = (e: any) => {
    if (!WEB) return;
    const key: string = e.nativeEvent?.key ?? e.key;
    const mod = !!(e.ctrlKey || e.metaKey || e.nativeEvent?.ctrlKey || e.nativeEvent?.metaKey);
    const shift = !!(e.shiftKey || e.nativeEvent?.shiftKey);
    if (e.nativeEvent?.isComposing) return;
    const text = latest.current;
    let edit: Edit | null = null;
    if (key === 'Tab' && !mod) edit = indentKey(text, currentSel(), shift);
    else if (key === 'Enter' && mod) edit = checkboxKey(text, currentSel());
    else if (key === 'Enter' && !shift) edit = enterKey(text, currentSel());
    else if (mod && !shift && (key === 'b' || key === 'B')) edit = wrapKey(text, currentSel(), '**');
    else if (mod && !shift && (key === 'i' || key === 'I')) edit = wrapKey(text, currentSel(), '*');
    if (!edit) return;
    e.preventDefault?.();
    apply(edit);
  };

  // Phones can't intercept Enter before it lands, so spot the newline afterwards and finish the list.
  const onChangeText = (next: string) => {
    const prev = latest.current;
    if (!WEB && next.length === prev.length + 1) {
      const p = sel.current.start;
      if (sel.current.start === sel.current.end && next[p] === '\n' && next.slice(0, p) === prev.slice(0, p) && next.slice(p + 1) === prev.slice(p)) {
        const edit = enterKey(prev, { start: p, end: p });
        if (edit) {
          sel.current = edit.sel;
          onChange(edit.text);
          setPending(edit.sel);
          return;
        }
      }
    }
    onChange(next);
  };

  return (
    <TextInput
      ref={input}
      value={value}
      onChangeText={onChangeText}
      onKeyPress={onKeyPress}
      onSelectionChange={(e) => { sel.current = e.nativeEvent.selection; }}
      selection={pending}
      multiline
      scrollEnabled={false}
      autoFocus={autoFocus}
      autoCorrect
      spellCheck
      textAlignVertical="top"
      placeholder={placeholder ?? 'Start writing… (Markdown works: # heading, - list, - [ ] task, **bold**)'}
      placeholderTextColor={c.muted}
      onContentSizeChange={WEB ? undefined : (e) => setHeight(Math.max(320, Math.ceil(e.nativeEvent.contentSize.height)))}
      style={{
        width: '100%', minHeight: 320, height, color: c.text, fontSize: SIZE, lineHeight: LINE,
        paddingVertical: 5, paddingHorizontal: 0, borderWidth: 0, backgroundColor: 'transparent',
        ...(WEB ? ({ outlineStyle: 'none', outlineWidth: 0, resize: 'none', tabSize: 2, overflow: 'hidden' } as object) : {}),
      }}
    />
  );
});
