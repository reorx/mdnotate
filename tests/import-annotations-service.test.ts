// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  Object.defineProperty(globalThis, 'matchMedia', {
    writable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
});
vi.mock('../src/lib/annotations-db', () => ({
  recordAnnotation: vi.fn(async () => {}),
  forgetAnnotation: vi.fn(async () => {}),
  rebaseAnnotations: vi.fn(),
}));
import { useAppStore } from '../src/store';
import { importAnnotations, updateComment, deleteAnnotation } from '../src/lib/annotate';
import { recordAnnotation, forgetAnnotation } from '../src/lib/annotations-db';
import { prepareAnnotationImport } from '../src/lib/import-annotations';
import type { OpenDoc } from '../src/lib/recent-docs';
const doc: OpenDoc = {
  id: 'file:/a.md',
  source: '/a.md',
  title: 'a',
  kind: 'file',
  format: 'markdown',
  content: 'hello world',
  contentHash: 'hash',
};
const readText = () => useAppStore.getState().doc?.content ?? null;
const prepare = (input = '> hello\nnote') => prepareAnnotationImport(doc, input, 'hello world', []);

describe('import submission through annotate', () => {
  beforeEach(() => {
    vi.mocked(recordAnnotation).mockReset().mockResolvedValue();
    vi.mocked(forgetAnnotation).mockClear();
    useAppStore.getState().openDoc(doc);
  });
  it('preview and cancel have no writes; no valid entries cannot submit', async () => {
    prepare();
    expect(recordAnnotation).not.toHaveBeenCalled();
    expect((await importAnnotations(prepare('> absent'), readText)).status).toBe('empty');
    expect(useAppStore.getState().annotations).toEqual([]);
    expect(recordAnnotation).not.toHaveBeenCalled();
  });
  it('appends immediately with new IDs/times, persists, and supports comment updates and deletion', async () => {
    const result = await importAnnotations(prepare(), readText);
    expect(result).toMatchObject({ status: 'imported', saved: 1, failed: 0 });
    const [a] = useAppStore.getState().annotations;
    expect(a).toMatchObject({ quote: 'hello', start: 0, end: 5, comment: 'note' });
    expect(a.id).toMatch(/^[\da-f-]{36}$/);
    expect(a.createdAt).toBeGreaterThan(1);
    expect(useAppStore.getState().annotationsOpen).toBe(true);
    expect(recordAnnotation).toHaveBeenCalledWith(doc.id, doc.contentHash, a);
    updateComment(a.id, 'edited');
    expect(recordAnnotation).toHaveBeenLastCalledWith(
      doc.id,
      doc.contentHash,
      expect.objectContaining({ comment: 'edited' }),
    );
    deleteAnnotation(a.id);
    expect(forgetAnnotation).toHaveBeenCalledWith(a.id);
  });
  it.each(['document', 'hash', 'text', 'editing', 'migration', 'source', 'overlay', 'dialog', 'reopen'])(
    'refuses a preview after %s changes',
    async (change) => {
      const plan = prepare();
      let currentText: string | null = 'hello world';
      if (change === 'document') useAppStore.getState().openDoc({ ...doc, id: 'file:/b.md' });
      if (change === 'hash') useAppStore.getState().openDoc({ ...doc, contentHash: 'new' });
      if (change === 'text') currentText = 'hello changed';
      if (change === 'editing') useAppStore.getState().setEditing(true);
      if (change === 'migration') useAppStore.setState({ annotationsHash: 'old' });
      if (change === 'source') currentText = null;
      if (change === 'overlay') useAppStore.getState().setView('export');
      if (change === 'dialog') useAppStore.getState().setOpenDialog(true);
      if (change === 'reopen') useAppStore.getState().openDoc({ ...doc });
      expect((await importAnnotations(plan, () => currentText)).status).toBe('stale');
      expect(recordAnnotation).not.toHaveBeenCalled();
    },
  );
  it('rechecks existing annotations and repeated clicks without double writes', async () => {
    const plan = prepare();
    const results = await Promise.all([importAnnotations(plan, readText), importAnnotations(plan, readText)]);
    expect(results.map((r) => r.status)).toEqual(['imported', 'empty']);
    expect(recordAnnotation).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().annotations).toHaveLength(1);
  });
  it('reports partial persistence honestly and binds every asynchronous write to the original document', async () => {
    let finish: () => void = () => {};
    vi.mocked(recordAnnotation)
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      )
      .mockRejectedValueOnce(new Error('disk full'));
    const pending = importAnnotations(prepare('> hello\n\n> world'), readText);
    expect(useAppStore.getState().annotations).toHaveLength(2);
    useAppStore.getState().openDoc({ ...doc, id: 'file:/b.md' });
    finish();
    expect(await pending).toMatchObject({ status: 'imported', saved: 1, failed: 1 });
    expect(vi.mocked(recordAnnotation).mock.calls.map((call) => call.slice(0, 2))).toEqual([
      [doc.id, doc.contentHash],
      [doc.id, doc.contentHash],
    ]);
    expect(useAppStore.getState().annotations).toEqual([]);
  });
  it('imports only ready entries from a mixed preview', async () => {
    expect(await importAnnotations(prepare('> hello\n\n> missing'), readText)).toMatchObject({ saved: 1 });
  });
  it('never promotes a skipped preview entry when an existing duplicate is removed before submission', async () => {
    const existing = { id: 'old', quote: 'hello', start: 0, end: 5, comment: 'note', createdAt: 1, updatedAt: 1 };
    useAppStore.getState().openDoc(doc, [existing]);
    const plan = prepareAnnotationImport(doc, '> hello\nnote\n\n> world', doc.content, [existing]);
    deleteAnnotation(existing.id);
    expect(await importAnnotations(plan, readText)).toMatchObject({ saved: 1 });
    expect(useAppStore.getState().annotations.map((a) => a.quote)).toEqual(['world']);
  });
});
