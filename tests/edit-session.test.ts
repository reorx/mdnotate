// @vitest-environment jsdom

/**
 * The rules every way out of the editor goes by: the View button, closing the
 * window, quitting, and opening something else in its place all ask
 * `confirmLeaveEdits` first. What the user is asked, when they are not asked at
 * all, and what each answer does are decided here once — so they are tested
 * here once, with the dialogs and the disk replaced by stand-ins.
 *
 * jsdom only because the store is a browser module (see `open-dialog.test.ts`).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'matchMedia', {
    writable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
});

vi.mock('../src/lib/edit-prompts', () => ({ askToSave: vi.fn(), askToOverwrite: vi.fn() }));
vi.mock('../src/lib/doc-file', () => ({ writeDocFile: vi.fn() }));
vi.mock('../src/lib/recents-db', () => ({ recordOpen: vi.fn(async () => {}) }));
vi.mock('../src/lib/annotations-db', () => ({ rebaseAnnotations: vi.fn(async () => {}) }));

import { useAppStore } from '../src/store';
import { rebaseAnnotations } from '../src/lib/annotations-db';
import { writeDocFile } from '../src/lib/doc-file';
import { askToOverwrite, askToSave } from '../src/lib/edit-prompts';
import {
  attachEditor,
  confirmLeaveEdits,
  rebaseAfterSave,
  saveEdits,
  startEditing,
  stopEditing,
  type LiveEditor,
} from '../src/lib/edit-session';
import type { Annotation } from '../src/lib/annotations';
import type { OpenDoc } from '../src/lib/recent-docs';

const DOC: OpenDoc = {
  id: 'file:/tmp/a.md',
  kind: 'file',
  title: 'a.md',
  source: '/tmp/a.md',
  content: 'old text\r\n',
  format: 'markdown',
  contentHash: 'old-hash',
  modifiedAt: 100,
};

let editorText = 'edited text\n';
let editor: LiveEditor;
let detach: () => void = () => {};

function editingDirty() {
  useAppStore.getState().openDoc(DOC);
  useAppStore.getState().setEditing(true);
  useAppStore.getState().setDirty(true);
}

describe('edit session', () => {
  beforeEach(() => {
    vi.mocked(askToSave).mockReset();
    vi.mocked(askToOverwrite).mockReset();
    vi.mocked(writeDocFile).mockReset();
    vi.mocked(rebaseAnnotations).mockClear();
    useAppStore.setState({ doc: null, annotations: [], editing: false, dirty: false, error: null });
    editorText = 'edited text\n';
    editor = { text: () => editorText, markSaved: vi.fn(), meta: { bom: false, eol: '\r\n' } };
    detach();
    detach = attachEditor(editor);
  });

  describe('starting', () => {
    it('edits a local file', () => {
      useAppStore.getState().openDoc(DOC);
      startEditing();
      expect(useAppStore.getState().editing).toBe(true);
    });

    it('will not edit a document it could not save', () => {
      useAppStore.getState().openDoc({ ...DOC, kind: 'clipboard', id: 'clip:1' });
      startEditing();
      expect(useAppStore.getState().editing).toBe(false);
    });
  });

  describe('leaving', () => {
    it('lets go without asking when nothing has changed', async () => {
      useAppStore.getState().openDoc(DOC);
      useAppStore.getState().setEditing(true);
      expect(await confirmLeaveEdits()).toBe(true);
      expect(askToSave).not.toHaveBeenCalled();
    });

    it('lets go without asking when not editing at all', async () => {
      useAppStore.getState().openDoc(DOC);
      expect(await confirmLeaveEdits()).toBe(true);
      expect(askToSave).not.toHaveBeenCalled();
    });

    it('stays put on Cancel, changes and all', async () => {
      editingDirty();
      vi.mocked(askToSave).mockResolvedValue('cancel');
      expect(await confirmLeaveEdits()).toBe(false);
      expect(useAppStore.getState()).toMatchObject({ editing: true, dirty: true });
      expect(writeDocFile).not.toHaveBeenCalled();
    });

    it('lets go on Don’t Save, writing nothing', async () => {
      editingDirty();
      vi.mocked(askToSave).mockResolvedValue('discard');
      expect(await confirmLeaveEdits()).toBe(true);
      expect(writeDocFile).not.toHaveBeenCalled();
    });

    it('saves and lets go on Save', async () => {
      editingDirty();
      vi.mocked(askToSave).mockResolvedValue('save');
      vi.mocked(writeDocFile).mockResolvedValue({ kind: 'saved', modifiedAt: 200 });
      expect(await confirmLeaveEdits()).toBe(true);
      expect(writeDocFile).toHaveBeenCalledTimes(1);
    });

    it('stays put when Save was chosen but the save failed', async () => {
      editingDirty();
      vi.mocked(askToSave).mockResolvedValue('save');
      vi.mocked(writeDocFile).mockRejectedValue(new Error('Permission denied'));
      expect(await confirmLeaveEdits()).toBe(false);
      expect(useAppStore.getState()).toMatchObject({ editing: true, dirty: true });
    });

    it('goes back to reading from the View button once it may leave', async () => {
      editingDirty();
      vi.mocked(askToSave).mockResolvedValue('discard');
      await stopEditing();
      expect(useAppStore.getState().editing).toBe(false);
    });

    it('keeps editing when the View button’s question is cancelled', async () => {
      editingDirty();
      vi.mocked(askToSave).mockResolvedValue('cancel');
      await stopEditing();
      expect(useAppStore.getState().editing).toBe(true);
    });
  });

  describe('saving', () => {
    it('writes the editor’s text back in the file’s own line endings, checked against when it was read', async () => {
      editingDirty();
      vi.mocked(writeDocFile).mockResolvedValue({ kind: 'saved', modifiedAt: 200 });

      expect(await saveEdits()).toBe(true);

      expect(writeDocFile).toHaveBeenCalledWith('/tmp/a.md', 'edited text\r\n', 100);
      expect(editor.markSaved).toHaveBeenCalledWith('edited text\n');
      const { doc, dirty, editing } = useAppStore.getState();
      expect(doc).toMatchObject({ content: 'edited text\r\n', modifiedAt: 200 });
      expect(doc?.contentHash).not.toBe('old-hash');
      expect(dirty).toBe(false);
      expect(editing).toBe(true);
    });

    it('reports a failed write and keeps the changes as unsaved', async () => {
      editingDirty();
      vi.mocked(writeDocFile).mockRejectedValue(new Error('Permission denied'));

      expect(await saveEdits()).toBe(false);

      expect(useAppStore.getState().error).toMatch(/Permission denied/);
      expect(useAppStore.getState().dirty).toBe(true);
      expect(useAppStore.getState().doc?.content).toBe(DOC.content);
    });

    it('asks before overwriting a file changed on disk, and writes nothing if told not to', async () => {
      editingDirty();
      vi.mocked(writeDocFile).mockResolvedValue({ kind: 'conflict' });
      vi.mocked(askToOverwrite).mockResolvedValue(false);

      expect(await saveEdits()).toBe(false);

      expect(writeDocFile).toHaveBeenCalledTimes(1);
      expect(useAppStore.getState().dirty).toBe(true);
    });

    it('overwrites a file changed on disk when told to, without checking again', async () => {
      editingDirty();
      vi.mocked(writeDocFile)
        .mockResolvedValueOnce({ kind: 'conflict' })
        .mockResolvedValueOnce({ kind: 'saved', modifiedAt: 300 });
      vi.mocked(askToOverwrite).mockResolvedValue(true);

      expect(await saveEdits()).toBe(true);

      expect(writeDocFile).toHaveBeenLastCalledWith('/tmp/a.md', 'edited text\r\n', undefined);
      expect(useAppStore.getState().doc?.modifiedAt).toBe(300);
    });

    it('does nothing outside edit mode', async () => {
      useAppStore.getState().openDoc(DOC);
      expect(await saveEdits()).toBe(false);
      expect(writeDocFile).not.toHaveBeenCalled();
    });

    it('runs one save at a time however often ⌘S is pressed', async () => {
      editingDirty();
      let finish: (value: { kind: 'saved'; modifiedAt: number }) => void = () => {};
      vi.mocked(writeDocFile).mockReturnValue(new Promise((resolve) => (finish = resolve)));

      const first = saveEdits();
      const second = saveEdits();
      finish({ kind: 'saved', modifiedAt: 200 });

      expect(await Promise.all([first, second])).toEqual([true, true]);
      expect(writeDocFile).toHaveBeenCalledTimes(1);
    });
  });

  describe('re-anchoring after a save', () => {
    const fox: Annotation = { id: 'f', quote: 'fox', start: 4, end: 7, comment: 'c', createdAt: 1, updatedAt: 1 };
    const gone: Annotation = { id: 'g', quote: 'gone', start: 8, end: 12, comment: null, createdAt: 1, updatedAt: 1 };

    function saved() {
      useAppStore.getState().openDoc({ ...DOC, content: 'the fox gone' }, [fox, gone]);
      useAppStore.getState().applySave({ content: 'a red fox', contentHash: 'new-hash', modifiedAt: 200 });
    }

    it('moves what it can find and settles the annotations on the new text', () => {
      saved();
      rebaseAfterSave('a red fox');
      const { annotations, annotationsHash } = useAppStore.getState();
      expect(annotations).toEqual([{ ...fox, start: 6, end: 9 }]);
      expect(annotationsHash).toBe('new-hash');
    });

    it('stores the moved ones and forgets the lost ones', () => {
      saved();
      rebaseAfterSave('a red fox');
      expect(rebaseAnnotations).toHaveBeenCalledWith(
        'file:/tmp/a.md',
        'new-hash',
        [{ ...fox, start: 6, end: 9 }],
        ['g'],
      );
    });

    it('says how many it had to give up on', () => {
      saved();
      rebaseAfterSave('a red fox');
      expect(useAppStore.getState().error).toBe('1 annotation could not be found after saving and was removed');
    });

    it('says nothing when every annotation was found', () => {
      saved();
      rebaseAfterSave('a red fox gone');
      expect(useAppStore.getState().error).toBeNull();
    });
  });
});
