import { useEffect, useRef, useState } from 'react';
import {
  createTextAnnotator,
  NOT_ANNOTATABLE_CLASS,
  type TextAnnotation,
  type TextAnnotator,
} from '@recogito/text-annotator';
import '@recogito/text-annotator/text-annotator.css';
import { fromRecogitoAnnotation, toRecogitoAnnotation, type Annotation } from './annotations';
import type { ResolvedTheme } from './theme';

export { NOT_ANNOTATABLE_CLASS };

export interface AnnotationPopupPosition {
  top: number;
  left: number;
}

export type AnnotationPopupState =
  | { kind: 'draft'; draftId: string; position: AnnotationPopupPosition }
  | { kind: 'view'; annotationId: string; position: AnnotationPopupPosition };

export interface UseTextAnnotatorOptions {
  /** Only enable on stable, fully-rendered content. */
  enabled: boolean;
  /** Recreate the annotator when the underlying document changes. */
  documentKey?: string | null;
  annotations: Annotation[];
  /** Highlights are blended into the page, so they depend on what is under them. */
  theme: ResolvedTheme;
  onCreate: (annotation: Annotation) => void;
  onRemove: (id: string) => void;
  onSetComment: (id: string, comment: string | null) => void;
}

const POPUP_WIDTH = 260;

/**
 * The same amber either way; what changes is how much of it survives the blend.
 * The highlight layer is `multiply` on a light page and `screen` on a dark one
 * (see App.css), and screen over near-black needs a little more to read as the
 * same wash.
 */
function highlightStyle(theme: ResolvedTheme) {
  const [resting, selected] = theme === 'dark' ? [0.3, 0.55] : [0.22, 0.4];
  return (_annotation: TextAnnotation, state?: { selected?: boolean }) => ({
    fill: '#f59e0b',
    fillOpacity: state?.selected ? selected : resting,
  });
}

/**
 * Thin React wrapper over @recogito/text-annotator for a single document.
 * Owns the draft/popup lifecycle; committed annotations flow through the
 * onCreate/onRemove/onSetComment callbacks (single writer: annotator + parent
 * callback mutate together).
 */
