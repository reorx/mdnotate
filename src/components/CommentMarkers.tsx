import { MessageSquare } from 'lucide-react';
import type { CommentMarker } from '../lib/annotation-markers';
import { NOT_ANNOTATABLE_CLASS } from '../lib/use-text-annotator';

interface CommentMarkersProps {
  markers: CommentMarker[];
  onOpen: (id: string) => void;
}

/**
 * The icon that tells a highlight with something written about it apart from a
 * plain one, drawn at the end of the highlighted text.
 *
 * A layer of our own, over the annotator's: see `refreshMarkers` for why it
 * cannot be part of the library's. `not-annotatable` is what keeps a click on
 * an icon from being taken for a click on the text underneath — the library
 * leaves the selection alone inside such an element.
 */
export function CommentMarkers({ markers, onOpen }: CommentMarkersProps) {
  return (
    <div className={`${NOT_ANNOTATABLE_CLASS} pointer-events-none absolute inset-0 z-10`}>
      {markers.map((marker) => (
        // Filled, and riding a little above the middle of the line: at this
        // size an outline reads as a smudge, and a marker sitting on the
        // baseline reads as a character of the sentence it is pointing at.
        <button
          key={marker.id}
          className="pointer-events-auto absolute -translate-y-[65%] p-0.5 text-amber-500 hover:text-amber-600"
          style={{ left: marker.left, top: marker.top }}
          title="Show comment"
          onClick={() => onOpen(marker.id)}
        >
          <MessageSquare className="h-3 w-3 fill-amber-500/30" />
        </button>
      ))}
    </div>
  );
}
