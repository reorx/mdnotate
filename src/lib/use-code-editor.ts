import { useEffect, useRef, type RefObject } from 'react';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { search, searchKeymap } from '@codemirror/search';
import { EditorSelection, EditorState, Text } from '@codemirror/state';
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { useAppStore } from '../store';
import type { DocFormat } from './doc-locator';
import { attachEditor } from './edit-session';
import { splitForEditor } from './edit-text';

/**
 * The code editor behind edit mode: CodeMirror 6, set up by hand rather than
 * through a React wrapper.
 *
 * A wrapper drives the editor from a `value` prop, which is the wrong way
 * round here: the store's copy of the text only changes when a save writes it,
 * and feeding that back in would reset the cursor and the undo history at the
 * moment the user least expects it. So the editor reads the document once, as
 * it mounts, and owns the text from then on; the session asks it for the text
 * when there is something to save (see `edit-session`).
 *
 * Unsaved means different from the file, not touched since the last save: undo
 * back to what was saved and the title loses its "Edited" again. The baseline
 * is a CodeMirror `Text`, whose comparison stops at the length when the lengths
 * differ — so the full comparison only runs on the keystrokes that leave the
 * length unchanged.
 *
 * The editor grows with its text and leaves the scrolling to the container
 * around it; CodeMirror works out which lines are on screen from any scrolling
 * ancestor. That keeps the gutter next to the text in a centred column, like
 * the prose it replaces.
 *
 * Colours come from the app's own custom properties, so the neutral-ramp
 * inversion that gives every component its dark mode (see App.css) gives the
 * editor one too.
 */

const theme = EditorView.theme({
  '&': {
    color: 'var(--prose-text)',
    backgroundColor: 'transparent',
    fontSize: 'calc(var(--prose-font-size) * 0.9)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
    lineHeight: 'var(--prose-line-height)',
  },
  '.cm-content': { padding: '0', caretColor: 'var(--color-sky-600)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-sky-600)', borderLeftWidth: '2px' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--color-neutral-400)',
    border: 'none',
    paddingRight: '0.75em',
  },
  '.cm-activeLine': { backgroundColor: 'var(--color-neutral-50)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--color-neutral-700)' },
  // The search panel ships with light-only gradients; flatten it onto the ramp.
  '.cm-panels': { backgroundColor: 'var(--color-page)', color: 'var(--prose-text)' },
  '.cm-panels-top': { borderBottom: '1px solid var(--color-neutral-200)' },
  '.cm-panel.cm-search': { padding: '6px 4px', fontFamily: 'system-ui, sans-serif', fontSize: '12px' },
  '.cm-textfield': {
    backgroundColor: 'var(--color-page)',
    border: '1px solid var(--color-neutral-300)',
    borderRadius: '4px',
    color: 'inherit',
  },
  '.cm-button': {
    backgroundImage: 'none',
    backgroundColor: 'var(--color-neutral-100)',
    border: '1px solid var(--color-neutral-200)',
    borderRadius: '4px',
    color: 'inherit',
  },
  '.cm-panel.cm-search label': { fontSize: '12px' },
  '.cm-panel.cm-search [name=close]': { color: 'var(--color-neutral-500)' },
  // Translucent, so the same wash reads on either background.
  '.cm-searchMatch': { backgroundColor: 'rgb(245 158 11 / 0.25)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgb(245 158 11 / 0.55)' },
});

/**
 * Markdown as the reader would see its weight, at a glance: headings and
 * strong text heavy, emphasis slanted, and every piece of markup — the `#`,
 * the `*`, the backticks — pushed back so the words stand out from it.
 */
const highlight = HighlightStyle.define([
  { tag: [t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6], fontWeight: '650' },
  { tag: t.strong, fontWeight: '650' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--prose-link)' },
  { tag: t.monospace, color: 'var(--color-amber-700)' },
  { tag: t.quote, color: 'var(--prose-quote-text)' },
  { tag: [t.processingInstruction, t.contentSeparator, t.comment, t.meta], color: 'var(--color-neutral-400)' },
  { tag: t.labelName, color: 'var(--color-neutral-500)' },
]);

export interface UseCodeEditorOptions {
  /** Where the editor goes. */
  parentRef: RefObject<HTMLDivElement | null>;
  /** The document as it was when editing began; read once, as the editor mounts. */
  content: string;
  format: DocFormat;
}

export function useCodeEditor({ parentRef, content, format }: UseCodeEditorOptions): {
  /** Put the cursor at the end of the text: what a click below the last line means. */
  focusEnd: () => void;
} {
  const viewRef = useRef<EditorView | null>(null);
  const initial = useRef({ content, format });

  useEffect(() => {
    const parent = parentRef.current;
    if (!parent) return;
    const { text, ...meta } = splitForEditor(initial.current.content);
    let baseline = Text.of(text.split('\n'));

    const syncDirty = (doc: Text) => {
      const dirty = !doc.eq(baseline);
      const store = useAppStore.getState();
      if (store.dirty !== dirty) store.setDirty(dirty);
    };

    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: baseline,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          history(),
          search({ top: true }),
          EditorView.lineWrapping,
          // List continuation on Enter comes with the Markdown language, and
          // runs ahead of the default keymap.
          initial.current.format === 'markdown' ? markdown({ base: markdownLanguage }) : [],
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
          syntaxHighlighting(highlight),
          theme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) syncDirty(update.state.doc);
          }),
        ],
      }),
    });
    viewRef.current = view;

    const detach = attachEditor({
      text: () => view.state.doc.toString(),
      markSaved: (saved) => {
        baseline = Text.of(saved.split('\n'));
        syncDirty(view.state.doc);
      },
      meta,
    });
    view.focus();

    return () => {
      detach();
      view.destroy();
      viewRef.current = null;
    };
  }, [parentRef]);

  return {
    focusEnd: () => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
      view.focus();
    },
  };
}
