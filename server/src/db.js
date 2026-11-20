import { DatabaseSync } from 'node:sqlite'; // built into Node 22.13+, so no native module to compile
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS patients (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  age INTEGER,
  note TEXT,
  reminder_email TEXT
);
CREATE TABLE IF NOT EXISTS medicines (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  strength TEXT NOT NULL DEFAULT '',
  dose TEXT NOT NULL,
  times TEXT NOT NULL,                       -- JSON array of "HH:MM"
  food TEXT NOT NULL DEFAULT 'any' CHECK (food IN ('before','after','any')),
  start_date TEXT NOT NULL,
  end_date TEXT,                             -- NULL = ongoing
  stock REAL NOT NULL DEFAULT 0,
  units_per_dose REAL NOT NULL DEFAULT 1,
  low_stock_days INTEGER NOT NULL DEFAULT 5,
  prescription_file TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_medicines_patient ON medicines(patient_id);
CREATE TABLE IF NOT EXISTS dose_logs (
  id INTEGER PRIMARY KEY,
  medicine_id INTEGER NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('given','skipped')),
  reason TEXT,
  recorded_by TEXT,
  recorded_at TEXT NOT NULL,
  UNIQUE (medicine_id, date, time)
);
CREATE INDEX IF NOT EXISTS idx_logs_date ON dose_logs(date);
CREATE TABLE IF NOT EXISTS handover_notes (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  shift TEXT NOT NULL CHECK (shift IN ('day','night')),
  note TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS alerts_sent (
  kind TEXT NOT NULL,                        -- 'missed', 'refill-low' or 'refill-critical'
  medicine_id INTEGER NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  time TEXT NOT NULL,                        -- dose time, or '' for refill alerts
  PRIMARY KEY (kind, medicine_id, date, time)
);
CREATE TABLE IF NOT EXISTS reminders_sent (
  medicine_id INTEGER NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  PRIMARY KEY (medicine_id, date, time)
);
`;

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
