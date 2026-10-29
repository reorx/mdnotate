import { splitStaleAnnotations, type Annotation, type StoredAnnotation } from './annotations';
import { db } from './db';
import { preListNumbersHash } from './recent-docs';
import { isTauri } from './tauri-env';

/**
 * Annotation storage. Rows hang off a recents entry (`doc_id`), so a document
 * the user forgets forgets its highlights with it, and they carry the hash of
 * the content they were made on, so a document that has changed underneath them
 * does not get them back.
 */

const COLUMNS = 'id, doc_hash, quote, start_offset, end_offset, comment, created_at, updated_at';

interface Row {
  id: string;
  doc_hash: string;
  quote: string;
  start_offset: number;
  end_offset: number;
  comment: string | null;
  created_at: number;
  updated_at: number;
}

function toStored(row: Row): StoredAnnotation {
  return {
    id: row.id,
    docHash: row.doc_hash,
    quote: row.quote,
    start: row.start_offset,
    end: row.end_offset,
    comment: row.comment,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface RestoredAnnotations {
  annotations: Annotation[];
  /**
   * The hash their offsets were measured on: `docHash`, unless they were made
   * before list numbers became text and still have to be moved onto it (see
   * `moveOntoListNumbers`).
   */
  annotationsHash: string;
  /** How many were given up on because the document has changed since. */
  discarded: number;
}

/**
 * Put the split into the shape the reader opens with. Annotations to be moved
 * are only ever returned on their own — `splitStaleAnnotations` sees to that.
 */
function restored(
  docHash: string,
  { fresh, legacy, stale }: ReturnType<typeof splitStaleAnnotations>,
): RestoredAnnotations {
  const legacyHash = preListNumbersHash(docHash);
  return legacy.length > 0 && legacyHash !== null
    ? { annotations: legacy, annotationsHash: legacyHash, discarded: stale.length }
    : { annotations: fresh, annotationsHash: docHash, discarded: stale.length };
}

/**
 * The annotations to reopen a document with. Ones anchored to older content are
 * dropped here rather than kept around to be re-checked on every open.
 */
export async function restoreAnnotations(docId: string, docHash: string): Promise<RestoredAnnotations> {
  if (!isTauri) return fallback.restore(docId, docHash);
  const conn = await db();
  const rows = await conn.select<Row[]>(`SELECT ${COLUMNS} FROM annotations WHERE doc_id = $1`, [docId]);
  const split = splitStaleAnnotations(rows.map(toStored), docHash, preListNumbersHash(docHash));
  for (const row of split.stale) {
    await conn.execute('DELETE FROM annotations WHERE id = $1', [row.id]);
  }
  return restored(docHash, split);
}

/**
 * Write an annotation. The same statement serves creating one and editing its
 * comment: quote and offsets are fixed once the highlight is committed, so only
 * the comment can arrive changed.
 */
export async function recordAnnotation(docId: string, docHash: string, annotation: Annotation): Promise<void> {
  if (!isTauri) return fallback.record(docId, docHash, annotation);
  await (await db()).execute(
    `INSERT INTO annotations (id, doc_id, doc_hash, quote, start_offset, end_offset, comment, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT(id) DO UPDATE SET
       comment = excluded.comment,
       updated_at = excluded.updated_at`,
    [
      annotation.id,
      docId,
      docHash,
      annotation.quote,
      annotation.start,
      annotation.end,
      annotation.comment,
      annotation.createdAt,
      annotation.updatedAt,
    ],
  );
}

/**
 * Move a document's annotations onto the text it was just saved as, or now
 * renders as: the ones found again take the new hash and offsets, the ones
 * that were not are gone.
 *
 * The exception to "quote and offsets are fixed once committed" — the only
 * time offsets change is when the text under them does, and this is that time.
 * The quote is written along with them: a highlight across two list items
 * takes in the number between them once that number is text.
 */
export async function rebaseAnnotations(
  docId: string,
  docHash: string,
  kept: Annotation[],
  lostIds: string[],
): Promise<void> {
  if (!isTauri) return fallback.rebase(docId, docHash, kept, lostIds);
  const conn = await db();
  for (const annotation of kept) {
    await conn.execute(
      'UPDATE annotations SET doc_hash = $1, quote = $2, start_offset = $3, end_offset = $4 WHERE id = $5 AND doc_id = $6',
      [docHash, annotation.quote, annotation.start, annotation.end, annotation.id, docId],
    );
  }
  for (const id of lostIds) {
    await conn.execute('DELETE FROM annotations WHERE id = $1', [id]);
  }
}

export async function forgetAnnotation(id: string): Promise<void> {
  if (!isTauri) return fallback.forget(id);
  await (await db()).execute('DELETE FROM annotations WHERE id = $1', [id]);
}

/**
 * Drop a document's annotations, or every document's when given null. Only the
 * browser fallback needs this: in SQLite the foreign key cascade does it.
 */
export async function forgetDocAnnotations(docId: string | null): Promise<void> {
  if (isTauri) return;
  fallback.write(docId === null ? [] : fallback.read().filter((r) => r.docId !== docId));
}

/** How many annotations each document has, for the recents list. */
export async function countAnnotations(): Promise<Record<string, number>> {
  if (!isTauri) return fallback.counts();
  const rows = await (await db()).select<{ doc_id: string; count: number }[]>(
    'SELECT doc_id, COUNT(*) AS count FROM annotations GROUP BY doc_id',
  );
  return Object.fromEntries(rows.map((row) => [row.doc_id, row.count]));
}

/** Stand-in for plain-browser dev, mirroring the table as a flat list. */
const FALLBACK_KEY = 'annotations';

interface FallbackRow extends StoredAnnotation {
  docId: string;
}

const fallback = {
  read(): FallbackRow[] {
    const raw = localStorage.getItem(FALLBACK_KEY);
    return raw ? (JSON.parse(raw) as FallbackRow[]) : [];
  },
  write(rows: FallbackRow[]) {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(rows));
  },
  async restore(docId: string, docHash: string): Promise<RestoredAnnotations> {
    const rows = fallback.read();
    const split = splitStaleAnnotations(
      rows.filter((r) => r.docId === docId),
      docHash,
      preListNumbersHash(docHash),
    );
    const staleIds = new Set(split.stale.map((r) => r.id));
    if (staleIds.size > 0) fallback.write(rows.filter((r) => !staleIds.has(r.id)));
    return restored(docHash, split);
  },
  async record(docId: string, docHash: string, annotation: Annotation) {
    const rest = fallback.read().filter((r) => r.id !== annotation.id);
    fallback.write([...rest, { ...annotation, docId, docHash }]);
  },
  async forget(id: string) {
    fallback.write(fallback.read().filter((r) => r.id !== id));
  },
  async rebase(docId: string, docHash: string, kept: Annotation[], lostIds: string[]) {
    const moved = new Map(kept.map((a) => [a.id, a]));
    fallback.write(
      fallback
        .read()
        .filter((r) => !lostIds.includes(r.id))
        .map((r) => {
          const annotation = r.docId === docId ? moved.get(r.id) : undefined;
          return annotation
            ? { ...r, docHash, quote: annotation.quote, start: annotation.start, end: annotation.end }
            : r;
        }),
    );
  },
  async counts(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const row of fallback.read()) counts[row.docId] = (counts[row.docId] ?? 0) + 1;
    return counts;
  },
};
