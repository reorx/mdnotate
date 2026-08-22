import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { useAppStore } from '../store';
import { createAnnotation, deleteAnnotation, updateComment } from '../lib/annotate';
import { convertBoxTables } from '../lib/box-table';
import { KATEX_OPTIONS, rehypeMathTex } from '../lib/math-quote';
import { normalizeMathDelimiters } from '../lib/math-source';
import { DEFAULT_PANEL_WIDTHS, panelWidthFromPointer, type PanelSide } from '../lib/panels';
import { saveSettings } from '../lib/settings';
import { buildToc, type TocItem } from '../lib/toc';
import { typographyVars } from '../lib/typography';
import { useDocSearch } from '../lib/use-doc-search';
import { useSelectAll } from '../lib/use-select-all';
import { useTextAnnotator } from '../lib/use-text-annotator';
import { AnnotationList } from './AnnotationList';
import { AnnotationPopup } from './AnnotationPopup';
import { CommentMarkers } from './CommentMarkers';
import { FindBar } from './FindBar';
import { StatusBar } from './StatusBar';
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

/**
 * A side panel's contents while there may be nothing for them to point at.
 *
 * Both panels navigate the rendered document — headings to scroll to,
 * highlights to jump to — and source view has neither. They stay on screen, so
 * the structure and the annotations are still readable, but go quiet: `inert`
 * takes the clicks, the hover and the tab stops away in one attribute, and
 * because it takes the pointer events with them the panel around it still
 * scrolls.
 */
function PanelContent({ inert, children }: { inert: boolean; children: ReactNode }) {
  return (
    <div inert={inert} className={inert ? 'opacity-50' : undefined}>
      {children}
    </div>
  );
}

