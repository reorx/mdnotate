import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAppStore } from '../store';
import { createAnnotation, deleteAnnotation, updateComment } from '../lib/annotate';
import { buildToc, type TocItem } from '../lib/toc';
import { useTextAnnotator } from '../lib/use-text-annotator';
import { AnnotationPopup } from './AnnotationPopup';
import { Toc } from './Toc';

export function Reader() {
  const content = useAppStore((s) => s.doc?.content ?? null);
  const docId = useAppStore((s) => s.doc?.id ?? null);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const annotations = useAppStore((s) => s.annotations);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const annotator = useTextAnnotator({
    enabled: !!content,
    documentKey: docId,
    annotations,
    onCreate: createAnnotation,
    onRemove: deleteAnnotation,
    onSetComment: updateComment,
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

  const popup = annotator.popup;
  const popupAnnotation = popup?.kind === 'view' ? annotations.find((a) => a.id === popup.annotationId) : undefined;

  return (
    <div className="flex min-h-0 flex-1">
      {sidebarOpen && (
        <aside className="w-60 shrink-0 overflow-y-auto border-r border-neutral-200 bg-neutral-50">
          <Toc items={toc} activeId={activeId} onJump={jumpTo} />
        </aside>
      )}
      <div ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto">
        <div ref={annotator.containerRef} className="relative mx-auto max-w-[46rem] px-8 py-6">
          <article className="prose-dense">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content ?? ''}</ReactMarkdown>
          </article>
          {popup && (
            <AnnotationPopup
              key={popup.kind === 'draft' ? popup.draftId : popup.annotationId}
              popup={popup}
              annotation={popupAnnotation}
              onHighlight={() => annotator.commitDraft(null)}
              onAnnotate={(comment) => annotator.commitDraft(comment)}
              onDelete={annotator.deleteAnnotation}
              onSaveComment={annotator.saveComment}
              onDismiss={annotator.discardDraft}
            />
          )}
        </div>
      </div>
    </div>
  );
}
