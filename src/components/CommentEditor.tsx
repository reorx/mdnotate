import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Trash2, X } from 'lucide-react';
import { isCancelEscape, isSubmitEnter } from '../lib/keys';
import { IconButton } from './IconButton';

interface CommentEditorProps {
  /** What the box starts with; it is the editor's own from then on. */
  initial: string;
  rows: number;
  /** Handed the text trimmed: '' is the caller's to read. */
  onSubmit: (text: string) => void;
  onCancel: () => void;
  /** Only for something that exists. */
  onDelete?: () => void;
  /**
   * Carry on writing somewhere that does not cover the document. Handed the
   * text as typed, since the writing is not finished.
   */
  onMoveToPanel?: (text: string) => void;
}

/**
 * The comment box, wherever a comment is written: the popup over the text and
 * the entry in the annotation list. Same keys, same buttons, same meaning in
 * both — Enter saves, Shift+Enter is a new line, Escape lets the change go.
 * Focused when it appears, since appearing is what asking to write does.
 */
export function CommentEditor({ initial, rows, onSubmit, onCancel, onDelete, onMoveToPanel }: CommentEditorProps) {
  const [text, setText] = useState(initial);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    // At the end, so picking up where the popup left off means typing on.
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  return (
    <>
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        // Both keys are the input method's before they are ours: mid-composition
        // Enter turns the pre-edit into text and Escape drops the candidate, so
        // reading `key` alone would save half a sentence, or throw one away.
        onKeyDown={(e) => {
          if (isSubmitEnter(e)) {
            e.preventDefault();
            onSubmit(text.trim());
          } else if (isCancelEscape(e)) {
            e.preventDefault();
            onCancel();
          }
        }}
        rows={rows}
        placeholder="Add a comment…"
        // `block`, or the textarea sits on the text baseline like the
        // inline-block it is by default and leaves a line's worth of descender
        // space under itself — which reads as the button row drifting away.
        className="block w-full resize-none rounded-lg border border-neutral-300 bg-page px-2.5 py-1.5 text-[13px] leading-snug outline-none focus:border-amber-500"
      />
      <div className="mt-1 flex items-center">
        {/* Deleting sits apart from the buttons that close the box. */}
        {onDelete && (
          <IconButton label="Delete" className="text-neutral-400 hover:bg-red-50 hover:text-red-600" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </IconButton>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          {onMoveToPanel && (
            <IconButton
              label="Continue in the Annotations panel"
              className="text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
              onClick={() => onMoveToPanel(text)}
            >
              <ArrowRight className="h-4 w-4" />
            </IconButton>
          )}
          <IconButton
            label="Cancel (Esc)"
            className="text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
            onClick={onCancel}
          >
            <X className="h-4 w-4" />
          </IconButton>
          <IconButton
            label="Save (Enter)"
            className="text-amber-500 hover:bg-amber-50 hover:text-amber-600"
            onClick={() => onSubmit(text.trim())}
          >
            <Check className="h-4 w-4" />
          </IconButton>
        </div>
      </div>
    </>
  );
}
