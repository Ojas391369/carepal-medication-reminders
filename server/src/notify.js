import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';

function loadVapid(config) {
  if (config.vapid.publicKey && config.vapid.privateKey) return config.vapid;
  try {
    return { ...config.vapid, ...JSON.parse(fs.readFileSync(config.vapidFile, 'utf8')) };
  } catch {
    const keys = webpush.generateVAPIDKeys();
    fs.mkdirSync(path.dirname(config.vapidFile), { recursive: true });
    fs.writeFileSync(config.vapidFile, JSON.stringify(keys), { mode: 0o600 });
    console.log('Generated VAPID keys in server/data/vapid.json (git-ignored)');
    return { ...config.vapid, ...keys };
  }
}

export function createNotifier({ config, db }) {
  const vapid = loadVapid(config);
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  let transport; // lazily created nodemailer transport; null when SMTP is not configured

  async function getTransport() {
    if (transport !== undefined) return transport;
    if (!config.smtp.host) return (transport = null);
    const { default: nodemailer } = await import('nodemailer');
    return (transport = nodemailer.createTransport({
      host: config.smtp.host, port: config.smtp.port, secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    }));
  }

  // Sends to subscribed devices (optionally only one role) and removes subscriptions the push service says are gone.
  async function pushAll(payload, { role, urgency } = {}) {
    const subs = role
      ? db.prepare('SELECT * FROM push_subscriptions WHERE role = ?').all(role)
      : db.prepare('SELECT * FROM push_subscriptions').all();
    let sent = 0;
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: 600, ...(urgency ? { urgency } : {}) },
        );
        sent++;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
        else console.error('Push failed:', err.statusCode ?? err.message);
      }
    }));
    return { sent, devices: subs.length };
  }

  async function email(to, subject, text) {
    if (!to) return false;
    const t = await getTransport();
    if (!t) { console.log(`[email not configured] to=${to} subject="${subject}"`); return false; }
    try {
      await t.sendMail({ from: config.smtp.from, to, subject, text });
      return true;
    } catch (err) {
      console.error('Email failed:', err.message);
      return false;
    }
  }

  return { publicKey: vapid.publicKey, pushAll, email };
}
