/**
 * A document owns its image promises and Blob URLs. Microtask batching shares
 * one vault scan across all images mounted in the same render; resolved paths
 * deduplicate reads even when two different references name the same file.
 */
import { invoke } from '@tauri-apps/api/core';
import type { DocKind } from './recent-docs';

type Reference = { reference: string; obsidian: boolean };
type Resolution = { Ok: string } | { Err: string };
interface ImageIO {
  resolve: (note: string, references: Reference[]) => Promise<Resolution[]>;
  read: (path: string) => Promise<ArrayBuffer>;
  create: (blob: Blob) => string;
  revoke: (url: string) => void;
}
const io: ImageIO = {
  resolve: (note, references) => invoke('resolve_doc_images', { note, references }),
  read: (path) => invoke('read_doc_image', { path }),
  create: (blob) => URL.createObjectURL(blob),
  revoke: (url) => URL.revokeObjectURL(url),
};

export function imageSource(src: string, kind: DocKind): 'remote' | 'local' | 'unavailable' {
  if (/^https?:\/\//i.test(src) || src.startsWith('//')) return 'remote';
  if (!src || /^[a-z][a-z\d+.-]*:/i.test(src)) return 'unavailable';
  return kind === 'file' ? 'local' : 'unavailable';
}

export function createImageSession(note: string, transport: ImageIO = io) {
  let closed = false;
  const requests = new Map<string, Promise<string>>();
  const paths = new Map<string, Promise<string>>();
  const urls = new Set<string>();
  let queue: { reference: Reference; resolve: (url: string) => void; reject: (error: unknown) => void }[] = [];

  function read(path: string): Promise<string> {
    if (!paths.has(path))
      paths.set(
        path,
        transport.read(path).then((bytes) => {
          if (closed) throw new Error('Image session closed');
          const extension = path.split('.').pop()?.toLowerCase();
          const mime = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : `image/${extension}`;
          const url = transport.create(new Blob([bytes], { type: mime }));
          urls.add(url);
          return url;
        }),
      );
    return paths.get(path)!;
  }

  // This is the top-level async request boundary: individual failures become
  // image-local messages without aborting the other pictures or the document.
  async function flush() {
    const batch = queue;
    queue = [];
    try {
      if (closed) throw new Error('Image session closed');
      const results = await transport.resolve(
        note,
        batch.map((item) => item.reference),
      );
      batch.forEach((item, index) => {
        const result = results[index];
        if ('Err' in result) item.reject(new Error(result.Err));
        else read(result.Ok).then(item.resolve, item.reject);
      });
    } catch (error) {
      batch.forEach((item) => item.reject(error));
    }
  }

  return {
    load(reference: string, obsidian: boolean): Promise<string> {
      if (closed) return Promise.reject(new Error('Image session closed'));
      const key = JSON.stringify([reference, obsidian]);
      if (!requests.has(key))
        requests.set(
          key,
          new Promise((resolve, reject) => {
            queue.push({ reference: { reference, obsidian }, resolve, reject });
            if (queue.length === 1) queueMicrotask(flush);
          }),
        );
      return requests.get(key)!;
    },
    dispose() {
      closed = true;
      urls.forEach((url) => transport.revoke(url));
      urls.clear();
    },
  };
}
export type ImageSession = ReturnType<typeof createImageSession>;
