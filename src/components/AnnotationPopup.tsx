import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Highlighter, MessageSquarePlus, Trash2, X } from 'lucide-react';
import type { Annotation } from '../lib/annotations';
import { isCancelEscape, isSubmitEnter } from '../lib/keys';
import { placePopup, type PopupSize } from '../lib/popup-position';
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

/** Until the card has been measured; replaced before the browser paints. */
const UNMEASURED: PopupSize = { width: 0, height: 0 };

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
  const cardRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [size, setSize] = useState<PopupSize | null>(null);

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  // Measured rather than declared: the toolbar is only as wide as its two
  // buttons while the editor is a fixed column, and the card changes height the
  // moment one gives way to the other. Measuring in a layout effect means the
  // card is never painted at the position it would have had before.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const next = { width: el.offsetWidth, height: el.offsetHeight };
    setSize((prev) => (prev && prev.width === next.width && prev.height === next.height ? prev : next));
  }, [editing]);

  const { top, left } = placePopup(popup.anchor, popup.bounds, size ?? UNMEASURED);

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

  // The padding belongs to each state rather than to the card, because the row
  // of icon buttons carries its own: counted from the icons themselves the
  // bottom would sit deeper than the top if both were the same number.
  const editor = (
    <div className="w-[300px] px-2 pt-2 pb-1">
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
            submit();
          } else if (isCancelEscape(e)) {
            e.preventDefault();
            onDismiss();
          }
        }}
        rows={3}
        placeholder="Add a comment…"
        // `block`, or the textarea sits on the text baseline like the
        // inline-block it is by default and leaves a line's worth of descender
        // space under itself — which reads as the button row drifting away.
        className="block w-full resize-none rounded-lg border border-neutral-300 bg-page px-2.5 py-1.5 text-[13px] leading-snug outline-none focus:border-amber-500"
      />
      <div className="mt-1 flex items-center">
        {/* Deleting is only ever an option for something that exists, and it
            sits apart from the two buttons that dismiss the popup. */}
        {popup.kind === 'view' && (
          <IconButton
            label="Delete"
            className="text-neutral-400 hover:bg-red-50 hover:text-red-600"
            onClick={() => onDelete(popup.annotationId)}
          >
            <Trash2 className="h-4 w-4" />
          </IconButton>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton
            label="Cancel (Esc)"
            className="text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
            onClick={onDismiss}
          >
            <X className="h-4 w-4" />
          </IconButton>
          <IconButton
            label="Save (Enter)"
            className="text-amber-500 hover:bg-amber-50 hover:text-amber-600"
            onClick={submit}
          >
            <Check className="h-4 w-4" />
          </IconButton>
        </div>
      </div>
    </div>
  );

  return (
    <div
      ref={cardRef}
      className={`${NOT_ANNOTATABLE_CLASS} absolute z-20 rounded-xl border border-neutral-200 bg-raised shadow-xl`}
      style={{ top, left }}
    >
      {editing ? (
        editor
      ) : (
        <div className="flex items-center gap-0.5 p-2">
          <ToolbarButton label="Highlight" icon={<Highlighter className="h-4 w-4" />} onClick={onHighlight} />
          <ToolbarButton
            label="Annotate"
            icon={<MessageSquarePlus className="h-4 w-4" />}
            onClick={() => setDraftEditing(true)}
          />
        </div>
      )}
    </div>
  );
}

function ToolbarButton({ label, icon, onClick }: { label: string; icon: ReactNode; onClick: () => void }) {
  return (
    <button
      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] text-neutral-700 hover:bg-neutral-100"
      onClick={onClick}
    >
      <span className="text-amber-500">{icon}</span>
      {label}
    </button>
  );
}

/** An icon and nothing else, so the name it carries is the only name it has. */
function IconButton({
  label,
  className,
  onClick,
  children,
}: {
  label: string;
  className: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button className={`rounded-lg p-1.5 ${className}`} title={label} aria-label={label} onClick={onClick}>
      {children}
    </button>
  );
}
