// Builds sample notifications from the patient's real data, for the on-screen demo buttons.
import { listMedicines } from './service.js';
import { HttpError } from './lib/errors.js';

const label = (m) => `${m.name}${m.strength ? ` ${m.strength}` : ''}`;

export function demoPayload(db, patientId, type, tz) {
  const patient = db.prepare('SELECT name FROM patients WHERE id = ?').get(patientId);
  if (!patient) throw new HttpError(404, 'Patient not found');
  const meds = listMedicines(db, patientId, tz);
  if (meds.length === 0) throw new HttpError(409, 'Add a medicine first');

  if (type === 'refill') {
    const m = meds.find((x) => x.supply.level === 'critical') || meds.find((x) => x.supply.level === 'low') || meds[0];
    const d = m.supply.daysLeft;
    const left = d == null || d <= 0 ? 'less than a day' : `${d} day${d === 1 ? '' : 's'}`;
    return { payload: { title: `Demo: Refill needed: ${patient.name}`, body: `${label(m)} has ${left} of stock left. Please arrange a refill.`, tag: 'demo-refill', url: '/' }, options: {} };
  }
  const m = meds[0];
  const time = m.times[0];
  if (type === 'reminder') {
    return { payload: { title: `Demo: Medicine due: ${patient.name}`, body: `${time} · ${label(m)}, ${m.dose}`, tag: 'demo-reminder', url: '/' }, options: {} };
  }
  if (type === 'missed') {
    return { payload: { title: `Demo: MISSED DOSE: ${patient.name}`, body: `${time} · ${label(m)}, ${m.dose} has not been recorded for 30 minutes. Please check and record it.`, tag: 'demo-missed', url: '/' }, options: { urgency: 'high' } };
  }
  throw new HttpError(400, 'type must be reminder, missed or refill');
}
