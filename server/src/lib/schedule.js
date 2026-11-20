// Pure scheduling, adherence and stock logic. No I/O, so it is easy to test.
import { addDays, absMinutes } from './dates.js';

// A dose that is still unlogged this long after its time is treated as "missed".
export const OVERDUE_GRACE_MIN = 60;

export const doseKey = (medicineId, date, time) => `${medicineId}|${date}|${time}`;

export function dosesForDate(medicines, date) {
  const out = [];
  for (const m of medicines) {
    if (date < m.startDate || (m.endDate && date > m.endDate)) continue;
    for (const time of m.times) {
      out.push({ medicineId: m.id, name: m.name, strength: m.strength, dose: m.dose, food: m.food, date, time });
    }
  }
  return out.sort((a, b) => a.time.localeCompare(b.time) || a.name.localeCompare(b.name));
}

// given | skipped (from the log) or upcoming | due | missed (derived from the clock)
export function statusOf(dose, log, now) {
  if (log) return log.status;
  const late = absMinutes(now.date, now.time) - absMinutes(dose.date, dose.time);
  if (late < 0) return 'upcoming';
  return late >= OVERDUE_GRACE_MIN ? 'missed' : 'due';
}

const pct = (given, countable) => (countable ? Math.round((given / countable) * 100) : null);

// Adherence = given / (given + skipped + missed). Upcoming doses and doses still inside the
// grace window are not counted yet, so a dose that is 5 minutes late does not drag the score down.
export function adherence(medicines, logs, endDate, days, now) {
  const logMap = new Map(logs.map((l) => [doseKey(l.medicine_id, l.date, l.time), l]));
  const perMed = new Map(medicines.map((m) => [m.id, { medicineId: m.id, name: m.name, strength: m.strength, given: 0, skipped: 0, missed: 0 }]));
  const perDay = [];
  const skipped = [];
  const missed = [];
  const total = { given: 0, skipped: 0, missed: 0 };

  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(endDate, -i);
    const day = { date, given: 0, skipped: 0, missed: 0, scheduled: 0 };
    for (const dose of dosesForDate(medicines, date)) {
      day.scheduled++;
      const log = logMap.get(doseKey(dose.medicineId, dose.date, dose.time));
      const status = statusOf(dose, log, now);
      if (status !== 'given' && status !== 'skipped' && status !== 'missed') continue;
      day[status]++;
      total[status]++;
      perMed.get(dose.medicineId)[status]++;
      const entry = { date, time: dose.time, medicineId: dose.medicineId, name: dose.name, strength: dose.strength };
      if (status === 'skipped') skipped.push({ ...entry, reason: log.reason, recordedBy: log.recorded_by });
      if (status === 'missed') missed.push(entry);
    }
    day.percent = pct(day.given, day.given + day.skipped + day.missed);
    perDay.push(day);
  }

  const countable = total.given + total.skipped + total.missed;
  return {
    days, from: addDays(endDate, -(days - 1)), to: endDate,
    percent: pct(total.given, countable), ...total, countable,
    perDay,
    perMedicine: [...perMed.values()]
      .filter((m) => m.given + m.skipped + m.missed > 0)
      .map((m) => ({ ...m, percent: pct(m.given, m.given + m.skipped + m.missed) })),
    skippedDoses: skipped.reverse(),
    missedDoses: missed.reverse(),
  };
}

// How long will the current stock last? Looks at the course end date too: if the course
// finishes before the stock runs out, there is nothing to warn about.
export function stockStatus(med, today) {
  const daily = med.times.length * med.unitsPerDose;
  const ref = today < med.startDate ? med.startDate : today;
  if (med.endDate && ref > med.endDate) return { level: 'ended', daysLeft: null, runsOutOn: null };
  const daysLeft = Math.floor(med.stock / daily);
  const runsOutOn = addDays(ref, daysLeft);
  if (med.endDate && med.endDate < runsOutOn) return { level: 'ok', daysLeft, runsOutOn: null, coversCourse: true };
  let level = 'ok';
  if (daysLeft <= 1) level = 'critical';
  else if (daysLeft <= med.lowStockDays) level = 'low';
  return { level, daysLeft, runsOutOn };
}
