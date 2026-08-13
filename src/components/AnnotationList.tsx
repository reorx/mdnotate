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

  if (annotations.length === 0) {
    return <p className="px-3 py-2 text-[12px] text-neutral-400">No annotations yet</p>;
  }
  return (
    <nav className="py-2">
      {annotations.map((annotation) => (
        <button
          key={annotation.id}
          ref={annotation.id === activeId ? activeRef : undefined}
          onClick={() => onJump(annotation.id)}
          className={`block w-full border-l-2 px-3 py-1.5 text-left ${
            annotation.id === activeId ? 'border-amber-500 bg-amber-50' : 'border-transparent hover:bg-neutral-100'
          }`}
        >
          {/* The quote wears the amber wash it wears in the document, so an
              entry reads as a highlight whether or not it is the current one —
              and the current one's wash deepens, the same move the annotator
              makes on the highlight itself when it is selected. */}
          <span
            className={`-mx-1 line-clamp-3 rounded-sm px-1 text-[13px] leading-snug text-neutral-700 ${wash(
              annotation.id === activeId,
            )}`}
          >
            {annotationPreview(annotation.quote)}
          </span>
          {/* The icon marks the same thing here as it does in the text. It
              labels the comment rather than trailing the quote, which
              line-clamp would cut off along with the words it clipped. */}
          {annotation.comment && (
            <span className="mt-1 flex items-start gap-1 text-[12px] leading-snug text-neutral-500">
              <MessageSquare className="mt-px h-3 w-3 shrink-0 fill-amber-500/30 text-amber-500" />
              <span className="line-clamp-2">{annotationPreview(annotation.comment)}</span>
            </span>
          )}
        </button>
      ))}
    </nav>
  );
}
