import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', 'data');
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(join(dataDir, 'scout.sqlite'));

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_url TEXT NOT NULL,
    status TEXT NOT NULL,
    summary TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER,
    name TEXT NOT NULL,
    website TEXT,
    segment TEXT,
    fit_score INTEGER NOT NULL DEFAULT 50,
    evidence TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(website)
  );

  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER,
    email TEXT,
    phone TEXT,
    name TEXT,
    role TEXT,
    source_url TEXT NOT NULL,
    confidence INTEGER NOT NULL DEFAULT 50,
    status TEXT NOT NULL DEFAULT 'new',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(email, source_url)
  );

  CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER,
    name TEXT NOT NULL,
    audience TEXT NOT NULL,
    offer TEXT NOT NULL,
    cadence_days INTEGER NOT NULL DEFAULT 7,
    next_run_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS outreach_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER,
    lead_id INTEGER,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    scheduled_for TEXT NOT NULL,
    sent_at TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(campaign_id, lead_id, scheduled_for)
  );
`);

export function all(sql, params = {}) {
  const statement = db.prepare(sql);
  return Array.isArray(params) ? statement.all(...params) : statement.all(params);
}

export function get(sql, params = {}) {
  const statement = db.prepare(sql);
  return Array.isArray(params) ? statement.get(...params) : statement.get(params);
}

export function run(sql, params = {}) {
  const statement = db.prepare(sql);
  return Array.isArray(params) ? statement.run(...params) : statement.run(params);
}
