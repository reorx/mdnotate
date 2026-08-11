import Database from '@tauri-apps/plugin-sql';

/** Schema lives in the Rust migrations registered for this same URL. */
const DB_URL = 'sqlite:mdnotate.db';

let connection: Promise<Database> | null = null;

/**
 * The one connection to the app database, shared by every table module —
 * `Database.load` opens a fresh pool on each call, so it is made exactly once.
 */
export function db(): Promise<Database> {
  connection ??= Database.load(DB_URL);
  return connection;
}
