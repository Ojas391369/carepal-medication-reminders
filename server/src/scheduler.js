import { nowInTz, minutesOf } from './lib/dates.js';
import { stockStatus } from './lib/schedule.js';

const CATCH_UP_MIN = 10;      // still send the normal reminder if the server was briefly busy
const MISSED_AFTER_MIN = 30;  // escalate if a reminded dose is still unrecorded this long after its time
const MISSED_UNTIL_MIN = 120; // ...and stop escalating after 2 hours

const FOOD = { before: 'before food', after: 'after food', any: '' };
const describe = (m) => `${m.name}${m.strength ? ` ${m.strength}` : ''}, ${m.dose}${FOOD[m.food] ? `, ${FOOD[m.food]}` : ''}`;

// Returns true only for the first caller, so each alert is sent once (the primary key enforces it).
const claim = (db, kind, medicineId, date, time) =>
  db.prepare('INSERT OR IGNORE INTO alerts_sent (kind, medicine_id, date, time) VALUES (?,?,?,?)').run(kind, medicineId, date, time).changes === 1;

async function refillAlerts({ db, notifier, now, meds }) {
  let count = 0;
  for (const m of meds) {
    const s = stockStatus({
      times: JSON.parse(m.times), unitsPerDose: m.units_per_dose, startDate: m.start_date,
      endDate: m.end_date ?? '', stock: m.stock, lowStockDays: m.low_stock_days,
    }, now.date);
    if (s.level !== 'low' && s.level !== 'critical') continue;

    const kind = `refill-${s.level}`; // at most one alert per medicine, per level, per day
    if (db.prepare('SELECT 1 FROM alerts_sent WHERE kind=? AND medicine_id=? AND date=? AND time=?').get(kind, m.id, now.date, '')) continue;

    const left = s.daysLeft <= 0 ? 'less than a day' : `${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'}`;
    const title = `Refill needed: ${m.patient_name}`;
    const body = `${m.name}${m.strength ? ` ${m.strength}` : ''} has ${left} of stock left. Please arrange a refill.`;
    const [push, mail] = await Promise.allSettled([
      notifier.pushAll({ title, body, tag: `refill-${m.id}`, url: '/' }, { role: 'family' }),
      notifier.email(m.reminder_email, title, body),
    ]);
    // Only mark it as sent once somebody actually received it, so it retries if nobody was subscribed yet.
    const delivered = (push.status === 'fulfilled' && push.value?.sent > 0) || (mail.status === 'fulfilled' && mail.value === true);
    if (delivered && claim(db, kind, m.id, now.date, '')) count++;
  }
  return count;
}

// Finds doses that need a reminder, a missed-dose alert or a refill alert. Safe to call repeatedly.
export async function runReminderTick({ db, notifier, config, now = nowInTz(config.tz) }) {
  const meds = db.prepare(
    `SELECT m.*, p.name AS patient_name, p.reminder_email FROM medicines m JOIN patients p ON p.id = m.patient_id
     WHERE m.start_date <= ? AND (m.end_date IS NULL OR m.end_date >= ?)`,
  ).all(now.date, now.date);
  let count = 0;

  for (const m of meds) {
    for (const time of JSON.parse(m.times)) {
      const late = minutesOf(now.time) - minutesOf(time);
      const isLogged = () => db.prepare('SELECT 1 FROM dose_logs WHERE medicine_id=? AND date=? AND time=?').get(m.id, now.date, time);

      if (late >= 0 && late <= CATCH_UP_MIN) {
        // 1) normal reminder at dose time
        if (isLogged()) continue;
        const claimed = db.prepare('INSERT OR IGNORE INTO reminders_sent (medicine_id, date, time) VALUES (?,?,?)').run(m.id, now.date, time);
        if (claimed.changes === 0) continue;
        const title = `Medicine due: ${m.patient_name}`;
        const body = `${time} · ${describe(m)}`;
        await Promise.allSettled([
          notifier.pushAll({ title, body, tag: `dose-${m.id}-${now.date}-${time}`, url: '/' }),
          notifier.email(m.reminder_email, title, `${body}\n\nOpen TheCarePal Medication to mark it as given or skipped.`),
        ]);
        count++;
      } else if (late >= MISSED_AFTER_MIN && late <= MISSED_UNTIL_MIN) {
        // 2) escalation: reminded earlier, still not recorded
        const reminded = db.prepare('SELECT 1 FROM reminders_sent WHERE medicine_id=? AND date=? AND time=?').get(m.id, now.date, time);
        if (!reminded || isLogged() || !claim(db, 'missed', m.id, now.date, time)) continue;
        const title = `MISSED DOSE: ${m.patient_name}`;
        const body = `${time} · ${describe(m)} has not been recorded for ${late} minutes. Please check and record it.`;
        await Promise.allSettled([
          notifier.pushAll({ title, body, tag: `missed-${m.id}-${now.date}-${time}`, url: '/' }, { urgency: 'high' }),
          notifier.email(m.reminder_email, title, body),
        ]);
        count++;
      }
    }
  }

  count += await refillAlerts({ db, notifier, now, meds });
  return count;
}

export function startScheduler(ctx, intervalMs = 30_000) {
  let running = false; // never let two ticks overlap
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await runReminderTick(ctx); } catch (err) { console.error('Reminder tick failed:', err); } finally { running = false; }
  }, intervalMs);
  return () => clearInterval(timer);
}
