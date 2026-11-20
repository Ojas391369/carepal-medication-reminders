// Synthetic demo data only. Names, medicines and history are invented; no real patient records.
import { openDb, tx } from './db.js';
import { config } from './config.js';
import { nowInTz, addDays } from './lib/dates.js';
import { dosesForDate, statusOf } from './lib/schedule.js';

function rng(seed) { // small deterministic PRNG so the demo looks the same every time
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SKIP_REASONS = ['Patient refused', 'Nausea after breakfast', 'Asleep, not woken', 'BP low, held as advised', 'Tablet not available'];

export function seedDatabase(db, tz = config.tz) {
  const now = nowInTz(tz);
  const today = now.date;
  const iso = new Date().toISOString();
  const rand = rng(42);

  tx(db, () => {
    const addPatient = db.prepare('INSERT INTO patients (name, age, note) VALUES (?,?,?)');
    const p1 = Number(addPatient.run('Savita Sharma (demo)', 78, 'Dementia care, diabetes, high blood pressure').lastInsertRowid);
    const p2 = Number(addPatient.run('Ramesh Verma (demo)', 71, 'Recovery after hospital stay').lastInsertRowid);

    const addMed = db.prepare(
      `INSERT INTO medicines (patient_id, name, strength, dose, times, food, start_date, end_date, stock, units_per_dose, low_stock_days, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const med = (pid, name, strength, dose, times, food, start, end, stock, low = 5) =>
      addMed.run(pid, name, strength, dose, JSON.stringify(times), food, start, end, stock, 1, low, iso);

    // [patient, name, strength, dose, times, food, startOffset, endOffset|null, stock]
    const defs = [
      [p1, 'Metformin', '500 mg', '1 tablet', ['08:00', '20:00'], 'after', -60, null, 7],      // low stock
      [p1, 'Amlodipine', '5 mg', '1 tablet', ['09:00'], 'after', -60, null, 28],
      [p1, 'Donepezil', '5 mg', '1 tablet', ['21:00'], 'any', -45, null, 20],
      [p1, 'Atorvastatin', '10 mg', '1 tablet', ['22:00'], 'after', -60, null, 1],              // critical stock
      [p1, 'Pantoprazole', '40 mg', '1 tablet', ['07:30'], 'before', -10, 10, 15],
      [p1, 'Amoxicillin-Clavulanate', '625 mg', '1 tablet', ['08:00', '14:00', '20:00'], 'after', -3, 4, 21], // course ends before stock does
      [p2, 'Aspirin', '75 mg', '1 tablet', ['14:00'], 'after', -20, null, 30],
      [p2, 'Clopidogrel', '75 mg', '1 tablet', ['09:00'], 'any', -20, null, 12],
      [p2, 'Metoprolol', '25 mg', '1 tablet', ['08:00', '20:00'], 'after', -20, null, 40],
    ];
    for (const [pid, name, strength, dose, times, food, s, e, stock] of defs) {
      med(pid, name, strength, dose, times, food, addDays(today, s), e === null ? null : addDays(today, e), stock);
    }

    // Seven days of history: mostly given, some skipped with a reason, a few with no record (missed).
    const meds = db.prepare('SELECT * FROM medicines').all().map((r) => ({
      id: r.id, name: r.name, strength: r.strength, dose: r.dose, food: r.food, times: JSON.parse(r.times),
      startDate: r.start_date, endDate: r.end_date ?? '',
    }));
    const addLog = db.prepare('INSERT INTO dose_logs (medicine_id, date, time, status, reason, recorded_by, recorded_at) VALUES (?,?,?,?,?,?,?)');
    for (let i = 7; i >= 0; i--) {
      const date = addDays(today, -i);
      for (const dose of dosesForDate(meds, date)) {
        const st = statusOf(dose, null, now);
        if (st === 'upcoming' || st === 'due') continue;
        const r = rand();
        if (r < 0.86) addLog.run(dose.medicineId, date, dose.time, 'given', null, 'Anita (nurse)', iso);
        else if (r < 0.94) addLog.run(dose.medicineId, date, dose.time, 'skipped', SKIP_REASONS[Math.floor(rand() * SKIP_REASONS.length)], 'Anita (nurse)', iso);
        // else: no record, shows up as missed
      }
    }

    const addNote = db.prepare('INSERT INTO handover_notes (patient_id, author, shift, note, created_at) VALUES (?,?,?,?,?)');
    addNote.run(p1, 'Meena (day nurse)', 'day', 'Ate a small lunch. Refused the 14:00 dose once, took it after 30 minutes. BP 130/82 at 11:00. Atorvastatin strip is almost finished, please ask the family to refill.', new Date(Date.now() - 6 * 3600e3).toISOString());
    addNote.run(p1, 'Anita (night nurse)', 'night', 'Slept well. Slightly confused around 23:00, settled with a short walk. Donepezil given on time.', new Date(Date.now() - 18 * 3600e3).toISOString());
  });
}

// `npm run seed` wipes and reseeds the database.
if (import.meta.filename === process.argv[1]) {
  const db = openDb(config.dbFile);
  db.exec('DELETE FROM reminders_sent; DELETE FROM dose_logs; DELETE FROM handover_notes; DELETE FROM medicines; DELETE FROM patients;');
  seedDatabase(db);
  console.log('Database reset and seeded with demo data.');
}
