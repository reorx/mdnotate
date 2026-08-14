import { useEffect, useRef } from 'react';
import { MessageSquare } from 'lucide-react';
import { annotationPreview, type Annotation } from '../lib/annotations';

interface AnnotationListProps {
  /** Already in document order — the store keeps them sorted. */
  annotations: Annotation[];
  activeId: string | null;
  onJump: (id: string) => void;
}

export function AnnotationList({ annotations, activeId, onJump }: AnnotationListProps) {
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const wash = (active: boolean) => (active ? 'bg-amber-200' : 'bg-amber-100');

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
      </div>
      {annotations.length === 0 ? (
        <p className="px-3 py-2 text-[12px] text-neutral-400">No annotations yet</p>
      ) : (
        <nav className="space-y-1.5 p-2">
          {annotations.map((annotation, index) => {
            const active = annotation.id === activeId;
            return (
              <button
                key={annotation.id}
                ref={active ? activeRef : undefined}
                onClick={() => onJump(annotation.id)}
                // `scroll-mt-8` clears the sticky header above: without it the
                // entry `scrollIntoView` brings into view arrives underneath it.
                className={`flex w-full scroll-mt-8 gap-2 rounded-md border px-2 py-1.5 text-left ${
                  active ? 'border-amber-500 bg-amber-50' : 'border-neutral-200 hover:bg-neutral-100'
                }`}
              >
                {/* Aligned to the quote's first line, and right-aligned so the
                    ones and the tens stay in one column. */}
                <span
                  className={`w-5 shrink-0 text-right text-[11px] leading-[18px] tabular-nums ${
                    active ? 'text-amber-700' : 'text-neutral-400'
                  }`}
                >
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  {/* The quote wears the amber wash it wears in the document, so
                      an entry reads as a highlight whether or not it is the
                      current one — and the current one's wash deepens, the same
                      move the annotator makes on the highlight itself when it is
                      selected. */}
                  <span
                    className={`-mx-0.5 block line-clamp-3 rounded-sm px-0.5 text-[13px] leading-snug text-neutral-700 ${wash(
                      active,
                    )}`}
                  >
                    {annotationPreview(annotation.quote)}
                  </span>
                  {/* The icon marks the same thing here as it does in the text.
                      It labels the comment rather than trailing the quote, which
                      line-clamp would cut off along with the words it clipped. */}
                  {annotation.comment && (
                    <span className="mt-1 flex items-start gap-1 text-[12px] leading-snug text-neutral-500">
                      <MessageSquare className="mt-px h-3 w-3 shrink-0 fill-amber-500/30 text-amber-500" />
                      <span className="line-clamp-2">{annotationPreview(annotation.comment)}</span>
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </nav>
      )}
    </>
  );
}
