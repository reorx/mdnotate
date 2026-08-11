import Database from '@tauri-apps/plugin-sql';
import { isTauri } from './tauri-env';
import { RECENTS_LIMIT, upsertRecent, type RecentDoc } from './recent-docs';

/** Schema lives in the Rust migrations registered for this same URL. */
const DB_URL = 'sqlite:mdnotate.db';

/** A recents row plus the clipboard body, which the list view never loads. */
export interface RecentEntry extends RecentDoc {
  /** Full text for clipboard entries; null for files, which are re-read from disk. */
  body: string | null;
}

const COLUMNS = 'id, kind, title, source, snippet, char_count, opened_at';

interface Row {
  id: string;
  kind: string;
  title: string;
  source: string;
  snippet: string;
  char_count: number;
  opened_at: number;
}

function toRecentDoc(row: Row): RecentDoc {
  return {
    id: row.id,
    kind: row.kind as RecentDoc['kind'],
    title: row.title,
    source: row.source,
    snippet: row.snippet,
    charCount: row.char_count,
    openedAt: row.opened_at,
  };
}

let connection: Promise<Database> | null = null;

function db(): Promise<Database> {
  connection ??= Database.load(DB_URL);
  return connection;
}

export async function listRecents(): Promise<RecentDoc[]> {
  if (!isTauri) return fallback.list();
  const rows = await (await db()).select<Row[]>(`SELECT ${COLUMNS} FROM recent_docs ORDER BY opened_at DESC`);
  return rows.map(toRecentDoc);
}

/**
 * Record an open. Re-opening the same document updates it in place and lifts it
 * back to the top: files collide on their path, clipboard entries on a hash of
 * their content, both encoded in `id`.
 */
export async function recordOpen(entry: RecentEntry): Promise<void> {
  if (!isTauri) return fallback.record(entry);
  const conn = await db();
  await conn.execute(
    `INSERT INTO recent_docs (id, kind, title, source, body, snippet, char_count, opened_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       source = excluded.source,
       body = excluded.body,
       snippet = excluded.snippet,
       char_count = excluded.char_count,
       opened_at = excluded.opened_at`,
    [entry.id, entry.kind, entry.title, entry.source, entry.body, entry.snippet, entry.charCount, entry.openedAt],
  );
  await conn.execute(
    'DELETE FROM recent_docs WHERE id NOT IN (SELECT id FROM recent_docs ORDER BY opened_at DESC LIMIT $1)',
    [RECENTS_LIMIT],
  );
}

/** Fetch a clipboard entry's stored text. Null when the row is gone or holds a file. */
export async function loadBody(id: string): Promise<string | null> {
  if (!isTauri) return fallback.body(id);
  const rows = await (await db()).select<{ body: string | null }[]>('SELECT body FROM recent_docs WHERE id = $1', [id]);
  return rows[0]?.body ?? null;
}

export async function deleteRecent(id: string): Promise<void> {
  if (!isTauri) return fallback.remove(id);
  await (await db()).execute('DELETE FROM recent_docs WHERE id = $1', [id]);
}

export async function clearRecents(): Promise<void> {
  if (!isTauri) return fallback.clear();
  await (await db()).execute('DELETE FROM recent_docs');
}

/**
 * Stand-in for plain-browser dev, where there is no SQLite to talk to.
 * Same semantics — upsert on id, newest first, capped — over localStorage.
 */
const FALLBACK_KEY = 'recent-docs';

const fallback = {
  read(): RecentEntry[] {
    const raw = localStorage.getItem(FALLBACK_KEY);
    return raw ? (JSON.parse(raw) as RecentEntry[]) : [];
  },
  write(entries: RecentEntry[]) {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(entries));
  },
  async list(): Promise<RecentDoc[]> {
    return fallback.read().map(({ body: _body, ...doc }) => doc);
  },
  async record(entry: RecentEntry) {
    fallback.write(upsertRecent(fallback.read(), entry));
  },
  async body(id: string): Promise<string | null> {
    return fallback.read().find((e) => e.id === id)?.body ?? null;
  },
  async remove(id: string) {
    fallback.write(fallback.read().filter((e) => e.id !== id));
  },
  async clear() {
    fallback.write([]);
  },
};
