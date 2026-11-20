import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(path.join(root, '.env')); } catch { /* .env is optional */ }

const env = process.env;
export const config = {
  root,
  port: Number(env.PORT || 4000),
  tz: env.APP_TZ || 'Asia/Kolkata',
  dbFile: env.DB_FILE || path.join(root, 'data', 'carepal.db'),
  uploadDir: path.join(root, 'data', 'uploads'),
  vapidFile: path.join(root, 'data', 'vapid.json'),
  clientDist: path.resolve(root, '..', 'client', 'dist'),
  caregiverCode: env.CAREGIVER_CODE || 'nurse123',
  familyCode: env.FAMILY_CODE || 'family123',
  demo: env.DEMO_MODE !== 'false',
  vapid: { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || 'mailto:admin@example.com' },
  smtp: { host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 587), user: env.SMTP_USER, pass: env.SMTP_PASS, from: env.MAIL_FROM || 'TheCarePal Reminders <no-reply@example.com>' },
};
