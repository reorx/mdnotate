import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAppStore } from '../store';
import { createAnnotation, deleteAnnotation, updateComment } from '../lib/annotate';
import { DEFAULT_PANEL_WIDTHS, panelWidthFromPointer, type PanelSide } from '../lib/panels';
import { saveSettings } from '../lib/settings';
import { buildToc, type TocItem } from '../lib/toc';
import { typographyVars } from '../lib/typography';
import { useDocSearch } from '../lib/use-doc-search';
import { useTextAnnotator } from '../lib/use-text-annotator';
import { AnnotationList } from './AnnotationList';
import { AnnotationPopup } from './AnnotationPopup';
import { CommentMarkers } from './CommentMarkers';
import { FindBar } from './FindBar';
import { Toc } from './Toc';

/**
 * The hairline between a panel and the document, and the drag that resizes the
 * panel. The line is the old border; the hit zone around it is wider than what
 * it paints, or nobody would ever catch it. Widths go through the store first
 * and the settings file on release — same order as every other write.
 */
function PanelResizeHandle({
  side,
  containerRef,
}: {
  side: PanelSide;
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  const [dragging, setDragging] = useState(false);

  const resizeTo = (clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const { settings, updateSettings } = useAppStore.getState();
    updateSettings({ panels: { ...settings.panels, [side]: panelWidthFromPointer(side, clientX, rect) } });
  };

  const setWidth = (width: number) => {
    const { settings, updateSettings } = useAppStore.getState();
    const panels = { ...settings.panels, [side]: width };
    updateSettings({ panels });
    saveSettings({ panels }).catch(() => {});
  };

  const endDrag = () => {
    if (!dragging) return;
    setDragging(false);
    saveSettings({ panels: useAppStore.getState().settings.panels }).catch(() => {});
  };

  return (
    <div className={`relative w-px shrink-0 ${dragging ? 'bg-amber-400' : 'bg-neutral-200'}`}>
      <div
        className="absolute inset-y-0 -left-[3px] z-10 w-[7px] cursor-col-resize touch-none hover:bg-amber-400/25"
        title="Drag to resize; double-click to reset"
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
        }}
        onPointerMove={(e) => dragging && resizeTo(e.clientX)}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => setWidth(DEFAULT_PANEL_WIDTHS[side])}
      />
    </div>
  );
}

