import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./env";

// node:sqlite is built into Node 22.13+. Silence its one-time ExperimentalWarning so MCP stdio output stays clean.
const origEmit = process.emitWarning.bind(process) as (...a: unknown[]) => void;
(process as unknown as { emitWarning: (...a: unknown[]) => void }).emitWarning = (w: unknown, ...rest: unknown[]) => {
  const msg = typeof w === "string" ? w : ((w as Error)?.message ?? "");
  if (msg.includes("SQLite")) return;
  origEmit(w, ...rest);
};

type Stmt = {
  all: (...p: unknown[]) => unknown[];
  get: (...p: unknown[]) => unknown;
  run: (...p: unknown[]) => { changes: number | bigint; lastInsertRowid: number | bigint };
};
type Sqlite = { exec: (sql: string) => void; prepare: (sql: string) => Stmt; close: () => void };

// process.getBuiltinModule (Node 22.3+) loads the built-in at runtime; bundlers like Turbopack leave it untouched.
function openDatabase(file: string): Sqlite {
  const mod = process.getBuiltinModule("node:sqlite") as { DatabaseSync: new (f: string) => Sqlite } | undefined;
  if (!mod) throw new Error("node:sqlite is not available. Use Node.js 22.13 or newer.");
  return new mod.DatabaseSync(file);
}

export type Row = Record<string, unknown>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS clients (
  slug TEXT PRIMARY KEY, name TEXT NOT NULL, owner TEXT NOT NULL, website TEXT,
  demo INTEGER NOT NULL DEFAULT 0, credit_budget REAL NOT NULL DEFAULT 2000,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS crm_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT, client TEXT NOT NULL, kind TEXT NOT NULL,
  company TEXT, domain TEXT, email TEXT, status TEXT, data TEXT NOT NULL, imported_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS crm_client_domain ON crm_records(client, domain);
CREATE INDEX IF NOT EXISTS crm_client_email ON crm_records(client, email);
CREATE TABLE IF NOT EXISTS accounts (
  client TEXT NOT NULL, domain TEXT NOT NULL, name TEXT, industry TEXT, employees INTEGER,
  region TEXT, country TEXT, tech TEXT, description TEXT, source TEXT,
  signals TEXT NOT NULL DEFAULT '[]', score REAL, fit REAL, intent REAL, tier TEXT,
  reasons TEXT NOT NULL DEFAULT '[]', suppressed TEXT, scored_at TEXT, updated_at TEXT NOT NULL,
  PRIMARY KEY (client, domain)
);
CREATE TABLE IF NOT EXISTS contacts (
  client TEXT NOT NULL, id TEXT NOT NULL, domain TEXT NOT NULL, first_name TEXT, last_name TEXT,
  title TEXT, seniority TEXT, linkedin TEXT, email TEXT, email_status TEXT, waterfall TEXT,
  source TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (client, id)
);
CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, client TEXT NOT NULL, domain TEXT NOT NULL, contact_id TEXT,
  subject TEXT, body TEXT NOT NULL, sentences TEXT NOT NULL, sources TEXT NOT NULL, lint TEXT NOT NULL,
  verdict TEXT NOT NULL, writer TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT, client TEXT NOT NULL, name TEXT NOT NULL, segment TEXT NOT NULL,
  angle TEXT, sent INTEGER NOT NULL, replies INTEGER NOT NULL, positive INTEGER NOT NULL,
  meetings INTEGER NOT NULL, first_email TEXT, notes TEXT, file TEXT, closed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT, client TEXT NOT NULL, path TEXT NOT NULL, before TEXT NOT NULL,
  after TEXT NOT NULL, reason TEXT NOT NULL, author TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  decided_by TEXT, decided_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, client TEXT NOT NULL, path TEXT NOT NULL, content TEXT NOT NULL,
  author TEXT NOT NULL, note TEXT, proposal_id INTEGER, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT, client TEXT NOT NULL, provider TEXT NOT NULL, action TEXT NOT NULL,
  credits REAL NOT NULL, usd REAL NOT NULL, cached INTEGER NOT NULL DEFAULT 0, meta TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cache (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, client TEXT NOT NULL, kind TEXT NOT NULL, total INTEGER NOT NULL,
  cursor INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, error TEXT, updated_at TEXT NOT NULL
);
`;

let instance: Sqlite | null = null;
let instancePath = "";

export function dbPath(): string {
  return process.env.GTM_DB ?? path.join(DATA_DIR, "gtm.db");
}

export function db(): Sqlite {
  const p = dbPath();
  if (instance && instancePath === p) return instance;
  if (p !== ":memory:") fs.mkdirSync(path.dirname(p), { recursive: true });
  instance = openDatabase(p);
  instancePath = p;
  if (p !== ":memory:") instance.exec("PRAGMA journal_mode = WAL;");
  instance.exec("PRAGMA busy_timeout = 5000;");
  instance.exec(SCHEMA);
  return instance;
}

/** Close and forget the connection (tests switch databases). */
export function resetDb(): void {
  instance?.close();
  instance = null;
  instancePath = "";
}

export const now = () => new Date().toISOString();

export function all<T = Row>(sql: string, ...params: unknown[]): T[] {
  return db().prepare(sql).all(...params) as T[];
}
export function get<T = Row>(sql: string, ...params: unknown[]): T | undefined {
  return db().prepare(sql).get(...params) as T | undefined;
}
export function run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number } {
  const r = db().prepare(sql).run(...params);
  return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
}
export function tx<T>(fn: () => T): T {
  db().exec("BEGIN");
  try {
    const out = fn();
    db().exec("COMMIT");
    return out;
  } catch (e) {
    db().exec("ROLLBACK");
    throw e;
  }
}
export function json<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string" || !v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}
