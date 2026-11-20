import { useState } from 'react';
import { api } from '../api.js';
import { FOOD, fmtDate, fmtTime, shiftDate, supplyText, todayIn, useLoad, Spinner, ErrorNote } from '../ui.jsx';
import Reminders from './Reminders.jsx';

const REASONS = ['Patient refused', 'Nausea or vomiting', 'Asleep', 'Doctor advised hold', 'Not available'];
const LABEL = { given: 'Given', skipped: 'Skipped', missed: 'Missed', due: 'Due now', upcoming: 'Upcoming' };

function SkipForm({ onConfirm, onCancel, busy }) {
  const [reason, setReason] = useState('');
  return (
    <div className="skip-form">
      <div className="chips">
        {REASONS.map((r) => <button type="button" key={r} className={reason === r ? 'chip active' : 'chip'} onClick={() => setReason(r)}>{r}</button>)}
      </div>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" maxLength={200} aria-label="Reason for skipping" />
      <div className="btn-row">
        <button className="danger" disabled={busy || !reason.trim()} onClick={() => onConfirm(reason.trim())}>Confirm skip</button>
        <button disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function Dose({ d, canEdit, busy, onGive, onSkip, onUndo }) {
  const [skipping, setSkipping] = useState(false);
  const logged = d.status === 'given' || d.status === 'skipped';
  return (
    <li className={`dose ${d.status}`}>
      <div className="dose-main">
        <div>
          <strong>{d.name}</strong> <span className="muted">{d.strength}</span>
          <div className="muted small">{d.dose} · {FOOD[d.food]}</div>
          {d.status === 'skipped' && <div className="small reason">Reason: {d.reason}</div>}
          {logged && d.recordedBy && <div className="muted small">by {d.recordedBy}</div>}
        </div>
        <span className={`status ${d.status}`}>{LABEL[d.status]}</span>
      </div>
      {canEdit && !skipping && (
        <div className="btn-row">
          {!logged && <button className="primary" disabled={busy} onClick={onGive}>Mark given</button>}
          {!logged && <button disabled={busy} onClick={() => setSkipping(true)}>Skip</button>}
          {logged && <button disabled={busy} onClick={onUndo}>Undo</button>}
          {logged && <button disabled={busy} onClick={() => (d.status === 'given' ? setSkipping(true) : onGive())}>{d.status === 'given' ? 'Change to skipped' : 'Change to given'}</button>}
        </div>
      )}
      {canEdit && skipping && <SkipForm busy={busy} onCancel={() => setSkipping(false)} onConfirm={(r) => { setSkipping(false); onSkip(r); }} />}
    </li>
  );
}

export default function Today({ patient, readOnly, notify, tz, demo }) {
  const today = todayIn(tz);
  const [date, setDate] = useState(today);
  const [busyKey, setBusyKey] = useState(null);
  const sched = useLoad(() => api.schedule(patient.id, date), [patient.id, date], 30000);
  const meds = useLoad(() => api.medicines(patient.id), [patient.id], 30000);

  async function act(d, fn, okMsg) {
    setBusyKey(`${d.medicineId}${d.time}`);
    try { await fn(); notify(okMsg); sched.reload(); meds.reload(); }
    catch (e) { notify(e.message, 'error'); }
    finally { setBusyKey(null); }
  }
  const key = (d) => ({ medicineId: d.medicineId, date: d.date, time: d.time });

  if (sched.loading) return <Spinner />;
  const doses = sched.data?.doses ?? [];
  const due = doses.filter((d) => d.status === 'due' || d.status === 'missed').length;
  const alerts = (meds.data ?? []).filter((m) => m.supply.level === 'low' || m.supply.level === 'critical');
  const slots = [...new Set(doses.map((d) => d.time))];
  const canEdit = !readOnly && date <= today;

  return (
    <>
      <Reminders notify={notify} canTest={!readOnly} demo={demo && !readOnly} patientId={patient.id} />
      {alerts.map((m) => (
        <p key={m.id} className={`alert ${m.supply.level === 'critical' ? 'error' : 'warn'}`}>
          <strong>{m.name} {m.strength}</strong>: {supplyText(m.supply)}{m.supply.runsOutOn ? `, runs out ${fmtDate(m.supply.runsOutOn)}` : ''}. Please arrange a refill.
        </p>
      ))}
      <div className="date-nav">
        <button aria-label="Previous day" onClick={() => setDate(shiftDate(date, -1))}>‹</button>
        <div className="center"><strong>{date === today ? 'Today' : fmtDate(date)}</strong><div className="muted small">{fmtDate(date, { day: 'numeric', month: 'long', year: 'numeric' })}</div></div>
        <button aria-label="Next day" onClick={() => setDate(shiftDate(date, 1))}>›</button>
      </div>
      {date !== today && <button className="link" onClick={() => setDate(today)}>Back to today</button>}
      {date === today && due > 0 && <p className="alert warn">{due} dose{due > 1 ? 's' : ''} waiting to be recorded.</p>}
      <ErrorNote error={sched.error} />
      {doses.length === 0 && <p className="muted center">No medicines scheduled for this day.</p>}
      {slots.map((t) => (
        <section key={t} className="slot">
          <h2>{fmtTime(t)}</h2>
          <ul>
            {doses.filter((d) => d.time === t).map((d) => (
              <Dose key={d.medicineId + d.time} d={d} canEdit={canEdit} busy={busyKey === `${d.medicineId}${d.time}`}
                onGive={() => act(d, () => api.record({ ...key(d), status: 'given' }), `${d.name} marked as given`)}
                onSkip={(reason) => act(d, () => api.record({ ...key(d), status: 'skipped', reason }), `${d.name} marked as skipped`)}
                onUndo={() => act(d, () => api.undo(key(d)), 'Entry removed')} />
            ))}
          </ul>
        </section>
      ))}
      {readOnly && <p className="muted small center">View only. Only the caregiver can record doses.</p>}
    </>
  );
}
