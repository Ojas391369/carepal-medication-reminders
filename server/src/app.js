import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HttpError } from './lib/errors.js';
import { createAuth } from './auth.js';
import * as svc from './service.js';
import { nowInTz, isDate } from './lib/dates.js';
import { demoPayload } from './demo.js';

const IMAGE_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

export function createApp({ db, config, notifier }) {
  const app = express();
  const auth = createAuth(config);
  const caregiver = auth.requireRole('caregiver');
  const id = (v) => { const n = Number(v); if (!Number.isInteger(n)) throw new HttpError(400, 'Invalid id'); return n; };

  app.disable('x-powered-by');
  app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });
  app.use(express.json({ limit: '100kb' }));

  const api = express.Router();

  api.get('/config', (req, res) => {
    res.json({ tz: config.tz, demo: config.demo, demoCodes: config.demo ? { caregiver: config.caregiverCode, family: config.familyCode } : null });
  });
  api.post('/login', (req, res) => res.json(auth.login(req.ip, req.body ?? {})));

  api.use(auth.requireAuth);
  api.post('/logout', (req, res) => { auth.logout((req.get('authorization') || '').replace(/^Bearer /, '')); res.json({ ok: true }); });

  api.get('/patients', (req, res) => res.json(svc.listPatients(db)));
  api.put('/patients/:pid/reminder-email', (req, res) => res.json(svc.setReminderEmail(db, id(req.params.pid), req.body?.email)));

  api.get('/patients/:pid/medicines', (req, res) => res.json(svc.listMedicines(db, id(req.params.pid), config.tz)));
  api.post('/patients/:pid/medicines', caregiver, (req, res) => res.status(201).json(svc.createMedicine(db, id(req.params.pid), req.body)));
  api.put('/medicines/:mid', caregiver, (req, res) => res.json(svc.updateMedicine(db, id(req.params.mid), req.body)));
  api.delete('/medicines/:mid', caregiver, (req, res) => {
    const row = svc.deleteMedicine(db, id(req.params.mid));
    if (row.prescription_file) fs.rm(path.join(config.uploadDir, row.prescription_file), { force: true }, () => {});
    res.status(204).end();
  });
  api.post('/medicines/:mid/refill', caregiver, (req, res) => res.json(svc.refill(db, id(req.params.mid), req.body?.quantity)));

  // Prescription photo: raw image body in, and served back only to signed-in users.
  api.put('/medicines/:mid/prescription', caregiver, express.raw({ type: Object.keys(IMAGE_EXT), limit: '6mb' }), (req, res) => {
    const ext = IMAGE_EXT[req.get('content-type')?.split(';')[0]];
    if (!ext || !Buffer.isBuffer(req.body) || req.body.length === 0) throw new HttpError(415, 'Upload a JPEG, PNG or WebP image (max 6 MB)');
    const mid = id(req.params.mid);
    svc.getMedicineRow(db, mid);
    fs.mkdirSync(config.uploadDir, { recursive: true });
    const file = `rx-${mid}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    fs.writeFileSync(path.join(config.uploadDir, file), req.body);
    const old = svc.setPrescriptionFile(db, mid, file);
    if (old) fs.rm(path.join(config.uploadDir, old), { force: true }, () => {});
    res.json({ ok: true });
  });
  api.get('/medicines/:mid/prescription', (req, res) => {
    const file = svc.getMedicineRow(db, id(req.params.mid)).prescription_file;
    if (!file) throw new HttpError(404, 'No prescription attached');
    res.set('Cache-Control', 'private, max-age=300');
    res.sendFile(path.join(config.uploadDir, file));
  });

  api.get('/patients/:pid/schedule', (req, res) => {
    const date = req.query.date ?? nowInTz(config.tz).date;
    if (!isDate(date)) throw new HttpError(400, 'date must be YYYY-MM-DD');
    res.json(svc.daySchedule(db, id(req.params.pid), date, config.tz));
  });
  api.put('/doses', caregiver, (req, res) => res.json(svc.recordDose(db, req.body, req.user.name, config.tz)));
  api.delete('/doses', caregiver, (req, res) => res.json(svc.undoDose(db, req.query)));

  api.get('/patients/:pid/adherence', (req, res) => res.json(svc.weekAdherence(db, id(req.params.pid), req.query.days, config.tz)));

  api.get('/patients/:pid/handover', (req, res) => res.json(svc.listHandover(db, id(req.params.pid))));
  api.post('/patients/:pid/handover', caregiver, (req, res) => res.status(201).json(svc.addHandover(db, id(req.params.pid), req.body, req.user.name)));

  api.get('/push/key', (req, res) => res.json({ publicKey: notifier.publicKey }));
  api.post('/push/subscribe', (req, res) => {
    const { endpoint, keys } = req.body ?? {};
    if (typeof endpoint !== 'string' || !endpoint.startsWith('https://') || !keys?.p256dh || !keys?.auth) throw new HttpError(400, 'Invalid push subscription');
    db.prepare(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth, role, created_at) VALUES (?,?,?,?,?)
       ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth, role=excluded.role`,
    ).run(endpoint, keys.p256dh, keys.auth, req.user.role, new Date().toISOString());
    res.status(201).json({ ok: true });
  });
  api.post('/push/test', caregiver, async (req, res) => {
    const r = await notifier.pushAll({ title: 'TheCarePal test reminder', body: 'Reminders are working on this device.', tag: 'test', url: '/' });
    if (r.devices === 0) throw new HttpError(409, 'No device is subscribed yet. Turn on reminders first.');
    res.json(r);
  });

  // Demo helper: sends a sample reminder, missed-dose or refill notification right now (turn off with DEMO_MODE=false).
  api.post('/demo/notify', caregiver, async (req, res) => {
    if (!config.demo) throw new HttpError(404, 'Demo tools are turned off');
    const { payload, options } = demoPayload(db, Number(req.body?.patientId), req.body?.type, config.tz);
    const r = await notifier.pushAll(payload, options);
    if (r.devices === 0) throw new HttpError(409, 'No device is subscribed yet. Turn on reminders first.');
    res.json(r);
  });

  app.use('/api', api);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // In production the built React app is served from the same port.
  if (fs.existsSync(config.clientDist)) {
    app.use(express.static(config.clientDist));
    app.use((req, res, next) => (req.method === 'GET' ? res.sendFile(path.join(config.clientDist, 'index.html')) : next()));
  }

  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'File is too large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server' });
  });

  return app;
}
