import { useEffect, useState } from 'react';
import { api, enablePush, pushSupported } from '../api.js';

// Chrome/Edge need Google's push service; Brave blocks it unless a setting is turned on.
const friendly = (e) => (/push service/i.test(e.message)
  ? 'Your browser could not reach its push service. Try Chrome, Edge or Firefox (in Brave, enable "Use Google Services for Push Messaging" in Settings > Privacy and security), and check you are online.'
  : e.message);

const DEMOS = [['reminder', 'Dose reminder'], ['missed', 'Missed-dose alert'], ['refill', 'Refill alert']];

export default function Reminders({ notify, canTest, demo, patientId }) {
  const [busy, setBusy] = useState(false);
  const [subscribed, setSubscribed] = useState(false);

  // "On" means this browser really has a push subscription, not just that permission was granted.
  useEffect(() => {
    if (!pushSupported()) return;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((s) => setSubscribed(Boolean(s)))
      .catch(() => {});
  }, []);

  async function run(fn, okMsg) {
    setBusy(true);
    try { await fn(); notify(okMsg); } catch (e) { notify(friendly(e), 'error'); } finally { setBusy(false); }
  }

  return (
    <section className="card">
      <div className="row-between">
        <div>
          <strong>Dose reminders</strong>
          <p className="muted small">{subscribed ? 'Notifications are on for this device.' : pushSupported() ? 'Get a notification at each dose time.' : 'Push is not available in this browser. On iPhone, add to Home Screen first.'}</p>
        </div>
        <div className="btn-row">
          {!subscribed && <button className="primary" disabled={busy || !pushSupported()} onClick={() => run(async () => { await enablePush(); setSubscribed(true); }, 'Reminders turned on')}>Turn on</button>}
          {subscribed && canTest && <button disabled={busy} onClick={() => run(async () => { await enablePush(); await api.pushTest(); }, 'Test notification sent')}>Send test</button>}
        </div>
      </div>
      {subscribed && demo && (
        <div className="demo">
          <span className="muted small">Demo: send a sample notification now</span>
          <div className="btn-row">
            {DEMOS.map(([type, text]) => (
              <button key={type} disabled={busy} onClick={() => run(() => api.demoNotify(patientId, type), `Demo ${text.toLowerCase()} sent`)}>{text}</button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
