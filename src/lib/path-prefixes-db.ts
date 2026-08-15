import { db } from './db';
import { PREFIXES_LIMIT, upsertPrefix } from './path-prefix';
import { isTauri } from './tauri-env';

/**
 * The directories documents have been reached through, most recently used
 * first. Storage only — what a prefix means, and which of them to offer for
 * what has been typed, is `path-prefix`'s.
 */
export async function listPrefixes(): Promise<string[]> {
  if (!isTauri) return fallback.list();
  const rows = await (await db()).select<{ prefix: string }[]>(
    'SELECT prefix FROM path_prefixes ORDER BY used_at DESC',
  );
  return rows.map((row) => row.prefix);
}

/**
 * Record a prefix as just used. Using one again is what makes it recent, not
 * what makes it a second entry — hence the prefix itself as the key.
 */
export async function recordPrefix(prefix: string, usedAt: number): Promise<void> {
  if (!isTauri) return fallback.record(prefix);
  const conn = await db();
  await conn.execute(
    `INSERT INTO path_prefixes (prefix, used_at) VALUES ($1, $2)
     ON CONFLICT(prefix) DO UPDATE SET used_at = excluded.used_at`,
    [prefix, usedAt],
  );
  await conn.execute(
    'DELETE FROM path_prefixes WHERE prefix NOT IN (SELECT prefix FROM path_prefixes ORDER BY used_at DESC LIMIT $1)',
    [PREFIXES_LIMIT],
  );
}

export async function forgetPrefix(prefix: string): Promise<void> {
  if (!isTauri) return fallback.forget(prefix);
  await (await db()).execute('DELETE FROM path_prefixes WHERE prefix = $1', [prefix]);
}

/**
 * Stand-in for plain-browser dev, where there is no SQLite to talk to. The
 * array's own order is the recency the `used_at` column carries in the table.
 */
const FALLBACK_KEY = 'path-prefixes';

const fallback = {
  read(): string[] {
    const raw = localStorage.getItem(FALLBACK_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  },
  write(prefixes: string[]) {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(prefixes));
  },
  async list(): Promise<string[]> {
    return fallback.read();
  },
  async record(prefix: string) {
    fallback.write(upsertPrefix(fallback.read(), prefix));
  },
  async forget(prefix: string) {
    fallback.write(fallback.read().filter((p) => p !== prefix));
  },
};
