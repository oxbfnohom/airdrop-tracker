import db from "./db";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "airdrop.db");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const KEEP = 7;

/**
 * Daily cold backup of the SQLite DB (the DB holds everything: projects,
 * tasks, archived finder messages AND the Telegram userbot session).
 * Checkpoints WAL first so the copy is complete, keeps the last 7 days.
 */
export function backupDb(): string {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  db.pragma("wal_checkpoint(TRUNCATE)");
  const day = new Date().toISOString().slice(0, 10);
  const dest = path.join(BACKUP_DIR, `airdrop-${day}.db`);
  fs.copyFileSync(DB_PATH, dest);
  const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith(".db")).sort();
  while (files.length > KEEP) fs.unlinkSync(path.join(BACKUP_DIR, files.shift() as string));
  console.log(`[backup] ${dest} (${Math.round(fs.statSync(dest).size / 1024)} KB)`);
  return dest;
}