export function useTextAnnotator({
  enabled,
  documentKey,
  annotations,
  theme,
  onCreate,
  onRemove,
  onSetComment,
}: UseTextAnnotatorOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const annoRef = useRef<TextAnnotator | null>(null);
  const [popup, setPopup] = useState<AnnotationPopupState | null>(null);

  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  // Written synchronously alongside setPopup so that cancelSelected() fired
  // inside an action never observes a stale draft.
  const popupRef = useRef<AnnotationPopupState | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const themeRef = useRef(theme);
  themeRef.current = theme;

  const setPopupState = (next: AnnotationPopupState | null) => {
    popupRef.current = next;
    setPopup(next);
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!enabled || !el) return;

    const anno = createTextAnnotator<TextAnnotation, TextAnnotation>(el, {
      renderer: 'SPANS',
      style: highlightStyle(themeRef.current),
    });
    anno.setAnnotations(annotationsRef.current.map(toRecogitoAnnotation));
    annoRef.current = anno;

    const clampLeft = (left: number, containerRect: DOMRect) =>
      Math.max(0, Math.min(left, containerRect.width - POPUP_WIDTH));

    const positionFor = (fallback: { x: number; y: number } | null): AnnotationPopupPosition => {
      const containerRect = el.getBoundingClientRect();
      const selection = document.getSelection();
      if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        return {
          top: rect.bottom - containerRect.top,
          left: clampLeft(rect.left - containerRect.left, containerRect),
        };
      }
      if (fallback) {
        return {
          top: fallback.y - containerRect.top,
          left: clampLeft(fallback.x - containerRect.left, containerRect),
        };
      }
      return { top: 0, left: 0 };
    };

    const onClickAnnotation = (_annotation: TextAnnotation, event: PointerEvent) => {
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
    };

    // Position the view popup at the highlight itself (rendered by the SPANS
    // renderer as [data-annotation] overlay spans); fall back to the click
    // point when the overlay is not there yet.
    const positionForView = (id: string): AnnotationPopupPosition => {
      const span = el.querySelector(`[data-annotation="${CSS.escape(id)}"]`);
      if (span) {
        const containerRect = el.getBoundingClientRect();
        const rect = span.getBoundingClientRect();
        return {
          top: rect.bottom - containerRect.top,
          left: clampLeft(rect.left - containerRect.left, containerRect),
        };
      }
      return positionFor(lastPointerRef.current);
    };

    const onSelectionChanged = (selected: TextAnnotation[]) => {
      const next: TextAnnotation | undefined = selected[0];
      // Selection moved while a draft was uncommitted: the draft has no
      // persisted counterpart, drop it.
      const prev = popupRef.current;
      if (prev?.kind === 'draft' && prev.draftId !== next?.id) {
        anno.removeAnnotation(prev.draftId);
      }
      if (!next) {
        setPopupState(null);
        return;
      }
      const isKnown = annotationsRef.current.some((a) => a.id === next.id);
      setPopupState(
        isKnown
          ? { kind: 'view', annotationId: next.id, position: positionForView(next.id) }
          : { kind: 'draft', draftId: next.id, position: positionFor(null) },
      );
    };

    anno.on('clickAnnotation', onClickAnnotation);
    anno.on('selectionChanged', onSelectionChanged);

    // The library only watches pointer events inside its container, so a click
    // elsewhere would leave the popup (and an uncommitted draft) dangling.
    const onDocumentPointerDown = (event: PointerEvent) => {
      const current = popupRef.current;
      if (!current) return;
      const target = event.target;
      if (target instanceof Node && el.contains(target)) return;
      if (current.kind === 'draft') anno.removeAnnotation(current.draftId);
      setPopupState(null);
      anno.cancelSelected();
    };
    document.addEventListener('pointerdown', onDocumentPointerDown, true);

    return () => {
      document.removeEventListener('pointerdown', onDocumentPointerDown, true);
      annoRef.current = null;
      setPopupState(null);
      anno.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, documentKey]);

  // Restyling in place rather than through the effect above: rebuilding the
  // annotator on a theme change would throw away the draft and the selection.
  // `setStyle` redraws the existing highlights.
  useEffect(() => {
    annoRef.current?.setStyle(highlightStyle(theme));
  }, [theme]);

  const commitDraft = (comment: string | null) => {
    const anno = annoRef.current;
    const current = popupRef.current;
    if (!anno || current?.kind !== 'draft') return;
    // Re-read the draft: the user may have adjusted the selection after the
    // popup opened.
    const draft = anno.getAnnotationById(current.draftId);
    const created = draft ? fromRecogitoAnnotation(draft, Date.now()) : null;
    setPopupState(null);
    if (!created) {
      if (draft) anno.removeAnnotation(draft.id);
      anno.cancelSelected();
      return;
    }
    const annotation: Annotation = { ...created, comment };
    if (comment !== null) anno.updateAnnotation(toRecogitoAnnotation(annotation));
    onCreate(annotation);
    anno.cancelSelected();
  };

  const discardDraft = () => {
    const anno = annoRef.current;
    const current = popupRef.current;
    if (!anno || current?.kind !== 'draft') return;
    setPopupState(null);
    anno.removeAnnotation(current.draftId);
    anno.cancelSelected();
  };

  const deleteAnnotation = (id: string) => {
    const anno = annoRef.current;
    if (!anno) return;
    setPopupState(null);
    anno.removeAnnotation(id);
    anno.cancelSelected();
    onRemove(id);
  };

  const saveComment = (id: string, comment: string | null) => {
    const anno = annoRef.current;
    if (!anno) return;
    const stored = annotationsRef.current.find((a) => a.id === id);
    if (stored) anno.updateAnnotation(toRecogitoAnnotation({ ...stored, comment }));
    onSetComment(id, comment);
  };

  // The library walks up from the container to guess the scroller; pass the
  // reader's own so a document that happens not to overflow cannot send it to
  // the page root instead.
  const scrollToAnnotation = (id: string, scrollParent?: Element | null) => {
    annoRef.current?.scrollIntoView(id, scrollParent ?? undefined);
  };

  return {
    containerRef,
    popup,
    commitDraft,
    discardDraft,
    deleteAnnotation,
    saveComment,
    scrollToAnnotation,
  };
}
