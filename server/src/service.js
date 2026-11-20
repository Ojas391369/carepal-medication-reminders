// Business logic. Takes a db handle so it can be tested without HTTP.
import { tx } from './db.js';
import { HttpError } from './lib/errors.js';
import { nowInTz, addDays } from './lib/dates.js';
import { dosesForDate, statusOf, adherence, stockStatus, doseKey } from './lib/schedule.js';
import { validateMedicine, validateDose, validateHandover, validateEmail } from './lib/validate.js';

const nowIso = () => new Date().toISOString();

// DB row -> the JSON shape from the brief (name, strength, dose, times, food, startDate, endDate)
// plus stock fields. endDate is '' when the medicine is ongoing.
function baseMedicine(r) {
  return {
    id: r.id, patientId: r.patient_id, name: r.name, strength: r.strength, dose: r.dose,
    times: JSON.parse(r.times), food: r.food, startDate: r.start_date, endDate: r.end_date ?? '',
    stock: r.stock, unitsPerDose: r.units_per_dose, lowStockDays: r.low_stock_days,
    hasPrescription: Boolean(r.prescription_file),
  };
}

export function getPatient(db, id) {
  if (!Number.isInteger(id)) throw new HttpError(400, 'Invalid patient id');
  const p = db.prepare('SELECT * FROM patients WHERE id = ?').get(id);
  if (!p) throw new HttpError(404, 'Patient not found');
  return p;
}

export function listPatients(db) {
  return db.prepare('SELECT id, name, age, note, reminder_email AS reminderEmail FROM patients ORDER BY name').all().map((p) => ({ ...p }));
}

export function setReminderEmail(db, patientId, email) {
  getPatient(db, patientId);
  const clean = validateEmail(email);
  db.prepare('UPDATE patients SET reminder_email = ? WHERE id = ?').run(clean, patientId);
  return { reminderEmail: clean };
}

function medicineRows(db, patientId) {
  return db.prepare('SELECT * FROM medicines WHERE patient_id = ? ORDER BY name').all(patientId);
}

export function getMedicineRow(db, id) {
  const row = db.prepare('SELECT * FROM medicines WHERE id = ?').get(id);
  if (!row) throw new HttpError(404, 'Medicine not found');
  return row;
}

const RECENT_LIMIT = 5;
const RECENT_DAYS = 14;

// The latest few doses (newest first) that are no longer upcoming, for the medicine card.
function recentDoses(med, logMap, now) {
  const out = [];
  for (let i = 0; i < RECENT_DAYS && out.length < RECENT_LIMIT; i++) {
    const date = addDays(now.date, -i);
    for (const d of dosesForDate([med], date).reverse()) {
      const log = logMap.get(doseKey(med.id, date, d.time));
      const status = statusOf(d, log, now);
      if (status === 'upcoming') continue;
      out.push({ date, time: d.time, status, reason: log?.reason ?? null, recordedBy: log?.recorded_by ?? null });
      if (out.length === RECENT_LIMIT) break;
    }
  }
  return out;
}

export function listMedicines(db, patientId, tz) {
  getPatient(db, patientId);
  const now = nowInTz(tz);
  const logs = db.prepare(
    'SELECT * FROM dose_logs WHERE date BETWEEN ? AND ? AND medicine_id IN (SELECT id FROM medicines WHERE patient_id = ?)',
  ).all(addDays(now.date, -(RECENT_DAYS - 1)), now.date, patientId);
  const logMap = new Map(logs.map((l) => [doseKey(l.medicine_id, l.date, l.time), l]));
  return medicineRows(db, patientId).map((r) => {
    const m = baseMedicine(r);
    return { ...m, supply: stockStatus(m, now.date), recent: recentDoses(m, logMap, now) };
  });
}

