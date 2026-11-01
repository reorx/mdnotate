import { expect, it, vi } from 'vitest';
import { createImageSession, imageSource } from '../src/lib/doc-image';

it('classifies remote, local, and unavailable source contexts safely', () => {
  expect(imageSource('https://example.com/a.webp', 'clipboard')).toBe('remote');
  expect(imageSource('a.webp', 'file')).toBe('local');
  expect(imageSource('a.webp', 'ssh')).toBe('unavailable');
  expect(imageSource('javascript:alert(1)', 'file')).toBe('unavailable');
});
it('batches resolution, deduplicates bytes and revokes document-owned URLs', async () => {
  const resolve = vi.fn(async (_note, refs) => refs.map(() => ({ Ok: '/a.webp' })));
  const read = vi.fn(async () => new ArrayBuffer(12));
  const create = vi.fn(() => 'blob:a');
  const revoke = vi.fn();
  const session = createImageSession('/note.md', { resolve, read, create, revoke });
  const a = session.load('a.webp', true);
  const b = session.load('a.webp', true);
  const c = session.load('other.webp', false);
  expect(await a).toBe('blob:a');
  expect(await b).toBe('blob:a');
  expect(await c).toBe('blob:a');
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledTimes(1);
  session.dispose();
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:a');
});
it('never publishes an image after its document was disposed', async () => {
  let finish!: (bytes: ArrayBuffer) => void;
  const create = vi.fn();
  const session = createImageSession('/note.md', {
    resolve: async () => [{ Ok: '/a.webp' }],
    read: () => new Promise(resolve => { finish = resolve; }), create, revoke: vi.fn(),
  });
  const pending = session.load('a.webp', true);
  await vi.waitFor(() => expect(finish).toBeDefined());
  session.dispose(); finish(new ArrayBuffer(1));
  await expect(pending).rejects.toThrow('closed');
  expect(create).not.toHaveBeenCalled();
});
