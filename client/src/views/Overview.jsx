import { useState } from 'react';
import { api } from '../api.js';
import { fmtDate, fmtTime, supplyText, useLoad, Spinner, ErrorNote } from '../ui.jsx';

const band = (p) => (p === null ? 'none' : p >= 90 ? 'good' : p >= 75 ? 'ok' : 'bad');

export default function Overview({ patient, notify, onEmailSaved }) {
  const adh = useLoad(() => api.adherence(patient.id), [patient.id], 60000);
  const meds = useLoad(() => api.medicines(patient.id), [patient.id], 60000);
  const [email, setEmail] = useState(patient.reminderEmail ?? '');

  async function saveEmail(e) {
    e.preventDefault();
    try { await api.setEmail(patient.id, email); await onEmailSaved(); notify(email ? 'Reminder email saved' : 'Reminder email removed'); }
    catch (err) { notify(err.message, 'error'); }
  }

  if (adh.loading) return <Spinner />;
  const a = adh.data;
  if (!a) return <ErrorNote error={adh.error} />;
  const alerts = (meds.data ?? []).filter((m) => m.supply.level === 'low' || m.supply.level === 'critical');

  return (
    <>
      <section className="card adherence">
        <div className={`ring ${band(a.percent)}`} style={{ '--p': a.percent ?? 0 }} role="img" aria-label={`Adherence ${a.percent ?? 'unknown'} percent`}>
          <span>{a.percent === null ? '–' : `${a.percent}%`}</span>
        </div>
        <div>
          <h2>Last 7 days</h2>
          <p className="muted small">{fmtDate(a.from)} to {fmtDate(a.to)}</p>
          <p><strong>{a.given}</strong> given · <strong>{a.skipped}</strong> skipped · <strong>{a.missed}</strong> not recorded</p>
        </div>
      </section>

      <section className="card">
        <h2>Day by day</h2>
        <div className="bars">
          {a.perDay.map((d) => (
            <div key={d.date} className="bar-col" title={d.percent === null ? 'No doses yet' : `${d.percent}%`}>
              <span className="small">{d.percent ?? '–'}</span>
              <div className="bar-track"><div className={`bar ${band(d.percent)}`} style={{ height: `${d.percent ?? 0}%` }} /></div>
              <span className="small muted">{fmtDate(d.date, { weekday: 'narrow' })}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Skipped doses</h2>
        {a.skippedDoses.length === 0 ? <p className="muted">None this week.</p> : (
          <ul className="plain">
            {a.skippedDoses.map((s) => (
              <li key={s.date + s.time + s.medicineId}>
                <strong>{s.name} {s.strength}</strong> <span className="muted small">{fmtDate(s.date)}, {fmtTime(s.time)}</span>
                <div className="small reason">Reason: {s.reason}{s.recordedBy ? ` (${s.recordedBy})` : ''}</div>
              </li>
            ))}
          </ul>
        )}
        {a.missedDoses.length > 0 && (
          <>
            <h3>Not recorded</h3>
            <ul className="plain">
              {a.missedDoses.map((s) => (
                <li key={s.date + s.time + s.medicineId}><strong>{s.name} {s.strength}</strong> <span className="muted small">{fmtDate(s.date)}, {fmtTime(s.time)}</span></li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card">
        <h2>By medicine</h2>
        <ul className="plain">
          {a.perMedicine.map((m) => (
            <li key={m.medicineId} className="row-between"><span>{m.name} <span className="muted small">{m.strength}</span></span><span className={`pill ${band(m.percent)}`}>{m.percent}%</span></li>
          ))}
        </ul>
      </section>

      {alerts.length > 0 && (
        <section className="card">
          <h2>Running low</h2>
          <ul className="plain">
            {alerts.map((m) => (
              <li key={m.id} className="row-between"><span>{m.name} <span className="muted small">{m.strength}</span></span>
                <span className={`pill ${m.supply.level === 'critical' ? 'bad' : 'ok'}`}>{supplyText(m.supply)}</span></li>
            ))}
          </ul>
        </section>
      )}

      <form className="card" onSubmit={saveEmail}>
        <h2>Email reminders</h2>
        <p className="muted small">Optional. Dose reminders are also emailed to this address when the server has email set up.</p>
        <div className="btn-row">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" aria-label="Reminder email" />
          <button>Save</button>
        </div>
      </form>
    </>
  );
}
