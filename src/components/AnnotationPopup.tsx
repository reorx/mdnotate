import { useEffect, useRef, useState } from 'react';
import { Highlighter, MessageSquarePlus, Trash2 } from 'lucide-react';
import type { Annotation } from '../lib/annotations';
import { NOT_ANNOTATABLE_CLASS, type AnnotationPopupState } from '../lib/use-text-annotator';

interface AnnotationPopupProps {
  popup: AnnotationPopupState;
  annotation?: Annotation;
  onHighlight: () => void;
  onAnnotate: (comment: string) => void;
  onDelete: (id: string) => void;
  onSaveComment: (id: string, comment: string | null) => void;
  onDismiss: () => void;
}

export function AnnotationPopup({
  popup,
  annotation,
  onHighlight,
  onAnnotate,
  onDelete,
  onSaveComment,
  onDismiss,
}: AnnotationPopupProps) {
  // A fresh selection is first a choice between highlighting and commenting; an
  // existing annotation opens straight into its comment, because reaching for
  // the comment is what clicking a highlight is for. Either way there is no
  // read-only state: the text is always in the box, ready to be changed.
  const [draftEditing, setDraftEditing] = useState(false);
  const editing = popup.kind === 'view' || draftEditing;
  const [text, setText] = useState(annotation?.comment ?? '');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  const submit = () => {
    const comment = text.trim();
    if (popup.kind === 'draft') {
      if (comment) onAnnotate(comment);
      else onDismiss();
      return;
    }
    // '' turns the annotation back into a plain highlight
    onSaveComment(popup.annotationId, comment || null);
    onDismiss();
  };

  const editor = (
    <div className="space-y-1">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onDismiss();
          }
        }}
        rows={3}
        placeholder="Write a comment… (Enter to save)"
        className="w-full resize-none rounded border border-neutral-300 bg-page px-2 py-1 text-[13px] leading-snug outline-none focus:border-amber-500"
      />
      <div className="flex items-center justify-end gap-1">
        {/* Deleting is only ever an option for something that exists, and it
            sits apart from the two buttons that dismiss the popup. */}
        {popup.kind === 'view' && (
          <button
            className="mr-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-neutral-500 hover:bg-red-50 hover:text-red-600"
            onClick={() => onDelete(popup.annotationId)}
          >
            <Trash2 className="h-3 w-3" />
            Delete
          </button>
        )}
        <button className="rounded px-2 py-0.5 text-[12px] text-neutral-500 hover:bg-neutral-100" onClick={onDismiss}>
          Cancel
        </button>
        <button
          className="rounded bg-amber-500 px-2 py-0.5 text-[12px] font-medium text-white hover:bg-amber-600"
          onClick={submit}
        >
          Save
        </button>
      </div>
    </div>
  );

  return (
    <div
      className={`${NOT_ANNOTATABLE_CLASS} absolute z-20 w-[260px] rounded-md border border-neutral-200 bg-raised p-1.5 shadow-lg`}
      style={{ top: popup.position.top + 6, left: popup.position.left }}
    >
      {editing ? (
        editor
      ) : (
        <div className="flex items-center gap-0.5">
          <button
            className="flex items-center gap-1 rounded px-2 py-1 text-[13px] text-neutral-700 hover:bg-neutral-100"
            onClick={onHighlight}
          >
            <Highlighter className="h-3.5 w-3.5 text-amber-500" />
            Highlight
          </button>
          <button
            className="flex items-center gap-1 rounded px-2 py-1 text-[13px] text-neutral-700 hover:bg-neutral-100"
            onClick={() => setDraftEditing(true)}
          >
            <MessageSquarePlus className="h-3.5 w-3.5 text-amber-500" />
            Comment
          </button>
        </div>
      )}
    </div>
  );
}
