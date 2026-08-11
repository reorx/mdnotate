import { useEffect, useRef } from 'react';
import { annotationPreview, type Annotation } from '../lib/annotations';

interface AnnotationListProps {
  /** Already in document order — the store keeps them sorted. */
  annotations: Annotation[];
  activeId: string | null;
  onJump: (id: string) => void;
}

export function AnnotationList({ annotations, activeId, onJump }: AnnotationListProps) {
  const activeRef = useRef<HTMLButtonElement | null>(null);

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
          <span className="line-clamp-3 text-[13px] leading-snug text-neutral-700">
            {annotationPreview(annotation.quote)}
          </span>
          {annotation.comment && (
            <span className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-neutral-500">
              {annotationPreview(annotation.comment)}
            </span>
          )}
        </button>
      ))}
    </nav>
  );
}
