import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "airdrop.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT 'direct',
  category TEXT NOT NULL DEFAULT 'testnet',
  chains TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  tge_date TEXT,
  notes TEXT NOT NULL DEFAULT '',
  rss_url TEXT NOT NULL DEFAULT '',
  enrichment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  freq TEXT NOT NULL DEFAULT 'daily',
  onchain INTEGER NOT NULL DEFAULT 0,
  chain TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS task_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  auto INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(task_id, day)
);

CREATE TABLE IF NOT EXISTS wallets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS news_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  body TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'other',
  important INTEGER NOT NULL DEFAULT 0,
  day TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  tier TEXT NOT NULL DEFAULT 'C',
  reasons TEXT NOT NULL DEFAULT '',
  effort TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new',
  project_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tg_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat TEXT NOT NULL,
  chat_title TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  link TEXT NOT NULL UNIQUE,
  date TEXT,
  processed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tge_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  tge_date TEXT,
  note TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL UNIQUE,
  project_id INTEGER,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// lightweight migration: add columns introduced after first deploy
const oppoCols = (db.prepare("PRAGMA table_info(opportunities)").all() as Array<{ name: string }>).map((c) => c.name);
if (!oppoCols.includes("name")) db.exec("ALTER TABLE opportunities ADD COLUMN name TEXT NOT NULL DEFAULT ''");
if (!oppoCols.includes("funding")) db.exec("ALTER TABLE opportunities ADD COLUMN funding TEXT NOT NULL DEFAULT ''");
if (!oppoCols.includes("tokenomics")) db.exec("ALTER TABLE opportunities ADD COLUMN tokenomics TEXT NOT NULL DEFAULT ''");
if (!oppoCols.includes("x_followers")) db.exec("ALTER TABLE opportunities ADD COLUMN x_followers TEXT NOT NULL DEFAULT ''");
// jenis garapan: testnet/mainnet/quest/node/waitlist/social/bot/other — biar user tau cara nanggepin saran
if (!oppoCols.includes("quest_type")) db.exec("ALTER TABLE opportunities ADD COLUMN quest_type TEXT NOT NULL DEFAULT ''");

const tgCols = (db.prepare("PRAGMA table_info(tg_messages)").all() as Array<{ name: string }>).map((c) => c.name);
if (!tgCols.includes("processed")) db.exec("ALTER TABLE tg_messages ADD COLUMN processed INTEGER NOT NULL DEFAULT 0");
// engagement: reaksi emoji + jumlah reply per pesan — buat penilaian tier garapan
if (!tgCols.includes("reactions")) db.exec("ALTER TABLE tg_messages ADD COLUMN reactions INTEGER NOT NULL DEFAULT 0");
if (!tgCols.includes("replies")) db.exec("ALTER TABLE tg_messages ADD COLUMN replies INTEGER NOT NULL DEFAULT 0");
// teks hasil OCR foto pesan — diisi sekali oleh pipeline berita (vision LLM)
if (!tgCols.includes("ocr_text")) db.exec("ALTER TABLE tg_messages ADD COLUMN ocr_text TEXT NOT NULL DEFAULT ''");

// link quest: teken task -> langsung ke halaman tugasnya (form, galxe, app)
const taskCols = (db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>).map((c) => c.name);
if (!taskCols.includes("link")) db.exec("ALTER TABLE tasks ADD COLUMN link TEXT NOT NULL DEFAULT ''");
// sumber misi: link t.me ke pesan grup yang bahas quest tsb
if (!taskCols.includes("source")) db.exec("ALTER TABLE tasks ADD COLUMN source TEXT NOT NULL DEFAULT ''");
// task lama yang link-nya isinya t.me (pesan grup, bukan halaman tugas) → pindah ke source
db.exec("UPDATE tasks SET source = link, link = '' WHERE link != '' AND (link LIKE '%t.me/%' OR link LIKE '%telegram.me/%')");
// slot referral milik user sendiri, ditaruh manual per garapan
const projCols = (db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>).map((c) => c.name);
if (!projCols.includes("referral")) db.exec("ALTER TABLE projects ADD COLUMN referral TEXT NOT NULL DEFAULT ''");
// ekosistem = garapan di dalam garapan (mainnet/testnet): baris project asli dengan parent.
// FK-nya sengaja gak dipasang di sini — hapus parent di-cascade manual di route DELETE,
// sehingga data anak dibersihin semua walau foreign_keys pragma gak aktif
if (!projCols.includes("parent_id")) db.exec("ALTER TABLE projects ADD COLUMN parent_id INTEGER");
// sisa model chip ekosistem yang kupensi ulang jadi sub-project — tabelnya kosong di semua DB
db.exec("DROP TABLE IF EXISTS ecosystems");

// index buat query panas (poll 5 menit + dashboard 30 detik) — sekali bikin, selamanya ngebut
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_task_logs_task ON task_logs(task_id, day);
  CREATE INDEX IF NOT EXISTS idx_tg_messages_processed ON tg_messages(processed);
  CREATE INDEX IF NOT EXISTS idx_tg_messages_chat_date ON tg_messages(chat, date);
  CREATE INDEX IF NOT EXISTS idx_opportunities_status ON opportunities(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_projects_parent ON projects(parent_id);
  CREATE INDEX IF NOT EXISTS idx_news_items_day ON news_items(day);
  CREATE INDEX IF NOT EXISTS idx_news_items_project ON news_items(project_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
`);

export default db;