export function Reader() {
  const content = useAppStore((s) => s.doc?.content ?? null);
  const docId = useAppStore((s) => s.doc?.id ?? null);
  const contentHash = useAppStore((s) => s.doc?.contentHash ?? null);
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
  const articleRef = useRef<HTMLElement | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pickedAnnotationId, setPickedAnnotationId] = useState<string | null>(null);
  // Reading the Markdown behind the page is a look, not a mode to live in: it
  // belongs to this document, in this window, and the next document opens
  // rendered as always.
  const [sourceView, setSourceView] = useState(false);
  const showingSource = sourceView && format === 'markdown';

  useEffect(() => setSourceView(false), [docId]);

  // What the Markdown renderer eats, not what the document is: box-drawing
  // tables pasted from CLI output are rewritten into GFM tables here, and the
  // math delimiters remark-math misreads are put into the form it reads, while
  // the store keeps the source untouched for source view, stats and hashing.
  // Tables go first: their rewrite rebuilds whole lines out of a grid, and the
  // math pass should see the line structure that finally reaches the parser.
  const renderedMarkdown = useMemo(
    () => (content !== null ? normalizeMathDelimiters(convertBoxTables(content)) : ''),
    [content],
  );

  // react-markdown re-parses its whole input on every render, and this
  // component renders whenever a popup opens or a panel is dragged. Parsing was
  // cheap until KaTeX joined the pipeline; typesetting a page of formulas is
  // not, so the element is built once per document and reused after that.
  const markdownBody = useMemo(
    () => (
      // A table cannot wrap below its min-content width, and the scroller no
      // longer scrolls sideways for it — so a wide table scrolls inside its own
      // box, like `pre` always has. A wide formula does the same, from CSS.
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        // Both plugins and the options behind them are explained in
        // `math-quote.ts`; the order is the load-bearing part, since the TeX has
        // to be put somewhere safe before KaTeX replaces the node holding it.
        rehypePlugins={[rehypeMathTex, [rehypeKatex, KATEX_OPTIONS]]}
        components={{
          table: ({ node: _node, ...props }) => (
            <div className="overflow-x-auto">
              <table {...props} />
            </div>
          ),
        }}
      >
        {renderedMarkdown}
      </ReactMarkdown>
    ),
    [renderedMarkdown],
  );

  const annotator = useTextAnnotator({
    // Source view drops the annotator entirely, which is what makes selecting
    // text there an ordinary selection again: no draft, no popup, no
    // highlights. Switching back rebuilds it from the store, annotations and
    // all — their offsets were only ever measured against the rendered text.
    enabled: !!content && !showingSource,
    // The text, not just the document. A reload keeps the same id, so keying on
    // the id alone would leave the annotator standing while the prose under it
    // was replaced — painting the old offsets over the new text, which is the
    // very mis-anchoring the stale-annotation rule exists to prevent. Rebuilt,
    // it seeds itself from the store, where those annotations have already been
    // dropped. Same reasoning, same key, as the search index below.
    documentKey: `${docId}#${contentHash}`,
    scrollRef,
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
    revision: `${docId}#${contentHash}#${showingSource}`,
    enabled: !!content && view === 'reader',
    onTakeSelection: annotator.dismissPopup,
  });

  useSelectAll({ targetRef: articleRef, enabled: !!content && view === 'reader' });

  // Collect headings from the rendered DOM: assign slug ids and build the TOC.
  // DOM-derived so ids always match what the sidebar links to — which is why
  // the view mode belongs in the dependencies: coming back from source view
  // rebuilds the headings as new elements, and new elements carry no ids.
  useEffect(() => {
    const container = annotator.containerRef.current;
    if (!container || !content) {
      setToc([]);
      setActiveId(null);
      return;
    }
    // Nothing to collect from source view, and nothing to throw away either:
    // the list is kept, greyed out, until the headings come back.
    if (showingSource) return;
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
  }, [content, showingSource, annotator.containerRef]);

  // Scroll spy: the active heading is the last one at or above the viewport top.
  // Off in source view, where every heading lookup misses and the first entry
  // would light up for the whole document.
  useEffect(() => {
    const scroller = scrollRef.current;
    const container = annotator.containerRef.current;
    if (!scroller || !container || toc.length === 0 || showingSource) return;

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
  }, [toc, showingSource, annotator.containerRef]);

  const jumpTo = (id: string) => {
    const container = annotator.containerRef.current;
    const el = container?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveId(id);
  };

  const jumpToAnnotation = (id: string) => {
    annotator.scrollToAnnotation(id);
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
            <PanelContent inert={showingSource}>
              <Toc items={toc} activeId={activeId} onJump={jumpTo} />
            </PanelContent>
          </aside>
          <PanelResizeHandle side="toc" containerRef={rootRef} />
        </>
      )}
      {/* A positioned box around the scroller, and nothing else: the find bar
          has to stay put while the document scrolls under it, which it could
          not do from inside the scroller. */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Focusable, and the only thing here that is: a click on the prose has
            to land somewhere for ⌘A to mean this document rather than this
            window — and, incidentally, for the space bar and the arrow keys to
            scroll it at all. */}
        <div
          ref={scrollRef}
          tabIndex={-1}
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto outline-none"
          style={typographyVars(typography) as CSSProperties}
        >
          <div ref={annotator.containerRef} className="prose-column relative mx-auto px-8 py-6">
            {/* Two things end up here as text shown exactly as written: a plain
                document, and the Markdown behind a rendered one. Running either
                through the Markdown renderer would turn a leading # into a
                heading, and collapse the line breaks that a log, or a source
                listing, depends on. */}
            {format === 'markdown' && !showingSource ? (
              <article ref={articleRef} className="prose-dense">
                {markdownBody}
              </article>
            ) : (
              <article ref={articleRef} className="prose-plain">
                {content ?? ''}
              </article>
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
        {content !== null && (
          <StatusBar
            content={content}
            format={format}
            showingSource={showingSource}
            onToggleSource={() => setSourceView((showing) => !showing)}
          />
        )}
      </div>
      {annotationsOpen && (
        <>
          <PanelResizeHandle side="annotations" containerRef={rootRef} />
          <aside className="max-w-[40%] shrink-0 overflow-y-auto bg-neutral-50" style={{ width: panels.annotations }}>
            <PanelContent inert={showingSource}>
              <AnnotationList annotations={annotations} activeId={activeAnnotationId} onJump={jumpToAnnotation} />
            </PanelContent>
          </aside>
        </>
      )}
    </div>
  );
}
