import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAppStore } from '../store';
import { createAnnotation, deleteAnnotation, moveOntoListNumbers, updateComment } from '../lib/annotate';
import { convertBoxTables } from '../lib/box-table';
import { rebaseAfterSave, useSaveShortcut } from '../lib/edit-session';
import { splitFrontMatter } from '../lib/front-matter';
import { rehypeListNumbers } from '../lib/list-numbers';
import { DEFAULT_PANEL_WIDTHS, panelWidthFromPointer, type PanelSide } from '../lib/panels';
import { collectAnnotatableSegments, collectAnnotatableText } from '../lib/reanchor';
import { preListNumbersHash } from '../lib/recent-docs';
import { saveSettings } from '../lib/settings';
import { buildToc, type TocItem } from '../lib/toc';
import { typographyVars } from '../lib/typography';
import { useDocSearch } from '../lib/use-doc-search';
import { useSelectAll } from '../lib/use-select-all';
import { useTextAnnotator } from '../lib/use-text-annotator';
import { AnnotationList, type ListEditor } from './AnnotationList';
import { AnnotationPopup } from './AnnotationPopup';
import { CodeEditor } from './CodeEditor';
import { CommentMarkers } from './CommentMarkers';
import { FindBar } from './FindBar';
import { FrontMatter } from './FrontMatter';
import { StatusBar } from './StatusBar';
import { DocImage } from './DocImage';
import { createImageSession, type ImageSession } from '../lib/doc-image';
import { remarkObsidianImages } from '../lib/obsidian-images';
import { isTauri } from '../lib/tauri-env';
import { Toc } from './Toc';
import { ImportAnnotations } from './ImportAnnotations';
import { importUnavailableReason } from '../lib/import-annotations';

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
  const doc = useAppStore((s) => s.doc);
  const [imageSession, setImageSession] = useState<{ doc: typeof doc; session: ImageSession } | null>(null);
  useEffect(() => {
    if (!doc || doc.kind !== 'file' || !isTauri) {
      setImageSession(null);
      return;
    }
    const session = createImageSession(doc.source);
    setImageSession({ doc, session });
    return () => session.dispose();
  }, [doc]);
  const imageComponents = useMemo<Components>(
    () => ({
      img: ({ node, src, alt, width, height }) => (
        <DocImage
          src={src}
          alt={alt}
          width={width}
          height={height}
          kind={doc?.kind ?? 'clipboard'}
          session={imageSession?.doc === doc ? (imageSession?.session ?? null) : null}
          obsidian={node?.properties['data-obsidian'] === 'true'}
          reference={node?.properties['data-image-reference'] as string | undefined}
        />
      ),
      table: ({ node: _node, ...props }) => (
        <div className="overflow-x-auto">
          <table {...props} />
        </div>
      ),
    }),
    [doc, imageSession],
  );
  const content = useAppStore((s) => s.doc?.content ?? null);
  const docId = useAppStore((s) => s.doc?.id ?? null);
  const contentHash = useAppStore((s) => s.doc?.contentHash ?? null);
  const format = useAppStore((s) => s.doc?.format ?? 'markdown');
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const annotationsOpen = useAppStore((s) => s.annotationsOpen);
  const view = useAppStore((s) => s.view);
  const openDialog = useAppStore((s) => s.openDialog);
  const annotations = useAppStore((s) => s.annotations);
  const annotationsHash = useAppStore((s) => s.annotationsHash);
  const editing = useAppStore((s) => s.editing);
  const typography = useAppStore((s) => s.settings.typography[format]);
  const panels = useAppStore((s) => s.settings.panels);
  const theme = useAppStore((s) => s.resolvedTheme);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const articleRef = useRef<HTMLElement | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pickedAnnotationId, setPickedAnnotationId] = useState<string | null>(null);
  // At most one comment is written in the list at a time; it belongs to this
  // document and goes with it. `initial` is what its box opens on.
  const [listEditor, setListEditor] = useState<ListEditor | null>(null);
  useEffect(() => setListEditor(null), [docId]);
  // Reading the Markdown behind the page is a look, not a mode to live in: it
  // belongs to this document, in this window, and the next document opens
  // rendered as always.
  const [sourceView, setSourceView] = useState(false);
  const showingSource = sourceView && format === 'markdown';
  const [importOpen, setImportOpen] = useState(false);
  const importDisabledReason = importUnavailableReason({
    editing,
    sourceView: showingSource,
    annotationsHash,
    contentHash,
  });
  // Any navigation or rendering revision discards the old preview. Keeping the
  // sidebar mounted underneath preserves its unsaved comment text.
  useEffect(() => setImportOpen(false), [doc, editing, showingSource, view, openDialog, annotationsHash]);

  useEffect(() => setSourceView(false), [docId]);
  // Editing replaces whichever view was up, and leaving it comes back to the
  // rendered document — the one the annotations live in.
  useEffect(() => {
    if (editing) setSourceView(false);
  }, [editing]);

  // Split metadata before rewriting CLI tables: a YAML literal block may
  // itself contain a grid that must stay verbatim. Neither transform reaches
  // the store, source view, copied text or document statistics.
  const { frontMatter, renderedMarkdown } = useMemo(() => {
    const frontMatter = format === 'markdown' ? splitFrontMatter(content ?? '') : null;
    return { frontMatter, renderedMarkdown: convertBoxTables(frontMatter?.body ?? content ?? '') };
  }, [content, format]);

  const annotator = useTextAnnotator({
    // Source view drops the annotator entirely, which is what makes selecting
    // text there an ordinary selection again: no draft, no popup, no
    // highlights. Switching back rebuilds it from the store, annotations and
    // all — their offsets were only ever measured against the rendered text.
    //
    // Edit mode drops it the same way, and so does the moment after a save:
    // until the annotations have been moved onto the new text, the store's
    // offsets belong to the old one (see the re-anchoring effect below).
    enabled: !!content && !showingSource && !editing && annotationsHash === contentHash,
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
  // the thing on screen: settings, export and the ⌘O panel are laid over it,
  // and a key press meant for them must not scroll the page behind.
  const search = useDocSearch({
    containerRef: annotator.containerRef,
    scrollRef,
    revision: `${docId}#${contentHash}#${showingSource}`,
    enabled: !!content && view === 'reader' && !openDialog && !editing && !importOpen,
    onTakeSelection: annotator.dismissPopup,
  });

  // In the editor both keys are the editor's own: ⌘F opens its search panel
  // and ⌘A selects all of its text, not just the lines it has drawn.
  useSelectAll({
    targetRef: articleRef,
    enabled: !!content && view === 'reader' && !openDialog && !editing && !importOpen,
  });
  useSaveShortcut(editing && view === 'reader' && !openDialog);

  // A save has just replaced the text under the annotations. The rendered
  // document is still mounted behind the editor (hidden, not unmounted), so by
  // the time this runs it shows the new text; collect it in the annotator's
  // terms and move the annotations onto it. Until that settles the hashes
  // again, the annotator above stays off.
  //
  // A document opened with annotations from before list numbers were text
  // comes through here too: same text, but the numbers are new to its
  // annotations, and they are moved past them exactly rather than searched for.
  useEffect(() => {
    const container = annotator.containerRef.current;
    if (!container || content === null || annotationsHash === contentHash || showingSource) return;
    if (contentHash !== null && annotationsHash === preListNumbersHash(contentHash)) {
      moveOntoListNumbers(collectAnnotatableSegments(container));
    } else {
      rebaseAfterSave(collectAnnotatableText(container));
    }
  }, [content, contentHash, annotationsHash, showingSource, annotator.containerRef]);

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
  // would light up for the whole document. Off while editing too: a save
  // rebuilds the headings behind the editor, where the hidden document has no
  // layout — every heading measures at the top, and the last entry would stay
  // lit on the way back to View. Leaving edit mode runs it again, on a page
  // that is there to measure.
  useEffect(() => {
    const scroller = scrollRef.current;
    const container = annotator.containerRef.current;
    if (!scroller || !container || toc.length === 0 || showingSource || editing) return;

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
  }, [toc, showingSource, editing, annotator.containerRef]);

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

  // The popup's → button. A draft becomes an annotation first — with what was
  // typed, or as a plain highlight — so there is an entry to write in; an
  // existing one keeps whatever was changed. Either way nothing typed so far is
  // lost, and the list's box opens on it as typed: whoever stopped mid-sentence
  // to move carries on from the space they had just typed.
  const moveCommentToList = (text: string) => {
    if (!popup) return;
    const comment = text.trim() || null;
    let id: string;
    if (popup.kind === 'draft') {
      const created = annotator.commitDraft(comment);
      if (!created) return;
      id = created.id;
    } else {
      id = popup.annotationId;
      if (comment !== (popupAnnotation?.comment ?? null)) annotator.saveComment(id, comment);
      annotator.dismissPopup();
    }
    useAppStore.getState().showAnnotations();
    setPickedAnnotationId(id);
    setListEditor({ id, initial: text });
  };
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
          <aside
            inert={importOpen}
            className="max-w-[40%] shrink-0 overflow-y-auto bg-neutral-50"
            style={{ width: panels.toc }}
          >
            <PanelContent inert={showingSource || editing}>
              <Toc items={toc} activeId={activeId} onJump={jumpTo} />
            </PanelContent>
          </aside>
          <PanelResizeHandle side="toc" containerRef={rootRef} />
        </>
      )}
      {/* A positioned box around the scroller, and nothing else: the find bar
        has to stay put while the document scrolls under it, which it could
        not do from inside the scroller. */}
      <div inert={importOpen} className="relative flex min-w-0 flex-1 flex-col">
        {/* Focusable, and the only thing here that is: a click on the prose has
          to land somewhere for ⌘A to mean this document rather than this
          window — and, incidentally, for the space bar and the arrow keys to
          scroll it at all.

          Hidden rather than unmounted while editing: the rendered document
          is what a save's re-anchoring reads the new text from. */}
        <div
          ref={scrollRef}
          tabIndex={-1}
          hidden={editing}
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
                {frontMatter && <FrontMatter yaml={frontMatter.yaml} />}
                {/* A table cannot wrap below its min-content width, and the
                  scroller no longer scrolls sideways for it — so a wide table
                  scrolls inside its own box, like `pre` always has. */}
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkObsidianImages]}
                  rehypePlugins={[rehypeListNumbers]}
                  components={imageComponents}
                >
                  {renderedMarkdown}
                </ReactMarkdown>
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
                onMoveToPanel={moveCommentToList}
                onDismiss={annotator.dismissPopup}
              />
            )}
          </div>
        </div>
        {editing && content !== null && <CodeEditor content={content} format={format} typography={typography} />}
        {search.open && !editing && (
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
            editing={editing}
            onToggleSource={() => setSourceView((showing) => !showing)}
          />
        )}
      </div>
      {annotationsOpen && (
        <>
          <PanelResizeHandle side="annotations" containerRef={rootRef} />
          <aside
            inert={importOpen}
            className="max-w-[40%] shrink-0 overflow-y-auto bg-neutral-50"
            style={{ width: panels.annotations }}
          >
            <PanelContent inert={showingSource || editing}>
              <AnnotationList
                annotations={annotations}
                activeId={activeAnnotationId}
                editing={listEditor}
                onJump={jumpToAnnotation}
                // Writing about a passage starts with it in view.
                onEdit={(id) => {
                  jumpToAnnotation(id);
                  setListEditor({ id, initial: annotations.find((a) => a.id === id)?.comment ?? '' });
                }}
                onEditDone={() => setListEditor(null)}
                onSaveComment={annotator.saveComment}
                onDelete={annotator.deleteAnnotation}
                importDisabledReason={importDisabledReason}
                onImport={() => setImportOpen(true)}
              />
            </PanelContent>
          </aside>
        </>
      )}
      {importOpen && doc && (
        <ImportAnnotations
          doc={doc}
          readText={() => {
            const container = annotator.containerRef.current;
            return !container || importDisabledReason ? null : collectAnnotatableText(container);
          }}
          onClose={() => setImportOpen(false)}
        />
      )}
    </div>
  );
}