export function Reader() {
  const content = useAppStore((s) => s.doc?.content ?? null);
  const docId = useAppStore((s) => s.doc?.id ?? null);
  const format = useAppStore((s) => s.doc?.format ?? 'markdown');
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const annotationsOpen = useAppStore((s) => s.annotationsOpen);
  const view = useAppStore((s) => s.view);
  const annotations = useAppStore((s) => s.annotations);
  const typography = useAppStore((s) => s.settings.typography[format]);
  const panels = useAppStore((s) => s.settings.panels);
  const theme = useAppStore((s) => s.resolvedTheme);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pickedAnnotationId, setPickedAnnotationId] = useState<string | null>(null);

  const annotator = useTextAnnotator({
    enabled: !!content,
    documentKey: docId,
    annotations,
    theme,
    onCreate: createAnnotation,
    onRemove: deleteAnnotation,
    onSetComment: updateComment,
  });

  // ⌘F is a document-wide listener, so it has to know when the reader is not
  // the thing on screen: settings and export are laid over it, and a key press
  // meant for them must not scroll the page behind.
  const search = useDocSearch({
    containerRef: annotator.containerRef,
    scrollRef,
    content,
    enabled: !!content && view === 'reader',
    onTakeSelection: annotator.dismissPopup,
  });

  // Collect headings from the rendered DOM: assign slug ids and build the TOC.
  // DOM-derived so ids always match what the sidebar links to.
  useEffect(() => {
    const container = annotator.containerRef.current;
    if (!container || !content) {
      setToc([]);
      setActiveId(null);
      return;
    }
    const headingEls = Array.from(container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'));
    const items = buildToc(
      headingEls.map((el) => ({
        level: Number(el.tagName[1]),
        text: el.textContent ?? '',
      })),
    );
    headingEls.forEach((el, i) => {
      el.id = items[i].id;
    });
    setToc(items);
    setActiveId(items[0]?.id ?? null);
  }, [content, annotator.containerRef]);

  // Scroll spy: the active heading is the last one at or above the viewport top.
  useEffect(() => {
    const scroller = scrollRef.current;
    const container = annotator.containerRef.current;
    if (!scroller || !container || toc.length === 0) return;

    const onScroll = () => {
      // At the very bottom the last headings can never reach the viewport
      // top; treat the final heading as active so TOC jumps land correctly.
      // Only applies when the document actually scrolls.
      if (
        scroller.scrollHeight > scroller.clientHeight &&
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2
      ) {
        setActiveId(toc[toc.length - 1].id);
        return;
      }
      const threshold = scroller.getBoundingClientRect().top + 24;
      let current: string | null = toc[0]?.id ?? null;
      for (const item of toc) {
        const el = container.querySelector<HTMLElement>(`#${CSS.escape(item.id)}`);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= threshold) current = item.id;
        else break;
      }
      setActiveId(current);
    };
    onScroll();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [toc, annotator.containerRef]);

  const jumpTo = (id: string) => {
    const container = annotator.containerRef.current;
    const el = container?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveId(id);
  };

  const jumpToAnnotation = (id: string) => {
    annotator.scrollToAnnotation(id, scrollRef.current);
    setPickedAnnotationId(id);
  };

  const popup = annotator.popup;
  const popupAnnotation = popup?.kind === 'view' ? annotations.find((a) => a.id === popup.annotationId) : undefined;
  // An open popup wins: clicking a highlight in the text should move the
  // marker in the list, not leave it on whatever was picked there before.
  const activeAnnotationId = popup?.kind === 'view' ? popup.annotationId : pickedAnnotationId;

  return (
    // A stacking context of its own, so the annotation popup (z-20) stays
    // under the views that cover the reader rather than floating over them.
    // `min-w-0`, or this row's min-content — both panels plus the longest
    // unbreakable line of prose — becomes the window's minimum width and the
    // whole app scrolls sideways.
    <div ref={rootRef} className="relative z-0 flex min-h-0 min-w-0 flex-1">
      {sidebarOpen && (
        <>
          <aside className="max-w-[40%] shrink-0 overflow-y-auto bg-neutral-50" style={{ width: panels.toc }}>
            <Toc items={toc} activeId={activeId} onJump={jumpTo} />
          </aside>
          <PanelResizeHandle side="toc" containerRef={rootRef} />
        </>
      )}
      {/* A positioned box around the scroller, and nothing else: the find bar
          has to stay put while the document scrolls under it, which it could
          not do from inside the scroller. */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
          style={typographyVars(typography) as CSSProperties}
        >
          <div ref={annotator.containerRef} className="prose-column relative mx-auto px-8 py-6">
            {/* Plain text is shown as it was written — running it through the
                Markdown renderer would turn a leading # into a heading and
                collapse the line breaks a log or a config depends on. Either way
                the annotator sees ordinary rendered text, so highlighting works
                the same in both. */}
            {format === 'markdown' ? (
              <article className="prose-dense">
                {/* A table cannot wrap below its min-content width, and the
                    scroller no longer scrolls sideways for it — so a wide table
                    scrolls inside its own box, like `pre` always has. */}
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    table: ({ node: _node, ...props }) => (
                      <div className="overflow-x-auto">
                        <table {...props} />
                      </div>
                    ),
                  }}
                >
                  {content ?? ''}
                </ReactMarkdown>
              </article>
            ) : (
              <article className="prose-plain">{content ?? ''}</article>
            )}
            <CommentMarkers markers={annotator.commentMarkers} onOpen={annotator.openAnnotation} />
            {popup && (
              <AnnotationPopup
                key={popup.kind === 'draft' ? popup.draftId : popup.annotationId}
                popup={popup}
                annotation={popupAnnotation}
                onHighlight={() => annotator.commitDraft(null)}
                onAnnotate={(comment) => annotator.commitDraft(comment)}
                onDelete={annotator.deleteAnnotation}
                onSaveComment={annotator.saveComment}
                onDismiss={annotator.dismissPopup}
              />
            )}
          </div>
        </div>
        {search.open && (
          <FindBar
            query={search.query}
            count={search.count}
            active={search.active}
            capped={search.capped}
            paints={search.paints}
            inputRef={search.inputRef}
            onQueryChange={search.setQuery}
            onComposingChange={search.setComposing}
            onStep={search.step}
            onClose={search.close}
          />
        )}
      </div>
      {annotationsOpen && (
        <>
          <PanelResizeHandle side="annotations" containerRef={rootRef} />
          <aside className="max-w-[40%] shrink-0 overflow-y-auto bg-neutral-50" style={{ width: panels.annotations }}>
            <AnnotationList annotations={annotations} activeId={activeAnnotationId} onJump={jumpToAnnotation} />
          </aside>
        </>
      )}
    </div>
  );
}
