// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  Object.defineProperty(globalThis, 'matchMedia', {
    writable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
});
import { importAnnotations, updateComment, deleteAnnotation } from '../src/lib/annotate';
import { restoreAnnotations } from '../src/lib/annotations-db';
import {
  prepareAnnotationImport,
  previewAnnotationImport,
  importUnavailableReason,
} from '../src/lib/import-annotations';
import { collectAnnotatableText } from '../src/lib/reanchor';
import type { OpenDoc } from '../src/lib/recent-docs';
import { useAppStore } from '../src/store';
const doc: OpenDoc = {
  id: 'clip:hello',
  kind: 'clipboard',
  title: 'hello',
  source: 'hello',
  content: 'hello world',
  format: 'markdown',
  contentHash: 'hash',
};
beforeEach(() => {
  localStorage.clear();
  useAppStore.getState().openDoc(doc);
});
it('restores an import and later comment changes/deletions through the real browser persistence path', async () => {
  const preview = prepareAnnotationImport(doc, '> hello\nnote\n\n> world', doc.content, []);
  expect(await importAnnotations(preview, () => doc.content)).toMatchObject({ saved: 2, failed: 0 });
  const [first, second] = useAppStore.getState().annotations;
  updateComment(first.id, '更新后的评论');
  deleteAnnotation(second.id);
  const restored = await restoreAnnotations(doc.id, doc.contentHash);
  useAppStore.getState().openDoc(doc, restored.annotations, restored.annotationsHash);
  expect(useAppStore.getState().annotations).toHaveLength(1);
  expect(useAppStore.getState().annotations[0]).toMatchObject({
    ...first,
    comment: '更新后的评论',
    updatedAt: expect.any(Number),
  });
});
it('reports real fallback storage errors without claiming persistence or losing on-screen annotations', async () => {
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('QuotaExceededError');
  });
  try {
    const result = await importAnnotations(prepareAnnotationImport(doc, '> hello', doc.content, []), () => doc.content);
    expect(result).toMatchObject({ status: 'imported', saved: 0, failed: 1 });
    expect(useAppStore.getState().annotations).toHaveLength(1);
    expect(useAppStore.getState().error).toContain('not saved');
    expect((await restoreAnnotations(doc.id, doc.contentHash)).annotations).toEqual([]);
  } finally {
    write.mockRestore();
  }
});
it('anchors against front matter values and literal list numbers, skipping image status and controls', () => {
  const container = document.createElement('div');
  container.innerHTML =
    '<div><span class="not-annotatable">Front matter</span><span>title</span><span>中文😀</span></div><ol><li><span class="list-number">1. </span>First</li></ol><div class="not-annotatable">Loading image</div><p>Last</p>';
  const text = collectAnnotatableText(container);
  expect(text).toBe('title中文😀1. FirstLast');
  expect(previewAnnotationImport('> 1. First\n\n> 中文😀', text, []).map((r) => [r.start, r.end])).toEqual([
    [9, 17],
    [5, 9],
  ]);
});
it('explains unavailable rendered states', () => {
  const base = { editing: false, sourceView: false, annotationsHash: 'hash', contentHash: 'hash' };
  expect(importUnavailableReason(base)).toBeNull();
  expect(importUnavailableReason({ ...base, editing: true })).toMatch(/Switch to View/);
  expect(importUnavailableReason({ ...base, sourceView: true })).toMatch(/rendered/);
  expect(importUnavailableReason({ ...base, annotationsHash: 'old' })).toMatch(/relocating/);
});
