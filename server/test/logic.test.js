import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { seedDatabase } from '../src/seed.js';
import * as svc from '../src/service.js';
import { runReminderTick } from '../src/scheduler.js';
import { nowInTz, addDays, isDate } from '../src/lib/dates.js';
import { stockStatus, adherence, statusOf } from '../src/lib/schedule.js';
import { validateMedicine } from '../src/lib/validate.js';

const TZ = 'Asia/Kolkata';
const med = (o = {}) => ({ id: 1, name: 'X', strength: '', dose: '1', food: 'any', times: ['08:00'], startDate: '2026-01-01', endDate: '', stock: 10, unitsPerDose: 1, lowStockDays: 5, ...o });

test('date helpers', () => {
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(isDate('2026-02-30'), false);
  assert.match(nowInTz(TZ).time, /^\d\d:\d\d$/);
});

test('stock: warns when it runs out within the threshold', () => {
  const s = stockStatus(med({ times: ['08:00', '20:00'], stock: 7 }), '2026-06-01');
  assert.equal(s.daysLeft, 3);
  assert.equal(s.level, 'low');
  assert.equal(s.runsOutOn, '2026-06-04');
});

test('stock: critical at one day or less, ok when plenty', () => {
  assert.equal(stockStatus(med({ stock: 1 }), '2026-06-01').level, 'critical');
  assert.equal(stockStatus(med({ stock: 60 }), '2026-06-01').level, 'ok');
});

test('stock: no warning if the course ends before the stock does', () => {
  const s = stockStatus(med({ stock: 4, endDate: '2026-06-03' }), '2026-06-01');
  assert.equal(s.level, 'ok');
});

test('adherence ignores upcoming doses and doses inside the grace window', () => {
  const now = { date: '2026-06-02', time: '08:30' };
  const logs = [{ medicine_id: 1, date: '2026-06-01', time: '08:00', status: 'given' }];
  const r = adherence([med()], logs, '2026-06-02', 2, now);
  assert.equal(r.given, 1);
  assert.equal(r.countable, 1); // today's 08:00 is only 30 min late, not counted yet
  assert.equal(r.percent, 100);
  assert.equal(statusOf({ date: '2026-06-02', time: '08:00' }, null, { date: '2026-06-02', time: '09:00' }), 'missed');
});

test('adherence counts skipped and missed against the percentage and lists skips', () => {
  const now = { date: '2026-06-04', time: '23:00' };
  const logs = [
    { medicine_id: 1, date: '2026-06-02', time: '08:00', status: 'given' },
    { medicine_id: 1, date: '2026-06-03', time: '08:00', status: 'skipped', reason: 'Nausea', recorded_by: 'A' },
  ];
  const r = adherence([med()], logs, '2026-06-04', 3, now);
  assert.deepEqual([r.given, r.skipped, r.missed, r.percent], [1, 1, 1, 33]);
  assert.equal(r.skippedDoses[0].reason, 'Nausea');
});

test('validation accepts the shared JSON shape and rejects bad input', () => {
  const ok = validateMedicine({ name: 'Metformin', strength: '500 mg', dose: '1 tablet', times: ['20:00', '08:00'], food: 'after', startDate: '2026-06-01', endDate: '' });
  assert.deepEqual(ok.times, ['08:00', '20:00']);
  assert.equal(ok.endDate, null);
  assert.throws(() => validateMedicine({ name: '', dose: '', times: ['25:00'], food: 'x', startDate: 'nope' }), /name is required.*times/s);
  assert.throws(() => validateMedicine({ name: 'A', dose: '1', times: ['08:00'], startDate: '2026-06-05', endDate: '2026-06-01' }), /endDate/);
});

function setup() {
  const db = openDb(':memory:');
  seedDatabase(db, TZ);
  return db;
}

test('seeded data is realistic and shows stock alerts', () => {
  const db = setup();
  const p1 = svc.listPatients(db).find((p) => p.name.startsWith('Savita'));
  const meds = svc.listMedicines(db, p1.id, TZ);
  assert.ok(meds.length >= 5);
  assert.ok(meds.some((m) => m.supply.level === 'critical'));
  assert.ok(meds.some((m) => m.supply.level === 'low'));
  const w = svc.weekAdherence(db, p1.id, 7, TZ);
  assert.ok(w.percent > 50 && w.percent < 100);
  assert.ok(w.skippedDoses.length > 0);
});

test('recording a dose updates stock; undo restores it; skipped needs a reason', () => {
  const db = setup();
  const p1 = svc.listPatients(db).find((p) => p.name.startsWith('Savita'));
  const today = nowInTz(TZ).date;
  const m = svc.listMedicines(db, p1.id, TZ).find((x) => x.name === 'Amlodipine');
  const time = m.times[0];
  svc.undoDose(db, { medicineId: m.id, date: today, time }); // clear any seeded log
  const before = svc.listMedicines(db, p1.id, TZ).find((x) => x.id === m.id).stock;
  assert.equal(svc.recordDose(db, { medicineId: m.id, date: today, time, status: 'given' }, 'Nurse', TZ).stock, before - 1);
  assert.equal(svc.recordDose(db, { medicineId: m.id, date: today, time, status: 'given' }, 'Nurse', TZ).stock, before - 1); // idempotent
  assert.throws(() => svc.recordDose(db, { medicineId: m.id, date: today, time, status: 'skipped' }, 'Nurse', TZ), /reason/);
  assert.equal(svc.recordDose(db, { medicineId: m.id, date: today, time, status: 'skipped', reason: 'Refused' }, 'Nurse', TZ).stock, before);
  assert.throws(() => svc.recordDose(db, { medicineId: m.id, date: addDays(today, 1), time, status: 'given' }, 'Nurse', TZ), /future/);
  assert.throws(() => svc.recordDose(db, { medicineId: m.id, date: today, time: '03:33', status: 'given' }, 'Nurse', TZ), /not scheduled/);
});