export function createMedicine(db, patientId, input) {
  getPatient(db, patientId);
  const m = validateMedicine(input);
  const res = db.prepare(
    `INSERT INTO medicines (patient_id, name, strength, dose, times, food, start_date, end_date, stock, units_per_dose, low_stock_days, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(patientId, m.name, m.strength, m.dose, JSON.stringify(m.times), m.food, m.startDate, m.endDate, m.stock, m.unitsPerDose, m.lowStockDays, nowIso());
  return baseMedicine(getMedicineRow(db, Number(res.lastInsertRowid)));
}

export function updateMedicine(db, id, input) {
  getMedicineRow(db, id);
  const m = validateMedicine(input);
  db.prepare(
    `UPDATE medicines SET name=?, strength=?, dose=?, times=?, food=?, start_date=?, end_date=?, stock=?, units_per_dose=?, low_stock_days=? WHERE id=?`,
  ).run(m.name, m.strength, m.dose, JSON.stringify(m.times), m.food, m.startDate, m.endDate, m.stock, m.unitsPerDose, m.lowStockDays, id);
  return baseMedicine(getMedicineRow(db, id));
}

// Returns the removed row so the caller can clean up the prescription file.
export function deleteMedicine(db, id) {
  const row = getMedicineRow(db, id);
  db.prepare('DELETE FROM medicines WHERE id = ?').run(id);
  return row;
}

export function refill(db, id, quantity) {
  const q = Number(quantity);
  if (!Number.isFinite(q) || q <= 0 || q > 100000) throw new HttpError(400, 'quantity must be a positive number');
  const row = getMedicineRow(db, id);
  db.prepare('UPDATE medicines SET stock = stock + ? WHERE id = ?').run(q, id);
  return { stock: row.stock + q };
}

export function setPrescriptionFile(db, id, file) {
  const row = getMedicineRow(db, id);
  db.prepare('UPDATE medicines SET prescription_file = ? WHERE id = ?').run(file, id);
  return row.prescription_file;
}

// ---- daily schedule and dose logging ----

export function daySchedule(db, patientId, date, tz) {
  getPatient(db, patientId);
  const now = nowInTz(tz);
  const meds = medicineRows(db, patientId).map(baseMedicine);
  const logs = db.prepare(
    'SELECT * FROM dose_logs WHERE date = ? AND medicine_id IN (SELECT id FROM medicines WHERE patient_id = ?)',
  ).all(date, patientId);
  const byKey = new Map(logs.map((l) => [doseKey(l.medicine_id, l.date, l.time), l]));
  const doses = dosesForDate(meds, date).map((d) => {
    const log = byKey.get(doseKey(d.medicineId, d.date, d.time));
    return {
      ...d, status: statusOf(d, log, now),
      reason: log?.reason ?? null, recordedBy: log?.recorded_by ?? null, recordedAt: log?.recorded_at ?? null,
    };
  });
  return { date, now, doses };
}

export function recordDose(db, input, who, tz) {
  const d = validateDose(input);
  const now = nowInTz(tz);
  const row = getMedicineRow(db, d.medicineId);
  const med = baseMedicine(row);
  if (d.date > now.date) throw new HttpError(400, "A dose can't be recorded for a future date");
  if (!dosesForDate([med], d.date).some((x) => x.time === d.time)) {
    throw new HttpError(400, 'That dose is not scheduled for this medicine at that date and time');
  }
  return tx(db, () => {
    const prev = db.prepare('SELECT status FROM dose_logs WHERE medicine_id=? AND date=? AND time=?').get(d.medicineId, d.date, d.time);
    db.prepare(
      `INSERT INTO dose_logs (medicine_id, date, time, status, reason, recorded_by, recorded_at) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(medicine_id, date, time) DO UPDATE SET status=excluded.status, reason=excluded.reason,
         recorded_by=excluded.recorded_by, recorded_at=excluded.recorded_at`,
    ).run(d.medicineId, d.date, d.time, d.status, d.status === 'skipped' ? d.reason : null, who, nowIso());
    // Stock goes down only when a dose is actually given, and is restored if that is changed.
    const delta = (d.status === 'given' ? -med.unitsPerDose : 0) + (prev?.status === 'given' ? med.unitsPerDose : 0);
    const stock = Math.max(0, row.stock + delta);
    if (delta !== 0) db.prepare('UPDATE medicines SET stock = ? WHERE id = ?').run(stock, d.medicineId);
    return { stock };
  });
}

export function undoDose(db, { medicineId, date, time }) {
  const row = getMedicineRow(db, Number(medicineId));
  return tx(db, () => {
    const prev = db.prepare('SELECT status FROM dose_logs WHERE medicine_id=? AND date=? AND time=?').get(row.id, date, time);
    if (!prev) return { stock: row.stock };
    db.prepare('DELETE FROM dose_logs WHERE medicine_id=? AND date=? AND time=?').run(row.id, date, time);
    const stock = prev.status === 'given' ? row.stock + row.units_per_dose : row.stock;
    if (stock !== row.stock) db.prepare('UPDATE medicines SET stock = ? WHERE id = ?').run(stock, row.id);
    return { stock };
  });
}

export function weekAdherence(db, patientId, days, tz) {
  getPatient(db, patientId);
  const n = Math.min(Math.max(Number.parseInt(days, 10) || 7, 1), 31);
  const now = nowInTz(tz);
  const meds = medicineRows(db, patientId).map(baseMedicine);
  const logs = db.prepare(
    'SELECT * FROM dose_logs WHERE date BETWEEN ? AND ? AND medicine_id IN (SELECT id FROM medicines WHERE patient_id = ?)',
  ).all(addDays(now.date, -(n - 1)), now.date, patientId);
  return adherence(meds, logs, now.date, n, now);
}

// ---- handover notes ----

export function listHandover(db, patientId) {
  getPatient(db, patientId);
  return db.prepare(
    'SELECT id, author, shift, note, created_at AS createdAt FROM handover_notes WHERE patient_id = ? ORDER BY id DESC LIMIT 20',
  ).all(patientId).map((n) => ({ ...n }));
}

export function addHandover(db, patientId, input, author) {
  getPatient(db, patientId);
  const h = validateHandover(input);
  db.prepare('INSERT INTO handover_notes (patient_id, author, shift, note, created_at) VALUES (?,?,?,?,?)')
    .run(patientId, author, h.shift, h.note, nowIso());
  return listHandover(db, patientId);
}
