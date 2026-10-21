import { useRef, type CSSProperties } from 'react';
import type { DocFormat } from '../lib/doc-locator';
import { typographyVars, type Typography } from '../lib/typography';
import { useCodeEditor } from '../lib/use-code-editor';

interface CodeEditorProps {
  /** The document as it stood when editing began. */
  content: string;
  format: DocFormat;
  typography: Typography;
}

/**
 * Edit mode's stand-in for the rendered document, in the same place and the
 * same column. Mounted for as long as editing lasts and no longer: leaving
 * edit mode is what throws the editor's text away.
 *
 * The scroller is ours rather than the editor's (see `use-code-editor`), and it
 * carries the typography variables the editor's theme sizes its text by.
 */
export function CodeEditor({ content, format, typography }: CodeEditorProps) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const editor = useCodeEditor({ parentRef, content, format });

  return (
    <div
      className="min-h-0 flex-1 cursor-text overflow-x-hidden overflow-y-auto"
      style={typographyVars(typography) as CSSProperties}
      // The editor is only as tall as its text. A click in the space below it
      // still means "write here", which is at the end.
      onMouseDown={(e) => {
        if (parentRef.current?.contains(e.target as Node)) return;
        e.preventDefault();
        editor.focusEnd();
      }}
    >
      <div ref={parentRef} className="prose-column mx-auto py-6 pr-8 pl-3" />
    </div>
  );
}