test('reminder tick notifies once per due dose', async () => {
  const db = setup();
  const p1 = svc.listPatients(db).find((p) => p.name.startsWith('Savita'));
  const now = nowInTz(TZ);
  svc.createMedicine(db, p1.id, { name: 'Test med', dose: '1', times: [now.time], startDate: now.date, food: 'any', stock: 5 });
  const calls = [];
  const notifier = { pushAll: async (p) => { calls.push(p); return { sent: 1, devices: 1 }; }, email: async () => false };
  const ctx = { db, notifier, config: { tz: TZ }, now };
  const first = await runReminderTick(ctx);
  const second = await runReminderTick(ctx);
  assert.ok(first >= 1);
  assert.equal(second, 0);
  assert.ok(calls.some((c) => c.body.includes('Test med')));
});

test('missed-dose alert: sent once, only after a reminder, and not if the dose is recorded', async () => {
  const db = setup();
  const p1 = svc.listPatients(db).find((p) => p.name.startsWith('Savita'));
  const today = nowInTz(TZ).date;
  const m = svc.createMedicine(db, p1.id, { name: 'Alert med', dose: '1', times: ['12:00'], startDate: today, food: 'any', stock: 50 });
  const calls = [];
  const notifier = { pushAll: async (p, o) => { calls.push({ ...p, o }); return { sent: 1, devices: 1 }; }, email: async () => false };
  const at = (time) => ({ db, notifier, config: { tz: TZ }, now: { date: today, time } });
  const missed = () => calls.filter((c) => c.title.startsWith('MISSED'));

  await runReminderTick(at('12:40')); // 40 min late but no reminder was ever sent: no alert
  assert.equal(missed().length, 0);
  await runReminderTick(at('12:00')); // the normal reminder
  await runReminderTick(at('12:20')); // too early to escalate
  assert.equal(missed().length, 0);
  await runReminderTick(at('12:31'));
  await runReminderTick(at('12:45')); // second tick must not repeat it
  assert.equal(missed().length, 1);
  assert.equal(missed()[0].o.urgency, 'high');

  const m2 = svc.createMedicine(db, p1.id, { name: 'Recorded med', dose: '1', times: ['13:00'], startDate: today, food: 'any', stock: 50 });
  await runReminderTick(at('13:00'));
  svc.recordDose(db, { medicineId: m2.id, date: today, time: '13:00', status: 'given' }, 'Nurse', TZ);
  await runReminderTick(at('13:35'));
  assert.equal(missed().filter((c) => c.body.includes('Recorded med')).length, 0);
});

test('refill alert goes to family devices once per day and retries if nobody is subscribed', async () => {
  const db = setup();
  const calls = [];
  let devices = 0;
  const notifier = { pushAll: async (p, o) => { calls.push({ ...p, o }); return { sent: devices, devices }; }, email: async () => false };
  const ctx = { db, notifier, config: { tz: TZ }, now: { date: nowInTz(TZ).date, time: '03:00' } };
  const refills = () => calls.filter((c) => c.title.startsWith('Refill'));

  await runReminderTick(ctx); // nobody subscribed: attempted but not marked as sent
  const attempts = refills().length;
  assert.ok(attempts >= 2); // Atorvastatin (critical) and Metformin (low)
  devices = 1;
  await runReminderTick(ctx); // retried and delivered
  await runReminderTick(ctx); // now marked as sent, no repeat
  assert.equal(refills().length, attempts + attempts);
  assert.ok(refills().every((c) => c.o.role === 'family'));
  assert.ok(refills().some((c) => c.body.includes('Atorvastatin')));
});

test('medicine list includes recent dose history, newest first', () => {
  const db = setup();
  const p1 = svc.listPatients(db).find((p) => p.name.startsWith('Savita'));
  const met = svc.listMedicines(db, p1.id, TZ).find((m) => m.name === 'Metformin');
  assert.ok(met.recent.length > 0 && met.recent.length <= 5);
  const keys = met.recent.map((r) => `${r.date} ${r.time}`);
  assert.deepEqual(keys, [...keys].sort().reverse());
  assert.ok(met.recent.every((r) => ['given', 'skipped', 'missed', 'due'].includes(r.status)));
});

test('demo notifications are built from real data', async () => {
  const { demoPayload } = await import('../src/demo.js');
  const db = setup();
  const p1 = svc.listPatients(db).find((p) => p.name.startsWith('Savita'));
  const refill = demoPayload(db, p1.id, 'refill', TZ);
  assert.match(refill.payload.body, /Atorvastatin/); // the critical one is picked first
  assert.equal(demoPayload(db, p1.id, 'missed', TZ).options.urgency, 'high');
  assert.match(demoPayload(db, p1.id, 'reminder', TZ).payload.title, /Medicine due/);
  assert.throws(() => demoPayload(db, p1.id, 'nope', TZ), /type must be/);
});
