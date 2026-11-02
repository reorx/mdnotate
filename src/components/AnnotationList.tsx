import { useEffect, useRef } from 'react';
import { MessageSquare, MessageSquarePlus, Pencil } from 'lucide-react';
import { annotationPreview, type Annotation } from '../lib/annotations';
import { CommentEditor } from './CommentEditor';
import { IconButton } from './IconButton';

/** The entry whose comment is being written here, and what its box opens on. */
export interface ListEditor {
  id: string;
  initial: string;
}

interface AnnotationListProps {
  /** Already in document order — the store keeps them sorted. */
  annotations: Annotation[];
  activeId: string | null;
  editing: ListEditor | null;
  onJump: (id: string) => void;
  onEdit: (id: string) => void;
  onEditDone: () => void;
  onSaveComment: (id: string, comment: string | null) => void;
  onDelete: (id: string) => void;
  importDisabledReason: string | null;
  onImport: () => void;
}

export function AnnotationList({
  annotations,
  activeId,
  editing: listEditor,
  onJump,
  onEdit,
  onEditDone,
  onSaveComment,
  onDelete,
  importDisabledReason,
  onImport,
}: AnnotationListProps) {
  const activeRef = useRef<HTMLDivElement | null>(null);

  // Follow the document: clicking a highlight in the text marks its entry
  // active, which is of no use if the entry sits outside the panel's viewport.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  return (
    <>
      {/* How many there are belongs at the top of the list, not repeated down
          the side of every entry — the numbers there answer "which one", this
          answers "out of how many". Sticky, so scrolling never loses it. */}
      <div className="sticky top-0 z-10 flex items-center gap-1.5 border-b border-neutral-200 bg-neutral-50 px-3 py-1.5 text-[12px] font-medium text-neutral-500">
        Annotations
        <span className="tabular-nums text-neutral-400">{annotations.length}</span>
        <button
          aria-label="Import annotations"
          title={importDisabledReason ?? 'Import annotations from default Markdown export'}
          disabled={!!importDisabledReason}
          onClick={onImport}
          className="-my-0.5 ml-auto shrink-0 rounded px-1.5 py-0.5 text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Import
        </button>
      </div>
      {annotations.length === 0 ? (
        <p className="px-3 py-2 text-[12px] text-neutral-400">No annotations yet</p>
      ) : (
        <nav className="space-y-1.5 p-2">
          {annotations.map((annotation, index) => {
            const active = annotation.id === activeId;
            const editing = annotation.id === listEditor?.id;
            return (
              // The entry is two controls side by side, not one: the jump is a
              // button, and a button cannot hold the comment box. So the row
              // wears the border, and the jump and the editor sit inside it.
              //
              // `scroll-mt-8` clears the sticky header above: without it the
              // entry `scrollIntoView` brings into view arrives underneath it.
              <div
                key={annotation.id}
                ref={active ? activeRef : undefined}
                className={`group relative scroll-mt-8 rounded-md border ${
                  active ? 'border-amber-500 bg-amber-50' : 'border-neutral-200'
                } ${active || editing ? '' : 'hover:bg-neutral-100'}`}
              >
                <button onClick={() => onJump(annotation.id)} className="flex w-full gap-2 px-2 py-1.5 text-left">
                  {/* Aligned to the quote's first line, and right-aligned so the
                      ones and the tens stay in one column. */}
                  <span
                    className={`w-5 shrink-0 text-right text-[11px] leading-[18px] tabular-nums ${
                      active ? 'text-amber-700' : 'text-neutral-400'
                    }`}
                  >
                    {index + 1}
                  </span>
                  {/* `pr-6` keeps the quote out from under the edit button. */}
                  <span className="min-w-0 flex-1 pr-6">
                    {/* Plain text, not the amber wash it wears in the document: a
                        panel of nothing but quotes is a panel of solid amber, and
                        the wash stops meaning "highlighted" once everything is.
                        Which entry is current is the row's own business — border,
                        background and number all say it. */}
                    <span className="block line-clamp-3 text-[13px] leading-snug text-neutral-700">
                      {annotationPreview(annotation.quote)}
                    </span>
                    {/* The icon marks the same thing here as it does in the text.
                        It labels the comment rather than trailing the quote, which
                        line-clamp would cut off along with the words it clipped.
                        While the comment is being written it is in the box below,
                        not here as well. */}
                    {annotation.comment && !editing && (
                      <span className="mt-1 flex items-start gap-1 text-[12px] leading-snug text-neutral-500">
                        <MessageSquare className="mt-px h-3 w-3 shrink-0 fill-amber-500/30 text-amber-500" />
                        <span className="line-clamp-2">{annotationPreview(annotation.comment)}</span>
                      </span>
                    )}
                  </span>
                </button>
                {editing ? (
                  // Indented to the quote's column. Stays open when the focus
                  // goes back to the document, unlike the popup: looking at the
                  // text while writing about it is the reason to write here.
                  <div className="pr-2 pb-1 pl-9">
                    <CommentEditor
                      initial={listEditor?.initial ?? ''}
                      rows={4}
                      onSubmit={(text) => {
                        onSaveComment(annotation.id, text || null);
                        onEditDone();
                      }}
                      onCancel={onEditDone}
                      onDelete={() => {
                        onDelete(annotation.id);
                        onEditDone();
                      }}
                    />
                  </div>
                ) : (
                  // Shown on the entry in hand — hovered, current or focused —
                  // so a panel full of entries is not a panel full of pencils.
                  <IconButton
                    label={annotation.comment ? 'Edit comment' : 'Add comment'}
                    className={`absolute top-0.5 right-0.5 text-neutral-400 hover:bg-neutral-200/60 hover:text-neutral-600 focus-visible:opacity-100 group-hover:opacity-100 ${
                      active ? 'opacity-100' : 'opacity-0'
                    }`}
                    onClick={() => onEdit(annotation.id)}
                  >
                    {annotation.comment ? (
                      <Pencil className="h-3.5 w-3.5" />
                    ) : (
                      <MessageSquarePlus className="h-3.5 w-3.5" />
                    )}
                  </IconButton>
                )}
              </div>
            );
          })}
        </nav>
      )}
    </>
  );
}
